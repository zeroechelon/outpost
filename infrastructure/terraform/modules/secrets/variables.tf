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
