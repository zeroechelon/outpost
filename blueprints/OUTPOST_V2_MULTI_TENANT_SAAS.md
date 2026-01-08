# Outpost V2 Multi-Tenant SaaS — Implementation Blueprint

> **Document Status**: Draft
> **Last Updated**: 2026-01-08
> **Owner**: Platform Team

<!-- BLUEPRINT METADATA (DO NOT REMOVE) -->
<!-- _blueprint_version: 2.0.1 -->
<!-- _generated_at: 2026-01-08T07:32:00Z -->
<!-- _generator: outpost.claude-opus -->
<!-- _depth: 2 -->
<!-- _tiers_generated: T0, T1, T2 -->
<!-- END METADATA -->

---

## Strategic Vision

Evolve Outpost from a single-operator tool to a production-grade multi-tenant SaaS platform. The current architecture (single EC2 with SSM dispatch, workspace isolation, 5 operational agents) will be transformed into a horizontally scalable system with:

- **API Gateway + Lambda** for request handling and authentication
- **SQS + ECS Fargate** for elastic job processing
- **DynamoDB** for tenant/job metadata and audit trails
- **Secrets Manager** for per-tenant API key storage
- **Stripe** for usage-based billing (BYOK model)

The system will maintain workspace isolation guarantees while enabling multiple tenants to dispatch AI agent jobs concurrently with full audit trails and per-request billing.

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| API Authentication Latency | < 50ms p99 | CloudWatch API Gateway metrics |
| Job Dispatch Latency | < 200ms p99 | SQS message age on consumption |
| Concurrent Tenants | 100+ | Active API keys with jobs in-flight |
| Horizontal Scaling | 0 to 50 workers in < 5min | ECS Fargate task count |
| Audit Trail Coverage | 100% | All API calls logged to DynamoDB |
| Billing Accuracy | 100% | Stripe invoice matches usage records |
| Workspace Isolation | Zero cross-tenant access | Security audit pass |

---

## Execution Configuration

```yaml
execution:
  shell: bash
  shell_flags: ["-e", "-o", "pipefail"]
  max_parallel_tasks: 4

  resource_locks:
    - name: "terraform_state"
      type: exclusive
    - name: "stripe_config"
      type: exclusive
    - name: "dynamodb_schema"
      type: exclusive

  preflight_checks:
    - command: "aws --version"
      expected_exit_code: 0
      error_message: "AWS CLI v2 required"
    - command: "terraform --version"
      expected_exit_code: 0
      error_message: "Terraform required"
    - command: "docker info"
      expected_exit_code: 0
      error_message: "Docker must be running"
    - command: "python3 --version"
      expected_exit_code: 0
      error_message: "Python 3.11+ required"

  secret_resolution:
    on_missing: abort
    sources:
      - type: env
        prefix: "OUTPOST_"
      - type: aws_ssm
        prefix: "/outpost/prod/"
```

---

## Tier 0: Foundation — Infrastructure & Data Models

### T0.1: DynamoDB Schema Design

```yaml
task_id: T0.1
name: "Design DynamoDB table schemas"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: []
```
```

### T0.2: Terraform Module — DynamoDB

```yaml
task_id: T0.2
name: "Create Terraform module for DynamoDB tables"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: [T0.1]
```

### T0.3: API Data Models (Python/Pydantic)

```yaml
task_id: T0.3
name: "Define API data models with Pydantic"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: [T0.1]
```

input_bindings:
  schema:
    source: T0.1
    output_port: schema
    transfer: file
    required: true

interface:
  input: "DynamoDB schema from T0.1"
  output: "Pydantic models for Tenant, Job, AuditEntry, APIKey"
  input_type: json
  output_type: file_path

output:
  location: file
  path: "/tmp/blueprint/${task_id}/models_path.txt"
  format: text
  ports:
    models_module:
      type: file_path
    model_schemas:
      type: json

required_capabilities:
  - python3.11
  - pydantic

resources:
  cpu: 1
  memory: "512Mi"
  timeout: PT1H
  locks: []

files_to_create:
  - src/outpost/models/__init__.py
  - src/outpost/models/tenant.py
  - src/outpost/models/job.py
  - src/outpost/models/audit.py
  - src/outpost/models/api_key.py

acceptance_criteria:
  - "Tenant model: id, name, email, stripe_customer_id, created_at, status"
  - "Job model: id, tenant_id, agent, command, status, created_at, completed_at, output_location"
  - "AuditEntry model: tenant_id, timestamp, action, resource, metadata, request_id"
  - "APIKey model: key_hash, tenant_id, name, scopes, created_at, last_used, revoked"
  - "All models have JSON schema export"
  - "Validation tests pass"

verification:
  smoke:
    command: "python3 -c 'from src.outpost.models import Tenant, Job, AuditEntry'"
    timeout: PT10S
  unit:
    command: "python3 -m pytest tests/unit/test_models.py -v"
    timeout: PT2M

rollback: "rm -rf src/outpost/models"

notes: |
  Use Pydantic v2 for performance. Include validators for tenant_id format (uuid).
  APIKey stores hash only, never plaintext.
```

### T0.4: Secrets Manager Integration

```yaml
task_id: T0.4
name: "Implement Secrets Manager client for API keys"
status: completed
assignee: "Claude"
estimated_sessions: 1
dependencies: [T0.3]
```

---

## Tier 1: Authentication & Authorization Layer

### T1.1: API Key Authentication Lambda

```yaml
task_id: T1.1
name: "Implement API key authentication Lambda authorizer"
status: completed
assignee: "Claude"
estimated_sessions: 3
dependencies: [T0.3, T0.4]

input_bindings:
  models_module:
    source: T0.3
    output_port: models_module
    transfer: file
    required: true
  secrets_client:
    source: T0.4
    output_port: secrets_client
    transfer: file
    required: true

interface:
  input: "API key from Authorization header"
  output: "IAM policy document allowing/denying API access"
  input_type: json
  input_schema:
    type: object
    properties:
      authorizationToken: { type: string }
      methodArn: { type: string }
    required: [authorizationToken, methodArn]
  output_type: json
  output_schema:
    type: object
    properties:
      principalId: { type: string }
      policyDocument: { type: object }
      context: { type: object }

output:
  location: file
  path: "/tmp/blueprint/${task_id}/lambda_path.txt"
  format: text
  ports:
    lambda_handler:
      type: file_path
    lambda_zip:
      type: file_path

required_capabilities:
  - python3.11
  - boto3

resources:
  cpu: 1
  memory: "512Mi"
  timeout: PT2H
  locks: []

files_to_create:
  - src/outpost/lambda/authorizer/__init__.py
  - src/outpost/lambda/authorizer/handler.py
  - src/outpost/lambda/authorizer/policy.py
  - tests/unit/test_authorizer.py

acceptance_criteria:
  - "Validates API key format (op_live_*, op_test_*)"
  - "Looks up key hash in DynamoDB"
  - "Checks key not revoked and within scope"
  - "Returns IAM policy with tenant context"
  - "Caches auth decisions (5-min TTL)"
  - "Latency < 50ms p99 (measured in tests)"
  - "Audit log entry for every auth attempt"

verification:
  smoke:
    command: "python3 -c 'from src.outpost.lambda.authorizer import handler'"
    timeout: PT10S
  unit:
    command: "python3 -m pytest tests/unit/test_authorizer.py -v --tb=short"
    timeout: PT2M
  integration:
    command: "python3 -m pytest tests/integration/test_authorizer.py -v"
    timeout: PT5M
    optional: true

rollback: "rm -rf src/outpost/lambda/authorizer"

notes: |
  Use TOKEN authorizer type. Cache policy for 300 seconds.
  Key format: op_live_<32-char-hex> or op_test_<32-char-hex>
```

### T1.2: Tenant Management API

```yaml
task_id: T1.2
name: "Implement tenant CRUD API endpoints"
status: completed
assignee: "Claude"
estimated_sessions: 3
dependencies: [T0.2, T0.3, T1.1]

input_bindings:
  models_module:
    source: T0.3
    output_port: models_module
    transfer: file
    required: true
  lambda_handler:
    source: T1.1
    output_port: lambda_handler
    transfer: file
    required: true

interface:
  input: "HTTP requests to /tenants endpoints"
  output: "Lambda handlers for tenant CRUD operations"
  input_type: json
  output_type: file_path

output:
  location: file
  path: "/tmp/blueprint/${task_id}/tenant_api_path.txt"
  format: text
  ports:
    api_handlers:
      type: file_path
    openapi_spec:
      type: file_path

required_capabilities:
  - python3.11
  - boto3

resources:
  cpu: 1
  memory: "512Mi"
  timeout: PT2H
  locks: []

files_to_create:
  - src/outpost/lambda/api/tenants.py
  - src/outpost/lambda/api/api_keys.py
  - docs/api/openapi.yaml
  - tests/unit/test_tenant_api.py

acceptance_criteria:
  - "POST /tenants - Create tenant (admin only)"
  - "GET /tenants/{id} - Get tenant details"
  - "PATCH /tenants/{id} - Update tenant"
  - "DELETE /tenants/{id} - Soft-delete tenant"
  - "POST /tenants/{id}/api-keys - Generate API key"
  - "DELETE /tenants/{id}/api-keys/{key_id} - Revoke API key"
  - "All operations create audit entries"
  - "OpenAPI spec documents all endpoints"

verification:
  smoke:
    command: "python3 -c 'from src.outpost.lambda.api.tenants import handler'"
    timeout: PT10S
  unit:
    command: "python3 -m pytest tests/unit/test_tenant_api.py -v"
    timeout: PT2M

rollback: "rm -f src/outpost/lambda/api/tenants.py src/outpost/lambda/api/api_keys.py"

notes: |
  Use Lambda function URLs or API Gateway proxy integration.
  Admin endpoints require special admin scope in API key.
```

### T1.3: API Gateway Configuration (Terraform)

```yaml
task_id: T1.3
name: "Create Terraform module for API Gateway"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: [T1.1, T1.2]
```

### T1.4: Audit Trail Service

```yaml
task_id: T1.4
name: "Implement audit trail logging service"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: [T0.2, T0.3]

input_bindings:
  models_module:
    source: T0.3
    output_port: models_module
    transfer: file
    required: true

interface:
  input: "Request context from Lambda handlers"
  output: "AuditService class for logging all API operations"
  input_type: json
  output_type: file_path

output:
  location: file
  path: "/tmp/blueprint/${task_id}/audit_service_path.txt"
  format: text
  ports:
    audit_service:
      type: file_path

required_capabilities:
  - python3.11
  - boto3

resources:
  cpu: 1
  memory: "512Mi"
  timeout: PT1H
  locks: []

files_to_create:
  - src/outpost/services/audit.py
  - tests/unit/test_audit.py

acceptance_criteria:
  - "Log all API calls with: tenant_id, action, resource, timestamp, request_id"
  - "Include request metadata (IP, user-agent, etc.)"
  - "Async write to DynamoDB (non-blocking)"
  - "TTL set for compliance retention (90 days default)"
  - "Query interface for audit retrieval"
  - "Export to S3 for long-term storage"

verification:
  smoke:
    command: "python3 -c 'from src.outpost.services.audit import AuditService'"
    timeout: PT10S
  unit:
    command: "python3 -m pytest tests/unit/test_audit.py -v"
    timeout: PT2M

rollback: "rm -f src/outpost/services/audit.py"

notes: |
  Use DynamoDB TTL for automatic cleanup. Async writes via SQS for non-blocking.
  Consider firehose to S3 for long-term retention beyond 90 days.
```

---

## Tier 2: Job Processing & Scaling Layer

### T2.1: SQS Queue Configuration (Terraform)

```yaml
task_id: T2.1
name: "Create Terraform module for SQS job queues"
status: completed
assignee: "Claude"
estimated_sessions: 1
dependencies: [T0.2]
```

input_bindings:
  dynamodb_module:
    source: T0.2
    output_port: module_path
    transfer: file
    required: true

interface:
  input: "DynamoDB module outputs from T0.2"
  output: "Terraform module for SQS queues with DLQ"
  input_type: file_path
  output_type: file_path

output:
  location: file
  path: "/tmp/blueprint/${task_id}/sqs_module_path.txt"
  format: text
  ports:
    module_path:
      type: file_path
    queue_urls:
      type: json

required_capabilities:
  - terraform

resources:
  cpu: 1
  memory: "512Mi"
  timeout: PT1H
  locks:
    - name: "terraform_state"
      mode: exclusive

files_to_create:
  - infrastructure/terraform/modules/sqs/main.tf
  - infrastructure/terraform/modules/sqs/variables.tf
  - infrastructure/terraform/modules/sqs/outputs.tf
  - infrastructure/terraform/modules/sqs/dlq.tf

acceptance_criteria:
  - "Main job queue: outpost-jobs-{env}"
  - "Dead letter queue: outpost-jobs-dlq-{env}"
  - "Visibility timeout: 15 minutes"
  - "Message retention: 14 days"
  - "DLQ redrive policy: 3 attempts"
  - "IAM policies for Lambda/Fargate access"
  - "CloudWatch alarms for DLQ depth"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/sqs/main.tf"
    timeout: PT5S
  unit:
    command: "cd infrastructure/terraform/modules/sqs && terraform init -backend=false && terraform validate"
    timeout: PT2M

rollback: "rm -rf infrastructure/terraform/modules/sqs"

notes: |
  15-minute visibility timeout allows for long-running agent jobs.
  DLQ alarm threshold: 10 messages (investigation trigger).
```

### T2.2: Job Dispatch API

```yaml
task_id: T2.2
name: "Implement job submission API endpoint"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: [T1.1, T1.4, T2.1]
```

### T2.3: ECS Fargate Task Definition

```yaml
task_id: T2.3
name: "Create Fargate task definition for job workers"
status: completed
assignee: "Claude"
estimated_sessions: 2
dependencies: [T0.4, T2.1]
```

### T2.4: Job Worker Implementation

```yaml
task_id: T2.4
name: "Implement SQS job worker for Fargate"
status: completed
assignee: "Claude"
estimated_sessions: 3
dependencies: [T0.3, T0.4, T1.4, T2.2, T2.3]
```

### T2.5: Auto-Scaling Configuration

```yaml
task_id: T2.5
name: "Configure ECS auto-scaling based on SQS depth"
status: completed
assignee: "Claude"
estimated_sessions: 1
dependencies: [T2.1, T2.3]

input_bindings:
  sqs_module:
    source: T2.1
    output_port: module_path
    transfer: file
    required: true
  ecs_module:
    source: T2.3
    output_port: module_path
    transfer: file
    required: true

interface:
  input: "SQS and ECS module outputs"
  output: "Terraform configuration for ECS auto-scaling"
  input_type: file_path
  output_type: file_path

output:
  location: file
  path: "/tmp/blueprint/${task_id}/autoscaling_path.txt"
  format: text
  ports:
    module_path:
      type: file_path

required_capabilities:
  - terraform

resources:
  cpu: 1
  memory: "512Mi"
  timeout: PT1H
  locks:
    - name: "terraform_state"
      mode: exclusive

files_to_create:
  - infrastructure/terraform/modules/autoscaling/main.tf
  - infrastructure/terraform/modules/autoscaling/variables.tf
  - infrastructure/terraform/modules/autoscaling/outputs.tf

acceptance_criteria:
  - "Target tracking on SQS ApproximateNumberOfMessagesVisible"
  - "Min capacity: 1, Max capacity: 50"
  - "Scale-out: 1 task per 5 messages"
  - "Scale-in cooldown: 5 minutes"
  - "Scale-out cooldown: 1 minute"
  - "Zero to 50 workers in < 5 minutes"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/autoscaling/main.tf"
    timeout: PT5S
  unit:
    command: "cd infrastructure/terraform/modules/autoscaling && terraform init -backend=false && terraform validate"
    timeout: PT2M

rollback: "rm -rf infrastructure/terraform/modules/autoscaling"

notes: |
  Use step scaling for predictable behavior. Consider Fargate Spot for cost savings.
  SQS-based scaling is more responsive than CPU-based for job queues.
```

---

## Dependency Graph

```yaml
dependency_graph:
  # Tier 0: Foundation
  T0.1:
    depends_on: []
  T0.2:
    depends_on: [T0.1]
    input_bindings:
      schema: T0.1.output.schema
  T0.3:
    depends_on: [T0.1]
    input_bindings:
      schema: T0.1.output.schema
  T0.4:
    depends_on: [T0.3]
    input_bindings:
      models_module: T0.3.output.models_module

  # Tier 1: Auth Layer
  T1.1:
    depends_on: [T0.3, T0.4]
    input_bindings:
      models_module: T0.3.output.models_module
      secrets_client: T0.4.output.secrets_client
  T1.2:
    depends_on: [T0.2, T0.3, T1.1]
    input_bindings:
      models_module: T0.3.output.models_module
      lambda_handler: T1.1.output.lambda_handler
  T1.3:
    depends_on: [T1.1, T1.2]
    input_bindings:
      lambda_handler: T1.1.output.lambda_handler
      api_handlers: T1.2.output.api_handlers
  T1.4:
    depends_on: [T0.2, T0.3]
    input_bindings:
      models_module: T0.3.output.models_module
    parallel_group: "services"

  # Tier 2: Job Processing
  T2.1:
    depends_on: [T0.2]
    input_bindings:
      dynamodb_module: T0.2.output.module_path
  T2.2:
    depends_on: [T1.1, T1.4, T2.1]
    input_bindings:
      lambda_handler: T1.1.output.lambda_handler
      audit_service: T1.4.output.audit_service
  T2.3:
    depends_on: [T0.4, T2.1]
    input_bindings:
      secrets_client: T0.4.output.secrets_client
      sqs_module: T2.1.output.module_path
  T2.4:
    depends_on: [T0.3, T0.4, T1.4, T2.2, T2.3]
    input_bindings:
      models_module: T0.3.output.models_module
      secrets_client: T0.4.output.secrets_client
      audit_service: T1.4.output.audit_service
  T2.5:
    depends_on: [T2.1, T2.3]
    input_bindings:
      sqs_module: T2.1.output.module_path
      ecs_module: T2.3.output.module_path
```

### Visual Representation

```
T0.1 (DynamoDB Schema)
  │
  ├──► T0.2 (Terraform DynamoDB) ──► T2.1 (SQS Queues)
  │                                      │
  └──► T0.3 (Pydantic Models)            ├──► T2.3 (ECS Task Def) ──► T2.5 (Auto-Scaling)
         │                               │         │
         └──► T0.4 (Secrets Manager) ────┴─────────┤
               │                                   │
               ├──► T1.1 (Auth Lambda) ────────────┤
               │         │                         │
               │         └──► T1.2 (Tenant API)    │
               │                   │               │
               │                   └──► T1.3 (API GW)
               │
               └──► T1.4 (Audit Service) ──► T2.2 (Job API) ──► T2.4 (Worker)
```

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-01-08 | Claude Opus | Initial draft - Tiers 0-2 |

---

## Future Tiers (T3+) — Not Generated

The following tiers are planned but not included in this depth-2 Blueprint:

- **T3: Billing Integration** — Stripe customer creation, usage metering, invoice generation, webhook handling
- **T4: Observability** — CloudWatch dashboards, X-Ray tracing, alerting, SLO monitoring
- **T5: Security Hardening** — WAF rules, VPC endpoints, encryption at rest, penetration testing
- **T6: Operations** — CI/CD pipelines, blue/green deployment, disaster recovery, runbooks

---

*Blueprint Standard Format v2.0.1*
*"Universal AI Orchestration Contract"*
