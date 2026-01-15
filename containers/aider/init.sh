#!/bin/bash
# =============================================================================
# Outpost v2 Aider Agent Initialization Script
# =============================================================================
# This script runs before every Aider task execution to:
# - Validate required environment variables
# - Configure git identity for commits
# - Set up Aider-specific environment
# - Export runtime configuration
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration Defaults
# -----------------------------------------------------------------------------
DEFAULT_MODEL="deepseek/deepseek-coder"
AGENT_NAME="Aider Agent (Outpost)"
AGENT_EMAIL="aider@outpost.zeroechelon.com"

# -----------------------------------------------------------------------------
# Validate Required Environment Variables
# -----------------------------------------------------------------------------
if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
    echo "[FATAL] DEEPSEEK_API_KEY environment variable is not set"
    echo "[FATAL] Aider requires a valid DeepSeek API key to function"
    echo "[FATAL] Set DEEPSEEK_API_KEY in your container runtime configuration"
    exit 1
fi

# Validate API key format (basic sanity check - should start with sk-)
if [[ ! "${DEEPSEEK_API_KEY}" =~ ^sk- ]]; then
    echo "[WARN] DEEPSEEK_API_KEY does not appear to be in expected format (should start with 'sk-')"
    echo "[WARN] Proceeding anyway, but authentication may fail"
fi

# -----------------------------------------------------------------------------
# Set Default Model if Not Provided
# -----------------------------------------------------------------------------
export MODEL_ID="${MODEL_ID:-${AIDER_MODEL:-$DEFAULT_MODEL}}"

# Validate model selection
case "$MODEL_ID" in
    deepseek/deepseek-coder|deepseek/deepseek-chat)
        echo "[INFO] Using model: $MODEL_ID"
        ;;
    deepseek/*)
        echo "[WARN] Non-standard DeepSeek model: $MODEL_ID"
        echo "[WARN] Supported models: deepseek/deepseek-coder, deepseek/deepseek-chat"
        ;;
    *)
        echo "[WARN] Model '$MODEL_ID' may not be compatible with DeepSeek API"
        ;;
esac

# -----------------------------------------------------------------------------
# Configure Git Identity for Aider Commits
# -----------------------------------------------------------------------------
# Set global git config for this container session
git config --global user.name "${GIT_AUTHOR_NAME:-$AGENT_NAME}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-$AGENT_EMAIL}"

# Also set committer identity
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$AGENT_NAME}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$AGENT_EMAIL}"

# Configure git to allow operations in mounted workspace
git config --global --add safe.directory /workspace
git config --global --add safe.directory '*'

# Set default branch name for new repos
git config --global init.defaultBranch main

# GitHub token configuration for private repository access
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "[INFO] GITHUB_TOKEN detected - configuring git for private repo access"
    # Method 1: URL rewrite for SSH-style URLs
    git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "git@github.com:"
    # Method 2: Credential store for HTTPS URLs
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
    git config --global credential.helper store
    echo "[INFO] Git configured for authenticated GitHub access"
fi

echo "[INFO] Git configured: ${GIT_AUTHOR_NAME:-$AGENT_NAME} <${GIT_AUTHOR_EMAIL:-$AGENT_EMAIL}>"

# -----------------------------------------------------------------------------
# Export Aider-Specific Environment Variables
# -----------------------------------------------------------------------------
# Set the model for Aider
export AIDER_MODEL="$MODEL_ID"

# Enable autonomous mode (no interactive prompts)
export AIDER_YES="${AIDER_YES:-true}"

# Enable auto-commits for changes
export AIDER_AUTO_COMMITS="${AIDER_AUTO_COMMITS:-true}"

# Disable shell command suggestions (security)
export AIDER_NO_SUGGEST_SHELL_COMMANDS="${AIDER_NO_SUGGEST_SHELL_COMMANDS:-true}"

# Show diffs in output (useful for logging)
export AIDER_NO_SHOW_DIFFS="${AIDER_NO_SHOW_DIFFS:-false}"

# Disable analytics/telemetry
export AIDER_NO_ANALYTICS="${AIDER_NO_ANALYTICS:-true}"

# Set workspace as git root
export AIDER_GIT_ROOT="${AIDER_GIT_ROOT:-/workspace}"

# -----------------------------------------------------------------------------
# Workspace Validation
# -----------------------------------------------------------------------------
if [[ -d /workspace ]]; then
    cd /workspace

    # Check if workspace is a git repository
    if [[ -d .git ]] || git rev-parse --git-dir > /dev/null 2>&1; then
        echo "[INFO] Workspace is a git repository"
        BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
        COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        echo "[INFO] Current branch: $BRANCH (commit: $COMMIT)"
    else
        echo "[WARN] Workspace is not a git repository"
        echo "[WARN] Aider works best with git-tracked projects"
    fi
else
    echo "[WARN] /workspace directory does not exist"
fi

# -----------------------------------------------------------------------------
# Print Agent Ready Message
# -----------------------------------------------------------------------------
echo "=============================================="
echo " Outpost v2 Aider Agent Ready"
echo "=============================================="
echo " Agent:    aider"
echo " Model:    $MODEL_ID"
echo " Provider: DeepSeek"
echo " Version:  $(aider --version 2>/dev/null | head -1 || echo 'unknown')"
echo " Mode:     Autonomous (--yes-always)"
echo "=============================================="
echo ""

# -----------------------------------------------------------------------------
# Task Execution (if TASK env var is set)
# -----------------------------------------------------------------------------
# When running in ECS, the TASK environment variable contains the task
# If TASK is set, execute Aider with the task and exit
if [ -n "${TASK:-}" ]; then
    echo "[AIDER] TASK environment variable detected (${#TASK} chars)"
    echo "[AIDER] Executing task via Aider CLI..."

    # Change to workspace directory
    cd "${AIDER_GIT_ROOT:-/workspace}"

    # Execute Aider with task in autonomous mode
    # --message: send task, process reply, exit (disables chat mode)
    # --yes-always: auto-confirm all prompts
    # --auto-commits: auto-commit generated changes
    # --no-check-update: skip version check for faster startup
    exec aider \
        --message "$TASK" \
        --yes-always \
        --auto-commits \
        --no-check-update \
        --no-stream
fi
