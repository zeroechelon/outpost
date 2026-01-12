# OUTPOST_V2_COMMANDER_PLATFORM — Blueprint Specification

> **Document Status**: In Progress
> **Last Updated**: 2026-01-12
> **Owner**: Platform Team
> **Estimated Effort**: 7-8 weeks
> **Progress**: 37/186 tasks (20%) - T0+T1 Complete

<!-- BLUEPRINT METADATA (DO NOT REMOVE) -->
<!-- _blueprint_version: 2.0.1 -->
<!-- _generated_at: 2026-01-12T18:30:00Z -->
<!-- _generator: claude-opus-4.5 (manual, zeOS session) -->
<!-- _depth: 5 -->
<!-- _tiers_generated: T0-T10 -->
<!-- _total_tasks: 186 -->
<!-- _completed_tasks: 37 -->
<!-- _completed_tiers: T0, T1 -->
<!-- _next_tier: T2 -->
<!-- _last_execution: 2026-01-12T21:45:00Z -->
<!-- END METADATA -->

---

## Strategic Vision

Transform Outpost from a single-server prototype into a **production-grade multi-tenant container orchestration platform** serving as Commander's execution layer. Commander ("The Singularity Agent") is a multi-tenant SaaS platform that orchestrates AI agents to build complete products from user prompts. Users authorize charges, and Commander dispatches work to agents running in **completely isolated containers**.

**Current State (v1.8.1):**
- Single Lightsail instance with SSM-based dispatch
- Directory-based isolation (not container-based)
- Internal use only (no multi-tenancy)
- 5 agents: Claude, Codex, Gemini, Aider, Grok (flagship models only)
- No cost tracking, no billing integration

**Target State (v2.0):**
- ECS Fargate cluster with container-per-dispatch isolation
- Multi-tenant (1000+ daily users with complete isolation)
- Model selection (haiku/sonnet/opus, gpt-4o/gpt-5, flash/pro, etc.)
- Ephemeral and persistent workspace modes (EFS)
- Ledger integration for real-time cost tracking
- MCPify as sole interface (SSM deprecated)
- Warm pool for <5s cold starts
- Streaming output via CloudWatch + SSE
- Health monitoring and auto-scaling

**zeOS Integration Points:**
| Project | Integration |
|---------|-------------|
| MCPify | Primary interface - 6+ new tools for Outpost v2 |
| Ledger | Cost event emission for user billing |
| Blueprint | Task specification format for complex dispatches |
| AWS Audit | Infrastructure security validation |

---

## Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Multi-tenant isolation | 100% | Penetration test: User A cannot access User B resources |
| Agent availability | 5/5 agents dispatchable | Integration test per agent type |
| Model selection | All tiers per agent | API test: dispatch with model override |
| Cold start (warm pool) | <5 seconds | Load test with pool exhaustion |
| Cold start (no pool) | <30 seconds | Load test without warm pool |
| Streaming latency | <2 seconds | End-to-end latency measurement |
| Cost tracking accuracy | >99% | Cross-reference AWS billing vs Ledger events |
| Workspace persistence | 100% | Resume test with EFS mount verification |
| Timeout enforcement | 100% | Test: Container terminates at configured timeout |
| Health endpoint response | <500ms | Load test health endpoint |
| Daily user capacity | 1000+ concurrent | Load test with simulated traffic |
| Legacy deprecation | 0 SSM dispatches | Monitor SSM usage post-cutover |

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
    - name: "ecr_push"
      type: shared
      max_holders: 3
    - name: "ecs_deploy"
      type: exclusive

  preflight_checks:
    - command: "aws --version | grep -q 'aws-cli/2'"
      expected_exit_code: 0
      error_message: "AWS CLI v2 required"
    - command: "terraform --version | grep -q 'v1\\.'"
      expected_exit_code: 0
      error_message: "Terraform 1.x required"
    - command: "docker info > /dev/null 2>&1"
      expected_exit_code: 0
      error_message: "Docker must be running"
    - command: "node --version | grep -q 'v20\\|v22'"
      expected_exit_code: 0
      error_message: "Node.js 20+ required"
    - command: "python3 --version | grep -q '3\\.11\\|3\\.12'"
      expected_exit_code: 0
      error_message: "Python 3.11+ required"

  secret_resolution:
    on_missing: abort
    sources:
      - type: env
        prefix: ""
      - type: file
        path: ".env"
      - type: aws_ssm
        prefix: "/outpost/"
```

---

## Agent Model Registry

Outpost v2 supports multiple model tiers per agent family. Commander can select any available model.

```yaml
agent_registry:
  claude:
    provider: anthropic
    models:
      - id: claude-opus-4-5-20251101
        tier: flagship
        cost_multiplier: 1.0
        capabilities: [complex_reasoning, architecture, multi_file]
      - id: claude-sonnet-4-5-20250929
        tier: balanced
        cost_multiplier: 0.4
        capabilities: [code_generation, refactoring]
      - id: claude-haiku-4-5-20250801
        tier: fast
        cost_multiplier: 0.1
        capabilities: [quick_tasks, simple_fixes]
    container_image: outpost/agent-claude

  codex:
    provider: openai
    models:
      - id: gpt-5.2-codex
        tier: flagship
        cost_multiplier: 1.0
        capabilities: [code_generation, test_writing]
      - id: gpt-4o-codex
        tier: balanced
        cost_multiplier: 0.3
        capabilities: [general_coding]
    container_image: outpost/agent-codex

  gemini:
    provider: google
    models:
      - id: gemini-3-pro-preview
        tier: flagship
        cost_multiplier: 1.0
        capabilities: [analysis, documentation, broad_context]
      - id: gemini-3-flash
        tier: fast
        cost_multiplier: 0.15
        capabilities: [quick_analysis, summaries]
    container_image: outpost/agent-gemini

  aider:
    provider: deepseek
    models:
      - id: deepseek/deepseek-coder
        tier: flagship
        cost_multiplier: 0.05
        capabilities: [iterative_editing, pair_programming]
      - id: deepseek/deepseek-chat
        tier: balanced
        cost_multiplier: 0.02
        capabilities: [general_assistance]
    container_image: outpost/agent-aider

  grok:
    provider: xai
    models:
      - id: grok-4.1
        tier: flagship
        cost_multiplier: 0.8
        capabilities: [risk_analysis, contrarian_review]
      - id: grok-4.1-fast-reasoning
        tier: fast
        cost_multiplier: 0.4
        capabilities: [quick_analysis]
    container_image: outpost/agent-grok
```

---

## Tier 0: Foundation — MCP Interface Contracts

### T0.1: Define MCP Tool Schemas

```yaml
task_id: T0.1
name: "Define complete MCP tool schemas for Outpost v2"
status: not_started
dependencies: []

interface:
  input: "Commander requirements specification, current MCPify provider structure"
  output: "MCP tool schema definitions in TypeScript/JSON Schema format"
  output_type: json

output:
  location: file
  path: "src/mcp/schemas/outpost-v2-tools.schema.json"
  ports:
    schemas_defined:
      type: boolean

acceptance_criteria:
  - "outpost_dispatch schema includes user_id, repo, task, agent, model, workspace_mode, timeout, secrets"
  - "outpost_status schema returns status, progress, logs with streaming support"
  - "outpost_cancel schema accepts dispatch_id"
  - "outpost_list_workspaces returns user's persistent workspaces"
  - "outpost_delete_workspace accepts user_id and workspace_id"
  - "outpost_get_artifacts returns presigned S3 URLs"
  - "outpost_health returns fleet status with per-agent metrics"
  - "All schemas validate against JSON Schema Draft 7"

verification:
  smoke:
    command: "test -f src/mcp/schemas/outpost-v2-tools.schema.json"
    timeout: PT10S
  unit:
    command: "npx ajv validate -s src/mcp/schemas/outpost-v2-tools.schema.json"
    timeout: PT30S

rollback: "git checkout HEAD -- src/mcp/schemas/"

required_capabilities:
  - node20
  - ajv
```

#### T0.1.1: Define outpost_dispatch Schema

```yaml
task_id: T0.1.1
name: "Define outpost_dispatch tool schema with model selection"
status: not_started
dependencies: []

interface:
  input: "Commander dispatch requirements"
  output: "outpost_dispatch schema definition"
  output_type: json

output:
  location: file
  path: "src/mcp/schemas/dispatch.schema.json"
  ports:
    dispatch_schema:
      type: json
      schema:
        type: object
        properties:
          name: { type: string, const: "outpost_dispatch" }
          inputSchema: { type: object }

acceptance_criteria:
  - "user_id: string (required) - Commander user identifier"
  - "repo: string (optional) - GitHub repo in owner/repo format"
  - "task: string (required) - Task description for agent"
  - "agent: enum [claude, codex, gemini, aider, grok] (required)"
  - "model: string (optional) - Specific model ID override"
  - "workspace_mode: enum [ephemeral, persistent] (default: ephemeral)"
  - "timeout_seconds: number (default: 600, max: 3600)"
  - "secrets: array of secret key names to inject"
  - "context_level: enum [minimal, standard, full] (optional)"

verification:
  smoke:
    command: "test -f src/mcp/schemas/dispatch.schema.json && jq '.properties.agent' src/mcp/schemas/dispatch.schema.json"
    timeout: PT10S

rollback: "rm -f src/mcp/schemas/dispatch.schema.json"

required_capabilities:
  - jq
```

#### T0.1.2: Define outpost_status Schema

```yaml
task_id: T0.1.2
name: "Define outpost_status tool schema with streaming"
status: not_started
dependencies: []

interface:
  input: "Commander status polling requirements"
  output: "outpost_status schema definition"
  output_type: json

output:
  location: file
  path: "src/mcp/schemas/status.schema.json"
  ports:
    status_schema:
      type: json

acceptance_criteria:
  - "dispatch_id: string (required)"
  - "include_logs: boolean (default: true)"
  - "log_offset: number (optional) - For pagination"
  - "Response includes: status enum, progress percentage, logs array, started_at, ended_at"
  - "Streaming support via log_offset continuation token"

verification:
  smoke:
    command: "test -f src/mcp/schemas/status.schema.json"
    timeout: PT10S

rollback: "rm -f src/mcp/schemas/status.schema.json"

required_capabilities:
  - jq
```

#### T0.1.3: Define outpost_health Schema

```yaml
task_id: T0.1.3
name: "Define outpost_health tool schema"
status: not_started
dependencies: []

interface:
  input: "Fleet health monitoring requirements"
  output: "outpost_health schema definition"
  output_type: json

output:
  location: file
  path: "src/mcp/schemas/health.schema.json"
  ports:
    health_schema:
      type: json

acceptance_criteria:
  - "No input parameters required"
  - "Response: status enum [healthy, degraded, unhealthy]"
  - "Response: agents object with per-agent metrics"
  - "Per-agent: pool_size, active_dispatches, success_rate, avg_duration"
  - "Response: dispatches_last_hour count"
  - "Response: system metrics (cpu, memory utilization)"

verification:
  smoke:
    command: "test -f src/mcp/schemas/health.schema.json"
    timeout: PT10S

rollback: "rm -f src/mcp/schemas/health.schema.json"
```

#### T0.1.4: Define Workspace Management Schemas

```yaml
task_id: T0.1.4
name: "Define workspace management tool schemas"
status: not_started
dependencies: []

interface:
  input: "Persistent workspace requirements"
  output: "Workspace schemas (list, delete, get_artifacts)"
  output_type: json

output:
  location: file
  path: "src/mcp/schemas/workspace.schema.json"
  ports:
    workspace_schemas:
      type: json

acceptance_criteria:
  - "outpost_list_workspaces: user_id input, returns workspace list with metadata"
  - "outpost_delete_workspace: user_id + workspace_id input"
  - "outpost_get_artifacts: dispatch_id input, returns presigned S3 URLs"
  - "Workspace metadata includes: id, created_at, last_accessed, size_bytes, repo"

verification:
  smoke:
    command: "test -f src/mcp/schemas/workspace.schema.json"
    timeout: PT10S

rollback: "rm -f src/mcp/schemas/workspace.schema.json"
```

#### T0.1.5: Consolidate and Validate All Schemas

```yaml
task_id: T0.1.5
name: "Consolidate schemas into single file and validate"
status: not_started
dependencies: [T0.1.1, T0.1.2, T0.1.3, T0.1.4]

input_bindings:
  dispatch_schema:
    source: T0.1.1
    output_port: dispatch_schema
    transfer: file
    required: true
  status_schema:
    source: T0.1.2
    output_port: status_schema
    transfer: file
    required: true
  health_schema:
    source: T0.1.3
    output_port: health_schema
    transfer: file
    required: true
  workspace_schemas:
    source: T0.1.4
    output_port: workspace_schemas
    transfer: file
    required: true

interface:
  input: "Individual schema files"
  output: "Consolidated outpost-v2-tools.schema.json"
  output_type: json

output:
  location: file
  path: "src/mcp/schemas/outpost-v2-tools.schema.json"
  ports:
    schemas_defined:
      type: boolean

acceptance_criteria:
  - "All 7 tools defined in single schema file"
  - "Schema validates against JSON Schema Draft 7"
  - "Examples provided for each tool"
  - "TypeScript types can be generated from schema"

verification:
  smoke:
    command: "jq '.tools | length' src/mcp/schemas/outpost-v2-tools.schema.json | grep -q '7'"
    timeout: PT10S
  unit:
    command: "npx ajv compile -s src/mcp/schemas/outpost-v2-tools.schema.json"
    timeout: PT30S

rollback: "git checkout HEAD -- src/mcp/schemas/outpost-v2-tools.schema.json"

required_capabilities:
  - node20
  - ajv
  - jq
```

### T0.2: Define Ledger Cost Event Schema

```yaml
task_id: T0.2
name: "Define cost event schema for Ledger integration"
status: not_started
dependencies: []

interface:
  input: "Commander billing requirements, Ledger API spec"
  output: "Cost event JSON schema for dispatch_complete events"
  output_type: json

output:
  location: file
  path: "src/integrations/ledger/cost-event.schema.json"
  ports:
    cost_schema:
      type: json

acceptance_criteria:
  - "Event type: dispatch_complete"
  - "Required fields: user_id, dispatch_id, agent, model, started_at, ended_at"
  - "Resource fields: duration_seconds, vcpu, memory_mb, network_egress_bytes"
  - "Token fields: tokens_input, tokens_output (for LLM cost calculation)"
  - "Status field: success | failure | timeout"
  - "Workspace mode: ephemeral | persistent"
  - "Storage fields: efs_size_bytes (for persistent workspaces)"

verification:
  smoke:
    command: "test -f src/integrations/ledger/cost-event.schema.json"
    timeout: PT10S
  unit:
    command: "jq '.required | contains([\"user_id\", \"dispatch_id\", \"agent\"])' src/integrations/ledger/cost-event.schema.json | grep -q true"
    timeout: PT10S

rollback: "rm -f src/integrations/ledger/cost-event.schema.json"

required_capabilities:
  - jq
```

### T0.3: Create Infrastructure Directory Structure

```yaml
task_id: T0.3
name: "Create Terraform module directory structure"
status: not_started
dependencies: []

interface:
  input: "AWS architecture requirements"
  output: "Terraform directory scaffold"

output:
  location: file
  path: "infrastructure/"
  ports:
    structure_created:
      type: boolean

acceptance_criteria:
  - "infrastructure/terraform/ root with providers.tf, variables.tf, main.tf"
  - "infrastructure/terraform/modules/vpc/ for networking"
  - "infrastructure/terraform/modules/ecs/ for Fargate cluster"
  - "infrastructure/terraform/modules/ecr/ for container registry"
  - "infrastructure/terraform/modules/efs/ for persistent storage"
  - "infrastructure/terraform/modules/secrets/ for Secrets Manager"
  - "infrastructure/terraform/modules/monitoring/ for CloudWatch"
  - "infrastructure/terraform/environments/dev/ and /prod/"

verification:
  smoke:
    command: "test -d infrastructure/terraform/modules/ecs && test -d infrastructure/terraform/modules/ecr"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/"

required_capabilities:
  - bash
```

#### T0.3.1: Create VPC Module Scaffold

```yaml
task_id: T0.3.1
name: "Create VPC Terraform module scaffold"
status: not_started
dependencies: [T0.3]

interface:
  input: "Directory structure from T0.3"
  output: "VPC module with main.tf, variables.tf, outputs.tf"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/"
  ports:
    vpc_module:
      type: file_path

acceptance_criteria:
  - "main.tf with VPC resource, subnets (public/private), NAT gateway, IGW"
  - "variables.tf with vpc_cidr, availability_zones, environment"
  - "outputs.tf with vpc_id, public_subnet_ids, private_subnet_ids"
  - "Security group for ECS tasks (egress to internet, internal communication)"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/vpc/main.tf"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/modules/vpc/"
```

#### T0.3.2: Create ECS Module Scaffold

```yaml
task_id: T0.3.2
name: "Create ECS Fargate Terraform module scaffold"
status: not_started
dependencies: [T0.3]

interface:
  input: "Directory structure from T0.3"
  output: "ECS module with cluster, task definitions, service"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/"
  ports:
    ecs_module:
      type: file_path

acceptance_criteria:
  - "main.tf with ECS cluster (Fargate capacity providers)"
  - "task_definitions.tf for agent task definitions"
  - "iam.tf for task execution role and task role"
  - "variables.tf with cluster_name, agent configurations"
  - "outputs.tf with cluster_arn, task_definition_arns"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/ecs/main.tf"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/modules/ecs/"
```

#### T0.3.3: Create ECR Module Scaffold

```yaml
task_id: T0.3.3
name: "Create ECR Terraform module scaffold"
status: not_started
dependencies: [T0.3]

interface:
  input: "Directory structure from T0.3"
  output: "ECR module for agent container repositories"

output:
  location: file
  path: "infrastructure/terraform/modules/ecr/"
  ports:
    ecr_module:
      type: file_path

acceptance_criteria:
  - "main.tf with ECR repositories (one per agent + base)"
  - "Lifecycle policy for image retention (keep last 10)"
  - "Image scanning enabled on push"
  - "variables.tf with repository names, retention settings"
  - "outputs.tf with repository_urls map"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/ecr/main.tf"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/modules/ecr/"
```

#### T0.3.4: Create EFS Module Scaffold

```yaml
task_id: T0.3.4
name: "Create EFS Terraform module scaffold"
status: not_started
dependencies: [T0.3]

interface:
  input: "Directory structure from T0.3"
  output: "EFS module for persistent workspaces"

output:
  location: file
  path: "infrastructure/terraform/modules/efs/"
  ports:
    efs_module:
      type: file_path

acceptance_criteria:
  - "main.tf with EFS filesystem, access points, mount targets"
  - "Per-user access point creation pattern (dynamic)"
  - "Encryption at rest enabled"
  - "Performance mode: generalPurpose"
  - "variables.tf with filesystem_name, vpc_id, subnet_ids"
  - "outputs.tf with filesystem_id, filesystem_arn"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/efs/main.tf"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/modules/efs/"
```

#### T0.3.5: Create Secrets Module Scaffold

```yaml
task_id: T0.3.5
name: "Create Secrets Manager Terraform module scaffold"
status: not_started
dependencies: [T0.3]

interface:
  input: "Directory structure from T0.3"
  output: "Secrets module for API keys and credentials"

output:
  location: file
  path: "infrastructure/terraform/modules/secrets/"
  ports:
    secrets_module:
      type: file_path

acceptance_criteria:
  - "main.tf with Secrets Manager secrets for LLM API keys"
  - "Secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, XAI_API_KEY, DEEPSEEK_API_KEY"
  - "Per-user secret namespace support (/outpost/users/{user_id}/)"
  - "Rotation policy configuration (optional)"
  - "KMS encryption with custom key"
  - "IAM policy for ECS task access"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/secrets/main.tf"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/modules/secrets/"
```

---

## Tier 1: AWS Infrastructure — Core Resources

### T1.1: Implement VPC Module

```yaml
task_id: T1.1
name: "Implement production VPC with multi-AZ subnets"
status: not_started
dependencies: [T0.3.1]

input_bindings:
  vpc_scaffold:
    source: T0.3.1
    output_port: vpc_module
    transfer: file
    required: true

interface:
  input: "VPC module scaffold"
  output: "Complete VPC module with networking resources"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/"
  ports:
    vpc_complete:
      type: boolean

acceptance_criteria:
  - "VPC with 10.0.0.0/16 CIDR (configurable)"
  - "3 public subnets across AZs (10.0.1.0/24, 10.0.2.0/24, 10.0.3.0/24)"
  - "3 private subnets across AZs (10.0.11.0/24, 10.0.12.0/24, 10.0.13.0/24)"
  - "Internet Gateway attached to VPC"
  - "NAT Gateway in each public subnet (for HA)"
  - "Route tables: public routes to IGW, private routes to NAT"
  - "VPC Flow Logs enabled to CloudWatch"
  - "DNS hostnames and DNS resolution enabled"

verification:
  smoke:
    command: "cd infrastructure/terraform/modules/vpc && terraform fmt -check"
    timeout: PT30S
  unit:
    command: "cd infrastructure/terraform/modules/vpc && terraform validate"
    timeout: PT1M

rollback: "git checkout HEAD -- infrastructure/terraform/modules/vpc/"

required_capabilities:
  - terraform
```

#### T1.1.1: Create VPC and Internet Gateway

```yaml
task_id: T1.1.1
name: "Create VPC resource with Internet Gateway"
status: not_started
dependencies: [T0.3.1]

interface:
  input: "VPC module scaffold"
  output: "VPC and IGW resources in main.tf"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/main.tf"
  ports:
    vpc_created:
      type: boolean

acceptance_criteria:
  - "aws_vpc resource with configurable CIDR"
  - "enable_dns_hostnames = true"
  - "enable_dns_support = true"
  - "aws_internet_gateway attached to VPC"
  - "Tags with environment and Name"

verification:
  smoke:
    command: "grep -q 'aws_vpc' infrastructure/terraform/modules/vpc/main.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/vpc/main.tf"
```

#### T1.1.2: Create Public Subnets

```yaml
task_id: T1.1.2
name: "Create public subnets across availability zones"
status: not_started
dependencies: [T1.1.1]

interface:
  input: "VPC created"
  output: "Public subnet resources"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/subnets.tf"
  ports:
    public_subnets:
      type: boolean

acceptance_criteria:
  - "aws_subnet resources for public subnets"
  - "map_public_ip_on_launch = true"
  - "One subnet per AZ (3 total)"
  - "CIDR blocks: 10.0.1.0/24, 10.0.2.0/24, 10.0.3.0/24"
  - "Route table association with public route table"

verification:
  smoke:
    command: "grep -q 'map_public_ip_on_launch.*true' infrastructure/terraform/modules/vpc/subnets.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/vpc/subnets.tf"
```

#### T1.1.3: Create Private Subnets

```yaml
task_id: T1.1.3
name: "Create private subnets for ECS tasks"
status: not_started
dependencies: [T1.1.1]

interface:
  input: "VPC created"
  output: "Private subnet resources"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/subnets.tf"
  ports:
    private_subnets:
      type: boolean

acceptance_criteria:
  - "aws_subnet resources for private subnets"
  - "map_public_ip_on_launch = false"
  - "One subnet per AZ (3 total)"
  - "CIDR blocks: 10.0.11.0/24, 10.0.12.0/24, 10.0.13.0/24"
  - "Route table association with private route table (NAT)"

verification:
  smoke:
    command: "grep -c 'aws_subnet' infrastructure/terraform/modules/vpc/subnets.tf | grep -q '[3-6]'"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/vpc/subnets.tf"
```

#### T1.1.4: Create NAT Gateways

```yaml
task_id: T1.1.4
name: "Create NAT Gateways for private subnet egress"
status: not_started
dependencies: [T1.1.2]

interface:
  input: "Public subnets created"
  output: "NAT Gateway resources with EIPs"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/nat.tf"
  ports:
    nat_created:
      type: boolean

acceptance_criteria:
  - "aws_eip for each NAT Gateway"
  - "aws_nat_gateway in each public subnet"
  - "Configurable: single NAT (dev) vs multi-NAT (prod)"
  - "Route table entries for private subnets to NAT"

verification:
  smoke:
    command: "grep -q 'aws_nat_gateway' infrastructure/terraform/modules/vpc/nat.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/vpc/nat.tf"
```

#### T1.1.5: Create Security Groups

```yaml
task_id: T1.1.5
name: "Create security groups for ECS tasks"
status: not_started
dependencies: [T1.1.1]

interface:
  input: "VPC created"
  output: "Security group resources"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/security_groups.tf"
  ports:
    security_groups:
      type: boolean

acceptance_criteria:
  - "ECS task security group: egress to 0.0.0.0/0 on 443 (HTTPS)"
  - "ECS task security group: egress to 0.0.0.0/0 on 22 (Git SSH)"
  - "ECS task security group: no ingress (tasks don't receive inbound)"
  - "EFS security group: ingress from ECS task SG on 2049 (NFS)"
  - "VPC endpoints security group (if using PrivateLink)"

verification:
  smoke:
    command: "grep -q 'aws_security_group' infrastructure/terraform/modules/vpc/security_groups.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/vpc/security_groups.tf"
```

### T1.2: Implement ECR Module

```yaml
task_id: T1.2
name: "Implement ECR repositories for agent images"
status: not_started
dependencies: [T0.3.3]

input_bindings:
  ecr_scaffold:
    source: T0.3.3
    output_port: ecr_module
    transfer: file
    required: true

interface:
  input: "ECR module scaffold"
  output: "Complete ECR module with repositories"

output:
  location: file
  path: "infrastructure/terraform/modules/ecr/"
  ports:
    ecr_complete:
      type: boolean

acceptance_criteria:
  - "6 repositories: base, claude, codex, gemini, aider, grok"
  - "Image scanning on push enabled"
  - "Lifecycle policy: keep last 10 tagged images"
  - "Lifecycle policy: delete untagged after 7 days"
  - "Encryption with AWS-managed key"
  - "Repository policy for ECS task role access"

verification:
  smoke:
    command: "cd infrastructure/terraform/modules/ecr && terraform validate"
    timeout: PT1M

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecr/"

required_capabilities:
  - terraform
```

#### T1.2.1: Create ECR Repositories

```yaml
task_id: T1.2.1
name: "Create ECR repository resources"
status: not_started
dependencies: [T0.3.3]

interface:
  input: "ECR module scaffold"
  output: "ECR repository resources"

output:
  location: file
  path: "infrastructure/terraform/modules/ecr/main.tf"
  ports:
    repos_created:
      type: boolean

acceptance_criteria:
  - "aws_ecr_repository for: outpost-base, outpost-claude, outpost-codex, outpost-gemini, outpost-aider, outpost-grok"
  - "image_scanning_configuration { scan_on_push = true }"
  - "encryption_configuration { encryption_type = \"AES256\" }"
  - "image_tag_mutability = \"MUTABLE\" (for :latest tag updates)"

verification:
  smoke:
    command: "grep -c 'aws_ecr_repository' infrastructure/terraform/modules/ecr/main.tf | grep -q '6'"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecr/main.tf"
```

#### T1.2.2: Create ECR Lifecycle Policies

```yaml
task_id: T1.2.2
name: "Create ECR lifecycle policies for image retention"
status: not_started
dependencies: [T1.2.1]

interface:
  input: "ECR repositories created"
  output: "Lifecycle policies attached"

output:
  location: file
  path: "infrastructure/terraform/modules/ecr/lifecycle.tf"
  ports:
    lifecycle_set:
      type: boolean

acceptance_criteria:
  - "aws_ecr_lifecycle_policy for each repository"
  - "Rule 1: Keep last 10 images with semantic version tags"
  - "Rule 2: Delete untagged images older than 7 days"
  - "Rule priority ordering correct"

verification:
  smoke:
    command: "grep -q 'aws_ecr_lifecycle_policy' infrastructure/terraform/modules/ecr/lifecycle.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecr/lifecycle.tf"
```

### T1.3: Implement ECS Module

```yaml
task_id: T1.3
name: "Implement ECS Fargate cluster and task definitions"
status: not_started
dependencies: [T0.3.2, T1.1, T1.2]

input_bindings:
  ecs_scaffold:
    source: T0.3.2
    output_port: ecs_module
    transfer: file
    required: true
  vpc_complete:
    source: T1.1
    output_port: vpc_complete
    transfer: memory
    required: true
  ecr_complete:
    source: T1.2
    output_port: ecr_complete
    transfer: memory
    required: true

interface:
  input: "ECS module scaffold, VPC and ECR ready"
  output: "Complete ECS cluster with task definitions"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/"
  ports:
    ecs_complete:
      type: boolean

acceptance_criteria:
  - "ECS cluster with Fargate and Fargate Spot capacity providers"
  - "Task definition per agent type with configurable resources"
  - "Task execution IAM role with ECR pull permissions"
  - "Task IAM role with Secrets Manager read, S3 write, CloudWatch logs"
  - "Container definitions with log configuration"
  - "EFS volume mount configuration (conditional)"

verification:
  smoke:
    command: "cd infrastructure/terraform/modules/ecs && terraform validate"
    timeout: PT1M

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecs/"

required_capabilities:
  - terraform
```

#### T1.3.1: Create ECS Cluster

```yaml
task_id: T1.3.1
name: "Create ECS Fargate cluster"
status: not_started
dependencies: [T0.3.2]

interface:
  input: "ECS module scaffold"
  output: "ECS cluster resource"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/cluster.tf"
  ports:
    cluster_created:
      type: boolean

acceptance_criteria:
  - "aws_ecs_cluster with Container Insights enabled"
  - "Capacity providers: FARGATE, FARGATE_SPOT"
  - "Default capacity provider strategy (FARGATE_SPOT for cost optimization)"
  - "Cluster name: outpost-{environment}"
  - "Tags with environment and managed-by"

verification:
  smoke:
    command: "grep -q 'aws_ecs_cluster' infrastructure/terraform/modules/ecs/cluster.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecs/cluster.tf"
```

#### T1.3.2: Create Task Execution Role

```yaml
task_id: T1.3.2
name: "Create ECS task execution IAM role"
status: not_started
dependencies: [T0.3.2]

interface:
  input: "ECS module scaffold"
  output: "Task execution role with policies"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/iam.tf"
  ports:
    execution_role:
      type: boolean

acceptance_criteria:
  - "aws_iam_role with ecs-tasks.amazonaws.com trust policy"
  - "Attached: AmazonECSTaskExecutionRolePolicy (managed)"
  - "Custom policy: ECR GetAuthorizationToken, BatchGetImage"
  - "Custom policy: Secrets Manager GetSecretValue for /outpost/*"
  - "Custom policy: CloudWatch Logs CreateLogStream, PutLogEvents"

verification:
  smoke:
    command: "grep -q 'ecs-tasks.amazonaws.com' infrastructure/terraform/modules/ecs/iam.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecs/iam.tf"
```

#### T1.3.3: Create Task Role

```yaml
task_id: T1.3.3
name: "Create ECS task IAM role"
status: not_started
dependencies: [T1.3.2]

interface:
  input: "Task execution role created"
  output: "Task role for container runtime permissions"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/iam.tf"
  ports:
    task_role:
      type: boolean

acceptance_criteria:
  - "aws_iam_role with ecs-tasks.amazonaws.com trust policy"
  - "S3 PutObject for outpost-outputs bucket"
  - "S3 GetObject for presigned URL generation"
  - "EFS access for persistent workspaces"
  - "SSM Parameter Store read (for additional config)"
  - "CloudWatch Logs write"
  - "NO secrets access (secrets injected via execution role)"

verification:
  smoke:
    command: "grep -q 'task_role' infrastructure/terraform/modules/ecs/iam.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecs/iam.tf"
```

#### T1.3.4: Create Agent Task Definitions

```yaml
task_id: T1.3.4
name: "Create task definitions for all agent types"
status: not_started
dependencies: [T1.3.1, T1.3.2, T1.3.3, T1.2]

interface:
  input: "Cluster and IAM roles ready, ECR repos available"
  output: "Task definitions for 5 agents"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/task_definitions.tf"
  ports:
    task_defs:
      type: boolean

acceptance_criteria:
  - "aws_ecs_task_definition for each agent (claude, codex, gemini, aider, grok)"
  - "Fargate launch type, Linux ARM64 (cost optimized)"
  - "Default resources: 1 vCPU, 2GB memory (configurable)"
  - "Max resources: 4 vCPU, 8GB memory"
  - "Container definition with ECR image reference"
  - "Environment variables: AGENT_TYPE, MODEL_ID, TASK_ID"
  - "Secrets from Secrets Manager: API keys per agent"
  - "Log configuration: awslogs driver to CloudWatch"
  - "EFS volume mount (conditional on workspace_mode)"

verification:
  smoke:
    command: "grep -c 'aws_ecs_task_definition' infrastructure/terraform/modules/ecs/task_definitions.tf | grep -q '5'"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecs/task_definitions.tf"
```

#### T1.3.5: Configure CloudWatch Log Groups

```yaml
task_id: T1.3.5
name: "Create CloudWatch log groups for agent output"
status: not_started
dependencies: [T1.3.1]

interface:
  input: "ECS cluster created"
  output: "CloudWatch log groups for streaming"

output:
  location: file
  path: "infrastructure/terraform/modules/ecs/logs.tf"
  ports:
    logs_configured:
      type: boolean

acceptance_criteria:
  - "Log group per agent type: /outpost/agents/{agent}"
  - "Log group for dispatches: /outpost/dispatches/{dispatch_id}"
  - "Retention: 30 days (configurable)"
  - "KMS encryption for logs"
  - "Metric filters for error rate tracking"

verification:
  smoke:
    command: "grep -q 'aws_cloudwatch_log_group' infrastructure/terraform/modules/ecs/logs.tf"
    timeout: PT10S

rollback: "git checkout HEAD -- infrastructure/terraform/modules/ecs/logs.tf"
```

### T1.4: Implement EFS Module

```yaml
task_id: T1.4
name: "Implement EFS for persistent workspaces"
status: not_started
dependencies: [T0.3.4, T1.1]

input_bindings:
  efs_scaffold:
    source: T0.3.4
    output_port: efs_module
    transfer: file
    required: true
  vpc_complete:
    source: T1.1
    output_port: vpc_complete
    transfer: memory
    required: true

interface:
  input: "EFS module scaffold, VPC ready"
  output: "Complete EFS module with access points"

output:
  location: file
  path: "infrastructure/terraform/modules/efs/"
  ports:
    efs_complete:
      type: boolean

acceptance_criteria:
  - "aws_efs_file_system with encryption at rest"
  - "Performance mode: generalPurpose"
  - "Throughput mode: bursting (elastic for higher workloads)"
  - "Mount targets in each private subnet"
  - "Root access point for control plane"
  - "Security group allowing NFS from ECS tasks"

verification:
  smoke:
    command: "cd infrastructure/terraform/modules/efs && terraform validate"
    timeout: PT1M

rollback: "git checkout HEAD -- infrastructure/terraform/modules/efs/"

required_capabilities:
  - terraform
```

### T1.5: Implement Secrets Module

```yaml
task_id: T1.5
name: "Implement Secrets Manager for API keys"
status: not_started
dependencies: [T0.3.5]

input_bindings:
  secrets_scaffold:
    source: T0.3.5
    output_port: secrets_module
    transfer: file
    required: true

interface:
  input: "Secrets module scaffold"
  output: "Complete Secrets Manager configuration"

output:
  location: file
  path: "infrastructure/terraform/modules/secrets/"
  ports:
    secrets_complete:
      type: boolean

acceptance_criteria:
  - "aws_secretsmanager_secret for each LLM provider"
  - "Secret names: /outpost/api-keys/{provider}"
  - "KMS encryption with custom CMK"
  - "Resource policy restricting access to ECS execution role"
  - "Version staging labels support"

verification:
  smoke:
    command: "cd infrastructure/terraform/modules/secrets && terraform validate"
    timeout: PT1M

rollback: "git checkout HEAD -- infrastructure/terraform/modules/secrets/"

required_capabilities:
  - terraform
```

### T1.6: Create S3 Bucket for Artifacts

```yaml
task_id: T1.6
name: "Create S3 bucket for dispatch artifacts"
status: not_started
dependencies: [T0.3]

interface:
  input: "Infrastructure scaffold"
  output: "S3 bucket for output artifacts"

output:
  location: file
  path: "infrastructure/terraform/modules/s3/main.tf"
  ports:
    s3_complete:
      type: boolean

acceptance_criteria:
  - "aws_s3_bucket: outpost-artifacts-{account_id}"
  - "Server-side encryption with AWS-managed key"
  - "Versioning enabled"
  - "Lifecycle policy: transition to IA after 30 days"
  - "Lifecycle policy: expire after 90 days"
  - "Bucket policy: ECS task role put, presigned URL access"
  - "CORS configuration for presigned URL downloads"
  - "Block public access enabled"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/s3/main.tf"
    timeout: PT10S

rollback: "rm -rf infrastructure/terraform/modules/s3/"
```

### T1.7: Deploy Dev Environment

```yaml
task_id: T1.7
name: "Deploy infrastructure to dev environment"
status: not_started
dependencies: [T1.1, T1.2, T1.3, T1.4, T1.5, T1.6]

input_bindings:
  vpc_complete:
    source: T1.1
    output_port: vpc_complete
    transfer: memory
    required: true
  ecr_complete:
    source: T1.2
    output_port: ecr_complete
    transfer: memory
    required: true
  ecs_complete:
    source: T1.3
    output_port: ecs_complete
    transfer: memory
    required: true
  efs_complete:
    source: T1.4
    output_port: efs_complete
    transfer: memory
    required: true
  secrets_complete:
    source: T1.5
    output_port: secrets_complete
    transfer: memory
    required: true
  s3_complete:
    source: T1.6
    output_port: s3_complete
    transfer: memory
    required: true

interface:
  input: "All infrastructure modules complete"
  output: "Dev environment deployed"

output:
  location: file
  path: "infrastructure/terraform/environments/dev/terraform.tfstate"
  ports:
    dev_deployed:
      type: boolean

acceptance_criteria:
  - "terraform init successful"
  - "terraform plan shows expected resources"
  - "terraform apply completes without errors"
  - "VPC created with expected subnets"
  - "ECS cluster created and active"
  - "ECR repositories created"
  - "EFS filesystem created"
  - "Secrets Manager secrets created (empty values)"
  - "S3 bucket created"

verification:
  smoke:
    command: "cd infrastructure/terraform/environments/dev && terraform output -json | jq '.cluster_arn.value'"
    timeout: PT30S
  integration:
    command: "aws ecs describe-clusters --clusters outpost-dev --profile soc --query 'clusters[0].status' --output text | grep -q ACTIVE"
    timeout: PT1M

rollback: "cd infrastructure/terraform/environments/dev && terraform destroy -auto-approve"

required_capabilities:
  - terraform
  - aws_cli

resources:
  locks:
    - name: terraform_state
      mode: exclusive
  timeout: PT30M
```

---

## Tier 2: Container Images — Agent Builds

### T2.1: Create Base Container Image

```yaml
task_id: T2.1
name: "Create base container image with common tooling"
status: not_started
dependencies: [T1.2]

input_bindings:
  ecr_complete:
    source: T1.2
    output_port: ecr_complete
    transfer: memory
    required: true

interface:
  input: "ECR repositories available"
  output: "Base Docker image pushed to ECR"

output:
  location: file
  path: "containers/base/Dockerfile"
  ports:
    base_image:
      type: string
      schema:
        type: string
        pattern: "^[0-9]+\\.dkr\\.ecr\\..+\\.amazonaws\\.com/outpost-base:.+"

acceptance_criteria:
  - "Dockerfile FROM ubuntu:24.04 or debian:bookworm-slim"
  - "Installed: git, bash, curl, wget, jq, ripgrep"
  - "Installed: Node.js 20 LTS"
  - "Installed: Python 3.11 with pip, venv"
  - "Installed: Rust toolchain (for some agents)"
  - "Installed: npm, cargo, pip (package managers)"
  - "Non-root user: outpost (uid 1000)"
  - "Working directory: /workspace"
  - "Entrypoint: /entrypoint.sh (configurable)"
  - "Image size < 2GB"
  - "Vulnerability scan: no critical CVEs"

verification:
  smoke:
    command: "test -f containers/base/Dockerfile && grep -q 'FROM' containers/base/Dockerfile"
    timeout: PT10S
  unit:
    command: "docker build -t outpost-base:test containers/base/"
    timeout: PT10M
  integration:
    command: "docker run --rm outpost-base:test git --version && node --version && python3 --version"
    timeout: PT1M

rollback: "rm -rf containers/base/"

required_capabilities:
  - docker
```

#### T2.1.1: Create Base Dockerfile

```yaml
task_id: T2.1.1
name: "Write base Dockerfile with common dependencies"
status: not_started
dependencies: [T1.2]

interface:
  input: "ECR ready"
  output: "Base Dockerfile"

output:
  location: file
  path: "containers/base/Dockerfile"
  ports:
    dockerfile:
      type: file_path

acceptance_criteria:
  - "Multi-stage build for smaller final image"
  - "Stage 1: Install build dependencies"
  - "Stage 2: Copy runtime dependencies only"
  - "git, curl, wget, jq, ripgrep installed"
  - "Node.js 20 from NodeSource"
  - "Python 3.11 with pip"
  - "Non-root user configuration"
  - "Labels for metadata"

verification:
  smoke:
    command: "grep -q 'FROM' containers/base/Dockerfile"
    timeout: PT10S

rollback: "rm -f containers/base/Dockerfile"
```

#### T2.1.2: Create Entrypoint Script

```yaml
task_id: T2.1.2
name: "Create configurable entrypoint script"
status: not_started
dependencies: [T2.1.1]

interface:
  input: "Base Dockerfile"
  output: "Entrypoint script with agent dispatch logic"

output:
  location: file
  path: "containers/base/entrypoint.sh"
  ports:
    entrypoint:
      type: file_path

acceptance_criteria:
  - "Reads AGENT_TYPE, MODEL_ID, TASK environment variables"
  - "Clones repository if REPO_URL provided"
  - "Sources agent-specific initialization script"
  - "Executes agent CLI with task"
  - "Captures stdout/stderr to output files"
  - "Uploads results to S3 on completion"
  - "Exit code propagation"
  - "Signal handling for graceful shutdown"

verification:
  smoke:
    command: "test -x containers/base/entrypoint.sh || chmod +x containers/base/entrypoint.sh"
    timeout: PT10S

rollback: "rm -f containers/base/entrypoint.sh"
```

#### T2.1.3: Build and Push Base Image

```yaml
task_id: T2.1.3
name: "Build base image and push to ECR"
status: not_started
dependencies: [T2.1.1, T2.1.2, T1.7]

interface:
  input: "Dockerfile and entrypoint ready, dev environment deployed"
  output: "Image pushed to ECR"

output:
  location: stdout
  ports:
    image_uri:
      type: string

acceptance_criteria:
  - "docker build completes successfully"
  - "Image tagged with git SHA and :latest"
  - "ECR login successful"
  - "docker push completes"
  - "Image scannable and scan initiated"

verification:
  smoke:
    command: "aws ecr describe-images --repository-name outpost-base --profile soc --query 'imageDetails[0].imageTags'"
    timeout: PT30S

rollback: "aws ecr batch-delete-image --repository-name outpost-base --image-ids imageTag=latest --profile soc"

required_capabilities:
  - docker
  - aws_cli

resources:
  locks:
    - name: ecr_push
      mode: shared
```

### T2.2: Create Claude Agent Image

```yaml
task_id: T2.2
name: "Create Claude Code agent container image"
status: not_started
dependencies: [T2.1.3]

input_bindings:
  base_image:
    source: T2.1
    output_port: base_image
    transfer: memory
    required: true

interface:
  input: "Base image available"
  output: "Claude agent image pushed to ECR"

output:
  location: file
  path: "containers/claude/"
  ports:
    claude_image:
      type: string

acceptance_criteria:
  - "Extends outpost-base image"
  - "Installs Claude Code CLI via npm"
  - "Configures ANTHROPIC_API_KEY from environment"
  - "Agent-specific entrypoint wrapper"
  - "Model selection via MODEL_ID env var"
  - "Supports --print mode for headless execution"
  - "Working context injection"

verification:
  smoke:
    command: "test -f containers/claude/Dockerfile"
    timeout: PT10S
  unit:
    command: "docker build -t outpost-claude:test containers/claude/"
    timeout: PT5M

rollback: "rm -rf containers/claude/"

required_capabilities:
  - docker
```

### T2.3: Create Codex Agent Image

```yaml
task_id: T2.3
name: "Create OpenAI Codex agent container image"
status: not_started
dependencies: [T2.1.3]

input_bindings:
  base_image:
    source: T2.1
    output_port: base_image
    transfer: memory
    required: true

interface:
  input: "Base image available"
  output: "Codex agent image pushed to ECR"

output:
  location: file
  path: "containers/codex/"
  ports:
    codex_image:
      type: string

acceptance_criteria:
  - "Extends outpost-base image"
  - "Installs OpenAI Codex CLI"
  - "Configures OPENAI_API_KEY from environment"
  - "Model selection: gpt-5.2-codex, gpt-4o-codex"
  - "Supports yolo mode for autonomous execution"
  - "Sandbox configuration for code execution"

verification:
  smoke:
    command: "test -f containers/codex/Dockerfile"
    timeout: PT10S

rollback: "rm -rf containers/codex/"
```

### T2.4: Create Gemini Agent Image

```yaml
task_id: T2.4
name: "Create Google Gemini agent container image"
status: not_started
dependencies: [T2.1.3]

input_bindings:
  base_image:
    source: T2.1
    output_port: base_image
    transfer: memory
    required: true

interface:
  input: "Base image available"
  output: "Gemini agent image pushed to ECR"

output:
  location: file
  path: "containers/gemini/"
  ports:
    gemini_image:
      type: string

acceptance_criteria:
  - "Extends outpost-base image"
  - "Installs Gemini CLI via npm"
  - "Configures GOOGLE_API_KEY from environment"
  - "Model selection: gemini-3-pro-preview, gemini-3-flash"
  - "YOLO mode configuration"

verification:
  smoke:
    command: "test -f containers/gemini/Dockerfile"
    timeout: PT10S

rollback: "rm -rf containers/gemini/"
```

### T2.5: Create Aider Agent Image

```yaml
task_id: T2.5
name: "Create Aider agent container image"
status: not_started
dependencies: [T2.1.3]

input_bindings:
  base_image:
    source: T2.1
    output_port: base_image
    transfer: memory
    required: true

interface:
  input: "Base image available"
  output: "Aider agent image pushed to ECR"

output:
  location: file
  path: "containers/aider/"
  ports:
    aider_image:
      type: string

acceptance_criteria:
  - "Extends outpost-base image"
  - "Installs Aider via pip"
  - "Configures DEEPSEEK_API_KEY from environment"
  - "Model selection: deepseek/deepseek-coder, deepseek/deepseek-chat"
  - "Supports --yes-always for autonomous mode"
  - "Git configuration for commits"

verification:
  smoke:
    command: "test -f containers/aider/Dockerfile"
    timeout: PT10S

rollback: "rm -rf containers/aider/"
```

### T2.6: Create Grok Agent Image

```yaml
task_id: T2.6
name: "Create xAI Grok agent container image"
status: not_started
dependencies: [T2.1.3]

input_bindings:
  base_image:
    source: T2.1
    output_port: base_image
    transfer: memory
    required: true

interface:
  input: "Base image available"
  output: "Grok agent image pushed to ECR"

output:
  location: file
  path: "containers/grok/"
  ports:
    grok_image:
      type: string

acceptance_criteria:
  - "Extends outpost-base image"
  - "Installs grok-agent.py script"
  - "Configures XAI_API_KEY from environment"
  - "Model selection: grok-4.1, grok-4.1-fast-reasoning"
  - "API client for xAI endpoint"

verification:
  smoke:
    command: "test -f containers/grok/Dockerfile"
    timeout: PT10S

rollback: "rm -rf containers/grok/"
```

### T2.7: Create GitHub Actions Workflow for Image Builds

```yaml
task_id: T2.7
name: "Create CI/CD pipeline for container image builds"
status: not_started
dependencies: [T2.2, T2.3, T2.4, T2.5, T2.6]

interface:
  input: "All agent Dockerfiles ready"
  output: "GitHub Actions workflow for automated builds"

output:
  location: file
  path: ".github/workflows/build-containers.yml"
  ports:
    workflow_created:
      type: boolean

acceptance_criteria:
  - "Triggers on push to containers/** or manual dispatch"
  - "Matrix build for all 6 images (base + 5 agents)"
  - "AWS OIDC authentication (no long-lived credentials)"
  - "ECR login and push"
  - "Image tagging with git SHA and branch"
  - "Vulnerability scanning with Trivy"
  - "Slack notification on failure"
  - "Cache optimization with BuildKit"

verification:
  smoke:
    command: "test -f .github/workflows/build-containers.yml && grep -q 'build-and-push' .github/workflows/build-containers.yml"
    timeout: PT10S

rollback: "rm -f .github/workflows/build-containers.yml"
```

---

## Tier 3: Control Plane — Dispatcher Service

### T3.1: Design Control Plane Architecture

```yaml
task_id: T3.1
name: "Design control plane service architecture"
status: not_started
dependencies: [T0.1, T1.3]

interface:
  input: "MCP schemas, ECS cluster ready"
  output: "Architecture document and API specification"

output:
  location: file
  path: "docs/CONTROL_PLANE_ARCHITECTURE.md"
  ports:
    architecture_doc:
      type: file_path

acceptance_criteria:
  - "Component diagram: Dispatcher, Pool Manager, Status Tracker"
  - "API endpoints defined (REST + WebSocket for streaming)"
  - "State machine for dispatch lifecycle"
  - "DynamoDB tables for state persistence"
  - "Event flow: dispatch request → ECS task → completion event"
  - "Error handling and retry policies"
  - "Scaling considerations for 1000+ daily users"

verification:
  smoke:
    command: "test -f docs/CONTROL_PLANE_ARCHITECTURE.md"
    timeout: PT10S

rollback: "rm -f docs/CONTROL_PLANE_ARCHITECTURE.md"
```

### T3.2: Create Control Plane Project Structure

```yaml
task_id: T3.2
name: "Initialize control plane service project"
status: not_started
dependencies: [T3.1]

interface:
  input: "Architecture document"
  output: "Project scaffold with TypeScript/Node.js structure"

output:
  location: file
  path: "src/control-plane/"
  ports:
    project_created:
      type: boolean

acceptance_criteria:
  - "TypeScript project with strict configuration"
  - "Directory structure: api/, services/, models/, utils/"
  - "Package.json with dependencies: express, aws-sdk v3, zod"
  - "ESLint and Prettier configuration"
  - "Jest for testing"
  - "Docker configuration for deployment"

verification:
  smoke:
    command: "test -f src/control-plane/package.json && test -f src/control-plane/tsconfig.json"
    timeout: PT10S

rollback: "rm -rf src/control-plane/"

required_capabilities:
  - node20
```

### T3.3: Implement Dispatcher Service

```yaml
task_id: T3.3
name: "Implement core dispatcher service"
status: not_started
dependencies: [T3.2, T1.3, T1.5]

input_bindings:
  project_created:
    source: T3.2
    output_port: project_created
    transfer: memory
    required: true
  ecs_complete:
    source: T1.3
    output_port: ecs_complete
    transfer: memory
    required: true

interface:
  input: "Project scaffold, ECS cluster ready"
  output: "Working dispatcher service"

output:
  location: file
  path: "src/control-plane/src/services/dispatcher.ts"
  ports:
    dispatcher_ready:
      type: boolean

acceptance_criteria:
  - "dispatch() method: creates ECS Fargate task"
  - "Validates user_id, agent, task parameters"
  - "Selects task definition based on agent type"
  - "Injects secrets via Secrets Manager ARNs"
  - "Configures EFS mount for persistent workspaces"
  - "Sets resource limits based on request"
  - "Stores dispatch record in DynamoDB"
  - "Returns dispatch_id immediately"
  - "Handles ECS API errors gracefully"

verification:
  smoke:
    command: "grep -q 'class Dispatcher' src/control-plane/src/services/dispatcher.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=dispatcher"
    timeout: PT5M

rollback: "git checkout HEAD -- src/control-plane/src/services/dispatcher.ts"

required_capabilities:
  - node20
  - npm
```

#### T3.3.1: Implement Task Definition Selection

```yaml
task_id: T3.3.1
name: "Implement agent and model selection logic"
status: not_started
dependencies: [T3.2]

interface:
  input: "Project scaffold"
  output: "Task definition selector service"

output:
  location: file
  path: "src/control-plane/src/services/task-selector.ts"
  ports:
    selector_ready:
      type: boolean

acceptance_criteria:
  - "Maps agent type to task definition ARN"
  - "Validates model ID against agent registry"
  - "Falls back to flagship model if not specified"
  - "Returns resource configuration (CPU, memory) based on model tier"
  - "Handles unknown agent/model gracefully"

verification:
  smoke:
    command: "grep -q 'selectTaskDefinition' src/control-plane/src/services/task-selector.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/task-selector.ts"
```

#### T3.3.2: Implement Secret Injection

```yaml
task_id: T3.3.2
name: "Implement secure secret injection for tasks"
status: not_started
dependencies: [T3.2, T1.5]

interface:
  input: "Project scaffold, Secrets Manager ready"
  output: "Secret injection service"

output:
  location: file
  path: "src/control-plane/src/services/secret-injector.ts"
  ports:
    secrets_ready:
      type: boolean

acceptance_criteria:
  - "Builds container secrets configuration"
  - "Maps agent type to required API key secrets"
  - "Supports user-specific secrets (/outpost/users/{user_id}/)"
  - "Validates secret existence before dispatch"
  - "Never logs or exposes secret values"
  - "Returns Secrets Manager ARNs for ECS task definition"

verification:
  smoke:
    command: "grep -q 'SecretInjector' src/control-plane/src/services/secret-injector.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/secret-injector.ts"
```

#### T3.3.3: Implement ECS Task Launcher

```yaml
task_id: T3.3.3
name: "Implement ECS RunTask API integration"
status: not_started
dependencies: [T3.3.1, T3.3.2]

interface:
  input: "Task selector and secret injector ready"
  output: "ECS task launcher service"

output:
  location: file
  path: "src/control-plane/src/services/task-launcher.ts"
  ports:
    launcher_ready:
      type: boolean

acceptance_criteria:
  - "Uses AWS SDK v3 ECSClient"
  - "Constructs RunTaskCommand with all parameters"
  - "Configures network (subnets, security groups)"
  - "Sets environment variables (TASK_ID, AGENT_TYPE, MODEL_ID)"
  - "Configures logging to CloudWatch"
  - "Handles capacity errors (retry with different AZ)"
  - "Returns task ARN and started timestamp"

verification:
  smoke:
    command: "grep -q 'RunTaskCommand' src/control-plane/src/services/task-launcher.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/task-launcher.ts"
```

### T3.4: Implement Status Tracker Service

```yaml
task_id: T3.4
name: "Implement dispatch status tracking service"
status: not_started
dependencies: [T3.3]

input_bindings:
  dispatcher_ready:
    source: T3.3
    output_port: dispatcher_ready
    transfer: memory
    required: true

interface:
  input: "Dispatcher service ready"
  output: "Status tracker with streaming support"

output:
  location: file
  path: "src/control-plane/src/services/status-tracker.ts"
  ports:
    tracker_ready:
      type: boolean

acceptance_criteria:
  - "getStatus() method: returns current dispatch state"
  - "Polls ECS DescribeTasks for task status"
  - "Fetches CloudWatch logs with pagination"
  - "Calculates progress percentage (heuristic)"
  - "Supports log offset for streaming"
  - "Caches recent status for performance"
  - "Handles task not found gracefully"

verification:
  smoke:
    command: "grep -q 'StatusTracker' src/control-plane/src/services/status-tracker.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=status"
    timeout: PT5M

rollback: "git checkout HEAD -- src/control-plane/src/services/status-tracker.ts"
```

### T3.5: Implement Pool Manager Service

```yaml
task_id: T3.5
name: "Implement warm pool manager for fast cold starts"
status: not_started
dependencies: [T3.3]

input_bindings:
  dispatcher_ready:
    source: T3.3
    output_port: dispatcher_ready
    transfer: memory
    required: true

interface:
  input: "Dispatcher service ready"
  output: "Pool manager with pre-warming logic"

output:
  location: file
  path: "src/control-plane/src/services/pool-manager.ts"
  ports:
    pool_ready:
      type: boolean

acceptance_criteria:
  - "Maintains pool of idle Fargate tasks per agent type"
  - "Default pool size: 2 per agent (configurable)"
  - "acquireTask() method: claims idle task or launches new"
  - "releaseTask() method: returns task to pool or terminates"
  - "Recycles idle tasks after 15 minutes"
  - "Tracks pool metrics (size, available, wait time)"
  - "Auto-scales pool based on demand patterns"

verification:
  smoke:
    command: "grep -q 'PoolManager' src/control-plane/src/services/pool-manager.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=pool"
    timeout: PT5M

rollback: "git checkout HEAD -- src/control-plane/src/services/pool-manager.ts"
```

### T3.6: Implement DynamoDB State Persistence

```yaml
task_id: T3.6
name: "Implement DynamoDB tables for dispatch state"
status: not_started
dependencies: [T3.2]

interface:
  input: "Project scaffold"
  output: "DynamoDB repository layer"

output:
  location: file
  path: "src/control-plane/src/repositories/"
  ports:
    repositories_ready:
      type: boolean

acceptance_criteria:
  - "DispatchRepository: CRUD for dispatch records"
  - "WorkspaceRepository: user workspace management"
  - "PoolRepository: warm pool state tracking"
  - "Table schemas defined in Terraform (T1.x)"
  - "Uses DynamoDB Document Client v3"
  - "Implements optimistic locking for updates"
  - "GSI for user_id queries"

verification:
  smoke:
    command: "test -f src/control-plane/src/repositories/dispatch-repository.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=repository"
    timeout: PT5M

rollback: "rm -rf src/control-plane/src/repositories/"
```

### T3.7: Implement REST API Endpoints

```yaml
task_id: T3.7
name: "Implement REST API for control plane"
status: not_started
dependencies: [T3.3, T3.4, T3.5, T3.6]

input_bindings:
  dispatcher_ready:
    source: T3.3
    output_port: dispatcher_ready
    transfer: memory
    required: true
  tracker_ready:
    source: T3.4
    output_port: tracker_ready
    transfer: memory
    required: true
  pool_ready:
    source: T3.5
    output_port: pool_ready
    transfer: memory
    required: true
  repositories_ready:
    source: T3.6
    output_port: repositories_ready
    transfer: memory
    required: true

interface:
  input: "All services ready"
  output: "Express REST API"

output:
  location: file
  path: "src/control-plane/src/api/"
  ports:
    api_ready:
      type: boolean

acceptance_criteria:
  - "POST /dispatch - Create new dispatch"
  - "GET /dispatch/:id - Get dispatch status"
  - "DELETE /dispatch/:id - Cancel dispatch"
  - "GET /workspaces - List user workspaces"
  - "DELETE /workspaces/:id - Delete workspace"
  - "GET /artifacts/:dispatch_id - Get artifact URLs"
  - "GET /health - Fleet health status"
  - "Input validation with Zod"
  - "Error handling middleware"
  - "Request logging"
  - "API key authentication (for MCPify)"

verification:
  smoke:
    command: "grep -q '/dispatch' src/control-plane/src/api/routes.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=api"
    timeout: PT5M

rollback: "git checkout HEAD -- src/control-plane/src/api/"
```

### T3.8: Deploy Control Plane to ECS

```yaml
task_id: T3.8
name: "Deploy control plane service to ECS"
status: not_started
dependencies: [T3.7, T1.7]

input_bindings:
  api_ready:
    source: T3.7
    output_port: api_ready
    transfer: memory
    required: true
  dev_deployed:
    source: T1.7
    output_port: dev_deployed
    transfer: memory
    required: true

interface:
  input: "Control plane API ready, dev environment deployed"
  output: "Control plane running in ECS"

output:
  location: stdout
  ports:
    control_plane_url:
      type: string

acceptance_criteria:
  - "Dockerfile builds successfully"
  - "Image pushed to ECR"
  - "ECS service created with ALB"
  - "Health check passing"
  - "API accessible via ALB endpoint"
  - "CloudWatch logs streaming"
  - "Auto-scaling configured (2-10 tasks)"

verification:
  smoke:
    command: "curl -s https://outpost-dev.example.com/health | jq '.status'"
    timeout: PT30S
  integration:
    command: "aws ecs describe-services --cluster outpost-dev --services control-plane --profile soc --query 'services[0].runningCount' --output text | grep -q '[1-9]'"
    timeout: PT1M

rollback: "aws ecs update-service --cluster outpost-dev --service control-plane --desired-count 0 --profile soc"

required_capabilities:
  - docker
  - aws_cli

resources:
  locks:
    - name: ecs_deploy
      mode: exclusive
  timeout: PT20M
```

---

## Tier 4: Workspace Management

### T4.1: Implement Ephemeral Workspace Handler

```yaml
task_id: T4.1
name: "Implement ephemeral workspace creation and cleanup"
status: not_started
dependencies: [T3.3]

interface:
  input: "Dispatcher service"
  output: "Ephemeral workspace handler"

output:
  location: file
  path: "src/control-plane/src/services/workspace-handler.ts"
  ports:
    workspace_handler:
      type: boolean

acceptance_criteria:
  - "Creates tmpfs workspace in container"
  - "Clones repository if specified"
  - "Sets git user config for commits"
  - "Uploads artifacts to S3 on completion"
  - "No state persists after task termination"
  - "Cleanup on task failure (no orphaned resources)"

verification:
  smoke:
    command: "grep -q 'EphemeralWorkspace' src/control-plane/src/services/workspace-handler.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/workspace-handler.ts"
```

### T4.2: Implement Persistent Workspace Handler

```yaml
task_id: T4.2
name: "Implement EFS-backed persistent workspaces"
status: not_started
dependencies: [T4.1, T1.4]

input_bindings:
  workspace_handler:
    source: T4.1
    output_port: workspace_handler
    transfer: memory
    required: true
  efs_complete:
    source: T1.4
    output_port: efs_complete
    transfer: memory
    required: true

interface:
  input: "Workspace handler, EFS ready"
  output: "Persistent workspace support"

output:
  location: file
  path: "src/control-plane/src/services/persistent-workspace.ts"
  ports:
    persistent_ready:
      type: boolean

acceptance_criteria:
  - "Creates EFS access point per user on first use"
  - "Mounts user's EFS volume to /workspace"
  - "Preserves workspace state between sessions"
  - "Supports workspace listing for user"
  - "Supports workspace deletion"
  - "Tracks storage usage per user (for billing)"
  - "Implements workspace size limits"

verification:
  smoke:
    command: "grep -q 'PersistentWorkspace' src/control-plane/src/services/persistent-workspace.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=persistent"
    timeout: PT5M

rollback: "rm -f src/control-plane/src/services/persistent-workspace.ts"
```

### T4.3: Implement Git Integration Service

```yaml
task_id: T4.3
name: "Implement Git clone/commit/push operations"
status: not_started
dependencies: [T4.1]

interface:
  input: "Workspace handler"
  output: "Git integration service"

output:
  location: file
  path: "src/control-plane/src/services/git-service.ts"
  ports:
    git_ready:
      type: boolean

acceptance_criteria:
  - "Clones public repositories without auth"
  - "Clones private repositories with user's GitHub PAT"
  - "Configures git user.name and user.email"
  - "Supports branch checkout"
  - "Detects merge conflicts and reports to caller"
  - "Pushes changes with user auth"
  - "Handles auth failures with clear error messages"

verification:
  smoke:
    command: "grep -q 'GitService' src/control-plane/src/services/git-service.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/git-service.ts"
```

### T4.4: Implement Artifact Manager

```yaml
task_id: T4.4
name: "Implement artifact storage and retrieval"
status: not_started
dependencies: [T1.6, T3.3]

interface:
  input: "S3 bucket, Dispatcher"
  output: "Artifact manager service"

output:
  location: file
  path: "src/control-plane/src/services/artifact-manager.ts"
  ports:
    artifacts_ready:
      type: boolean

acceptance_criteria:
  - "Uploads task output to S3 (output.log, summary.json, diff.patch)"
  - "Organizes by dispatch_id: s3://bucket/dispatches/{id}/"
  - "Generates presigned URLs for download (1 hour expiry)"
  - "Lists artifacts for a dispatch"
  - "Implements artifact retention policy"
  - "Supports large file uploads with multipart"

verification:
  smoke:
    command: "grep -q 'ArtifactManager' src/control-plane/src/services/artifact-manager.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/artifact-manager.ts"
```

---

## Tier 5: MCPify & Ledger Integration

### T5.1: Update MCPify Outpost Provider

```yaml
task_id: T5.1
name: "Update MCPify with new Outpost v2 tools"
status: not_started
dependencies: [T0.1.5, T3.8]

input_bindings:
  schemas_defined:
    source: T0.1.5
    output_port: schemas_defined
    transfer: file
    required: true
  control_plane_url:
    source: T3.8
    output_port: control_plane_url
    transfer: memory
    required: true

interface:
  input: "MCP schemas, Control plane deployed"
  output: "Updated MCPify Outpost provider"

output:
  location: file
  path: "/home/richie/projects/mcpify/src/providers/outpost/"
  ports:
    mcpify_updated:
      type: boolean

acceptance_criteria:
  - "New tools: outpost_dispatch, outpost_status, outpost_cancel"
  - "New tools: outpost_list_workspaces, outpost_delete_workspace"
  - "New tools: outpost_get_artifacts, outpost_health"
  - "Calls control plane REST API instead of SSM"
  - "Model selection parameter exposed"
  - "Workspace mode parameter exposed"
  - "Backward compatibility with v1 tool names (aliases)"
  - "TypeScript types match schema definitions"

verification:
  smoke:
    command: "grep -q 'outpost_dispatch' /home/richie/projects/mcpify/src/providers/outpost/index.ts"
    timeout: PT10S
  unit:
    command: "cd /home/richie/projects/mcpify && npm test -- --testPathPattern=outpost"
    timeout: PT5M

rollback: "cd /home/richie/projects/mcpify && git checkout HEAD -- src/providers/outpost/"

required_capabilities:
  - node20
```

#### T5.1.1: Implement outpost_dispatch Tool

```yaml
task_id: T5.1.1
name: "Implement outpost_dispatch MCP tool"
status: not_started
dependencies: [T3.8]

interface:
  input: "Control plane API available"
  output: "Dispatch tool implementation"

output:
  location: file
  path: "/home/richie/projects/mcpify/src/providers/outpost/tools/dispatch.ts"
  ports:
    dispatch_tool:
      type: boolean

acceptance_criteria:
  - "Validates input against schema"
  - "Calls POST /dispatch on control plane"
  - "Returns dispatch_id immediately"
  - "Handles errors with clear messages"
  - "Supports all parameters: user_id, repo, task, agent, model, workspace_mode, timeout, secrets"

verification:
  smoke:
    command: "grep -q 'async dispatch' /home/richie/projects/mcpify/src/providers/outpost/tools/dispatch.ts"
    timeout: PT10S

rollback: "rm -f /home/richie/projects/mcpify/src/providers/outpost/tools/dispatch.ts"
```

#### T5.1.2: Implement outpost_status Tool

```yaml
task_id: T5.1.2
name: "Implement outpost_status MCP tool with streaming"
status: not_started
dependencies: [T3.8]

interface:
  input: "Control plane API available"
  output: "Status tool with log streaming"

output:
  location: file
  path: "/home/richie/projects/mcpify/src/providers/outpost/tools/status.ts"
  ports:
    status_tool:
      type: boolean

acceptance_criteria:
  - "Calls GET /dispatch/:id on control plane"
  - "Returns status, progress, logs"
  - "Supports log_offset for pagination/streaming"
  - "Handles task not found gracefully"

verification:
  smoke:
    command: "grep -q 'async getStatus' /home/richie/projects/mcpify/src/providers/outpost/tools/status.ts"
    timeout: PT10S

rollback: "rm -f /home/richie/projects/mcpify/src/providers/outpost/tools/status.ts"
```

#### T5.1.3: Implement Remaining MCP Tools

```yaml
task_id: T5.1.3
name: "Implement cancel, workspaces, artifacts, health tools"
status: not_started
dependencies: [T5.1.1, T5.1.2]

interface:
  input: "Dispatch and status tools implemented"
  output: "Complete MCP tool suite"

output:
  location: file
  path: "/home/richie/projects/mcpify/src/providers/outpost/tools/"
  ports:
    all_tools:
      type: boolean

acceptance_criteria:
  - "outpost_cancel: DELETE /dispatch/:id"
  - "outpost_list_workspaces: GET /workspaces"
  - "outpost_delete_workspace: DELETE /workspaces/:id"
  - "outpost_get_artifacts: GET /artifacts/:dispatch_id"
  - "outpost_health: GET /health"
  - "All tools properly typed and documented"

verification:
  smoke:
    command: "ls /home/richie/projects/mcpify/src/providers/outpost/tools/*.ts | wc -l | grep -q '[5-9]'"
    timeout: PT10S

rollback: "git checkout HEAD -- /home/richie/projects/mcpify/src/providers/outpost/tools/"
```

### T5.2: Implement Ledger Integration

```yaml
task_id: T5.2
name: "Implement Ledger cost event emission"
status: not_started
dependencies: [T0.2, T3.3]

input_bindings:
  cost_schema:
    source: T0.2
    output_port: cost_schema
    transfer: file
    required: true
  dispatcher_ready:
    source: T3.3
    output_port: dispatcher_ready
    transfer: memory
    required: true

interface:
  input: "Cost event schema, Dispatcher ready"
  output: "Ledger event emitter"

output:
  location: file
  path: "src/control-plane/src/integrations/ledger/"
  ports:
    ledger_ready:
      type: boolean

acceptance_criteria:
  - "Emits dispatch_complete event on task completion"
  - "Includes all required cost fields (duration, resources, tokens)"
  - "Handles success, failure, and timeout states"
  - "Sends events via Ledger API or MCPify ledger provider"
  - "Includes user_id for billing attribution"
  - "Token counts extracted from agent output"

verification:
  smoke:
    command: "grep -q 'LedgerEventEmitter' src/control-plane/src/integrations/ledger/emitter.ts"
    timeout: PT10S
  unit:
    command: "cd src/control-plane && npm test -- --testPathPattern=ledger"
    timeout: PT5M

rollback: "rm -rf src/control-plane/src/integrations/ledger/"
```

#### T5.2.1: Implement Cost Calculator

```yaml
task_id: T5.2.1
name: "Implement cost calculation from resource usage"
status: not_started
dependencies: [T0.2]

interface:
  input: "Cost schema"
  output: "Cost calculator service"

output:
  location: file
  path: "src/control-plane/src/integrations/ledger/cost-calculator.ts"
  ports:
    calculator_ready:
      type: boolean

acceptance_criteria:
  - "Calculates compute cost: duration_seconds * vcpu * rate"
  - "Calculates memory cost: duration_seconds * memory_mb * rate"
  - "Calculates LLM cost: tokens_input * input_rate + tokens_output * output_rate"
  - "Calculates storage cost: efs_size_bytes * storage_rate (persistent only)"
  - "Applies model-specific cost multipliers"
  - "Returns itemized cost breakdown"

verification:
  smoke:
    command: "grep -q 'CostCalculator' src/control-plane/src/integrations/ledger/cost-calculator.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/integrations/ledger/cost-calculator.ts"
```

#### T5.2.2: Implement Token Counter

```yaml
task_id: T5.2.2
name: "Implement token counting from agent output"
status: not_started
dependencies: [T3.4]

interface:
  input: "Status tracker"
  output: "Token counter service"

output:
  location: file
  path: "src/control-plane/src/integrations/ledger/token-counter.ts"
  ports:
    counter_ready:
      type: boolean

acceptance_criteria:
  - "Parses agent output for token usage"
  - "Claude: extracts from API response metadata"
  - "Codex: parses 'tokens used' line"
  - "Gemini: extracts from response"
  - "Aider: parses cost summary"
  - "Grok: extracts from API response"
  - "Returns tokens_input, tokens_output"

verification:
  smoke:
    command: "grep -q 'TokenCounter' src/control-plane/src/integrations/ledger/token-counter.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/integrations/ledger/token-counter.ts"
```

### T5.3: Release MCPify v2.1 with Outpost v2 Support

```yaml
task_id: T5.3
name: "Release updated MCPify package"
status: not_started
dependencies: [T5.1, T5.1.3]

input_bindings:
  mcpify_updated:
    source: T5.1
    output_port: mcpify_updated
    transfer: memory
    required: true
  all_tools:
    source: T5.1.3
    output_port: all_tools
    transfer: memory
    required: true

interface:
  input: "MCPify provider updated"
  output: "NPM package released"

output:
  location: stdout
  ports:
    npm_version:
      type: string

acceptance_criteria:
  - "All tests passing"
  - "Version bumped to 2.1.0"
  - "Changelog updated"
  - "npm publish successful"
  - "GitHub release created"
  - "Documentation updated"

verification:
  smoke:
    command: "npm view outpost-mcp-server version | grep -q '2\\.1'"
    timeout: PT30S

rollback: "npm unpublish outpost-mcp-server@2.1.0"

required_capabilities:
  - npm
```

---

## Tier 6: Security & Secrets

### T6.1: Implement Network Isolation

```yaml
task_id: T6.1
name: "Implement network isolation for multi-tenant security"
status: not_started
dependencies: [T1.1]

interface:
  input: "VPC deployed"
  output: "Enhanced network security configuration"

output:
  location: file
  path: "infrastructure/terraform/modules/vpc/isolation.tf"
  ports:
    isolation_ready:
      type: boolean

acceptance_criteria:
  - "Each dispatch runs in isolated network namespace"
  - "No inbound connections to task containers"
  - "Egress limited to: HTTPS (443), SSH (22), NFS (2049)"
  - "VPC flow logs capture all traffic for audit"
  - "Network ACLs as additional defense layer"
  - "Cannot access metadata service (169.254.169.254)"

verification:
  smoke:
    command: "grep -q 'network_acl' infrastructure/terraform/modules/vpc/isolation.tf"
    timeout: PT10S

rollback: "rm -f infrastructure/terraform/modules/vpc/isolation.tf"
```

### T6.2: Implement Secret Rotation

```yaml
task_id: T6.2
name: "Implement automatic secret rotation"
status: not_started
dependencies: [T1.5]

interface:
  input: "Secrets Manager deployed"
  output: "Secret rotation Lambda functions"

output:
  location: file
  path: "infrastructure/terraform/modules/secrets/rotation.tf"
  ports:
    rotation_ready:
      type: boolean

acceptance_criteria:
  - "Lambda function for secret rotation (optional)"
  - "Rotation schedule: 90 days (configurable)"
  - "Version staging for zero-downtime rotation"
  - "Notification on rotation success/failure"
  - "Manual rotation trigger support"

verification:
  smoke:
    command: "test -f infrastructure/terraform/modules/secrets/rotation.tf"
    timeout: PT10S

rollback: "rm -f infrastructure/terraform/modules/secrets/rotation.tf"
```

### T6.3: Implement Audit Logging

```yaml
task_id: T6.3
name: "Implement comprehensive audit logging"
status: not_started
dependencies: [T3.6]

interface:
  input: "DynamoDB repositories"
  output: "Audit log service"

output:
  location: file
  path: "src/control-plane/src/services/audit-logger.ts"
  ports:
    audit_ready:
      type: boolean

acceptance_criteria:
  - "Logs all dispatch requests with user_id, timestamp"
  - "Logs all status queries"
  - "Logs all workspace operations"
  - "Logs all secret access (but not values)"
  - "Stores in DynamoDB with TTL (1 year)"
  - "Immutable: no update/delete operations"
  - "Exports to S3 for long-term retention"

verification:
  smoke:
    command: "grep -q 'AuditLogger' src/control-plane/src/services/audit-logger.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/audit-logger.ts"
```

### T6.4: Security Scan and Penetration Test

```yaml
task_id: T6.4
name: "Conduct security scan and penetration test"
status: not_started
dependencies: [T3.8, T6.1, T6.3]

interface:
  input: "System deployed with security controls"
  output: "Security assessment report"

output:
  location: file
  path: "docs/SECURITY_ASSESSMENT.md"
  ports:
    security_verified:
      type: boolean

acceptance_criteria:
  - "Container image vulnerability scan (Trivy): no critical CVEs"
  - "Network isolation test: User A cannot access User B"
  - "Secret exposure test: secrets not logged or exposed"
  - "IAM policy review: least privilege verified"
  - "Dependency audit: no known vulnerabilities"
  - "All findings documented with remediation"

verification:
  smoke:
    command: "test -f docs/SECURITY_ASSESSMENT.md && grep -q 'PASS' docs/SECURITY_ASSESSMENT.md"
    timeout: PT10S

rollback: "rm -f docs/SECURITY_ASSESSMENT.md"

human_required:
  action: "Review and approve security assessment"
  reason: "Security sign-off required before production"
  timeout: PT72H
```

---

## Tier 7: Streaming & Monitoring

### T7.1: Implement Log Streaming

```yaml
task_id: T7.1
name: "Implement real-time log streaming via CloudWatch"
status: not_started
dependencies: [T3.4]

interface:
  input: "Status tracker"
  output: "Log streaming service"

output:
  location: file
  path: "src/control-plane/src/services/log-streamer.ts"
  ports:
    streaming_ready:
      type: boolean

acceptance_criteria:
  - "Subscribes to CloudWatch log group for dispatch"
  - "Streams logs with <2 second latency"
  - "Supports pagination for historical logs"
  - "Filters by timestamp for incremental fetches"
  - "Handles log group not found gracefully"
  - "Rate limiting to prevent CloudWatch throttling"

verification:
  smoke:
    command: "grep -q 'LogStreamer' src/control-plane/src/services/log-streamer.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/log-streamer.ts"
```

### T7.2: Implement Health Endpoint

```yaml
task_id: T7.2
name: "Implement fleet health monitoring endpoint"
status: not_started
dependencies: [T3.5, T3.6]

interface:
  input: "Pool manager, repositories"
  output: "Health endpoint with metrics"

output:
  location: file
  path: "src/control-plane/src/api/health.ts"
  ports:
    health_endpoint:
      type: boolean

acceptance_criteria:
  - "Returns overall status: healthy | degraded | unhealthy"
  - "Per-agent metrics: pool_size, active, success_rate, avg_duration"
  - "System metrics: CPU, memory utilization"
  - "Dispatches in last hour count"
  - "Response time <500ms"
  - "Caches metrics for 30 seconds"

verification:
  smoke:
    command: "grep -q 'healthCheck' src/control-plane/src/api/health.ts"
    timeout: PT10S
  integration:
    command: "curl -s localhost:3000/health | jq '.status'"
    timeout: PT30S

rollback: "rm -f src/control-plane/src/api/health.ts"
```

### T7.3: Create CloudWatch Dashboards

```yaml
task_id: T7.3
name: "Create CloudWatch dashboards for monitoring"
status: not_started
dependencies: [T1.7]

interface:
  input: "Dev environment deployed"
  output: "CloudWatch dashboard configuration"

output:
  location: file
  path: "infrastructure/terraform/modules/monitoring/dashboards.tf"
  ports:
    dashboards_ready:
      type: boolean

acceptance_criteria:
  - "Dashboard: outpost-operations"
  - "Widgets: Dispatch count, success rate, error rate"
  - "Widgets: Per-agent dispatch volume"
  - "Widgets: Average dispatch duration"
  - "Widgets: Warm pool utilization"
  - "Widgets: ECS task count, CPU, memory"
  - "Widgets: API latency percentiles"

verification:
  smoke:
    command: "grep -q 'aws_cloudwatch_dashboard' infrastructure/terraform/modules/monitoring/dashboards.tf"
    timeout: PT10S

rollback: "rm -f infrastructure/terraform/modules/monitoring/dashboards.tf"
```

### T7.4: Create CloudWatch Alarms

```yaml
task_id: T7.4
name: "Create CloudWatch alarms for critical metrics"
status: not_started
dependencies: [T7.3]

interface:
  input: "Dashboards ready"
  output: "CloudWatch alarm configuration"

output:
  location: file
  path: "infrastructure/terraform/modules/monitoring/alarms.tf"
  ports:
    alarms_ready:
      type: boolean

acceptance_criteria:
  - "Alarm: Error rate >5% (WARNING)"
  - "Alarm: Error rate >20% (CRITICAL)"
  - "Alarm: Dispatch duration >5 minutes avg (WARNING)"
  - "Alarm: Pool exhausted for >5 minutes (WARNING)"
  - "Alarm: Control plane 5xx errors (CRITICAL)"
  - "SNS topic for alarm notifications"
  - "Alarm actions: SNS notification"

verification:
  smoke:
    command: "grep -q 'aws_cloudwatch_metric_alarm' infrastructure/terraform/modules/monitoring/alarms.tf"
    timeout: PT10S

rollback: "rm -f infrastructure/terraform/modules/monitoring/alarms.tf"
```

---

## Tier 8: Warm Pool & Auto-scaling

### T8.1: Implement Pool Lifecycle Management

```yaml
task_id: T8.1
name: "Implement warm pool task lifecycle"
status: not_started
dependencies: [T3.5]

interface:
  input: "Pool manager"
  output: "Pool lifecycle service"

output:
  location: file
  path: "src/control-plane/src/services/pool-lifecycle.ts"
  ports:
    lifecycle_ready:
      type: boolean

acceptance_criteria:
  - "Pre-warms N tasks per agent on startup"
  - "Idle task TTL: 15 minutes (configurable)"
  - "Health check for idle tasks (periodic)"
  - "Terminates unhealthy tasks"
  - "Replaces terminated tasks to maintain pool size"
  - "Graceful shutdown: drains pool on service stop"

verification:
  smoke:
    command: "grep -q 'PoolLifecycle' src/control-plane/src/services/pool-lifecycle.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/pool-lifecycle.ts"
```

### T8.2: Implement Auto-scaling Logic

```yaml
task_id: T8.2
name: "Implement demand-based pool auto-scaling"
status: not_started
dependencies: [T8.1]

interface:
  input: "Pool lifecycle"
  output: "Auto-scaling service"

output:
  location: file
  path: "src/control-plane/src/services/pool-autoscaler.ts"
  ports:
    autoscaler_ready:
      type: boolean

acceptance_criteria:
  - "Monitors dispatch queue depth per agent"
  - "Scales up when queue depth > pool_size * 2"
  - "Scales down when idle > pool_size * 0.5 for 10 minutes"
  - "Min pool size: 1 per agent"
  - "Max pool size: 10 per agent (configurable)"
  - "Cooldown period: 5 minutes between scale actions"

verification:
  smoke:
    command: "grep -q 'PoolAutoscaler' src/control-plane/src/services/pool-autoscaler.ts"
    timeout: PT10S

rollback: "rm -f src/control-plane/src/services/pool-autoscaler.ts"
```

### T8.3: Performance Test Cold Start

```yaml
task_id: T8.3
name: "Performance test: validate cold start times"
status: not_started
dependencies: [T8.1, T8.2, T3.8]

interface:
  input: "Pool management and control plane deployed"
  output: "Performance test results"

output:
  location: file
  path: "docs/PERFORMANCE_TEST_RESULTS.md"
  ports:
    perf_tested:
      type: boolean

acceptance_criteria:
  - "Warm dispatch: <5 seconds (task claimed from pool)"
  - "Cold dispatch: <30 seconds (new task launched)"
  - "Test with 50 concurrent dispatches"
  - "No failed dispatches due to capacity"
  - "Document P50, P90, P99 latencies"

verification:
  smoke:
    command: "test -f docs/PERFORMANCE_TEST_RESULTS.md && grep -q 'P99' docs/PERFORMANCE_TEST_RESULTS.md"
    timeout: PT10S

rollback: "rm -f docs/PERFORMANCE_TEST_RESULTS.md"

resources:
  timeout: PT1H
```

---

## Tier 9: Testing & Validation

### T9.1: Create Integration Test Suite

```yaml
task_id: T9.1
name: "Create comprehensive integration test suite"
status: not_started
dependencies: [T3.8, T5.1]

interface:
  input: "Control plane deployed, MCPify updated"
  output: "Integration test suite"

output:
  location: file
  path: "tests/integration/"
  ports:
    tests_created:
      type: boolean

acceptance_criteria:
  - "Test: Dispatch to each agent type succeeds"
  - "Test: Model selection works for each agent"
  - "Test: Ephemeral workspace cleanup verified"
  - "Test: Persistent workspace resume works"
  - "Test: Git clone/commit/push flow"
  - "Test: Timeout enforcement"
  - "Test: Cancellation stops task"
  - "Test: Artifacts uploaded to S3"
  - "Test: Ledger events emitted"
  - "Test: Health endpoint accurate"

verification:
  smoke:
    command: "test -d tests/integration && ls tests/integration/*.test.ts | wc -l | grep -q '[5-9]'"
    timeout: PT10S

rollback: "rm -rf tests/integration/"
```

### T9.2: Create Load Test Suite

```yaml
task_id: T9.2
name: "Create load test suite for 1000+ daily users"
status: not_started
dependencies: [T9.1]

interface:
  input: "Integration tests passing"
  output: "Load test configuration and results"

output:
  location: file
  path: "tests/load/"
  ports:
    load_tests:
      type: boolean

acceptance_criteria:
  - "Simulate 100 concurrent users"
  - "Dispatch patterns matching expected usage"
  - "Run for 30 minutes sustained load"
  - "No errors under normal load"
  - "Document breaking point (max concurrent)"
  - "Resource utilization under load documented"

verification:
  smoke:
    command: "test -d tests/load"
    timeout: PT10S

rollback: "rm -rf tests/load/"
```

### T9.3: Run Full Validation Suite

```yaml
task_id: T9.3
name: "Execute full validation suite"
status: not_started
dependencies: [T9.1, T9.2, T8.3, T6.4]

interface:
  input: "All tests created, security verified, performance tested"
  output: "Validation report"

output:
  location: file
  path: "docs/VALIDATION_REPORT.md"
  ports:
    validated:
      type: boolean

acceptance_criteria:
  - "All integration tests passing"
  - "Load tests meet targets"
  - "Security assessment complete"
  - "Performance targets met"
  - "No critical or high severity issues"
  - "Sign-off from stakeholders"

verification:
  smoke:
    command: "test -f docs/VALIDATION_REPORT.md && grep -q 'APPROVED' docs/VALIDATION_REPORT.md"
    timeout: PT10S

rollback: "rm -f docs/VALIDATION_REPORT.md"

human_required:
  action: "Review and approve validation report"
  reason: "Final sign-off before production deployment"
  timeout: PT72H
```

---

## Tier 10: Migration & Cutover

### T10.1: Create Migration Plan

```yaml
task_id: T10.1
name: "Create detailed migration plan from v1 to v2"
status: not_started
dependencies: [T9.3]

interface:
  input: "Validation complete"
  output: "Migration plan document"

output:
  location: file
  path: "docs/MIGRATION_PLAN.md"
  ports:
    plan_ready:
      type: boolean

acceptance_criteria:
  - "Step-by-step cutover procedure"
  - "Rollback procedure documented"
  - "Communication plan (internal users)"
  - "Monitoring checklist during migration"
  - "Success criteria for cutover"
  - "Timeline with milestones"

verification:
  smoke:
    command: "test -f docs/MIGRATION_PLAN.md && grep -q 'Rollback' docs/MIGRATION_PLAN.md"
    timeout: PT10S

rollback: "rm -f docs/MIGRATION_PLAN.md"
```

### T10.2: Deploy to Production

```yaml
task_id: T10.2
name: "Deploy Outpost v2 to production environment"
status: not_started
dependencies: [T10.1]

interface:
  input: "Migration plan approved"
  output: "Production environment deployed"

output:
  location: file
  path: "infrastructure/terraform/environments/prod/"
  ports:
    prod_deployed:
      type: boolean

acceptance_criteria:
  - "Terraform apply to prod environment"
  - "All resources created successfully"
  - "Control plane healthy"
  - "Warm pool populated"
  - "Health endpoint responding"
  - "MCPify v2.1 configured for prod"

verification:
  smoke:
    command: "aws ecs describe-clusters --clusters outpost-prod --profile soc --query 'clusters[0].status' --output text | grep -q ACTIVE"
    timeout: PT1M

rollback: "Execute rollback procedure from MIGRATION_PLAN.md"

resources:
  locks:
    - name: terraform_state
      mode: exclusive
    - name: ecs_deploy
      mode: exclusive
  timeout: PT1H

human_required:
  action: "Approve production deployment"
  reason: "Production change requires approval"
  timeout: PT24H
```

### T10.3: Deprecate Legacy SSM Dispatch

```yaml
task_id: T10.3
name: "Deprecate legacy SSM-based dispatch"
status: not_started
dependencies: [T10.2]

interface:
  input: "Production deployed and stable"
  output: "Legacy system deprecated"

output:
  location: file
  path: "docs/DEPRECATION_NOTICE.md"
  ports:
    deprecated:
      type: boolean

acceptance_criteria:
  - "SSM dispatch scripts marked deprecated"
  - "Warning logged on SSM dispatch attempts"
  - "Documentation updated to point to v2"
  - "Monitoring for SSM usage (should be zero)"
  - "Plan for SSM removal after 30 days"

verification:
  smoke:
    command: "test -f docs/DEPRECATION_NOTICE.md"
    timeout: PT10S

rollback: "Remove deprecation warnings, restore SSM as primary"
```

### T10.4: Close v2 Migration

```yaml
task_id: T10.4
name: "Complete migration and update documentation"
status: not_started
dependencies: [T10.3]

interface:
  input: "Legacy deprecated, v2 stable"
  output: "Migration complete"

output:
  location: file
  path: "README.md"
  ports:
    migration_complete:
      type: boolean

acceptance_criteria:
  - "README.md updated for v2 architecture"
  - "OUTPOST_INTERFACE.md updated for MCP-only access"
  - "OUTPOST_SOUL.md updated with v2 configuration"
  - "Session journal documenting migration"
  - "PROFILE.md fleet status updated"
  - "Blueprint marked complete"

verification:
  smoke:
    command: "grep -q 'v2' README.md && grep -q 'ECS' README.md"
    timeout: PT10S

rollback: "git checkout HEAD -- README.md OUTPOST_INTERFACE.md"
```

---

## Dependency Graph

```yaml
dependency_graph:
  # Tier 0: Foundation
  T0.1:
    depends_on: []
  T0.1.1:
    depends_on: []
  T0.1.2:
    depends_on: []
  T0.1.3:
    depends_on: []
  T0.1.4:
    depends_on: []
  T0.1.5:
    depends_on: [T0.1.1, T0.1.2, T0.1.3, T0.1.4]
  T0.2:
    depends_on: []
  T0.3:
    depends_on: []
  T0.3.1:
    depends_on: [T0.3]
  T0.3.2:
    depends_on: [T0.3]
  T0.3.3:
    depends_on: [T0.3]
  T0.3.4:
    depends_on: [T0.3]
  T0.3.5:
    depends_on: [T0.3]

  # Tier 1: Infrastructure
  T1.1:
    depends_on: [T0.3.1]
  T1.1.1:
    depends_on: [T0.3.1]
  T1.1.2:
    depends_on: [T1.1.1]
  T1.1.3:
    depends_on: [T1.1.1]
  T1.1.4:
    depends_on: [T1.1.2]
  T1.1.5:
    depends_on: [T1.1.1]
  T1.2:
    depends_on: [T0.3.3]
  T1.2.1:
    depends_on: [T0.3.3]
  T1.2.2:
    depends_on: [T1.2.1]
  T1.3:
    depends_on: [T0.3.2, T1.1, T1.2]
  T1.3.1:
    depends_on: [T0.3.2]
  T1.3.2:
    depends_on: [T0.3.2]
  T1.3.3:
    depends_on: [T1.3.2]
  T1.3.4:
    depends_on: [T1.3.1, T1.3.2, T1.3.3, T1.2]
  T1.3.5:
    depends_on: [T1.3.1]
  T1.4:
    depends_on: [T0.3.4, T1.1]
  T1.5:
    depends_on: [T0.3.5]
  T1.6:
    depends_on: [T0.3]
  T1.7:
    depends_on: [T1.1, T1.2, T1.3, T1.4, T1.5, T1.6]

  # Tier 2: Container Images
  T2.1:
    depends_on: [T1.2]
  T2.1.1:
    depends_on: [T1.2]
  T2.1.2:
    depends_on: [T2.1.1]
  T2.1.3:
    depends_on: [T2.1.1, T2.1.2, T1.7]
  T2.2:
    depends_on: [T2.1.3]
  T2.3:
    depends_on: [T2.1.3]
  T2.4:
    depends_on: [T2.1.3]
  T2.5:
    depends_on: [T2.1.3]
  T2.6:
    depends_on: [T2.1.3]
  T2.7:
    depends_on: [T2.2, T2.3, T2.4, T2.5, T2.6]

  # Tier 3: Control Plane
  T3.1:
    depends_on: [T0.1, T1.3]
  T3.2:
    depends_on: [T3.1]
  T3.3:
    depends_on: [T3.2, T1.3, T1.5]
  T3.3.1:
    depends_on: [T3.2]
  T3.3.2:
    depends_on: [T3.2, T1.5]
  T3.3.3:
    depends_on: [T3.3.1, T3.3.2]
  T3.4:
    depends_on: [T3.3]
  T3.5:
    depends_on: [T3.3]
  T3.6:
    depends_on: [T3.2]
  T3.7:
    depends_on: [T3.3, T3.4, T3.5, T3.6]
  T3.8:
    depends_on: [T3.7, T1.7]

  # Tier 4: Workspace
  T4.1:
    depends_on: [T3.3]
  T4.2:
    depends_on: [T4.1, T1.4]
  T4.3:
    depends_on: [T4.1]
  T4.4:
    depends_on: [T1.6, T3.3]

  # Tier 5: Integrations
  T5.1:
    depends_on: [T0.1.5, T3.8]
  T5.1.1:
    depends_on: [T3.8]
  T5.1.2:
    depends_on: [T3.8]
  T5.1.3:
    depends_on: [T5.1.1, T5.1.2]
  T5.2:
    depends_on: [T0.2, T3.3]
  T5.2.1:
    depends_on: [T0.2]
  T5.2.2:
    depends_on: [T3.4]
  T5.3:
    depends_on: [T5.1, T5.1.3]

  # Tier 6: Security
  T6.1:
    depends_on: [T1.1]
  T6.2:
    depends_on: [T1.5]
  T6.3:
    depends_on: [T3.6]
  T6.4:
    depends_on: [T3.8, T6.1, T6.3]

  # Tier 7: Monitoring
  T7.1:
    depends_on: [T3.4]
  T7.2:
    depends_on: [T3.5, T3.6]
  T7.3:
    depends_on: [T1.7]
  T7.4:
    depends_on: [T7.3]

  # Tier 8: Performance
  T8.1:
    depends_on: [T3.5]
  T8.2:
    depends_on: [T8.1]
  T8.3:
    depends_on: [T8.1, T8.2, T3.8]

  # Tier 9: Testing
  T9.1:
    depends_on: [T3.8, T5.1]
  T9.2:
    depends_on: [T9.1]
  T9.3:
    depends_on: [T9.1, T9.2, T8.3, T6.4]

  # Tier 10: Migration
  T10.1:
    depends_on: [T9.3]
  T10.2:
    depends_on: [T10.1]
  T10.3:
    depends_on: [T10.2]
  T10.4:
    depends_on: [T10.3]
```

## Visual Dependency Flow

```
T0.x (Foundation)
  │
  ├──► T1.x (Infrastructure) ──► T1.7 (Deploy Dev)
  │                                    │
  │                                    ▼
  │                              T2.x (Images) ──► T2.7 (CI/CD)
  │                                    │
  │                                    ▼
  │                              T3.x (Control Plane) ──► T3.8 (Deploy)
  │                                    │
  ├──► T4.x (Workspace) ◄──────────────┤
  │                                    │
  ├──► T5.x (Integrations) ◄───────────┤
  │         │                          │
  │         └──► T5.3 (MCPify Release) │
  │                                    │
  ├──► T6.x (Security) ◄───────────────┤
  │         │                          │
  │         └──► T6.4 (Pen Test)       │
  │                    │               │
  ├──► T7.x (Monitoring) ◄─────────────┤
  │                                    │
  ├──► T8.x (Performance) ◄────────────┤
  │         │                          │
  │         └──► T8.3 (Perf Test)      │
  │                    │               │
  └──► T9.x (Testing) ◄────────────────┘
            │
            ▼
      T9.3 (Validation)
            │
            ▼
      T10.x (Migration)
            │
            ▼
      T10.4 (Complete)
```

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-12 | claude-opus-4.5 | Initial Blueprint specification (depth-5) |

---

*Blueprint: OUTPOST_V2_COMMANDER_PLATFORM*
*"Multi-tenant container orchestration for AI-powered product building"*
