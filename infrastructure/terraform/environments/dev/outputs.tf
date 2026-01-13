# =============================================================================
# Outpost V2 - Development Environment Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# ALB Outputs
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer for control plane access"
  value       = module.alb.alb_dns_name
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = module.alb.alb_arn
}

output "alb_zone_id" {
  description = "Hosted zone ID of the ALB (for Route53 alias records)"
  value       = module.alb.alb_zone_id
}

# -----------------------------------------------------------------------------
# Control Plane Access
# -----------------------------------------------------------------------------

output "control_plane_url" {
  description = "HTTP URL to access the control plane API"
  value       = "http://${module.alb.alb_dns_name}"
}

# -----------------------------------------------------------------------------
# VPC Outputs
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

# -----------------------------------------------------------------------------
# ECS Outputs
# -----------------------------------------------------------------------------

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.ecs.cluster_name_computed
}
