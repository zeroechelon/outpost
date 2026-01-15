# =============================================================================
# Outpost V2 - CloudTrail Audit Logs S3 Bucket
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# S3 bucket for CloudTrail audit logs
resource "aws_s3_bucket" "audit_logs" {
  bucket = "${var.project_name}-audit-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.id}"

  tags = merge(var.tags, {
    Name        = "${var.project_name}-audit-logs"
    Environment = var.environment
    Purpose     = "CloudTrail Audit Logging"
  })
}

# Enable versioning for audit integrity
resource "aws_s3_bucket_versioning" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption for audit logs
resource "aws_s3_bucket_server_side_encryption_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Lifecycle configuration - 365 day retention per requirements
resource "aws_s3_bucket_lifecycle_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    id     = "audit-log-retention"
    status = "Enabled"

    # Transition to cheaper storage after 90 days
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    # Archive to Glacier after 180 days
    transition {
      days          = 180
      storage_class = "GLACIER"
    }

    # Expire after 365 days
    expiration {
      days = var.log_retention_days
    }

    # Clean up old versions
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Block all public access to audit logs
resource "aws_s3_bucket_public_access_block" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3 bucket policy to allow CloudTrail writes
resource "aws_s3_bucket_policy" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id
  policy = data.aws_iam_policy_document.audit_logs_bucket_policy.json

  depends_on = [aws_s3_bucket_public_access_block.audit_logs]
}

data "aws_iam_policy_document" "audit_logs_bucket_policy" {
  # CloudTrail check bucket ACL
  statement {
    sid    = "AWSCloudTrailAclCheck"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit_logs.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # CloudTrail write logs
  statement {
    sid    = "AWSCloudTrailWrite"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit_logs.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # Deny insecure transport
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:*"]
    resources = [
      aws_s3_bucket.audit_logs.arn,
      "${aws_s3_bucket.audit_logs.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}
