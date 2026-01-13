# =============================================================================
# Outpost V2 - ALB Module
# =============================================================================
#
# Purpose: Expose control plane publicly via Application Load Balancer
#
# This module creates:
#   - Application Load Balancer (internet-facing)
#   - Target Group (IP type for Fargate)
#   - HTTP Listener (port 80, HTTPS added in T1.2)
#   - Security Group (see security.tf)
#
# Design Decisions:
#   - Internet-facing ALB for public API access
#   - IP target type required for Fargate awsvpc networking
#   - Health check uses /health/live (no EFS dependency)
#   - HTTP listener initially; HTTPS with ACM certificate in T1.2
#
# Usage:
#   module "alb" {
#     source = "./modules/alb"
#
#     environment       = "dev"
#     vpc_id            = module.vpc.vpc_id
#     vpc_cidr          = "10.0.0.0/16"
#     public_subnet_ids = module.vpc.public_subnet_ids
#   }
#
# =============================================================================

# -----------------------------------------------------------------------------
# Application Load Balancer
# -----------------------------------------------------------------------------

resource "aws_lb" "control_plane" {
  name               = "${var.alb_name}-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.enable_deletion_protection
  idle_timeout               = var.idle_timeout

  tags = merge(var.tags, {
    Name        = "${var.alb_name}-${var.environment}"
    Environment = var.environment
    Component   = "application-load-balancer"
    Project     = var.project
  })
}

# -----------------------------------------------------------------------------
# Target Group - Control Plane
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "control_plane" {
  name        = "${var.alb_name}-tg-${var.environment}"
  port        = var.control_plane_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # Required for Fargate

  health_check {
    enabled             = true
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = var.health_check_healthy_threshold
    unhealthy_threshold = var.health_check_unhealthy_threshold
    interval            = var.health_check_interval
    timeout             = var.health_check_timeout
    matcher             = "200"
  }

  # Enable stickiness for consistent routing (optional, disabled by default)
  stickiness {
    type            = "lb_cookie"
    enabled         = false
    cookie_duration = 86400
  }

  tags = merge(var.tags, {
    Name        = "${var.alb_name}-tg-${var.environment}"
    Environment = var.environment
    Component   = "target-group"
    Project     = var.project
  })

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# HTTP Listener (Port 80)
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.control_plane.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.control_plane.arn
  }

  tags = merge(var.tags, {
    Name        = "${var.alb_name}-http-listener-${var.environment}"
    Environment = var.environment
    Component   = "listener"
    Project     = var.project
  })
}

# -----------------------------------------------------------------------------
# HTTPS Listener (Port 443) - To be added in T1.2
# -----------------------------------------------------------------------------
# The HTTPS listener requires an ACM certificate, which will be provisioned
# in task T1.2. The listener configuration will be:
#
# resource "aws_lb_listener" "https" {
#   load_balancer_arn = aws_lb.control_plane.arn
#   port              = 443
#   protocol          = "HTTPS"
#   ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
#   certificate_arn   = var.certificate_arn
#
#   default_action {
#     type             = "forward"
#     target_group_arn = aws_lb_target_group.control_plane.arn
#   }
# }
#
# HTTP to HTTPS redirect will also be configured in T1.2.
