# Lambda execution role
resource "aws_iam_role" "dispatch_callback_lambda" {
  name = "outpost-dispatch-callback-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = var.tags
}

# DynamoDB access policy
resource "aws_iam_role_policy" "dynamodb_access" {
  name = "dynamodb-dispatch-access"
  role = aws_iam_role.dispatch_callback_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:Query"]
      Resource = [var.dispatches_table_arn, "${var.dispatches_table_arn}/index/*"]
    }]
  })
}

# CloudWatch Logs policy
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.dispatch_callback_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# CloudWatch Metrics policy for callback latency tracking
resource "aws_iam_role_policy" "cloudwatch_metrics" {
  name = "cloudwatch-metrics-access"
  role = aws_iam_role.dispatch_callback_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["cloudwatch:PutMetricData"]
      Resource = "*"
      Condition = {
        StringEquals = {
          "cloudwatch:namespace" = "Outpost/DispatchCallback"
        }
      }
    }]
  })
}
