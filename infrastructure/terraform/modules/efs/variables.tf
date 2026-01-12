# =============================================================================
# Outpost V2 - EFS Module Variables
# =============================================================================

# -----------------------------------------------------------------------------
# Required Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be 'dev', 'staging', or 'prod'."
  }
}

variable "vpc_id" {
  description = "VPC ID where EFS mount targets will be created"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for EFS mount targets (one per AZ for HA)"
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 1
    error_message = "At least one private subnet ID is required."
  }
}

variable "ecs_security_group_id" {
  description = "Security group ID of ECS tasks that need to access EFS"
  type        = string
}

# -----------------------------------------------------------------------------
# Performance Configuration
# -----------------------------------------------------------------------------

variable "throughput_mode" {
  description = "EFS throughput mode: bursting (default), provisioned, or elastic"
  type        = string
  default     = "bursting"

  validation {
    condition     = contains(["bursting", "provisioned", "elastic"], var.throughput_mode)
    error_message = "Throughput mode must be 'bursting', 'provisioned', or 'elastic'."
  }
}

variable "provisioned_throughput_mibps" {
  description = "Provisioned throughput in MiB/s (required when throughput_mode is 'provisioned')"
  type        = number
  default     = null
}

# -----------------------------------------------------------------------------
# Backup Configuration
# -----------------------------------------------------------------------------

variable "enable_backup" {
  description = "Enable AWS Backup automatic backups for EFS"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Additional tags to apply to all EFS resources"
  type        = map(string)
  default     = {}
}
