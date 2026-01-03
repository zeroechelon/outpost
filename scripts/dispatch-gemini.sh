#!/bin/bash
# dispatch-gemini.sh - Headless Gemini CLI executor for Outpost v1.4
# WORKSPACE ISOLATION: Each run gets its own repo copy
# v1.4: Security hardening, dynamic branch detection, timeout protection

REPO_NAME="${1:-}"
TASK="${2:-}"

if [[ -z "$REPO_NAME" || -z "$TASK" ]]; then
    echo "Usage: dispatch-gemini.sh <repo-name> \"<task>\""
    exit 1
fi

if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "❌ FATAL: GITHUB_TOKEN environment variable not set"
    exit 1
fi

EXECUTOR_DIR="/home/ubuntu/claude-executor"
REPOS_DIR="$EXECUTOR_DIR/repos"
RUNS_DIR="$EXECUTOR_DIR/runs"
GITHUB_USER="rgsuarez"
AGENT_TIMEOUT="${AGENT_TIMEOUT:-600}"

RUN_ID="$(date +%Y%m%d-%H%M%S)-gemini-$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)"
RUN_DIR="$RUNS_DIR/$RUN_ID"
WORKSPACE="$RUN_DIR/workspace"

echo "🚀 Gemini CLI dispatch starting..."
echo "Run ID: $RUN_ID"
echo "Model: gemini-3-pro-preview"
echo "Repo: $REPO_NAME"
echo "Task: $TASK"

mkdir -p "$RUN_DIR"
echo "$TASK" > "$RUN_DIR/task.md"

cat > "$RUN_DIR/summary.json" << SUMMARY
{"run_id":"$RUN_ID","repo":"$REPO_NAME","executor":"gemini","model":"gemini-3-pro-preview","started":"$(date -Iseconds)","status":"running"}
SUMMARY

exec > >(tee -a "$RUN_DIR/output.log") 2>&1

SOURCE_REPO="$REPOS_DIR/$REPO_NAME"

if [[ -z "$OUTPOST_CACHE_READY" ]]; then
    if [[ ! -d "$SOURCE_REPO" ]]; then
        echo "📦 Initial clone from GitHub..."
        mkdir -p "$REPOS_DIR"
        if ! git clone "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git" "$SOURCE_REPO" 2>&1; then
            echo "❌ Git clone failed"
            cat > "$RUN_DIR/summary.json" << SUMMARY
{"run_id":"$RUN_ID","repo":"$REPO_NAME","executor":"gemini","status":"failed","error":"git clone failed"}
SUMMARY
            exit 1
        fi
    fi
    echo "📦 Updating cache..."
    cd "$SOURCE_REPO"
    git fetch origin 2>&1
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
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

echo "🤖 Running Gemini CLI (gemini-3-pro-preview)..."
export HOME=/home/ubuntu

timeout "$AGENT_TIMEOUT" gemini --yolo "$TASK" 2>&1
EXIT_CODE=$?

[[ $EXIT_CODE -eq 124 ]] && STATUS="timeout" || { [[ $EXIT_CODE -eq 0 ]] && STATUS="success" || STATUS="failed"; }

AFTER_SHA=$(git rev-parse HEAD 2>/dev/null || echo "$BEFORE_SHA")
if [[ "$BEFORE_SHA" != "$AFTER_SHA" && "$BEFORE_SHA" != "unknown" ]]; then
    git diff "$BEFORE_SHA" "$AFTER_SHA" > "$RUN_DIR/diff.patch" 2>/dev/null
    CHANGES="committed"
else
    git diff > "$RUN_DIR/diff.patch" 2>/dev/null
    [[ -s "$RUN_DIR/diff.patch" ]] && CHANGES="uncommitted" || CHANGES="none"
fi

cat > "$RUN_DIR/summary.json" << SUMMARY
{"run_id":"$RUN_ID","repo":"$REPO_NAME","executor":"gemini","model":"gemini-3-pro-preview","completed":"$(date -Iseconds)","status":"$STATUS","exit_code":$EXIT_CODE,"before_sha":"$BEFORE_SHA","after_sha":"$AFTER_SHA","changes":"$CHANGES","workspace":"$WORKSPACE"}
SUMMARY

echo ""
echo "✅ Gemini CLI dispatch complete"
echo "Run ID: $RUN_ID"
echo "Status: $STATUS"
echo "Changes: $CHANGES"
echo "Workspace: $WORKSPACE"
