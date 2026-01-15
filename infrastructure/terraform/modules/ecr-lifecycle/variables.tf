# =============================================================================
# ECR Lifecycle Policy Module - Variables
# =============================================================================

variable "repository_name" {
  description = "Name of the ECR repository to apply lifecycle policy to"
  type        = string

  validation {
    condition     = length(var.repository_name) > 0
    error_message = "repository_name must not be empty."
  }
}

variable "keep_tagged_count" {
  description = "Number of tagged images to retain (images beyond this count are expired)"
  type        = number
  default     = 10

  validation {
    condition     = var.keep_tagged_count >= 1 && var.keep_tagged_count <= 1000
    error_message = "keep_tagged_count must be between 1 and 1000."
  }
}

variable "untagged_expiry_days" {
  description = "Number of days after which untagged images expire"
  type        = number
  default     = 7

  validation {
    condition     = var.untagged_expiry_days >= 1 && var.untagged_expiry_days <= 365
    error_message = "untagged_expiry_days must be between 1 and 365."
  }
}

variable "tag_prefix_list" {
  description = "Optional list of tag prefixes to match (e.g., ['v', 'release']). Empty list matches all tagged images."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for p in var.tag_prefix_list : length(p) > 0])
    error_message = "tag_prefix_list entries must not be empty strings."
  }
}
