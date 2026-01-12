# =============================================================================
# Outpost V2 - Secrets Module Variables
# =============================================================================

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "kms_deletion_window" {
  description = "Number of days before KMS key is permanently deleted (7-30)"
  type        = number
  default     = 7

  validation {
    condition     = var.kms_deletion_window >= 7 && var.kms_deletion_window <= 30
    error_message = "KMS key deletion window must be between 7 and 30 days."
  }
}

variable "tags" {
  description = "Additional tags for all Secrets Manager resources"
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# Rotation Configuration
# -----------------------------------------------------------------------------

variable "rotation_enabled" {
  description = "Enable automatic secret rotation feature"
  type        = bool
  default     = false
}

variable "rotation_enabled_secrets" {
  description = "List of API key names to enable rotation for (e.g., ['ANTHROPIC', 'OPENAI'])"
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for key in var.rotation_enabled_secrets :
      contains(["ANTHROPIC", "OPENAI", "GOOGLE", "XAI", "DEEPSEEK", "GITHUB"], key)
    ])
    error_message = "rotation_enabled_secrets must only contain valid API key names: ANTHROPIC, OPENAI, GOOGLE, XAI, DEEPSEEK, GITHUB."
  }
}

variable "rotation_days" {
  description = "Number of days between automatic rotations"
  type        = number
  default     = 90

  validation {
    condition     = var.rotation_days >= 1 && var.rotation_days <= 365
    error_message = "Rotation days must be between 1 and 365."
  }
}

variable "rotation_duration" {
  description = "Duration window for rotation to complete (e.g., '4h' for 4 hours)"
  type        = string
  default     = "4h"

  validation {
    condition     = can(regex("^[0-9]+h$", var.rotation_duration))
    error_message = "Rotation duration must be in hours format (e.g., '4h')."
  }
}

variable "rotation_schedule_expression" {
  description = "Optional schedule expression for rotation timing (e.g., 'cron(0 16 1 * ? *)' for 1st of each month at 4pm UTC)"
  type        = string
  default     = null
}

variable "rotation_lambda_timeout" {
  description = "Timeout in seconds for the rotation Lambda function"
  type        = number
  default     = 30

  validation {
    condition     = var.rotation_lambda_timeout >= 10 && var.rotation_lambda_timeout <= 900
    error_message = "Rotation Lambda timeout must be between 10 and 900 seconds."
  }
}

variable "rotation_log_retention_days" {
  description = "Number of days to retain rotation Lambda logs"
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653], var.rotation_log_retention_days)
    error_message = "Log retention days must be a valid CloudWatch Logs retention period."
  }
}

variable "rotation_lambda_vpc_config" {
  description = "Optional VPC configuration for rotation Lambda (for accessing VPC-internal resources)"
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}
