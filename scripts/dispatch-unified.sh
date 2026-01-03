#!/bin/bash
# Source environment if available
[[ -f /home/ubuntu/claude-executor/.env ]] && source /home/ubuntu/claude-executor/.env
# dispatch-unified.sh - Unified multi-agent dispatcher for Outpost v1.5.0
# WORKSPACE ISOLATION: Each agent gets its own repo copy - true parallelism
# v1.5.0: Context injection support (--context flag)

# ═══════════════════════════════════════════════════════════════════
# ARGUMENT PARSING
# ═══════════════════════════════════════════════════════════════════
REPO_NAME="${1:-}"
TASK="${2:-}"
shift 2 2>/dev/null || true

# Defaults
EXECUTORS="claude"
CONTEXT_LEVEL="off"

# Parse remaining arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --executor=*)
            EXECUTORS="${1#--executor=}"
            shift
            ;;
        --executor)
            EXECUTORS="${2:-claude}"
            shift 2
            ;;
        --context=*)
            CONTEXT_LEVEL="${1#--context=}"
            shift
            ;;
        --context)
            # If next arg is a level, use it; otherwise default to standard
            if [[ "${2:-}" =~ ^(minimal|standard|full|[0-9]+)$ ]]; then
                CONTEXT_LEVEL="$2"
                shift 2
            else
                CONTEXT_LEVEL="standard"
                shift
            fi
            ;;
        *)
            echo "⚠️ Unknown argument: $1"
            shift
            ;;
    esac
done

if [[ -z "$REPO_NAME" || -z "$TASK" ]]; then
    echo "Usage: dispatch-unified.sh <repo-name> \"<task>\" [--executor=<agent(s)>] [--context=<level>]"
    echo ""
    echo "Executors: claude | codex | gemini | aider | all"
    echo "Multiple:  --executor=claude,codex"
    echo ""
    echo "Context Injection (v1.5.0):"
    echo "  --context              Enable with standard level (1200 tokens)"
    echo "  --context=minimal      600 tokens (SOUL + JOURNAL)"
    echo "  --context=standard     1200 tokens (+ ANCHORS + PROFILE)"
    echo "  --context=full         1800 tokens (+ ROADMAP)"
    echo "  --context=<number>     Custom token budget (600-2000)"
    exit 1
fi

if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "❌ FATAL: GITHUB_TOKEN environment variable not set"
    exit 1
fi

if [[ "$EXECUTORS" == "all" ]]; then
    EXECUTORS="claude,codex,gemini,aider"
fi

EXECUTOR_DIR="/home/ubuntu/claude-executor"
REPOS_DIR="$EXECUTOR_DIR/repos"
SCRIPTS_DIR="$EXECUTOR_DIR/scripts"
GITHUB_USER="rgsuarez"
BATCH_ID="$(date +%Y%m%d-%H%M%S)-batch-$(head /dev/urandom | tr -dc a-z0-9 | head -c 4)"

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 OUTPOST UNIFIED DISPATCH v1.5.0"
echo "═══════════════════════════════════════════════════════════════"
echo "Batch ID:   $BATCH_ID"
echo "Repo:       $REPO_NAME"
echo "Task:       ${TASK:0:100}$([ ${#TASK} -gt 100 ] && echo '...')"
echo "Executors:  $EXECUTORS"
echo "Context:    $CONTEXT_LEVEL"
echo "Isolation:  ENABLED (each agent gets own workspace)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════
# AUTO-SYNC DISPATCH SCRIPTS FROM GITHUB
# ═══════════════════════════════════════════════════════════════════
SCRIPTS_CACHE="$EXECUTOR_DIR/.scripts-sync"
SYNC_INTERVAL=300  # 5 minutes

sync_scripts() {
    echo "🔄 Syncing dispatch scripts from GitHub..."
    local SCRIPTS_URL="https://raw.githubusercontent.com/rgsuarez/outpost/main/scripts"
    
    # Sync main dispatch scripts
    for script in dispatch.sh dispatch-codex.sh dispatch-gemini.sh dispatch-aider.sh; do
        curl -sL "$SCRIPTS_URL/$script" -o "$EXECUTOR_DIR/$script.new" 2>/dev/null
        if [[ -s "$EXECUTOR_DIR/$script.new" ]]; then
            mv "$EXECUTOR_DIR/$script.new" "$EXECUTOR_DIR/$script"
            chmod +x "$EXECUTOR_DIR/$script"
        else
            rm -f "$EXECUTOR_DIR/$script.new"
        fi
    done
    
    # Sync unified dispatcher
    curl -sL "$SCRIPTS_URL/dispatch-unified.sh" -o "$EXECUTOR_DIR/dispatch-unified.sh.new" 2>/dev/null
    if [[ -s "$EXECUTOR_DIR/dispatch-unified.sh.new" ]]; then
        mv "$EXECUTOR_DIR/dispatch-unified.sh.new" "$EXECUTOR_DIR/dispatch-unified.sh"
        chmod +x "$EXECUTOR_DIR/dispatch-unified.sh"
    else
        rm -f "$EXECUTOR_DIR/dispatch-unified.sh.new"
    fi
    
    # Sync context injection scripts (v1.5.0)
    mkdir -p "$SCRIPTS_DIR"
    for script in assemble-context.sh scrub-secrets.sh; do
        curl -sL "$SCRIPTS_URL/$script" -o "$SCRIPTS_DIR/$script.new" 2>/dev/null
        if [[ -s "$SCRIPTS_DIR/$script.new" ]]; then
            mv "$SCRIPTS_DIR/$script.new" "$SCRIPTS_DIR/$script"
            chmod +x "$SCRIPTS_DIR/$script"
        else
            rm -f "$SCRIPTS_DIR/$script.new"
        fi
    done
    
    date +%s > "$SCRIPTS_CACHE"
    echo "   Scripts synced from GitHub"
}

# Check if sync needed (every 5 minutes)
if [[ -f "$SCRIPTS_CACHE" ]]; then
    LAST_SYNC=$(cat "$SCRIPTS_CACHE")
    NOW=$(date +%s)
    if (( NOW - LAST_SYNC > SYNC_INTERVAL )); then
        sync_scripts
    else
        echo "📦 Scripts current (synced $(( (NOW - LAST_SYNC) / 60 ))m ago)"
    fi
else
    sync_scripts
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# PRE-FLIGHT: UPDATE SHARED REPO CACHE
# ═══════════════════════════════════════════════════════════════════
SOURCE_REPO="$REPOS_DIR/$REPO_NAME"
LOCKFILE="$EXECUTOR_DIR/.cache-lock-$REPO_NAME"

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
    
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    if [[ -z "$DEFAULT_BRANCH" ]]; then
        DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
    fi
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
    
    git reset --hard "origin/$DEFAULT_BRANCH" 2>&1
    CACHE_SHA=$(git rev-parse HEAD)
    echo "   Cache ready: $CACHE_SHA"
    
) 200>"$LOCKFILE"

export OUTPOST_CACHE_READY=1
export GITHUB_TOKEN

# ═══════════════════════════════════════════════════════════════════
# CONTEXT INJECTION (v1.5.0)
# ═══════════════════════════════════════════════════════════════════
ENHANCED_TASK="$TASK"
INJECTION_ID=""

if [[ "$CONTEXT_LEVEL" != "off" ]]; then
    echo ""
    echo "📋 Building context injection (level: $CONTEXT_LEVEL)..."
    
    CONTEXT_OUTPUT_DIR="$EXECUTOR_DIR/runs/$BATCH_ID-context"
    mkdir -p "$CONTEXT_OUTPUT_DIR"
    
    if [[ -f "$SCRIPTS_DIR/assemble-context.sh" ]]; then
        INJECTION_ID=$("$SCRIPTS_DIR/assemble-context.sh" "$REPO_NAME" "$CONTEXT_LEVEL" "$CONTEXT_OUTPUT_DIR" 2>/dev/null || echo "")
        
        if [[ -n "$INJECTION_ID" && -f "$CONTEXT_OUTPUT_DIR/context.md" ]]; then
            CONTEXT_CONTENT=$(cat "$CONTEXT_OUTPUT_DIR/context.md")
            CONTEXT_TOKENS=$(( ${#CONTEXT_CONTENT} / 4 ))
            
            # Prepend context to task
            ENHANCED_TASK="$CONTEXT_CONTENT

<task>
$TASK
</task>"
            
            echo "   ✅ Injection ID: $INJECTION_ID"
            echo "   Tokens: ~$CONTEXT_TOKENS"
            
            # Show provenance if available
            if [[ -f "$CONTEXT_OUTPUT_DIR/context.json" ]]; then
                SECTIONS=$(python3 -c "import json; d=json.load(open('$CONTEXT_OUTPUT_DIR/context.json')); print(', '.join(d.get('sections',[])))" 2>/dev/null || echo "unknown")
                echo "   Sections: $SECTIONS"
            fi
        else
            echo "   ⚠️ Context assembly failed, proceeding without context"
        fi
    else
        echo "   ⚠️ assemble-context.sh not found, proceeding without context"
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# DISPATCH TO AGENTS
# ═══════════════════════════════════════════════════════════════════
IFS=',' read -ra EXEC_ARRAY <<< "$EXECUTORS"
EXEC_COUNT=${#EXEC_ARRAY[@]}

if [[ $EXEC_COUNT -gt 1 ]]; then
    echo ""
    echo "🔀 Parallel execution ($EXEC_COUNT agents, isolated workspaces)"
fi

PIDS=()
for executor in "${EXEC_ARRAY[@]}"; do
    executor=$(echo "$executor" | xargs)
    echo ""
    echo "📤 Dispatching to $executor..."
    
    case "$executor" in
        claude)
            "$EXECUTOR_DIR/dispatch.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            ;;
        codex)
            "$EXECUTOR_DIR/dispatch-codex.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            ;;
        gemini)
            "$EXECUTOR_DIR/dispatch-gemini.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            ;;
        aider)
            "$EXECUTOR_DIR/dispatch-aider.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            ;;
        *)
            echo "⚠️ Unknown executor: $executor"
            ;;
    esac
done

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
[[ -n "$INJECTION_ID" ]] && echo "Context: $INJECTION_ID"
echo "Use 'list-runs.sh' to see results"
echo "Use 'promote-workspace.sh <run-id>' to push changes"
