# =============================================================================
# Outpost V2 - EFS Module Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# File System Outputs
# -----------------------------------------------------------------------------

output "filesystem_id" {
  description = "ID of the EFS file system"
  value       = aws_efs_file_system.workspaces.id
}

output "filesystem_arn" {
  description = "ARN of the EFS file system"
  value       = aws_efs_file_system.workspaces.arn
}

output "filesystem_dns_name" {
  description = "DNS name of the EFS file system (for mounting)"
  value       = aws_efs_file_system.workspaces.dns_name
}

# -----------------------------------------------------------------------------
# Mount Target Outputs
# -----------------------------------------------------------------------------

output "mount_target_ids" {
  description = "IDs of the EFS mount targets (one per subnet)"
  value       = aws_efs_mount_target.main[*].id
}

output "mount_target_dns_names" {
  description = "DNS names of the EFS mount targets"
  value       = aws_efs_mount_target.main[*].dns_name
}

output "mount_target_network_interface_ids" {
  description = "Network interface IDs of the EFS mount targets"
  value       = aws_efs_mount_target.main[*].network_interface_id
}

# -----------------------------------------------------------------------------
# Security Group Outputs
# -----------------------------------------------------------------------------

output "security_group_id" {
  description = "Security group ID for EFS access"
  value       = aws_security_group.efs.id
}

output "security_group_arn" {
  description = "Security group ARN for EFS access"
  value       = aws_security_group.efs.arn
}

# -----------------------------------------------------------------------------
# Access Point Outputs
# -----------------------------------------------------------------------------

output "root_access_point_id" {
  description = "ID of the root access point"
  value       = aws_efs_access_point.root.id
}

output "root_access_point_arn" {
  description = "ARN of the root access point"
  value       = aws_efs_access_point.root.arn
}

# -----------------------------------------------------------------------------
# Composite Outputs (useful for ECS task definitions)
# -----------------------------------------------------------------------------

output "efs_config" {
  description = "EFS configuration object for ECS task definitions"
  value = {
    file_system_id     = aws_efs_file_system.workspaces.id
    root_directory     = "/"
    transit_encryption = "ENABLED"
    authorization_config = {
      access_point_id = aws_efs_access_point.root.id
      iam             = "ENABLED"
    }
  }
}
