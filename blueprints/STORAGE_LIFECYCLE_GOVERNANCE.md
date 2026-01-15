# Blueprint: Outpost Storage Lifecycle Governance

**Version:** 1.0.0
**Status:** DRAFT
**Created:** 2026-01-14
**Author:** Claude Code (Session 016)
**Project:** Outpost v2.0

---

## Executive Summary

Implement self-sustaining storage lifecycle management across all Outpost v2.0 infrastructure components to prevent unbounded cost accumulation while preserving customer flexibility (ephemeral vs persistent workspaces). All data expires at 30 days unless explicitly retained.

**Cost Impact:** Estimated $50-100/month savings at current scale, scaling linearly with usage.

---

## Problem Statement

### Current State Gaps

| Component | Issue | Risk Level |
|-----------|-------|------------|
| S3 (outpost-outputs) | No lifecycle policy | HIGH - 1,390 objects accumulating |
| S3 (terraform-state) | No version expiration | MEDIUM - Unbounded versions |
| CloudWatch (Container Insights) | 1-day retention | LOW - Operational data loss |
| ECR (control-plane) | No lifecycle policy | HIGH - 57 orphaned images |
| ECR (base) | No lifecycle policy | LOW - 4 images |
| EFS (persistent workspaces) | No cleanup automation | CRITICAL - Unbounded growth |
| DynamoDB (workspace records) | No TTL enforcement | MEDIUM - Metadata orphans |

### Business Requirements

1. **Cost Optimization:** No storage accumulates indefinitely without customer value
2. **Customer Flexibility:** Support both ephemeral (default) and persistent workspace modes
3. **Self-Sustaining:** Zero manual maintenance required after deployment
4. **Audit Compliance:** 30-day minimum retention for operational data
5. **Graceful Degradation:** Archived data recoverable if needed (S3 Glacier)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STORAGE LIFECYCLE GOVERNANCE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │    S3       │    │ CloudWatch  │    │    ECR      │                 │
│  │  Lifecycle  │    │  Retention  │    │  Lifecycle  │                 │
│  │  Policies   │    │  Policies   │    │  Policies   │                 │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                 │
│         │                  │                  │                        │
│         ▼                  ▼                  ▼                        │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │                   Terraform IaC Layer                        │      │
│  │   (Declarative, GitOps, Single Source of Truth)              │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              EFS Workspace Cleanup System                    │      │
│  ├─────────────────────────────────────────────────────────────┤      │
│  │                                                               │      │
│  │  EventBridge ──▶ Lambda ──▶ DynamoDB TTL ──▶ EFS Cleanup    │      │
│  │  (Daily 3AM)     (Scan)     (30-day mark)    (Delete files) │      │
│  │                                                               │      │
│  │  DynamoDB Streams ──▶ Lambda ──▶ EFS Access Point Delete    │      │
│  │  (TTL trigger)       (Cleanup)   (On workspace expiry)      │      │
│  │                                                               │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │                   CloudWatch Alarms                          │      │
│  │   (Storage growth anomalies, cleanup failures)               │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Task Breakdown

### Phase 1: S3 Lifecycle Policies (Terraform)
**Priority:** HIGH
**Effort:** 2 hours
**Dependencies:** None

#### Task 1.1: outpost-outputs Lifecycle Policy
```hcl
resource "aws_s3_bucket_lifecycle_configuration" "outputs" {
  bucket = aws_s3_bucket.outputs.id

  rule {
    id     = "output-lifecycle"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 180
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Terraform plan shows lifecycle policy creation
- [ ] Objects transition to IA after 30 days
- [ ] Objects transition to Glacier after 90 days
- [ ] Objects expire after 180 days
- [ ] Existing 1,390 objects begin lifecycle management

#### Task 1.2: terraform-state Version Expiration
```hcl
resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = "outpost-terraform-state"

  rule {
    id     = "state-version-cleanup"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Noncurrent state versions expire after 30 days
- [ ] Current state version retained indefinitely
- [ ] No disruption to Terraform operations

#### Task 1.3: Enable S3 Bucket Keys (Cost Optimization)
```hcl
resource "aws_s3_bucket_server_side_encryption_configuration" "outputs" {
  bucket = aws_s3_bucket.outputs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}
```

**Acceptance Criteria:**
- [ ] BucketKeyEnabled = true on outpost-outputs
- [ ] BucketKeyEnabled = true on outpost-terraform-state
- [ ] Reduced per-request encryption costs

---

### Phase 2: CloudWatch Log Retention (Terraform)
**Priority:** MEDIUM
**Effort:** 30 minutes
**Dependencies:** None

#### Task 2.1: Container Insights Retention
```hcl
resource "aws_cloudwatch_log_group" "container_insights" {
  name              = "/aws/ecs/containerinsights/outpost-dev/performance"
  retention_in_days = 30

  tags = {
    Environment = "dev"
    Project     = "outpost"
    ManagedBy   = "terraform"
  }
}
```

**Acceptance Criteria:**
- [ ] Container Insights retention changed from 1 day to 30 days
- [ ] All 9 Outpost log groups have 30-day retention
- [ ] No operational data loss for debugging

---

### Phase 3: ECR Lifecycle Policies (Terraform)
**Priority:** HIGH
**Effort:** 1 hour
**Dependencies:** None

#### Task 3.1: outpost-control-plane Lifecycle Policy
```hcl
resource "aws_ecr_lifecycle_policy" "control_plane" {
  repository = aws_ecr_repository.control_plane.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 tagged releases"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "release", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      }
    ]
  })
}
```

**Acceptance Criteria:**
- [ ] 55 orphaned images in control-plane cleaned within 7 days
- [ ] Latest 10 tagged images retained
- [ ] Matching policy applied to outpost-base
- [ ] All 7 ECR repositories have lifecycle policies

#### Task 3.2: Immediate Orphan Cleanup (One-time)
```bash
# Manual cleanup of 55 untagged images (run once)
aws ecr batch-delete-image \
  --repository-name outpost-control-plane \
  --image-ids "$(aws ecr list-images --repository-name outpost-control-plane \
    --filter tagStatus=UNTAGGED --query 'imageIds[*]' --output json)" \
  --profile soc
```

**Acceptance Criteria:**
- [ ] 55 orphaned images deleted immediately
- [ ] ECR storage costs reduced
- [ ] No impact to running services

---

### Phase 4: EFS Workspace Cleanup System (New Infrastructure)
**Priority:** CRITICAL
**Effort:** 8 hours
**Dependencies:** Phases 1-3 complete

#### Task 4.1: DynamoDB TTL Configuration
```hcl
resource "aws_dynamodb_table" "workspaces" {
  # ... existing configuration ...

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}
```

**Schema Update:**
```typescript
interface WorkspaceRecord {
  workspaceId: string;
  userId: string;
  efsAccessPointId: string;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: number;  // Unix timestamp, set to createdAt + 30 days
  sizeBytes: number;
  status: 'active' | 'archived' | 'deleted';
}
```

**Acceptance Criteria:**
- [ ] TTL attribute `expires_at` enabled on workspaces table
- [ ] New workspaces created with `expiresAt = now + 30 days`
- [ ] Activity extends `expiresAt` by 30 days from `lastAccessedAt`

#### Task 4.2: Workspace Cleanup Lambda
```typescript
// infrastructure/lambda/workspace-cleanup/handler.ts

import { DynamoDBStreamEvent } from 'aws-lambda';
import { EFSClient, DeleteAccessPointCommand } from '@aws-sdk/client-efs';

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const efs = new EFSClient({});

  for (const record of event.Records) {
    // Only process TTL deletions (REMOVE events with userIdentity.type = 'Service')
    if (record.eventName !== 'REMOVE') continue;
    if (record.userIdentity?.type !== 'Service') continue;

    const workspaceId = record.dynamodb?.Keys?.workspaceId?.S;
    const accessPointId = record.dynamodb?.OldImage?.efsAccessPointId?.S;

    if (accessPointId) {
      // Delete EFS access point
      await efs.send(new DeleteAccessPointCommand({
        AccessPointId: accessPointId
      }));

      // Note: EFS data at /users/{userId}/{workspaceId} remains
      // Orphaned data transitions to IA after 30 days (existing lifecycle)
      // Consider: Scheduled cleanup job for orphaned directories

      console.log(`Cleaned workspace ${workspaceId}, deleted access point ${accessPointId}`);
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Lambda triggered by DynamoDB Streams on TTL expiry
- [ ] EFS access points deleted when workspace expires
- [ ] CloudWatch logs capture cleanup actions
- [ ] Error handling for already-deleted access points

#### Task 4.3: Workspace Activity Heartbeat
```typescript
// Update lastAccessedAt on every dispatch to a persistent workspace
async function touchWorkspace(workspaceId: string): Promise<void> {
  const now = Date.now();
  const expiresAt = Math.floor((now + 30 * 24 * 60 * 60 * 1000) / 1000); // 30 days

  await dynamodb.update({
    TableName: 'outpost-workspaces',
    Key: { workspaceId },
    UpdateExpression: 'SET lastAccessedAt = :now, expiresAt = :expires',
    ExpressionAttributeValues: {
      ':now': new Date().toISOString(),
      ':expires': expiresAt
    }
  });
}
```

**Acceptance Criteria:**
- [ ] Every dispatch to persistent workspace extends TTL by 30 days
- [ ] Inactive workspaces expire naturally
- [ ] Active workspaces never expire while in use

#### Task 4.4: Orphaned EFS Data Cleanup (Scheduled)
```hcl
resource "aws_cloudwatch_event_rule" "efs_cleanup" {
  name                = "outpost-efs-orphan-cleanup"
  description         = "Weekly cleanup of orphaned EFS workspace directories"
  schedule_expression = "cron(0 4 ? * SUN *)"  # Every Sunday 4 AM UTC
}

resource "aws_cloudwatch_event_target" "efs_cleanup" {
  rule      = aws_cloudwatch_event_rule.efs_cleanup.name
  target_id = "efs-cleanup-lambda"
  arn       = aws_lambda_function.efs_orphan_cleanup.arn
}
```

**Lambda Logic:**
1. List all directories under `/workspaces/users/`
2. Cross-reference with DynamoDB workspace records
3. Delete directories with no matching active workspace record
4. Log deletions to CloudWatch

**Acceptance Criteria:**
- [ ] Weekly scheduled cleanup removes orphaned directories
- [ ] Only directories with no DynamoDB record are deleted
- [ ] Cleanup logs provide audit trail
- [ ] EFS storage costs minimized

---

### Phase 5: Monitoring & Alerting (Terraform)
**Priority:** MEDIUM
**Effort:** 2 hours
**Dependencies:** Phases 1-4 complete

#### Task 5.1: Storage Growth Alarms
```hcl
resource "aws_cloudwatch_metric_alarm" "s3_growth" {
  alarm_name          = "outpost-s3-outputs-growth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BucketSizeBytes"
  namespace           = "AWS/S3"
  period              = 86400  # Daily
  statistic           = "Average"
  threshold           = 1073741824  # 1 GB
  alarm_description   = "S3 outputs bucket exceeds 1 GB"

  dimensions = {
    BucketName  = "outpost-outputs"
    StorageType = "StandardStorage"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "efs_growth" {
  alarm_name          = "outpost-efs-workspaces-growth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "StorageBytes"
  namespace           = "AWS/EFS"
  period              = 86400
  statistic           = "Average"
  threshold           = 10737418240  # 10 GB
  alarm_description   = "EFS workspaces exceeds 10 GB"

  dimensions = {
    FileSystemId = "fs-02c98a4b49a4f8fb7"
    StorageClass = "Total"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}
```

**Acceptance Criteria:**
- [ ] Alarm triggers when S3 outputs exceeds 1 GB
- [ ] Alarm triggers when EFS exceeds 10 GB
- [ ] Alerts sent to SNS topic (email/Slack integration)
- [ ] Dashboard visualizes storage trends

#### Task 5.2: Cleanup Failure Alarms
```hcl
resource "aws_cloudwatch_metric_alarm" "cleanup_errors" {
  alarm_name          = "outpost-workspace-cleanup-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Workspace cleanup Lambda errors"

  dimensions = {
    FunctionName = aws_lambda_function.workspace_cleanup.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}
```

**Acceptance Criteria:**
- [ ] Any cleanup Lambda error triggers alert
- [ ] Operations team notified of cleanup failures
- [ ] Runbook documented for manual intervention

---

## Implementation Order

```
Week 1:
├── Phase 1: S3 Lifecycle Policies (Day 1-2)
├── Phase 2: CloudWatch Retention (Day 2)
└── Phase 3: ECR Lifecycle Policies (Day 2-3)

Week 2:
├── Phase 4.1: DynamoDB TTL (Day 1)
├── Phase 4.2: Cleanup Lambda (Day 1-2)
├── Phase 4.3: Activity Heartbeat (Day 2)
└── Phase 4.4: Orphan Cleanup Job (Day 3)

Week 3:
├── Phase 5: Monitoring & Alerting (Day 1-2)
└── Testing & Validation (Day 3-5)
```

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| S3 outputs size | 51 MB | < 100 MB steady state | CloudWatch BucketSizeBytes |
| ECR orphaned images | 57 | 0 | ECR list-images --filter untagged |
| EFS storage | 6 KB | < 10 GB | CloudWatch StorageBytes |
| Workspace TTL compliance | 0% | 100% | DynamoDB TTL scans |
| Cleanup Lambda errors | N/A | 0 | CloudWatch Errors metric |

---

## Rollback Plan

1. **S3 Lifecycle:** Delete lifecycle configuration (objects stop transitioning)
2. **CloudWatch Retention:** Set retention to null (infinite)
3. **ECR Lifecycle:** Delete lifecycle policy (images stop expiring)
4. **DynamoDB TTL:** Disable TTL attribute (workspaces stop expiring)
5. **Cleanup Lambda:** Disable EventBridge trigger (manual cleanup only)

---

## Security Considerations

1. **Data Loss Prevention:** 180-day expiration provides recovery window
2. **Glacier Recovery:** Archived data retrievable within 3-5 hours
3. **Audit Trail:** All cleanup actions logged to CloudWatch
4. **IAM Least Privilege:** Cleanup Lambda has minimal required permissions
5. **Customer Notification:** Consider email notification before workspace expiry

---

## Cost Analysis

### Current Monthly Costs (Estimated)
- S3 Standard: $0.023/GB × 0.05 GB = $0.00
- EFS Standard: $0.30/GB × 0.006 GB = $0.00
- ECR Storage: $0.10/GB × ~20 GB = $2.00
- CloudWatch Logs: $0.03/GB × 0.04 GB = $0.00
- **Total:** ~$2.00/month

### Projected at Scale (1000 dispatches/day)
- S3 Standard: $0.023/GB × 10 GB = $0.23
- S3 IA (30+ days): $0.0125/GB × 20 GB = $0.25
- S3 Glacier (90+ days): $0.004/GB × 50 GB = $0.20
- EFS (with cleanup): $0.30/GB × 50 GB = $15.00
- ECR (with lifecycle): $0.10/GB × 5 GB = $0.50
- CloudWatch Logs: $0.03/GB × 10 GB = $0.30
- Lambda (cleanup): ~$0.20/month
- **Total:** ~$17/month (vs. unbounded growth without lifecycle)

### Savings from Governance
- ECR orphan cleanup: ~$2-5/month immediate
- S3 lifecycle transitions: ~$5-10/month at scale
- EFS cleanup: Prevents unbounded growth
- **ROI:** Positive within first month

---

## Appendix A: Current Infrastructure State (2026-01-14)

### S3 Buckets
| Bucket | Objects | Size | Lifecycle | Versioning |
|--------|---------|------|-----------|------------|
| outpost-outputs | 1,390 | 51 MB | ❌ None | ❌ Disabled |
| outpost-artifacts-dev | 0 | 0 | ✅ 90-day | ✅ Enabled |
| outpost-audit-logs | 1,233 | 6.5 MB | ✅ 365-day | ✅ Enabled |
| outpost-terraform-state | 1 | 341 KB | ❌ None | ✅ Enabled |

### CloudWatch Log Groups
| Log Group | Retention | Size |
|-----------|-----------|------|
| /outpost/agents/* (6) | 30 days | 153 KB |
| /outpost/dispatches | 30 days | 0 |
| /ecs/outpost-control-plane | 30 days | 2 MB |
| /aws/ecs/containerinsights/* | ❌ 1 day | 2.4 MB |
| /aws/vpc/dev-outpost-flow-logs | 30 days | 29 MB |

### ECR Repositories
| Repository | Images | Lifecycle | Orphans |
|------------|--------|-----------|---------|
| outpost-claude | 12 | ✅ | 0 |
| outpost-codex | 21 | ✅ | 0 |
| outpost-gemini | 27 | ✅ | 0 |
| outpost-aider | 15 | ✅ | 0 |
| outpost-grok | 18 | ✅ | 0 |
| outpost-base | 4 | ❌ | 0 |
| outpost-control-plane | 57 | ❌ | 55 |

### EFS
| Filesystem | Size | Access Points | Lifecycle |
|------------|------|---------------|-----------|
| fs-02c98a4b49a4f8fb7 | 6 KB | 1 (root) | IA after 30 days |

---

## Appendix B: Terraform File Locations

```
infrastructure/terraform/
├── modules/
│   ├── s3/
│   │   ├── main.tf           # Add lifecycle configurations
│   │   └── outputs.tf
│   ├── cloudwatch/
│   │   └── log-groups.tf     # Add retention settings
│   ├── ecr/
│   │   ├── main.tf
│   │   └── lifecycle.tf      # Add missing policies
│   ├── efs/
│   │   └── main.tf           # Existing, adequate
│   ├── dynamodb/
│   │   └── main.tf           # Add TTL configuration
│   └── lambda/
│       └── workspace-cleanup/ # NEW - cleanup Lambda
│           ├── main.tf
│           ├── handler.ts
│           └── package.json
└── environments/
    └── dev/
        └── main.tf           # Wire up new modules
```

---

## Appendix C: Related Documentation

- Session Journal: `session-journals/2026-01-14-016-*.md`
- Architecture: `docs/CONTROL_PLANE_ARCHITECTURE.md`
- EFS Module: `infrastructure/terraform/modules/efs/main.tf`
- Workspace Types: `src/control-plane/src/types/workspace.ts`
