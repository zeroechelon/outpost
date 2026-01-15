# =============================================================================
# Outpost V2 Commander Platform - Root Variables
# =============================================================================

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region for resource deployment"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "outpost"
}

variable "owner" {
  description = "Owner tag for resource identification"
  type        = string
  default     = "zeroechelon"
}

variable "cost_center" {
  description = "Cost center tag for billing allocation"
  type        = string
  default     = "outpost-v2"
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
