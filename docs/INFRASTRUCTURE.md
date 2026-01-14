# Infrastructure Documentation

> **Terraform Modules and AWS Services Reference**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Author:** Richie G. Suarez, Zero Echelon LLC

---

## Table of Contents

1. [Overview](#overview)
2. [AWS Services](#aws-services)
3. [Terraform Module Structure](#terraform-module-structure)
4. [Module Reference](#module-reference)
5. [Environment Configuration](#environment-configuration)
6. [Cost Optimization](#cost-optimization)
7. [Security Configuration](#security-configuration)

---

## Overview

Outpost infrastructure is defined as Infrastructure as Code (IaC) using Terraform. All resources are deployed to AWS us-east-1 region using the `soc` AWS profile (account: 311493921645).

### Infrastructure Principles

1. **Immutable Infrastructure:** Resources are replaced, not modified
2. **Environment Parity:** Dev and prod use identical module definitions
3. **Least Privilege:** IAM roles scoped to minimum required permissions
4. **Cost Awareness:** PAY_PER_REQUEST billing, auto-scaling, right-sizing
5. **High Availability:** Multi-AZ deployment for production

---

## AWS Services

### Compute

| Service | Resource | Purpose |
|---------|----------|---------|
| **ECS Fargate** | Cluster | Container orchestration |
| **ECS Fargate** | Control Plane Service | Stateless HTTP API |
| **ECS Fargate** | Worker Tasks | Agent execution containers |
| **ECR** | Repositories (7) | Container image registry |

### Networking

| Service | Resource | Purpose |
|---------|----------|---------|
| **VPC** | Custom VPC | Network isolation |
| **Subnets** | Public (2), Private (2) | Network segmentation |
| **NAT Gateway** | 1 (dev), 2 (prod) | Private subnet egress |
| **ALB** | Load Balancer | HTTP ingress |
| **Security Groups** | ALB, ECS | Network access control |

### Storage

| Service | Resource | Purpose |
|---------|----------|---------|
| **DynamoDB** | 4 Tables | State persistence |
| **S3** | 3 Buckets | Artifacts, logs, workspaces |
| **EFS** | File System | Workspace persistence |

### Security

| Service | Resource | Purpose |
|---------|----------|---------|
| **Secrets Manager** | Agent credentials | API key storage |
| **KMS** | Customer managed key | Encryption |
| **IAM** | Roles, Policies | Access control |

### Observability

| Service | Resource | Purpose |
|---------|----------|---------|
| **CloudWatch** | Log Groups | Container logs |
| **CloudWatch** | Metrics | Performance monitoring |
| **CloudWatch** | Alarms | Alerting |
| **CloudTrail** | Trail | AWS API audit |
| **EventBridge** | Event Bus | Cost event routing |

---

## Terraform Module Structure

```
infrastructure/terraform/
├── modules/                    # Reusable modules
│   ├── alb/                   # Application Load Balancer
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── ecs/                   # ECS cluster and services
│   │   ├── main.tf
│   │   ├── task-definitions/
│   │   │   ├── control-plane.json
│   │   │   ├── claude.json
│   │   │   ├── codex.json
│   │   │   ├── gemini.json
│   │   │   ├── aider.json
│   │   │   └── grok.json
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── dynamodb/              # DynamoDB tables
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── ecr/                   # ECR repositories
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── efs/                   # Elastic File System
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── s3/                    # S3 buckets
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── secrets/               # Secrets Manager
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── vpc/                   # VPC and networking
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── monitoring/            # CloudWatch resources
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   └── cloudtrail/            # Audit logging
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
├── environments/
│   ├── dev/                   # Development environment
│   │   ├── main.tf           # Module composition
│   │   ├── variables.tf      # Environment variables
│   │   ├── outputs.tf        # Exposed outputs
│   │   ├── terraform.tfvars  # Variable values
│   │   └── backend.tf        # S3 state backend
│   │
│   └── prod/                  # Production environment
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       ├── terraform.tfvars
│       └── backend.tf
│
└── shared/                    # Shared configurations
    ├── providers.tf          # AWS provider config
    └── tags.tf               # Common tags
```

---

## Module Reference

### VPC Module

**Purpose:** Network isolation and segmentation

**Resources Created:**
- VPC with configurable CIDR
- Public subnets (2 AZs) for ALB
- Private subnets (2 AZs) for ECS tasks
- Internet Gateway
- NAT Gateway(s)
- Route tables

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `vpc_cidr` | string | `10.0.0.0/16` | VPC CIDR block |
| `environment` | string | — | Environment name (dev/prod) |
| `azs` | list(string) | `["us-east-1a", "us-east-1b"]` | Availability zones |
| `nat_gateway_count` | number | `1` | NAT gateways (1 dev, 2 prod) |

**Outputs:**

| Output | Description |
|--------|-------------|
| `vpc_id` | VPC identifier |
| `public_subnet_ids` | Public subnet IDs |
| `private_subnet_ids` | Private subnet IDs |
| `nat_gateway_ips` | NAT Gateway public IPs |

---

### ECS Module

**Purpose:** Container orchestration for control plane and workers

**Resources Created:**
- ECS Cluster
- Control Plane Service
- Task Definitions (control plane + 5 agents)
- Service Auto Scaling
- CloudWatch Log Groups

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `cluster_name` | string | — | ECS cluster name |
| `environment` | string | — | Environment name |
| `control_plane_cpu` | number | `512` | Control plane CPU units |
| `control_plane_memory` | number | `1024` | Control plane memory MB |
| `control_plane_desired_count` | number | `1` | Desired task count |
| `vpc_id` | string | — | VPC for networking |
| `private_subnet_ids` | list(string) | — | Subnets for tasks |
| `alb_target_group_arn` | string | — | ALB target group |

**Outputs:**

| Output | Description |
|--------|-------------|
| `cluster_arn` | ECS cluster ARN |
| `control_plane_service_name` | Service name |
| `task_definition_arns` | Map of task definition ARNs |

---

### DynamoDB Module

**Purpose:** State persistence for dispatches, API keys, audit

**Resources Created:**
- outpost-jobs-{env} table
- outpost-api-keys-{env} table
- outpost-audit-{env} table
- outpost-workspaces-{env} table
- Global Secondary Indexes
- Point-in-Time Recovery

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `environment` | string | — | Environment name |
| `table_prefix` | string | `outpost` | Table name prefix |
| `enable_pitr` | bool | `true` | Point-in-time recovery |
| `ttl_enabled` | bool | `true` | Enable TTL on tables |

**Outputs:**

| Output | Description |
|--------|-------------|
| `jobs_table_name` | Jobs table name |
| `jobs_table_arn` | Jobs table ARN |
| `api_keys_table_name` | API keys table name |
| `audit_table_name` | Audit table name |

**Table Schemas:**

```hcl
# outpost-jobs
resource "aws_dynamodb_table" "jobs" {
  name         = "outpost-jobs-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tenantId"
  range_key    = "dispatchId"

  attribute {
    name = "tenantId"
    type = "S"
  }

  attribute {
    name = "dispatchId"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "status-createdAt-index"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = var.enable_pitr
  }

  ttl {
    attribute_name = "ttl"
    enabled        = var.ttl_enabled
  }

  tags = var.common_tags
}
```

---

### ALB Module

**Purpose:** HTTP ingress and load balancing

**Resources Created:**
- Application Load Balancer
- Target Group (control plane)
- HTTP Listener (port 80)
- HTTPS Listener (port 443, optional)
- Security Group

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | — | Load balancer name |
| `environment` | string | — | Environment name |
| `vpc_id` | string | — | VPC for ALB |
| `public_subnet_ids` | list(string) | — | Public subnets |
| `certificate_arn` | string | `""` | ACM certificate (optional) |
| `health_check_path` | string | `/health` | Health check endpoint |

**Outputs:**

| Output | Description |
|--------|-------------|
| `alb_arn` | Load balancer ARN |
| `alb_dns_name` | DNS name for access |
| `target_group_arn` | Target group ARN |
| `security_group_id` | ALB security group |

---

### S3 Module

**Purpose:** Artifact storage, logs, workspace archives

**Resources Created:**
- outpost-artifacts-{env} bucket
- outpost-logs-{env} bucket
- outpost-workspaces-{env} bucket
- Lifecycle policies
- Bucket policies

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `environment` | string | — | Environment name |
| `artifacts_retention_days` | number | `90` | Artifact retention |
| `logs_retention_days` | number | `30` | Log retention |
| `workspace_retention_days` | number | `7` | Workspace retention |

**Outputs:**

| Output | Description |
|--------|-------------|
| `artifacts_bucket_name` | Artifacts bucket |
| `artifacts_bucket_arn` | Artifacts bucket ARN |
| `logs_bucket_name` | Logs bucket |
| `workspaces_bucket_name` | Workspaces bucket |

---

### EFS Module

**Purpose:** Persistent workspace storage

**Resources Created:**
- Elastic File System
- Mount targets (per AZ)
- Access points (dynamic)
- Security group

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | — | File system name |
| `environment` | string | — | Environment name |
| `vpc_id` | string | — | VPC for mount targets |
| `private_subnet_ids` | list(string) | — | Subnets for mounts |
| `throughput_mode` | string | `bursting` | Throughput mode |

**Outputs:**

| Output | Description |
|--------|-------------|
| `file_system_id` | EFS file system ID |
| `file_system_arn` | EFS ARN |
| `mount_target_ids` | Mount target IDs |
| `security_group_id` | EFS security group |

---

### ECR Module

**Purpose:** Container image registry

**Resources Created:**
- outpost-base repository
- outpost-control-plane repository
- outpost-claude repository
- outpost-codex repository
- outpost-gemini repository
- outpost-aider repository
- outpost-grok repository
- Lifecycle policies (keep last 10 images)

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `environment` | string | — | Environment name |
| `image_retention_count` | number | `10` | Images to retain |
| `scan_on_push` | bool | `true` | Enable vulnerability scanning |

**Outputs:**

| Output | Description |
|--------|-------------|
| `repository_urls` | Map of repo URLs |
| `repository_arns` | Map of repo ARNs |

---

### Secrets Module

**Purpose:** Secure credential storage

**Resources Created:**
- outpost/agents/anthropic secret
- outpost/agents/openai secret
- outpost/agents/google secret
- outpost/agents/deepseek secret
- outpost/agents/xai secret
- outpost/github secret
- KMS key for encryption

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `environment` | string | — | Environment name |
| `kms_key_deletion_days` | number | `30` | KMS key deletion window |

**Outputs:**

| Output | Description |
|--------|-------------|
| `secret_arns` | Map of secret ARNs |
| `kms_key_arn` | KMS key ARN |

**Note:** Secret values must be populated manually after Terraform apply.

---

### Monitoring Module

**Purpose:** Observability and alerting

**Resources Created:**
- CloudWatch Log Groups
- CloudWatch Alarms
- CloudWatch Dashboard
- SNS Topic for alerts

**Variables:**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `environment` | string | — | Environment name |
| `log_retention_days` | number | `7` | Log retention period |
| `alarm_email` | string | — | Alert notification email |

**Outputs:**

| Output | Description |
|--------|-------------|
| `log_group_names` | Map of log group names |
| `sns_topic_arn` | Alert SNS topic ARN |
| `dashboard_name` | CloudWatch dashboard name |

---

## Environment Configuration

### Development (dev)

```hcl
# environments/dev/terraform.tfvars

environment = "dev"
aws_region  = "us-east-1"

# VPC
vpc_cidr           = "10.0.0.0/16"
nat_gateway_count  = 1  # Cost optimization

# ECS
control_plane_desired_count = 1
control_plane_cpu           = 512
control_plane_memory        = 1024

# Scaling
enable_autoscaling = false

# Monitoring
log_retention_days = 7
alarm_email        = "alerts@zeroechelon.com"
```

### Production (prod)

```hcl
# environments/prod/terraform.tfvars

environment = "prod"
aws_region  = "us-east-1"

# VPC
vpc_cidr           = "10.1.0.0/16"
nat_gateway_count  = 2  # High availability

# ECS
control_plane_desired_count = 3
control_plane_cpu           = 1024
control_plane_memory        = 2048

# Scaling
enable_autoscaling    = true
min_capacity          = 2
max_capacity          = 10
target_cpu_utilization = 70

# Monitoring
log_retention_days = 30
alarm_email        = "alerts@zeroechelon.com"
```

---

## Cost Optimization

### Strategies Implemented

1. **PAY_PER_REQUEST DynamoDB:** No provisioned capacity charges
2. **Single NAT Gateway (dev):** Reduces cost from ~$64/mo to ~$32/mo
3. **Graviton Processors:** ARM64 ECS tasks are ~20% cheaper
4. **S3 Lifecycle Policies:** Auto-delete old artifacts
5. **Spot Capacity (future):** For non-critical worker tasks

### Estimated Monthly Costs

| Component | Dev | Prod |
|-----------|-----|------|
| ECS Fargate | $30 | $150 |
| ALB | $16 | $25 |
| NAT Gateway | $32 | $64 |
| DynamoDB | $5 | $20 |
| S3 | $2 | $10 |
| EFS | $3 | $10 |
| CloudWatch | $5 | $20 |
| Secrets Manager | $2 | $2 |
| **Total** | **~$95** | **~$300** |

*Note: Agent subscription costs ($170/mo) are separate.*

---

## Security Configuration

### IAM Roles

**ECS Task Execution Role:**
```hcl
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ecs/outpost-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:outpost/*"
    }
  ]
}
```

**ECS Task Role (Control Plane):**
```hcl
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/outpost-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:DescribeTasks"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "ecs:cluster": "arn:aws:ecs:*:*:cluster/outpost-*"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::outpost-*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "events:PutEvents"
      ],
      "Resource": "arn:aws:events:*:*:event-bus/outpost-*"
    }
  ]
}
```

### Security Groups

**ALB Security Group:**
```hcl
ingress {
  from_port   = 80
  to_port     = 80
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}

ingress {
  from_port   = 443
  to_port     = 443
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}

egress {
  from_port   = 0
  to_port     = 0
  protocol    = "-1"
  cidr_blocks = ["0.0.0.0/0"]
}
```

**ECS Tasks Security Group:**
```hcl
ingress {
  from_port       = 3000
  to_port         = 3000
  protocol        = "tcp"
  security_groups = [aws_security_group.alb.id]
}

egress {
  from_port   = 0
  to_port     = 0
  protocol    = "-1"
  cidr_blocks = ["0.0.0.0/0"]
}
```

---

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - Step-by-step deployment
- [Architecture Overview](ARCHITECTURE_OVERVIEW.md) - System design
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues

---

**Author:** Richie G. Suarez
**Organization:** Zero Echelon LLC

---

*Outpost Infrastructure Documentation v1.0.0*
