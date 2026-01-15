# =============================================================================
# Outpost V2 - CloudTrail Module Outputs
# =============================================================================

output "trail_arn" {
  description = "ARN of the CloudTrail trail"
  value       = aws_cloudtrail.outpost_audit.arn
}

output "trail_name" {
  description = "Name of the CloudTrail trail"
  value       = aws_cloudtrail.outpost_audit.name
}

output "trail_id" {
  description = "ID of the CloudTrail trail"
  value       = aws_cloudtrail.outpost_audit.id
}

output "trail_home_region" {
  description = "Home region of the CloudTrail trail"
  value       = aws_cloudtrail.outpost_audit.home_region
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket storing audit logs"
  value       = aws_s3_bucket.audit_logs.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket storing audit logs"
  value       = aws_s3_bucket.audit_logs.arn
}

output "s3_bucket_domain_name" {
  description = "Domain name of the S3 bucket"
  value       = aws_s3_bucket.audit_logs.bucket_domain_name
}

output "log_retention_days" {
  description = "Number of days audit logs are retained"
  value       = var.log_retention_days
}
