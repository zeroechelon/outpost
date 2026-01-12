# =============================================================================
# Outpost V2 - VPC Module Subnets
# =============================================================================
#
# Purpose: Public and private subnets for Outpost workloads
#
# This file creates:
#   - Public subnets across 3 AZs (10.0.1.0/24 - 10.0.3.0/24)
#   - Private subnets across 3 AZs (10.0.11.0/24 - 10.0.13.0/24)
#   - Public route table with IGW route
#   - Private route table for internal routing
#   - Route table associations for all subnets
#
# CIDR Allocation:
#   - 10.0.1.0/24 - Public subnet AZ-1
#   - 10.0.2.0/24 - Public subnet AZ-2
#   - 10.0.3.0/24 - Public subnet AZ-3
#   - 10.0.11.0/24 - Private subnet AZ-1
#   - 10.0.12.0/24 - Private subnet AZ-2
#   - 10.0.13.0/24 - Private subnet AZ-3
#
# Design Decisions:
#   - Public subnets for load balancers and NAT gateways
#   - Private subnets for ECS tasks (security best practice)
#   - CIDR blocks offset to avoid collision
#   - Single private route table (NAT route added in T1.1.4)
#
# =============================================================================

# -----------------------------------------------------------------------------
# Public Subnets (3 AZs)
# -----------------------------------------------------------------------------

resource "aws_subnet" "public" {
  count = length(var.availability_zones)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-public-${count.index + 1}"
    Environment = var.environment
    Type        = "public"
    AZ          = var.availability_zones[count.index]
  })
}

# -----------------------------------------------------------------------------
# Public Route Table
# -----------------------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-public-rt"
    Environment = var.environment
    Type        = "public"
  })
}

# -----------------------------------------------------------------------------
# Public Route Table Associations
# -----------------------------------------------------------------------------

resource "aws_route_table_association" "public" {
  count = length(var.availability_zones)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# =============================================================================

# -----------------------------------------------------------------------------
# Private Subnets (3 AZs)
# -----------------------------------------------------------------------------

resource "aws_subnet" "private" {
  count = length(var.availability_zones)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-private-${count.index + 1}"
    Environment = var.environment
    Type        = "private"
    AZ          = var.availability_zones[count.index]
  })
}

# -----------------------------------------------------------------------------
# Private Route Table (Single NAT Gateway Mode)
# -----------------------------------------------------------------------------
#
# Used when single_nat_gateway = true for cost savings.
# All private subnets share one route table pointing to one NAT Gateway.
# NAT Gateway route added in nat.tf.
# -----------------------------------------------------------------------------

resource "aws_route_table" "private" {
  count = var.single_nat_gateway || !var.enable_nat_gateway ? 1 : 0

  vpc_id = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-private-rt"
    Environment = var.environment
    Type        = "private"
  })
}

# -----------------------------------------------------------------------------
# Private Route Tables (Multi-NAT Gateway Mode - Per AZ)
# -----------------------------------------------------------------------------
#
# Used when single_nat_gateway = false for high availability.
# Each AZ gets its own route table pointing to its own NAT Gateway.
# This ensures traffic stays within the same AZ for optimal latency
# and resilience to AZ failures.
# NAT Gateway routes added in nat.tf.
# -----------------------------------------------------------------------------

resource "aws_route_table" "private_per_az" {
  count = var.enable_nat_gateway && !var.single_nat_gateway ? length(var.availability_zones) : 0

  vpc_id = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-private-rt-${count.index + 1}"
    Environment = var.environment
    Type        = "private"
    AZ          = var.availability_zones[count.index]
  })
}

# -----------------------------------------------------------------------------
# Private Route Table Associations
# -----------------------------------------------------------------------------
#
# Associates private subnets with the appropriate route table:
#   - Single NAT mode: All subnets use the shared route table
#   - Multi-NAT mode: Each subnet uses its AZ-specific route table
# -----------------------------------------------------------------------------

resource "aws_route_table_association" "private" {
  count = length(var.availability_zones)

  subnet_id = aws_subnet.private[count.index].id
  route_table_id = (
    var.single_nat_gateway || !var.enable_nat_gateway
    ? aws_route_table.private[0].id
    : aws_route_table.private_per_az[count.index].id
  )
}
