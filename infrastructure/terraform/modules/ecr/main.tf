# =============================================================================
# Outpost V2 - ECR Module
# =============================================================================
#
# Purpose: Container registry for agent Docker images
#
# Resources:
#   - ECR repositories for each agent type
#   - ECR repository for base image
#   - Lifecycle policies for image retention
#   - Repository policies for cross-account access (if needed)
#
# Repositories:
#   - outpost-base: Base image for all agents
#   - outpost-claude: Claude Code agent image
#   - outpost-codex: OpenAI Codex agent image
#   - outpost-gemini: Gemini CLI agent image
#   - outpost-aider: Aider agent image
#   - outpost-grok: Grok agent image
#
# =============================================================================

# -----------------------------------------------------------------------------
# Local Variables
# -----------------------------------------------------------------------------

locals {
  # Agent types for repository creation
  repositories = toset(["base", "claude", "codex", "gemini", "aider", "grok"])
}

# -----------------------------------------------------------------------------
# ECR Repositories
# -----------------------------------------------------------------------------
# Creates ECR repositories for base image and all agent types using for_each
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "agent" {
  for_each = local.repositories

  name                 = "outpost-${each.key}"
  image_tag_mutability = var.image_tag_mutability

  image_scanning_configuration {
    scan_on_push = var.enable_scan_on_push
  }

  encryption_configuration {
    encryption_type = var.encryption_type
    kms_key         = var.encryption_type == "KMS" ? var.kms_key_arn : null
  }

  tags = merge(var.tags, {
    Name        = "outpost-${each.key}"
    Environment = var.environment
    Agent       = each.key
  })
}

# -----------------------------------------------------------------------------
# Lifecycle Policies
# -----------------------------------------------------------------------------
# See lifecycle.tf for image retention policies
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Repository Policy (Optional - for cross-account access)
# -----------------------------------------------------------------------------
# Enable cross-account pull access if allowed_account_ids is provided
# -----------------------------------------------------------------------------

resource "aws_ecr_repository_policy" "agent" {
  for_each   = length(var.allowed_account_ids) > 0 ? local.repositories : toset([])
  repository = aws_ecr_repository.agent[each.key].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCrossAccountPull"
        Effect = "Allow"
        Principal = {
          AWS = var.allowed_account_ids
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
      }
    ]
  })
}
