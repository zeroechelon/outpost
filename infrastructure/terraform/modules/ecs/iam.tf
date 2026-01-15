# =============================================================================
# Outpost V2 - ECS IAM Roles and Policies
# =============================================================================
# Task execution role: ECS agent permissions (pull images, write logs)
# Task role: Container permissions (what the application can do)
# =============================================================================

locals {
  execution_role_name = "outpost-${var.environment}-ecs-execution"
  task_role_name      = "${var.cluster_name}-task-role-${var.environment}"
}

# -----------------------------------------------------------------------------
# Task Execution Role (ECS Agent)
# -----------------------------------------------------------------------------
# This role is used by the ECS agent to:
# - Pull container images from ECR
# - Write logs to CloudWatch
# - Retrieve secrets from Secrets Manager (for container startup)

resource "aws_iam_role" "execution" {
  name = local.execution_role_name

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
    Name      = local.execution_role_name
    Component = "iam-role"
    Purpose   = "task-execution"
  })
}

# Attach AWS managed policy for ECS task execution
resource "aws_iam_role_policy_attachment" "execution_ecr" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Custom inline policy for Secrets Manager access during task startup
resource "aws_iam_role_policy" "execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.execution.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:*:*:secret:/outpost/*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = var.kms_key_arn != "" ? [var.kms_key_arn] : ["*"]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Task Role (Container Application)
# -----------------------------------------------------------------------------
# This role is assumed by the running container and defines what
# the application can do (access DynamoDB, SQS, S3, etc.)

# resource "aws_iam_role" "task_role" {
#   name = local.task_role_name
#
#   assume_role_policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Action = "sts:AssumeRole"
#         Effect = "Allow"
#         Principal = {
#           Service = "ecs-tasks.amazonaws.com"
#         }
#         Condition = {
#           ArnLike = {
#             "aws:SourceArn" = "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"
#           }
#           StringEquals = {
#             "aws:SourceAccount" = data.aws_caller_identity.current.account_id
#           }
#         }
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name      = local.task_role_name
#     Component = "iam-role"
#     Purpose   = "task-role"
#   })
# }

# -----------------------------------------------------------------------------
# Task Role Policy - SQS Access
# -----------------------------------------------------------------------------

# resource "aws_iam_policy" "task_sqs_access" {
#   name        = "${var.cluster_name}-task-sqs-${var.environment}"
#   description = "Allow ECS tasks to receive and process messages from SQS"
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Sid    = "SQSAccess"
#         Effect = "Allow"
#         Action = [
#           "sqs:ReceiveMessage",
#           "sqs:DeleteMessage",
#           "sqs:GetQueueAttributes",
#           "sqs:GetQueueUrl",
#           "sqs:ChangeMessageVisibility"
#         ]
#         Resource = var.jobs_queue_arn
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name      = "${var.cluster_name}-task-sqs-${var.environment}"
#     Component = "iam-policy"
#   })
# }

# resource "aws_iam_role_policy_attachment" "task_sqs" {
#   role       = aws_iam_role.task_role.name
#   policy_arn = aws_iam_policy.task_sqs_access.arn
# }

# -----------------------------------------------------------------------------
# Task Role Policy - DynamoDB Access
# -----------------------------------------------------------------------------

# resource "aws_iam_policy" "task_dynamodb_access" {
#   name        = "${var.cluster_name}-task-dynamodb-${var.environment}"
#   description = "Allow ECS tasks to read/write DynamoDB tables"
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Sid    = "DynamoDBAccess"
#         Effect = "Allow"
#         Action = [
#           "dynamodb:GetItem",
#           "dynamodb:PutItem",
#           "dynamodb:UpdateItem",
#           "dynamodb:DeleteItem",
#           "dynamodb:Query",
#           "dynamodb:Scan",
#           "dynamodb:BatchGetItem",
#           "dynamodb:BatchWriteItem"
#         ]
#         Resource = [
#           var.jobs_table_arn,
#           "${var.jobs_table_arn}/index/*",
#           var.tenants_table_arn,
#           "${var.tenants_table_arn}/index/*",
#           var.audit_table_arn,
#           "${var.audit_table_arn}/index/*"
#         ]
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name      = "${var.cluster_name}-task-dynamodb-${var.environment}"
#     Component = "iam-policy"
#   })
# }

# resource "aws_iam_role_policy_attachment" "task_dynamodb" {
#   role       = aws_iam_role.task_role.name
#   policy_arn = aws_iam_policy.task_dynamodb_access.arn
# }

# -----------------------------------------------------------------------------
# Task Role Policy - S3 Access (Results Bucket)
# -----------------------------------------------------------------------------

# resource "aws_iam_policy" "task_s3_access" {
#   name        = "${var.cluster_name}-task-s3-${var.environment}"
#   description = "Allow ECS tasks to write results to S3"
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Sid    = "S3ResultsAccess"
#         Effect = "Allow"
#         Action = [
#           "s3:PutObject",
#           "s3:GetObject",
#           "s3:DeleteObject",
#           "s3:ListBucket"
#         ]
#         Resource = [
#           "arn:aws:s3:::${var.results_bucket_name}",
#           "arn:aws:s3:::${var.results_bucket_name}/*"
#         ]
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name      = "${var.cluster_name}-task-s3-${var.environment}"
#     Component = "iam-policy"
#   })
# }

# resource "aws_iam_role_policy_attachment" "task_s3" {
#   role       = aws_iam_role.task_role.name
#   policy_arn = aws_iam_policy.task_s3_access.arn
# }

# -----------------------------------------------------------------------------
# Task Role Policy - Secrets Manager Access (Runtime)
# -----------------------------------------------------------------------------

# resource "aws_iam_policy" "task_secrets_access" {
#   name        = "${var.cluster_name}-task-secrets-${var.environment}"
#   description = "Allow ECS tasks to retrieve secrets at runtime"
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Sid    = "SecretsAccess"
#         Effect = "Allow"
#         Action = [
#           "secretsmanager:GetSecretValue",
#           "secretsmanager:DescribeSecret"
#         ]
#         Resource = [
#           "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:${var.secrets_manager_prefix}/*"
#         ]
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name      = "${var.cluster_name}-task-secrets-${var.environment}"
#     Component = "iam-policy"
#   })
# }

# resource "aws_iam_role_policy_attachment" "task_secrets" {
#   role       = aws_iam_role.task_role.name
#   policy_arn = aws_iam_policy.task_secrets_access.arn
# }

# -----------------------------------------------------------------------------
# Task Role Policy - CloudWatch Logs (Application Logging)
# -----------------------------------------------------------------------------

# resource "aws_iam_policy" "task_logs_access" {
#   name        = "${var.cluster_name}-task-logs-${var.environment}"
#   description = "Allow ECS tasks to write application logs"
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Sid    = "CloudWatchLogs"
#         Effect = "Allow"
#         Action = [
#           "logs:CreateLogStream",
#           "logs:PutLogEvents",
#           "logs:DescribeLogStreams"
#         ]
#         Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/ecs/${var.cluster_name}-${var.environment}/*:*"
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name      = "${var.cluster_name}-task-logs-${var.environment}"
#     Component = "iam-policy"
#   })
# }

# resource "aws_iam_role_policy_attachment" "task_logs" {
#   role       = aws_iam_role.task_role.name
#   policy_arn = aws_iam_policy.task_logs_access.arn
# }

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

# data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# Task Role (Container Application) - T1.3.3
# -----------------------------------------------------------------------------
# This role is assumed by the running container and defines what
# the application can do at runtime. Secrets are NOT accessible here;
# they are injected via the execution role during task startup.

locals {
  task_role_name_v2 = "outpost-${var.environment}-ecs-task"
}

resource "aws_iam_role" "task" {
  name = local.task_role_name_v2

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
    Name      = local.task_role_name_v2
    Component = "iam-role"
    Purpose   = "task-role"
  })
}

# -----------------------------------------------------------------------------
# Task Role Policy - S3 Access (Artifacts Bucket)
# -----------------------------------------------------------------------------
# Allows containers to read/write artifacts to S3 for job results and inputs

resource "aws_iam_role_policy" "task_s3" {
  name = "s3-artifacts-access"
  role = aws_iam_role.task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::outpost-artifacts-*",
          "arn:aws:s3:::outpost-artifacts-*/*"
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Task Role Policy - EFS Access
# -----------------------------------------------------------------------------
# Allows containers to mount and write to EFS volumes for workspace persistence
# Access is scoped at the network level via security groups

resource "aws_iam_role_policy" "task_efs" {
  name = "efs-access"
  role = aws_iam_role.task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite"
        ]
        Resource = "*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Task Role Policy - CloudWatch Logs (Application Logging)
# -----------------------------------------------------------------------------
# Allows containers to write application logs to CloudWatch

resource "aws_iam_role_policy" "task_logs" {
  name = "cloudwatch-logs-access"
  role = aws_iam_role.task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/outpost/*"
      }
    ]
  })
}
