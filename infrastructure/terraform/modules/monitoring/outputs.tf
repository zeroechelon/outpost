# =============================================================================
# Outpost V2 - Monitoring Module Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# Dashboard Outputs
# -----------------------------------------------------------------------------

output "fleet_dashboard_name" {
  description = "Name of the Fleet Overview CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.fleet.dashboard_name
}

output "fleet_dashboard_arn" {
  description = "ARN of the Fleet Overview CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.fleet.dashboard_arn
}

output "fleet_dashboard_url" {
  description = "URL of the Fleet Overview CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.id}#dashboards:name=${aws_cloudwatch_dashboard.fleet.dashboard_name}"
}

output "agent_dashboard_name" {
  description = "Name of the Agent Performance CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.agent.dashboard_name
}

output "agent_dashboard_arn" {
  description = "ARN of the Agent Performance CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.agent.dashboard_arn
}

output "agent_dashboard_url" {
  description = "URL of the Agent Performance CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.id}#dashboards:name=${aws_cloudwatch_dashboard.agent.dashboard_name}"
}

output "infra_dashboard_name" {
  description = "Name of the Infrastructure CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.infra.dashboard_name
}

output "infra_dashboard_arn" {
  description = "ARN of the Infrastructure CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.infra.dashboard_arn
}

output "infra_dashboard_url" {
  description = "URL of the Infrastructure CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.id}#dashboards:name=${aws_cloudwatch_dashboard.infra.dashboard_name}"
}

# -----------------------------------------------------------------------------
# Legacy Outputs (commented for reference)
# -----------------------------------------------------------------------------

# output "log_group_name" {
#   description = "Name of the CloudWatch Log Group"
#   value       = aws_cloudwatch_log_group.ecs_tasks.name
# }

# output "log_group_arn" {
#   description = "ARN of the CloudWatch Log Group"
#   value       = aws_cloudwatch_log_group.ecs_tasks.arn
# }

# output "alarm_topic_arn" {
#   description = "ARN of the SNS topic for alarms"
#   value       = aws_sns_topic.alarms.arn
# }

# -----------------------------------------------------------------------------
# Alarm Outputs
# -----------------------------------------------------------------------------

output "cpu_high_alarm_arns" {
  description = "Map of agent to CPU high alarm ARNs"
  value       = { for agent, alarm in aws_cloudwatch_metric_alarm.cpu_high : agent => alarm.arn }
}

output "memory_high_alarm_arns" {
  description = "Map of agent to memory high alarm ARNs"
  value       = { for agent, alarm in aws_cloudwatch_metric_alarm.memory_high : agent => alarm.arn }
}

output "task_failure_alarm_arns" {
  description = "Map of agent to task failure alarm ARNs"
  value       = { for agent, alarm in aws_cloudwatch_metric_alarm.task_failures : agent => alarm.arn }
}

output "no_running_tasks_alarm_arns" {
  description = "Map of agent to no running tasks alarm ARNs"
  value       = { for agent, alarm in aws_cloudwatch_metric_alarm.no_running_tasks : agent => alarm.arn }
}

output "fleet_insufficient_tasks_alarm_arn" {
  description = "ARN of fleet insufficient tasks alarm"
  value       = aws_cloudwatch_metric_alarm.fleet_insufficient_tasks.arn
}

output "queue_depth_alarm_arn" {
  description = "ARN of queue depth alarm (empty if SQS not configured)"
  value       = length(aws_cloudwatch_metric_alarm.queue_depth_high) > 0 ? aws_cloudwatch_metric_alarm.queue_depth_high[0].arn : ""
}

output "fleet_health_composite_alarm_arn" {
  description = "ARN of fleet health composite alarm"
  value       = aws_cloudwatch_composite_alarm.fleet_health.arn
}

output "resource_exhaustion_composite_alarm_arn" {
  description = "ARN of resource exhaustion composite alarm"
  value       = aws_cloudwatch_composite_alarm.resource_exhaustion.arn
}
