# Troubleshooting Guide

> **Common issues and solutions for Outpost operations**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Author:** Richie G. Suarez, Zero Echelon LLC

---

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Control Plane Issues](#control-plane-issues)
3. [Worker/Agent Issues](#workeragent-issues)
4. [Authentication Issues](#authentication-issues)
5. [AWS Infrastructure Issues](#aws-infrastructure-issues)
6. [Performance Issues](#performance-issues)
7. [Integration Issues](#integration-issues)

---

## Quick Diagnostics

### Health Check

```bash
# Check control plane health
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health | jq .

# Expected: {"status":"healthy","version":"2.0.0","uptime":...}
```

### Fleet Status

```bash
# Check all agents
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/fleet \
  -H "X-API-Key: YOUR_KEY" | jq .

# All agents should show "available": true
```

### ECS Service Status

```bash
# Check control plane service
aws ecs describe-services \
  --cluster outpost-dev \
  --services outpost-control-plane \
  --profile soc \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
```

---

## Control Plane Issues

### Issue: Health Check Failing

**Symptoms:**
- ALB returns 502/503 errors
- `/health` endpoint not responding
- ECS tasks showing as unhealthy

**Diagnosis:**

```bash
# Check ECS task status
aws ecs describe-tasks \
  --cluster outpost-dev \
  --tasks $(aws ecs list-tasks --cluster outpost-dev --service-name outpost-control-plane --profile soc --query 'taskArns[0]' --output text) \
  --profile soc

# Check CloudWatch logs
aws logs tail /ecs/outpost-control-plane --profile soc --since 10m
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Task crashing on startup | Check logs for missing env vars |
| Memory exhaustion | Increase task memory allocation |
| Port conflict | Verify PORT env var matches task definition |
| DynamoDB connection | Verify IAM role has DynamoDB permissions |

---

### Issue: Control Plane Not Starting

**Symptoms:**
- ECS task stays in PENDING or STOPPED
- Exit code 1 in task

**Diagnosis:**

```bash
# Get stopped task reason
aws ecs describe-tasks \
  --cluster outpost-dev \
  --tasks TASK_ARN \
  --profile soc \
  --query 'tasks[0].{status:lastStatus,reason:stoppedReason,exitCode:containers[0].exitCode}'
```

**Common Causes:**

| Exit Code | Cause | Solution |
|-----------|-------|----------|
| 1 | Application error | Check logs for stack trace |
| 137 | OOM killed | Increase memory |
| 139 | Segfault | Check for native module issues |
| 143 | SIGTERM | Normal shutdown, check scaling rules |

---

### Issue: Slow Response Times

**Symptoms:**
- API latency > 500ms
- Timeouts on dispatch creation

**Diagnosis:**

```bash
# Check DynamoDB latency
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name SuccessfulRequestLatency \
  --dimensions Name=TableName,Value=outpost-jobs-dev Name=Operation,Value=Query \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average \
  --profile soc
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| DynamoDB throttling | Check consumed capacity, consider provisioned mode |
| Cold starts | Enable keep-alive on ALB |
| Network latency | Verify VPC endpoints configured |

---

## Worker/Agent Issues

### Issue: Dispatch Stays in PENDING

**Symptoms:**
- Status never changes from PENDING
- No ECS task launched

**Diagnosis:**

```bash
# Check ECS service events
aws ecs describe-services \
  --cluster outpost-dev \
  --services outpost-control-plane \
  --profile soc \
  --query 'services[0].events[:5]'

# Check Fargate quota
aws service-quotas get-service-quota \
  --service-code fargate \
  --quota-code L-3032A538 \
  --profile soc
```

**Common Causes:**

| Cause | Solution |
|-------|----------|
| Fargate vCPU quota exhausted | Request quota increase |
| Task definition not found | Verify task definition exists |
| Subnet capacity | Check subnet CIDR has available IPs |
| Security group rules | Verify egress allowed |

---

### Issue: Agent Task Fails Immediately

**Symptoms:**
- Task status: STOPPED
- Exit code: 1
- Duration: < 10 seconds

**Diagnosis:**

```bash
# Get task logs
TASK_ID="01HXYZ..."
aws logs filter-log-events \
  --log-group-name /ecs/outpost-claude \
  --filter-pattern "\"$TASK_ID\"" \
  --profile soc
```

**Common Causes:**

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `ANTHROPIC_API_KEY not set` | Missing secret | Populate Secrets Manager |
| `Model not found` | Invalid model ID | Check model ID spelling |
| `Repository not found` | Bad repo URL | Verify GitHub URL and token |
| `Permission denied` | Git ownership | Use dispatch scripts (sudo) |

---

### Issue: Agent Timeout

**Symptoms:**
- Status: TIMEOUT
- Task ran for full timeout duration
- No output produced

**Diagnosis:**

```bash
# Check task duration
aws dynamodb get-item \
  --table-name outpost-jobs-dev \
  --key '{"tenantId":{"S":"TENANT"},"dispatchId":{"S":"DISPATCH_ID"}}' \
  --profile soc \
  --query 'Item.{started:startedAt.S,timeout:timeoutSeconds.N}'
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Task too complex | Break into smaller tasks |
| Model rate limiting | Add retry logic, use different agent |
| Network issues | Check VPC NAT gateway |
| Infinite loop | Add task complexity limits |

---

### Issue: Agent Produces No Changes

**Symptoms:**
- Status: COMPLETED
- Exit code: 0
- Git diff: empty

**Diagnosis:**

```bash
# Check agent output
aws s3 cp s3://outpost-artifacts-dev/DISPATCH_ID/output.log - | tail -100
```

**Common Causes:**

| Cause | Solution |
|-------|----------|
| Task misunderstood | Clarify task description |
| Wrong branch | Specify correct branch |
| File not found | Verify file paths in task |
| Read-only mode | Check agent configuration |

---

## Authentication Issues

### Issue: 401 Unauthorized

**Symptoms:**
- API returns 401
- Message: "Invalid API key"

**Diagnosis:**

```bash
# Check API key exists (by prefix)
KEY_PREFIX="otp_abcd..."  # First 15 chars
aws dynamodb scan \
  --table-name outpost-api-keys-dev \
  --filter-expression "begins_with(keyPrefix, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"'"${KEY_PREFIX:0:15}"'"}}' \
  --profile soc
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Key not found | Provision new API key |
| Key revoked | Check status field |
| Key expired | Check expiresAt field |
| Wrong header | Use `X-API-Key` header |

---

### Issue: 403 Forbidden

**Symptoms:**
- API returns 403
- Message: "Insufficient scope"

**Diagnosis:**

```bash
# Check key scopes
aws dynamodb get-item \
  --table-name outpost-api-keys-dev \
  --key '{"apiKeyId":{"S":"KEY_ID"}}' \
  --profile soc \
  --query 'Item.scopes'
```

**Solutions:**

| Missing Scope | Operation | Solution |
|---------------|-----------|----------|
| `dispatch` | POST /dispatch | Update key scopes |
| `status` | GET /dispatch/:id | Update key scopes |
| `promote` | POST /promote | Update key scopes |
| `admin` | Fleet operations | Use admin key |

---

## AWS Infrastructure Issues

### Issue: DynamoDB Throttling

**Symptoms:**
- Intermittent 500 errors
- CloudWatch shows ThrottledRequests

**Diagnosis:**

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ThrottledRequests \
  --dimensions Name=TableName,Value=outpost-jobs-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Sum \
  --profile soc
```

**Solutions:**

1. Enable DynamoDB auto-scaling
2. Switch from PAY_PER_REQUEST to provisioned capacity
3. Add exponential backoff in application
4. Review access patterns for hot partitions

---

### Issue: S3 Access Denied

**Symptoms:**
- Artifact upload fails
- Status: "Access Denied"

**Diagnosis:**

```bash
# Check bucket policy
aws s3api get-bucket-policy --bucket outpost-artifacts-dev --profile soc

# Check IAM role
aws iam get-role-policy \
  --role-name outpost-ecs-task-role \
  --policy-name s3-access \
  --profile soc
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Missing IAM permission | Add s3:PutObject to task role |
| Bucket policy restriction | Update bucket policy |
| Wrong bucket name | Verify S3_ARTIFACTS_BUCKET env var |

---

### Issue: EFS Mount Failure

**Symptoms:**
- Task fails with "mount: mounting failed"
- Workspace not available

**Diagnosis:**

```bash
# Check EFS mount targets
aws efs describe-mount-targets \
  --file-system-id fs-XXXXXX \
  --profile soc

# Check security group
aws ec2 describe-security-groups \
  --group-ids sg-XXXXXX \
  --profile soc \
  --query 'SecurityGroups[0].IpPermissions'
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| No mount target in AZ | Create mount target |
| Security group blocking | Allow NFS (port 2049) |
| Wrong subnet | Use private subnet with mount target |

---

## Performance Issues

### Issue: High Cold Start Latency

**Symptoms:**
- First dispatch takes 30-45 seconds
- Subsequent dispatches fast

**Solutions:**

1. **Pre-warm workers:**
   ```bash
   # Send dummy dispatch to warm pool
   curl -X POST .../dispatch \
     -H "X-API-Key: ..." \
     -d '{"agent":"aider","task":"echo hello","timeoutSeconds":30}'
   ```

2. **Increase minimum capacity:**
   - Configure ECS service auto-scaling minimum > 0

3. **Use provisioned concurrency:**
   - Configure ECS with provisioned capacity mode

---

### Issue: Memory Pressure

**Symptoms:**
- OOM kills (exit code 137)
- Task restarts frequently

**Diagnosis:**

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ClusterName,Value=outpost-dev Name=ServiceName,Value=outpost-control-plane \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Maximum \
  --profile soc
```

**Solutions:**

| Tier | Current | Recommended |
|------|---------|-------------|
| Control Plane | 1024 MB | 2048 MB |
| Flagship (Claude) | 4096 MB | 8192 MB |
| Balanced | 2048 MB | 4096 MB |
| Fast | 1024 MB | 2048 MB |

---

## Integration Issues

### Issue: MCPify Not Connecting

**Symptoms:**
- MCP tool calls fail
- "Connection refused" errors

**Diagnosis:**

```bash
# Test HTTP connectivity
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health

# Check MCPify config
cat ~/.claude.json | jq '.mcpServers.mcpify.env'
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Wrong endpoint | Update OUTPOST_API_URL |
| Old SSM config | Remove OUTPOST_SSM_INSTANCE |
| MCP server not rebuilt | Run `npm run build` in mcpify |
| Claude Code not restarted | Restart Claude Code |

---

### Issue: Blueprint Dispatch Failing

**Symptoms:**
- Blueprint executes but dispatch fails
- Python client timeout

**Diagnosis:**

```python
from blueprint.outpost.client import OutpostClient

with OutpostClient() as client:
    # Enable debug logging
    import logging
    logging.basicConfig(level=logging.DEBUG)

    try:
        result = client.dispatch(...)
    except Exception as e:
        print(f"Error: {e}")
```

**Solutions:**

| Error | Solution |
|-------|----------|
| Connection timeout | Check network/firewall |
| Authentication error | Verify API key in env |
| Rate limited | Add retry logic |

---

## Diagnostic Commands Reference

### ECS Diagnostics

```bash
# List running tasks
aws ecs list-tasks --cluster outpost-dev --profile soc

# Describe specific task
aws ecs describe-tasks --cluster outpost-dev --tasks TASK_ARN --profile soc

# Get task logs
aws logs tail /ecs/outpost-control-plane --profile soc --follow

# Force new deployment
aws ecs update-service --cluster outpost-dev --service outpost-control-plane --force-new-deployment --profile soc
```

### DynamoDB Diagnostics

```bash
# Scan recent jobs
aws dynamodb scan \
  --table-name outpost-jobs-dev \
  --filter-expression "#s = :status" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":status":{"S":"FAILED"}}' \
  --limit 10 \
  --profile soc

# Get specific dispatch
aws dynamodb get-item \
  --table-name outpost-jobs-dev \
  --key '{"tenantId":{"S":"TENANT"},"dispatchId":{"S":"ID"}}' \
  --profile soc
```

### CloudWatch Diagnostics

```bash
# Query logs
aws logs filter-log-events \
  --log-group-name /ecs/outpost-control-plane \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --profile soc

# Get metrics
aws cloudwatch get-metric-data \
  --metric-data-queries file://metrics-query.json \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --profile soc
```

---

## Getting Help

If issues persist after following this guide:

1. **Check Session Journals:** `/session-journals/` for recent changes
2. **Review CloudWatch Logs:** Full stack traces available
3. **Contact Maintainer:** Richie G. Suarez (Zero Echelon LLC)

---

**Author:** Richie G. Suarez
**Organization:** Zero Echelon LLC

---

*Outpost Troubleshooting Guide v1.0.0*
