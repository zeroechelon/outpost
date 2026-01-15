output "lambda_function_arn" {
  description = "ARN of the dispatch callback Lambda function"
  value       = aws_lambda_function.dispatch_callback.arn
}

output "eventbridge_rule_arn" {
  description = "ARN of the EventBridge rule for ECS task state changes"
  value       = aws_cloudwatch_event_rule.ecs_task_state_change.arn
}

output "lambda_role_arn" {
  description = "ARN of the Lambda execution role"
  value       = aws_iam_role.dispatch_callback_lambda.arn
}
