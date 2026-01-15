# =============================================================================
# Outpost V2 - EFS Module
# =============================================================================
#
# Purpose: Persistent storage for agent workspaces
#
# Resources:
#   - EFS File System with encryption at rest
#   - Mount targets in each private subnet
#   - Access point for workspace root isolation
#   - Security group for EFS/NFS access from ECS
#   - Lifecycle policy for cost optimization
#
# Design:
#   Root access point at /workspaces provides workspace isolation for all agents.
#   Workspaces are retained for promote/artifact operations and transition to
#   Infrequent Access after 30 days for cost optimization.
#
# =============================================================================

# -----------------------------------------------------------------------------
# EFS File System
# -----------------------------------------------------------------------------
# Primary file system for all agent workspaces with encryption and lifecycle
# management. Performance mode is generalPurpose for mixed workloads.
# -----------------------------------------------------------------------------

resource "aws_efs_file_system" "workspaces" {
  creation_token = "outpost-${var.environment}-workspaces"
  encrypted      = true

  performance_mode = "generalPurpose"
  throughput_mode  = var.throughput_mode

  # Conditionally set provisioned throughput when using provisioned mode
  provisioned_throughput_in_mibps = var.throughput_mode == "provisioned" ? var.provisioned_throughput_mibps : null

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  # Transition back from IA on first access (cost optimization)
  lifecycle_policy {
    transition_to_primary_storage_class = "AFTER_1_ACCESS"
  }

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-workspaces"
    Environment = var.environment
    Purpose     = "outpost-agent-workspaces"
  })
}

# -----------------------------------------------------------------------------
# EFS Backup Policy
# -----------------------------------------------------------------------------
# Enable automatic backups via AWS Backup (recommended for production)
# -----------------------------------------------------------------------------

resource "aws_efs_backup_policy" "workspaces" {
  file_system_id = aws_efs_file_system.workspaces.id

  backup_policy {
    status = var.enable_backup ? "ENABLED" : "DISABLED"
  }
}

# -----------------------------------------------------------------------------
# Security Group for EFS
# -----------------------------------------------------------------------------
# Allow NFS (port 2049) traffic only from ECS task security group
# -----------------------------------------------------------------------------

resource "aws_security_group" "efs" {
  name        = "outpost-${var.environment}-efs-sg"
  description = "Security group for EFS mount targets - allows NFS from ECS"
  vpc_id      = var.vpc_id

  # Inbound: Allow NFS from ECS security group
  ingress {
    description     = "NFS from ECS tasks"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [var.ecs_security_group_id]
  }

  # Outbound: Allow all (default for EFS)
  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-efs-sg"
    Environment = var.environment
  })
}

# -----------------------------------------------------------------------------
# EFS Mount Targets
# -----------------------------------------------------------------------------
# Create a mount target in each private subnet for high availability.
# ECS tasks connect to the mount target in their subnet.
# -----------------------------------------------------------------------------

resource "aws_efs_mount_target" "main" {
  count = length(var.private_subnet_ids)

  file_system_id  = aws_efs_file_system.workspaces.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [aws_security_group.efs.id]
}

# -----------------------------------------------------------------------------
# EFS Access Point - Root Workspace Access
# -----------------------------------------------------------------------------
# Root access point at /workspaces directory for agent workspace operations.
# POSIX user mapping ensures consistent permissions across all operations.
# -----------------------------------------------------------------------------

resource "aws_efs_access_point" "root" {
  file_system_id = aws_efs_file_system.workspaces.id

  root_directory {
    path = "/workspaces"

    # Auto-create directory if it doesn't exist
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }

  # POSIX user identity for all operations through this access point
  posix_user {
    gid = 1000
    uid = 1000
  }

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-root"
    Environment = var.environment
    Purpose     = "root-workspace-access"
  })
}
