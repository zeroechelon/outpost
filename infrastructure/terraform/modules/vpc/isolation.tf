# =============================================================================
# Outpost V2 - VPC Module Network Isolation (T6.1)
# =============================================================================
#
# Purpose: Multi-tenant network isolation for Outpost agent tasks
#
# Security Controls:
#   1. Agent Tasks Security Group - Restricted egress (HTTPS, SSH, NFS only)
#   2. IMDS Blocking - Network ACL denies 169.254.169.254 (critical for multi-tenant)
#   3. VPC Flow Logs - All traffic captured to CloudWatch for audit
#   4. Network ACLs - Defense-in-depth layer for private subnets
#
# Multi-Tenant Isolation:
#   - Fargate provides network namespace isolation per task (built-in)
#   - No inbound connections to task containers (security group)
#   - IMDS blocked to prevent credential theft from compromised tasks
#   - All network traffic logged for forensic analysis
#
# Acceptance Criteria:
#   - Each dispatch runs in isolated network namespace (Fargate default)
#   - No inbound connections to task containers
#   - Egress limited to: HTTPS (443), SSH (22), NFS (2049 for EFS)
#   - VPC flow logs capture all traffic for audit
#   - Network ACLs as additional defense layer
#   - Cannot access metadata service (169.254.169.254 blocked)
#
# =============================================================================

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Security Group: Agent Tasks (Isolated)
# -----------------------------------------------------------------------------
#
# Isolated security group for multi-tenant agent task execution.
# Provides minimal egress required for agent operations:
#   - HTTPS (443): API calls (Anthropic, OpenAI, GitHub, AWS)
#   - SSH (22): Git clone operations
#   - NFS (2049): EFS workspace access
#   - DNS (53): Name resolution (inherited from ecs_tasks)
#
# NO ingress rules - tasks are isolated and don't accept inbound connections.
#
# -----------------------------------------------------------------------------

resource "aws_security_group" "agent_tasks_isolated" {
  name        = "${var.environment}-outpost-agent-tasks-isolated-sg"
  description = "Isolated security group for multi-tenant agent tasks - restricted egress"
  vpc_id      = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-agent-tasks-isolated-sg"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "agent-tasks-isolated"
    Security    = "multi-tenant-isolation"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Egress: HTTPS (443) for API calls - required for all agent operations
resource "aws_security_group_rule" "agent_tasks_egress_https" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.agent_tasks_isolated.id
  description       = "Allow HTTPS outbound for API calls (Anthropic, OpenAI, GitHub, AWS)"
}

# Egress: SSH (22) for Git clone operations via SSH
resource "aws_security_group_rule" "agent_tasks_egress_ssh" {
  type              = "egress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.agent_tasks_isolated.id
  description       = "Allow SSH outbound for Git clone operations"
}

# Egress: NFS (2049) for EFS workspace access
resource "aws_security_group_rule" "agent_tasks_egress_nfs" {
  type                     = "egress"
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.efs.id
  security_group_id        = aws_security_group.agent_tasks_isolated.id
  description              = "Allow NFS outbound to EFS mount targets for workspace storage"
}

# Egress: DNS (53) UDP for name resolution
resource "aws_security_group_rule" "agent_tasks_egress_dns_udp" {
  type              = "egress"
  from_port         = 53
  to_port           = 53
  protocol          = "udp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.agent_tasks_isolated.id
  description       = "Allow DNS UDP outbound for name resolution"
}

# Egress: DNS (53) TCP for large DNS responses
resource "aws_security_group_rule" "agent_tasks_egress_dns_tcp" {
  type              = "egress"
  from_port         = 53
  to_port           = 53
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.agent_tasks_isolated.id
  description       = "Allow DNS TCP outbound for large DNS responses"
}

# -----------------------------------------------------------------------------
# EFS Ingress Rule for Agent Tasks
# -----------------------------------------------------------------------------
#
# Allow NFS ingress to EFS from the isolated agent tasks security group.
# This completes the EFS access path for agent tasks.
#
# -----------------------------------------------------------------------------

resource "aws_security_group_rule" "efs_ingress_agent_tasks" {
  type                     = "ingress"
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.agent_tasks_isolated.id
  security_group_id        = aws_security_group.efs.id
  description              = "Allow NFS from isolated agent tasks"
}

# -----------------------------------------------------------------------------
# Network ACL: Private Subnets (Defense-in-Depth)
# -----------------------------------------------------------------------------
#
# Network ACL for private subnets providing defense-in-depth:
#   - Blocks IMDS (169.254.169.254) - CRITICAL for multi-tenant security
#   - Allows only required ports for agent operations
#   - Explicit deny for everything else
#
# IMDS Blocking Rationale:
#   In a multi-tenant environment, a compromised task could potentially
#   access the EC2 Instance Metadata Service to steal IAM credentials.
#   While Fargate doesn't expose IMDS the same way EC2 does, we block
#   it as defense-in-depth to prevent any potential bypass vectors.
#
# -----------------------------------------------------------------------------

resource "aws_network_acl" "private_isolated" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = aws_subnet.private[*].id

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-private-isolated-nacl"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "multi-tenant-isolation"
    Security    = "defense-in-depth"
  })
}

# -----------------------------------------------------------------------------
# NACL Ingress Rules
# -----------------------------------------------------------------------------

# DENY: Block IMDS (169.254.169.254) - CRITICAL for multi-tenant security
# Rule 50: Explicit deny for IMDS before any allow rules
resource "aws_network_acl_rule" "private_ingress_deny_imds" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 50
  egress         = false
  protocol       = "-1"
  rule_action    = "deny"
  cidr_block     = "169.254.169.254/32"
}

# ALLOW: Ephemeral ports for return traffic (responses to outbound requests)
# Rule 100: Required for HTTPS, SSH, DNS, NFS responses
resource "aws_network_acl_rule" "private_ingress_ephemeral" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 100
  egress         = false
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1024
  to_port        = 65535
}

# ALLOW: Ephemeral ports UDP for DNS responses
# Rule 110: Required for DNS UDP responses
resource "aws_network_acl_rule" "private_ingress_ephemeral_udp" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 110
  egress         = false
  protocol       = "udp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1024
  to_port        = 65535
}

# ALLOW: Internal VPC traffic for EFS, VPC endpoints, etc.
# Rule 200: Allow all traffic from VPC CIDR
resource "aws_network_acl_rule" "private_ingress_vpc" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 200
  egress         = false
  protocol       = "-1"
  rule_action    = "allow"
  cidr_block     = var.vpc_cidr
}

# -----------------------------------------------------------------------------
# NACL Egress Rules
# -----------------------------------------------------------------------------

# DENY: Block IMDS (169.254.169.254) - CRITICAL for multi-tenant security
# Rule 50: Explicit deny for IMDS before any allow rules
resource "aws_network_acl_rule" "private_egress_deny_imds" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 50
  egress         = true
  protocol       = "-1"
  rule_action    = "deny"
  cidr_block     = "169.254.169.254/32"
}

# ALLOW: HTTPS (443) for API calls
# Rule 100: Required for Anthropic, OpenAI, GitHub, AWS APIs
resource "aws_network_acl_rule" "private_egress_https" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 100
  egress         = true
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 443
  to_port        = 443
}

# ALLOW: SSH (22) for Git clone
# Rule 110: Required for GitHub SSH clone operations
resource "aws_network_acl_rule" "private_egress_ssh" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 110
  egress         = true
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 22
  to_port        = 22
}

# ALLOW: NFS (2049) for EFS
# Rule 120: Required for EFS workspace access (within VPC only)
resource "aws_network_acl_rule" "private_egress_nfs" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 120
  egress         = true
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = var.vpc_cidr
  from_port      = 2049
  to_port        = 2049
}

# ALLOW: DNS (53) UDP
# Rule 130: Required for name resolution
resource "aws_network_acl_rule" "private_egress_dns_udp" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 130
  egress         = true
  protocol       = "udp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 53
  to_port        = 53
}

# ALLOW: DNS (53) TCP
# Rule 140: Required for large DNS responses (DNSSEC, zone transfers)
resource "aws_network_acl_rule" "private_egress_dns_tcp" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 140
  egress         = true
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 53
  to_port        = 53
}

# ALLOW: Ephemeral ports for internal VPC communication
# Rule 200: Required for VPC endpoint responses, EFS, etc.
resource "aws_network_acl_rule" "private_egress_ephemeral" {
  network_acl_id = aws_network_acl.private_isolated.id
  rule_number    = 200
  egress         = true
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1024
  to_port        = 65535
}

# -----------------------------------------------------------------------------
# VPC Flow Logs for Network Audit
# -----------------------------------------------------------------------------
#
# Captures all network traffic for security monitoring and forensic analysis.
# Flow logs are sent to CloudWatch Logs for centralized visibility.
#
# Log Format: Custom format including all available fields for maximum visibility
# Aggregation: 1-minute intervals for near real-time monitoring
# Retention: Configurable via flow_logs_retention_days variable
#
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name              = "/aws/vpc/${var.environment}-outpost-flow-logs"
  retention_in_days = var.flow_logs_retention_days

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-vpc-flow-logs"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "network-audit"
  })
}

# IAM Role for VPC Flow Logs to write to CloudWatch
resource "aws_iam_role" "vpc_flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name = "${var.environment}-outpost-vpc-flow-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "vpc-flow-logs.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-vpc-flow-logs-role"
    Environment = var.environment
    Module      = "vpc"
  })
}

# IAM Policy for VPC Flow Logs CloudWatch access
resource "aws_iam_role_policy" "vpc_flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name = "${var.environment}-outpost-vpc-flow-logs-policy"
  role = aws_iam_role.vpc_flow_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Effect   = "Allow"
        Resource = "${aws_cloudwatch_log_group.vpc_flow_logs[0].arn}:*"
      }
    ]
  })
}

# VPC Flow Log capturing all traffic
resource "aws_flow_log" "main" {
  count = var.enable_flow_logs ? 1 : 0

  vpc_id                   = aws_vpc.main.id
  traffic_type             = "ALL"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.vpc_flow_logs[0].arn
  iam_role_arn             = aws_iam_role.vpc_flow_logs[0].arn
  max_aggregation_interval = 60

  # Custom log format for comprehensive audit trail
  log_format = "$${version} $${account-id} $${interface-id} $${srcaddr} $${dstaddr} $${srcport} $${dstport} $${protocol} $${packets} $${bytes} $${start} $${end} $${action} $${log-status} $${vpc-id} $${subnet-id} $${instance-id} $${tcp-flags} $${type} $${pkt-srcaddr} $${pkt-dstaddr} $${region} $${az-id} $${sublocation-type} $${sublocation-id} $${pkt-src-aws-service} $${pkt-dst-aws-service} $${flow-direction} $${traffic-path}"

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-vpc-flow-log"
    Environment = var.environment
    Module      = "vpc"
    Purpose     = "network-audit"
    Security    = "compliance"
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Metric Alarm: IMDS Access Attempts
# -----------------------------------------------------------------------------
#
# Alert on any attempts to access the Instance Metadata Service.
# This indicates a potential security incident in a multi-tenant environment.
#
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "imds_access_attempts" {
  count = var.enable_flow_logs ? 1 : 0

  name           = "${var.environment}-outpost-imds-access-attempts"
  log_group_name = aws_cloudwatch_log_group.vpc_flow_logs[0].name
  pattern        = "[version, account, eni, srcaddr, dstaddr=\"169.254.169.254\", ...]"

  metric_transformation {
    name          = "IMDSAccessAttempts"
    namespace     = "Outpost/Security"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "imds_access_attempts" {
  count = var.enable_flow_logs ? 1 : 0

  alarm_name          = "${var.environment}-outpost-imds-access-attempts"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "IMDSAccessAttempts"
  namespace           = "Outpost/Security"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "CRITICAL: IMDS access attempt detected in multi-tenant environment. Investigate immediately."
  treat_missing_data  = "notBreaching"

  tags = merge(var.tags, {
    Name        = "${var.environment}-outpost-imds-access-alarm"
    Environment = var.environment
    Severity    = "critical"
    Security    = "multi-tenant"
  })
}
