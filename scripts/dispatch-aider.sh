#!/bin/bash
# dispatch-aider.sh - Aider dispatcher for Outpost
#
# Usage: dispatch-aider.sh <repo-name> "<task>"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPOST_DIR="${OUTPOST_DIR:-$(dirname "$SCRIPT_DIR")}"

# Load environment
[[ -f "$OUTPOST_DIR/.env" ]] && source "$OUTPOST_DIR/.env"

REPO_NAME="${1:-}"
TASK="${2:-}"

if [[ -z "$REPO_NAME" || -z "$TASK" ]]; then
    echo "Usage: dispatch-aider.sh <repo-name> \"<task>\""
    exit 1
fi

# Configuration
REPOS_DIR="$OUTPOST_DIR/repos"
RUNS_DIR="$OUTPOST_DIR/runs"
RUN_ID="$(date +%Y%m%d-%H%M%S)-aider-$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)"
RUN_DIR="$RUNS_DIR/$RUN_ID"
TIMEOUT="${AGENT_TIMEOUT:-600}"
MODEL="${AIDER_MODEL:-deepseek/deepseek-coder}"

echo "🚀 Aider dispatch starting..."
echo "Run ID: $RUN_ID"
echo "Model: $MODEL"
echo "Repo: $REPO_NAME"
echo "Task: ${TASK:0:80}..."
echo ""

# Create run directory
mkdir -p "$RUN_DIR"

# Write initial status
cat > "$RUN_DIR/summary.json" << EOF
{
  "run_id": "$RUN_ID",
  "repo": "$REPO_NAME",
  "executor": "aider",
  "model": "$MODEL",
  "started": "$(date -Iseconds)",
  "status": "running"
}
EOF

# Save task
echo "$TASK" > "$RUN_DIR/task.md"

# Create isolated workspace
SOURCE_REPO="$REPOS_DIR/$REPO_NAME"
WORKSPACE="$RUN_DIR/workspace"

if [[ -d "$SOURCE_REPO" ]]; then
    echo "📦 Creating isolated workspace..."
    cp -r "$SOURCE_REPO" "$WORKSPACE"
    cd "$WORKSPACE"
    BEFORE_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    echo "Workspace SHA: $BEFORE_SHA"
else
    echo "❌ Repository not found: $SOURCE_REPO"
    exit 1
fi

# Set API key for Aider
if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
    export DEEPSEEK_API_KEY
elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
    export OPENAI_API_KEY
    MODEL="${AIDER_MODEL:-gpt-4o}"
fi

# Run Aider
echo "🤖 Running Aider ($MODEL)..."
{
    timeout "$TIMEOUT" aider --model "$MODEL" --yes-always --no-git --message "$TASK" 2>&1 || {
        EXIT_CODE=$?
        if [[ $EXIT_CODE -eq 124 ]]; then
            echo "⚠️ Timeout after ${TIMEOUT}s"
        fi
        exit $EXIT_CODE
    }
} | tee "$RUN_DIR/output.log"

EXIT_CODE=${PIPESTATUS[0]}

# Check for changes
cd "$WORKSPACE"
AFTER_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

if [[ "$BEFORE_SHA" != "$AFTER_SHA" ]]; then
    CHANGES="committed"
    git diff "$BEFORE_SHA" "$AFTER_SHA" > "$RUN_DIR/diff.patch" 2>/dev/null || true
elif [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    CHANGES="uncommitted"
    git diff > "$RUN_DIR/diff.patch" 2>/dev/null || true
else
    CHANGES="none"
fi

# Update summary
cat > "$RUN_DIR/summary.json" << EOF
{
  "run_id": "$RUN_ID",
  "repo": "$REPO_NAME",
  "executor": "aider",
  "model": "$MODEL",
  "started": "$(date -Iseconds)",
  "completed": "$(date -Iseconds)",
  "status": "$([ $EXIT_CODE -eq 0 ] && echo 'success' || echo 'failed')",
  "exit_code": $EXIT_CODE,
  "before_sha": "$BEFORE_SHA",
  "after_sha": "$AFTER_SHA",
  "changes": "$CHANGES",
  "workspace": "$WORKSPACE"
}
EOF

echo ""
echo "✅ Aider dispatch complete"
echo "Run ID: $RUN_ID"
echo "Status: $([ $EXIT_CODE -eq 0 ] && echo 'success' || echo 'failed')"
echo "Changes: $CHANGES"
echo "Workspace: $WORKSPACE"
