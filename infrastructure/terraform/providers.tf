# =============================================================================
# Outpost V2 Commander Platform - Provider Configuration
# =============================================================================

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = var.project_name
        Environment = var.environment
        Owner       = var.owner
        CostCenter  = var.cost_center
        ManagedBy   = "terraform"
      },
      var.tags
    )
  }
}

# Additional provider configurations for multi-region resources if needed
# provider "aws" {
#   alias  = "us_west_2"
#   region = "us-west-2"
# }
