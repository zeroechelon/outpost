output "jobs_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "jobs_queue_arn" {
  value = aws_sqs_queue.jobs.arn
}

output "jobs_dlq_url" {
  value = aws_sqs_queue.jobs_dlq.url
}

output "jobs_dlq_arn" {
  value = aws_sqs_queue.jobs_dlq.arn
}
