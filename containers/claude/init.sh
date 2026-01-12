#!/usr/bin/env bash
# =============================================================================
# Outpost v2 Claude Agent Initialization Script
# =============================================================================
# Validates environment, configures agent settings, and prepares for execution
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Color output helpers
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[CLAUDE-INIT]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[CLAUDE-INIT]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[CLAUDE-INIT]${NC} WARNING: $1"
}

log_error() {
    echo -e "${RED}[CLAUDE-INIT]${NC} ERROR: $1" >&2
}

# -----------------------------------------------------------------------------
# Environment Validation
# -----------------------------------------------------------------------------

log_info "Initializing Claude Code agent..."

# Verify ANTHROPIC_API_KEY is set (required)
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    log_error "ANTHROPIC_API_KEY environment variable is not set!"
    log_error "This is required for Claude Code to function."
    log_error "Set it when running the container: -e ANTHROPIC_API_KEY=sk-ant-..."
    exit 1
fi

# Validate API key format (basic check)
if [[ ! "${ANTHROPIC_API_KEY}" =~ ^sk-ant- ]]; then
    log_warn "ANTHROPIC_API_KEY does not match expected format (sk-ant-...)"
    log_warn "Proceeding anyway, but verify the key is correct."
fi

log_success "ANTHROPIC_API_KEY is configured"

# -----------------------------------------------------------------------------
# Model Configuration
# -----------------------------------------------------------------------------

# Supported models
SUPPORTED_MODELS=(
    "claude-opus-4-5-20251101"
    "claude-sonnet-4-5-20250929"
    "claude-haiku-4-5-20250801"
)

# Set default MODEL_ID if not provided
if [[ -z "${MODEL_ID:-}" ]]; then
    export MODEL_ID="claude-sonnet-4-5-20250929"
    log_info "MODEL_ID not set, defaulting to: ${MODEL_ID}"
else
    log_info "MODEL_ID set to: ${MODEL_ID}"
fi

# Validate MODEL_ID is supported
model_valid=false
for model in "${SUPPORTED_MODELS[@]}"; do
    if [[ "${MODEL_ID}" == "${model}" ]]; then
        model_valid=true
        break
    fi
done

if [[ "${model_valid}" != "true" ]]; then
    log_warn "MODEL_ID '${MODEL_ID}' is not in the standard supported list."
    log_warn "Supported models: ${SUPPORTED_MODELS[*]}"
    log_warn "Proceeding anyway (custom model may be valid)."
fi

# Export model for Claude Code CLI
export CLAUDE_MODEL="${MODEL_ID}"

# -----------------------------------------------------------------------------
# Context Level Configuration
# -----------------------------------------------------------------------------

# Set context level defaults
CONTEXT_LEVEL="${CONTEXT_LEVEL:-standard}"
log_info "Context injection level: ${CONTEXT_LEVEL}"

case "${CONTEXT_LEVEL}" in
    minimal)
        export CLAUDE_CODE_MAX_CONTEXT=4096
        ;;
    standard)
        export CLAUDE_CODE_MAX_CONTEXT=16384
        ;;
    full)
        export CLAUDE_CODE_MAX_CONTEXT=65536
        ;;
    *)
        log_warn "Unknown CONTEXT_LEVEL '${CONTEXT_LEVEL}', using standard"
        export CLAUDE_CODE_MAX_CONTEXT=16384
        ;;
esac

# -----------------------------------------------------------------------------
# Claude Code Specific Environment
# -----------------------------------------------------------------------------

# Headless/print mode settings (for non-interactive execution)
export CLAUDE_CODE_HEADLESS="${CLAUDE_CODE_HEADLESS:-1}"
export CLAUDE_CODE_NO_INTERACTIVE="${CLAUDE_CODE_NO_INTERACTIVE:-1}"
export CLAUDE_CODE_PRINT_MODE="${CLAUDE_CODE_PRINT_MODE:-1}"

# Git configuration for agent commits (if not already set)
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Outpost Claude Agent}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-claude@outpost.zeroechelon.com}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Outpost Claude Agent}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-claude@outpost.zeroechelon.com}"

# Workspace configuration
export WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"

# Ensure workspace directory exists and is writable
if [[ ! -d "${WORKSPACE_DIR}" ]]; then
    log_error "Workspace directory ${WORKSPACE_DIR} does not exist!"
    exit 1
fi

if [[ ! -w "${WORKSPACE_DIR}" ]]; then
    log_error "Workspace directory ${WORKSPACE_DIR} is not writable!"
    exit 1
fi

# -----------------------------------------------------------------------------
# CLI Verification
# -----------------------------------------------------------------------------

# Verify Claude Code CLI is installed and accessible
if ! command -v claude &> /dev/null; then
    log_error "Claude Code CLI (claude) is not installed or not in PATH!"
    log_error "PATH=${PATH}"
    exit 1
fi

CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
log_info "Claude Code CLI version: ${CLAUDE_VERSION}"

# -----------------------------------------------------------------------------
# Ready Message
# -----------------------------------------------------------------------------

log_success "========================================"
log_success "Claude Code Agent Ready"
log_success "========================================"
log_success "Agent:    claude"
log_success "Provider: anthropic"
log_success "Model:    ${MODEL_ID}"
log_success "Context:  ${CONTEXT_LEVEL}"
log_success "Workspace: ${WORKSPACE_DIR}"
log_success "========================================"

# Export initialization complete flag
export CLAUDE_AGENT_INITIALIZED=1
