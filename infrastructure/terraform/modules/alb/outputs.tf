# =============================================================================
# Outpost V2 - ALB Module Outputs
# =============================================================================
#
# Outputs from this module for use by other modules (ECS, Route53, etc.)
#
# Load Balancer:
#   - alb_dns_name: DNS name for accessing the control plane
#   - alb_arn: ARN for IAM policies and monitoring
#   - alb_zone_id: Hosted zone ID for Route53 alias records
#
# Target Group:
#   - target_group_arn: ARN for ECS service load balancer configuration
#
# Security:
#   - security_group_id: Security group ID for ECS task ingress rules
#
# =============================================================================

# -----------------------------------------------------------------------------
# Load Balancer Outputs
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.control_plane.dns_name
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.control_plane.arn
}

output "alb_arn_suffix" {
  description = "ARN suffix of the ALB for CloudWatch metrics"
  value       = aws_lb.control_plane.arn_suffix
}

output "alb_zone_id" {
  description = "Hosted zone ID of the ALB for Route53 alias records"
  value       = aws_lb.control_plane.zone_id
}

output "alb_name" {
  description = "Name of the Application Load Balancer"
  value       = aws_lb.control_plane.name
}

# -----------------------------------------------------------------------------
# Target Group Outputs
# -----------------------------------------------------------------------------

output "target_group_arn" {
  description = "ARN of the target group for ECS service configuration"
  value       = aws_lb_target_group.control_plane.arn
}

output "target_group_arn_suffix" {
  description = "ARN suffix of the target group for CloudWatch metrics"
  value       = aws_lb_target_group.control_plane.arn_suffix
}

output "target_group_name" {
  description = "Name of the target group"
  value       = aws_lb_target_group.control_plane.name
}

# -----------------------------------------------------------------------------
# Security Group Outputs
# -----------------------------------------------------------------------------

output "security_group_id" {
  description = "ID of the ALB security group"
  value       = aws_security_group.alb.id
}

output "security_group_arn" {
  description = "ARN of the ALB security group"
  value       = aws_security_group.alb.arn
}

# -----------------------------------------------------------------------------
# Listener Outputs
# -----------------------------------------------------------------------------

output "http_listener_arn" {
  description = "ARN of the HTTP listener"
  value       = aws_lb_listener.http.arn
}

# Note: HTTPS listener ARN will be added in T1.2
# output "https_listener_arn" {
#   description = "ARN of the HTTPS listener"
#   value       = aws_lb_listener.https.arn
# }
