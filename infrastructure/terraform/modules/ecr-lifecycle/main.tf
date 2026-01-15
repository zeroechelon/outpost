# =============================================================================
# ECR Lifecycle Policy Module
# =============================================================================
#
# Purpose: Reusable lifecycle policy for any ECR repository
#
# Features:
#   - Configurable tagged image retention count
#   - Configurable untagged image expiry (days)
#   - Supports optional tag prefix filtering
#
# Usage:
#   module "ecr_lifecycle" {
#     source          = "../modules/ecr-lifecycle"
#     repository_name = aws_ecr_repository.my_repo.name
#   }
#
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# ECR Lifecycle Policy
# -----------------------------------------------------------------------------
# Applies retention rules to the specified ECR repository
# Rule 1: Keep last N tagged images (configurable)
# Rule 2: Delete untagged images after N days (configurable)
# -----------------------------------------------------------------------------

resource "aws_ecr_lifecycle_policy" "this" {
  repository = var.repository_name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last ${var.keep_tagged_count} tagged images"
        selection = {
          tagStatus      = "tagged"
          countType      = "imageCountMoreThan"
          countNumber    = var.keep_tagged_count
          tagPatternList = length(var.tag_prefix_list) > 0 ? [for p in var.tag_prefix_list : "${p}.*"] : [".*"]
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images after ${var.untagged_expiry_days} days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.untagged_expiry_days
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
