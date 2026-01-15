# =============================================================================
# Outpost V2 - ALB Module Variables
# =============================================================================
#
# This file defines all input variables for the ALB module.
#
# Required Variables:
#   - environment: Deployment environment (dev, staging, prod)
#   - vpc_id: VPC ID for target group and security group
#   - vpc_cidr: VPC CIDR block for security group egress rules
#   - public_subnet_ids: List of public subnet IDs for ALB placement
#
# Optional Variables:
#   - control_plane_port: Port for control plane service (default: 3000)
#   - health_check_path: Health check endpoint (default: /health/live)
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

variable "vpc_id" {
  description = "VPC ID for target group and security group associations"
  type        = string

  validation {
    condition     = can(regex("^vpc-", var.vpc_id))
    error_message = "VPC ID must start with 'vpc-'."
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group egress rules"
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "VPC CIDR must be a valid IPv4 CIDR block."
  }
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs for ALB placement (minimum 2 for HA)"
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "At least 2 public subnets are required for ALB high availability."
  }
}

# -----------------------------------------------------------------------------
# Control Plane Configuration
# -----------------------------------------------------------------------------

variable "control_plane_port" {
  description = "Port the control plane service listens on"
  type        = number
  default     = 3000

  validation {
    condition     = var.control_plane_port > 0 && var.control_plane_port < 65536
    error_message = "Control plane port must be between 1 and 65535."
  }
}

variable "health_check_path" {
  description = "Health check endpoint path (should not have EFS dependency)"
  type        = string
  default     = "/health/live"
}

variable "health_check_healthy_threshold" {
  description = "Number of consecutive successful health checks to mark target healthy"
  type        = number
  default     = 2

  validation {
    condition     = var.health_check_healthy_threshold >= 2 && var.health_check_healthy_threshold <= 10
    error_message = "Healthy threshold must be between 2 and 10."
  }
}

variable "health_check_unhealthy_threshold" {
  description = "Number of consecutive failed health checks to mark target unhealthy"
  type        = number
  default     = 3

  validation {
    condition     = var.health_check_unhealthy_threshold >= 2 && var.health_check_unhealthy_threshold <= 10
    error_message = "Unhealthy threshold must be between 2 and 10."
  }
}

variable "health_check_interval" {
  description = "Interval between health checks in seconds"
  type        = number
  default     = 30

  validation {
    condition     = var.health_check_interval >= 5 && var.health_check_interval <= 300
    error_message = "Health check interval must be between 5 and 300 seconds."
  }
}

variable "health_check_timeout" {
  description = "Health check timeout in seconds"
  type        = number
  default     = 5

  validation {
    condition     = var.health_check_timeout >= 2 && var.health_check_timeout <= 120
    error_message = "Health check timeout must be between 2 and 120 seconds."
  }
}

# -----------------------------------------------------------------------------
# ALB Configuration
# -----------------------------------------------------------------------------

variable "alb_name" {
  description = "Name for the Application Load Balancer"
  type        = string
  default     = "outpost-control-plane"
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for the ALB (recommended for production)"
  type        = bool
  default     = false
}

variable "idle_timeout" {
  description = "Idle timeout for ALB connections in seconds"
  type        = number
  default     = 60

  validation {
    condition     = var.idle_timeout >= 1 && var.idle_timeout <= 4000
    error_message = "Idle timeout must be between 1 and 4000 seconds."
  }
}

# -----------------------------------------------------------------------------
# Tagging
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Additional tags to apply to all ALB resources"
  type        = map(string)
  default     = {}
}

variable "project" {
  description = "Project name for resource naming and tagging"
  type        = string
  default     = "outpost"
}
