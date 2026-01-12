#!/bin/bash
# =============================================================================
# Outpost v2 Container Entrypoint
# =============================================================================
# Configurable entrypoint for multi-agent execution containers
# Supports: claude, codex, gemini, aider, grok
# Version: 2.0.0
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration & Defaults
# -----------------------------------------------------------------------------
readonly OUTPOST_VERSION="2.0.0"
readonly WORKSPACE_DIR="/workspace"
readonly AGENTS_DIR="/opt/agents"
readonly OUTPUT_LOG="${WORKSPACE_DIR}/output.log"
readonly DEFAULT_TIMEOUT=600

# Environment variables (with defaults where applicable)
AGENT_TYPE="${AGENT_TYPE:-}"
MODEL_ID="${MODEL_ID:-}"
TASK="${TASK:-}"
REPO_URL="${REPO_URL:-}"
WORKSPACE_MODE="${WORKSPACE_MODE:-ephemeral}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-$DEFAULT_TIMEOUT}"
OUTPUT_BUCKET="${OUTPUT_BUCKET:-}"
DISPATCH_ID="${DISPATCH_ID:-$(date +%Y%m%d-%H%M%S)-$(head /dev/urandom | tr -dc a-z0-9 | head -c 8)}"
BRANCH="${BRANCH:-}"

# State tracking
CLEANUP_REQUIRED=false
CHILD_PID=""
EXIT_CODE=0

# -----------------------------------------------------------------------------
# Logging Functions
# -----------------------------------------------------------------------------
log() {
    local level="$1"
    shift
    echo "[$(date -Iseconds)] [$level] $*" | tee -a "${OUTPUT_LOG}" 2>/dev/null || echo "[$(date -Iseconds)] [$level] $*"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }
log_debug() { log "DEBUG" "$@"; }

# -----------------------------------------------------------------------------
# Validation Functions
# -----------------------------------------------------------------------------
validate_required_vars() {
    local missing=()

    [[ -z "$AGENT_TYPE" ]] && missing+=("AGENT_TYPE")
    [[ -z "$TASK" ]] && missing+=("TASK")

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required environment variables: ${missing[*]}"
        log_error "Required: AGENT_TYPE, TASK"
        log_error "Optional: MODEL_ID, REPO_URL, WORKSPACE_MODE, TIMEOUT_SECONDS, OUTPUT_BUCKET, DISPATCH_ID, BRANCH"
        return 1
    fi

    # Validate agent type
    case "$AGENT_TYPE" in
        claude|codex|gemini|aider|grok) ;;
        *)
            log_error "Invalid AGENT_TYPE: $AGENT_TYPE"
            log_error "Supported agents: claude, codex, gemini, aider, grok"
            return 1
            ;;
    esac

    # Validate workspace mode
    case "$WORKSPACE_MODE" in
        ephemeral|persistent) ;;
        *)
            log_error "Invalid WORKSPACE_MODE: $WORKSPACE_MODE"
            log_error "Supported modes: ephemeral, persistent"
            return 1
            ;;
    esac

    # Validate timeout
    if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 1 ]]; then
        log_error "Invalid TIMEOUT_SECONDS: $TIMEOUT_SECONDS (must be positive integer)"
        return 1
    fi

    return 0
}

# -----------------------------------------------------------------------------
# Signal Handlers
# -----------------------------------------------------------------------------
cleanup() {
    local signal="${1:-EXIT}"
    log_info "Cleanup triggered by signal: $signal"

    # Kill child process if running
    if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
        log_info "Terminating agent process (PID: $CHILD_PID)"
        kill -TERM "$CHILD_PID" 2>/dev/null || true

        # Wait briefly for graceful shutdown
        local wait_count=0
        while kill -0 "$CHILD_PID" 2>/dev/null && [[ $wait_count -lt 10 ]]; do
            sleep 1
            ((wait_count++))
        done

        # Force kill if still running
        if kill -0 "$CHILD_PID" 2>/dev/null; then
            log_warn "Force killing agent process"
            kill -9 "$CHILD_PID" 2>/dev/null || true
        fi
    fi

    # Upload results if bucket configured
    if [[ -n "$OUTPUT_BUCKET" ]] && [[ "$CLEANUP_REQUIRED" == "true" ]]; then
        upload_results
    fi

    log_info "Cleanup complete"
}

handle_sigterm() {
    log_warn "Received SIGTERM - initiating graceful shutdown"
    CLEANUP_REQUIRED=true
    EXIT_CODE=143
    cleanup "SIGTERM"
    exit $EXIT_CODE
}

handle_sigint() {
    log_warn "Received SIGINT - initiating graceful shutdown"
    CLEANUP_REQUIRED=true
    EXIT_CODE=130
    cleanup "SIGINT"
    exit $EXIT_CODE
}

# Register signal handlers
trap handle_sigterm SIGTERM
trap handle_sigint SIGINT
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Repository Functions
# -----------------------------------------------------------------------------
clone_repository() {
    if [[ -z "$REPO_URL" ]]; then
        log_info "No REPO_URL provided, skipping repository clone"
        return 0
    fi

    log_info "Cloning repository: $REPO_URL"

    # Determine target directory
    local clone_target="$WORKSPACE_DIR"

    # For persistent mode, check if already cloned
    if [[ "$WORKSPACE_MODE" == "persistent" ]] && [[ -d "$clone_target/.git" ]]; then
        log_info "Repository already exists in persistent workspace, updating..."
        cd "$clone_target"

        if ! git fetch origin 2>&1; then
            log_warn "Git fetch failed, continuing with existing state"
        fi

        if [[ -n "$BRANCH" ]]; then
            log_info "Checking out branch: $BRANCH"
            git checkout "$BRANCH" 2>&1 || git checkout -b "$BRANCH" "origin/$BRANCH" 2>&1 || {
                log_error "Failed to checkout branch: $BRANCH"
                return 1
            }
            git pull origin "$BRANCH" 2>&1 || log_warn "Pull failed, continuing with existing state"
        fi

        return 0
    fi

    # Fresh clone
    local clone_args=("--depth" "1")
    [[ -n "$BRANCH" ]] && clone_args+=("--branch" "$BRANCH")

    if ! git clone "${clone_args[@]}" "$REPO_URL" "$clone_target" 2>&1; then
        log_error "Git clone failed"
        return 1
    fi

    log_info "Repository cloned successfully"
    cd "$clone_target"

    # Configure git for agent commits
    git config user.name "Outpost Agent"
    git config user.email "agent@outpost.zeroechelon.com"
    git config --add safe.directory "$clone_target"

    return 0
}

# -----------------------------------------------------------------------------
# Agent Initialization
# -----------------------------------------------------------------------------
init_agent() {
    local init_script="${AGENTS_DIR}/${AGENT_TYPE}/init.sh"

    if [[ -f "$init_script" ]]; then
        log_info "Sourcing agent initialization script: $init_script"
        # shellcheck source=/dev/null
        source "$init_script"
    else
        log_debug "No agent-specific init script found at: $init_script"
    fi
}

# -----------------------------------------------------------------------------
# Agent Execution
# -----------------------------------------------------------------------------
get_agent_command() {
    case "$AGENT_TYPE" in
        claude)
            # Claude Code CLI
            local model="${MODEL_ID:-claude-opus-4-5-20251101}"
            echo "claude --print --model \"$model\" --dangerously-skip-permissions"
            ;;
        codex)
            # OpenAI Codex CLI
            echo "codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check"
            ;;
        gemini)
            # Gemini CLI
            echo "gemini --yolo"
            ;;
        aider)
            # Aider with configurable model
            local model="${MODEL_ID:-deepseek/deepseek-coder}"
            echo "aider --yes-always --no-auto-commits --model \"$model\" --message"
            ;;
        grok)
            # Grok via Python agent
            echo "python3 /opt/agents/grok/grok-agent.py"
            ;;
        *)
            log_error "Unknown agent type: $AGENT_TYPE"
            return 1
            ;;
    esac
}

execute_agent() {
    local agent_cmd
    agent_cmd=$(get_agent_command)

    if [[ -z "$agent_cmd" ]]; then
        log_error "Failed to determine agent command"
        return 1
    fi

    log_info "Executing agent: $AGENT_TYPE"
    log_info "Model: ${MODEL_ID:-default}"
    log_info "Timeout: ${TIMEOUT_SECONDS}s"
    log_info "Task: $TASK"

    # Record pre-execution state
    local before_sha="unknown"
    if [[ -d ".git" ]]; then
        before_sha=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
        log_info "Pre-execution SHA: $before_sha"
    fi

    # Build the full command based on agent type
    local full_cmd
    case "$AGENT_TYPE" in
        claude)
            full_cmd="$agent_cmd \"\$TASK\""
            ;;
        codex)
            full_cmd="$agent_cmd \"\$TASK\""
            ;;
        gemini)
            full_cmd="$agent_cmd \"\$TASK\""
            ;;
        aider)
            full_cmd="$agent_cmd \"\$TASK\""
            ;;
        grok)
            full_cmd="$agent_cmd --task \"\$TASK\" --workspace \"$WORKSPACE_DIR\""
            [[ -n "$MODEL_ID" ]] && full_cmd="$full_cmd --model \"$MODEL_ID\""
            ;;
    esac

    log_debug "Full command: $full_cmd"

    # Execute with timeout
    local start_time
    start_time=$(date +%s)

    # Run agent in background to capture PID for signal handling
    (
        eval "$full_cmd"
    ) &
    CHILD_PID=$!

    log_info "Agent started with PID: $CHILD_PID"

    # Wait with timeout
    local wait_result=0
    if ! timeout "$TIMEOUT_SECONDS" tail --pid=$CHILD_PID -f /dev/null 2>/dev/null; then
        # Timeout occurred
        log_warn "Agent timed out after ${TIMEOUT_SECONDS}s"
        kill -TERM "$CHILD_PID" 2>/dev/null || true
        sleep 2
        kill -9 "$CHILD_PID" 2>/dev/null || true
        wait_result=124
    else
        # Process completed, get exit code
        wait $CHILD_PID 2>/dev/null || wait_result=$?
    fi

    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    CHILD_PID=""
    EXIT_CODE=$wait_result

    # Determine status
    local status
    case $EXIT_CODE in
        0) status="success" ;;
        124) status="timeout" ;;
        *) status="failed" ;;
    esac

    log_info "Agent execution complete"
    log_info "Status: $status"
    log_info "Exit code: $EXIT_CODE"
    log_info "Duration: ${duration}s"

    # Record post-execution state
    local after_sha="$before_sha"
    local changes="none"
    if [[ -d ".git" ]]; then
        after_sha=$(git rev-parse HEAD 2>/dev/null || echo "$before_sha")

        if [[ "$before_sha" != "$after_sha" && "$before_sha" != "unknown" ]]; then
            changes="committed"
            git diff "$before_sha" "$after_sha" > "${WORKSPACE_DIR}/changes.patch" 2>/dev/null || true
        else
            git diff > "${WORKSPACE_DIR}/changes.patch" 2>/dev/null || true
            [[ -s "${WORKSPACE_DIR}/changes.patch" ]] && changes="uncommitted"
        fi

        log_info "Post-execution SHA: $after_sha"
        log_info "Changes: $changes"
    fi

    # Write summary
    cat > "${WORKSPACE_DIR}/summary.json" << EOF
{
  "dispatch_id": "$DISPATCH_ID",
  "agent_type": "$AGENT_TYPE",
  "model_id": "${MODEL_ID:-default}",
  "repo_url": "$REPO_URL",
  "workspace_mode": "$WORKSPACE_MODE",
  "status": "$status",
  "exit_code": $EXIT_CODE,
  "duration_seconds": $duration,
  "timeout_seconds": $TIMEOUT_SECONDS,
  "before_sha": "$before_sha",
  "after_sha": "$after_sha",
  "changes": "$changes",
  "started_at": "$(date -Iseconds -d "@$start_time")",
  "completed_at": "$(date -Iseconds -d "@$end_time")",
  "outpost_version": "$OUTPOST_VERSION"
}
EOF

    CLEANUP_REQUIRED=true
    return $EXIT_CODE
}

# -----------------------------------------------------------------------------
# Results Upload
# -----------------------------------------------------------------------------
upload_results() {
    if [[ -z "$OUTPUT_BUCKET" ]]; then
        log_debug "No OUTPUT_BUCKET configured, skipping upload"
        return 0
    fi

    log_info "Uploading results to S3: $OUTPUT_BUCKET"

    local s3_prefix="s3://${OUTPUT_BUCKET}/runs/${DISPATCH_ID}"

    # Upload output log
    if [[ -f "$OUTPUT_LOG" ]]; then
        if aws s3 cp "$OUTPUT_LOG" "${s3_prefix}/output.log" 2>&1; then
            log_info "Uploaded: output.log"
        else
            log_warn "Failed to upload output.log"
        fi
    fi

    # Upload summary
    if [[ -f "${WORKSPACE_DIR}/summary.json" ]]; then
        if aws s3 cp "${WORKSPACE_DIR}/summary.json" "${s3_prefix}/summary.json" 2>&1; then
            log_info "Uploaded: summary.json"
        else
            log_warn "Failed to upload summary.json"
        fi
    fi

    # Upload changes patch if exists
    if [[ -f "${WORKSPACE_DIR}/changes.patch" ]] && [[ -s "${WORKSPACE_DIR}/changes.patch" ]]; then
        if aws s3 cp "${WORKSPACE_DIR}/changes.patch" "${s3_prefix}/changes.patch" 2>&1; then
            log_info "Uploaded: changes.patch"
        else
            log_warn "Failed to upload changes.patch"
        fi
    fi

    log_info "Results upload complete"
    return 0
}

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------
main() {
    log_info "=========================================="
    log_info "Outpost v${OUTPOST_VERSION} Container Entrypoint"
    log_info "=========================================="
    log_info "Dispatch ID: $DISPATCH_ID"
    log_info "Agent Type: $AGENT_TYPE"
    log_info "Model ID: ${MODEL_ID:-default}"
    log_info "Workspace Mode: $WORKSPACE_MODE"
    log_info "Timeout: ${TIMEOUT_SECONDS}s"

    # Ensure workspace directory exists and is writable
    mkdir -p "$WORKSPACE_DIR"
    touch "$OUTPUT_LOG" 2>/dev/null || {
        log_error "Cannot write to workspace directory: $WORKSPACE_DIR"
        exit 1
    }

    # Validate configuration
    if ! validate_required_vars; then
        log_error "Configuration validation failed"
        exit 1
    fi

    # Clone repository if URL provided
    if ! clone_repository; then
        log_error "Repository clone failed"
        exit 1
    fi

    # Initialize agent-specific configuration
    init_agent

    # Change to workspace directory
    cd "$WORKSPACE_DIR"

    # Execute the agent
    if ! execute_agent; then
        log_error "Agent execution failed with exit code: $EXIT_CODE"
        # Exit code already set by execute_agent
    fi

    # Upload results (if not already done by cleanup handler)
    if [[ "$CLEANUP_REQUIRED" == "true" ]] && [[ -n "$OUTPUT_BUCKET" ]]; then
        upload_results
        CLEANUP_REQUIRED=false
    fi

    log_info "=========================================="
    log_info "Entrypoint complete - Exit code: $EXIT_CODE"
    log_info "=========================================="

    exit $EXIT_CODE
}

# Run main function
main "$@"
