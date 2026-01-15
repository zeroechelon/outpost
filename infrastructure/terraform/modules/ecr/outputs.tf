# =============================================================================
# Outpost V2 - ECR Module Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# Repository URLs
# -----------------------------------------------------------------------------

output "repository_urls" {
  description = "Map of agent names to ECR repository URLs"
  value       = { for k, v in aws_ecr_repository.agent : k => v.repository_url }
}

# -----------------------------------------------------------------------------
# Repository ARNs
# -----------------------------------------------------------------------------

output "repository_arns" {
  description = "Map of agent names to ECR repository ARNs"
  value       = { for k, v in aws_ecr_repository.agent : k => v.arn }
}

# -----------------------------------------------------------------------------
# Individual Repository Outputs (for convenience)
# -----------------------------------------------------------------------------

output "base_repository_url" {
  description = "URL of the base image repository"
  value       = aws_ecr_repository.agent["base"].repository_url
}

output "base_repository_arn" {
  description = "ARN of the base image repository"
  value       = aws_ecr_repository.agent["base"].arn
}

# -----------------------------------------------------------------------------
# Registry ID
# -----------------------------------------------------------------------------

output "registry_id" {
  description = "The registry ID where the repositories are created"
  value       = aws_ecr_repository.agent["base"].registry_id
}
