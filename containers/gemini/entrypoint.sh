#!/bin/bash
# =============================================================================
# Outpost v2 Gemini Agent Entrypoint
# =============================================================================
# Container entrypoint that initializes the agent and executes commands.
# This script is run by tini as the init process.
# =============================================================================

set -euo pipefail

# Source the agent initialization script and run main()
# main() handles environment validation, configuration, and TASK execution
source /opt/agents/gemini/init.sh
main

# If main() returns (no TASK set), execute the default command
exec "$@"
