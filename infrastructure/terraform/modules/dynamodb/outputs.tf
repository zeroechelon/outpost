output "tenants_table_arn" {
  value = aws_dynamodb_table.tenants.arn
}

output "jobs_table_arn" {
  value = aws_dynamodb_table.jobs.arn
}

output "audit_table_arn" {
  value = aws_dynamodb_table.audit.arn
}

output "tenants_table_name" {
  value = aws_dynamodb_table.tenants.name
}

output "jobs_table_name" {
  value = aws_dynamodb_table.jobs.name
}

output "audit_table_name" {
  value = aws_dynamodb_table.audit.name
}

output "api_keys_table_arn" {
  value = aws_dynamodb_table.api_keys.arn
}

output "api_keys_table_name" {
  value = aws_dynamodb_table.api_keys.name
}

output "dispatches_table_arn" {
  value = aws_dynamodb_table.dispatches.arn
}

output "dispatches_table_name" {
  value = aws_dynamodb_table.dispatches.name
}
