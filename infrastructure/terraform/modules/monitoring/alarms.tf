# =============================================================================
# Outpost V2 - CloudWatch Alarms
# =============================================================================
#
# Purpose: Alerting for critical Outpost platform metrics
#
# Alarm Categories:
#   1. ECS Alarms (per agent: claude, codex, gemini, aider, grok)
#      - CPU utilization > 80% (WARNING)
#      - Memory utilization > 85% (WARNING)
#      - Task failures > 3 in 5 min (CRITICAL)
#      - No running tasks for 10 min (CRITICAL)
#
#   2. Fleet Alarms
#      - Total running tasks < minimum (CRITICAL)
#      - Queue depth > 100 (WARNING)
#      - Oldest message age > 300s (WARNING)
#
#   3. Infrastructure Alarms
#      - NAT Gateway errors > 10/min (WARNING)
#      - EFS burst credits < 1TB (WARNING)
#      - S3 5xx errors > 5/min (CRITICAL)
#
# =============================================================================

# -----------------------------------------------------------------------------
# Local Variables
# -----------------------------------------------------------------------------

locals {
  alarm_agents = toset(["claude", "codex", "gemini", "aider", "grok"])

  # Severity tags for alarm classification
  warning_tags = merge(var.tags, {
    Severity = "WARNING"
    Team     = "platform"
  })

  critical_tags = merge(var.tags, {
    Severity = "CRITICAL"
    Team     = "platform"
  })
}

# -----------------------------------------------------------------------------
# Variables for Alarm Configuration
# -----------------------------------------------------------------------------

variable "alarm_actions" {
  description = "List of ARNs to notify when alarm transitions to ALARM state (e.g., SNS topic ARNs)"
  type        = list(string)
  default     = []
}

variable "ok_actions" {
  description = "List of ARNs to notify when alarm transitions to OK state"
  type        = list(string)
  default     = []
}

variable "insufficient_data_actions" {
  description = "List of ARNs to notify when alarm transitions to INSUFFICIENT_DATA state"
  type        = list(string)
  default     = []
}

variable "cpu_threshold_warning" {
  description = "CPU utilization percentage threshold for warning alarm"
  type        = number
  default     = 80
}

variable "memory_threshold_warning" {
  description = "Memory utilization percentage threshold for warning alarm"
  type        = number
  default     = 85
}

variable "task_failure_threshold" {
  description = "Number of task failures to trigger critical alarm"
  type        = number
  default     = 3
}

variable "min_running_tasks" {
  description = "Minimum number of running tasks for fleet health"
  type        = number
  default     = 1
}

variable "queue_depth_threshold" {
  description = "Maximum queue depth before warning alarm"
  type        = number
  default     = 100
}

variable "oldest_message_threshold" {
  description = "Maximum age of oldest message in seconds before warning"
  type        = number
  default     = 300
}

variable "nat_error_threshold" {
  description = "NAT Gateway error count per minute for warning alarm"
  type        = number
  default     = 10
}

variable "efs_burst_credit_threshold" {
  description = "EFS burst credit balance threshold in bytes (1TB = 1099511627776)"
  type        = number
  default     = 1099511627776
}

variable "s3_5xx_threshold" {
  description = "S3 5xx error count per minute for critical alarm"
  type        = number
  default     = 5
}

# =============================================================================
# ECS ALARMS - Per Agent
# =============================================================================

# -----------------------------------------------------------------------------
# 1. CPU Utilization High (WARNING)
# -----------------------------------------------------------------------------
# Triggers when CPU utilization exceeds threshold for 5 minutes (3 x 60s periods)

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  for_each = local.alarm_agents

  alarm_name          = "outpost-${each.key}-cpu-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CpuUtilized"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = var.cpu_threshold_warning
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: CPU utilization for ${each.key} agent exceeds ${var.cpu_threshold_warning}% for 5 minutes"

  dimensions = {
    ClusterName = "outpost-${var.environment}"
    ServiceName = "outpost-${each.key}-${var.environment}"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 2. Memory Utilization High (WARNING)
# -----------------------------------------------------------------------------
# Triggers when memory utilization exceeds threshold for 5 minutes

resource "aws_cloudwatch_metric_alarm" "memory_high" {
  for_each = local.alarm_agents

  alarm_name          = "outpost-${each.key}-memory-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "MemoryUtilized"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = var.memory_threshold_warning
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: Memory utilization for ${each.key} agent exceeds ${var.memory_threshold_warning}% for 5 minutes"

  dimensions = {
    ClusterName = "outpost-${var.environment}"
    ServiceName = "outpost-${each.key}-${var.environment}"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 3. Task Failures (CRITICAL)
# -----------------------------------------------------------------------------
# Triggers when task failures exceed threshold within 5 minutes

resource "aws_cloudwatch_metric_alarm" "task_failures" {
  for_each = local.alarm_agents

  alarm_name          = "outpost-${each.key}-task-failures-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "TaskSetTaskFailedCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Sum"
  threshold           = var.task_failure_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "CRITICAL: ${each.key} agent has more than ${var.task_failure_threshold} task failures in 5 minutes"

  dimensions = {
    ClusterName = "outpost-${var.environment}"
    ServiceName = "outpost-${each.key}-${var.environment}"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.critical_tags
}

# -----------------------------------------------------------------------------
# 4. No Running Tasks (CRITICAL)
# -----------------------------------------------------------------------------
# Triggers when agent has zero running tasks for 10 minutes

resource "aws_cloudwatch_metric_alarm" "no_running_tasks" {
  for_each = local.alarm_agents

  alarm_name          = "outpost-${each.key}-no-tasks-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = 1
  treat_missing_data  = "breaching"

  alarm_description = "CRITICAL: ${each.key} agent has no running tasks for 10 minutes"

  dimensions = {
    ClusterName = "outpost-${var.environment}"
    ServiceName = "outpost-${each.key}-${var.environment}"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.critical_tags
}

# =============================================================================
# FLEET ALARMS - Cluster-wide
# =============================================================================

# -----------------------------------------------------------------------------
# 5. Total Running Tasks Below Minimum (CRITICAL)
# -----------------------------------------------------------------------------
# Triggers when total fleet running tasks falls below minimum threshold

resource "aws_cloudwatch_metric_alarm" "fleet_insufficient_tasks" {
  alarm_name          = "outpost-fleet-insufficient-tasks-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Sum"
  threshold           = var.min_running_tasks
  treat_missing_data  = "breaching"

  alarm_description = "CRITICAL: Fleet has fewer than ${var.min_running_tasks} running tasks for 10 minutes"

  dimensions = {
    ClusterName = "outpost-${var.environment}"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.critical_tags
}

# -----------------------------------------------------------------------------
# 6. Queue Depth High (WARNING)
# -----------------------------------------------------------------------------
# Triggers when SQS queue depth exceeds threshold for 5 minutes

resource "aws_cloudwatch_metric_alarm" "queue_depth_high" {
  count = var.sqs_queue_name != "" ? 1 : 0

  alarm_name          = "outpost-queue-depth-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = var.queue_depth_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: Queue depth exceeds ${var.queue_depth_threshold} messages for 5 minutes"

  dimensions = {
    QueueName = var.sqs_queue_name
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 7. Oldest Message Age High (WARNING)
# -----------------------------------------------------------------------------
# Triggers when oldest message in queue exceeds age threshold

resource "aws_cloudwatch_metric_alarm" "message_age_high" {
  count = var.sqs_queue_name != "" ? 1 : 0

  alarm_name          = "outpost-message-age-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.oldest_message_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: Oldest message in queue is older than ${var.oldest_message_threshold} seconds"

  dimensions = {
    QueueName = var.sqs_queue_name
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# =============================================================================
# INFRASTRUCTURE ALARMS
# =============================================================================

# -----------------------------------------------------------------------------
# 8. NAT Gateway Errors (WARNING)
# -----------------------------------------------------------------------------
# Triggers when NAT Gateway error packets exceed threshold

resource "aws_cloudwatch_metric_alarm" "nat_errors" {
  count = var.nat_gateway_id != "" ? 1 : 0

  alarm_name          = "outpost-nat-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ErrorPortAllocation"
  namespace           = "AWS/NATGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = var.nat_error_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: NAT Gateway has more than ${var.nat_error_threshold} port allocation errors per minute"

  dimensions = {
    NatGatewayId = var.nat_gateway_id
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 9. NAT Gateway Packets Dropped (WARNING)
# -----------------------------------------------------------------------------
# Triggers when NAT Gateway drops packets due to connection limits

resource "aws_cloudwatch_metric_alarm" "nat_packets_dropped" {
  count = var.nat_gateway_id != "" ? 1 : 0

  alarm_name          = "outpost-nat-packets-dropped-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "PacketsDropCount"
  namespace           = "AWS/NATGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = var.nat_error_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: NAT Gateway dropping more than ${var.nat_error_threshold} packets per minute"

  dimensions = {
    NatGatewayId = var.nat_gateway_id
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 10. EFS Burst Credit Balance Low (WARNING)
# -----------------------------------------------------------------------------
# Triggers when EFS burst credit balance drops below 1TB

resource "aws_cloudwatch_metric_alarm" "efs_burst_credits_low" {
  count = var.efs_file_system_id != "" ? 1 : 0

  alarm_name          = "outpost-efs-burst-credits-low-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BurstCreditBalance"
  namespace           = "AWS/EFS"
  period              = 300
  statistic           = "Average"
  threshold           = var.efs_burst_credit_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: EFS burst credit balance is below 1TB - throughput may be throttled"

  dimensions = {
    FileSystemId = var.efs_file_system_id
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 11. EFS Percent IO Limit High (WARNING)
# -----------------------------------------------------------------------------
# Triggers when EFS IO utilization approaches limit

resource "aws_cloudwatch_metric_alarm" "efs_io_limit" {
  count = var.efs_file_system_id != "" ? 1 : 0

  alarm_name          = "outpost-efs-io-limit-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "PercentIOLimit"
  namespace           = "AWS/EFS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: EFS IO utilization exceeds 80% of permitted throughput"

  dimensions = {
    FileSystemId = var.efs_file_system_id
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# -----------------------------------------------------------------------------
# 12. S3 5xx Errors (CRITICAL)
# -----------------------------------------------------------------------------
# Triggers when S3 returns server errors

resource "aws_cloudwatch_metric_alarm" "s3_5xx_errors" {
  count = var.s3_bucket_name != "" ? 1 : 0

  alarm_name          = "outpost-s3-5xx-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5xxErrors"
  namespace           = "AWS/S3"
  period              = 60
  statistic           = "Sum"
  threshold           = var.s3_5xx_threshold
  treat_missing_data  = "notBreaching"

  alarm_description = "CRITICAL: S3 bucket has more than ${var.s3_5xx_threshold} server errors (5xx) per minute"

  dimensions = {
    BucketName = var.s3_bucket_name
    FilterId   = "EntireBucket"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.critical_tags
}

# -----------------------------------------------------------------------------
# 13. S3 4xx Errors High (WARNING)
# -----------------------------------------------------------------------------
# Triggers when S3 client errors are unusually high

resource "aws_cloudwatch_metric_alarm" "s3_4xx_errors" {
  count = var.s3_bucket_name != "" ? 1 : 0

  alarm_name          = "outpost-s3-4xx-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "4xxErrors"
  namespace           = "AWS/S3"
  period              = 60
  statistic           = "Sum"
  threshold           = 50
  treat_missing_data  = "notBreaching"

  alarm_description = "WARNING: S3 bucket has more than 50 client errors (4xx) per minute for 3 minutes"

  dimensions = {
    BucketName = var.s3_bucket_name
    FilterId   = "EntireBucket"
  }

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags
}

# =============================================================================
# COMPOSITE ALARMS - Multi-condition alerts
# =============================================================================

# -----------------------------------------------------------------------------
# 14. Fleet Health Composite (CRITICAL)
# -----------------------------------------------------------------------------
# Triggers when multiple fleet health conditions degrade simultaneously

resource "aws_cloudwatch_composite_alarm" "fleet_health" {
  alarm_name = "outpost-fleet-health-composite-${var.environment}"

  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.fleet_insufficient_tasks.alarm_name})",
    join(" OR ", [for agent in local.alarm_agents : "ALARM(${aws_cloudwatch_metric_alarm.task_failures[agent].alarm_name})"])
  ])

  alarm_description = "CRITICAL: Fleet health degraded - insufficient tasks or multiple agent failures"

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.critical_tags

  depends_on = [
    aws_cloudwatch_metric_alarm.fleet_insufficient_tasks,
    aws_cloudwatch_metric_alarm.task_failures
  ]
}

# -----------------------------------------------------------------------------
# 15. Resource Exhaustion Composite (WARNING)
# -----------------------------------------------------------------------------
# Triggers when multiple resource constraints hit simultaneously

resource "aws_cloudwatch_composite_alarm" "resource_exhaustion" {
  alarm_name = "outpost-resource-exhaustion-${var.environment}"

  alarm_rule = join(" OR ", concat(
    [for agent in local.alarm_agents : "ALARM(${aws_cloudwatch_metric_alarm.cpu_high[agent].alarm_name})"],
    [for agent in local.alarm_agents : "ALARM(${aws_cloudwatch_metric_alarm.memory_high[agent].alarm_name})"]
  ))

  alarm_description = "WARNING: Resource exhaustion detected - CPU or memory high across agents"

  alarm_actions             = var.alarm_actions
  ok_actions                = var.ok_actions
  insufficient_data_actions = var.insufficient_data_actions

  tags = local.warning_tags

  depends_on = [
    aws_cloudwatch_metric_alarm.cpu_high,
    aws_cloudwatch_metric_alarm.memory_high
  ]
}
