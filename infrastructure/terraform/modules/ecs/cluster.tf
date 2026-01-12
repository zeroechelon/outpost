# =============================================================================
# Outpost V2 - ECS Fargate Cluster
# =============================================================================
# T1.3.1: ECS Fargate cluster with capacity providers
# =============================================================================

# -----------------------------------------------------------------------------
# ECS Cluster
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "outpost-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }

  tags = {
    Name        = "outpost-${var.environment}"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# Fargate Capacity Providers
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 1
    capacity_provider = "FARGATE"
  }

  default_capacity_provider_strategy {
    weight            = 4
    capacity_provider = "FARGATE_SPOT"
  }
}
