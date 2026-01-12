# =============================================================================
# Outpost V2 - ECS Module Variables
# =============================================================================

# -----------------------------------------------------------------------------
# Core Configuration
# -----------------------------------------------------------------------------

variable "cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
  default     = "outpost"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "enable_container_insights" {
  description = "Enable CloudWatch Container Insights for the ECS cluster"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "outpost"
}

# -----------------------------------------------------------------------------
# Agent Configuration
# -----------------------------------------------------------------------------

variable "agent_configs" {
  description = "Map of agent configurations (cpu, memory, desired_count, use_spot, etc.)"
  type = map(object({
    cpu                   = number
    memory                = number
    desired_count         = optional(number, 1)
    use_spot              = optional(bool, true)
    ephemeral_storage_gib = optional(number, 21)
    log_level             = optional(string, "INFO")
  }))

  default = {
    claude = {
      cpu                   = 4096
      memory                = 8192
      desired_count         = 1
      use_spot              = true
      ephemeral_storage_gib = 30
      log_level             = "INFO"
    }
    codex = {
      cpu                   = 4096
      memory                = 8192
      desired_count         = 1
      use_spot              = true
      ephemeral_storage_gib = 30
      log_level             = "INFO"
    }
    gemini = {
      cpu                   = 2048
      memory                = 4096
      desired_count         = 1
      use_spot              = true
      ephemeral_storage_gib = 21
      log_level             = "INFO"
    }
    aider = {
      cpu                   = 2048
      memory                = 4096
      desired_count         = 1
      use_spot              = true
      ephemeral_storage_gib = 21
      log_level             = "INFO"
    }
    grok = {
      cpu                   = 2048
      memory                = 4096
      desired_count         = 1
      use_spot              = true
      ephemeral_storage_gib = 21
      log_level             = "INFO"
    }
  }
}

# -----------------------------------------------------------------------------
# Network Configuration
# -----------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID where ECS tasks will run"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for ECS tasks"
  type        = list(string)
}

# -----------------------------------------------------------------------------
# ECR Configuration
# -----------------------------------------------------------------------------

variable "ecr_repository_urls" {
  description = "Map of agent name to ECR repository URL"
  type        = map(string)

  # Example:
  # ecr_repository_urls = {
  #   claude = "123456789012.dkr.ecr.us-east-1.amazonaws.com/outpost-claude"
  #   codex  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/outpost-codex"
  #   gemini = "123456789012.dkr.ecr.us-east-1.amazonaws.com/outpost-gemini"
  #   aider  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/outpost-aider"
  #   grok   = "123456789012.dkr.ecr.us-east-1.amazonaws.com/outpost-grok"
  # }
}

# -----------------------------------------------------------------------------
# SQS Configuration
# -----------------------------------------------------------------------------

variable "jobs_queue_url" {
  description = "URL of the SQS jobs queue"
  type        = string
}

variable "jobs_queue_arn" {
  description = "ARN of the SQS jobs queue"
  type        = string
}

# -----------------------------------------------------------------------------
# DynamoDB Configuration
# -----------------------------------------------------------------------------

variable "jobs_table_name" {
  description = "Name of the DynamoDB jobs table"
  type        = string
}

variable "jobs_table_arn" {
  description = "ARN of the DynamoDB jobs table"
  type        = string
}

variable "tenants_table_name" {
  description = "Name of the DynamoDB tenants table"
  type        = string
}

variable "tenants_table_arn" {
  description = "ARN of the DynamoDB tenants table"
  type        = string
}

variable "audit_table_name" {
  description = "Name of the DynamoDB audit table"
  type        = string
}

variable "audit_table_arn" {
  description = "ARN of the DynamoDB audit table"
  type        = string
}

# -----------------------------------------------------------------------------
# S3 Configuration
# -----------------------------------------------------------------------------

variable "results_bucket_name" {
  description = "Name of the S3 bucket for storing job results"
  type        = string
}

# -----------------------------------------------------------------------------
# Secrets Manager Configuration
# -----------------------------------------------------------------------------

variable "secrets_manager_prefix" {
  description = "Prefix for Secrets Manager secrets (e.g., /outpost/prod)"
  type        = string
  default     = "/outpost"
}

variable "kms_key_arn" {
  description = "ARN of KMS key for encrypting secrets (empty string for AWS managed key)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Logging Configuration
# -----------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653], var.log_retention_days)
    error_message = "Log retention must be a valid CloudWatch Logs retention value."
  }
}

# -----------------------------------------------------------------------------
# EFS Configuration
# -----------------------------------------------------------------------------

variable "enable_efs" {
  description = "Enable EFS volume mount for workspace persistence"
  type        = bool
  default     = true
}

variable "efs_file_system_id" {
  description = "ID of the EFS file system for workspaces"
  type        = string
  default     = ""
}

variable "efs_access_point_id" {
  description = "ID of the EFS access point for workspaces"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
