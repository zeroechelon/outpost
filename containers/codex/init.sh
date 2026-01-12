#!/bin/bash
# =============================================================================
# Outpost v2 Codex Agent Initialization Script
# =============================================================================
# Initializes the OpenAI Codex environment with proper configuration
# Sources this script before executing agent commands
# =============================================================================

set -e

# -----------------------------------------------------------------------------
# Color Output Functions
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[CODEX]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[CODEX]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[CODEX]${NC} $1"
}

log_error() {
    echo -e "${RED}[CODEX]${NC} $1"
}

# -----------------------------------------------------------------------------
# API Key Validation
# -----------------------------------------------------------------------------
if [ -z "${OPENAI_API_KEY}" ]; then
    log_error "OPENAI_API_KEY is not set!"
    log_error "Export OPENAI_API_KEY environment variable before running Codex agent."
    log_error "Example: export OPENAI_API_KEY='sk-...'"
    exit 1
fi

# Validate API key format (basic check)
if [[ ! "${OPENAI_API_KEY}" =~ ^sk- ]]; then
    log_warn "OPENAI_API_KEY does not start with 'sk-' - verify it's a valid OpenAI API key"
fi

log_info "OPENAI_API_KEY validated"

# -----------------------------------------------------------------------------
# Model Configuration
# -----------------------------------------------------------------------------
# Set default model if not provided
if [ -z "${MODEL_ID}" ]; then
    export MODEL_ID="${CODEX_DEFAULT_MODEL:-gpt-5.2-codex}"
    log_info "MODEL_ID not set, using default: ${MODEL_ID}"
else
    log_info "MODEL_ID configured: ${MODEL_ID}"
fi

# Validate model is in supported list
SUPPORTED_MODELS="gpt-5.2-codex gpt-4o-codex"
if [[ ! " ${SUPPORTED_MODELS} " =~ " ${MODEL_ID} " ]]; then
    log_warn "MODEL_ID '${MODEL_ID}' not in standard list (${SUPPORTED_MODELS})"
    log_warn "Proceeding anyway - OpenAI may support additional models"
fi

# Export model for Codex CLI
export CODEX_MODEL="${MODEL_ID}"

# -----------------------------------------------------------------------------
# Codex-Specific Environment Variables
# -----------------------------------------------------------------------------
# Data directory for Codex state
export CODEX_DATA_DIR="${CODEX_DATA_DIR:-/home/outpost/.codex}"
mkdir -p "${CODEX_DATA_DIR}"

# Workspace configuration
export CODEX_WORKSPACE="${CODEX_WORKSPACE:-/workspace}"

# Sandbox configuration
export CODEX_SANDBOX_MODE="${CODEX_SANDBOX_MODE:-enabled}"
export CODEX_SANDBOX_NETWORK="${CODEX_SANDBOX_NETWORK:-restricted}"

# Yolo mode configuration (autonomous execution)
if [ "${CODEX_YOLO_MODE}" = "true" ] || [ "${CODEX_YOLO}" = "true" ]; then
    export CODEX_YOLO_FLAGS="--yolo"
    log_warn "YOLO MODE ENABLED - Codex will execute commands without confirmation"
else
    export CODEX_YOLO_FLAGS=""
    log_info "Standard mode - Codex will prompt for confirmation"
fi

# -----------------------------------------------------------------------------
# Git Configuration for Agent Commits
# -----------------------------------------------------------------------------
if [ -z "${GIT_AUTHOR_EMAIL}" ]; then
    export GIT_AUTHOR_EMAIL="codex-agent@outpost.zeroechelon.com"
fi
if [ -z "${GIT_COMMITTER_EMAIL}" ]; then
    export GIT_COMMITTER_EMAIL="codex-agent@outpost.zeroechelon.com"
fi

# Override agent name for commits
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Outpost Codex Agent}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Outpost Codex Agent}"

# -----------------------------------------------------------------------------
# Telemetry Configuration
# -----------------------------------------------------------------------------
# Disable telemetry in production environments unless explicitly enabled
if [ "${CODEX_TELEMETRY}" != "true" ]; then
    export CODEX_DISABLE_TELEMETRY=1
fi

# -----------------------------------------------------------------------------
# Output Configuration Summary
# -----------------------------------------------------------------------------
log_success "========================================"
log_success "  OUTPOST CODEX AGENT READY"
log_success "========================================"
log_info "Agent: codex"
log_info "Provider: OpenAI"
log_info "Model: ${MODEL_ID}"
log_info "Workspace: ${CODEX_WORKSPACE}"
log_info "Sandbox: ${CODEX_SANDBOX_MODE} (network: ${CODEX_SANDBOX_NETWORK})"
if [ -n "${CODEX_YOLO_FLAGS}" ]; then
    log_warn "Yolo Mode: ENABLED"
else
    log_info "Yolo Mode: disabled"
fi
log_success "========================================"
