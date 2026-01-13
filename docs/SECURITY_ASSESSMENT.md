# Outpost V2 Security Assessment

**Assessment Date:** 2026-01-12
**Environment:** dev
**AWS Account:** 311493921645
**Region:** us-east-1
**Assessor:** Claude Opus 4.5 (Automated)

---

## Executive Summary

**Overall Security Posture: PASS**

The Outpost V2 infrastructure demonstrates strong security practices with proper network isolation, defense-in-depth controls, and appropriate IAM policies. Key strengths include:

- IMDS access blocked at both NACL and Security Group levels
- VPC Flow Logs enabled with 60-second aggregation
- Secrets Manager with KMS encryption for API keys
- S3 public access completely blocked
- EFS encryption at rest enabled

**Areas Requiring Attention:**
- DynamoDB tables using AWS-managed encryption (default) rather than CMK
- ECR image scanning not triggered for recently pushed images
- No CloudTrail trail configured in this account
- One wildcard IAM permission (EFS Resource: `*`)

---

## Network Security

### Security Groups

| Security Group | Purpose | Status | Notes |
|----------------|---------|--------|-------|
| `dev-outpost-agent-tasks-isolated-sg` | Multi-tenant agent isolation | PASS | Restricted egress only (HTTPS, SSH, DNS, NFS) |
| `dev-outpost-ecs-tasks-sg` | ECS task network access | PASS | Restricted egress, no ingress |
| `dev-outpost-vpc-endpoints-sg` | VPC PrivateLink endpoints | PASS | HTTPS from VPC CIDR only |
| `dev-outpost-efs-sg` | EFS mount targets | PASS | NFS from ECS SGs only |
| `outpost-dev-control-plane-sg` | Control plane service | PASS | Port 3000 from VPC only, restricted egress |

**Findings:**
- [x] Security groups properly configured - No overly permissive rules
- [x] No 0.0.0.0/0 ingress rules
- [x] Egress limited to necessary ports (22, 53, 443, 2049)
- [x] Security group references used for internal communication

### VPC Flow Logs

| Resource | Status | Details |
|----------|--------|---------|
| VPC Flow Log | ACTIVE | `fl-07bea5ffde051da7a` |
| Log Group | `/aws/vpc/dev-outpost-flow-logs` | 30-day retention |
| Aggregation Interval | 60 seconds | Real-time monitoring capable |
| Traffic Type | ALL | Both ACCEPT and REJECT logged |

**Findings:**
- [x] VPC flow logs enabled on `vpc-00d7f5c181147188f`
- [x] Comprehensive log format with 28 fields including subnet-id, az-id, traffic-path
- [x] Metric filter configured for IMDS access attempts (`169.254.169.254`)

### NACL Rules (IMDS Blocking)

| NACL | Subnets Protected | IMDS Rule | Status |
|------|-------------------|-----------|--------|
| `acl-09f9a21fc1fc3c574` | Private subnets (10.0.11.0/24, 10.0.12.0/24) | Rule 50: DENY 169.254.169.254/32 | PASS |

**Inbound Rules:**
- Rule 50: DENY ALL to 169.254.169.254/32 (IMDS blocked)
- Rule 100-110: ALLOW ephemeral ports (1024-65535) TCP/UDP
- Rule 200: ALLOW all from VPC CIDR (10.0.0.0/16)
- Rule *: DENY all

**Outbound Rules:**
- Rule 50: DENY ALL to 169.254.169.254/32 (IMDS blocked)
- Rule 100-140: ALLOW HTTPS, SSH, NFS, DNS
- Rule 200: ALLOW ephemeral ports
- Rule *: DENY all

**Findings:**
- [x] IMDS blocked for ECS tasks at NACL level (defense-in-depth)
- [x] Private subnets properly isolated (no direct internet access)
- [x] Explicit deny rules in place

### Private Subnet Isolation

| Subnet | CIDR | Type | Public IP on Launch |
|--------|------|------|---------------------|
| `dev-outpost-private-1` | 10.0.11.0/24 | Private | No |
| `dev-outpost-private-2` | 10.0.12.0/24 | Private | No |
| `dev-outpost-public-1` | 10.0.1.0/24 | Public | Yes |
| `dev-outpost-public-2` | 10.0.2.0/24 | Public | Yes |

**Findings:**
- [x] Private subnets isolated - MapPublicIpOnLaunch: false
- [x] Multi-AZ deployment (us-east-1a, us-east-1b)
- [x] Clear separation between public and private subnets

---

## IAM Security

### ECS Execution Role: `outpost-dev-ecs-execution`

| Policy | Type | Permissions | Assessment |
|--------|------|-------------|------------|
| `AmazonECSTaskExecutionRolePolicy` | AWS Managed | ECR pull, CW Logs | PASS |
| `secrets-access` | Inline | Secrets Manager GetSecretValue | PASS |

**Inline Policy Analysis:**
```json
{
  "secretsmanager:GetSecretValue": "arn:aws:secretsmanager:*:*:secret:/outpost/*",
  "kms:Decrypt": "*" (conditioned on kms:ViaService = secretsmanager)
}
```

**Findings:**
- [x] Task execution role follows least privilege
- [x] Secrets access scoped to `/outpost/*` prefix
- [x] KMS decrypt conditioned on Secrets Manager service

### ECS Task Role: `outpost-dev-ecs-task`

| Policy | Permissions | Resource Scope | Assessment |
|--------|-------------|----------------|------------|
| `cloudwatch-logs-access` | CreateLogStream, PutLogEvents | `/outpost/*` | PASS |
| `efs-access` | ClientMount, ClientWrite | `*` | NEEDS_ATTENTION |
| `s3-artifacts-access` | GetObject, PutObject, ListBucket | `outpost-artifacts-*` | PASS |

**Findings:**
- [x] CloudWatch logs scoped to `/outpost/*` log groups
- [ ] **EFS access uses Resource: `*`** - Should be scoped to specific EFS filesystem ARN
- [x] S3 access scoped to `outpost-artifacts-*` buckets

### Control Plane Task Role: `outpost-dev-control-plane-task`

| Policy | Permissions | Resource Scope | Assessment |
|--------|-------------|----------------|------------|
| `cloudwatch-logs-access` | CreateLogStream, PutLogEvents | Specific log group ARN | PASS |
| `dynamodb-access` | CRUD operations | Specific table ARNs | PASS |
| `s3-access` | GetObject, PutObject, ListBucket | Specific bucket ARN | PASS |
| `sqs-access` | SendMessage, GetQueue* | Specific queue ARN | PASS |

**Findings:**
- [x] All permissions scoped to specific resource ARNs
- [x] DynamoDB access limited to 3 tables + indexes
- [x] No wildcard permissions in control plane role

### Wildcard Permission Summary

| Role | Policy | Resource | Risk Level | Recommendation |
|------|--------|----------|------------|----------------|
| `outpost-dev-ecs-task` | `efs-access` | `*` | LOW | Scope to `arn:aws:elasticfilesystem:us-east-1:311493921645:file-system/fs-02c98a4b49a4f8fb7` |
| `outpost-dev-ecs-execution` | `secrets-access` (kms:Decrypt) | `*` | LOW | Acceptable due to condition constraint |

---

## Container Security

### ECR Repositories

| Repository | Scan on Push | Encryption | Tag Mutability | Status |
|------------|--------------|------------|----------------|--------|
| `outpost-base` | Yes | AES256 | MUTABLE | PASS |
| `outpost-claude` | Yes | AES256 | MUTABLE | PASS |
| `outpost-codex` | Yes | AES256 | MUTABLE | PASS |
| `outpost-gemini` | Yes | AES256 | MUTABLE | PASS |
| `outpost-aider` | Yes | AES256 | MUTABLE | PASS |
| `outpost-grok` | Yes | AES256 | MUTABLE | PASS |
| `outpost-control-plane` | **No** | AES256 | MUTABLE | NEEDS_ATTENTION |

### ECR Scan Results

| Image | Tag | Scan Status | Findings |
|-------|-----|-------------|----------|
| `outpost-base:latest` | v2.0.0 | NOT SCANNED | Scan not triggered |
| `outpost-claude:latest` | v2.0.0 | NOT SCANNED | Scan not triggered |
| `outpost-control-plane:latest` | v2.0.0 | NOT SCANNED | Scan on push disabled |

**Findings:**
- [ ] **ECR scan results not available** - Scans not triggered despite scan-on-push enabled
- [ ] **Control plane repository has scan-on-push disabled**
- [x] All repositories encrypted with AES256
- [ ] Tag mutability is MUTABLE - consider IMMUTABLE for production

### Container Configuration

- No sensitive data observed in container environment configurations
- API keys retrieved from Secrets Manager at runtime
- Base images need verification for currency (no scan data available)

---

## Data Security

### DynamoDB Encryption

| Table | SSE Status | Encryption Type | Assessment |
|-------|------------|-----------------|------------|
| `outpost-jobs-dev` | Enabled | AWS-managed (default) | ACCEPTABLE |
| `outpost-tenants-dev` | Enabled | AWS-managed (default) | ACCEPTABLE |
| `outpost-audit-dev` | Enabled | AWS-managed (default) | ACCEPTABLE |

**Findings:**
- [x] DynamoDB encryption enabled (AWS default SSE)
- [ ] **Not using customer-managed KMS key** - Consider CMK for production

### S3 Security

| Bucket | Encryption | Public Access Block | Bucket Policy | Assessment |
|--------|------------|---------------------|---------------|------------|
| `outpost-artifacts-dev-311493921645` | AES256 (SSE-S3) | All 4 blocks enabled | None | PASS |

**Public Access Block Configuration:**
- BlockPublicAcls: true
- IgnorePublicAcls: true
- BlockPublicPolicy: true
- RestrictPublicBuckets: true

**Findings:**
- [x] S3 encryption enabled (SSE-S3 with bucket key)
- [x] All public access blocked
- [x] No bucket policy (access via IAM only)

### EFS Security

| Filesystem | Name | Encrypted | Assessment |
|------------|------|-----------|------------|
| `fs-02c98a4b49a4f8fb7` | `outpost-dev-workspaces` | Yes | PASS |

**Findings:**
- [x] EFS encryption at rest enabled

### Secrets Manager

| Secret | KMS Encryption | Tags | Assessment |
|--------|----------------|------|------------|
| `/outpost/api-keys/github` | CMK (398895cd-...) | Proper tagging | PASS |
| `/outpost/api-keys/anthropic` | CMK (398895cd-...) | Proper tagging | PASS |
| `/outpost/api-keys/openai` | CMK (398895cd-...) | Proper tagging | PASS |
| `/outpost/api-keys/google` | CMK (398895cd-...) | Proper tagging | PASS |
| `/outpost/api-keys/xai` | CMK (398895cd-...) | Proper tagging | PASS |
| `/outpost/api-keys/deepseek` | CMK (398895cd-...) | Proper tagging | PASS |

**Findings:**
- [x] Secrets Manager used for all API keys
- [x] Customer-managed KMS key for encryption
- [x] Proper resource tagging for cost allocation and ownership

---

## Logging & Monitoring

### CloudWatch Logs

| Log Group | Retention | Metric Filters | Assessment |
|-----------|-----------|----------------|------------|
| `/outpost/agents/claude` | 30 days | 1 | PASS |
| `/outpost/agents/codex` | 30 days | 1 | PASS |
| `/outpost/agents/gemini` | 30 days | 1 | PASS |
| `/outpost/agents/aider` | 30 days | 1 | PASS |
| `/outpost/agents/grok` | 30 days | 1 | PASS |
| `/outpost/dispatches` | 30 days | 1 | PASS |
| `/ecs/outpost-control-plane` | 30 days | 0 | PASS |
| `/aws/vpc/dev-outpost-flow-logs` | 30 days | 1 | PASS |

**Findings:**
- [x] CloudWatch logs enabled for all components
- [x] 30-day retention configured
- [x] Metric filters configured for monitoring

### VPC Flow Logs

| Configuration | Value | Assessment |
|---------------|-------|------------|
| Status | ACTIVE | PASS |
| Destination | CloudWatch Logs | PASS |
| Traffic Type | ALL | PASS |
| Max Aggregation | 60 seconds | PASS |
| IMDS Monitoring | Metric filter active | PASS |

**Findings:**
- [x] VPC flow logs enabled
- [x] IMDS access attempts monitored via metric filter

### CloudTrail

| Status | Assessment |
|--------|------------|
| No trails configured in account | NEEDS_ATTENTION |

**Findings:**
- [ ] **CloudTrail not enabled** - No audit trail for API calls
- This may be acceptable if using AWS Organizations with centralized CloudTrail

---

## Recommendations

### Priority: HIGH

1. **Enable CloudTrail**
   - Configure a trail to capture all management events
   - Store logs in S3 with SSE-KMS encryption
   - Consider multi-region trail for comprehensive coverage

2. **Enable ECR Image Scanning**
   - Trigger manual scans for existing images: `aws ecr start-image-scan`
   - Enable scan-on-push for `outpost-control-plane` repository
   - Review and remediate any CRITICAL/HIGH vulnerabilities

### Priority: MEDIUM

3. **Scope EFS IAM Policy**
   - Change `Resource: "*"` to specific EFS filesystem ARN
   - Update: `arn:aws:elasticfilesystem:us-east-1:311493921645:file-system/fs-02c98a4b49a4f8fb7`

4. **Consider ECR Tag Immutability**
   - Set `imageTagMutability: IMMUTABLE` for production repositories
   - Prevents tag overwriting and ensures image integrity

5. **DynamoDB CMK Encryption**
   - Migrate to customer-managed KMS keys for sensitive tables
   - Provides key rotation control and audit capabilities

### Priority: LOW

6. **Metric Filters for Control Plane**
   - Add CloudWatch metric filters to `/ecs/outpost-control-plane` log group
   - Monitor for errors, latency, and security events

7. **Consider VPC Endpoint for ECR**
   - Add ECR PrivateLink endpoints for container pulls without internet
   - Reduces attack surface and egress costs

---

## Compliance Checklist

### Network Security
- [x] Security groups properly configured
- [x] VPC flow logs enabled
- [x] IMDS blocked for ECS tasks
- [x] Private subnets isolated

### IAM Security
- [x] Task execution role follows least privilege
- [x] Task role follows least privilege (with one exception)
- [ ] No wildcard permissions (1 wildcard in EFS policy)

### Container Security
- [ ] ECR scan results reviewed (scans not available)
- [ ] Base images current (unable to verify)
- [x] No sensitive data exposed in configs

### Data Security
- [x] DynamoDB encryption enabled
- [x] S3 encryption enabled
- [x] Secrets Manager used properly

### Logging & Monitoring
- [x] CloudWatch logs enabled
- [ ] CloudTrail enabled
- [x] VPC flow logs enabled

---

## Assessment Summary

| Domain | Status | Pass/Total |
|--------|--------|------------|
| Network Security | PASS | 4/4 |
| IAM Security | PASS | 2/3 |
| Container Security | NEEDS_ATTENTION | 1/3 |
| Data Security | PASS | 3/3 |
| Logging & Monitoring | PASS | 2/3 |
| **Overall** | **PASS** | **12/16** |

**Assessment Result:** The Outpost V2 infrastructure meets security requirements for a development environment with strong network isolation and data protection controls. Address the HIGH priority recommendations before production deployment.

---

*Report generated by automated security assessment on 2026-01-12*
