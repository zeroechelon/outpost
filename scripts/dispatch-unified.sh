#!/bin/bash
# dispatch-unified.sh - Unified multi-agent dispatcher for Outpost v1.4
# WORKSPACE ISOLATION: Each agent gets its own repo copy - true parallelism
# v1.4: Security hardening, race condition fix, dynamic branch detection, timeout

REPO_NAME="${1:-}"
TASK="${2:-}"
EXECUTOR="${3:---executor=claude}"

if [[ "$EXECUTOR" == --executor=* ]]; then
    EXECUTORS="${EXECUTOR#--executor=}"
elif [[ "$3" == "--executor" ]]; then
    EXECUTORS="${4:-claude}"
else
    EXECUTORS="claude"
fi

if [[ -z "$REPO_NAME" || -z "$TASK" ]]; then
    echo "Usage: dispatch-unified.sh <repo-name> \"<task>\" --executor=<agent(s)>"
    echo ""
    echo "Executors: claude | codex | gemini | aider | all"
    echo "Multiple:  --executor=claude,codex"
    exit 1
fi

# C2 FIX: Require GITHUB_TOKEN from environment
if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "❌ FATAL: GITHUB_TOKEN environment variable not set"
    echo "   Set it in /home/ubuntu/.bashrc or via SSM environment"
    exit 1
fi

if [[ "$EXECUTORS" == "all" ]]; then
    EXECUTORS="claude,codex,gemini,aider"
fi

EXECUTOR_DIR="/home/ubuntu/claude-executor"
REPOS_DIR="$EXECUTOR_DIR/repos"
GITHUB_USER="rgsuarez"
BATCH_ID="$(date +%Y%m%d-%H%M%S)-batch-$(head /dev/urandom | tr -dc a-z0-9 | head -c 4)"

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 OUTPOST UNIFIED DISPATCH v1.4"
echo "═══════════════════════════════════════════════════════════════"
echo "Batch ID:   $BATCH_ID"
echo "Repo:       $REPO_NAME"
echo "Task:       $TASK"
echo "Executors:  $EXECUTORS"
echo "Isolation:  ENABLED (each agent gets own workspace)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

SOURCE_REPO="$REPOS_DIR/$REPO_NAME"
LOCKFILE="$EXECUTOR_DIR/.cache-lock-$REPO_NAME"

# H3 FIX: Use flock to prevent race conditions on cache updates
echo "📦 Pre-flight: Updating shared cache..."
(
    flock -w 30 200 || { echo "⚠️ Could not acquire cache lock, proceeding anyway"; }
    
    if [[ ! -d "$SOURCE_REPO" ]]; then
        echo "   Initial clone..."
        mkdir -p "$REPOS_DIR"
        git clone "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git" "$SOURCE_REPO" 2>&1
    fi
    
    cd "$SOURCE_REPO"
    echo "   Fetching latest..."
    git fetch origin 2>&1
    
    # C3 FIX: Detect default branch
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    if [[ -z "$DEFAULT_BRANCH" ]]; then
        DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
    fi
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
    
    git reset --hard "origin/$DEFAULT_BRANCH" 2>&1
    CACHE_SHA=$(git rev-parse HEAD)
    echo "   Cache ready: $CACHE_SHA"
    
) 200>"$LOCKFILE"

# Export so child dispatchers skip their own cache update
export OUTPOST_CACHE_READY=1
export GITHUB_TOKEN

# Count executors
IFS=',' read -ra EXEC_ARRAY <<< "$EXECUTORS"
EXEC_COUNT=${#EXEC_ARRAY[@]}

if [[ $EXEC_COUNT -gt 1 ]]; then
    echo ""
    echo "🔀 Parallel execution ($EXEC_COUNT agents, isolated workspaces)"
fi

# Dispatch to each executor
PIDS=()
for executor in "${EXEC_ARRAY[@]}"; do
    executor=$(echo "$executor" | xargs)  # trim whitespace
    echo ""
    echo "📤 Dispatching to $executor..."
    
    case "$executor" in
        claude)
            "$EXECUTOR_DIR/dispatch.sh" "$REPO_NAME" "$TASK" &
            PIDS+=($!)
            ;;
        codex)
            "$EXECUTOR_DIR/dispatch-codex.sh" "$REPO_NAME" "$TASK" &
            PIDS+=($!)
            ;;
        gemini)
            "$EXECUTOR_DIR/dispatch-gemini.sh" "$REPO_NAME" "$TASK" &
            PIDS+=($!)
            ;;
        aider)
            "$EXECUTOR_DIR/dispatch-aider.sh" "$REPO_NAME" "$TASK" &
            PIDS+=($!)
            ;;
        *)
            echo "⚠️ Unknown executor: $executor"
            ;;
    esac
done

# Wait for all if parallel
if [[ ${#PIDS[@]} -gt 0 ]]; then
    echo ""
    echo "⏳ Waiting for all agents..."
    for pid in "${PIDS[@]}"; do
        wait $pid
    done
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ UNIFIED DISPATCH COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "Batch: $BATCH_ID"
echo "Use 'list-runs.sh' to see results"
echo "Use 'promote-workspace.sh <run-id>' to push changes"
