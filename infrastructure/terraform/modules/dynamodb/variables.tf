variable "environment" {
  description = "Environment name (e.g., prod, dev)"
  type        = string
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "outpost"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
