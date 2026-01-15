# =============================================================================
# Outpost V2 - ECR Lifecycle Policies
# =============================================================================
#
# Purpose: Image retention and cleanup policies for ECR repositories
#
# Policies:
#   - Keep last N tagged images (configurable, default 10)
#   - Expire untagged images after 7 days
#
# =============================================================================

# -----------------------------------------------------------------------------
# ECR Lifecycle Policies
# -----------------------------------------------------------------------------
# Applies lifecycle rules to all agent repositories using for_each
# Rule 1: Keep last N tagged images with version/release prefixes
# Rule 2: Delete untagged images older than N days
# -----------------------------------------------------------------------------

resource "aws_ecr_lifecycle_policy" "agent" {
  for_each   = aws_ecr_repository.agent
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last ${var.image_retention_count} tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "release"]
          countType     = "imageCountMoreThan"
          countNumber   = var.image_retention_count
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images older than ${var.untagged_image_expiry_days} days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.untagged_image_expiry_days
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
