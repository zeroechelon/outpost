#!/bin/bash
# dispatch.sh - Headless Claude Code executor for Outpost v1.4
# WORKSPACE ISOLATION: Each run gets its own repo copy
# v1.4: Security hardening, dynamic branch detection, timeout protection

REPO_NAME="${1:-}"
TASK="${2:-}"

if [[ -z "$REPO_NAME" || -z "$TASK" ]]; then
    echo "Usage: dispatch.sh <repo-name> \"<task>\""
    exit 1
fi

# C2 FIX: Require GITHUB_TOKEN from environment, fail fast if missing
if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "❌ FATAL: GITHUB_TOKEN environment variable not set"
    echo "   Set it in /home/ubuntu/.bashrc or pass via SSM"
    exit 1
fi

EXECUTOR_DIR="/home/ubuntu/claude-executor"
REPOS_DIR="$EXECUTOR_DIR/repos"
RUNS_DIR="$EXECUTOR_DIR/runs"
GITHUB_USER="rgsuarez"
AGENT_TIMEOUT="${AGENT_TIMEOUT:-600}"  # H1 FIX: 10 minute default timeout

RUN_ID="$(date +%Y%m%d-%H%M%S)-$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)"
RUN_DIR="$RUNS_DIR/$RUN_ID"
WORKSPACE="$RUN_DIR/workspace"

echo "🚀 Claude Code dispatch starting..."
echo "Run ID: $RUN_ID"
echo "Model: claude-opus-4-5-20251101"
echo "Repo: $REPO_NAME"
echo "Task: $TASK"

mkdir -p "$RUN_DIR"
echo "$TASK" > "$RUN_DIR/task.md"

# H4 FIX: Write running status immediately
cat > "$RUN_DIR/summary.json" << SUMMARY
{
  "run_id": "$RUN_ID",
  "repo": "$REPO_NAME",
  "executor": "claude-code",
  "model": "claude-opus-4-5-20251101",
  "started": "$(date -Iseconds)",
  "status": "running"
}
SUMMARY

exec > >(tee -a "$RUN_DIR/output.log") 2>&1

SOURCE_REPO="$REPOS_DIR/$REPO_NAME"

# Only update cache if not already done by unified dispatcher
if [[ -z "$OUTPOST_CACHE_READY" ]]; then
    if [[ ! -d "$SOURCE_REPO" ]]; then
        echo "📦 Initial clone from GitHub..."
        mkdir -p "$REPOS_DIR"
        if ! git clone "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git" "$SOURCE_REPO" 2>&1; then
            echo "❌ Git clone failed"
            cat > "$RUN_DIR/summary.json" << SUMMARY
{"run_id":"$RUN_ID","repo":"$REPO_NAME","executor":"claude-code","status":"failed","error":"git clone failed"}
SUMMARY
            exit 1
        fi
    fi
    
    echo "📦 Updating cache..."
    cd "$SOURCE_REPO"
    git fetch origin 2>&1
    
    # C3 FIX: Detect default branch instead of hardcoding main
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    if [[ -z "$DEFAULT_BRANCH" ]]; then
        # Fallback: try to detect from remote
        DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
    fi
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"  # Ultimate fallback
    
    git reset --hard "origin/$DEFAULT_BRANCH" 2>&1 || echo "⚠️ Cache update failed"
else
    echo "📦 Using pre-warmed cache"
fi

echo "📂 Creating isolated workspace..."
mkdir -p "$WORKSPACE"
rsync -a --delete "$SOURCE_REPO/" "$WORKSPACE/"

cd "$WORKSPACE"
BEFORE_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Workspace SHA: $BEFORE_SHA"

echo "🤖 Running Claude Code (Opus 4.5)..."
export HOME=/home/ubuntu

# H1 FIX: Wrap in timeout
timeout "$AGENT_TIMEOUT" claude --print "$TASK" 2>&1
EXIT_CODE=$?

# Check for timeout
if [[ $EXIT_CODE -eq 124 ]]; then
    echo "⚠️ Agent timed out after ${AGENT_TIMEOUT}s"
    STATUS="timeout"
else
    [[ $EXIT_CODE -eq 0 ]] && STATUS="success" || STATUS="failed"
fi

AFTER_SHA=$(git rev-parse HEAD 2>/dev/null || echo "$BEFORE_SHA")
if [[ "$BEFORE_SHA" != "$AFTER_SHA" && "$BEFORE_SHA" != "unknown" ]]; then
    git diff "$BEFORE_SHA" "$AFTER_SHA" > "$RUN_DIR/diff.patch" 2>/dev/null
    CHANGES="committed"
else
    git diff > "$RUN_DIR/diff.patch" 2>/dev/null
    [[ -s "$RUN_DIR/diff.patch" ]] && CHANGES="uncommitted" || CHANGES="none"
fi

cat > "$RUN_DIR/summary.json" << SUMMARY
{
  "run_id": "$RUN_ID",
  "repo": "$REPO_NAME",
  "executor": "claude-code",
  "model": "claude-opus-4-5-20251101",
  "completed": "$(date -Iseconds)",
  "status": "$STATUS",
  "exit_code": $EXIT_CODE,
  "before_sha": "$BEFORE_SHA",
  "after_sha": "$AFTER_SHA",
  "changes": "$CHANGES",
  "workspace": "$WORKSPACE"
}
SUMMARY

echo ""
echo "✅ Claude Code dispatch complete"
echo "Run ID: $RUN_ID"
echo "Status: $STATUS"
echo "Changes: $CHANGES"
echo "Workspace: $WORKSPACE"
