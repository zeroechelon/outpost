#!/bin/bash
# Cold Start Performance Analysis Script for Outpost v2 Agents
# Runs multiple iterations and calculates statistics
# AWS Profile: soc, Region: us-east-1
# Blueprint Task: T8.3

set -e

# Configuration
CLUSTER="outpost-dev"
PROFILE="soc"
REGION="us-east-1"
AGENTS=("claude" "codex" "gemini" "aider" "grok")
ITERATIONS=${1:-3}  # Default 3 iterations, can be overridden via argument

# Network configuration (from AWS infrastructure)
SUBNETS="subnet-0fbe5255f2651080a,subnet-033d5d44c24b00dcf"
SECURITY_GROUP="sg-02d1679b75fe8390c"

# Output configuration
RESULTS_DIR="/home/richie/projects/outpost/tests/performance/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ANALYSIS_FILE="${RESULTS_DIR}/cold-start-analysis-${TIMESTAMP}.json"

# Declare arrays to store results
declare -A ALL_RESULTS

# Functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

cleanup_task() {
    local task_arn=$1
    if [[ -n "$task_arn" && "$task_arn" != "None" ]]; then
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

    START_TIME=$(date +%s.%N)

    task_arn=$(aws ecs run-task \
        --cluster "$CLUSTER" \
        --task-definition "$task_def" \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
        --profile "$PROFILE" \
        --region "$REGION" \
        --query 'tasks[0].taskArn' \
        --output text 2>/dev/null) || {
        echo "-1"
        return
    }

    if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
        echo "-1"
        return
    fi

    if ! aws ecs wait tasks-running \
        --cluster "$CLUSTER" \
        --tasks "$task_arn" \
        --profile "$PROFILE" \
        --region "$REGION" 2>/dev/null; then
        cleanup_task "$task_arn"
        echo "-1"
        return
    fi

    END_TIME=$(date +%s.%N)
    DURATION=$(echo "$END_TIME - $START_TIME" | bc)

    cleanup_task "$task_arn"
    echo "$DURATION"
}

calculate_stats() {
    local values=("$@")
    local count=${#values[@]}

    if [[ $count -eq 0 ]]; then
        echo "0 0 0 0"
        return
    fi

    # Filter out failed results (-1)
    local valid_values=()
    for v in "${values[@]}"; do
        if [[ "$v" != "-1" ]]; then
            valid_values+=("$v")
        fi
    done

    local valid_count=${#valid_values[@]}
    if [[ $valid_count -eq 0 ]]; then
        echo "0 0 0 0"
        return
    fi

    # Calculate sum
    local sum=0
    for v in "${valid_values[@]}"; do
        sum=$(echo "$sum + $v" | bc)
    done

    # Calculate average
    local avg=$(echo "scale=3; $sum / $valid_count" | bc)

    # Find min and max
    local min=${valid_values[0]}
    local max=${valid_values[0]}
    for v in "${valid_values[@]}"; do
        if (( $(echo "$v < $min" | bc -l) )); then
            min=$v
        fi
        if (( $(echo "$v > $max" | bc -l) )); then
            max=$v
        fi
    done

    echo "$avg $min $max $valid_count"
}

# Main execution
echo "=============================================="
echo "  Outpost v2 Cold Start Analysis"
echo "=============================================="
echo ""
log "Cluster: $CLUSTER"
log "Region: $REGION"
log "Iterations: $ITERATIONS"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Initialize result storage
for agent in "${AGENTS[@]}"; do
    ALL_RESULTS[$agent]=""
done

# Run iterations
for ((i=1; i<=ITERATIONS; i++)); do
    echo "----------------------------------------------"
    log "Iteration $i of $ITERATIONS"
    echo "----------------------------------------------"

    for agent in "${AGENTS[@]}"; do
        log "  Testing: $agent"
        duration=$(measure_cold_start "$agent")

        if [[ "$duration" == "-1" ]]; then
            log "    FAILED"
        else
            log "    Duration: ${duration}s"
        fi

        # Append to results
        if [[ -z "${ALL_RESULTS[$agent]}" ]]; then
            ALL_RESULTS[$agent]="$duration"
        else
            ALL_RESULTS[$agent]="${ALL_RESULTS[$agent]} $duration"
        fi

        # Small delay between tasks to avoid rate limiting
        sleep 2
    done

    # Delay between iterations
    if [[ $i -lt $ITERATIONS ]]; then
        log "Waiting 10 seconds before next iteration..."
        sleep 10
    fi
done

# Calculate and display statistics
echo ""
echo "=============================================="
echo "  Analysis Results"
echo "=============================================="
echo ""
printf "%-10s | %8s | %8s | %8s | %s\n" "Agent" "Avg (s)" "Min (s)" "Max (s)" "Success"
echo "-------------------------------------------------------"

# Start JSON output
cat > "$ANALYSIS_FILE" << EOF
{
  "test": "cold-start-analysis",
  "timestamp": "$(date -Iseconds)",
  "cluster": "$CLUSTER",
  "region": "$REGION",
  "iterations": $ITERATIONS,
  "agents": {
EOF

first=true
for agent in "${AGENTS[@]}"; do
    # Parse results into array
    IFS=' ' read -ra durations <<< "${ALL_RESULTS[$agent]}"

    # Calculate statistics
    stats=$(calculate_stats "${durations[@]}")
    read -r avg min max success_count <<< "$stats"

    # Display
    printf "%-10s | %8.2f | %8.2f | %8.2f | %d/%d\n" \
        "$agent" "$avg" "$min" "$max" "$success_count" "$ITERATIONS"

    # JSON output
    if [[ "$first" == "true" ]]; then
        first=false
    else
        echo "," >> "$ANALYSIS_FILE"
    fi

    # Build raw results array for JSON
    raw_json="["
    first_raw=true
    for d in "${durations[@]}"; do
        if [[ "$first_raw" == "true" ]]; then
            first_raw=false
        else
            raw_json+=", "
        fi
        raw_json+="$d"
    done
    raw_json+="]"

    cat >> "$ANALYSIS_FILE" << EOF
    "$agent": {
      "average_seconds": $avg,
      "min_seconds": $min,
      "max_seconds": $max,
      "success_count": $success_count,
      "total_iterations": $ITERATIONS,
      "raw_results": $raw_json
    }
EOF
done

# Close JSON
cat >> "$ANALYSIS_FILE" << EOF

  }
}
EOF

echo ""
echo "=============================================="
echo "  Analysis Complete"
echo "=============================================="
echo "Results saved to: $ANALYSIS_FILE"
echo ""

# Display JSON content
echo "JSON Output:"
echo "----------------------------------------------"
cat "$ANALYSIS_FILE"
