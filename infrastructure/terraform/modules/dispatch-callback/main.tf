# EventBridge rule to capture ECS task state changes
resource "aws_cloudwatch_event_rule" "ecs_task_state_change" {
  name        = "outpost-dispatch-completion"
  description = "Capture ECS task completion for dispatch status updates"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [var.cluster_arn]
      lastStatus = ["STOPPED"]
    }
  })

  tags = var.tags
}

# Lambda function for dispatch callback processing
resource "aws_lambda_function" "dispatch_callback" {
  function_name = "outpost-dispatch-callback"
  role          = aws_iam_role.dispatch_callback_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 256

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = {
      DISPATCHES_TABLE = var.dispatches_table_name
      LOG_LEVEL        = "INFO"
    }
  }

  tags = var.tags
}

# EventBridge target to invoke Lambda
resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.ecs_task_state_change.name
  target_id = "dispatch-callback-lambda"
  arn       = aws_lambda_function.dispatch_callback.arn
}

# Lambda permission for EventBridge to invoke
resource "aws_lambda_permission" "eventbridge_invoke" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dispatch_callback.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ecs_task_state_change.arn
}
