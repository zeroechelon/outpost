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
