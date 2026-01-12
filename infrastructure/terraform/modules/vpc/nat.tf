# =============================================================================
# Outpost V2 - VPC Module NAT Gateways
# =============================================================================
#
# Purpose: NAT Gateway resources for private subnet egress
#
# This file creates:
#   - Elastic IPs for NAT Gateways
#   - NAT Gateways in public subnets
#   - Routes from private subnets to NAT Gateways
#
# Configuration Modes:
#   - enable_nat_gateway = false: No NAT (isolated private subnets)
#   - enable_nat_gateway = true, single_nat_gateway = true: 1 NAT (cost savings)
#   - enable_nat_gateway = true, single_nat_gateway = false: NAT per AZ (HA)
#
# Cost Considerations:
#   - Each NAT Gateway costs ~$32/month + data processing
#   - Single NAT: Lower cost, single point of failure
#   - Multi-NAT: Higher cost, cross-AZ resilience
#
# =============================================================================

# -----------------------------------------------------------------------------
# Elastic IPs for NAT Gateways
# -----------------------------------------------------------------------------
#
# Each NAT Gateway requires a dedicated Elastic IP.
# Count depends on single_nat_gateway configuration.
# -----------------------------------------------------------------------------

resource "aws_eip" "nat" {
  count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0

  domain = "vpc"

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-nat-eip-${count.index + 1}"
    Environment = var.environment
    Purpose     = "NAT Gateway"
  })

  depends_on = [aws_internet_gateway.main]
}

# -----------------------------------------------------------------------------
# NAT Gateways
# -----------------------------------------------------------------------------
#
# NAT Gateways are placed in public subnets to provide internet access
# for resources in private subnets.
# -----------------------------------------------------------------------------

resource "aws_nat_gateway" "main" {
  count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-nat-${count.index + 1}"
    Environment = var.environment
    AZ          = var.availability_zones[count.index]
  })

  depends_on = [aws_internet_gateway.main]
}

# -----------------------------------------------------------------------------
# Private Subnet Routes to NAT Gateway
# -----------------------------------------------------------------------------
#
# Route Configuration:
#   - Single NAT: All private subnets route through one NAT Gateway
#   - Multi-NAT: Each private subnet routes through its AZ's NAT Gateway
#
# Note: When single_nat_gateway = false, we need per-AZ route tables for
# proper traffic isolation. This is handled by creating separate route
# tables in subnets.tf.
# -----------------------------------------------------------------------------

resource "aws_route" "private_nat" {
  count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0

  route_table_id         = var.single_nat_gateway ? aws_route_table.private[0].id : aws_route_table.private_per_az[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.single_nat_gateway ? 0 : count.index].id
}
