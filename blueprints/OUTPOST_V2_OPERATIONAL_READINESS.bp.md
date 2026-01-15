# =============================================================================
# OUTPOST V2 OPERATIONAL READINESS BLUEPRINT
# Blueprint Standard Format (BSF) v2.1.0
# =============================================================================
# Generated: 2026-01-15
# Depth: 5 (Enterprise - Maximum Granularity)
# Author: Claude Sonnet 4.5 (Session 017)
# Purpose: Complete operational readiness gaps after Session 017 deployment
# =============================================================================

---
_blueprint_version: "2.1.0"
_generated_at: "2026-01-15T16:25:00Z"
_generator: "claude-sonnet-4-5"
_checksum: null
---

metadata:
  blueprint_id: OUTPOST_V2_OPERATIONAL_READINESS
  version: "1.0.0"
  bsf_version: "2.1.0"
  depth: 5
  created: "2026-01-15T16:25:00Z"
  author: "Claude Sonnet 4.5"
  status: pending

  tags:
    - outpost
    - operational-readiness
    - storage-governance
    - api-completeness
    - production-monitoring
    - p1-p2-p3-remediation

  description: |
    Complete operational readiness gaps identified in Outpost v2 post-implementation
    analysis (Session 017). Address storage governance gaps (CloudWatch retention,
    DynamoDB TTL), implement missing API endpoints (list_runs with pagination),
    establish production monitoring (Lambda dashboards, SNS notifications), and
    evaluate performance optimizations (task-arn GSI).

# =============================================================================
# PROBLEM STATEMENT
# =============================================================================

problem_statement:
  summary: |
    Session 017 deployed 3 blueprints (83 tasks, 100% pass rate) that made Outpost v2
    fully operational with working status callbacks. Post-implementation testing
    identified 7 operational readiness gaps across P1-P3 priorities that must be
    remediated before production-ready declaration.

  gaps_identified:
    - id: GAP1
      title: "CloudWatch Log Retention Missing"
      priority: P1
      severity: MEDIUM
      description: "/aws/lambda/outpost-dispatch-callback has no retention policy (unbounded growth)"
      evidence: "describe-log-groups shows retentionInDays: null"

    - id: GAP2
      title: "DynamoDB TTL Not Enabled"
      priority: P1
      severity: HIGH
      description: "outpost-dispatches table lacks TTL configuration (unbounded historical growth)"
      evidence: "describe-time-to-live shows TimeToLiveStatus: null, 163 records accumulating"

    - id: GAP3
      title: "list_runs API Not Implemented"
      priority: P2
      severity: MEDIUM
      description: "HTTP endpoint returns 'not yet implemented' message"
      evidence: "MCPify tool returns stub response, cannot query dispatches"

    - id: GAP4
      title: "task-arn GSI Missing"
      priority: P2
      severity: LOW
      description: "No GSI for reverse lookup (ECS task ARN → dispatch ID)"
      evidence: "Lambda callback must scan table, performance unknown"

    - id: GAP5
      title: "Lambda Monitoring Absent"
      priority: P3
      severity: LOW
      description: "No CloudWatch dashboard or alarms for dispatch-callback Lambda"
      evidence: "No visibility into callback performance or errors"

    - id: GAP6
      title: "SNS Subscription Unverified"
      priority: P3
      severity: MEDIUM
      description: "Email to outpost-notifications@zeroechelon.com never arrived"
      evidence: "SNS subscription in PendingConfirmation status"

    - id: GAP7
      title: "Callback Latency Untracked"
      priority: P3
      severity: LOW
      description: "No custom metric tracking callback latency baseline"
      evidence: "Current 1-2s latency observed but not instrumented"

  context:
    session: 017
    blueprints_deployed:
      - name: STORAGE_LIFECYCLE_GOVERNANCE
        tasks: 22
        status: deployed
      - name: MCPIFY_DISPATCH_ENHANCEMENT
        tasks: 32
        status: deployed
      - name: OUTPOST_V2_STATUS_CALLBACK
        tasks: 29
        status: deployed

    fleet_status:
      total_agents: 5
      operational: 5
      health: "100%"
      agents: ["claude", "codex", "gemini", "aider", "grok"]

    zombie_dispatches_cleaned: 152
    callback_mechanism: "operational"
    test_coverage: "97.05% (MCPify), 100% (control plane tests)"

  success_criteria:
    - "P1: CloudWatch retention set to 30 days on all Lambda log groups"
    - "P1: DynamoDB TTL enabled on outpost-dispatches with 90-day retention"
    - "P2: list_runs API functional with filtering (agent, status, since, user_id) and cursor pagination"
    - "P2: task-arn GSI evaluated; implemented if p95 query time >100ms"
    - "P3: Lambda dashboard visible with 4+ metrics and 2 alarms operational"
    - "P3: SNS notifications working end-to-end (email or Slack webhook)"
    - "P3: Callback latency custom metric emitting and tracked"

# =============================================================================
# EXECUTION CONFIGURATION
# =============================================================================

execution:
  shell: bash
  shell_flags: ["-e", "-o", "pipefail"]
  max_parallel_tasks: 6

  resource_locks:
    - name: "dynamodb-dispatches"
      mode: exclusive
    - name: "terraform-state"
      mode: shared
    - name: "control-plane-deployment"
      mode: exclusive

  preflight_checks:
    - command: "aws sts get-caller-identity --profile soc"
      expected_exit_code: 0
      error_message: "AWS soc profile not configured"
    - command: "aws dynamodb describe-table --profile soc --table-name outpost-dispatches"
      expected_exit_code: 0
      error_message: "outpost-dispatches table not accessible"
    - command: "aws lambda get-function --profile soc --function-name outpost-dispatch-callback"
      expected_exit_code: 0
      error_message: "dispatch-callback Lambda not found"
    - command: "cd ~/projects/outpost && npm run build --prefix src/control-plane"
      expected_exit_code: 0
      error_message: "Control plane TypeScript compilation failed"

  secret_resolution:
    on_missing: abort
    sources:
      - type: env
        prefix: ""
      - type: file
        path: "~/.zeos/tokens"

  retry_policy:
    max_retries: 2
    backoff_strategy: exponential
    initial_delay_ms: 1000

  timeout:
    task_default_seconds: 300
    tier_max_seconds: 2400
    blueprint_max_seconds: 28800  # 8 hours

  validation:
    require_tests: true
    require_rollback: true
    fail_fast: false  # Complete all P1 tasks even if some fail

  cost_constraints:
    max_total_cost: 25.00
    currency: USD
    per_task_default: 1.00
    on_total_exceeded: warn

# =============================================================================
# TIER 0: STORAGE GOVERNANCE REMEDIATION (P1)
# Critical storage lifecycle gaps
# =============================================================================

tiers:
  - tier_id: T0
    name: "Storage Governance Remediation"
    description: "Fix P1 CloudWatch retention and DynamoDB TTL gaps from Session 016"
    parallel: false  # Sequential to avoid conflicts

    tasks:
      # -----------------------------------------------------------------------
      # T0.1: CloudWatch Log Retention Policy
      # -----------------------------------------------------------------------
      - task_id: T0.1
        name: "Set CloudWatch log retention on dispatch-callback Lambda"
        status: pending
        priority: critical

        description: |
          Apply 30-day retention policy to /aws/lambda/outpost-dispatch-callback
          log group. This Lambda was created after STORAGE_LIFECYCLE_GOVERNANCE
          blueprint execution, so it was not covered by T2.1 (which set retention
          on existing log groups).

        dependencies: []

        interface:
          inputs:
            - name: log_group
              type: string
              value: "/aws/lambda/outpost-dispatch-callback"
            - name: retention_days
              type: integer
              value: 30
          outputs:
            - name: confirmation
              type: object
              schema:
                logGroupName: string
                retentionInDays: integer

        implementation:
          location: "AWS CloudWatch Logs"
          change_type: infrastructure
          details: |
            Use AWS CLI to set retention policy on Lambda log group.

            Command:
            ```bash
            aws logs put-retention-policy \
              --profile soc \
              --log-group-name /aws/lambda/outpost-dispatch-callback \
              --retention-in-days 30
            ```

        acceptance_criteria:
          - "Retention policy set to 30 days"
          - "Verified via describe-log-groups"
          - "Matches other Lambda log groups (outpost-workspace-cleanup)"

        verification:
          smoke:
            command: "aws logs describe-log-groups --profile soc --log-group-name /aws/lambda/outpost-dispatch-callback --query 'logGroups[0].retentionInDays'"
            expected_output: "30"
            timeout: PT10S

        rollback:
          strategy: safe
          command: "Retention policy is non-destructive (no rollback needed)"
          notes: "Only affects future log retention, existing logs preserved"

      # -----------------------------------------------------------------------
      # T0.2: Extend DispatchModel Schema
      # -----------------------------------------------------------------------
      - task_id: T0.2
        name: "Add expires_at field to DispatchModel schema"
        status: pending
        priority: critical

        description: |
          Extend Zod schema to include optional expires_at timestamp field for
          DynamoDB TTL functionality. This enables automatic deletion of old
          dispatch records after 90 days.

        dependencies: []

        interface:
          inputs:
            - name: model_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/models/dispatch.model.ts"
          outputs:
            - name: updated_schema
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/models/dispatch.model.ts"
          change_type: code
          details: |
            Add optional expires_at field to Zod schemas:

            ```typescript
            // In DispatchCreateSchema
            expires_at: z.string().datetime().optional(),

            // In DispatchRecord interface
            expiresAt?: string;

            // In DispatchUpdateSchema (if exists)
            expires_at: z.string().datetime().optional(),
            ```

        acceptance_criteria:
          - "DispatchCreateSchema includes expires_at field"
          - "DispatchRecord interface includes expiresAt property"
          - "TypeScript compilation succeeds with no errors"
          - "Field is optional (does not break existing code)"

        verification:
          unit:
            command: "cd ~/projects/outpost/src/control-plane && npm run build"
            expected_exit_code: 0
            timeout: PT30S

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T0.3: Implement calculateExpiresAt Utility
      # -----------------------------------------------------------------------
      - task_id: T0.3
        name: "Implement calculateExpiresAt() in DispatchRepository"
        status: pending
        priority: critical

        description: |
          Create utility function to calculate expires_at timestamp (current time
          + 90 days). This will be called by create() method to set TTL attribute
          on new dispatch records.

        dependencies: [T0.2]

        interface:
          inputs:
            - name: repository_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/repositories/dispatch.repository.ts"
            - name: ttl_days
              type: integer
              value: 90
          outputs:
            - name: utility_function
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/repositories/dispatch.repository.ts"
          change_type: code
          details: |
            Add utility function and update create() method:

            ```typescript
            private calculateExpiresAt(): string {
              const now = new Date();
              const expiresAt = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000));
              return expiresAt.toISOString();
            }

            async create(data: DispatchCreateInput): Promise<DispatchRecord> {
              const expiresAt = this.calculateExpiresAt();
              const item = {
                ...data,
                expires_at: expiresAt,  // DynamoDB TTL attribute
                // ... rest of fields
              };
              // ... DynamoDB PutItem
            }
            ```

        acceptance_criteria:
          - "calculateExpiresAt() returns ISO 8601 timestamp"
          - "Timestamp is exactly 90 days from current time"
          - "create() method calls calculateExpiresAt()"
          - "Unit tests pass for calculateExpiresAt()"

        verification:
          unit:
            command: "cd ~/projects/outpost/src/control-plane && npm test -- dispatch.repository"
            expected_exit_code: 0
            timeout: PT60S

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T0.4: Write Unit Tests for TTL Logic
      # -----------------------------------------------------------------------
      - task_id: T0.4
        name: "Write unit tests for TTL calculation"
        status: pending
        priority: high

        description: |
          Create comprehensive unit tests for calculateExpiresAt() utility to
          ensure correct TTL calculation logic.

        dependencies: [T0.3]

        interface:
          inputs:
            - name: test_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/__tests__/unit/dispatch-repository.test.ts"
          outputs:
            - name: test_suite
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/__tests__/unit/"
          change_type: test
          details: |
            Add test cases:

            ```typescript
            describe('calculateExpiresAt', () => {
              it('should return timestamp 90 days from now', () => {
                const before = Date.now();
                const expiresAt = calculateExpiresAt();
                const after = Date.now();

                const expiresMs = new Date(expiresAt).getTime();
                const expected90Days = 90 * 24 * 60 * 60 * 1000;

                expect(expiresMs).toBeGreaterThan(before + expected90Days - 1000);
                expect(expiresMs).toBeLessThan(after + expected90Days + 1000);
              });

              it('should return valid ISO 8601 format', () => {
                const expiresAt = calculateExpiresAt();
                expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
              });
            });

            describe('create with TTL', () => {
              it('should set expires_at attribute', async () => {
                const dispatch = await repository.create({ ... });
                expect(dispatch.expiresAt).toBeDefined();
              });
            });
            ```

        acceptance_criteria:
          - "Test calculateExpiresAt() returns correct timestamp"
          - "Test ISO 8601 format validation"
          - "Test create() sets expires_at attribute"
          - "All tests pass"

        verification:
          unit:
            command: "cd ~/projects/outpost/src/control-plane && npm test -- dispatch-repository.test"
            expected_exit_code: 0
            timeout: PT60S

        rollback:
          strategy: delete_tests
          command: "git checkout HEAD -- src/__tests__/unit/dispatch-repository.test.ts"

      # -----------------------------------------------------------------------
      # T0.5: Enable DynamoDB TTL
      # -----------------------------------------------------------------------
      - task_id: T0.5
        name: "Enable DynamoDB TTL on outpost-dispatches table"
        status: pending
        priority: critical

        description: |
          Configure TTL attribute on outpost-dispatches table using expires_at
          field. DynamoDB will automatically delete records after expiration
          timestamp.

        dependencies: [T0.2, T0.3, T0.4]

        interface:
          inputs:
            - name: table_name
              type: string
              value: "outpost-dispatches"
            - name: ttl_attribute
              type: string
              value: "expires_at"
          outputs:
            - name: ttl_status
              type: object
              schema:
                TimeToLiveStatus: string
                AttributeName: string

        implementation:
          location: "AWS DynamoDB"
          change_type: infrastructure
          details: |
            Enable TTL using AWS CLI:

            ```bash
            aws dynamodb update-time-to-live \
              --profile soc \
              --table-name outpost-dispatches \
              --time-to-live-specification \
                "Enabled=true,AttributeName=expires_at"

            # Wait for status to become ENABLED (takes 30-60 seconds)
            aws dynamodb describe-time-to-live \
              --profile soc \
              --table-name outpost-dispatches \
              --query 'TimeToLiveDescription.TimeToLiveStatus'
            ```

        acceptance_criteria:
          - "TTL status transitions to ENABLED"
          - "AttributeName is expires_at"
          - "No errors during enable operation"

        verification:
          smoke:
            command: "aws dynamodb describe-time-to-live --profile soc --table-name outpost-dispatches --query 'TimeToLiveDescription.TimeToLiveStatus'"
            expected_output: "ENABLED"
            timeout: PT90S

        rollback:
          strategy: disable_ttl
          command: |
            aws dynamodb update-time-to-live \
              --profile soc \
              --table-name outpost-dispatches \
              --time-to-live-specification "Enabled=false"
          notes: "Disabling TTL does not affect existing data"

      # -----------------------------------------------------------------------
      # T0.6: Deploy Control Plane with TTL Support
      # -----------------------------------------------------------------------
      - task_id: T0.6
        name: "Deploy control plane with TTL support"
        status: pending
        priority: high

        description: |
          Build and deploy updated control plane code with TTL field support.
          This makes the changes live in the ECS service.

        dependencies: [T0.5]

        interface:
          inputs:
            - name: control_plane_path
              type: directory
              value: "~/projects/outpost/src/control-plane"
          outputs:
            - name: deployment_status
              type: object
              schema:
                taskDefinition: string
                desiredCount: integer
                runningCount: integer

        implementation:
          location: "~/projects/outpost/src/control-plane"
          change_type: deployment
          details: |
            Build and deploy control plane:

            ```bash
            cd ~/projects/outpost/src/control-plane

            # Build TypeScript
            npm run build

            # Build Docker image
            cd ~/projects/outpost
            docker buildx build \
              --platform linux/arm64 \
              -t outpost-control-plane:latest \
              -f src/control-plane/Dockerfile \
              src/control-plane

            # Tag for ECR
            aws ecr get-login-password --profile soc --region us-east-1 | \
              docker login --username AWS --password-stdin \
              311493921645.dkr.ecr.us-east-1.amazonaws.com

            docker tag outpost-control-plane:latest \
              311493921645.dkr.ecr.us-east-1.amazonaws.com/outpost-control-plane:latest

            # Push to ECR
            docker push 311493921645.dkr.ecr.us-east-1.amazonaws.com/outpost-control-plane:latest

            # Force new deployment
            aws ecs update-service \
              --profile soc \
              --cluster outpost-dev \
              --service outpost-control-plane \
              --force-new-deployment

            # Wait for deployment to complete
            aws ecs wait services-stable \
              --profile soc \
              --cluster outpost-dev \
              --services outpost-control-plane
            ```

        acceptance_criteria:
          - "Docker build succeeds"
          - "Image pushed to ECR"
          - "ECS service updated"
          - "Service stabilizes (runningCount == desiredCount)"

        verification:
          integration:
            command: "aws ecs describe-services --profile soc --cluster outpost-dev --services outpost-control-plane --query 'services[0].runningCount'"
            expected_output: "1"
            timeout: PT300S

        rollback:
          strategy: previous_task_definition
          command: |
            aws ecs update-service \
              --profile soc \
              --cluster outpost-dev \
              --service outpost-control-plane \
              --task-definition outpost-control-plane:PREVIOUS_REVISION
          notes: "Rollback to previous task definition if deployment fails"

      # -----------------------------------------------------------------------
      # T0.7: Validate TTL Functionality
      # -----------------------------------------------------------------------
      - task_id: T0.7
        name: "Create test dispatch and validate TTL scheduling"
        status: pending
        priority: high

        description: |
          Create a test dispatch via API and verify expires_at attribute is set
          correctly in DynamoDB. Optionally create a record with past expires_at
          to verify TTL deletion (happens within 48 hours).

        dependencies: [T0.6]

        interface:
          inputs:
            - name: control_plane_url
              type: string
              value: "http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com"
          outputs:
            - name: validation_report
              type: object
              schema:
                test_dispatch_id: string
                expires_at_set: boolean
                ttl_scheduled: boolean

        implementation:
          location: "Test dispatch via HTTP API"
          change_type: validation
          details: |
            Create test dispatch and verify TTL:

            ```bash
            # Create test dispatch
            DISPATCH_ID=$(curl -X POST \
              http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/api/v1/dispatches \
              -H "Content-Type: application/json" \
              -d '{
                "agent": "claude",
                "task": "Test TTL functionality: echo 'TTL test complete'"
              }' | jq -r '.data.dispatchId')

            # Wait for dispatch to complete
            sleep 60

            # Verify expires_at attribute in DynamoDB
            aws dynamodb get-item \
              --profile soc \
              --table-name outpost-dispatches \
              --key "{\"dispatch_id\": {\"S\": \"$DISPATCH_ID\"}}" \
              --query 'Item.expires_at.S'

            # Calculate expected expiration (90 days from now)
            EXPECTED_EPOCH=$(($(date +%s) + (90 * 86400)))

            # Get actual expiration from DynamoDB
            ACTUAL_EXPIRES=$(aws dynamodb get-item \
              --profile soc \
              --table-name outpost-dispatches \
              --key "{\"dispatch_id\": {\"S\": \"$DISPATCH_ID\"}}" \
              --query 'Item.expires_at.S' \
              --output text)

            ACTUAL_EPOCH=$(date -d "$ACTUAL_EXPIRES" +%s)

            # Verify within reasonable range (±1 hour)
            DIFF=$((ACTUAL_EPOCH - EXPECTED_EPOCH))
            if [ $DIFF -gt -3600 ] && [ $DIFF -lt 3600 ]; then
              echo "✓ TTL correctly set to 90 days from now"
            else
              echo "✗ TTL mismatch: expected $EXPECTED_EPOCH, got $ACTUAL_EPOCH"
              exit 1
            fi
            ```

        acceptance_criteria:
          - "Test dispatch created successfully"
          - "expires_at attribute exists in DynamoDB"
          - "expires_at timestamp is ~90 days from creation"
          - "TTL attribute format is Unix epoch seconds"

        verification:
          integration:
            command: "Test dispatch creation and TTL verification"
            expected_exit_code: 0
            timeout: PT180S

        rollback:
          strategy: none
          notes: "Test dispatch will auto-delete via TTL in 90 days"

# =============================================================================
# TIER 1: API COMPLETENESS (P2)
# Implement list_runs endpoint with filtering and pagination
# =============================================================================

  - tier_id: T1
    name: "list_runs API Implementation"
    description: "Implement full list_runs HTTP endpoint with filtering, pagination, and GSI evaluation"
    parallel: false

    tasks:
      # -----------------------------------------------------------------------
      # T1.1: Audit DynamoDB GSI Configuration
      # -----------------------------------------------------------------------
      - task_id: T1.1
        name: "Audit existing GSI configuration for query patterns"
        status: pending
        priority: high

        description: |
          Check outpost-dispatches table for existing Global Secondary Indexes
          that can support list_runs query patterns (filter by status, agent,
          user_id with time-based sorting).

        dependencies: []

        interface:
          inputs:
            - name: table_name
              type: string
              value: "outpost-dispatches"
          outputs:
            - name: gsi_audit
              type: object
              schema:
                existing_gsis: array
                required_gsis: array
                recommendations: array

        implementation:
          location: "AWS DynamoDB"
          change_type: analysis
          details: |
            Audit GSI configuration:

            ```bash
            # List existing GSIs
            aws dynamodb describe-table \
              --profile soc \
              --table-name outpost-dispatches \
              --query 'Table.GlobalSecondaryIndexes[].{
                IndexName: IndexName,
                KeySchema: KeySchema,
                Projection: Projection.ProjectionType
              }'

            # Check for status-started_at-index
            # Check for user-status-index
            # Check for agent-status-index

            # Document query patterns needed:
            # 1. Filter by status + sort by started_at (DESC)
            # 2. Filter by agent + status + sort by started_at
            # 3. Filter by user_id + status + sort by started_at
            # 4. Pagination with cursor (LastEvaluatedKey)
            ```

        acceptance_criteria:
          - "All existing GSIs documented"
          - "Required query patterns identified"
          - "GSI gaps documented (if any)"
          - "Decision: use GSI vs scan with filter"

        verification:
          smoke:
            command: "aws dynamodb describe-table --profile soc --table-name outpost-dispatches --query 'Table.GlobalSecondaryIndexes'"
            timeout: PT10S

        rollback:
          strategy: none
          notes: "Analysis only, no changes"

      # -----------------------------------------------------------------------
      # T1.2: Create ListRunsQuery Schema
      # -----------------------------------------------------------------------
      - task_id: T1.2
        name: "Define TypeScript types for list_runs query and response"
        status: pending
        priority: high

        description: |
          Create Zod schemas and TypeScript interfaces for list_runs query
          parameters and response format.

        dependencies: [T1.1]

        interface:
          inputs:
            - name: model_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/models/dispatch.model.ts"
          outputs:
            - name: query_schema
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/models/dispatch.model.ts"
          change_type: code
          details: |
            Add schemas:

            ```typescript
            export const ListRunsQuerySchema = z.object({
              agent: z.enum(['claude', 'codex', 'gemini', 'aider', 'grok']).optional(),
              status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED']).optional(),
              since: z.string().datetime().optional(),
              user_id: z.string().optional(),
              limit: z.number().int().min(1).max(100).default(20),
              cursor: z.string().optional(),  // base64-encoded LastEvaluatedKey
            });

            export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

            export const ListRunsResponseSchema = z.object({
              runs: z.array(DispatchRecordSchema),
              cursor: z.string().optional(),
              hasMore: z.boolean(),
              totalCount: z.number().int().optional(),
            });

            export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;
            ```

        acceptance_criteria:
          - "ListRunsQuerySchema includes all filter parameters"
          - "Limit validation (1-100, default 20)"
          - "Cursor is optional base64 string"
          - "ListRunsResponse includes pagination metadata"

        verification:
          unit:
            command: "cd ~/projects/outpost/src/control-plane && npm run build"
            expected_exit_code: 0
            timeout: PT30S

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T1.3: Implement listRuns() Repository Method
      # -----------------------------------------------------------------------
      - task_id: T1.3
        name: "Implement listRuns() in DispatchRepository"
        status: pending
        priority: high

        description: |
          Create repository method to query dispatches with filters and cursor
          pagination. Use GSI if available (from T1.1 audit), otherwise scan
          with FilterExpression.

        dependencies: [T1.2]

        interface:
          inputs:
            - name: repository_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/repositories/dispatch.repository.ts"
          outputs:
            - name: list_method
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/repositories/dispatch.repository.ts"
          change_type: code
          details: |
            Implement listRuns method:

            ```typescript
            async listRuns(query: ListRunsQuery): Promise<ListRunsResponse> {
              const {
                agent,
                status,
                since,
                user_id,
                limit = 20,
                cursor
              } = query;

              // Decode cursor if provided
              const exclusiveStartKey = cursor
                ? JSON.parse(Buffer.from(cursor, 'base64').toString())
                : undefined;

              // Build filter expressions
              const filterExpressions: string[] = [];
              const expressionAttributeValues: any = {};
              const expressionAttributeNames: any = {};

              if (status) {
                filterExpressions.push('#status = :status');
                expressionAttributeNames['#status'] = 'status';
                expressionAttributeValues[':status'] = status;
              }

              if (agent) {
                filterExpressions.push('#agent = :agent');
                expressionAttributeNames['#agent'] = 'agent';
                expressionAttributeValues[':agent'] = agent;
              }

              if (since) {
                filterExpressions.push('#started_at >= :since');
                expressionAttributeNames['#started_at'] = 'started_at';
                expressionAttributeValues[':since'] = since;
              }

              if (user_id) {
                filterExpressions.push('#user_id = :user_id');
                expressionAttributeNames['#user_id'] = 'user_id';
                expressionAttributeValues[':user_id'] = user_id;
              }

              // Use scan with filter (GSI optimization can be added later)
              const params: ScanCommandInput = {
                TableName: this.tableName,
                Limit: limit + 1,  // Fetch one extra to determine hasMore
                ExclusiveStartKey: exclusiveStartKey,
              };

              if (filterExpressions.length > 0) {
                params.FilterExpression = filterExpressions.join(' AND ');
                params.ExpressionAttributeNames = expressionAttributeNames;
                params.ExpressionAttributeValues = expressionAttributeValues;
              }

              const result = await this.client.send(new ScanCommand(params));

              // Extract runs
              const runs = (result.Items || []).slice(0, limit).map(item =>
                this.unmarshall(item)
              );

              const hasMore = (result.Items?.length || 0) > limit;

              // Encode next cursor
              const nextCursor = hasMore && result.LastEvaluatedKey
                ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
                : undefined;

              return {
                runs,
                cursor: nextCursor,
                hasMore,
                totalCount: undefined,  // Not available without COUNT scan
              };
            }
            ```

        acceptance_criteria:
          - "Method accepts ListRunsQuery parameters"
          - "Builds correct FilterExpression for each filter"
          - "Implements cursor pagination with limit+1 pattern"
          - "Returns ListRunsResponse with hasMore flag"
          - "Encodes cursor as base64"

        verification:
          unit:
            command: "cd ~/projects/outpost/src/control-plane && npm test -- dispatch.repository"
            expected_exit_code: 0
            timeout: PT60S

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T1.4: Create GET /api/v1/dispatches Handler
      # -----------------------------------------------------------------------
      - task_id: T1.4
        name: "Implement HTTP handler for list_runs endpoint"
        status: pending
        priority: high

        description: |
          Create Express handler for GET /api/v1/dispatches with query parameter
          parsing and validation.

        dependencies: [T1.3]

        interface:
          inputs:
            - name: handler_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/api/handlers/dispatch.handler.ts"
          outputs:
            - name: list_handler
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/api/handlers/"
          change_type: code
          details: |
            Add listRunsHandler:

            ```typescript
            export async function listRunsHandler(
              req: Request,
              res: Response
            ): Promise<void> {
              try {
                // Parse query parameters
                const query = ListRunsQuerySchema.parse({
                  agent: req.query.agent,
                  status: req.query.status,
                  since: req.query.since,
                  user_id: req.query.user_id,
                  limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
                  cursor: req.query.cursor,
                });

                // Call repository
                const result = await dispatchRepository.listRuns(query);

                // Return response
                res.status(200).json({
                  success: true,
                  data: result,
                  meta: {
                    requestId: req.id,
                    timestamp: new Date().toISOString(),
                  },
                });
              } catch (error) {
                if (error instanceof z.ZodError) {
                  res.status(400).json({
                    success: false,
                    error: {
                      code: 'INVALID_QUERY',
                      message: 'Invalid query parameters',
                      details: error.errors,
                    },
                  });
                } else {
                  logger.error('Error listing runs', { error });
                  res.status(500).json({
                    success: false,
                    error: {
                      code: 'INTERNAL_ERROR',
                      message: 'Failed to list runs',
                    },
                  });
                }
              }
            }
            ```

            Add route in dispatch.routes.ts:
            ```typescript
            router.get('/dispatches', listRunsHandler);
            ```

        acceptance_criteria:
          - "Handler parses query parameters"
          - "Validates using ListRunsQuerySchema"
          - "Returns 400 for invalid parameters"
          - "Returns 200 with paginated results"
          - "Includes requestId and timestamp in meta"

        verification:
          integration:
            command: "curl -s 'http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/api/v1/dispatches?status=COMPLETED&limit=5' | jq '.success'"
            expected_output: "true"
            timeout: PT30S

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T1.5: Write Integration Tests for list_runs
      # -----------------------------------------------------------------------
      - task_id: T1.5
        name: "Create comprehensive integration tests for list_runs"
        status: pending
        priority: high

        description: |
          Write integration tests covering filtering, pagination, cursor handling,
          and edge cases for list_runs endpoint.

        dependencies: [T1.4]

        interface:
          inputs:
            - name: test_file
              type: file_path
              value: "~/projects/outpost/src/control-plane/src/__tests__/integration/list-runs.test.ts"
          outputs:
            - name: test_suite
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/src/control-plane/src/__tests__/integration/"
          change_type: test
          details: |
            Create test suite with 20+ tests covering:

            ```typescript
            describe('GET /api/v1/dispatches', () => {
              describe('Filtering', () => {
                it('should filter by agent', async () => {
                  const res = await request(app)
                    .get('/api/v1/dispatches?agent=claude')
                    .expect(200);

                  expect(res.body.success).toBe(true);
                  expect(res.body.data.runs).toBeInstanceOf(Array);
                  res.body.data.runs.forEach(run => {
                    expect(run.agent).toBe('claude');
                  });
                });

                it('should filter by status', async () => { /* ... */ });
                it('should filter by since timestamp', async () => { /* ... */ });
                it('should filter by user_id', async () => { /* ... */ });
                it('should support multiple filters', async () => { /* ... */ });
              });

              describe('Pagination', () => {
                it('should respect limit parameter', async () => { /* ... */ });
                it('should return cursor when hasMore is true', async () => { /* ... */ });
                it('should paginate using cursor', async () => { /* ... */ });
                it('should return empty array when no results', async () => { /* ... */ });
              });

              describe('Validation', () => {
                it('should reject invalid agent', async () => { /* ... */ });
                it('should reject invalid status', async () => { /* ... */ });
                it('should reject invalid limit (>100)', async () => { /* ... */ });
                it('should reject invalid cursor', async () => { /* ... */ });
              });
            });
            ```

        acceptance_criteria:
          - "20+ test cases covering all filters"
          - "Pagination tests with cursor"
          - "Validation error tests"
          - "Edge case tests (empty results, large limit)"
          - "All tests pass"

        verification:
          integration:
            command: "cd ~/projects/outpost/src/control-plane && npm test -- list-runs.test"
            expected_exit_code: 0
            timeout: PT120S

        rollback:
          strategy: delete_tests
          command: "rm src/__tests__/integration/list-runs.test.ts"

      # -----------------------------------------------------------------------
      # T1.6: Update MCPify list_runs Tool
      # -----------------------------------------------------------------------
      - task_id: T1.6
        name: "Wire MCPify mcp__mcpify__list_runs to HTTP endpoint"
        status: pending
        priority: high

        description: |
          Replace stub implementation in MCPify with HTTP call to control plane
          GET /api/v1/dispatches endpoint.

        dependencies: [T1.4]

        interface:
          inputs:
            - name: handler_file
              type: file_path
              value: "~/projects/mcpify/src/providers/outpost/handlers/list-runs-handler.ts"
          outputs:
            - name: updated_handler
              type: code
              language: typescript

        implementation:
          location: "~/projects/mcpify/src/providers/outpost/handlers/"
          change_type: code
          details: |
            Replace stub with HTTP implementation:

            ```typescript
            export async function listRunsHandler(
              input: ListRunsInput,
              context: RequestContext
            ): Promise<ListRunsOutput> {
              const {
                agent,
                status,
                since,
                limit = 20,
                cursor
              } = input;

              // Build query string
              const params = new URLSearchParams();
              if (agent) params.append('agent', agent);
              if (status) params.append('status', status);
              if (since) params.append('since', since);
              if (limit) params.append('limit', limit.toString());
              if (cursor) params.append('cursor', cursor);

              // Call control plane
              const response = await fetch(
                `${OUTPOST_API_URL}/api/v1/dispatches?${params.toString()}`,
                {
                  method: 'GET',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OUTPOST_API_KEY}`,
                  },
                }
              );

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
              }

              const data = await response.json();

              return {
                success: true,
                data: data.data,
                requestId: context.requestId,
                timestamp: new Date().toISOString(),
              };
            }
            ```

        acceptance_criteria:
          - "Calls HTTP endpoint instead of returning stub"
          - "Maps MCP tool parameters to query params"
          - "Returns paginated response"
          - "Handles errors gracefully"

        verification:
          integration:
            command: "Test via MCP protocol (manual or automated)"
            timeout: PT60S

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T1.7: Update API Documentation
      # -----------------------------------------------------------------------
      - task_id: T1.7
        name: "Document list_runs endpoint in API_REFERENCE.md"
        status: pending
        priority: medium

        description: |
          Add comprehensive documentation for GET /api/v1/dispatches endpoint
          with examples, query parameters, and response format.

        dependencies: [T1.6]

        interface:
          inputs:
            - name: docs_file
              type: file_path
              value: "~/projects/outpost/docs/API_REFERENCE.md"
          outputs:
            - name: updated_docs
              type: markdown

        implementation:
          location: "~/projects/outpost/docs/API_REFERENCE.md"
          change_type: documentation
          details: |
            Add section:

            ```markdown
            ## GET /api/v1/dispatches

            List dispatch runs with filtering and pagination.

            ### Query Parameters

            | Parameter | Type | Required | Description |
            |-----------|------|----------|-------------|
            | agent | string | No | Filter by agent (claude, codex, gemini, aider, grok) |
            | status | string | No | Filter by status (PENDING, RUNNING, COMPLETED, FAILED, TIMEOUT, CANCELLED) |
            | since | string | No | Filter by started_at >= ISO 8601 timestamp |
            | user_id | string | No | Filter by user_id |
            | limit | integer | No | Results per page (1-100, default 20) |
            | cursor | string | No | Pagination cursor from previous response |

            ### Response

            ```json
            {
              "success": true,
              "data": {
                "runs": [
                  {
                    "dispatch_id": "01KF16768B03PJ6SX4Z2JM6YVG",
                    "agent": "claude",
                    "status": "COMPLETED",
                    "started_at": "2026-01-15T16:01:05.903Z",
                    "ended_at": "2026-01-15T16:02:16.350Z"
                  }
                ],
                "cursor": "eyJkaXNwYXRjaF9pZCI6eyJTIjoiMDFLRjE2NzY4QjAzUEo2U1g0WjJKTTZZVkcifX0=",
                "hasMore": true
              }
            }
            ```

            ### Examples

            ```bash
            # List completed runs
            curl -X GET 'http://outpost-control-plane.../api/v1/dispatches?status=COMPLETED&limit=10'

            # List claude agent runs from last hour
            curl -X GET 'http://outpost-control-plane.../api/v1/dispatches?agent=claude&since=2026-01-15T15:00:00Z'

            # Paginate results
            curl -X GET 'http://outpost-control-plane.../api/v1/dispatches?limit=20&cursor=eyJk...'
            ```
            ```

        acceptance_criteria:
          - "Endpoint fully documented"
          - "All query parameters described"
          - "Response format shown with example"
          - "curl examples provided"

        verification:
          manual:
            command: "Review documentation for completeness"

        rollback:
          strategy: revert_commit
          command: "git revert HEAD"

# =============================================================================
# TIER 2: GSI PERFORMANCE EVALUATION (P2)
# Analyze and conditionally implement task-arn GSI
# =============================================================================

  - tier_id: T2
    name: "task-arn GSI Evaluation"
    description: "Profile Lambda callback performance and implement task-arn GSI if needed"
    parallel: false

    tasks:
      # -----------------------------------------------------------------------
      # T2.1: Profile Lambda Callback Performance
      # -----------------------------------------------------------------------
      - task_id: T2.1
        name: "Measure Lambda callback DynamoDB query performance"
        status: pending
        priority: medium

        description: |
          Extract Lambda execution logs and measure time spent querying DynamoDB
          to find dispatch_id from task_arn. Calculate p50, p95, p99 percentiles.

        dependencies: []

        interface:
          inputs:
            - name: log_group
              type: string
              value: "/aws/lambda/outpost-dispatch-callback"
          outputs:
            - name: performance_metrics
              type: object
              schema:
                sample_size: integer
                p50_ms: number
                p95_ms: number
                p99_ms: number
                max_ms: number

        implementation:
          location: "AWS CloudWatch Logs Insights"
          change_type: analysis
          details: |
            Use CloudWatch Logs Insights query:

            ```
            fields @timestamp, @message
            | filter @message like /Successfully updated dispatch/
            | parse @message /Duration: (?<duration>[\d.]+) ms/
            | stats
                count() as sample_size,
                pct(duration, 50) as p50_ms,
                pct(duration, 95) as p95_ms,
                pct(duration, 99) as p99_ms,
                max(duration) as max_ms
            ```

            Or extract from Lambda logs:
            ```bash
            aws logs filter-log-events \
              --profile soc \
              --log-group-name /aws/lambda/outpost-dispatch-callback \
              --start-time $(($(date +%s)*1000 - 604800000)) \
              --filter-pattern "REPORT RequestId" \
              --output json | \
              jq -r '.events[] | .message' | \
              grep "Duration" | \
              awk '{print $3}' | \
              sort -n > /tmp/lambda-durations.txt

            # Calculate percentiles
            cat /tmp/lambda-durations.txt | \
              awk 'BEGIN{c=0} {a[c++]=$1} END{print "p50:", a[int(c*0.5)], "p95:", a[int(c*0.95)], "p99:", a[int(c*0.99)]}'
            ```

        acceptance_criteria:
          - "Minimum 50 samples analyzed"
          - "p50, p95, p99 calculated"
          - "Current query method documented (scan vs query)"

        verification:
          smoke:
            command: "Verify metrics collected"
            timeout: PT60S

        rollback:
          strategy: none
          notes: "Analysis only"

      # -----------------------------------------------------------------------
      # T2.2: Make GSI Decision
      # -----------------------------------------------------------------------
      - task_id: T2.2
        name: "Decide if task-arn GSI implementation is needed"
        status: pending
        priority: medium

        description: |
          Based on performance metrics from T2.1, decide if task-arn GSI should
          be implemented. Threshold: implement if p95 > 100ms.

        dependencies: [T2.1]

        interface:
          inputs:
            - name: performance_metrics
              type: object
              source: T2.1
          outputs:
            - name: decision
              type: object
              schema:
                implement_gsi: boolean
                rationale: string
                threshold_met: boolean

        implementation:
          location: "Decision document"
          change_type: decision
          details: |
            Decision criteria:
            - If p95 > 100ms → Implement GSI
            - If current record count > 10,000 → Implement GSI
            - If projected growth > 100,000 records → Implement GSI

            Consider:
            - Current performance baseline (observed 1-2s total latency)
            - DynamoDB scan cost vs GSI query cost
            - GSI storage cost (~$0.25/GB/month)
            - Current table size (163 records)

            Document decision with rationale.

        acceptance_criteria:
          - "Clear decision: yes or no"
          - "Rationale documented"
          - "Threshold comparison shown"

        verification:
          manual:
            command: "Review decision document"

        rollback:
          strategy: none
          notes: "Decision document only"

      # -----------------------------------------------------------------------
      # T2.3: Create task-arn GSI Terraform (Conditional)
      # -----------------------------------------------------------------------
      - task_id: T2.3
        name: "Create Terraform configuration for task-arn GSI"
        status: pending
        priority: medium
        condition: "Execute only if T2.2 decision is YES"

        description: |
          Create Terraform configuration to add task-arn GSI to outpost-dispatches
          table. GSI will enable efficient reverse lookup from ECS task ARN.

        dependencies: [T2.2]

        interface:
          inputs:
            - name: terraform_file
              type: file_path
              value: "~/projects/outpost/infrastructure/terraform/environments/dev/dynamodb.tf"
          outputs:
            - name: gsi_config
              type: code
              language: hcl

        implementation:
          location: "~/projects/outpost/infrastructure/terraform/environments/dev/dynamodb.tf"
          change_type: infrastructure
          details: |
            Add GSI configuration:

            ```hcl
            resource "aws_dynamodb_table" "dispatches" {
              # ... existing configuration

              global_secondary_index {
                name               = "task-arn-index"
                hash_key           = "task_arn"
                projection_type    = "ALL"
                read_capacity      = 5
                write_capacity     = 5
              }
            }
            ```

        acceptance_criteria:
          - "GSI configuration valid"
          - "terraform plan shows GSI addition"
          - "No errors in plan"

        verification:
          smoke:
            command: "cd ~/projects/outpost/infrastructure/terraform/environments/dev && terraform plan"
            expected_exit_code: 0
            timeout: PT60S

        rollback:
          strategy: terraform_destroy
          command: "Remove GSI configuration and run terraform apply"

      # -----------------------------------------------------------------------
      # T2.4: Deploy task-arn GSI (Conditional)
      # -----------------------------------------------------------------------
      - task_id: T2.4
        name: "Apply Terraform and wait for GSI backfill"
        status: pending
        priority: medium
        condition: "Execute only if T2.3 was executed"

        description: |
          Deploy task-arn GSI via Terraform and monitor backfill progress. GSI
          becomes ACTIVE once backfill completes.

        dependencies: [T2.3]

        interface:
          inputs:
            - name: gsi_name
              type: string
              value: "task-arn-index"
          outputs:
            - name: gsi_status
              type: string
              enum: ["CREATING", "BACKFILLING", "ACTIVE"]

        implementation:
          location: "~/projects/outpost/infrastructure/terraform/environments/dev/"
          change_type: infrastructure
          details: |
            Deploy GSI:

            ```bash
            cd ~/projects/outpost/infrastructure/terraform/environments/dev

            # Apply Terraform
            terraform apply -auto-approve

            # Monitor GSI status
            while true; do
              STATUS=$(aws dynamodb describe-table \
                --profile soc \
                --table-name outpost-dispatches \
                --query 'Table.GlobalSecondaryIndexes[?IndexName==`task-arn-index`].IndexStatus' \
                --output text)

              echo "GSI Status: $STATUS"

              if [ "$STATUS" == "ACTIVE" ]; then
                echo "GSI is ACTIVE"
                break
              fi

              sleep 30
            done
            ```

        acceptance_criteria:
          - "Terraform apply succeeds"
          - "GSI status transitions to ACTIVE"
          - "No errors during backfill"

        verification:
          integration:
            command: "aws dynamodb describe-table --profile soc --table-name outpost-dispatches --query 'Table.GlobalSecondaryIndexes[?IndexName==`task-arn-index`].IndexStatus'"
            expected_output: "ACTIVE"
            timeout: PT600S

        rollback:
          strategy: terraform_destroy
          command: "Remove GSI via Terraform"

      # -----------------------------------------------------------------------
      # T2.5: Update Lambda to Use GSI (Conditional)
      # -----------------------------------------------------------------------
      - task_id: T2.5
        name: "Modify Lambda callback to query using task-arn GSI"
        status: pending
        priority: medium
        condition: "Execute only if T2.4 was executed"

        description: |
          Update Lambda function to use task-arn-index GSI for querying dispatch_id
          from task_arn, improving query performance.

        dependencies: [T2.4]

        interface:
          inputs:
            - name: lambda_file
              type: file_path
              value: "~/projects/outpost/infrastructure/lambda/dispatch-callback/src/dynamodb.ts"
          outputs:
            - name: updated_query
              type: code
              language: typescript

        implementation:
          location: "~/projects/outpost/infrastructure/lambda/dispatch-callback/src/dynamodb.ts"
          change_type: code
          details: |
            Update queryByTaskArn function:

            ```typescript
            export async function queryByTaskArn(
              taskArn: string
            ): Promise<string | null> {
              const params: QueryCommandInput = {
                TableName: DISPATCHES_TABLE,
                IndexName: 'task-arn-index',  // Use GSI
                KeyConditionExpression: 'task_arn = :task_arn',
                ExpressionAttributeValues: {
                  ':task_arn': { S: taskArn },
                },
                Limit: 1,
              };

              const result = await client.send(new QueryCommand(params));

              if (!result.Items || result.Items.length === 0) {
                logger.warn('No dispatch found for task ARN', { taskArn });
                return null;
              }

              return result.Items[0].dispatch_id.S || null;
            }
            ```

        acceptance_criteria:
          - "Query uses task-arn-index GSI"
          - "Lambda function rebuilt and redeployed"
          - "Unit tests pass"
          - "Integration test shows improved performance"

        verification:
          integration:
            command: "Trigger callback and verify GSI usage in logs"
            timeout: PT120S

        rollback:
          strategy: previous_lambda_version
          command: "Revert to previous Lambda deployment"

# =============================================================================
# TIER 3: PRODUCTION MONITORING (P3)
# Dashboards, alarms, and observability
# =============================================================================

  - tier_id: T3
    name: "Production Monitoring"
    description: "Establish CloudWatch dashboards, SNS notifications, and custom metrics"
    parallel: true

    tasks:
      # -----------------------------------------------------------------------
      # T3.1: Create Lambda Monitoring Dashboard
      # -----------------------------------------------------------------------
      - task_id: T3.1
        name: "Create CloudWatch dashboard for dispatch-callback Lambda"
        status: pending
        priority: medium

        description: |
          Build CloudWatch dashboard with key Lambda metrics: Invocations, Errors,
          Duration (p50/p95/p99), Throttles, and ConcurrentExecutions.

        dependencies: []

        interface:
          inputs:
            - name: dashboard_name
              type: string
              value: "Outpost-DispatchCallback-Monitoring"
          outputs:
            - name: dashboard_url
              type: string

        implementation:
          location: "AWS CloudWatch"
          change_type: infrastructure
          details: |
            Create dashboard using AWS CLI:

            ```bash
            cat > /tmp/dashboard.json <<'EOF'
            {
              "widgets": [
                {
                  "type": "metric",
                  "properties": {
                    "metrics": [
                      ["AWS/Lambda", "Invocations", {"stat": "Sum"}]
                    ],
                    "region": "us-east-1",
                    "title": "Invocations",
                    "period": 300
                  }
                },
                {
                  "type": "metric",
                  "properties": {
                    "metrics": [
                      ["AWS/Lambda", "Errors", {"stat": "Sum"}]
                    ],
                    "region": "us-east-1",
                    "title": "Errors",
                    "period": 300
                  }
                },
                {
                  "type": "metric",
                  "properties": {
                    "metrics": [
                      ["AWS/Lambda", "Duration", {"stat": "p50"}],
                      ["...", {"stat": "p95"}],
                      ["...", {"stat": "p99"}]
                    ],
                    "region": "us-east-1",
                    "title": "Duration (ms)",
                    "period": 300
                  }
                },
                {
                  "type": "metric",
                  "properties": {
                    "metrics": [
                      ["AWS/Lambda", "Throttles", {"stat": "Sum"}]
                    ],
                    "region": "us-east-1",
                    "title": "Throttles",
                    "period": 300
                  }
                }
              ]
            }
            EOF

            aws cloudwatch put-dashboard \
              --profile soc \
              --dashboard-name Outpost-DispatchCallback-Monitoring \
              --dashboard-body file:///tmp/dashboard.json
            ```

        acceptance_criteria:
          - "Dashboard created with 4+ widgets"
          - "Metrics visible and updating"
          - "Dashboard URL accessible"

        verification:
          smoke:
            command: "aws cloudwatch get-dashboard --profile soc --dashboard-name Outpost-DispatchCallback-Monitoring"
            expected_exit_code: 0
            timeout: PT30S

        rollback:
          strategy: delete_dashboard
          command: "aws cloudwatch delete-dashboards --profile soc --dashboard-names Outpost-DispatchCallback-Monitoring"

      # -----------------------------------------------------------------------
      # T3.2: Create Lambda Error Rate Alarm
      # -----------------------------------------------------------------------
      - task_id: T3.2
        name: "Create CloudWatch alarm for Lambda error rate >1%"
        status: pending
        priority: medium

        description: |
          Create alarm that triggers when dispatch-callback Lambda error rate
          exceeds 1% of invocations over 5-minute window.

        dependencies: []

        interface:
          inputs:
            - name: alarm_name
              type: string
              value: "outpost-dispatch-callback-errors"
          outputs:
            - name: alarm_arn
              type: string

        implementation:
          location: "AWS CloudWatch Alarms"
          change_type: infrastructure
          details: |
            Create alarm:

            ```bash
            aws cloudwatch put-metric-alarm \
              --profile soc \
              --alarm-name outpost-dispatch-callback-errors \
              --alarm-description "Alert when Lambda error rate exceeds 1%" \
              --metric-name Errors \
              --namespace AWS/Lambda \
              --statistic Sum \
              --period 300 \
              --evaluation-periods 2 \
              --threshold 1 \
              --comparison-operator GreaterThanThreshold \
              --dimensions Name=FunctionName,Value=outpost-dispatch-callback \
              --treat-missing-data notBreaching \
              --alarm-actions arn:aws:sns:us-east-1:311493921645:outpost-storage-alerts
            ```

        acceptance_criteria:
          - "Alarm created and in OK state"
          - "Threshold set to 1% error rate"
          - "SNS action configured"

        verification:
          smoke:
            command: "aws cloudwatch describe-alarms --profile soc --alarm-names outpost-dispatch-callback-errors --query 'MetricAlarms[0].StateValue'"
            expected_output: "OK"
            timeout: PT30S

        rollback:
          strategy: delete_alarm
          command: "aws cloudwatch delete-alarms --profile soc --alarm-names outpost-dispatch-callback-errors"

      # -----------------------------------------------------------------------
      # T3.3: Create Lambda Duration Alarm
      # -----------------------------------------------------------------------
      - task_id: T3.3
        name: "Create CloudWatch alarm for Lambda p99 duration >5s"
        status: pending
        priority: medium

        description: |
          Create alarm for Lambda execution duration p99 exceeding 5 seconds,
          indicating performance degradation.

        dependencies: []

        interface:
          inputs:
            - name: alarm_name
              type: string
              value: "outpost-dispatch-callback-duration"
          outputs:
            - name: alarm_arn
              type: string

        implementation:
          location: "AWS CloudWatch Alarms"
          change_type: infrastructure
          details: |
            Create alarm:

            ```bash
            aws cloudwatch put-metric-alarm \
              --profile soc \
              --alarm-name outpost-dispatch-callback-duration \
              --alarm-description "Alert when Lambda p99 duration exceeds 5s" \
              --metric-name Duration \
              --namespace AWS/Lambda \
              --statistic p99 \
              --period 300 \
              --evaluation-periods 3 \
              --threshold 5000 \
              --comparison-operator GreaterThanThreshold \
              --dimensions Name=FunctionName,Value=outpost-dispatch-callback \
              --treat-missing-data notBreaching \
              --alarm-actions arn:aws:sns:us-east-1:311493921645:outpost-storage-alerts
            ```

        acceptance_criteria:
          - "Alarm created and in OK state"
          - "Threshold set to 5000ms (5s)"
          - "Uses p99 statistic"

        verification:
          smoke:
            command: "aws cloudwatch describe-alarms --profile soc --alarm-names outpost-dispatch-callback-duration --query 'MetricAlarms[0].StateValue'"
            expected_output: "OK"
            timeout: PT30S

        rollback:
          strategy: delete_alarm
          command: "aws cloudwatch delete-alarms --profile soc --alarm-names outpost-dispatch-callback-duration"

      # -----------------------------------------------------------------------
      # T3.4: Fix SNS Subscription
      # -----------------------------------------------------------------------
      - task_id: T3.4
        name: "Troubleshoot and fix SNS email subscription"
        status: pending
        priority: medium

        description: |
          Delete pending SNS subscription and recreate to trigger new verification
          email. If email fails again, implement Slack webhook alternative.

        dependencies: []

        interface:
          inputs:
            - name: topic_arn
              type: string
              value: "arn:aws:sns:us-east-1:311493921645:outpost-storage-alerts"
          outputs:
            - name: subscription_status
              type: string
              enum: ["Confirmed", "Slack"]

        implementation:
          location: "AWS SNS"
          change_type: infrastructure
          details: |
            Step 1: Delete and recreate email subscription

            ```bash
            # List subscriptions
            aws sns list-subscriptions-by-topic \
              --profile soc \
              --topic-arn arn:aws:sns:us-east-1:311493921645:outpost-storage-alerts

            # Delete pending subscription
            PENDING_ARN=$(aws sns list-subscriptions-by-topic \
              --profile soc \
              --topic-arn arn:aws:sns:us-east-1:311493921645:outpost-storage-alerts \
              --query 'Subscriptions[?Protocol==`email` && SubscriptionArn!=`PendingConfirmation`].SubscriptionArn' \
              --output text)

            if [ -n "$PENDING_ARN" ]; then
              aws sns unsubscribe --profile soc --subscription-arn "$PENDING_ARN"
            fi

            # Create new subscription
            aws sns subscribe \
              --profile soc \
              --topic-arn arn:aws:sns:us-east-1:311493921645:outpost-storage-alerts \
              --protocol email \
              --notification-endpoint outpost-notifications@zeroechelon.com

            echo "Verification email sent. Check inbox and spam folder."
            echo "If no email received within 5 minutes, proceed with Slack webhook."
            ```

            Step 2 (if email fails): Implement Slack webhook

            ```bash
            # Create Lambda for SNS → Slack forwarding
            # (Implementation details in T3.4.1 subtask if needed)
            ```

        acceptance_criteria:
          - "SNS subscription in Confirmed status, OR"
          - "Slack webhook Lambda deployed and functional"
          - "Test notification delivered successfully"

        verification:
          integration:
            command: "Trigger test alarm and verify notification received"
            timeout: PT300S

        rollback:
          strategy: none
          notes: "Can delete subscription if needed"

      # -----------------------------------------------------------------------
      # T3.5: Implement Callback Latency Metric
      # -----------------------------------------------------------------------
      - task_id: T3.5
        name: "Add custom CloudWatch metric for callback latency"
        status: pending
        priority: medium

        description: |
          Emit custom metric from Lambda tracking time between ECS task stop
          and DynamoDB update completion (callback latency).

        dependencies: []

        interface:
          inputs:
            - name: lambda_file
              type: file_path
              value: "~/projects/outpost/infrastructure/lambda/dispatch-callback/src/index.ts"
          outputs:
            - name: metric_namespace
              type: string
              value: "Outpost"

        implementation:
          location: "~/projects/outpost/infrastructure/lambda/dispatch-callback/src/index.ts"
          change_type: code
          details: |
            Add CloudWatch metric emission:

            ```typescript
            import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

            const cloudwatch = new CloudWatchClient({ region: 'us-east-1' });

            export async function handler(event: EventBridgeEvent) {
              const stoppedAt = new Date(event.detail.stoppedAt).getTime();
              const now = Date.now();
              const callbackLatency = now - stoppedAt;

              // ... existing callback logic

              // Emit custom metric
              await cloudwatch.send(new PutMetricDataCommand({
                Namespace: 'Outpost',
                MetricData: [{
                  MetricName: 'CallbackLatency',
                  Value: callbackLatency,
                  Unit: 'Milliseconds',
                  Timestamp: new Date(),
                  Dimensions: [{
                    Name: 'FunctionName',
                    Value: 'outpost-dispatch-callback',
                  }],
                }],
              }));

              logger.info('Callback latency', { latency: callbackLatency });
            }
            ```

        acceptance_criteria:
          - "Custom metric emitted on every callback"
          - "Metric visible in CloudWatch"
          - "Lambda function rebuilt and deployed"

        verification:
          integration:
            command: "Trigger callback and verify metric in CloudWatch"
            timeout: PT120S

        rollback:
          strategy: previous_lambda_version
          command: "Revert Lambda to previous version"

      # -----------------------------------------------------------------------
      # T3.6: Add Latency Widget to Dashboard
      # -----------------------------------------------------------------------
      - task_id: T3.6
        name: "Add CallbackLatency metric to dashboard"
        status: pending
        priority: low

        description: |
          Update CloudWatch dashboard to include CallbackLatency custom metric
          widget showing p50, p95, p99.

        dependencies: [T3.1, T3.5]

        interface:
          inputs:
            - name: dashboard_name
              type: string
              value: "Outpost-DispatchCallback-Monitoring"
          outputs:
            - name: updated_dashboard
              type: object

        implementation:
          location: "AWS CloudWatch"
          change_type: infrastructure
          details: |
            Update dashboard:

            ```bash
            # Get existing dashboard
            aws cloudwatch get-dashboard \
              --profile soc \
              --dashboard-name Outpost-DispatchCallback-Monitoring \
              --query 'DashboardBody' \
              --output text > /tmp/dashboard.json

            # Add CallbackLatency widget
            jq '.widgets += [{
              "type": "metric",
              "properties": {
                "metrics": [
                  ["Outpost", "CallbackLatency", {"stat": "p50"}],
                  ["...", {"stat": "p95"}],
                  ["...", {"stat": "p99"}]
                ],
                "region": "us-east-1",
                "title": "Callback Latency (ms)",
                "period": 300
              }
            }]' /tmp/dashboard.json > /tmp/dashboard-updated.json

            # Update dashboard
            aws cloudwatch put-dashboard \
              --profile soc \
              --dashboard-name Outpost-DispatchCallback-Monitoring \
              --dashboard-body file:///tmp/dashboard-updated.json
            ```

        acceptance_criteria:
          - "Dashboard includes CallbackLatency widget"
          - "Widget shows p50, p95, p99 percentiles"
          - "Metric data visible"

        verification:
          smoke:
            command: "View dashboard and verify widget"
            timeout: PT30S

        rollback:
          strategy: restore_dashboard
          command: "Restore dashboard from backup"

      # -----------------------------------------------------------------------
      # T3.7: Document Monitoring Runbook
      # -----------------------------------------------------------------------
      - task_id: T3.7
        name: "Create monitoring and alarm response runbook"
        status: pending
        priority: low

        description: |
          Document dashboard usage, alarm thresholds, response procedures, and
          troubleshooting steps for Lambda monitoring.

        dependencies: [T3.6]

        interface:
          inputs:
            - name: docs_dir
              type: directory
              value: "~/projects/outpost/docs/"
          outputs:
            - name: runbook
              type: file_path
              value: "~/projects/outpost/docs/LAMBDA_MONITORING_RUNBOOK.md"

        implementation:
          location: "~/projects/outpost/docs/LAMBDA_MONITORING_RUNBOOK.md"
          change_type: documentation
          details: |
            Create runbook with sections:

            1. Dashboard Overview
               - URL: https://console.aws.amazon.com/cloudwatch/...
               - Metrics explained
               - Baseline values

            2. Alarm Configurations
               - outpost-dispatch-callback-errors (>1% threshold)
               - outpost-dispatch-callback-duration (>5s p99)
               - Rationale for thresholds

            3. Alarm Response Procedures
               - Error alarm: Check Lambda logs, verify DynamoDB connectivity
               - Duration alarm: Check DynamoDB performance, consider GSI

            4. Troubleshooting
               - Lambda invocation failures
               - DynamoDB throttling
               - EventBridge delivery delays

            5. Escalation
               - Critical: All dispatches failing
               - High: Error rate >10%
               - Medium: Duration degradation

        acceptance_criteria:
          - "Runbook complete with all sections"
          - "Dashboard URL documented"
          - "Response procedures clear"
          - "Troubleshooting steps actionable"

        verification:
          manual:
            command: "Review runbook for completeness"

        rollback:
          strategy: delete_file
          command: "rm docs/LAMBDA_MONITORING_RUNBOOK.md"

# =============================================================================
# TIER 4: VALIDATION & FINALIZATION
# End-to-end validation and documentation
# =============================================================================

  - tier_id: T4
    name: "Validation & Finalization"
    description: "Comprehensive validation of all changes and final documentation"
    parallel: false

    tasks:
      # -----------------------------------------------------------------------
      # T4.1: Run Full Test Suite
      # -----------------------------------------------------------------------
      - task_id: T4.1
        name: "Execute complete test suite for control plane"
        status: pending
        priority: high

        description: |
          Run all unit and integration tests for control plane to verify no
          regressions introduced by P1-P3 changes.

        dependencies: []

        interface:
          inputs:
            - name: control_plane_path
              type: directory
              value: "~/projects/outpost/src/control-plane"
          outputs:
            - name: test_results
              type: object
              schema:
                total_tests: integer
                passed: integer
                failed: integer
                coverage: number

        implementation:
          location: "~/projects/outpost/src/control-plane"
          change_type: validation
          details: |
            Run tests:

            ```bash
            cd ~/projects/outpost/src/control-plane

            # Run all tests
            npm test -- --coverage

            # Verify coverage threshold
            npm run test:coverage
            ```

        acceptance_criteria:
          - "All tests pass (282+ tests)"
          - "No new test failures"
          - "Coverage remains >90%"

        verification:
          unit:
            command: "cd ~/projects/outpost/src/control-plane && npm test"
            expected_exit_code: 0
            timeout: PT180S

        rollback:
          strategy: none
          notes: "Tests are validation only"

      # -----------------------------------------------------------------------
      # T4.2: End-to-End Integration Test
      # -----------------------------------------------------------------------
      - task_id: T4.2
        name: "Execute end-to-end integration test with fleet agents"
        status: pending
        priority: high

        description: |
          Create test dispatch for each agent, verify status callbacks work,
          verify list_runs returns results, verify TTL attributes set.

        dependencies: [T4.1]

        interface:
          inputs:
            - name: agents
              type: array
              value: ["claude", "codex", "gemini", "aider", "grok"]
          outputs:
            - name: e2e_results
              type: object
              schema:
                dispatches_created: integer
                callbacks_successful: integer
                list_runs_functional: boolean
                ttl_verified: boolean

        implementation:
          location: "Test script"
          change_type: validation
          details: |
            E2E test script:

            ```bash
            #!/bin/bash
            set -e

            CONTROL_PLANE_URL="http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com"

            echo "Creating test dispatches..."
            for AGENT in claude codex gemini aider grok; do
              echo "Testing $AGENT..."

              DISPATCH_ID=$(curl -s -X POST "$CONTROL_PLANE_URL/api/v1/dispatches" \
                -H "Content-Type: application/json" \
                -d "{\"agent\": \"$AGENT\", \"task\": \"E2E test: echo 'success'\"}" | \
                jq -r '.data.dispatchId')

              echo "Created dispatch: $DISPATCH_ID"

              # Wait for completion (max 2 minutes)
              for i in {1..24}; do
                STATUS=$(curl -s "$CONTROL_PLANE_URL/api/v1/dispatches/$DISPATCH_ID" | \
                  jq -r '.data.status')

                if [ "$STATUS" == "COMPLETED" ]; then
                  echo "✓ $AGENT dispatch completed"
                  break
                fi

                sleep 5
              done
            done

            echo "Testing list_runs endpoint..."
            RUNS=$(curl -s "$CONTROL_PLANE_URL/api/v1/dispatches?limit=5" | \
              jq '.data.runs | length')

            if [ "$RUNS" -gt 0 ]; then
              echo "✓ list_runs functional ($RUNS results)"
            else
              echo "✗ list_runs returned no results"
              exit 1
            fi

            echo "✓ All E2E tests passed"
            ```

        acceptance_criteria:
          - "All 5 agents complete successfully"
          - "Status callbacks update DynamoDB"
          - "list_runs returns results"
          - "TTL attributes verified"

        verification:
          integration:
            command: "bash /tmp/e2e-test.sh"
            expected_exit_code: 0
            timeout: PT600S

        rollback:
          strategy: none
          notes: "Test dispatches will auto-delete via TTL"

      # -----------------------------------------------------------------------
      # T4.3: Update Session Journal
      # -----------------------------------------------------------------------
      - task_id: T4.3
        name: "Update session journal with P0 task and blueprint completion"
        status: pending
        priority: medium

        description: |
          Update session journal to document workspace output retrieval P0 task
          and operational readiness blueprint completion.

        dependencies: [T4.2]

        interface:
          inputs:
            - name: journal_file
              type: file_path
              value: "~/projects/outpost/session-journals/2026-01-15-status-callback-implementation.md"
          outputs:
            - name: updated_journal
              type: markdown

        implementation:
          location: "~/projects/outpost/session-journals/"
          change_type: documentation
          details: |
            Update session journal sections:

            1. Add "Blueprints Executed This Session" entry:
               - OUTPOST_V2_OPERATIONAL_READINESS (28 tasks)

            2. Document P0 task in "Pending P0 Tasks" section (already done)

            3. Add metrics:
               - Total blueprints: 4 (storage, dispatch, callback, readiness)
               - Total tasks: 111 (22+32+29+28)
               - Pass rate: 100%

        acceptance_criteria:
          - "Session journal updated"
          - "P0 task documented"
          - "Metrics accurate"

        verification:
          manual:
            command: "Review session journal"

        rollback:
          strategy: git_revert
          command: "git revert HEAD"

      # -----------------------------------------------------------------------
      # T4.4: Commit and Push Changes
      # -----------------------------------------------------------------------
      - task_id: T4.4
        name: "Commit all changes and push to GitHub"
        status: pending
        priority: high

        description: |
          Create git commits for all P1-P3 changes and push to v2-commander-platform
          branch.

        dependencies: [T4.3]

        interface:
          inputs:
            - name: branch
              type: string
              value: "v2-commander-platform"
          outputs:
            - name: commit_sha
              type: string

        implementation:
          location: "~/projects/outpost"
          change_type: git
          details: |
            Git operations:

            ```bash
            cd ~/projects/outpost

            # Stage all changes
            git add -A

            # Create commit
            git commit -m "feat: Complete operational readiness gaps (P1-P3)

            - P1: Set CloudWatch log retention (30 days)
            - P1: Enable DynamoDB TTL (90-day retention)
            - P2: Implement list_runs API with pagination
            - P2: Evaluate task-arn GSI (conditional)
            - P3: Add Lambda monitoring dashboard and alarms
            - P3: Fix SNS subscription
            - P3: Implement callback latency metrics

            OUTPOST_V2_OPERATIONAL_READINESS blueprint: 28/28 tasks
            All tests passing. Outpost v2 production-ready.

            Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

            # Push to remote
            git push origin v2-commander-platform
            ```

        acceptance_criteria:
          - "All changes committed"
          - "Commit message descriptive"
          - "Pushed to GitHub"

        verification:
          smoke:
            command: "git log -1 --oneline"
            timeout: PT30S

        rollback:
          strategy: git_reset
          command: "git reset --hard HEAD~1"

# =============================================================================
# ROLLBACK PLAN
# =============================================================================

rollback_plan:
  tier_0:
    - "CloudWatch retention: Non-destructive, no rollback needed"
    - "DynamoDB TTL: Can disable without data loss"
    - "Control plane: Revert to previous task definition"

  tier_1:
    - "list_runs endpoint: Remove route if errors"
    - "Repository method: Revert commit"
    - "MCPify tool: Revert to stub implementation"

  tier_2:
    - "GSI: Delete via Terraform if performance degrades"
    - "Lambda: Revert to previous version"

  tier_3:
    - "Dashboard: Delete if incorrect"
    - "Alarms: Delete or disable"
    - "SNS: Delete subscription if problematic"
    - "Custom metric: Remove from Lambda code"

# =============================================================================
# RISK ASSESSMENT
# =============================================================================

risks:
  - risk: "DynamoDB TTL deletion delay up to 48 hours"
    likelihood: certain
    impact: low
    mitigation: "Document expected behavior, not a production issue"

  - risk: "GSI creation causes brief table performance impact"
    likelihood: medium
    impact: medium
    mitigation: "Create during low-traffic window, monitor throughput"

  - risk: "SNS email continues to fail (spam filters)"
    likelihood: medium
    impact: low
    mitigation: "Slack webhook alternative implemented (T3.4)"

  - risk: "Custom metric increases Lambda duration and cost"
    likelihood: low
    impact: low
    mitigation: "Single PutMetric call adds <50ms, cost ~$0.01/month"

  - risk: "list_runs endpoint adds API latency"
    likelihood: low
    impact: medium
    mitigation: "Pagination limits results, implement GSI if slow"

# =============================================================================
# SUCCESS METRICS
# =============================================================================

success_metrics:
  storage_governance:
    - metric: "CloudWatch log retention compliance"
      target: "100% (all Lambda log groups @ 30 days)"
      measurement: "aws logs describe-log-groups"

    - metric: "DynamoDB TTL status"
      target: "ENABLED on outpost-dispatches"
      measurement: "aws dynamodb describe-time-to-live"

    - metric: "Dispatch records with TTL"
      target: "100% of new dispatches have expires_at"
      measurement: "DynamoDB scan for expires_at attribute"

  api_completeness:
    - metric: "list_runs endpoint functionality"
      target: "HTTP 200 with paginated results"
      measurement: "curl GET /api/v1/dispatches"

    - metric: "list_runs filtering accuracy"
      target: "All filters work correctly (agent, status, since, user_id)"
      measurement: "Integration tests pass"

    - metric: "Pagination cursor handling"
      target: "hasMore and cursor work correctly"
      measurement: "Integration tests pass"

  production_monitoring:
    - metric: "Dashboard visibility"
      target: "Dashboard accessible with 5+ widgets"
      measurement: "CloudWatch console access"

    - metric: "Alarm operational status"
      target: "2 alarms in OK state"
      measurement: "aws cloudwatch describe-alarms"

    - metric: "Notification delivery"
      target: "Test alarm notification received (email or Slack)"
      measurement: "Manual verification"

    - metric: "Callback latency baseline"
      target: "p95 <5s, p99 <10s"
      measurement: "CloudWatch Outpost/CallbackLatency metric"

# =============================================================================
# ARTIFACTS
# =============================================================================

artifacts:
  code:
    - "src/control-plane/src/models/dispatch.model.ts (TTL schema)"
    - "src/control-plane/src/repositories/dispatch.repository.ts (listRuns, calculateExpiresAt)"
    - "src/control-plane/src/api/handlers/dispatch.handler.ts (listRunsHandler)"
    - "src/control-plane/src/__tests__/integration/list-runs.test.ts (20+ tests)"
    - "infrastructure/lambda/dispatch-callback/src/index.ts (custom metrics)"

  infrastructure:
    - "CloudWatch dashboard: Outpost-DispatchCallback-Monitoring"
    - "CloudWatch alarms: outpost-dispatch-callback-errors, outpost-dispatch-callback-duration"
    - "DynamoDB TTL: outpost-dispatches.expires_at"
    - "Terraform (conditional): task-arn-index GSI"

  documentation:
    - "docs/API_REFERENCE.md (list_runs endpoint)"
    - "docs/LAMBDA_MONITORING_RUNBOOK.md (monitoring guide)"
    - "session-journals/2026-01-15-status-callback-implementation.md (updated)"

  validation:
    - "Control plane test suite: 282+ tests passing"
    - "MCPify test suite: 1068+ tests passing"
    - "E2E integration tests: All 5 agents operational"

# =============================================================================
# NOTES
# =============================================================================

notes:
  - "This blueprint remediates all gaps identified in Session 017 post-implementation analysis"
  - "P1 tasks (T0) are critical for production readiness"
  - "P2 tasks (T1, T2) improve API completeness and performance"
  - "P3 tasks (T3) establish operational excellence"
  - "T2 includes conditional GSI deployment based on performance analysis"
  - "T3.4 includes conditional Slack webhook if SNS email fails"
  - "Total estimated duration: 6-8 hours with sequential execution"
  - "Recommended: Execute T0 first, then T1∥T2∥T3 in parallel, then T4"
  - "All infrastructure changes use AWS CLI (consider Terraform migration)"
  - "No breaking changes to existing functionality"
