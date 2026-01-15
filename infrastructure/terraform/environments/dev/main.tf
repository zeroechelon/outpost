# =============================================================================
# Outpost V2 - Development Environment
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "outpost"
      Environment = "dev"
      Owner       = "zeroechelon"
      CostCenter  = "outpost-v2"
      ManagedBy   = "terraform"
    }
  }
}

# =============================================================================
# Core Infrastructure Modules
# =============================================================================

# -----------------------------------------------------------------------------
# VPC - Network Foundation
# -----------------------------------------------------------------------------
module "vpc" {
  source             = "../../modules/vpc"
  environment        = "dev"
  availability_zones = ["us-east-1a", "us-east-1b"]
  # Dev-specific: single NAT gateway for cost savings
  single_nat_gateway = true
}

# -----------------------------------------------------------------------------
# ECR - Container Registry
# -----------------------------------------------------------------------------
module "ecr" {
  source      = "../../modules/ecr"
  environment = "dev"
}

# -----------------------------------------------------------------------------
# SQS - Job Queue
# -----------------------------------------------------------------------------
module "sqs" {
  source      = "../../modules/sqs"
  environment = "dev"
}

# -----------------------------------------------------------------------------
# DynamoDB - Data Storage
# -----------------------------------------------------------------------------
module "dynamodb" {
  source      = "../../modules/dynamodb"
  environment = "dev"
}

# -----------------------------------------------------------------------------
# S3 - Artifact Storage
# -----------------------------------------------------------------------------
module "s3" {
  source      = "../../modules/s3"
  environment = "dev"
}

# -----------------------------------------------------------------------------
# Secrets Manager - API Keys & Credentials
# -----------------------------------------------------------------------------
module "secrets" {
  source      = "../../modules/secrets"
  environment = "dev"
}

# -----------------------------------------------------------------------------
# EFS - Workspace Persistence
# -----------------------------------------------------------------------------
module "efs" {
  source                = "../../modules/efs"
  environment           = "dev"
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  ecs_security_group_id = module.vpc.ecs_tasks_security_group_id
}

# -----------------------------------------------------------------------------
# ECS - Container Orchestration
# -----------------------------------------------------------------------------
module "ecs" {
  source             = "../../modules/ecs"
  environment        = "dev"
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids

  # ECR repository URLs
  ecr_repository_urls = module.ecr.repository_urls

  # SQS configuration
  jobs_queue_url = module.sqs.jobs_queue_url
  jobs_queue_arn = module.sqs.jobs_queue_arn

  # DynamoDB configuration
  jobs_table_name       = module.dynamodb.jobs_table_name
  jobs_table_arn        = module.dynamodb.jobs_table_arn
  tenants_table_name    = module.dynamodb.tenants_table_name
  tenants_table_arn     = module.dynamodb.tenants_table_arn
  audit_table_name      = module.dynamodb.audit_table_name
  audit_table_arn       = module.dynamodb.audit_table_arn
  api_keys_table_name   = module.dynamodb.api_keys_table_name
  api_keys_table_arn    = module.dynamodb.api_keys_table_arn
  dispatches_table_name = module.dynamodb.dispatches_table_name
  dispatches_table_arn  = module.dynamodb.dispatches_table_arn

  # S3 configuration
  results_bucket_name = module.s3.bucket_name

  # Secrets configuration
  kms_key_arn = module.secrets.kms_key_arn

  # EFS configuration (disabled temporarily - needs worker security group fix)
  enable_efs          = false
  efs_file_system_id  = module.efs.filesystem_id
  efs_access_point_id = module.efs.root_access_point_id

  # ALB configuration
  enable_alb            = true
  alb_target_group_arn  = module.alb.target_group_arn
  alb_security_group_id = module.alb.security_group_id
}

# -----------------------------------------------------------------------------
# ALB - Application Load Balancer for Control Plane
# -----------------------------------------------------------------------------
module "alb" {
  source = "../../modules/alb"

  environment       = "dev"
  project           = "outpost"
  vpc_id            = module.vpc.vpc_id
  vpc_cidr          = var.vpc_cidr
  public_subnet_ids = module.vpc.public_subnet_ids

  alb_name = "outpost-control-plane"

  tags = {
    Project     = "outpost"
    Environment = "dev"
    Component   = "alb"
  }
}

# -----------------------------------------------------------------------------
# Monitoring - CloudWatch & Alerts
# -----------------------------------------------------------------------------
module "monitoring" {
  source           = "../../modules/monitoring"
  environment      = "dev"
  ecs_cluster_name = module.ecs.cluster_name_computed
}

# -----------------------------------------------------------------------------
# CloudTrail - Audit Logging
# -----------------------------------------------------------------------------
module "cloudtrail" {
  source       = "../../modules/cloudtrail"
  environment  = "dev"
  project_name = "outpost"

  tags = {
    Project     = "outpost"
    Environment = "dev"
    Component   = "audit"
  }
}
