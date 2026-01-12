#!/bin/bash
# =============================================================================
# Outpost v2 Gemini Agent Entrypoint
# =============================================================================
# Container entrypoint that initializes the agent and executes commands.
# This script is run by tini as the init process.
# =============================================================================

set -euo pipefail

# Source the agent initialization script
source /opt/agents/gemini/init.sh

# Execute the command passed to the container
exec "$@"
