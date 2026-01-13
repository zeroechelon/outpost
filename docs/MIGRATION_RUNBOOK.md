# Production Migration Runbook: Outpost v1 to v2

> **Document Status**: Production
> **Last Updated**: 2026-01-13
> **Owner**: Richie Suarez
> **AWS Account**: 311493921645 (soc profile)

---

## Overview

This runbook documents the production migration from Outpost v1 (SSM-based on EC2) to Outpost v2 (ECS Fargate via ALB).

| Component | v1 (Legacy) | v2 (Target) |
|-----------|-------------|-------------|
| Compute | EC2 instance | ECS Fargate |
| Dispatch | SSM SendCommand | HTTP REST API |
| Endpoint | SSM Instance `mi-0bbd8fed3f0650ddb` | ALB `http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com` |
| Server IP | 34.195.223.189 | ALB managed |
| State | File-based + DynamoDB | DynamoDB (single source of truth) |
| Output | SSM command output | S3 (presigned URLs) |
| Isolation | Process-level | Container-level |

**Key Configuration:**
- **AWS Profile**: `soc`
- **Region**: `us-east-1`
- **Secret**: `outpost/api-endpoint` (ARN: `arn:aws:secretsmanager:us-east-1:311493921645:secret:outpost/api-endpoint-R8NXew`)
- **Documentation**: `/home/richie/projects/mcpify/docs/providers/outpost.md`

**Estimated Duration:** 2-4 hours (excluding 24-hour monitoring period)

---

## 1. Pre-Migration Checklist

Complete all items before starting migration.

### 1.1 Verify ECS Service Healthy

```bash
# Check ECS cluster status
aws ecs describe-clusters --clusters outpost-dev --profile soc --region us-east-1 \
  --query 'clusters[0].{Status:status,RunningTasks:runningTasksCount}'

# Check control plane service
aws ecs describe-services --cluster outpost-dev --services outpost-control-plane \
  --profile soc --region us-east-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

**Expected**: `status: ACTIVE`, `runningCount >= 1`

| Check | Status |
|-------|--------|
| ECS cluster ACTIVE | [ ] |
| Control plane service running | [ ] |
| Desired count matches running | [ ] |

### 1.2 Verify ALB Target Group Healthy

```bash
# Get ALB status
aws elbv2 describe-load-balancers --profile soc --region us-east-1 \
  --query 'LoadBalancers[?contains(DNSName, `outpost-control-plane`)].{DNS:DNSName,State:State.Code}'

# Get target group ARN
TG_ARN=$(aws elbv2 describe-target-groups --profile soc --region us-east-1 \
  --query 'TargetGroups[?contains(TargetGroupName, `outpost`)].TargetGroupArn' --output text)

# Check target health
aws elbv2 describe-target-health --target-group-arn $TG_ARN --profile soc --region us-east-1 \
  --query 'TargetHealthDescriptions[].TargetHealth.State'
```

**Expected**: `State.Code: active`, all targets `healthy`

| Check | Status |
|-------|--------|
| ALB state active | [ ] |
| Target group healthy | [ ] |
| Health check passing | [ ] |

### 1.3 Verify CloudTrail Logging

```bash
# Check CloudTrail is enabled and logging
aws cloudtrail describe-trails --profile soc --region us-east-1 \
  --query 'trailList[].{Name:Name,IsLogging:IsLogging,S3Bucket:S3BucketName}'

# Verify recent events are being captured
aws cloudtrail lookup-events --profile soc --region us-east-1 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --max-results 5 --query 'Events[].EventName'
```

| Check | Status |
|-------|--------|
| CloudTrail enabled | [ ] |
| Events being logged | [ ] |

### 1.4 Backup SSM Dispatch Scripts

```bash
# Create backup directory
mkdir -p ~/outpost-v1-backup/$(date +%Y%m%d)

# Backup dispatch scripts via SSM
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["tar -czvf /tmp/dispatch-scripts-backup.tar.gz /home/ubuntu/claude-executor/dispatch*.sh"]' \
  --profile soc \
  --region us-east-1

# Download backup (alternative: use S3 sync)
# Store locally for rollback capability
```

**Backup Inventory:**
| Script | Path | Backed Up |
|--------|------|-----------|
| dispatch.sh | /home/ubuntu/claude-executor/dispatch.sh | [ ] |
| dispatch-unified.sh | /home/ubuntu/claude-executor/dispatch-unified.sh | [ ] |
| dispatch-aider.sh | /home/ubuntu/claude-executor/dispatch-aider.sh | [ ] |
| dispatch-codex.sh | /home/ubuntu/claude-executor/dispatch-codex.sh | [ ] |
| dispatch-gemini.sh | /home/ubuntu/claude-executor/dispatch-gemini.sh | [ ] |
| dispatch-grok.sh | /home/ubuntu/claude-executor/dispatch-grok.sh | [ ] |

### 1.5 Notify Stakeholders

| Stakeholder | Notification Method | Notified |
|-------------|---------------------|----------|
| Platform Team | Slack #outpost-alerts | [ ] |
| On-call Engineer | PagerDuty maintenance window | [ ] |
| Dependent Services | Email/Slack | [ ] |

**Pre-Migration Checklist Complete:** [ ] All items verified

---

## 2. Migration Steps

### Step 1: Enable v2 Endpoint in Parallel with v1

**Duration:** 15 minutes

Both v1 (SSM) and v2 (ALB) endpoints remain active. No traffic cutover yet.

```bash
# Verify v2 endpoint is accessible
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health/live
# Expected: {"status":"ok"}

# Verify v1 SSM still operational
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["echo v1-alive"]' \
  --profile soc \
  --region us-east-1 \
  --query 'Command.CommandId' --output text
```

| Check | Status |
|-------|--------|
| v2 ALB responding | [ ] |
| v1 SSM operational | [ ] |
| Both endpoints coexisting | [ ] |

### Step 2: Route Test Traffic to v2

**Duration:** 15-20 minutes

Execute test dispatches against v2 endpoint only. v1 remains primary.

```bash
# Set v2 endpoint
export OUTPOST_V2_ENDPOINT="http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com"

# Test health endpoint
curl -s $OUTPOST_V2_ENDPOINT/health | jq .

# Test fleet status
curl -s $OUTPOST_V2_ENDPOINT/health/fleet | jq .

# Execute test dispatch via v2
TEST_DISPATCH=$(curl -s -X POST $OUTPOST_V2_ENDPOINT/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude",
    "task": "echo test-v2-migration && date",
    "timeoutSeconds": 120
  }')

echo "Test Dispatch Response: $TEST_DISPATCH"
TEST_RUN_ID=$(echo $TEST_DISPATCH | jq -r '.runId // .data.runId')
echo "Run ID: $TEST_RUN_ID"
```

| Test | Status |
|------|--------|
| Health endpoint OK | [ ] |
| Fleet status returned | [ ] |
| Test dispatch created | [ ] |
| Run ID generated | [ ] |

### Step 3: Validate Dispatch/Status/Cancel Flow

**Duration:** 20-30 minutes

Complete end-to-end validation of all MCP tools.

#### 3.1 Dispatch Validation

```bash
# Create validation dispatch
DISPATCH_RESPONSE=$(curl -s -X POST $OUTPOST_V2_ENDPOINT/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude",
    "task": "Create a file called validation-test.txt with contents: Migration validation successful",
    "repo": "rgsuarez/outpost",
    "branch": "main",
    "context": "minimal",
    "timeoutSeconds": 300
  }')

RUN_ID=$(echo $DISPATCH_RESPONSE | jq -r '.runId // .data.runId')
echo "Dispatch Run ID: $RUN_ID"
```

#### 3.2 Status Validation

```bash
# Poll for completion
while true; do
  STATUS_RESPONSE=$(curl -s $OUTPOST_V2_ENDPOINT/runs/$RUN_ID)
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status // .data.status')
  echo "$(date +%H:%M:%S) - Status: $STATUS"

  if [[ "$STATUS" == "COMPLETED" || "$STATUS" == "FAILED" || "$STATUS" == "TIMEOUT" || "$STATUS" == "CANCELLED" ]]; then
    echo "Final status: $STATUS"
    break
  fi
  sleep 10
done
```

#### 3.3 Cancel Validation

```bash
# Create a long-running task to cancel
CANCEL_TEST=$(curl -s -X POST $OUTPOST_V2_ENDPOINT/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude",
    "task": "Sleep for 5 minutes to test cancellation",
    "timeoutSeconds": 600
  }')

CANCEL_RUN_ID=$(echo $CANCEL_TEST | jq -r '.runId // .data.runId')
echo "Cancel test Run ID: $CANCEL_RUN_ID"

# Wait 10 seconds then cancel
sleep 10
CANCEL_RESPONSE=$(curl -s -X POST $OUTPOST_V2_ENDPOINT/runs/$CANCEL_RUN_ID/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "Migration validation test"}')

echo "Cancel Response: $CANCEL_RESPONSE"
```

| Validation | Status |
|------------|--------|
| Dispatch creates run | [ ] |
| Status returns correctly | [ ] |
| Task completes/fails appropriately | [ ] |
| Cancel terminates run | [ ] |

### Step 4: Update MCPify Provider Configuration

**Duration:** 10-15 minutes

Update MCPify to use v2 HTTP provider.

```bash
# Update Secrets Manager with new endpoint
aws secretsmanager put-secret-value \
  --secret-id outpost/api-endpoint \
  --secret-string '{"endpoint":"http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com","provider":"http","version":"2.0.0"}' \
  --profile soc \
  --region us-east-1

# Verify secret updated
aws secretsmanager get-secret-value \
  --secret-id outpost/api-endpoint \
  --profile soc \
  --region us-east-1 \
  --query 'SecretString' --output text | jq .
```

**MCPify Configuration Update:**

```yaml
# mcpify.yaml provider configuration
providers:
  - name: outpost
    enabled: true
    config:
      outpostEndpoint: http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com
      awsRegion: us-east-1
      awsProfile: soc
      # Legacy SSM config (commented for rollback)
      # provider: ssm
      # instanceId: mi-0bbd8fed3f0650ddb
```

| Update | Status |
|--------|--------|
| Secret updated | [ ] |
| MCPify config updated | [ ] |
| Provider restart planned | [ ] |

### Step 5: Switch Production Traffic to v2

**Duration:** 10 minutes

**POINT OF NO RETURN** - After this step, all traffic routes through v2.

```bash
# Restart MCPify to pick up new configuration
# (Method depends on deployment: systemd, Docker, etc.)

# If systemd:
sudo systemctl restart mcpify

# If Docker:
docker-compose restart mcpify

# Verify MCPify is using v2
journalctl -u mcpify --since "1 minute ago" | grep -i "outpost\|endpoint"

# Execute live dispatch through MCPify
mcp call outpost:health
# Expected: Response from v2 control plane
```

| Cutover | Status |
|---------|--------|
| MCPify restarted | [ ] |
| v2 endpoint active | [ ] |
| Health check passing | [ ] |

### Step 6: Monitor for 24 Hours

**Duration:** 24 hours

Continuous monitoring post-cutover.

```bash
# Set up monitoring loop (run in background)
while true; do
  TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)
  HEALTH=$(curl -s $OUTPOST_V2_ENDPOINT/health | jq -r '.status // "UNKNOWN"')
  FLEET=$(curl -s $OUTPOST_V2_ENDPOINT/health/fleet | jq -r '.healthy // false')
  echo "$TIMESTAMP | Health: $HEALTH | Fleet Healthy: $FLEET" >> ~/outpost-migration-monitor.log
  sleep 300  # Check every 5 minutes
done &
```

**24-Hour Monitoring Checklist:**

| Metric | Target | Hour 1 | Hour 6 | Hour 12 | Hour 24 |
|--------|--------|--------|--------|---------|---------|
| API Availability | 99.9% | [ ] | [ ] | [ ] | [ ] |
| Dispatch Success Rate | >95% | [ ] | [ ] | [ ] | [ ] |
| P95 Latency | <500ms | [ ] | [ ] | [ ] | [ ] |
| Error Rate | <5% | [ ] | [ ] | [ ] | [ ] |
| SSM Dispatch Count | 0 | [ ] | [ ] | [ ] | [ ] |

---

## 3. Validation Commands

### Health Check Commands

```bash
# Basic health check
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health | jq .

# Liveness probe
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health/live

# Readiness probe
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health/ready

# Fleet status (all agents)
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/health/fleet | jq .
```

### Dispatch Test Commands

```bash
# Dispatch to Claude
curl -s -X POST http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/dispatch \
  -H "Content-Type: application/json" \
  -d '{"agent":"claude","task":"echo Hello from v2","timeoutSeconds":120}' | jq .

# Dispatch to Codex
curl -s -X POST http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/dispatch \
  -H "Content-Type: application/json" \
  -d '{"agent":"codex","task":"print Hello from v2","timeoutSeconds":120}' | jq .

# Get run status
curl -s http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/runs/{RUN_ID} | jq .

# List recent runs
curl -s "http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/runs?limit=10" | jq .
```

### Log Verification Commands

```bash
# Control plane logs
aws logs tail /outpost/control-plane --since 10m --profile soc --region us-east-1

# Agent-specific logs
aws logs tail /outpost/agents/claude --since 10m --profile soc --region us-east-1

# ALB access logs (if configured)
aws s3 ls s3://outpost-alb-logs/ --profile soc --recursive | tail -10

# Check for errors in logs
aws logs filter-log-events \
  --log-group-name /outpost/control-plane \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s000) \
  --profile soc --region us-east-1 \
  --query 'events[].message'

# Verify no SSM commands being issued (should be empty)
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=SendCommand \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --profile soc --region us-east-1 \
  --query 'Events[*].{Time:EventTime,User:Username}'
```

---

## 4. Rollback Procedure

### 4.1 When to Rollback (Criteria)

Initiate rollback if ANY of the following occur:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| API availability drops | <95% for 15 minutes | Rollback Level 1 |
| Dispatch success rate drops | <80% for 30 minutes | Rollback Level 1 |
| Control plane unresponsive | >5 minutes | Rollback Level 1 |
| Data loss detected | Any confirmed loss | Rollback Level 2 |
| Security incident | Any confirmed breach | Rollback Level 2 + Incident Response |

### 4.2 Rollback Steps (Revert to SSM)

#### Level 1: MCPify Provider Rollback (5 minutes)

```bash
# Revert secret to v1 SSM configuration
aws secretsmanager put-secret-value \
  --secret-id outpost/api-endpoint \
  --secret-string '{"provider":"ssm","instanceId":"mi-0bbd8fed3f0650ddb","awsProfile":"soc","awsRegion":"us-east-1","version":"1.0.0"}' \
  --profile soc \
  --region us-east-1

# Restart MCPify to reload configuration
sudo systemctl restart mcpify
# OR
docker-compose restart mcpify

# Verify SSM connectivity
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["echo rollback-verification"]' \
  --profile soc \
  --region us-east-1 \
  --query 'Command.{CommandId:CommandId,Status:Status}'
```

#### Level 2: Full Infrastructure Rollback (15-30 minutes)

```bash
# Scale down v2 control plane
aws ecs update-service \
  --cluster outpost-dev \
  --service outpost-control-plane \
  --desired-count 0 \
  --profile soc \
  --region us-east-1

# Verify v1 EC2 instance is running
aws ec2 describe-instances \
  --filters "Name=ip-address,Values=34.195.223.189" \
  --profile soc \
  --region us-east-1 \
  --query 'Reservations[].Instances[].{State:State.Name,InstanceId:InstanceId}'

# Verify SSM agent healthy
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=mi-0bbd8fed3f0650ddb" \
  --profile soc \
  --region us-east-1 \
  --query 'InstanceInformationList[].{PingStatus:PingStatus,AgentVersion:AgentVersion}'

# Test full v1 dispatch
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["/home/ubuntu/claude-executor/dispatch.sh --agent claude --task \"echo rollback-test\""]' \
  --profile soc \
  --region us-east-1
```

### 4.3 Post-Rollback Verification

```bash
# Verify v1 SSM dispatches working
aws ssm list-commands \
  --instance-id mi-0bbd8fed3f0650ddb \
  --max-results 5 \
  --profile soc \
  --region us-east-1 \
  --query 'Commands[].{CommandId:CommandId,Status:Status,RequestedTime:RequestedDateTime}'

# Verify MCPify routing to SSM
mcp call outpost:health
# Should return SSM-based response

# Monitor for 1 hour post-rollback
# Ensure dispatch success rate returns to baseline
```

| Verification | Status |
|--------------|--------|
| SSM commands executing | [ ] |
| MCPify using v1 provider | [ ] |
| Dispatch success rate stable | [ ] |
| No v2 traffic detected | [ ] |

---

## 5. Post-Migration Tasks

Complete these tasks after 24-hour monitoring period confirms stability.

### 5.1 Archive SSM Scripts

```bash
# Create permanent archive in S3
aws s3 cp ~/outpost-v1-backup/ s3://outpost-artifacts-311493921645/archives/v1-ssm-backup/ \
  --recursive \
  --profile soc

# Tag archive with metadata
aws s3api put-object-tagging \
  --bucket outpost-artifacts-311493921645 \
  --key archives/v1-ssm-backup/ \
  --tagging 'TagSet=[{Key=migration-date,Value=2026-01-13},{Key=purpose,Value=rollback-archive}]' \
  --profile soc
```

| Archive Item | S3 Location | Archived |
|--------------|-------------|----------|
| dispatch.sh | s3://outpost-artifacts-311493921645/archives/v1-ssm-backup/ | [ ] |
| dispatch-*.sh | s3://outpost-artifacts-311493921645/archives/v1-ssm-backup/ | [ ] |
| Configuration files | s3://outpost-artifacts-311493921645/archives/v1-ssm-backup/ | [ ] |

### 5.2 Update zeOS CLAUDE.md

Update the global CLAUDE.md with v2 configuration:

**File:** `~/.claude/CLAUDE.md`

**Changes Required:**
```markdown
## Outpost Fleet (v2.0)
**API Endpoint:** http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com
**AWS Profile:** soc
**Region:** us-east-1
- Claude Code: claude-opus-4-5-20251101
- OpenAI Codex: gpt-5.2-codex
- Gemini CLI: gemini-3-pro-preview
- Aider: deepseek/deepseek-coder
- Grok: grok-4.1

**Legacy SSM (Archived):**
- SSM Instance: mi-0bbd8fed3f0650ddb (DECOMMISSIONED)
- Server IP: 34.195.223.189 (DECOMMISSIONED)
```

| Update | Status |
|--------|--------|
| Outpost Fleet section updated | [ ] |
| SSM references marked archived | [ ] |
| New endpoint documented | [ ] |

### 5.3 Update Documentation

| Document | Location | Updated |
|----------|----------|---------|
| OUTPOST_SOUL.md | ~/projects/zeOS/apps/outpost/ | [ ] |
| MCPify Provider Docs | ~/projects/mcpify/docs/providers/outpost.md | [ ] |
| API Reference | ~/projects/outpost/docs/API.md | [ ] |
| Architecture Docs | ~/projects/outpost/docs/ARCHITECTURE.md | [ ] |

### 5.4 Decommission EC2 Instance (After Stabilization)

**WARNING:** Only proceed after 7+ days of stable v2 operation.

```bash
# Step 1: Stop SSM agent (prevents new commands)
aws ssm send-command \
  --instance-ids mi-0bbd8fed3f0650ddb \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo systemctl stop amazon-ssm-agent"]' \
  --profile soc \
  --region us-east-1

# Step 2: Create final AMI backup
aws ec2 create-image \
  --instance-id <INSTANCE_ID> \
  --name "outpost-v1-final-backup-$(date +%Y%m%d)" \
  --description "Final backup before v1 decommission" \
  --profile soc \
  --region us-east-1

# Step 3: Stop instance (retain for 30 days)
aws ec2 stop-instances \
  --instance-ids <INSTANCE_ID> \
  --profile soc \
  --region us-east-1

# Step 4: After 30 days - terminate instance
# aws ec2 terminate-instances --instance-ids <INSTANCE_ID> --profile soc --region us-east-1
```

| Decommission Step | Date | Status |
|-------------------|------|--------|
| SSM agent stopped | | [ ] |
| AMI backup created | | [ ] |
| Instance stopped | | [ ] |
| Instance terminated | | [ ] |

---

## 6. Contacts and Escalation

### Primary Contact

| Role | Name | Contact |
|------|------|---------|
| Owner | Richie Suarez | Primary contact for all migration decisions |
| AWS Account | 311493921645 | soc profile |

### Escalation Matrix

| Severity | Response Time | Escalation Path |
|----------|---------------|-----------------|
| P1 - Production Down | 15 minutes | Immediate rollback, then RCA |
| P2 - Degraded Service | 1 hour | Investigate, consider rollback |
| P3 - Non-urgent Issue | 24 hours | Document and schedule fix |

### Key Resources

| Resource | Reference |
|----------|-----------|
| v1 SSM Instance | mi-0bbd8fed3f0650ddb |
| v1 Server IP | 34.195.223.189 |
| v2 ALB Endpoint | http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com |
| API Secret ARN | arn:aws:secretsmanager:us-east-1:311493921645:secret:outpost/api-endpoint-R8NXew |
| Provider Documentation | /home/richie/projects/mcpify/docs/providers/outpost.md |
| Outpost Repository | https://github.com/rgsuarez/outpost |

### Quick Reference

```bash
# AWS Profile
export AWS_PROFILE=soc
export AWS_REGION=us-east-1

# v2 Endpoint
export OUTPOST_V2_ENDPOINT="http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com"

# v1 SSM (rollback only)
export SSM_INSTANCE_ID="mi-0bbd8fed3f0650ddb"
```

---

*Migration Runbook v2.0 - Outpost v1 (SSM) to v2 (ECS Fargate)*
*Last Updated: 2026-01-13*
*Owner: Richie Suarez*
