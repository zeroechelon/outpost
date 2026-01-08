variable "environment" {
  description = "Environment name"
  type        = string
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "outpost"
}

variable "authorizer_lambda_arn" {
  description = "ARN of the Lambda authorizer"
  type        = string
}

variable "tenants_lambda_arn" {
  description = "ARN of the tenants management Lambda"
  type        = string
}

variable "jobs_lambda_arn" {
  description = "ARN of the jobs management Lambda"
  type        = string
}

variable "api_keys_lambda_arn" {
  description = "ARN of the API keys management Lambda"
  type        = string
}

variable "tags" {
  description = "Tags to apply"
  type        = map(string)
  default     = {}
}
