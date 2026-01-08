variable "environment" {
  type = string
}

variable "project_name" {
  type    = string
  default = "outpost"
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_name" {
  type = string
}

variable "queue_name" {
  type = string
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "max_capacity" {
  type    = number
  default = 50
}
