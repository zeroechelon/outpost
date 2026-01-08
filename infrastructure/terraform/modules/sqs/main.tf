resource "aws_sqs_queue" "jobs" {
  name                       = "${var.project_name}-jobs-${var.environment}"
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = 1209600 # 14 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })

  tags = var.tags
}

resource "aws_sqs_queue" "jobs_dlq" {
  name = "${var.project_name}-jobs-dlq-${var.environment}"
  tags = var.tags
}
