# =============================================================================
# Outpost V2 - Production Environment Backend
# =============================================================================

terraform {
  backend "s3" {
    bucket         = "outpost-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "outpost-terraform-locks"
  }
}
