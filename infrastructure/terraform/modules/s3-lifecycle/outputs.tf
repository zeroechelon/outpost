# S3 Lifecycle Configuration Module - Outputs

output "lifecycle_rule_id" {
  description = "The ID of the lifecycle rule"
  value       = var.rule_id
}

output "bucket_id" {
  description = "The ID of the S3 bucket with lifecycle configuration applied"
  value       = var.bucket_id
}

output "configuration_bucket" {
  description = "The bucket associated with the lifecycle configuration"
  value       = aws_s3_bucket_lifecycle_configuration.this.bucket
}

output "transitions" {
  description = "Summary of configured transitions"
  value = {
    standard_ia_days = var.ia_transition_days
    glacier_days     = var.enable_glacier ? var.glacier_transition_days : null
    expiration_days  = var.expiration_days
  }
}
