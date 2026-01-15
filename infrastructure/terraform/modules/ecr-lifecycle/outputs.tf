# =============================================================================
# ECR Lifecycle Policy Module - Outputs
# =============================================================================

output "repository_name" {
  description = "The name of the ECR repository with lifecycle policy applied"
  value       = var.repository_name
}

output "lifecycle_policy_text" {
  description = "The JSON lifecycle policy document applied to the repository"
  value       = aws_ecr_lifecycle_policy.this.policy
}

output "policy_summary" {
  description = "Summary of the lifecycle policy configuration"
  value = {
    keep_tagged_count    = var.keep_tagged_count
    untagged_expiry_days = var.untagged_expiry_days
    tag_prefixes         = length(var.tag_prefix_list) > 0 ? var.tag_prefix_list : ["all tags"]
  }
}
