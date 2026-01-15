# S3 Lifecycle Configuration Module - Variables
# Reusable module for applying lifecycle policies to S3 buckets

variable "bucket_id" {
  description = "The ID of the S3 bucket to apply lifecycle configuration to"
  type        = string
}

variable "rule_id" {
  description = "Unique identifier for the lifecycle rule"
  type        = string
  default     = "lifecycle-rule"
}

variable "ia_transition_days" {
  description = "Number of days before transitioning objects to STANDARD_IA storage class"
  type        = number
  default     = 30

  validation {
    condition     = var.ia_transition_days >= 30
    error_message = "STANDARD_IA transition requires minimum 30 days."
  }
}

variable "glacier_transition_days" {
  description = "Number of days before transitioning objects to GLACIER storage class"
  type        = number
  default     = 90

  validation {
    condition     = var.glacier_transition_days >= 90
    error_message = "GLACIER transition requires minimum 90 days from object creation."
  }
}

variable "expiration_days" {
  description = "Number of days before objects expire and are deleted"
  type        = number
  default     = 180

  validation {
    condition     = var.expiration_days > 0
    error_message = "Expiration days must be greater than 0."
  }
}

variable "noncurrent_expiration_days" {
  description = "Number of days before noncurrent object versions expire"
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_expiration_days > 0
    error_message = "Noncurrent expiration days must be greater than 0."
  }
}

variable "enable_glacier" {
  description = "Whether to enable GLACIER transition (set false for faster access requirements)"
  type        = bool
  default     = true
}

variable "abort_incomplete_multipart_days" {
  description = "Number of days after which incomplete multipart uploads are aborted"
  type        = number
  default     = 7

  validation {
    condition     = var.abort_incomplete_multipart_days > 0
    error_message = "Abort incomplete multipart days must be greater than 0."
  }
}

variable "filter_prefix" {
  description = "Optional prefix filter for lifecycle rule (empty string means apply to all objects)"
  type        = string
  default     = ""
}

variable "enabled" {
  description = "Whether the lifecycle rule is enabled"
  type        = bool
  default     = true
}
