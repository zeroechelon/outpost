# S3 Lifecycle Configuration Module
# Provides reusable lifecycle policies for S3 buckets
#
# Features:
# - Configurable transitions to STANDARD_IA and GLACIER
# - Object expiration with configurable retention
# - Noncurrent version cleanup for versioned buckets
# - Abort incomplete multipart uploads
#
# Usage:
#   module "outputs_lifecycle" {
#     source    = "../modules/s3-lifecycle"
#     bucket_id = aws_s3_bucket.outputs.id
#   }

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  rule_status = var.enabled ? "Enabled" : "Disabled"
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = var.bucket_id

  rule {
    id     = var.rule_id
    status = local.rule_status

    # Filter - apply to all objects or specific prefix
    dynamic "filter" {
      for_each = var.filter_prefix != "" ? [1] : []
      content {
        prefix = var.filter_prefix
      }
    }

    # Transition to STANDARD_IA (Infrequent Access)
    transition {
      days          = var.ia_transition_days
      storage_class = "STANDARD_IA"
    }

    # Optional transition to GLACIER for long-term archival
    dynamic "transition" {
      for_each = var.enable_glacier ? [1] : []
      content {
        days          = var.glacier_transition_days
        storage_class = "GLACIER"
      }
    }

    # Object expiration
    expiration {
      days = var.expiration_days
    }

    # Noncurrent version expiration (for versioned buckets)
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_expiration_days
    }

    # Abort incomplete multipart uploads
    abort_incomplete_multipart_upload {
      days_after_initiation = var.abort_incomplete_multipart_days
    }
  }
}
