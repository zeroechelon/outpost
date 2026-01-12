# =============================================================================
# Outpost V2 - Monitoring Module Variables
# =============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster to monitor"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention period in days"
  type        = number
  default     = 30
}

variable "alarm_email_endpoints" {
  description = "Email addresses for alarm notifications"
  type        = list(string)
  default     = []
}

variable "enable_detailed_monitoring" {
  description = "Enable detailed monitoring metrics (additional cost)"
  type        = bool
  default     = false
}

variable "dashboard_name" {
  description = "Name for the CloudWatch dashboard"
  type        = string
  default     = "outpost-fleet"
}

variable "tags" {
  description = "Additional tags for monitoring resources"
  type        = map(string)
  default     = {}
}
