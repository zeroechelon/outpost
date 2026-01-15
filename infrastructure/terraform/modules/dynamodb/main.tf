resource "aws_dynamodb_table" "tenants" {
  name         = "${var.project_name}-tenants-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tenant_id"
  range_key    = "sk"

  attribute {
    name = "tenant_id"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "api_key_hash"
    type = "S"
  }

  global_secondary_index {
    name            = "api_key-index"
    hash_key        = "api_key_hash"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-tenants-${var.environment}"
  })
}

resource "aws_dynamodb_table" "jobs" {
  name         = "${var.project_name}-jobs-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tenant_id"
  range_key    = "job_id"

  attribute {
    name = "tenant_id"
    type = "S"
  }

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-jobs-${var.environment}"
  })
}

resource "aws_dynamodb_table" "audit" {
  name         = "${var.project_name}-audit-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tenant_id"
  range_key    = "timestamp"

  attribute {
    name = "tenant_id"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-audit-${var.environment}"
  })
}

# -----------------------------------------------------------------------------
# Dispatches Table
# Stores dispatch (job execution) records
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "dispatches" {
  name         = "${var.project_name}-dispatches"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "dispatch_id"

  attribute {
    name = "dispatch_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "started_at"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "task_arn"
    type = "S"
  }

  global_secondary_index {
    name            = "user-dispatches-index"
    hash_key        = "user_id"
    range_key       = "started_at"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "started_at"
    projection_type = "ALL"
  }

  # GSI for task_arn lookup - enables O(1) dispatch lookup by ECS task ARN
  # Created for T2.2 performance optimization (p95 497ms -> <100ms target)
  global_secondary_index {
    name            = "task_arn-index"
    hash_key        = "task_arn"
    projection_type = "KEYS_ONLY"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-dispatches"
  })
}

# -----------------------------------------------------------------------------
# API Keys Table
# Stores API keys for tenant authentication
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "api_keys" {
  name         = "${var.project_name}-api-keys-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "apiKeyId"

  attribute {
    name = "apiKeyId"
    type = "S"
  }

  attribute {
    name = "tenantId"
    type = "S"
  }

  attribute {
    name = "keyHashIndex"
    type = "S"
  }

  global_secondary_index {
    name            = "tenant-index"
    hash_key        = "tenantId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "key-hash-index"
    hash_key        = "keyHashIndex"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-api-keys-${var.environment}"
  })
}
