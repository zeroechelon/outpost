# Deployment Guide

> **Step-by-step guide for deploying Outpost to production**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Author:** Richie G. Suarez, Zero Echelon LLC

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Infrastructure Deployment](#infrastructure-deployment)
4. [Application Deployment](#application-deployment)
5. [Configuration](#configuration)
6. [Validation](#validation)
7. [Rollback](#rollback)
8. [Monitoring Setup](#monitoring-setup)

---

## Prerequisites

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| AWS CLI | v2.x | AWS resource management |
| Terraform | 1.5+ | Infrastructure provisioning |
| Docker | 24.0+ | Container builds |
| Node.js | 20 LTS | Control plane build |
| jq | 1.6+ | JSON processing |

### AWS Configuration

```bash
# Configure AWS profile
aws configure --profile soc

# Verify access
aws sts get-caller-identity --profile soc

# Expected output:
# {
#   "UserId": "...",
#   "Account": "311493921645",
#   "Arn": "arn:aws:iam::311493921645:user/..."
# }
```

### Required IAM Permissions

The deployment user needs the following managed policies:
- `AmazonECS_FullAccess`
- `AmazonEC2ContainerRegistryFullAccess`
- `AmazonDynamoDBFullAccess`
- `AmazonS3FullAccess`
- `SecretsManagerReadWrite`
- `CloudWatchFullAccess`
- `IAMFullAccess` (for role creation)
- `ElasticLoadBalancingFullAccess`
- `AmazonEFS_FullAccess`

---

## Architecture Overview

```
Deployment Targets:
├── ECS Fargate Cluster
│   ├── Control Plane Service (stateless API)
│   └── Worker Task Definitions (5 agents)
├── Application Load Balancer
│   └── Target Group → Control Plane
├── DynamoDB Tables
│   ├── outpost-jobs
│   ├── outpost-api-keys
│   ├── outpost-audit
│   └── outpost-workspaces
├── S3 Buckets
│   ├── outpost-artifacts-{env}
│   └── outpost-logs-{env}
├── EFS File System
│   └── Workspace mount points
├── Secrets Manager
│   ├── Agent credentials
│   └── API keys
└── CloudWatch
    ├── Log groups
    └── Alarms
```

---

## Infrastructure Deployment

### Step 1: Initialize Terraform

```bash
cd infrastructure/terraform/environments/dev

# Initialize Terraform
terraform init

# Review plan
terraform plan -out=tfplan
```

### Step 2: Deploy VPC and Networking

```bash
# Apply VPC module first
terraform apply -target=module.vpc tfplan

# Verify VPC creation
aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=outpost-*" \
  --profile soc \
  --query 'Vpcs[*].{VpcId:VpcId,CidrBlock:CidrBlock}'
```

### Step 3: Deploy DynamoDB Tables

```bash
# Apply DynamoDB module
terraform apply -target=module.dynamodb tfplan

# Verify tables
aws dynamodb list-tables --profile soc | grep outpost
```

**Expected Tables:**
- `outpost-jobs-dev`
- `outpost-api-keys-dev`
- `outpost-audit-dev`
- `outpost-workspaces-dev`

### Step 4: Deploy S3 Buckets

```bash
# Apply S3 module
terraform apply -target=module.s3 tfplan

# Verify buckets
aws s3 ls --profile soc | grep outpost
```

### Step 5: Deploy EFS File System

```bash
# Apply EFS module
terraform apply -target=module.efs tfplan

# Verify file system
aws efs describe-file-systems \
  --profile soc \
  --query 'FileSystems[?Name==`outpost-workspaces-dev`]'
```

### Step 6: Deploy ECR Repositories

```bash
# Apply ECR module
terraform apply -target=module.ecr tfplan

# Verify repositories
aws ecr describe-repositories \
  --profile soc \
  --query 'repositories[?starts_with(repositoryName, `outpost-`)]'
```

**Expected Repositories:**
- `outpost-base`
- `outpost-claude`
- `outpost-codex`
- `outpost-gemini`
- `outpost-aider`
- `outpost-grok`
- `outpost-control-plane`

### Step 7: Deploy Secrets

```bash
# Apply Secrets Manager module
terraform apply -target=module.secrets tfplan

# Note: Actual secret values must be populated manually
aws secretsmanager list-secrets \
  --profile soc \
  --query 'SecretList[?starts_with(Name, `outpost/`)]'
```

### Step 8: Deploy ECS Cluster and ALB

```bash
# Apply remaining infrastructure
terraform apply tfplan

# Verify ECS cluster
aws ecs describe-clusters \
  --clusters outpost-dev \
  --profile soc

# Verify ALB
aws elbv2 describe-load-balancers \
  --profile soc \
  --query 'LoadBalancers[?starts_with(LoadBalancerName, `outpost-`)]'
```

### Step 9: Record Infrastructure Outputs

```bash
# Save outputs for application deployment
terraform output -json > terraform-outputs.json

# Key outputs needed:
# - alb_dns_name
# - ecs_cluster_arn
# - dynamodb_table_arns
# - efs_file_system_id
# - ecr_repository_urls
```

---

## Application Deployment

### Step 1: Build Base Container Image

```bash
cd containers/base

# Build base image
docker build -t outpost-base:latest .

# Tag for ECR
ECR_REGISTRY="311493921645.dkr.ecr.us-east-1.amazonaws.com"
docker tag outpost-base:latest ${ECR_REGISTRY}/outpost-base:latest

# Authenticate to ECR
aws ecr get-login-password --region us-east-1 --profile soc | \
  docker login --username AWS --password-stdin ${ECR_REGISTRY}

# Push base image
docker push ${ECR_REGISTRY}/outpost-base:latest
```

### Step 2: Build Agent Container Images

```bash
# Build all agent images (run in parallel)
for agent in claude codex gemini aider grok; do
  docker build -t outpost-${agent}:latest containers/${agent}/
  docker tag outpost-${agent}:latest ${ECR_REGISTRY}/outpost-${agent}:latest
  docker push ${ECR_REGISTRY}/outpost-${agent}:latest &
done
wait

echo "All agent images pushed successfully"
```

### Step 3: Build Control Plane

```bash
cd src/control-plane

# Install dependencies
npm ci

# Build TypeScript
npm run build

# Build Docker image
docker build -t outpost-control-plane:latest .

# Tag and push
docker tag outpost-control-plane:latest ${ECR_REGISTRY}/outpost-control-plane:latest
docker push ${ECR_REGISTRY}/outpost-control-plane:latest
```

### Step 4: Deploy Control Plane Service

```bash
# Update ECS service with new image
aws ecs update-service \
  --cluster outpost-dev \
  --service outpost-control-plane \
  --force-new-deployment \
  --profile soc

# Monitor deployment
aws ecs describe-services \
  --cluster outpost-dev \
  --services outpost-control-plane \
  --profile soc \
  --query 'services[0].deployments'
```

### Step 5: Verify Deployment

```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --profile soc \
  --query 'LoadBalancers[?starts_with(LoadBalancerName, `outpost-control-plane`)].DNSName' \
  --output text)

# Health check
curl -s http://${ALB_DNS}/health | jq .

# Expected response:
# {
#   "status": "healthy",
#   "version": "2.0.0",
#   "uptime": 123
# }
```

---

## Configuration

### Environment Variables

Control plane configuration via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | — | `development` or `production` |
| `PORT` | No | `3000` | HTTP server port |
| `AWS_REGION` | Yes | — | AWS region (e.g., `us-east-1`) |
| `DYNAMODB_TABLE_PREFIX` | No | `outpost` | Table name prefix |
| `ECS_CLUSTER_ARN` | Yes | — | ECS cluster for workers |
| `EFS_FILE_SYSTEM_ID` | Yes | — | EFS for workspaces |
| `S3_ARTIFACTS_BUCKET` | Yes | — | S3 bucket for artifacts |
| `LOG_LEVEL` | No | `info` | Logging level |

### Secrets Manager Configuration

Populate these secrets in AWS Secrets Manager:

```bash
# Agent credentials
aws secretsmanager put-secret-value \
  --secret-id outpost/agents/anthropic \
  --secret-string '{"apiKey":"sk-ant-..."}' \
  --profile soc

aws secretsmanager put-secret-value \
  --secret-id outpost/agents/openai \
  --secret-string '{"apiKey":"sk-..."}' \
  --profile soc

aws secretsmanager put-secret-value \
  --secret-id outpost/agents/google \
  --secret-string '{"apiKey":"..."}' \
  --profile soc

aws secretsmanager put-secret-value \
  --secret-id outpost/agents/deepseek \
  --secret-string '{"apiKey":"..."}' \
  --profile soc

aws secretsmanager put-secret-value \
  --secret-id outpost/agents/xai \
  --secret-string '{"apiKey":"..."}' \
  --profile soc

# GitHub token for repo operations
aws secretsmanager put-secret-value \
  --secret-id outpost/github \
  --secret-string '{"token":"ghp_..."}' \
  --profile soc
```

### API Key Provisioning

Create initial API key for testing:

```bash
# Generate API key
API_KEY=$(node -e "console.log('otp_' + require('crypto').randomBytes(32).toString('hex'))")
echo "Generated API key: ${API_KEY}"

# Store hash in DynamoDB (production: use provision-tenant.ts script)
KEY_HASH=$(echo -n "${API_KEY}" | sha256sum | cut -d' ' -f1)

aws dynamodb put-item \
  --table-name outpost-api-keys-dev \
  --item "{
    \"apiKeyId\": {\"S\": \"$(uuidgen)\"},
    \"tenantId\": {\"S\": \"default-tenant\"},
    \"keyHash\": {\"S\": \"${KEY_HASH}\"},
    \"keyPrefix\": {\"S\": \"${API_KEY:0:15}\"},
    \"scopes\": {\"L\": [{\"S\": \"dispatch\"}, {\"S\": \"status\"}, {\"S\": \"promote\"}]},
    \"status\": {\"S\": \"active\"},
    \"createdAt\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
  }" \
  --profile soc

echo "API key provisioned. Save this key securely: ${API_KEY}"
```

---

## Validation

### Health Check

```bash
curl -s http://${ALB_DNS}/health | jq .
```

**Expected:**
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "uptime": 123
}
```

### Fleet Status

```bash
curl -s http://${ALB_DNS}/fleet \
  -H "X-API-Key: ${API_KEY}" | jq .
```

**Expected:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "agents": [
      { "agent": "claude", "available": true, "modelId": "claude-opus-4-5-20251101" },
      { "agent": "codex", "available": true, "modelId": "gpt-5.2-codex" },
      { "agent": "gemini", "available": true, "modelId": "gemini-3-pro-preview" },
      { "agent": "aider", "available": true, "modelId": "deepseek/deepseek-coder" },
      { "agent": "grok", "available": true, "modelId": "grok-4.1" }
    ]
  }
}
```

### Test Dispatch

```bash
curl -X POST http://${ALB_DNS}/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "userId": "deployment-test",
    "agent": "aider",
    "task": "Print hello world",
    "timeoutSeconds": 60
  }' | jq .
```

**Expected:**
```json
{
  "success": true,
  "data": {
    "dispatchId": "01HXYZ...",
    "status": "PENDING"
  }
}
```

### Smoke Test Suite

```bash
# Run smoke tests
cd tests/smoke
./run-smoke-tests.sh ${ALB_DNS} ${API_KEY}

# Expected: All tests pass
```

---

## Rollback

### Quick Rollback (ECS)

```bash
# List recent deployments
aws ecs describe-services \
  --cluster outpost-dev \
  --services outpost-control-plane \
  --profile soc \
  --query 'services[0].deployments'

# Rollback to previous task definition
PREVIOUS_TASK_DEF=$(aws ecs describe-services \
  --cluster outpost-dev \
  --services outpost-control-plane \
  --profile soc \
  --query 'services[0].deployments[1].taskDefinition' \
  --output text)

aws ecs update-service \
  --cluster outpost-dev \
  --service outpost-control-plane \
  --task-definition ${PREVIOUS_TASK_DEF} \
  --profile soc
```

### Infrastructure Rollback

```bash
cd infrastructure/terraform/environments/dev

# Show previous state
terraform state list

# Rollback specific resource
terraform state rm <resource>
terraform import <resource> <id>

# Or full rollback
git checkout HEAD~1 -- *.tf
terraform apply
```

### Database Rollback (Point-in-Time Recovery)

```bash
# DynamoDB PITR - restore to specific time
aws dynamodb restore-table-to-point-in-time \
  --source-table-name outpost-jobs-dev \
  --target-table-name outpost-jobs-dev-restored \
  --restore-date-time "2026-01-14T10:00:00Z" \
  --profile soc

# After verification, swap tables
```

---

## Monitoring Setup

### CloudWatch Log Groups

```bash
# Verify log groups exist
aws logs describe-log-groups \
  --log-group-name-prefix /ecs/outpost \
  --profile soc

# Expected:
# /ecs/outpost-control-plane
# /ecs/outpost-claude
# /ecs/outpost-codex
# /ecs/outpost-gemini
# /ecs/outpost-aider
# /ecs/outpost-grok
```

### CloudWatch Alarms

```bash
# Create high CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name outpost-control-plane-high-cpu \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ClusterName,Value=outpost-dev Name=ServiceName,Value=outpost-control-plane \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:311493921645:outpost-alerts \
  --profile soc

# Create unhealthy task alarm
aws cloudwatch put-metric-alarm \
  --alarm-name outpost-control-plane-unhealthy \
  --metric-name UnHealthyHostCount \
  --namespace AWS/ApplicationELB \
  --statistic Average \
  --period 60 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=TargetGroup,Value=<target-group-arn> Name=LoadBalancer,Value=<lb-arn> \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:311493921645:outpost-alerts \
  --profile soc
```

### Dashboard Creation

```bash
# Create CloudWatch dashboard
aws cloudwatch put-dashboard \
  --dashboard-name outpost-production \
  --dashboard-body file://monitoring/dashboard.json \
  --profile soc
```

---

## Post-Deployment Checklist

- [ ] Health endpoint returns `healthy`
- [ ] All 5 agents show as `available`
- [ ] Test dispatch completes successfully
- [ ] CloudWatch logs are being collected
- [ ] Alarms are configured and active
- [ ] API key is provisioned and tested
- [ ] Secrets are populated in Secrets Manager
- [ ] DNS/domain configured (if applicable)
- [ ] TLS certificate configured (if applicable)
- [ ] Monitoring dashboard created
- [ ] Runbook shared with operations team

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common deployment issues.

---

## Support

**Maintainer:** Richie G. Suarez
**Organization:** Zero Echelon LLC

---

*Outpost Deployment Guide v1.0.0*
