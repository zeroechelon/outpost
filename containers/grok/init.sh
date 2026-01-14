#!/bin/bash
# =============================================================================
# Outpost v2 Grok Agent Initialization Script
# =============================================================================
# Validates environment and prepares Grok agent for execution
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Environment Validation
# -----------------------------------------------------------------------------

# Verify XAI_API_KEY is set (required)
if [[ -z "${XAI_API_KEY:-}" ]]; then
    echo "FATAL: XAI_API_KEY environment variable is not set"
    echo "Please provide your xAI API key via the XAI_API_KEY environment variable"
    exit 1
fi

# Validate API key format (should start with xai-)
if [[ ! "${XAI_API_KEY}" =~ ^xai- ]]; then
    echo "WARNING: XAI_API_KEY does not match expected format (xai-...)"
    echo "Proceeding anyway, but verify your API key if authentication fails"
fi

# -----------------------------------------------------------------------------
# Model Configuration
# -----------------------------------------------------------------------------

# Set default model if not provided
export MODEL_ID="${MODEL_ID:-${GROK_DEFAULT_MODEL:-grok-4-1-fast-reasoning}}"

# Validate model selection
case "${MODEL_ID}" in
    grok-4-1-fast-reasoning|grok-4-fast-reasoning)
        echo "Model: ${MODEL_ID} (valid)"
        ;;
    grok-3|grok-3-mini|grok-2*)
        echo "Model: ${MODEL_ID} (legacy, may have reduced capabilities)"
        ;;
    *)
        echo "WARNING: Unknown model '${MODEL_ID}', defaulting to grok-4-1-fast-reasoning"
        export MODEL_ID="grok-4-1-fast-reasoning"
        ;;
esac

# -----------------------------------------------------------------------------
# Export Grok-specific Environment Variables
# -----------------------------------------------------------------------------

# API endpoint (can be overridden for testing)
export XAI_API_ENDPOINT="${XAI_API_ENDPOINT:-https://api.x.ai/v1}"

# Response configuration
export GROK_MAX_TOKENS="${GROK_MAX_TOKENS:-8192}"
export GROK_TEMPERATURE="${GROK_TEMPERATURE:-0.7}"
export GROK_STREAM="${GROK_STREAM:-true}"

# Timeout configuration (seconds)
export GROK_TIMEOUT="${GROK_TIMEOUT:-300}"

# -----------------------------------------------------------------------------
# Agent Ready
# -----------------------------------------------------------------------------

echo "=============================================="
echo "Grok Agent Ready"
echo "=============================================="
echo "Agent:     grok"
echo "Provider:  xAI"
echo "Model:     ${MODEL_ID}"
echo "Endpoint:  ${XAI_API_ENDPOINT}"
echo "Streaming: ${GROK_STREAM}"
echo "Timeout:   ${GROK_TIMEOUT}s"
echo "=============================================="

# Execute the command passed to the container
exec "$@"
