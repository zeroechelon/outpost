#!/bin/bash
# dispatch-unified.sh - Unified multi-agent dispatcher for Outpost v1.3
# WORKSPACE ISOLATION: Each agent gets its own repo copy - true parallelism

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
    echo "Multiple: --executor=claude,gemini,aider"
    echo ""
    echo "v1.3: Workspace isolation - true parallel execution"
    exit 1
fi

EXECUTOR_DIR="/home/ubuntu/claude-executor"
REPOS_DIR="$EXECUTOR_DIR/repos"
GITHUB_USER="rgsuarez"
GITHUB_TOKEN="${GITHUB_TOKEN:-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}"

BATCH_ID="$(date +%Y%m%d-%H%M%S)-batch-$(head /dev/urandom | tr -dc a-z0-9 | head -c 4)"

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 OUTPOST UNIFIED DISPATCH v1.3"
echo "═══════════════════════════════════════════════════════════════"
echo "Batch ID:   $BATCH_ID"
echo "Repo:       $REPO_NAME"
echo "Task:       $TASK"
echo "Executors:  $EXECUTORS"
echo "Isolation:  ENABLED (each agent gets own workspace)"
echo "═══════════════════════════════════════════════════════════════"

[[ "$EXECUTORS" == "all" ]] && EXECUTORS="claude,codex,gemini,aider"

# === PRE-FLIGHT: Update shared cache ONCE ===
SOURCE_REPO="$REPOS_DIR/$REPO_NAME"
echo ""
echo "📦 Pre-flight: Updating shared cache..."

if [[ ! -d "$SOURCE_REPO" ]]; then
    echo "   Cloning from GitHub..."
    mkdir -p "$REPOS_DIR"
    git clone "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git" "$SOURCE_REPO" 2>&1 || {
        echo "❌ Failed to clone repo - aborting"
        exit 1
    }
else
    echo "   Fetching latest..."
    (cd "$SOURCE_REPO" && git fetch origin && git reset --hard origin/main) 2>&1 || echo "   ⚠️ Fetch failed - using existing"
fi
echo "   Cache ready: $(cd "$SOURCE_REPO" && git rev-parse --short HEAD)"

# Export flag so individual dispatchers skip cache update
export OUTPOST_CACHE_READY=1

declare -a PIDS
declare -a AGENTS

dispatch_agent() {
    local agent=$1
    local script=""
    
    case $agent in
        claude) script="dispatch.sh" ;;
        codex)  script="dispatch-codex.sh" ;;
        gemini) script="dispatch-gemini.sh" ;;
        aider)  script="dispatch-aider.sh" ;;
        *)
            echo "❌ Unknown executor: $agent"
            return 1
            ;;
    esac
    
    echo "📤 Dispatching to $agent..."
    "$EXECUTOR_DIR/$script" "$REPO_NAME" "$TASK" 2>&1 || echo "⚠️ $agent returned non-zero"
}

IFS=',' read -ra AGENT_ARRAY <<< "$EXECUTORS"

if [[ ${#AGENT_ARRAY[@]} -eq 1 ]]; then
    dispatch_agent "${AGENT_ARRAY[0]}"
else
    echo ""
    echo "🔀 Parallel execution (${#AGENT_ARRAY[@]} agents, isolated workspaces)"
    echo ""
    
    for agent in "${AGENT_ARRAY[@]}"; do
        dispatch_agent "$agent" &
        PIDS+=($!)
        AGENTS+=("$agent")
    done
    
    echo ""
    echo "⏳ Waiting for all agents..."
    
    FAILED=0
    for i in "${!PIDS[@]}"; do
        wait "${PIDS[$i]}" && echo "✅ ${AGENTS[$i]} completed" || { echo "❌ ${AGENTS[$i]} failed"; FAILED=$((FAILED + 1)); }
    done
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "📊 BATCH COMPLETE: $BATCH_ID"
    echo "═══════════════════════════════════════════════════════════════"
    echo "Agents: ${#AGENT_ARRAY[@]} | Succeeded: $((${#AGENT_ARRAY[@]} - FAILED)) | Failed: $FAILED"
    echo "═══════════════════════════════════════════════════════════════"
fi
