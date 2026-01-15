# =============================================================================
# Outpost V2 - CloudTrail Audit Trail
# =============================================================================
# Purpose: Audit logging for AWS API calls in the Outpost environment
# Region: us-east-1 (single region trail)
# Retention: 365 days via S3 lifecycle policy
# =============================================================================

resource "aws_cloudtrail" "outpost_audit" {
  name                          = var.trail_name
  s3_bucket_name                = aws_s3_bucket.audit_logs.id
  include_global_service_events = var.include_global_service_events
  is_multi_region_trail         = var.is_multi_region_trail
  enable_logging                = true
  enable_log_file_validation    = var.enable_log_file_validation

  # Event selector for management events
  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  tags = merge(var.tags, {
    Name        = var.trail_name
    Environment = var.environment
    Purpose     = "Audit Logging"
  })

  depends_on = [aws_s3_bucket_policy.audit_logs]
}
