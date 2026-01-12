output "bucket_arn" {
  description = "ARN of the artifacts S3 bucket"
  value       = aws_s3_bucket.artifacts.arn
}

output "bucket_name" {
  description = "Name of the artifacts S3 bucket"
  value       = aws_s3_bucket.artifacts.id
}

output "bucket_domain_name" {
  description = "Domain name of the artifacts S3 bucket"
  value       = aws_s3_bucket.artifacts.bucket_domain_name
}

output "bucket_regional_domain_name" {
  description = "Regional domain name of the artifacts S3 bucket"
  value       = aws_s3_bucket.artifacts.bucket_regional_domain_name
}
