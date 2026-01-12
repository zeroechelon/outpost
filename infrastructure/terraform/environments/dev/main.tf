# =============================================================================
# Outpost V2 - Development Environment
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

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "outpost"
      Environment = "dev"
      Owner       = "zeroechelon"
      CostCenter  = "outpost-v2"
      ManagedBy   = "terraform"
    }
  }
}

# Module instantiations for dev environment
# module "vpc" {
#   source      = "../../modules/vpc"
#   environment = "dev"
#   # Dev-specific: single NAT gateway for cost savings
#   single_nat_gateway = true
# }

# module "ecr" {
#   source      = "../../modules/ecr"
#   environment = "dev"
# }

# module "efs" {
#   source      = "../../modules/efs"
#   environment = "dev"
#   vpc_id      = module.vpc.vpc_id
#   subnet_ids  = module.vpc.private_subnet_ids
# }

# module "secrets" {
#   source      = "../../modules/secrets"
#   environment = "dev"
# }

# module "ecs" {
#   source      = "../../modules/ecs"
#   environment = "dev"
#   vpc_id      = module.vpc.vpc_id
#   subnet_ids  = module.vpc.private_subnet_ids
# }

# module "monitoring" {
#   source           = "../../modules/monitoring"
#   environment      = "dev"
#   ecs_cluster_name = module.ecs.cluster_name
# }
