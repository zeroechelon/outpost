# =============================================================================
# S3 Lifecycle Policies - Storage Optimization
# =============================================================================
# Blueprint: BSF v2.1.0 - Storage Lifecycle Governance
# Task: T1.2 - Apply Lifecycle Policy to outpost-outputs Bucket
# =============================================================================

# -----------------------------------------------------------------------------
# Data source for existing outpost-outputs bucket
# -----------------------------------------------------------------------------
data "aws_s3_bucket" "outputs" {
  bucket = "outpost-outputs"
}

# -----------------------------------------------------------------------------
# Apply lifecycle policy using reusable module
# -----------------------------------------------------------------------------
module "outputs_lifecycle" {
  source = "../../modules/s3-lifecycle"

  bucket_id = data.aws_s3_bucket.outputs.id
  rule_id   = "outpost-outputs-lifecycle"

  # Storage tiering configuration (per BSF v2.1.0)
  ia_transition_days      = 30  # Move to STANDARD_IA after 30 days
  glacier_transition_days = 90  # Archive to GLACIER after 90 days
  expiration_days         = 180 # Delete after 180 days
  enable_glacier          = true

  # Versioned object cleanup
  noncurrent_expiration_days = 30 # Delete old versions after 30 days

  # Incomplete upload cleanup
  abort_incomplete_multipart_days = 7
}
