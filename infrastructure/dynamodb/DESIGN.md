# Outpost V2 DynamoDB Design Evaluation

## Requirement Analysis

- **Tenants**: ~100+ concurrent tenants. Low frequency of updates. High frequency of lookup by `api_key`.
- **Jobs**: High frequency of writes (creation, status updates). Lookup by `tenant_id` (list jobs) and `job_id`.
- **Audit**: High frequency of writes. Lookup by `tenant_id` and `timestamp`.

## Evaluation: Single-Table vs Multi-Table

### Option 1: Multi-Table Design (Selected)
- **Tables**: `outpost-tenants`, `outpost-jobs`, `outpost-audit`.
- **Pros**: 
  - Cleaner isolation for TTL (Audit table).
  - Simpler IAM policies per resource.
  - Independent scaling (Jobs/Audit will have much higher throughput than Tenants).
  - Aligns with the Blueprint task descriptions.
- **Cons**: Slightly more Terraform boilerplate.

### Option 2: Single-Table Design
- **Pros**: Reduced number of resources.
- **Cons**: 
  - TTL applies to the whole table (harder to manage if different entities have different retention).
  - Overloading GSIs can become complex.
  - No significant benefit for this access pattern as cross-entity joins are not required.

## Capacity Planning (100+ Concurrent Tenants)

- **Billing Mode**: `PAY_PER_REQUEST` is ideal for MVP to handle unpredictable bursts without manual intervention.
- **Estimated Throughput**:
  - `outpost-tenants`: Low (< 10 RCU/WCU).
  - `outpost-jobs`: Moderate (~50-100 WCU during peak dispatch).
  - `outpost-audit`: Moderate (~100-200 WCU).

## Schema Definitions

### 1. Tenants Table
- **PK**: `tenant_id` (String)
- **SK**: `sk` (String) - e.g., `METADATA`, `KEY#<key_id>`
- **GSI**: `api_key-index`
  - PK: `api_key_hash` (String)
  - Projection: `ALL`

### 2. Jobs Table
- **PK**: `tenant_id` (String)
- **SK**: `job_id` (String)
- **GSI**: `status-index`
  - PK: `status` (String)
  - SK: `created_at` (String)
  - Projection: `ALL`

### 3. Audit Table
- **PK**: `tenant_id` (String)
- **SK**: `timestamp` (String)
- **TTL**: `expires_at` (Number)
