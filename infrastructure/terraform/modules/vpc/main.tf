# =============================================================================
# Outpost V2 - VPC Module
# =============================================================================
#
# Purpose: Network isolation for Outpost workloads
#
# This module creates a complete VPC infrastructure for running ECS Fargate
# tasks with proper network isolation. Includes:
#   - VPC with DNS support and flow logs
#   - Public subnets (3 AZs) for load balancers and NAT gateways
#   - Private subnets (3 AZs) for ECS tasks
#   - Internet Gateway for public internet access
#   - NAT Gateway(s) for private subnet outbound traffic
#   - Route tables for public and private subnets
#   - Security groups for ECS task communication
#
# Design Decisions:
#   - Private subnets for ECS tasks (security best practice)
#   - NAT Gateway per AZ option for high availability (production)
#   - Single NAT Gateway option for cost savings (development)
#   - VPC Flow Logs for network monitoring and troubleshooting
#
# =============================================================================

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

# data "aws_availability_zones" "available" {
#   state = "available"
# }

# data "aws_caller_identity" "current" {}

# data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# VPC
# -----------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-vpc"
    Environment = var.environment
    Module      = "vpc"
  })
}

# -----------------------------------------------------------------------------
# Internet Gateway
# -----------------------------------------------------------------------------

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-igw"
    Environment = var.environment
  })
}

# -----------------------------------------------------------------------------
# Public Subnets (3 AZs)
# -----------------------------------------------------------------------------

# resource "aws_subnet" "public" {
#   count = length(var.availability_zones)
#
#   vpc_id                  = aws_vpc.main.id
#   cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
#   availability_zone       = var.availability_zones[count.index]
#   map_public_ip_on_launch = true
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-public-${var.availability_zones[count.index]}"
#     Environment = var.environment
#     Tier        = "public"
#   })
# }

# -----------------------------------------------------------------------------
# Private Subnets (3 AZs)
# -----------------------------------------------------------------------------

# resource "aws_subnet" "private" {
#   count = length(var.availability_zones)
#
#   vpc_id            = aws_vpc.main.id
#   cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 100)
#   availability_zone = var.availability_zones[count.index]
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-private-${var.availability_zones[count.index]}"
#     Environment = var.environment
#     Tier        = "private"
#   })
# }

# -----------------------------------------------------------------------------
# Elastic IPs for NAT Gateways
# -----------------------------------------------------------------------------

# resource "aws_eip" "nat" {
#   count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0
#
#   domain = "vpc"
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-nat-eip-${count.index}"
#     Environment = var.environment
#   })
#
#   depends_on = [aws_internet_gateway.main]
# }

# -----------------------------------------------------------------------------
# NAT Gateways
# -----------------------------------------------------------------------------

# resource "aws_nat_gateway" "main" {
#   count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0
#
#   allocation_id = aws_eip.nat[count.index].id
#   subnet_id     = aws_subnet.public[count.index].id
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-nat-${count.index}"
#     Environment = var.environment
#   })
#
#   depends_on = [aws_internet_gateway.main]
# }

# -----------------------------------------------------------------------------
# Public Route Table
# -----------------------------------------------------------------------------

# resource "aws_route_table" "public" {
#   vpc_id = aws_vpc.main.id
#
#   route {
#     cidr_block = "0.0.0.0/0"
#     gateway_id = aws_internet_gateway.main.id
#   }
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-public-rt"
#     Environment = var.environment
#     Tier        = "public"
#   })
# }

# resource "aws_route_table_association" "public" {
#   count = length(var.availability_zones)
#
#   subnet_id      = aws_subnet.public[count.index].id
#   route_table_id = aws_route_table.public.id
# }

# -----------------------------------------------------------------------------
# Private Route Tables
# -----------------------------------------------------------------------------

# resource "aws_route_table" "private" {
#   count = var.single_nat_gateway ? 1 : length(var.availability_zones)
#
#   vpc_id = aws_vpc.main.id
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-private-rt-${count.index}"
#     Environment = var.environment
#     Tier        = "private"
#   })
# }

# resource "aws_route" "private_nat" {
#   count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0
#
#   route_table_id         = aws_route_table.private[count.index].id
#   destination_cidr_block = "0.0.0.0/0"
#   nat_gateway_id         = aws_nat_gateway.main[var.single_nat_gateway ? 0 : count.index].id
# }

# resource "aws_route_table_association" "private" {
#   count = length(var.availability_zones)
#
#   subnet_id      = aws_subnet.private[count.index].id
#   route_table_id = aws_route_table.private[var.single_nat_gateway ? 0 : count.index].id
# }

# -----------------------------------------------------------------------------
# Security Group for ECS Tasks
# -----------------------------------------------------------------------------

# resource "aws_security_group" "ecs_tasks" {
#   name        = "outpost-${var.environment}-ecs-tasks-sg"
#   description = "Security group for Outpost ECS tasks"
#   vpc_id      = aws_vpc.main.id
#
#   # Egress: Allow all outbound traffic (for pulling images, API calls, etc.)
#   egress {
#     description = "Allow all outbound traffic"
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     cidr_blocks = ["0.0.0.0/0"]
#   }
#
#   # Ingress: Allow internal VPC communication
#   ingress {
#     description = "Allow internal VPC traffic"
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     self        = true
#   }
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-ecs-tasks-sg"
#     Environment = var.environment
#   })
#
#   lifecycle {
#     create_before_destroy = true
#   }
# }

# -----------------------------------------------------------------------------
# VPC Flow Logs
# -----------------------------------------------------------------------------

# resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
#   name              = "/aws/vpc/outpost-${var.environment}-flow-logs"
#   retention_in_days = 30
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-vpc-flow-logs"
#     Environment = var.environment
#   })
# }

# resource "aws_iam_role" "vpc_flow_logs" {
#   name = "outpost-${var.environment}-vpc-flow-logs-role"
#
#   assume_role_policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Action = "sts:AssumeRole"
#         Effect = "Allow"
#         Principal = {
#           Service = "vpc-flow-logs.amazonaws.com"
#         }
#       }
#     ]
#   })
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-vpc-flow-logs-role"
#     Environment = var.environment
#   })
# }

# resource "aws_iam_role_policy" "vpc_flow_logs" {
#   name = "outpost-${var.environment}-vpc-flow-logs-policy"
#   role = aws_iam_role.vpc_flow_logs.id
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Action = [
#           "logs:CreateLogGroup",
#           "logs:CreateLogStream",
#           "logs:PutLogEvents",
#           "logs:DescribeLogGroups",
#           "logs:DescribeLogStreams"
#         ]
#         Effect   = "Allow"
#         Resource = "*"
#       }
#     ]
#   })
# }

# resource "aws_flow_log" "main" {
#   vpc_id                   = aws_vpc.main.id
#   traffic_type             = "ALL"
#   log_destination_type     = "cloud-watch-logs"
#   log_destination          = aws_cloudwatch_log_group.vpc_flow_logs.arn
#   iam_role_arn             = aws_iam_role.vpc_flow_logs.arn
#   max_aggregation_interval = 60
#
#   tags = merge(var.tags, {
#     Name        = "outpost-${var.environment}-vpc-flow-log"
#     Environment = var.environment
#   })
# }
