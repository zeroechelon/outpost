# =============================================================================
# Outpost V2 - VPC Module Variables
# =============================================================================
#
# This file defines all input variables for the VPC module.
#
# Required Variables:
#   - environment: Deployment environment (dev, staging, prod)
#   - availability_zones: List of AZs to deploy subnets
#
# Optional Variables (with sensible defaults):
#   - vpc_cidr: VPC CIDR block (default: 10.0.0.0/16)
#   - enable_nat_gateway: Enable NAT for private subnets (default: true)
#   - single_nat_gateway: Use single NAT for cost savings (default: false)
#   - tags: Additional tags for resources
#
# =============================================================================

# -----------------------------------------------------------------------------
# Required Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "availability_zones" {
  description = "List of availability zones to deploy subnets (minimum 2 for HA)"
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "At least 2 availability zones are required for high availability."
  }
}

# -----------------------------------------------------------------------------
# Network Configuration
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "VPC CIDR must be a valid IPv4 CIDR block."
  }
}

# -----------------------------------------------------------------------------
# NAT Gateway Configuration
# -----------------------------------------------------------------------------

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnet outbound internet access"
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = <<-EOT
    Use a single NAT Gateway for all AZs instead of one per AZ.
    Reduces cost but creates single point of failure.
    Recommended: true for dev/staging, false for prod.
  EOT
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Flow Logs Configuration
# -----------------------------------------------------------------------------

variable "enable_flow_logs" {
  description = "Enable VPC Flow Logs for network monitoring"
  type        = bool
  default     = true
}

variable "flow_logs_retention_days" {
  description = "Number of days to retain VPC Flow Logs"
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653], var.flow_logs_retention_days)
    error_message = "Flow logs retention must be a valid CloudWatch Logs retention period."
  }
}

# -----------------------------------------------------------------------------
# Tagging
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Additional tags to apply to all VPC resources"
  type        = map(string)
  default     = {}
}

variable "project" {
  description = "Project name for resource naming and tagging"
  type        = string
  default     = "outpost"
}
