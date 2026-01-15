#!/bin/bash
# Cold Start Performance Test for Outpost v2 Agents
# AWS Profile: soc, Region: us-east-1
# Blueprint Task: T8.3

set -e

# Configuration
CLUSTER="outpost-dev"
PROFILE="soc"
REGION="us-east-1"
AGENTS=("claude" "codex" "gemini" "aider" "grok")

# Network configuration (from AWS infrastructure)
SUBNETS="subnet-0fbe5255f2651080a,subnet-033d5d44c24b00dcf"  # Private subnets
SECURITY_GROUP="sg-02d1679b75fe8390c"  # ECS tasks security group

# Output configuration
RESULTS_DIR="/home/richie/projects/outpost/tests/performance/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="${RESULTS_DIR}/cold-start-${TIMESTAMP}.json"

# Initialize results array
declare -A RESULTS

# Functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

cleanup_task() {
    local task_arn=$1
    if [[ -n "$task_arn" && "$task_arn" != "None" ]]; then
        log "  Cleaning up task: $task_arn"
        aws ecs stop-task \
            --cluster "$CLUSTER" \
            --task "$task_arn" \
            --profile "$PROFILE" \
            --region "$REGION" \
            --reason "Performance test complete" > /dev/null 2>&1 || true
    fi
}

measure_cold_start() {
    local agent=$1
    local task_def="outpost-dev-${agent}"
    local task_arn=""

    log "Starting cold start measurement for: $agent"

    # Record start time with nanosecond precision
    START_TIME=$(date +%s.%N)

    # Run task
    task_arn=$(aws ecs run-task \
        --cluster "$CLUSTER" \
        --task-definition "$task_def" \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
        --profile "$PROFILE" \
        --region "$REGION" \
        --query 'tasks[0].taskArn' \
        --output text 2>/dev/null) || {
        log "  ERROR: Failed to start task for $agent"
        echo "-1"
        return
    }

    if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
        log "  ERROR: No task ARN returned for $agent"
        echo "-1"
        return
    fi

    log "  Task ARN: $task_arn"

    # Wait for RUNNING state (with timeout)
    log "  Waiting for RUNNING state..."
    if ! aws ecs wait tasks-running \
        --cluster "$CLUSTER" \
        --tasks "$task_arn" \
        --profile "$PROFILE" \
        --region "$REGION" 2>/dev/null; then
        log "  WARNING: Wait timed out or failed for $agent"
        cleanup_task "$task_arn"
        echo "-1"
        return
    fi

    # Record end time
    END_TIME=$(date +%s.%N)

    # Calculate duration
    DURATION=$(echo "$END_TIME - $START_TIME" | bc)

    log "  Cold Start Time: ${DURATION}s"

    # Cleanup
    cleanup_task "$task_arn"

    echo "$DURATION"
}

# Main execution
echo "=============================================="
echo "  Outpost v2 Cold Start Performance Test"
echo "=============================================="
echo ""
log "Cluster: $CLUSTER"
log "Region: $REGION"
log "Subnets: $SUBNETS"
log "Security Group: $SECURITY_GROUP"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Run tests for each agent
echo "----------------------------------------------"
echo "Running Cold Start Tests"
echo "----------------------------------------------"
echo ""

for agent in "${AGENTS[@]}"; do
    duration=$(measure_cold_start "$agent")
    RESULTS[$agent]=$duration
    echo ""
done

# Output summary
echo "=============================================="
echo "  Results Summary"
echo "=============================================="
echo ""

for agent in "${AGENTS[@]}"; do
    if [[ "${RESULTS[$agent]}" == "-1" ]]; then
        echo "  $agent: FAILED"
    else
        printf "  %-10s: %6.2fs\n" "$agent" "${RESULTS[$agent]}"
    fi
done

echo ""

# Generate JSON output
echo "Generating JSON results: $RESULTS_FILE"
cat > "$RESULTS_FILE" << EOF
{
  "test": "cold-start",
  "timestamp": "$(date -Iseconds)",
  "cluster": "$CLUSTER",
  "region": "$REGION",
  "results": {
EOF

first=true
for agent in "${AGENTS[@]}"; do
    if [[ "$first" == "true" ]]; then
        first=false
    else
        echo "," >> "$RESULTS_FILE"
    fi
    printf '    "%s": {"duration_seconds": %s, "status": "%s"}' \
        "$agent" \
        "${RESULTS[$agent]}" \
        "$([[ "${RESULTS[$agent]}" == "-1" ]] && echo "failed" || echo "success")" >> "$RESULTS_FILE"
done

cat >> "$RESULTS_FILE" << EOF

  }
}
EOF

echo ""
echo "=============================================="
echo "  Test Complete"
echo "=============================================="
echo "Results saved to: $RESULTS_FILE"
