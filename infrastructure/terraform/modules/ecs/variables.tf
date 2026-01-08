variable "environment" {
  type = string
}

variable "project_name" {
  type    = string
  default = "outpost"
}

variable "image_uri" {
  description = "URI of the worker Docker image"
  type        = string
}

variable "cpu" {
  type    = number
  default = 2048 # 2 vCPU
}

variable "memory" {
  type    = number
  default = 4096 # 4 GB
}

variable "jobs_queue_arn" {
  type = string
}

variable "jobs_queue_url" {
  type = string
}

variable "jobs_table_arn" {
  type = string
}

variable "tenants_table_arn" {
  type = string
}

variable "audit_table_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
