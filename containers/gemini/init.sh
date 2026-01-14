#!/bin/bash
# =============================================================================
# Outpost v2 Gemini Agent Initialization Script
# =============================================================================
# This script initializes the Gemini agent environment before task execution.
# It validates required credentials, sets defaults, and exports agent config.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------
AGENT_NAME="gemini"
AGENT_VERSION="2.0.0"
DEFAULT_MODEL="gemini-3-flash-preview"
SUPPORTED_MODELS=("gemini-3-flash-preview" "gemini-3-pro-preview" "gemini-3-flash")

# -----------------------------------------------------------------------------
# Logging Functions
# -----------------------------------------------------------------------------
log_info() {
    echo "[GEMINI-INIT] INFO: $*"
}

log_error() {
    echo "[GEMINI-INIT] ERROR: $*" >&2
}

log_warn() {
    echo "[GEMINI-INIT] WARN: $*"
}

# -----------------------------------------------------------------------------
# Validation Functions
# -----------------------------------------------------------------------------
validate_api_key() {
    if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
        log_error "GOOGLE_API_KEY environment variable is not set"
        log_error "Please provide your Google API key to authenticate with Gemini"
        return 1
    fi

    # Basic format validation (Google API keys typically start with "AI")
    if [[ "${GOOGLE_API_KEY}" =~ ^AI ]]; then
        log_info "GOOGLE_API_KEY format validated (AI* prefix detected)"
    else
        log_warn "GOOGLE_API_KEY may have non-standard format (expected AI* prefix)"
    fi

    # Gemini CLI expects GEMINI_API_KEY, not GOOGLE_API_KEY
    # Export alias to maintain compatibility
    export GEMINI_API_KEY="${GOOGLE_API_KEY}"
    log_info "GEMINI_API_KEY aliased to GOOGLE_API_KEY for CLI compatibility"

    return 0
}

validate_model() {
    local model="${MODEL_ID:-$DEFAULT_MODEL}"
    local valid=false

    for supported in "${SUPPORTED_MODELS[@]}"; do
        if [[ "$model" == "$supported" ]]; then
            valid=true
            break
        fi
    done

    if [[ "$valid" == "false" ]]; then
        log_warn "MODEL_ID '$model' not in supported list: ${SUPPORTED_MODELS[*]}"
        log_warn "Proceeding anyway - model may be valid but not pre-configured"
    fi

    return 0
}

# -----------------------------------------------------------------------------
# Configuration Functions
# -----------------------------------------------------------------------------
configure_model() {
    # Set default model if not provided
    if [[ -z "${MODEL_ID:-}" ]]; then
        export MODEL_ID="$DEFAULT_MODEL"
        log_info "MODEL_ID not set, using default: $MODEL_ID"
    else
        log_info "MODEL_ID configured: $MODEL_ID"
    fi
}

configure_yolo_mode() {
    # YOLO mode enables autonomous execution without confirmation prompts
    if [[ "${GEMINI_YOLO_MODE:-true}" == "true" ]]; then
        export GEMINI_YOLO_MODE=true
        log_info "YOLO mode enabled - autonomous execution active"
    else
        log_info "YOLO mode disabled - interactive confirmation required"
    fi
}

configure_non_interactive() {
    # Non-interactive mode for headless execution
    if [[ "${GEMINI_NON_INTERACTIVE:-true}" == "true" ]]; then
        export GEMINI_NON_INTERACTIVE=true
        export CI=true  # Many CLIs respect CI env var for non-interactive mode
        log_info "Non-interactive mode enabled"
    fi
}

export_agent_metadata() {
    # Export metadata for orchestrator consumption
    export OUTPOST_AGENT="$AGENT_NAME"
    export OUTPOST_AGENT_VERSION="$AGENT_VERSION"
    export OUTPOST_AGENT_READY="true"
    export OUTPOST_AGENT_MODELS="${SUPPORTED_MODELS[*]}"
}

configure_github_token() {
    # GitHub token configuration for private repository access
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        log_info "GITHUB_TOKEN detected - configuring git for private repo access"
        # Method 1: URL rewrite for SSH-style URLs
        git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "git@github.com:"
        # Method 2: Credential store for HTTPS URLs
        echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
        git config --global credential.helper store
        log_info "Git configured for authenticated GitHub access"
    fi
}

# -----------------------------------------------------------------------------
# Main Initialization
# -----------------------------------------------------------------------------
main() {
    log_info "=========================================="
    log_info "Initializing Gemini Agent v${AGENT_VERSION}"
    log_info "=========================================="

    # Step 1: Validate API key
    log_info "Step 1/4: Validating API credentials..."
    if ! validate_api_key; then
        log_error "API key validation failed - aborting initialization"
        exit 1
    fi

    # Step 2: Configure model
    log_info "Step 2/4: Configuring model selection..."
    configure_model
    validate_model

    # Step 3: Configure execution modes
    log_info "Step 3/4: Configuring execution modes..."
    configure_yolo_mode
    configure_non_interactive

    # Step 4: Export agent metadata
    log_info "Step 4/5: Exporting agent metadata..."
    export_agent_metadata

    # Step 5: Configure GitHub token (if available)
    log_info "Step 5/5: Configuring GitHub access..."
    configure_github_token

    # Verification
    log_info "=========================================="
    log_info "Gemini Agent Ready"
    log_info "  Agent:    $AGENT_NAME"
    log_info "  Version:  $AGENT_VERSION"
    log_info "  Model:    $MODEL_ID"
    log_info "  YOLO:     ${GEMINI_YOLO_MODE:-false}"
    log_info "  Workspace: ${WORKSPACE_DIR:-/workspace}"
    log_info "=========================================="

    # -------------------------------------------------------------------------
    # Task Execution (if TASK env var is set)
    # -------------------------------------------------------------------------
    # When running in ECS, the TASK environment variable contains the task
    if [[ -n "${TASK:-}" ]]; then
        log_info "TASK environment variable detected (${#TASK} chars)"
        log_info "Executing task via Gemini CLI..."

        # Change to workspace directory
        cd "${WORKSPACE_DIR:-/workspace}"

        # Execute Gemini with task in yolo mode (autonomous, no prompts)
        # Gemini CLI requires --prompt flag for task input
        exec gemini --yolo --prompt "${TASK}"
    fi

    return 0
}

# Run initialization if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
