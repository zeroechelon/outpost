# =============================================================================
# Outpost V2 - ECS Fargate Cluster Module
# =============================================================================
# Multi-agent ECS cluster with Fargate capacity providers
# Supports: claude, codex, gemini, aider, grok agents
# =============================================================================

locals {
  cluster_name = "${var.cluster_name}-${var.environment}"
}

# -----------------------------------------------------------------------------
# ECS Cluster with Fargate Capacity Providers
# -----------------------------------------------------------------------------

# resource "aws_ecs_cluster" "main" {
#   name = local.cluster_name
#
#   setting {
#     name  = "containerInsights"
#     value = "enabled"
#   }
#
#   tags = merge(var.tags, {
#     Name        = local.cluster_name
#     Component   = "ecs-cluster"
#     Application = "outpost-v2"
#   })
# }

# -----------------------------------------------------------------------------
# Fargate Capacity Providers
# -----------------------------------------------------------------------------

# resource "aws_ecs_cluster_capacity_providers" "main" {
#   cluster_name = aws_ecs_cluster.main.name
#
#   capacity_providers = ["FARGATE", "FARGATE_SPOT"]
#
#   # Default strategy: prefer FARGATE_SPOT for cost optimization
#   # Fall back to FARGATE for guaranteed capacity
#   default_capacity_provider_strategy {
#     base              = 1
#     weight            = 1
#     capacity_provider = "FARGATE"
#   }
#
#   default_capacity_provider_strategy {
#     base              = 0
#     weight            = 4
#     capacity_provider = "FARGATE_SPOT"
#   }
# }

# -----------------------------------------------------------------------------
# CloudWatch Log Group for ECS Tasks
# -----------------------------------------------------------------------------

# resource "aws_cloudwatch_log_group" "agents" {
#   for_each = var.agent_configs
#
#   name              = "/aws/ecs/${local.cluster_name}/${each.key}"
#   retention_in_days = var.log_retention_days
#
#   tags = merge(var.tags, {
#     Name      = "${local.cluster_name}-${each.key}-logs"
#     Component = "cloudwatch-logs"
#     Agent     = each.key
#   })
# }

# -----------------------------------------------------------------------------
# Security Group for ECS Tasks
# -----------------------------------------------------------------------------

# resource "aws_security_group" "ecs_tasks" {
#   name        = "${local.cluster_name}-ecs-tasks-sg"
#   description = "Security group for ECS Fargate tasks"
#   vpc_id      = var.vpc_id
#
#   # Outbound: Allow all (tasks need to reach ECR, CloudWatch, Secrets Manager, etc.)
#   egress {
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     cidr_blocks = ["0.0.0.0/0"]
#     description = "Allow all outbound traffic"
#   }
#
#   # Inbound: None by default - tasks are workers, not servers
#   # Add rules if tasks need to receive traffic
#
#   tags = merge(var.tags, {
#     Name      = "${local.cluster_name}-ecs-tasks-sg"
#     Component = "security-group"
#   })
# }

# -----------------------------------------------------------------------------
# ECS Service (Optional - for long-running workers)
# -----------------------------------------------------------------------------

# resource "aws_ecs_service" "agents" {
#   for_each = var.agent_configs
#
#   name            = "${local.cluster_name}-${each.key}"
#   cluster         = aws_ecs_cluster.main.id
#   task_definition = aws_ecs_task_definition.agents[each.key].arn
#   desired_count   = each.value.desired_count
#   launch_type     = "FARGATE"
#
#   network_configuration {
#     subnets          = var.private_subnet_ids
#     security_groups  = [aws_security_group.ecs_tasks.id]
#     assign_public_ip = false
#   }
#
#   capacity_provider_strategy {
#     capacity_provider = each.value.use_spot ? "FARGATE_SPOT" : "FARGATE"
#     weight            = 1
#   }
#
#   # Deployment configuration
#   deployment_minimum_healthy_percent = 50
#   deployment_maximum_percent         = 200
#
#   # Enable ECS managed tags
#   enable_ecs_managed_tags = true
#   propagate_tags          = "TASK_DEFINITION"
#
#   tags = merge(var.tags, {
#     Name      = "${local.cluster_name}-${each.key}-service"
#     Component = "ecs-service"
#     Agent     = each.key
#   })
#
#   lifecycle {
#     ignore_changes = [desired_count]
#   }
# }
