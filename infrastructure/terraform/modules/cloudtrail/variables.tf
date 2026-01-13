# =============================================================================
# Outpost V2 - CloudTrail Module Variables
# =============================================================================

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "outpost"
}

variable "trail_name" {
  description = "Name for the CloudTrail trail"
  type        = string
  default     = "outpost-audit-trail"
}

variable "log_retention_days" {
  description = "S3 object retention period in days for audit logs"
  type        = number
  default     = 365
}

variable "enable_log_file_validation" {
  description = "Enable log file integrity validation"
  type        = bool
  default     = true
}

variable "include_global_service_events" {
  description = "Include events from global services (IAM, STS, etc.)"
  type        = bool
  default     = true
}

variable "is_multi_region_trail" {
  description = "Whether the trail should be multi-region"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
