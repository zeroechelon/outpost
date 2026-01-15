# =============================================================================
# Outpost V2 - Secrets Rotation Configuration
# =============================================================================
#
# Purpose: Optional automatic rotation for secrets with zero-downtime support
#
# Features:
#   - Lambda function for secret rotation (placeholder, actual rotation logic
#     is secret-type specific)
#   - Configurable rotation schedule (default: 90 days)
#   - Version staging for zero-downtime rotation
#   - SNS notifications on rotation success/failure
#   - Manual rotation trigger support
#
# Usage:
#   Enable rotation per secret via var.rotation_enabled_secrets
#
# =============================================================================

# -----------------------------------------------------------------------------
# Local Variables
# -----------------------------------------------------------------------------

locals {
  # Secrets that have rotation enabled
  rotation_enabled_secrets = var.rotation_enabled ? toset(var.rotation_enabled_secrets) : toset([])

  # Lambda function naming
  rotation_lambda_name = "outpost-${var.environment}-secret-rotator"
}

# -----------------------------------------------------------------------------
# SNS Topic for Rotation Notifications
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "rotation_notifications" {
  count = var.rotation_enabled ? 1 : 0

  name              = "outpost-${var.environment}-secret-rotation"
  kms_master_key_id = aws_kms_key.secrets.id

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-secret-rotation"
    Environment = var.environment
    Component   = "secrets-rotation"
  })
}

resource "aws_sns_topic_policy" "rotation_notifications" {
  count = var.rotation_enabled ? 1 : 0

  arn = aws_sns_topic.rotation_notifications[0].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSecretsManagerPublish"
        Effect = "Allow"
        Principal = {
          Service = "secretsmanager.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.rotation_notifications[0].arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "AllowLambdaPublish"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.rotation_notifications[0].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${local.rotation_lambda_name}"
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# IAM Role for Rotation Lambda
# -----------------------------------------------------------------------------

resource "aws_iam_role" "rotation_lambda" {
  count = var.rotation_enabled ? 1 : 0

  name = "${local.rotation_lambda_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${local.rotation_lambda_name}-role"
    Environment = var.environment
    Component   = "secrets-rotation"
  })
}

# Lambda basic execution policy (CloudWatch Logs)
resource "aws_iam_role_policy_attachment" "rotation_lambda_basic" {
  count = var.rotation_enabled ? 1 : 0

  role       = aws_iam_role.rotation_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Custom policy for Secrets Manager rotation
resource "aws_iam_role_policy" "rotation_lambda_secrets" {
  count = var.rotation_enabled ? 1 : 0

  name = "secrets-rotation-access"
  role = aws_iam_role.rotation_lambda[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsManagerRotation"
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:/outpost/*"
      },
      {
        Sid    = "SecretsManagerRandom"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetRandomPassword"
        ]
        Resource = "*"
      },
      {
        Sid    = "KMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.secrets.arn
      },
      {
        Sid    = "SNSPublish"
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.rotation_notifications[0].arn
      }
    ]
  })
}

# VPC access policy (if Lambda needs to call VPC-internal resources)
resource "aws_iam_role_policy_attachment" "rotation_lambda_vpc" {
  count = var.rotation_enabled && var.rotation_lambda_vpc_config != null ? 1 : 0

  role       = aws_iam_role.rotation_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group for Rotation Lambda
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "rotation_lambda" {
  count = var.rotation_enabled ? 1 : 0

  name              = "/aws/lambda/${local.rotation_lambda_name}"
  retention_in_days = var.rotation_log_retention_days
  kms_key_id        = aws_kms_key.secrets.arn

  tags = merge(var.tags, {
    Name        = "${local.rotation_lambda_name}-logs"
    Environment = var.environment
    Component   = "secrets-rotation"
  })
}

# -----------------------------------------------------------------------------
# Lambda Function for Secret Rotation
# -----------------------------------------------------------------------------
#
# Note: This is a placeholder rotation function. In production, you would
# implement provider-specific rotation logic (e.g., Anthropic API key rotation,
# OpenAI API key rotation, etc.). Each provider has different rotation APIs.
#
# The function implements the standard Secrets Manager rotation steps:
#   1. createSecret - Generate new secret value
#   2. setSecret - Apply new secret to the service (provider-specific)
#   3. testSecret - Verify new secret works
#   4. finishSecret - Move AWSCURRENT staging label to new version
#

data "archive_file" "rotation_lambda" {
  count = var.rotation_enabled ? 1 : 0

  type        = "zip"
  output_path = "${path.module}/files/rotation_lambda.zip"

  source {
    content  = <<-PYTHON
import json
import logging
import boto3
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secretsmanager = boto3.client('secretsmanager')
sns = boto3.client('sns')

SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', '')

def lambda_handler(event, context):
    """
    Secrets Manager Rotation Lambda Handler.

    This is a template rotation function. Actual rotation logic is
    provider-specific and should be implemented per API provider.

    Args:
        event: Secrets Manager rotation event with Step, SecretId, ClientRequestToken
        context: Lambda context

    Returns:
        None (Secrets Manager expects no return value on success)
    """
    arn = event['SecretId']
    token = event['ClientRequestToken']
    step = event['Step']

    logger.info(f"Rotation step {step} for secret {arn}")

    # Get current secret metadata
    metadata = secretsmanager.describe_secret(SecretId=arn)

    # Verify version is staged for rotation
    if token not in metadata.get('VersionIdsToStages', {}):
        logger.error(f"Token {token} not found in secret {arn}")
        raise ValueError(f"Token {token} not found in secret {arn}")

    # Route to appropriate step
    if step == "createSecret":
        create_secret(arn, token, metadata)
    elif step == "setSecret":
        set_secret(arn, token, metadata)
    elif step == "testSecret":
        test_secret(arn, token, metadata)
    elif step == "finishSecret":
        finish_secret(arn, token, metadata)
    else:
        raise ValueError(f"Unknown step: {step}")

    logger.info(f"Successfully completed step {step} for secret {arn}")


def create_secret(arn, token, metadata):
    """
    Create a new secret value and store it with AWSPENDING staging.

    For API keys, this would typically:
    1. Call the provider's API to generate a new API key
    2. Store the new key in the AWSPENDING version

    This placeholder generates a random password as a template.
    """
    try:
        # Check if AWSPENDING version already exists
        secretsmanager.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")
        logger.info("AWSPENDING version already exists, skipping creation")
        return
    except secretsmanager.exceptions.ResourceNotFoundException:
        pass

    # Get current secret to understand format
    current = secretsmanager.get_secret_value(SecretId=arn, VersionStage="AWSCURRENT")
    current_value = json.loads(current['SecretString'])

    # PLACEHOLDER: In production, call provider API to generate new key
    # For now, we just copy the current value (actual rotation requires provider integration)
    new_value = current_value.copy()
    new_value['_rotation_pending'] = True
    new_value['_rotation_token'] = token

    # Store new version with AWSPENDING
    secretsmanager.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=json.dumps(new_value),
        VersionStages=['AWSPENDING']
    )

    logger.info(f"Created AWSPENDING version for secret {arn}")
    notify(f"Secret rotation STARTED for {arn}", "INFO")


def set_secret(arn, token, metadata):
    """
    Apply the new secret to the service/provider.

    For API keys, this step would:
    1. Activate the new API key at the provider
    2. Possibly deprecate the old key

    This placeholder is a no-op since we don't have provider integration.
    """
    logger.info(f"setSecret step (placeholder) for {arn}")
    # PLACEHOLDER: Implement provider-specific key activation


def test_secret(arn, token, metadata):
    """
    Test that the new secret works correctly.

    For API keys, this would:
    1. Make a test API call using the new key
    2. Verify the response is successful

    This placeholder verifies the secret value can be retrieved.
    """
    try:
        pending = secretsmanager.get_secret_value(
            SecretId=arn,
            VersionId=token,
            VersionStage="AWSPENDING"
        )
        value = json.loads(pending['SecretString'])
        logger.info(f"Successfully retrieved AWSPENDING version for {arn}")

        # PLACEHOLDER: Implement provider-specific API test call
        # Example: Make a test request to Anthropic/OpenAI API

    except Exception as e:
        logger.error(f"Test failed for secret {arn}: {str(e)}")
        notify(f"Secret rotation FAILED for {arn}: Test step failed - {str(e)}", "ERROR")
        raise


def finish_secret(arn, token, metadata):
    """
    Complete rotation by moving AWSCURRENT to the new version.

    This moves the AWSCURRENT staging label from the old version
    to the new version, making it the active secret.
    """
    # Get current version
    current_version = None
    for version, stages in metadata.get('VersionIdsToStages', {}).items():
        if 'AWSCURRENT' in stages:
            if version == token:
                logger.info("AWSCURRENT already points to new version")
                return
            current_version = version
            break

    # Move AWSCURRENT to new version
    secretsmanager.update_secret_version_stage(
        SecretId=arn,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version
    )

    logger.info(f"Rotation complete: moved AWSCURRENT to version {token}")
    notify(f"Secret rotation COMPLETED for {arn}", "SUCCESS")


def notify(message, level="INFO"):
    """Send notification to SNS topic."""
    if not SNS_TOPIC_ARN:
        return

    try:
        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Message=json.dumps({
                'level': level,
                'message': message,
                'source': 'outpost-secret-rotation'
            }),
            Subject=f"Outpost Secret Rotation - {level}"
        )
    except Exception as e:
        logger.error(f"Failed to send SNS notification: {str(e)}")
PYTHON
    filename = "rotation_handler.py"
  }
}

resource "aws_lambda_function" "rotation" {
  count = var.rotation_enabled ? 1 : 0

  function_name = local.rotation_lambda_name
  description   = "Outpost secret rotation handler"
  role          = aws_iam_role.rotation_lambda[0].arn
  handler       = "rotation_handler.lambda_handler"
  runtime       = "python3.11"
  timeout       = var.rotation_lambda_timeout
  memory_size   = 256

  filename         = data.archive_file.rotation_lambda[0].output_path
  source_code_hash = data.archive_file.rotation_lambda[0].output_base64sha256

  environment {
    variables = {
      SNS_TOPIC_ARN = aws_sns_topic.rotation_notifications[0].arn
      ENVIRONMENT   = var.environment
    }
  }

  # Optional VPC configuration for accessing VPC-internal resources
  dynamic "vpc_config" {
    for_each = var.rotation_lambda_vpc_config != null ? [var.rotation_lambda_vpc_config] : []
    content {
      subnet_ids         = vpc_config.value.subnet_ids
      security_group_ids = vpc_config.value.security_group_ids
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.rotation_lambda,
    aws_iam_role_policy.rotation_lambda_secrets
  ]

  tags = merge(var.tags, {
    Name        = local.rotation_lambda_name
    Environment = var.environment
    Component   = "secrets-rotation"
  })
}

# Lambda permission for Secrets Manager to invoke
resource "aws_lambda_permission" "rotation_invoke" {
  count = var.rotation_enabled ? 1 : 0

  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotation[0].function_name
  principal     = "secretsmanager.amazonaws.com"
}

# -----------------------------------------------------------------------------
# Secrets Manager Rotation Schedule
# -----------------------------------------------------------------------------
#
# Configure rotation for each enabled secret.
# Uses version staging for zero-downtime rotation:
#   - AWSCURRENT: Active secret version
#   - AWSPENDING: New version being rotated in
#   - AWSPREVIOUS: Previous version (for rollback)
#

resource "aws_secretsmanager_secret_rotation" "api_keys" {
  for_each = local.rotation_enabled_secrets

  secret_id           = aws_secretsmanager_secret.api_keys[each.key].id
  rotation_lambda_arn = aws_lambda_function.rotation[0].arn

  rotation_rules {
    automatically_after_days = var.rotation_days
    # Duration allows rotation window to complete
    duration = var.rotation_duration
    # Schedule expression for precise timing (optional)
    schedule_expression = var.rotation_schedule_expression
  }
}

# -----------------------------------------------------------------------------
# CloudWatch Alarms for Rotation Monitoring
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "rotation_failures" {
  count = var.rotation_enabled ? 1 : 0

  alarm_name          = "outpost-${var.environment}-secret-rotation-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when secret rotation Lambda fails"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.rotation[0].function_name
  }

  alarm_actions = [aws_sns_topic.rotation_notifications[0].arn]
  ok_actions    = [aws_sns_topic.rotation_notifications[0].arn]

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-secret-rotation-failures"
    Environment = var.environment
    Component   = "secrets-rotation"
  })
}

resource "aws_cloudwatch_metric_alarm" "rotation_duration" {
  count = var.rotation_enabled ? 1 : 0

  alarm_name          = "outpost-${var.environment}-secret-rotation-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Maximum"
  threshold           = var.rotation_lambda_timeout * 1000 * 0.8 # 80% of timeout
  alarm_description   = "Alert when secret rotation approaches timeout"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.rotation[0].function_name
  }

  alarm_actions = [aws_sns_topic.rotation_notifications[0].arn]

  tags = merge(var.tags, {
    Name        = "outpost-${var.environment}-secret-rotation-duration"
    Environment = var.environment
    Component   = "secrets-rotation"
  })
}

# -----------------------------------------------------------------------------
# Manual Rotation Trigger Support
# -----------------------------------------------------------------------------
#
# To manually trigger rotation for a secret:
#
#   aws secretsmanager rotate-secret \
#     --secret-id /outpost/api-keys/anthropic \
#     --rotation-lambda-arn <rotation_lambda_arn> \
#     --profile soc
#
# Or via AWS Console:
#   1. Navigate to Secrets Manager
#   2. Select the secret
#   3. Click "Rotate secret immediately"
#
# The same Lambda function handles both scheduled and manual rotations.
# -----------------------------------------------------------------------------
