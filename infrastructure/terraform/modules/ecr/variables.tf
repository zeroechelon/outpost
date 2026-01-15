# =============================================================================
# Outpost V2 - ECR Module Variables
# =============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "repository_names" {
  description = "List of ECR repository names to create"
  type        = list(string)
  default = [
    "outpost-base",
    "outpost-claude",
    "outpost-codex",
    "outpost-gemini",
    "outpost-aider",
    "outpost-grok"
  ]
}

variable "image_tag_mutability" {
  description = "Tag mutability setting for repositories"
  type        = string
  default     = "MUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.image_tag_mutability)
    error_message = "image_tag_mutability must be either MUTABLE or IMMUTABLE"
  }
}

variable "enable_scan_on_push" {
  description = "Enable image scanning on push"
  type        = bool
  default     = true
}

variable "image_retention_count" {
  description = "Number of tagged images to retain per repository"
  type        = number
  default     = 10

  validation {
    condition     = var.image_retention_count >= 1 && var.image_retention_count <= 1000
    error_message = "image_retention_count must be between 1 and 1000"
  }
}

variable "untagged_image_expiry_days" {
  description = "Days after which untagged images expire"
  type        = number
  default     = 7

  validation {
    condition     = var.untagged_image_expiry_days >= 1 && var.untagged_image_expiry_days <= 365
    error_message = "untagged_image_expiry_days must be between 1 and 365"
  }
}

variable "encryption_type" {
  description = "Encryption type for ECR repositories (AES256 or KMS)"
  type        = string
  default     = "AES256"

  validation {
    condition     = contains(["AES256", "KMS"], var.encryption_type)
    error_message = "encryption_type must be either AES256 or KMS"
  }
}

variable "kms_key_arn" {
  description = "KMS key ARN for repository encryption (required if encryption_type is KMS)"
  type        = string
  default     = null
}

variable "allowed_account_ids" {
  description = "List of AWS account IDs allowed to pull images (for cross-account access)"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags for ECR resources"
  type        = map(string)
  default     = {}
}
