# Outpost Migration Runbook: SSM to ECS Fargate

> **Document Status**: Blueprint T5.3 Deliverable
> **Last Updated**: 2026-01-13
> **Owner**: Platform Team
> **Blueprint**: OUTPOST_MCPIFY_MIGRATION

---

## Overview

This runbook provides step-by-step instructions for migrating the Outpost platform from the legacy SSM-based architecture (v1) to the production-grade ECS Fargate control plane (v2).

**Migration Scope:**
- MCPify Outpost provider: 5 SSM-based tools -> 7 HTTP API tools
- Infrastructure: Lightsail single instance -> ECS Fargate container orchestration
- Storage: Local disk (`/home/ubuntu/claude-executor/runs/`) -> S3 artifacts
- Dispatch mechanism: `aws ssm send-command` -> HTTP REST API via ALB

**Estimated Duration:** 2-4 hours (excluding monitoring period)

---

## Pre-Migration Checklist

Complete all items before starting migration.

### Infrastructure Requirements

| Requirement | Verification Command | Expected Result |
|-------------|---------------------|-----------------|
| ECS cluster operational | `aws ecs describe-clusters --clusters outpost-dev --profile soc --region us-east-1` | `status: ACTIVE` |
| Control plane service running | `aws ecs describe-services --cluster outpost-dev --services outpost-control-plane --profile soc --region us-east-1` | `runningCount >= 1` |
| ALB provisioned | `aws elbv2 describe-load-balancers --names outpost-alb --profile soc --region us-east-1` | `State.Code: active` |
| ALB target healthy | `aws elbv2 describe-target-health --target-group-arn <TG_ARN> --profile soc --region us-east-1` | `TargetHealth.State: healthy` |

### ECR Images

Verify all 7 agent images are tagged and pushed:

```bash
# List all images in ECR
aws ecr describe-images --repository-name outpost-base --profile soc --region us-east-1 --query 'imageDetails[*].imageTags' --output text
```

| Image | Repository | Tag | Status |
|-------|------------|-----|--------|
| Base | `outpost-base` | `latest` | [ ] Verified |
| Claude | `outpost-claude` | `latest` | [ ] Verified |
| Codex | `outpost-codex` | `latest` | [ ] Verified |
| Gemini | `outpost-gemini` | `latest` | [ ] Verified |
| Aider | `outpost-aider` | `latest` | [ ] Verified |
| Grok | `outpost-grok` | `latest` | [ ] Verified |
| Control Plane | `outpost-control-plane` | `latest` | [ ] Verified |

### DynamoDB Tables

```bash
# Verify tables exist
aws dynamodb describe-table --table-name outpost-dispatches --profile soc --region us-east-1 --query 'Table.TableStatus'
aws dynamodb describe-table --table-name outpost-workspaces --profile soc --region us-east-1 --query 'Table.TableStatus'
aws dynamodb describe-table --table-name outpost-pool --profile soc --region us-east-1 --query 'Table.TableStatus'
```

| Table | Status |
|-------|--------|
| `outpost-dispatches` | [ ] ACTIVE |
| `outpost-workspaces` | [ ] ACTIVE |
| `outpost-pool` | [ ] ACTIVE |

### S3 Buckets

```bash
# Verify artifact bucket
aws s3 ls s3://outpost-artifacts-311493921645 --profile soc
```

| Bucket | Purpose | Status |
|--------|---------|--------|
| `outpost-artifacts-311493921645` | Dispatch artifacts | [ ] Verified |

### Secrets Manager

```bash
# Verify platform secrets exist
aws secretsmanager list-secrets --profile soc --region us-east-1 --filter Key=name,Values=/outpost/system --query 'SecretList[*].Name'
```

| Secret Path | Status |
|-------------|--------|
| `/outpost/system/ANTHROPIC_API_KEY` | [ ] Verified |
| `/outpost/system/OPENAI_API_KEY` | [ ] Verified |
| `/outpost/system/GOOGLE_API_KEY` | [ ] Verified |
| `/outpost/system/XAI_API_KEY` | [ ] Verified |
| `/outpost/system/GITHUB_PAT` | [ ] Verified |

### MCPify HTTP Provider Ready

| Item | Status |
|------|--------|
| MCPify HTTP provider code complete | [ ] Yes |
| Provider unit tests passing | [ ] Yes |
| Integration tests passing | [ ] Yes |
| API endpoint URL confirmed | [ ] Yes |

---

## Migration Steps

### Phase 1: Deploy ALB (If Not Already Deployed)

**Duration:** 15-30 minutes

```bash
# Navigate to terraform directory
cd ~/projects/outpost/terraform

# Initialize terraform
terraform init

# Plan ALB deployment
terraform plan -target=module.alb -out=alb.plan

# Review plan output for:
# - aws_lb.outpost_alb
# - aws_lb_listener.http
# - aws_lb_listener.https
# - aws_lb_target_group.control_plane

# Apply ALB changes
terraform apply alb.plan
```

**Verification:**
```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers --names outpost-alb --profile soc --region us-east-1 --query 'LoadBalancers[0].DNSName' --output text)
echo "ALB DNS: $ALB_DNS"

# Test health endpoint via ALB
curl -s http://$ALB_DNS/health/live
# Expected: {"status":"ok"}
```

**Checkpoint:** [ ] ALB responding to health checks

---

### Phase 2: Update DNS (If Applicable)

**Duration:** 5-10 minutes (+ DNS propagation)

If using custom domain `api.outpost.dev`:

```bash
# Create/update Route53 alias record
aws route53 change-resource-record-sets \
  --hosted-zone-id <ZONE_ID> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.outpost.dev",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "<ALB_HOSTED_ZONE_ID>",
          "DNSName": "'$ALB_DNS'",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }' \
  --profile soc
```

**Verification:**
```bash
# Check DNS resolution
dig api.outpost.dev +short

# Test via custom domain
curl -s https://api.outpost.dev/health/live
```

**Checkpoint:** [ ] Custom domain resolving to ALB

---

### Phase 3: Enable MCPify HTTP Provider

**Duration:** 10-15 minutes

#### 3.1 Update MCPify Configuration

Edit MCPify provider configuration to use HTTP endpoint:

```typescript
// mcpify/src/providers/outpost/config.ts
export const outpostConfig = {
  // NEW: HTTP-based provider
  provider: 'http',
  endpoint: process.env.OUTPOST_API_URL || 'https://api.outpost.dev',

  // DEPRECATED: SSM-based provider (retain for rollback)
  // provider: 'ssm',
  // instanceId: 'mi-0bbd8fed3f0650ddb',

  tools: [
    'outpost_dispatch',
    'outpost_status',
    'outpost_cancel',
    'outpost_health',
    'outpost_list_workspaces',
    'outpost_delete_workspace',
    'outpost_get_artifacts'
  ]
};
```

#### 3.2 Set Environment Variables

```bash
# Production environment
export OUTPOST_API_URL="https://api.outpost.dev"
export OUTPOST_PROVIDER="http"

# For testing/dev
export OUTPOST_API_URL="http://<ALB_DNS>"
```

#### 3.3 Restart MCPify Service

```bash
# If running as systemd service
sudo systemctl restart mcpify

# If running in Docker
docker-compose restart mcpify

# Verify startup
journalctl -u mcpify -f --since "1 minute ago"
```

**Verification:**
```bash
# Test dispatch via new provider
mcp call outpost_health
# Expected: Response from control plane with fleet status
```

**Checkpoint:** [ ] MCPify HTTP provider active and responding

---

### Phase 4: Disable SSM-Based Provider

**Duration:** 5 minutes

#### 4.1 Comment Out SSM Provider (Do Not Delete Yet)

```typescript
// mcpify/src/providers/outpost/ssm-provider.ts
// DEPRECATED: SSM provider - retained for rollback
// export class SsmOutpostProvider { ... }
```

#### 4.2 Update Tool Registry

Ensure only HTTP tools are registered:

```typescript
// Remove SSM tool registrations
// registerTool('dispatch', ssmDispatch);  // REMOVED
// registerTool('list_runs', ssmListRuns);  // REMOVED

// Keep HTTP tool registrations
registerTool('outpost_dispatch', httpDispatch);
registerTool('outpost_status', httpStatus);
// ... etc
```

#### 4.3 Verify SSM Not Being Called

```bash
# Monitor CloudTrail for SSM SendCommand calls
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=SendCommand \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --profile soc \
  --query 'Events[*].{Time:EventTime,Source:EventSource}'
```

**Checkpoint:** [ ] No new SSM SendCommand events

---

### Phase 5: Verify All 7 MCP Tools Working

**Duration:** 15-20 minutes

Execute verification for each tool:

#### Tool 1: outpost_dispatch
```bash
# Create test dispatch
DISPATCH_RESPONSE=$(mcp call outpost_dispatch --agent claude --task "echo hello world" --repo "rgsuarez/outpost")
echo $DISPATCH_RESPONSE | jq .
# Extract dispatch ID
DISPATCH_ID=$(echo $DISPATCH_RESPONSE | jq -r '.data.dispatchId')
```
**Status:** [ ] Working

#### Tool 2: outpost_status
```bash
# Get dispatch status
mcp call outpost_status --dispatchId $DISPATCH_ID | jq .
```
**Status:** [ ] Working

#### Tool 3: outpost_cancel
```bash
# Create a test dispatch and cancel it
TEST_DISPATCH=$(mcp call outpost_dispatch --agent claude --task "sleep 300" --timeoutSeconds 600)
TEST_ID=$(echo $TEST_DISPATCH | jq -r '.data.dispatchId')
mcp call outpost_cancel --dispatchId $TEST_ID | jq .
```
**Status:** [ ] Working

#### Tool 4: outpost_health
```bash
mcp call outpost_health | jq .
# Verify all agents show available: true
```
**Status:** [ ] Working

#### Tool 5: outpost_list_workspaces
```bash
mcp call outpost_list_workspaces | jq .
```
**Status:** [ ] Working

#### Tool 6: outpost_delete_workspace (Optional - only if workspaces exist)
```bash
# Only run if you have a test workspace to delete
# mcp call outpost_delete_workspace --workspaceId <TEST_WORKSPACE_ID>
```
**Status:** [ ] Working (or N/A)

#### Tool 7: outpost_get_artifacts
```bash
# Wait for a dispatch to complete, then get artifacts
mcp call outpost_get_artifacts --dispatchId $DISPATCH_ID | jq .
```
**Status:** [ ] Working

**Checkpoint:** [ ] All 7 tools verified operational

---

## Rollback Procedures

If issues are encountered, follow these rollback steps.

### Rollback Level 1: MCPify Provider Rollback

**Time to Execute:** 5 minutes

Re-enable SSM provider in MCPify:

```typescript
// mcpify/src/providers/outpost/config.ts
export const outpostConfig = {
  // ROLLBACK: Re-enable SSM provider
  provider: 'ssm',
  instanceId: 'mi-0bbd8fed3f0650ddb',
  awsProfile: 'soc',
  awsRegion: 'us-east-1',

  // HTTP provider disabled
  // provider: 'http',
  // endpoint: 'https://api.outpost.dev',
};
```

Restart MCPify:
```bash
sudo systemctl restart mcpify
```

Verify SSM working:
```bash
# Quick test
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["echo rollback-test"]' \
  --profile soc \
  --query 'Command.CommandId' \
  --output text
```

### Rollback Level 2: DNS Rollback

**Time to Execute:** 5-30 minutes (DNS propagation)

If using custom domain, revert DNS to bypass ALB:

```bash
# Option A: Point directly to Lightsail IP (if HTTP service there)
# Option B: Remove DNS record entirely (MCPify uses SSM directly)
aws route53 change-resource-record-sets \
  --hosted-zone-id <ZONE_ID> \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "api.outpost.dev",
        "Type": "A",
        "AliasTarget": {...}
      }
    }]
  }' \
  --profile soc
```

### Rollback Level 3: Full Infrastructure Rollback

**Time to Execute:** 15-30 minutes

If ECS Fargate infrastructure is causing issues:

```bash
# Scale down control plane service
aws ecs update-service \
  --cluster outpost-dev \
  --service outpost-control-plane \
  --desired-count 0 \
  --profile soc \
  --region us-east-1

# Optionally destroy ALB to stop costs
cd ~/projects/outpost/terraform
terraform destroy -target=module.alb
```

---

## Post-Migration Verification

After completing migration, verify system health.

### Health Check Commands

```bash
# 1. Control plane health
curl -s https://api.outpost.dev/health | jq .
# Expected: status: "healthy"

# 2. Fleet status
curl -s https://api.outpost.dev/health/fleet | jq .
# Expected: All agents available, pool populated

# 3. Liveness probe
curl -s https://api.outpost.dev/health/live
# Expected: {"status":"ok"}

# 4. Readiness probe
curl -s https://api.outpost.dev/health/ready
# Expected: {"status":"ready"}
```

### Dispatch Test Procedure

Execute full dispatch cycle:

```bash
# 1. Create dispatch
DISPATCH=$(curl -s -X POST https://api.outpost.dev/dispatch \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude",
    "task": "Create a simple hello.py that prints Hello World",
    "repo": "rgsuarez/outpost",
    "timeoutSeconds": 300
  }')

DISPATCH_ID=$(echo $DISPATCH | jq -r '.data.dispatchId')
echo "Dispatch ID: $DISPATCH_ID"

# 2. Poll status until completion
while true; do
  STATUS=$(curl -s https://api.outpost.dev/dispatch/$DISPATCH_ID \
    -H "Authorization: Bearer $OUTPOST_API_KEY" | jq -r '.data.status')
  echo "Status: $STATUS"
  if [[ "$STATUS" == "success" || "$STATUS" == "failed" || "$STATUS" == "timeout" ]]; then
    break
  fi
  sleep 10
done

# 3. Get artifacts
curl -s https://api.outpost.dev/artifacts/$DISPATCH_ID \
  -H "Authorization: Bearer $OUTPOST_API_KEY" | jq .
```

### Monitoring Dashboard Checks

| Dashboard | URL | Key Metrics |
|-----------|-----|-------------|
| ECS Service | AWS Console > ECS > outpost-dev | runningCount, CPU, Memory |
| CloudWatch Logs | `/outpost/control-plane` | Error rate, latency |
| ALB Metrics | AWS Console > EC2 > Load Balancers | HealthyHostCount, RequestCount |
| DynamoDB | AWS Console > DynamoDB | ConsumedReadCapacity, ConsumedWriteCapacity |

**CloudWatch Alarm Checklist:**
- [ ] HighDispatchFailureRate: Not triggered
- [ ] PoolExhausted: Not triggered
- [ ] ControlPlaneUnhealthy: Not triggered
- [ ] ALBUnhealthyTargets: Not triggered

---

## Troubleshooting Guide

### Common Issues and Resolutions

#### Issue: Control plane not responding
**Symptoms:** `curl https://api.outpost.dev/health` times out or returns 502

**Resolution:**
1. Check ECS task status:
   ```bash
   aws ecs describe-services --cluster outpost-dev --services outpost-control-plane --profile soc --region us-east-1 | jq '.services[0].runningCount'
   ```
2. If `runningCount = 0`, check task failures:
   ```bash
   aws ecs describe-tasks --cluster outpost-dev --tasks $(aws ecs list-tasks --cluster outpost-dev --service-name outpost-control-plane --desired-status STOPPED --profile soc --region us-east-1 --query 'taskArns[0]' --output text) --profile soc --region us-east-1 | jq '.tasks[0].stoppedReason'
   ```
3. Check CloudWatch logs for errors:
   ```bash
   aws logs tail /outpost/control-plane --since 10m --profile soc --region us-east-1
   ```

#### Issue: Dispatch stuck in PENDING
**Symptoms:** Dispatch status remains `pending` for >60 seconds

**Resolution:**
1. Check pool availability:
   ```bash
   curl -s https://api.outpost.dev/health/fleet | jq '.data.pool'
   ```
2. If `warmTasks = 0`, pool may be exhausted. Check ECS capacity:
   ```bash
   aws ecs describe-cluster --cluster outpost-dev --profile soc --region us-east-1 | jq '.clusters[0].registeredContainerInstancesCount'
   ```
3. Review pool replenishment logs:
   ```bash
   aws logs filter-log-events --log-group-name /outpost/control-plane --filter-pattern "pool" --start-time $(date -d '5 minutes ago' +%s000) --profile soc --region us-east-1
   ```

#### Issue: Agent-specific failures
**Symptoms:** One agent type (e.g., `codex`) failing while others work

**Resolution:**
1. Check agent health:
   ```bash
   curl -s https://api.outpost.dev/health/fleet | jq '.data.agents[] | select(.agent == "codex")'
   ```
2. Verify ECR image exists:
   ```bash
   aws ecr describe-images --repository-name outpost-codex --profile soc --region us-east-1
   ```
3. Check agent-specific secrets:
   ```bash
   aws secretsmanager get-secret-value --secret-id /outpost/system/OPENAI_API_KEY --profile soc --region us-east-1 --query 'SecretString' > /dev/null && echo "Secret exists" || echo "Secret missing"
   ```

#### Issue: 401/403 Authentication errors
**Symptoms:** API returns authentication or authorization errors

**Resolution:**
1. Verify API key format: Should start with `op_live_` or `op_test_`
2. Check API key scopes match required endpoint scope
3. Verify key not expired or revoked
4. Test with curl directly:
   ```bash
   curl -v https://api.outpost.dev/dispatch \
     -H "Authorization: Bearer $OUTPOST_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"agent":"claude","task":"test"}'
   ```

#### Issue: S3 artifact retrieval fails
**Symptoms:** `outpost_get_artifacts` returns empty or error

**Resolution:**
1. Verify dispatch completed (not still running)
2. Check S3 bucket permissions:
   ```bash
   aws s3 ls s3://outpost-artifacts-311493921645/dispatches/$DISPATCH_ID/ --profile soc
   ```
3. Verify task role has S3 write permissions
4. Check CloudWatch logs for artifact upload errors

### Log Locations

| Component | Log Location | Access Command |
|-----------|--------------|----------------|
| Control Plane | CloudWatch `/outpost/control-plane` | `aws logs tail /outpost/control-plane --profile soc` |
| Agent Tasks | CloudWatch `/outpost/agents/{agent}` | `aws logs tail /outpost/agents/claude --profile soc` |
| ALB Access Logs | S3 `outpost-alb-logs/` | `aws s3 ls s3://outpost-alb-logs/ --profile soc` |
| MCPify | systemd journal | `journalctl -u mcpify -f` |

### Support Escalation

| Severity | Response Time | Escalation Path |
|----------|---------------|-----------------|
| P1 - Production Down | 15 minutes | PagerDuty -> On-call engineer |
| P2 - Degraded | 1 hour | Slack #outpost-alerts -> Team lead |
| P3 - Non-urgent | 24 hours | GitHub issue -> Sprint backlog |

**Escalation Contacts:**
- On-call: PagerDuty rotation
- Slack: #outpost-alerts
- GitHub: rgsuarez/outpost/issues

---

## Post-Migration Monitoring Checklist

Monitor for 24 hours after cutover:

| Metric | Target | Check Interval | Status |
|--------|--------|----------------|--------|
| API availability | 99.9% | Every 5 min | [ ] |
| Dispatch success rate | >95% | Hourly | [ ] |
| P95 latency | <500ms | Hourly | [ ] |
| Error rate | <5% | Hourly | [ ] |
| Pool hit rate | >80% | Hourly | [ ] |
| SSM dispatch count | 0 | Daily | [ ] |

---

## Appendix A: Quick Reference Commands

```bash
# === Infrastructure Status ===
# ECS cluster status
aws ecs describe-clusters --clusters outpost-dev --profile soc --region us-east-1 | jq '.clusters[0].status'

# Control plane running count
aws ecs describe-services --cluster outpost-dev --services outpost-control-plane --profile soc --region us-east-1 | jq '.services[0].runningCount'

# ALB health
aws elbv2 describe-target-health --target-group-arn $TG_ARN --profile soc --region us-east-1 | jq '.TargetHealthDescriptions[].TargetHealth.State'

# === Dispatch Operations ===
# Create dispatch
curl -X POST https://api.outpost.dev/dispatch -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"agent":"claude","task":"test"}'

# Check status
curl https://api.outpost.dev/dispatch/$DISPATCH_ID -H "Authorization: Bearer $API_KEY"

# Cancel dispatch
curl -X DELETE https://api.outpost.dev/dispatch/$DISPATCH_ID -H "Authorization: Bearer $API_KEY"

# === Health Checks ===
curl https://api.outpost.dev/health
curl https://api.outpost.dev/health/live
curl https://api.outpost.dev/health/ready
curl https://api.outpost.dev/health/fleet

# === Logs ===
aws logs tail /outpost/control-plane --since 10m --profile soc --region us-east-1
aws logs tail /outpost/agents/claude --since 10m --profile soc --region us-east-1
```

---

## Appendix B: SSM Instance Reference (Legacy)

For rollback purposes, retain these SSM configuration details:

| Property | Value |
|----------|-------|
| Instance ID | `mi-0bbd8fed3f0650ddb` |
| Server IP | `34.195.223.189` |
| AWS Profile | `soc` |
| Scripts Path | `/home/ubuntu/claude-executor/` |
| Dispatch Scripts | `dispatch.sh`, `dispatch-unified.sh`, `dispatch-aider.sh`, `dispatch-codex.sh`, `dispatch-gemini.sh`, `dispatch-grok.sh` |

**SSM Test Command:**
```bash
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["whoami"]' \
  --profile soc \
  --region us-east-1
```

---

*Migration Runbook v1.0 - Outpost SSM to ECS Fargate*
*Blueprint Task: T5.3*
*Generated: 2026-01-13*
