# =============================================================================
# Outpost V2 - Secrets Module Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# KMS Key Outputs
# -----------------------------------------------------------------------------

output "kms_key_arn" {
  description = "ARN of the KMS key used for secret encryption"
  value       = aws_kms_key.secrets.arn
}

output "kms_key_id" {
  description = "ID of the KMS key used for secret encryption"
  value       = aws_kms_key.secrets.key_id
}

output "kms_alias_arn" {
  description = "ARN of the KMS key alias"
  value       = aws_kms_alias.secrets.arn
}

# -----------------------------------------------------------------------------
# Secret ARN Outputs
# -----------------------------------------------------------------------------

output "secret_arns" {
  description = "Map of API key names to their secret ARNs"
  value = {
    for name, secret in aws_secretsmanager_secret.api_keys :
    name => secret.arn
  }
}

output "secret_names" {
  description = "Map of API key names to their full secret paths"
  value = {
    for name, secret in aws_secretsmanager_secret.api_keys :
    name => secret.name
  }
}

# -----------------------------------------------------------------------------
# Convenience Outputs for ECS Module
# -----------------------------------------------------------------------------

output "api_key_secret_arns" {
  description = "List of all API key secret ARNs for IAM policy"
  value       = [for secret in aws_secretsmanager_secret.api_keys : secret.arn]
}

output "user_secrets_prefix" {
  description = "The prefix for per-user secrets namespace"
  value       = "/outpost/users/"
}

# -----------------------------------------------------------------------------
# Rotation Outputs
# -----------------------------------------------------------------------------

output "rotation_enabled" {
  description = "Whether secret rotation is enabled"
  value       = var.rotation_enabled
}

output "rotation_lambda_arn" {
  description = "ARN of the secret rotation Lambda function"
  value       = var.rotation_enabled ? aws_lambda_function.rotation[0].arn : null
}

output "rotation_lambda_name" {
  description = "Name of the secret rotation Lambda function"
  value       = var.rotation_enabled ? aws_lambda_function.rotation[0].function_name : null
}

output "rotation_sns_topic_arn" {
  description = "ARN of the SNS topic for rotation notifications"
  value       = var.rotation_enabled ? aws_sns_topic.rotation_notifications[0].arn : null
}

output "rotation_enabled_secrets" {
  description = "List of secrets with rotation enabled"
  value       = var.rotation_enabled ? var.rotation_enabled_secrets : []
}

output "rotation_schedule_days" {
  description = "Number of days between automatic rotations"
  value       = var.rotation_enabled ? var.rotation_days : null
}
