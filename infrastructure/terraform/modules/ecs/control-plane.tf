# =============================================================================
# Outpost V2 - Control Plane ECS Service Configuration (T3.8)
# =============================================================================
#
# Control Plane: HTTP API service for job dispatch, status, and management
# Runs as a Fargate service with desired_count = 1 for dev environment
#
# Architecture:
#   - Fargate task with 512 CPU / 1024 MB memory
#   - Private subnets, no public IP
#   - ARM64 for cost optimization
#   - CloudWatch logging
#
# =============================================================================

# -----------------------------------------------------------------------------
# Control Plane Task Definition
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "control_plane" {
  family                   = "outpost-${var.environment}-control-plane"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.control_plane_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "control-plane"
      image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.id}.amazonaws.com/outpost-control-plane:latest"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = data.aws_region.current.id },
        { name = "ENVIRONMENT", value = var.environment },
        { name = "LOG_LEVEL", value = "info" },
        { name = "DYNAMODB_JOBS_TABLE", value = var.jobs_table_name },
        { name = "DYNAMODB_TENANTS_TABLE", value = var.tenants_table_name },
        { name = "DYNAMODB_AUDIT_TABLE", value = var.audit_table_name },
        { name = "SQS_JOBS_QUEUE_URL", value = var.jobs_queue_url },
        { name = "S3_RESULTS_BUCKET", value = var.results_bucket_name },
        { name = "EFS_FILE_SYSTEM_ID", value = var.efs_file_system_id }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.control_plane.name
          "awslogs-region"        = data.aws_region.current.id
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 5
      }
    }
  ])

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-control-plane"
    Environment = var.environment
    Component   = "control-plane"
  })
}

# -----------------------------------------------------------------------------
# Control Plane CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "control_plane" {
  name              = "/ecs/outpost-control-plane"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, {
    Name        = "outpost-control-plane-logs"
    Environment = var.environment
    Component   = "control-plane"
  })
}

# -----------------------------------------------------------------------------
# Control Plane IAM Task Role
# -----------------------------------------------------------------------------
# Separate role for control plane with specific permissions

resource "aws_iam_role" "control_plane_task" {
  name = "outpost-${var.environment}-control-plane-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name      = "outpost-${var.environment}-control-plane-task"
    Component = "iam-role"
    Purpose   = "control-plane-task-role"
  })
}

# DynamoDB access for control plane
resource "aws_iam_role_policy" "control_plane_dynamodb" {
  name = "dynamodb-access"
  role = aws_iam_role.control_plane_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem"
        ]
        Resource = [
          var.jobs_table_arn,
          "${var.jobs_table_arn}/index/*",
          var.tenants_table_arn,
          "${var.tenants_table_arn}/index/*",
          var.audit_table_arn,
          "${var.audit_table_arn}/index/*"
        ]
      }
    ]
  })
}

# SQS access for control plane (send messages to job queue)
resource "aws_iam_role_policy" "control_plane_sqs" {
  name = "sqs-access"
  role = aws_iam_role.control_plane_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = var.jobs_queue_arn
      }
    ]
  })
}

# S3 access for control plane (presigned URLs for results)
resource "aws_iam_role_policy" "control_plane_s3" {
  name = "s3-access"
  role = aws_iam_role.control_plane_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.results_bucket_name}",
          "arn:aws:s3:::${var.results_bucket_name}/*"
        ]
      }
    ]
  })
}

# CloudWatch Logs access for control plane
resource "aws_iam_role_policy" "control_plane_logs" {
  name = "cloudwatch-logs-access"
  role = aws_iam_role.control_plane_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.control_plane.arn}:*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Control Plane ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "control_plane" {
  name            = "outpost-control-plane"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.control_plane.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.control_plane.id]
    assign_public_ip = false
  }

  # ALB integration (when enabled)
  dynamic "load_balancer" {
    for_each = var.enable_alb ? [1] : []
    content {
      target_group_arn = var.alb_target_group_arn
      container_name   = "control-plane"
      container_port   = 3000
    }
  }

  # Deployment configuration
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Enable ECS managed tags
  enable_ecs_managed_tags = true
  propagate_tags          = "TASK_DEFINITION"

  tags = merge(var.tags, {
    Name        = "outpost-control-plane"
    Environment = var.environment
    Component   = "control-plane"
  })

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_iam_role_policy.control_plane_dynamodb]
}

# -----------------------------------------------------------------------------
# Control Plane Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "control_plane" {
  name        = "outpost-${var.environment}-control-plane-sg"
  description = "Security group for Outpost control plane service"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-control-plane-sg"
    Environment = var.environment
    Component   = "control-plane"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Egress: HTTPS (443) for AWS API calls
resource "aws_security_group_rule" "control_plane_egress_https" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.control_plane.id
  description       = "Allow HTTPS outbound for AWS API calls"
}

# Egress: DNS (53) UDP for name resolution
resource "aws_security_group_rule" "control_plane_egress_dns_udp" {
  type              = "egress"
  from_port         = 53
  to_port           = 53
  protocol          = "udp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.control_plane.id
  description       = "Allow DNS UDP outbound"
}

# Egress: DNS (53) TCP for name resolution
resource "aws_security_group_rule" "control_plane_egress_dns_tcp" {
  type              = "egress"
  from_port         = 53
  to_port           = 53
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.control_plane.id
  description       = "Allow DNS TCP outbound"
}

# Ingress: Port 3000 from VPC (when ALB is disabled)
resource "aws_security_group_rule" "control_plane_ingress_http" {
  count             = var.enable_alb ? 0 : 1
  type              = "ingress"
  from_port         = 3000
  to_port           = 3000
  protocol          = "tcp"
  cidr_blocks       = ["10.0.0.0/16"] # VPC CIDR
  security_group_id = aws_security_group.control_plane.id
  description       = "Allow HTTP inbound from VPC"
}

# Ingress: Port 3000 from ALB (when ALB is enabled)
resource "aws_security_group_rule" "control_plane_ingress_from_alb" {
  count                    = var.enable_alb ? 1 : 0
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = var.alb_security_group_id
  security_group_id        = aws_security_group.control_plane.id
  description              = "Allow HTTP inbound from ALB"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "control_plane_task_definition_arn" {
  description = "ARN of the control plane task definition"
  value       = aws_ecs_task_definition.control_plane.arn
}

output "control_plane_service_name" {
  description = "Name of the control plane ECS service"
  value       = aws_ecs_service.control_plane.name
}

output "control_plane_service_arn" {
  description = "ARN of the control plane ECS service"
  value       = aws_ecs_service.control_plane.id
}

output "control_plane_security_group_id" {
  description = "Security group ID for control plane"
  value       = aws_security_group.control_plane.id
}

output "control_plane_log_group_name" {
  description = "CloudWatch log group name for control plane"
  value       = aws_cloudwatch_log_group.control_plane.name
}
