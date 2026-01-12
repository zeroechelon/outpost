# =============================================================================
# Outpost V2 - Production Environment
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
      Environment = "prod"
      Owner       = "zeroechelon"
      CostCenter  = "outpost-v2"
      ManagedBy   = "terraform"
    }
  }
}

# Module instantiations for prod environment
# module "vpc" {
#   source      = "../../modules/vpc"
#   environment = "prod"
#   # Prod: NAT gateway per AZ for high availability
#   single_nat_gateway = false
# }

# module "ecr" {
#   source      = "../../modules/ecr"
#   environment = "prod"
# }

# module "efs" {
#   source      = "../../modules/efs"
#   environment = "prod"
#   vpc_id      = module.vpc.vpc_id
#   subnet_ids  = module.vpc.private_subnet_ids
# }

# module "secrets" {
#   source      = "../../modules/secrets"
#   environment = "prod"
# }

# module "ecs" {
#   source      = "../../modules/ecs"
#   environment = "prod"
#   vpc_id      = module.vpc.vpc_id
#   subnet_ids  = module.vpc.private_subnet_ids
# }

# module "monitoring" {
#   source                     = "../../modules/monitoring"
#   environment                = "prod"
#   ecs_cluster_name           = module.ecs.cluster_name
#   enable_detailed_monitoring = true
#   alarm_email_endpoints      = var.alarm_email_endpoints
# }
