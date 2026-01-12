#!/usr/bin/env bash
# =============================================================================
# Outpost v2 Claude Agent Entrypoint
# =============================================================================
# Wrapper entrypoint that initializes the agent before executing the command
# Supports both interactive and headless (--print) execution modes
# =============================================================================

set -euo pipefail

# Source the initialization script
source /opt/agents/claude/init.sh

# -----------------------------------------------------------------------------
# Task Execution
# -----------------------------------------------------------------------------

# If TASK environment variable is set, execute it with Claude Code
if [[ -n "${TASK:-}" ]]; then
    echo "[CLAUDE-ENTRYPOINT] Executing task via Claude Code..."
    echo "[CLAUDE-ENTRYPOINT] Task: ${TASK}"

    # Build claude command with appropriate flags
    CLAUDE_CMD="claude"

    # Add model flag if MODEL_ID is set
    if [[ -n "${MODEL_ID:-}" ]]; then
        CLAUDE_CMD="${CLAUDE_CMD} --model ${MODEL_ID}"
    fi

    # Add print flag for headless execution (captures output)
    if [[ "${CLAUDE_CODE_PRINT_MODE:-1}" == "1" ]]; then
        CLAUDE_CMD="${CLAUDE_CMD} --print"
    fi

    # Add dangerously-skip-permissions flag for automated execution
    CLAUDE_CMD="${CLAUDE_CMD} --dangerously-skip-permissions"

    # Execute with the task
    echo "[CLAUDE-ENTRYPOINT] Running: ${CLAUDE_CMD} \"<task>\""
    exec ${CLAUDE_CMD} "${TASK}"
fi

# If no TASK, execute whatever command was passed
if [[ $# -gt 0 ]]; then
    echo "[CLAUDE-ENTRYPOINT] Executing command: $*"
    exec "$@"
fi

# Default: start an interactive bash shell
echo "[CLAUDE-ENTRYPOINT] No task or command provided. Starting interactive shell."
exec bash
