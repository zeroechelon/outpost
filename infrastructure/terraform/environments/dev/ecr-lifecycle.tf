# =============================================================================
# ECR Lifecycle Policies - Dev Environment
# =============================================================================
# Blueprint Task: T3.2 - Apply ECR Lifecycle Policy
# Purpose: Prevent orphaned image accumulation in ECR repositories
# =============================================================================

module "ecr_lifecycle_control_plane" {
  source          = "../../modules/ecr-lifecycle"
  repository_name = "outpost-control-plane"
  keep_tagged_count    = 10
  untagged_expiry_days = 7
}

# -----------------------------------------------------------------------------
# outpost-base Lifecycle Policy (T3.3)
# -----------------------------------------------------------------------------
module "ecr_lifecycle_base" {
  source               = "../../modules/ecr-lifecycle"
  repository_name      = "outpost-base"
  keep_tagged_count    = 10
  untagged_expiry_days = 7
}
