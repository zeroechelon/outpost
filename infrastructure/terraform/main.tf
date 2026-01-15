# =============================================================================
# Outpost V2 Commander Platform - Root Terraform Module
# =============================================================================
#
# This is the root module for the Outpost V2 infrastructure.
# It orchestrates all sub-modules to provision the complete platform.
#
# Architecture Components:
#   - VPC: Network isolation and security groups
#   - ECS: Fargate cluster for containerized workloads
#   - ECR: Container registry for agent images
#   - EFS: Persistent storage for workspaces
#   - Secrets: AWS Secrets Manager for credentials
#   - Monitoring: CloudWatch dashboards and alarms
#
# Usage:
#   Environments are configured in ./environments/{dev,prod}/
#   Each environment has its own backend and variable configurations.
#
# =============================================================================

# Module instantiations will be added as implementation progresses
# See T1.x tasks in blueprint for detailed module implementations
