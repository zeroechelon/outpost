# =============================================================================
# Outpost V2 - ECS Module CloudWatch Logs Configuration
# =============================================================================
# CloudWatch log groups for agent output and dispatch logging
# Includes metric filters for error monitoring
# =============================================================================

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  agents = toset(["claude", "codex", "gemini", "aider", "grok"])
}

# -----------------------------------------------------------------------------
# Log Groups per Agent Type
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "agents" {
  for_each = local.agents

  name              = "/outpost/agents/${each.key}"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, {
    Name        = "outpost-agent-${each.key}"
    Environment = var.environment
    Agent       = each.key
    Component   = "cloudwatch-logs"
  })
}

# -----------------------------------------------------------------------------
# Log Group for Dispatches
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "dispatches" {
  name              = "/outpost/dispatches"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, {
    Name        = "outpost-dispatches"
    Environment = var.environment
    Component   = "cloudwatch-logs"
  })
}

# -----------------------------------------------------------------------------
# Metric Filters for Error Monitoring
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "agent_errors" {
  for_each = aws_cloudwatch_log_group.agents

  name           = "outpost-${each.key}-errors"
  pattern        = "ERROR"
  log_group_name = each.value.name

  metric_transformation {
    name      = "AgentErrors"
    namespace = "Outpost"
    value     = "1"
    dimensions = {
      Agent = each.key
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "dispatch_errors" {
  name           = "outpost-dispatch-errors"
  pattern        = "ERROR"
  log_group_name = aws_cloudwatch_log_group.dispatches.name

  metric_transformation {
    name      = "DispatchErrors"
    namespace = "Outpost"
    value     = "1"
  }
}

# -----------------------------------------------------------------------------
# Optional: KMS Encryption (can be enabled by setting kms_key_arn variable)
# -----------------------------------------------------------------------------
# Note: To enable KMS encryption for log groups, add kms_key_id argument:
#   kms_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null
# This requires the KMS key policy to allow CloudWatch Logs service.
