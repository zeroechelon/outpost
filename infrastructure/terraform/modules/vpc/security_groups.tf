# =============================================================================
# Outpost V2 - VPC Module Security Groups
# =============================================================================
#
# Purpose: Network security for Outpost ECS tasks and supporting infrastructure
#
# Security Groups:
#   - ecs_tasks: Outbound-only access for ECS Fargate tasks
#   - efs: Allows NFS access from ECS tasks to EFS mount targets
#   - vpc_endpoints: Allows HTTPS from VPC for PrivateLink endpoints
#
# Design Decisions:
#   - ECS tasks have NO ingress rules (tasks don't receive inbound connections)
#   - Egress limited to specific ports: HTTPS (443), Git SSH (22), DNS (53)
#   - EFS security group allows NFS only from ecs_tasks security group
#   - VPC endpoints allow HTTPS from VPC CIDR only
#
# =============================================================================

# -----------------------------------------------------------------------------
# Security Group: ECS Tasks
# -----------------------------------------------------------------------------
#
# Outbound-only security group for ECS Fargate tasks.
# Tasks need to:
#   - Make HTTPS API calls (OpenAI, Anthropic, GitHub API, ECR, etc.)
#   - Clone repositories via Git SSH
#   - Resolve DNS queries
#
# NO ingress rules - tasks are ephemeral and don't accept inbound connections.
#
# -----------------------------------------------------------------------------

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.environment}-outpost-ecs-tasks-sg"
  description = "Security group for Outpost ECS tasks"
  vpc_id      = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-ecs-tasks-sg"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "ecs-tasks"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Egress: HTTPS (443) for API calls (OpenAI, Anthropic, GitHub API, ECR, etc.)
resource "aws_security_group_rule" "ecs_tasks_egress_https" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_tasks.id
  description       = "Allow HTTPS outbound for API calls"
}

# Egress: Git SSH (22) for GitHub repository cloning
resource "aws_security_group_rule" "ecs_tasks_egress_ssh" {
  type              = "egress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_tasks.id
  description       = "Allow SSH outbound for Git clone operations"
}

# Egress: DNS (53) UDP for name resolution
resource "aws_security_group_rule" "ecs_tasks_egress_dns_udp" {
  type              = "egress"
  from_port         = 53
  to_port           = 53
  protocol          = "udp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_tasks.id
  description       = "Allow DNS UDP outbound for name resolution"
}

# Egress: DNS (53) TCP for large DNS responses (zone transfers, DNSSEC)
resource "aws_security_group_rule" "ecs_tasks_egress_dns_tcp" {
  type              = "egress"
  from_port         = 53
  to_port           = 53
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_tasks.id
  description       = "Allow DNS TCP outbound for large DNS responses"
}

# Egress: NFS (2049) to EFS security group for workspace storage
resource "aws_security_group_rule" "ecs_tasks_egress_nfs" {
  type                     = "egress"
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.efs.id
  security_group_id        = aws_security_group.ecs_tasks.id
  description              = "Allow NFS outbound to EFS mount targets"
}

# -----------------------------------------------------------------------------
# Security Group: EFS Mount Targets
# -----------------------------------------------------------------------------
#
# Security group for EFS mount targets.
# Only allows NFS ingress from ECS tasks security group.
# No egress needed - EFS is a passive file system.
#
# -----------------------------------------------------------------------------

resource "aws_security_group" "efs" {
  name        = "${var.environment}-outpost-efs-sg"
  description = "Security group for EFS mount targets"
  vpc_id      = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-efs-sg"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "efs"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Ingress: NFS (2049) from ECS tasks security group only
resource "aws_security_group_rule" "efs_ingress_nfs" {
  type                     = "ingress"
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.efs.id
  description              = "Allow NFS from ECS tasks"
}

# -----------------------------------------------------------------------------
# Security Group: VPC Endpoints (PrivateLink)
# -----------------------------------------------------------------------------
#
# Security group for VPC interface endpoints (ECR, CloudWatch, S3, etc.).
# Allows HTTPS ingress from VPC CIDR only.
# Enables private connectivity to AWS services without NAT Gateway.
#
# -----------------------------------------------------------------------------

resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.environment}-outpost-vpc-endpoints-sg"
  description = "Security group for VPC endpoints"
  vpc_id      = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-vpc-endpoints-sg"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "vpc-endpoints"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Ingress: HTTPS (443) from VPC CIDR for PrivateLink access
resource "aws_security_group_rule" "vpc_endpoints_ingress_https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = [var.vpc_cidr]
  security_group_id = aws_security_group.vpc_endpoints.id
  description       = "Allow HTTPS from VPC CIDR for PrivateLink"
}
