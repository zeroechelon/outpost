# =============================================================================
# Outpost V2 - ALB Security Group
# =============================================================================
#
# Purpose: Network security for the Application Load Balancer
#
# Security Group Rules:
#   - Ingress: HTTP (80) and HTTPS (443) from internet (0.0.0.0/0)
#   - Egress: Port 3000 to VPC CIDR (control plane communication)
#
# Design Decisions:
#   - Restricted egress to only the control plane port for defense-in-depth
#   - HTTPS listener will be added in T1.2 with ACM certificate
#   - HTTP listener initially for basic connectivity validation
#
# =============================================================================

# -----------------------------------------------------------------------------
# ALB Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.alb_name}-${var.environment}-sg"
  description = "Security group for Outpost control plane ALB"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name        = "${var.alb_name}-${var.environment}-sg"
    Environment = var.environment
    Component   = "alb-security-group"
    Project     = var.project
  })

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Ingress Rules - Internet Access
# -----------------------------------------------------------------------------

resource "aws_security_group_rule" "alb_ingress_http" {
  type              = "ingress"
  description       = "Allow HTTP traffic from internet"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_ingress_https" {
  type              = "ingress"
  description       = "Allow HTTPS traffic from internet"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.alb.id
}

# -----------------------------------------------------------------------------
# Egress Rules - Control Plane Communication
# -----------------------------------------------------------------------------

resource "aws_security_group_rule" "alb_egress_control_plane" {
  type              = "egress"
  description       = "Allow traffic to control plane on VPC CIDR"
  from_port         = var.control_plane_port
  to_port           = var.control_plane_port
  protocol          = "tcp"
  cidr_blocks       = [var.vpc_cidr]
  security_group_id = aws_security_group.alb.id
}
