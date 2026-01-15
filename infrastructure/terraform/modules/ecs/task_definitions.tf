# =============================================================================
# Outpost V2 - ECS Task Definitions
# =============================================================================
# Per-agent task definitions for Fargate execution
# Agents: claude, codex, gemini, aider, grok
# ARM64 architecture for cost optimization
# =============================================================================

# -----------------------------------------------------------------------------
# Agent Configuration (T1.3.4)
# -----------------------------------------------------------------------------

locals {
  agent_task_configs = {
    claude = {
      image_tag = "latest"
      cpu       = 1024
      memory    = 2048
      secrets   = ["ANTHROPIC_API_KEY"]
    }
    codex = {
      image_tag = "latest"
      cpu       = 1024
      memory    = 2048
      secrets   = ["OPENAI_API_KEY"]
    }
    gemini = {
      image_tag = "latest"
      cpu       = 1024
      memory    = 2048
      secrets   = ["GOOGLE_API_KEY"]
    }
    aider = {
      image_tag = "latest"
      cpu       = 512
      memory    = 1024
      secrets   = ["DEEPSEEK_API_KEY"]
    }
    grok = {
      image_tag = "latest"
      cpu       = 1024
      memory    = 2048
      secrets   = ["XAI_API_KEY"]
    }
  }
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Task Definitions for Each Agent Type
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "agent" {
  for_each = local.agent_task_configs

  family                   = "outpost-${var.environment}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # Worker images built for AMD64
  }

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = "${var.ecr_repository_urls[each.key]}:${each.value.image_tag}"
      essential = true

      environment = [
        { name = "AGENT_TYPE", value = each.key },
        { name = "ENVIRONMENT", value = var.environment }
      ]

      secrets = [
        for secret in each.value.secrets : {
          name      = secret
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:secret:/outpost/api-keys/${lower(replace(secret, "_API_KEY", ""))}"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agents[each.key].name
          "awslogs-region"        = data.aws_region.current.id
          "awslogs-stream-prefix" = "ecs"
        }
      }

      mountPoints = var.enable_efs ? [
        {
          sourceVolume  = "workspaces"
          containerPath = "/workspaces"
          readOnly      = false
        }
      ] : []
    }
  ])

  dynamic "volume" {
    for_each = var.enable_efs ? [1] : []
    content {
      name = "workspaces"
      efs_volume_configuration {
        file_system_id     = var.efs_file_system_id
        transit_encryption = "ENABLED"
        authorization_config {
          access_point_id = var.efs_access_point_id
          iam             = "ENABLED"
        }
      }
    }
  }

  tags = {
    Name        = "outpost-${var.environment}-${each.key}"
    Environment = var.environment
    Agent       = each.key
  }
}
