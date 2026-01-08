# Terraform variables for DynamoDB tables
environment = "prod"
project_name = "outpost"

tables = {
  tenants = {
    name           = "outpost-tenants-prod"
    billing_mode   = "PAY_PER_REQUEST"
    hash_key       = "tenant_id"
    range_key      = null
    attributes = [
      { name = "tenant_id", type = "S" },
      { name = "api_key_hash", type = "S" }
    ]
    global_secondary_indexes = [
      {
        name            = "api_key-index"
        hash_key        = "api_key_hash"
        projection_type = "ALL"
      }
    ]
  },
  jobs = {
    name           = "outpost-jobs-prod"
    billing_mode   = "PAY_PER_REQUEST"
    hash_key       = "tenant_id"
    range_key      = "job_id"
    attributes = [
      { name = "tenant_id", type = "S" },
      { name = "job_id", type = "S" },
      { name = "status", type = "S" },
      { name = "created_at", type = "S" }
    ]
    global_secondary_indexes = [
      {
        name            = "status-index"
        hash_key        = "status"
        range_key       = "created_at"
        projection_type = "ALL"
      }
    ]
  },
  audit = {
    name           = "outpost-audit-prod"
    billing_mode   = "PAY_PER_REQUEST"
    hash_key       = "tenant_id"
    range_key      = "timestamp"
    ttl_attribute  = "expires_at"
    attributes = [
      { name = "tenant_id", type = "S" },
      { name = "timestamp", type = "S" }
    ]
  }
}
