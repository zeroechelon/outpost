# =============================================================================
# Outpost V2 - Secrets Module
# =============================================================================
#
# Purpose: Secure credential management for agent API keys
#
# Resources:
#   - Customer managed KMS key for secret encryption
#   - AWS Secrets Manager secrets for platform-level LLM API keys
#   - Per-user secret namespace pattern
#
# Platform Secrets:
#   - /outpost/api-keys/anthropic
#   - /outpost/api-keys/openai
#   - /outpost/api-keys/google
#   - /outpost/api-keys/xai
#   - /outpost/api-keys/deepseek
#   - /outpost/api-keys/github
#
# Per-User Secrets:
#   - /outpost/users/{user_id}/* namespace (created dynamically by application)
#
# =============================================================================

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Local Variables
# -----------------------------------------------------------------------------

locals {
  # API keys to create secrets for
  api_keys = toset(["ANTHROPIC", "OPENAI", "GOOGLE", "XAI", "DEEPSEEK", "GITHUB"])
}

# -----------------------------------------------------------------------------
# KMS Key for Secret Encryption (Customer Managed)
# -----------------------------------------------------------------------------

resource "aws_kms_key" "secrets" {
  description             = "KMS key for Outpost secrets"
  deletion_window_in_days = var.kms_deletion_window
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableIAMUserPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowSecretsManagerToUseKey"
        Effect = "Allow"
        Principal = {
          Service = "secretsmanager.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })

  tags = {
    Name        = "outpost-${var.environment}-secrets-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/outpost-${var.environment}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# -----------------------------------------------------------------------------
# Platform-Level LLM API Key Secrets
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "api_keys" {
  for_each = local.api_keys

  name        = "/outpost/api-keys/${lower(each.key)}"
  description = "Outpost platform API key: ${each.key}"
  kms_key_id  = aws_kms_key.secrets.arn

  recovery_window_in_days = var.kms_deletion_window

  tags = {
    Name        = "outpost-${each.key}-api-key"
    Environment = var.environment
  }
}

# Note: Secret values are NOT managed by Terraform
# Values should be set via AWS Console or CLI:
#   aws secretsmanager put-secret-value \
#     --secret-id /outpost/api-keys/anthropic \
#     --secret-string '{"api_key": "sk-ant-..."}'

# -----------------------------------------------------------------------------
# Per-User Secret Namespace Pattern
# -----------------------------------------------------------------------------
#
# Per-user secrets follow the pattern: /outpost/users/{user_id}/*
#
# These are created dynamically by the application, not Terraform.
# IAM access is granted via the ECS module's task role.
#
# Example user secrets:
#   - /outpost/users/user123/anthropic
#   - /outpost/users/user123/openai
#   - /outpost/users/user456/github
#
# The application handles:
#   1. Creating secrets in this namespace
#   2. Setting secret values
#   3. Cleaning up on user deletion

# -----------------------------------------------------------------------------
# IAM Policies
# -----------------------------------------------------------------------------
#
# NOTE: IAM policies for ECS task access are handled in the ECS module,
# not in this module. This follows the pattern of keeping IAM close to
# the consuming resource.
#
# The ECS module should grant:
#   - secretsmanager:GetSecretValue on platform secrets
#   - secretsmanager:GetSecretValue on user secrets namespace
#   - kms:Decrypt on the KMS key
