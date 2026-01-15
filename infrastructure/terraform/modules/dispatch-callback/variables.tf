variable "cluster_arn" {
  description = "ARN of the ECS cluster to monitor for task state changes"
  type        = string
}

variable "dispatches_table_name" {
  description = "Name of the DynamoDB dispatches table"
  type        = string
}

variable "dispatches_table_arn" {
  description = "ARN of the DynamoDB dispatches table"
  type        = string
}

variable "lambda_zip_path" {
  description = "Path to the Lambda function deployment package (ZIP file)"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
