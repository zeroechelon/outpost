variable "environment" {
  type = string
}

variable "project_name" {
  type    = string
  default = "outpost"
}

variable "visibility_timeout_seconds" {
  type    = number
  default = 900 # 15 minutes
}

variable "tags" {
  type    = map(string)
  default = {}
}
