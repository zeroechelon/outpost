# =============================================================================
# Outpost V2 - VPC Module Outputs
# =============================================================================
#
# Outputs from this module for use by other modules (ECS, ECR, etc.)
#
# Network IDs:
#   - vpc_id: VPC identifier for resource associations
#   - public_subnet_ids: For load balancers and NAT gateways
#   - private_subnet_ids: For ECS tasks and internal resources
#
# Security:
#   - ecs_security_group_id: Security group for ECS task network access
#
# NAT:
#   - nat_gateway_ids: NAT gateway identifiers (for monitoring)
#
# =============================================================================

# -----------------------------------------------------------------------------
# VPC Outputs
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

# output "vpc_cidr_block" {
#   description = "CIDR block of the VPC"
#   value       = aws_vpc.main.cidr_block
# }

# -----------------------------------------------------------------------------
# Subnet Outputs
# -----------------------------------------------------------------------------

output "public_subnet_ids" {
  description = "List of public subnet IDs (for load balancers, NAT gateways)"
  value       = aws_subnet.public[*].id
}

output "public_subnet_cidr_blocks" {
  description = "List of public subnet CIDR blocks"
  value       = aws_subnet.public[*].cidr_block
}

output "private_subnet_ids" {
  description = "List of private subnet IDs (for ECS tasks)"
  value       = aws_subnet.private[*].id
}

# output "private_subnet_cidr_blocks" {
#   description = "List of private subnet CIDR blocks"
#   value       = aws_subnet.private[*].cidr_block
# }

# -----------------------------------------------------------------------------
# Gateway Outputs
# -----------------------------------------------------------------------------

output "igw_id" {
  description = "ID of the Internet Gateway"
  value       = aws_internet_gateway.main.id
}

output "nat_gateway_ids" {
  description = "List of NAT Gateway IDs"
  value       = aws_nat_gateway.main[*].id
}

output "nat_eip_public_ips" {
  description = "List of NAT Gateway Elastic IP public addresses"
  value       = aws_eip.nat[*].public_ip
}

# -----------------------------------------------------------------------------
# Security Group Outputs
# -----------------------------------------------------------------------------

output "ecs_tasks_security_group_id" {
  description = "Security group ID for ECS tasks"
  value       = aws_security_group.ecs_tasks.id
}

output "ecs_tasks_security_group_arn" {
  description = "Security group ARN for ECS tasks"
  value       = aws_security_group.ecs_tasks.arn
}

output "efs_security_group_id" {
  description = "Security group ID for EFS mount targets"
  value       = aws_security_group.efs.id
}

output "efs_security_group_arn" {
  description = "Security group ARN for EFS mount targets"
  value       = aws_security_group.efs.arn
}

output "vpc_endpoints_security_group_id" {
  description = "Security group ID for VPC endpoints"
  value       = aws_security_group.vpc_endpoints.id
}

output "vpc_endpoints_security_group_arn" {
  description = "Security group ARN for VPC endpoints"
  value       = aws_security_group.vpc_endpoints.arn
}

# -----------------------------------------------------------------------------
# Route Table Outputs
# -----------------------------------------------------------------------------

output "public_route_table_id" {
  description = "ID of the public route table"
  value       = aws_route_table.public.id
}

output "private_route_table_ids" {
  description = "List of private route table IDs (single element if single_nat_gateway, one per AZ otherwise)"
  value       = var.single_nat_gateway || !var.enable_nat_gateway ? aws_route_table.private[*].id : aws_route_table.private_per_az[*].id
}

# -----------------------------------------------------------------------------
# Flow Logs Outputs
# -----------------------------------------------------------------------------

# output "flow_log_id" {
#   description = "ID of the VPC Flow Log"
#   value       = var.enable_flow_logs ? aws_flow_log.main[0].id : null
# }

# output "flow_log_cloudwatch_log_group" {
#   description = "CloudWatch Log Group for VPC Flow Logs"
#   value       = var.enable_flow_logs ? aws_cloudwatch_log_group.vpc_flow_logs[0].name : null
# }

# -----------------------------------------------------------------------------
# Availability Zone Outputs
# -----------------------------------------------------------------------------

# output "availability_zones" {
#   description = "List of availability zones used by this VPC"
#   value       = var.availability_zones
# }

# output "azs_count" {
#   description = "Number of availability zones"
#   value       = length(var.availability_zones)
# }
