resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project_name}-worker-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = var.image_uri
      essential = true
      
      environment = [
        { name = "ENVIRONMENT", value = var.environment },
        { name = "JOBS_QUEUE_URL", value = var.jobs_queue_url },
        { name = "JOBS_TABLE", value = "${var.project_name}-jobs-${var.environment}" },
        { name = "TENANTS_TABLE", value = "${var.project_name}-tenants-${var.environment}" },
        { name = "AUDIT_TABLE", value = "${var.project_name}-audit-${var.environment}" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/ecs/${var.project_name}-worker-${var.environment}"
  retention_in_days = 30
}

data "aws_region" "current" {}
