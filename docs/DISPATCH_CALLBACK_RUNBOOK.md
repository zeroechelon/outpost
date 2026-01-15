# Dispatch Callback Monitoring Runbook

> **Document Status**: Production
> **Last Updated**: 2026-01-15
> **Owner**: Platform Team
> **AWS Account**: 311493921645 (soc profile)

---

## 1. System Overview

### Purpose

The Dispatch Callback system processes ECS task completion events and updates dispatch status in DynamoDB. This ensures that when an Outpost worker task completes (successfully or not), the corresponding dispatch record is updated with the final status, exit code, and error details.

### Event Flow

```
ECS Task Stops (STOPPED status)
         |
         v
+-------------------+
|   EventBridge     |  Rule: outpost-dispatch-completion
|   (Event Router)  |  Pattern: source=aws.ecs, detail-type=ECS Task State Change
+--------+----------+
         |
         v
+-------------------+
|      Lambda       |  Function: outpost-dispatch-callback
| (Status Updater)  |  Runtime: Node.js 20.x
+--------+----------+
         |
         v
+-------------------+
|    DynamoDB       |  Table: outpost-dispatches
|  (Status Store)   |  GSI: task_arn-index (for lookup)
+-------------------+
```

### Components

| Component | Resource Name | Purpose |
|-----------|---------------|---------|
| EventBridge Rule | `outpost-dispatch-completion` | Captures ECS task state changes (STOPPED) |
| Lambda Function | `outpost-dispatch-callback` | Maps ECS status to dispatch status, updates DynamoDB |
| DynamoDB Table | `outpost-dispatches` | Stores dispatch records with status |
| CloudWatch Log Group | `/aws/lambda/outpost-dispatch-callback` | Lambda execution logs |

### Status Mapping Logic

The Lambda maps ECS task states to dispatch statuses:

| Condition | Dispatch Status |
|-----------|-----------------|
| Exit code 0 | `COMPLETED` |
| Exit code non-zero | `FAILED` |
| stoppedReason contains 'timeout' | `TIMEOUT` |
| stopCode = 'UserInitiated' | `CANCELLED` |
| stopCode = 'TaskFailedToStart' | `FAILED` |
| Default for STOPPED tasks | `FAILED` |

---

## 2. Key Metrics

### Lambda Metrics (CloudWatch Namespace: AWS/Lambda)

| Metric | Description | Normal Range |
|--------|-------------|--------------|
| `Invocations` | Number of times Lambda is invoked | Matches ECS task completions |
| `Errors` | Failed Lambda executions | 0 |
| `Duration` (p50) | Median execution time | <100ms |
| `Duration` (p95) | 95th percentile execution time | <500ms |
| `Duration` (p99) | 99th percentile execution time | <1000ms |
| `ConcurrentExecutions` | Concurrent Lambda invocations | <10 |
| `Throttles` | Invocations throttled | 0 |

### Custom Metrics (CloudWatch Namespace: Outpost/Callbacks)

| Metric | Description | Unit |
|--------|-------------|------|
| `CallbackLatencyMs` | Time from ECS task stop to DynamoDB update | Milliseconds |
| `DispatchUpdatesSuccessful` | Successful status updates | Count |
| `DispatchUpdatesSkipped` | Updates skipped (no dispatch ID, already terminal) | Count |
| `DispatchUpdatesFailed` | Failed status updates | Count |

### DynamoDB Metrics (CloudWatch Namespace: AWS/DynamoDB)

| Metric | Description | Normal Range |
|--------|-------------|--------------|
| `ConsumedWriteCapacityUnits` | Write units consumed | Variable, PAY_PER_REQUEST |
| `WriteThrottledRequests` | Throttled write requests | 0 |
| `SuccessfulRequestLatency` | DynamoDB request latency | <20ms |

---

## 3. Alarms

### Alarm: outpost-dispatch-callback-errors

**Purpose:** Alert when Lambda errors occur

**Configuration:**
```yaml
AlarmName: outpost-dispatch-callback-errors
Namespace: AWS/Lambda
MetricName: Errors
Dimensions:
  - Name: FunctionName
    Value: outpost-dispatch-callback
Statistic: Sum
Period: 300  # 5 minutes
EvaluationPeriods: 1
Threshold: 0
ComparisonOperator: GreaterThanThreshold
TreatMissingData: notBreaching
```

**Response Actions:**
1. Check Lambda logs for error details
2. Identify if DynamoDB throttling or permission issues
3. Review recent ECS task events for malformed data
4. Escalate if errors persist beyond 15 minutes

---

### Alarm: outpost-dispatch-callback-duration

**Purpose:** Alert when Lambda execution time exceeds threshold

**Configuration:**
```yaml
AlarmName: outpost-dispatch-callback-duration
Namespace: AWS/Lambda
MetricName: Duration
Dimensions:
  - Name: FunctionName
    Value: outpost-dispatch-callback
ExtendedStatistic: p95
Period: 300  # 5 minutes
EvaluationPeriods: 2
Threshold: 500  # milliseconds
ComparisonOperator: GreaterThanThreshold
TreatMissingData: notBreaching
```

**Response Actions:**
1. Check DynamoDB consumed capacity and throttling
2. Verify GSI usage (task_arn-index should be used, not table scan)
3. Review Lambda memory allocation
4. Check for cold starts affecting latency

---

### Alarm: outpost-dispatch-callback-throttles

**Purpose:** Alert when Lambda invocations are throttled

**Configuration:**
```yaml
AlarmName: outpost-dispatch-callback-throttles
Namespace: AWS/Lambda
MetricName: Throttles
Dimensions:
  - Name: FunctionName
    Value: outpost-dispatch-callback
Statistic: Sum
Period: 60  # 1 minute
EvaluationPeriods: 1
Threshold: 0
ComparisonOperator: GreaterThanThreshold
TreatMissingData: notBreaching
```

**Response Actions:**
1. Check concurrent executions limit
2. Request Lambda concurrency limit increase if needed
3. Review if burst of ECS task completions occurred

---

## 4. Troubleshooting Guide

### Issue: Dispatch Stuck in RUNNING Status

**Symptoms:**
- Dispatch status remains `RUNNING` after ECS task has stopped
- User polling for status never sees completion

**Diagnosis Steps:**

#### Step 1: Verify ECS Task Actually Stopped

```bash
# Get dispatch details from DynamoDB
aws dynamodb get-item \
  --table-name outpost-dispatches \
  --key '{"dispatchId":{"S":"DISPATCH_ID"}}' \
  --profile soc \
  --query 'Item.{dispatchId:dispatchId.S,status:status.S,taskArn:taskArn.S}'

# Check ECS task status using task ARN from above
aws ecs describe-tasks \
  --cluster outpost-dev \
  --tasks "TASK_ARN" \
  --profile soc \
  --query 'tasks[0].{lastStatus:lastStatus,desiredStatus:desiredStatus,stopCode:stopCode,stoppedReason:stoppedReason}'
```

**If task is still RUNNING:** Wait for task to complete. Issue is with task, not callback.

**If task is STOPPED:** Continue to Step 2.

#### Step 2: Check EventBridge Rule Status

```bash
# Verify rule is enabled
aws events describe-rule \
  --name outpost-dispatch-completion \
  --profile soc \
  --query '{State:State,EventPattern:EventPattern}'
```

**Expected:** `State: ENABLED`

**If DISABLED:** Enable the rule:
```bash
aws events enable-rule \
  --name outpost-dispatch-completion \
  --profile soc
```

#### Step 3: Check Lambda Logs for Errors

```bash
# Get recent Lambda invocations
aws logs filter-log-events \
  --log-group-name /aws/lambda/outpost-dispatch-callback \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "DISPATCH_ID" \
  --profile soc

# Check for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/outpost-dispatch-callback \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR" \
  --profile soc
```

#### Step 4: Manual Status Update (Last Resort)

If all else fails, manually update the dispatch status:

```bash
aws dynamodb update-item \
  --table-name outpost-dispatches \
  --key '{"dispatchId":{"S":"DISPATCH_ID"}}' \
  --update-expression "SET #s = :status, endedAt = :ended" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":status":{"S":"FAILED"},":ended":{"S":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}' \
  --profile soc
```

---

### Issue: Lambda Errors

**Common Error Causes:**

| Error | Cause | Solution |
|-------|-------|----------|
| `AccessDeniedException` | DynamoDB permissions | Verify Lambda role has UpdateItem permission |
| `ProvisionedThroughputExceededException` | DynamoDB throttling | Wait for backoff; check table capacity |
| `ValidationException: Missing task_arn` | Event missing required field | Check ECS task configuration includes dispatch ID |
| `ConditionalCheckFailedException` | Dispatch already in terminal state | Normal operation; dispatch was already completed |
| `ResourceNotFoundException` | Dispatch ID not found in DynamoDB | Task may have been cancelled before record created |

**Diagnosis:**

```bash
# Get detailed Lambda errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/outpost-dispatch-callback \
  --start-time $(date -u -d '30 minutes ago' +%s)000 \
  --filter-pattern "?ERROR ?Exception ?Error" \
  --profile soc \
  --query 'events[].message'
```

**Permission Check:**

```bash
# Get Lambda execution role
ROLE_NAME=$(aws lambda get-function \
  --function-name outpost-dispatch-callback \
  --profile soc \
  --query 'Configuration.Role' \
  --output text | sed 's/.*\///')

# List attached policies
aws iam list-role-policies \
  --role-name "$ROLE_NAME" \
  --profile soc

aws iam list-attached-role-policies \
  --role-name "$ROLE_NAME" \
  --profile soc
```

---

### Issue: High Latency

**Symptoms:**
- Lambda duration p95 exceeds 500ms
- Status updates delayed

**Diagnosis:**

#### Check DynamoDB Capacity

```bash
# Check consumed capacity (last hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedWriteCapacityUnits \
  --dimensions Name=TableName,Value=outpost-dispatches \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum \
  --profile soc

# Check for throttling
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name WriteThrottledRequests \
  --dimensions Name=TableName,Value=outpost-dispatches \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum \
  --profile soc
```

#### Verify GSI Usage

The Lambda should use the `task_arn-index` GSI when looking up dispatches by task ARN. A table scan would be slow.

Check Lambda logs for query patterns:
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/outpost-dispatch-callback \
  --start-time $(date -u -d '30 minutes ago' +%s)000 \
  --filter-pattern "querying by task ARN" \
  --profile soc
```

#### Check Lambda Cold Starts

```bash
# Look for INIT_START in logs (indicates cold start)
aws logs filter-log-events \
  --log-group-name /aws/lambda/outpost-dispatch-callback \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "INIT_START" \
  --profile soc \
  --query 'events | length(@)'
```

High cold start count may indicate Lambda needs provisioned concurrency.

---

### Issue: Missing Dispatch ID in Task

**Symptoms:**
- Lambda logs show "No dispatch ID found in task"
- Status never updates despite task completing

**Root Cause:** ECS task was launched without proper dispatch ID metadata.

**Where Dispatch ID Should Be Set:**

1. **Container Environment Override:**
   ```json
   {
     "containerOverrides": [{
       "name": "worker",
       "environment": [
         {"name": "DISPATCH_ID", "value": "uuid-here"}
       ]
     }]
   }
   ```

2. **Task Group:** `dispatch:uuid-here`

3. **Task Tags:**
   ```json
   {"tags": [{"key": "dispatch_id", "value": "uuid-here"}]}
   ```

**Fix:** Ensure the control plane dispatcher sets DISPATCH_ID when launching ECS tasks.

---

## 5. Useful AWS CLI Commands

All commands use `--profile soc` for the Outpost AWS account.

### Lambda Operations

```bash
# List recent Lambda invocations
aws logs filter-log-events \
  --log-group-name /aws/lambda/outpost-dispatch-callback \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --profile soc \
  --query 'events[].{time:timestamp,message:message}' | head -50

# Get Lambda function configuration
aws lambda get-function \
  --function-name outpost-dispatch-callback \
  --profile soc \
  --query 'Configuration.{Runtime:Runtime,Memory:MemorySize,Timeout:Timeout,LastModified:LastModified}'

# Get Lambda metrics (last 15 minutes)
aws cloudwatch get-metric-data \
  --metric-data-queries '[
    {"Id":"invocations","MetricStat":{"Metric":{"Namespace":"AWS/Lambda","MetricName":"Invocations","Dimensions":[{"Name":"FunctionName","Value":"outpost-dispatch-callback"}]},"Period":60,"Stat":"Sum"}},
    {"Id":"errors","MetricStat":{"Metric":{"Namespace":"AWS/Lambda","MetricName":"Errors","Dimensions":[{"Name":"FunctionName","Value":"outpost-dispatch-callback"}]},"Period":60,"Stat":"Sum"}},
    {"Id":"duration","MetricStat":{"Metric":{"Namespace":"AWS/Lambda","MetricName":"Duration","Dimensions":[{"Name":"FunctionName","Value":"outpost-dispatch-callback"}]},"Period":60,"Stat":"Average"}}
  ]' \
  --start-time $(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --profile soc

# Tail Lambda logs in real-time
aws logs tail /aws/lambda/outpost-dispatch-callback \
  --follow \
  --profile soc
```

### EventBridge Operations

```bash
# Check EventBridge rule status
aws events describe-rule \
  --name outpost-dispatch-completion \
  --profile soc

# List rule targets
aws events list-targets-by-rule \
  --rule outpost-dispatch-completion \
  --profile soc

# Enable rule (if disabled)
aws events enable-rule \
  --name outpost-dispatch-completion \
  --profile soc

# Disable rule (for maintenance)
aws events disable-rule \
  --name outpost-dispatch-completion \
  --profile soc
```

### DynamoDB Operations

```bash
# Query dispatch by ID
aws dynamodb get-item \
  --table-name outpost-dispatches \
  --key '{"dispatchId":{"S":"DISPATCH_ID_HERE"}}' \
  --profile soc

# Query dispatches by status (using GSI)
aws dynamodb query \
  --table-name outpost-dispatches \
  --index-name status-createdAt-index \
  --key-condition-expression "#s = :status" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":status":{"S":"RUNNING"}}' \
  --limit 10 \
  --profile soc

# Scan for stuck RUNNING dispatches (older than 1 hour)
aws dynamodb scan \
  --table-name outpost-dispatches \
  --filter-expression "#s = :status AND createdAt < :time" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":status":{"S":"RUNNING"},":time":{"S":"'"$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"'"}}' \
  --profile soc \
  --query 'Items[].{dispatchId:dispatchId.S,createdAt:createdAt.S,taskArn:taskArn.S}'

# Get table metrics
aws dynamodb describe-table \
  --table-name outpost-dispatches \
  --profile soc \
  --query 'Table.{ItemCount:ItemCount,TableSizeBytes:TableSizeBytes,GlobalSecondaryIndexes:GlobalSecondaryIndexes[*].IndexName}'
```

### ECS Task Operations

```bash
# List recent stopped tasks in cluster
aws ecs list-tasks \
  --cluster outpost-dev \
  --desired-status STOPPED \
  --profile soc

# Describe specific task
aws ecs describe-tasks \
  --cluster outpost-dev \
  --tasks "TASK_ARN_HERE" \
  --profile soc \
  --query 'tasks[0].{taskArn:taskArn,lastStatus:lastStatus,stopCode:stopCode,stoppedReason:stoppedReason,startedAt:startedAt,stoppedAt:stoppedAt}'
```

---

## 6. Quick Reference Card

### Component ARNs

| Component | ARN |
|-----------|-----|
| Lambda Function | `arn:aws:lambda:us-east-1:311493921645:function:outpost-dispatch-callback` |
| EventBridge Rule | `arn:aws:events:us-east-1:311493921645:rule/outpost-dispatch-completion` |
| DynamoDB Table | `arn:aws:dynamodb:us-east-1:311493921645:table/outpost-dispatches` |
| Log Group | `/aws/lambda/outpost-dispatch-callback` |
| ECS Cluster | `arn:aws:ecs:us-east-1:311493921645:cluster/outpost-dev` |

### Key Configuration

| Setting | Value |
|---------|-------|
| Lambda Runtime | Node.js 20.x |
| Lambda Timeout | 30 seconds |
| Lambda Memory | 256 MB |
| DynamoDB Billing | PAY_PER_REQUEST |
| EventBridge Pattern | `source=aws.ecs, detail-type=ECS Task State Change, lastStatus=STOPPED` |

### Health Check Commands

```bash
# Quick health check (run all at once)
echo "=== EventBridge Rule ===" && \
aws events describe-rule --name outpost-dispatch-completion --profile soc --query 'State' && \
echo "=== Lambda Errors (last hour) ===" && \
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=outpost-dispatch-callback \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Sum \
  --profile soc \
  --query 'Datapoints[0].Sum' && \
echo "=== Lambda Invocations (last hour) ===" && \
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=outpost-dispatch-callback \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Sum \
  --profile soc \
  --query 'Datapoints[0].Sum'
```

---

## 7. Contacts and Escalation

| Role | Contact |
|------|---------|
| Owner | Richie Suarez |
| AWS Account | 311493921645 (soc profile) |

### Escalation Path

| Severity | Response Time | Action |
|----------|---------------|--------|
| P1 - Callback system down | 15 minutes | Check Lambda, EventBridge; enable rule if disabled |
| P2 - Degraded performance | 1 hour | Review metrics, check DynamoDB capacity |
| P3 - Intermittent issues | 24 hours | Analyze logs, identify patterns |

---

*Dispatch Callback Monitoring Runbook v1.0*
*Last Updated: 2026-01-15*
*Owner: Platform Team*
