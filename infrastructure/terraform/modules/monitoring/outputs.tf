# =============================================================================
# Outpost V2 - Monitoring Module Outputs
# =============================================================================

# output "log_group_name" {
#   description = "Name of the CloudWatch Log Group"
#   value       = aws_cloudwatch_log_group.ecs_tasks.name
# }

# output "log_group_arn" {
#   description = "ARN of the CloudWatch Log Group"
#   value       = aws_cloudwatch_log_group.ecs_tasks.arn
# }

# output "dashboard_url" {
#   description = "URL of the CloudWatch dashboard"
#   value       = "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#dashboards:name=${aws_cloudwatch_dashboard.fleet.dashboard_name}"
# }

# output "alarm_topic_arn" {
#   description = "ARN of the SNS topic for alarms"
#   value       = aws_sns_topic.alarms.arn
# }
