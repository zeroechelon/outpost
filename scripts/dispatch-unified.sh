#!/bin/bash
# dispatch-unified.sh - Unified multi-agent dispatcher for Outpost v1.5
# 
# Usage: dispatch-unified.sh <repo-name> "<task>" [--executor=<agent(s)>] [--context=<level>]
#
# Agents: claude | codex | gemini | aider | all
# Context: off | minimal | standard | full | <number>

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPOST_DIR="${OUTPOST_DIR:-$(dirname "$SCRIPT_DIR")}"

# Load environment
if [[ -f "$OUTPOST_DIR/.env" ]]; then
    source "$OUTPOST_DIR/.env"
elif [[ -f "$SCRIPT_DIR/../.env" ]]; then
    source "$SCRIPT_DIR/../.env"
fi

# Validate required vars
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "❌ FATAL: GITHUB_TOKEN not set in .env"
    exit 1
fi

if [[ -z "${GITHUB_USER:-}" ]]; then
    echo "❌ FATAL: GITHUB_USER not set in .env"
    exit 1
fi

REPOS_DIR="$OUTPOST_DIR/repos"
RUNS_DIR="$OUTPOST_DIR/runs"
TIMEOUT="${AGENT_TIMEOUT:-600}"

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
    echo "Context Injection:"
    echo "  --context              Enable with standard level (1200 tokens)"
    echo "  --context=minimal      600 tokens (SOUL + JOURNAL)"
    echo "  --context=standard     1200 tokens (+ ANCHORS + PROFILE)"
    echo "  --context=full         1800 tokens (+ ROADMAP)"
    echo "  --context=<number>     Custom token budget (600-2000)"
    exit 1
fi

if [[ "$EXECUTORS" == "all" ]]; then
    EXECUTORS="claude,codex,gemini,aider"
fi

BATCH_ID="$(date +%Y%m%d-%H%M%S)-batch-$(head /dev/urandom | tr -dc a-z0-9 | head -c 4)"

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 OUTPOST UNIFIED DISPATCH v1.5"
echo "═══════════════════════════════════════════════════════════════"
echo "Batch ID:   $BATCH_ID"
echo "Repo:       $REPO_NAME"
echo "Task:       ${TASK:0:80}$([ ${#TASK} -gt 80 ] && echo '...')"
echo "Executors:  $EXECUTORS"
echo "Context:    $CONTEXT_LEVEL"
echo "Timeout:    ${TIMEOUT}s"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════
# PREPARE REPO CACHE
# ═══════════════════════════════════════════════════════════════════

mkdir -p "$REPOS_DIR" "$RUNS_DIR"
SOURCE_REPO="$REPOS_DIR/$REPO_NAME"
LOCKFILE="$OUTPOST_DIR/.cache-lock-$REPO_NAME"

echo "📦 Preparing repository cache..."
(
    flock -w 30 200 || { echo "⚠️ Could not acquire cache lock"; }
    
    if [[ ! -d "$SOURCE_REPO" ]]; then
        echo "   Cloning $REPO_NAME..."
        git clone "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git" "$SOURCE_REPO" 2>&1
    fi
    
    cd "$SOURCE_REPO"
    git fetch origin 2>&1
    
    # Detect default branch
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "")
    if [[ -z "$DEFAULT_BRANCH" ]]; then
        DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")
    fi
    
    git reset --hard "origin/$DEFAULT_BRANCH" 2>&1
    echo "   Cache ready: $(git rev-parse --short HEAD)"
    
) 200>"$LOCKFILE"

# ═══════════════════════════════════════════════════════════════════
# CONTEXT INJECTION
# ═══════════════════════════════════════════════════════════════════

ENHANCED_TASK="$TASK"
INJECTION_ID=""

if [[ "$CONTEXT_LEVEL" != "off" ]]; then
    echo ""
    echo "📋 Building context injection (level: $CONTEXT_LEVEL)..."
    
    CONTEXT_OUTPUT_DIR="$RUNS_DIR/$BATCH_ID-context"
    mkdir -p "$CONTEXT_OUTPUT_DIR"
    
    if [[ -f "$SCRIPT_DIR/assemble-context.sh" ]]; then
        INJECTION_ID=$("$SCRIPT_DIR/assemble-context.sh" "$REPO_NAME" "$CONTEXT_LEVEL" "$CONTEXT_OUTPUT_DIR" 2>/dev/null || echo "")
        
        if [[ -n "$INJECTION_ID" && -f "$CONTEXT_OUTPUT_DIR/context.md" ]]; then
            CONTEXT_CONTENT=$(cat "$CONTEXT_OUTPUT_DIR/context.md")
            CONTEXT_TOKENS=$(( ${#CONTEXT_CONTENT} / 4 ))
            
            ENHANCED_TASK="$CONTEXT_CONTENT

<task>
$TASK
</task>"
            
            echo "   ✅ Injection ID: $INJECTION_ID"
            echo "   Tokens: ~$CONTEXT_TOKENS"
        else
            echo "   ⚠️ Context assembly failed, proceeding without context"
        fi
    else
        echo "   ⚠️ assemble-context.sh not found, proceeding without context"
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# CHECK AVAILABLE AGENTS
# ═══════════════════════════════════════════════════════════════════

check_agent() {
    local agent="$1"
    case "$agent" in
        claude)
            [[ -n "${ANTHROPIC_API_KEY:-}" ]] || command -v claude &>/dev/null
            ;;
        codex)
            [[ -n "${OPENAI_API_KEY:-}" ]] && command -v codex &>/dev/null
            ;;
        gemini)
            [[ -n "${GOOGLE_API_KEY:-}" ]] && command -v gemini &>/dev/null
            ;;
        aider)
            [[ -n "${DEEPSEEK_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" ]] && command -v aider &>/dev/null
            ;;
        *)
            return 1
            ;;
    esac
}

# ═══════════════════════════════════════════════════════════════════
# DISPATCH TO AGENTS
# ═══════════════════════════════════════════════════════════════════

IFS=',' read -ra EXEC_ARRAY <<< "$EXECUTORS"
EXEC_COUNT=${#EXEC_ARRAY[@]}

if [[ $EXEC_COUNT -gt 1 ]]; then
    echo ""
    echo "🔀 Parallel execution ($EXEC_COUNT agents)"
fi

PIDS=()
DISPATCHED=()

for executor in "${EXEC_ARRAY[@]}"; do
    executor=$(echo "$executor" | xargs)
    echo ""
    
    if ! check_agent "$executor"; then
        echo "⚠️ Skipping $executor (not configured or CLI not found)"
        continue
    fi
    
    echo "📤 Dispatching to $executor..."
    
    case "$executor" in
        claude)
            "$SCRIPT_DIR/dispatch.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            DISPATCHED+=("claude")
            ;;
        codex)
            "$SCRIPT_DIR/dispatch-codex.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            DISPATCHED+=("codex")
            ;;
        gemini)
            "$SCRIPT_DIR/dispatch-gemini.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            DISPATCHED+=("gemini")
            ;;
        aider)
            "$SCRIPT_DIR/dispatch-aider.sh" "$REPO_NAME" "$ENHANCED_TASK" &
            PIDS+=($!)
            DISPATCHED+=("aider")
            ;;
    esac
done

if [[ ${#PIDS[@]} -eq 0 ]]; then
    echo ""
    echo "❌ No agents available. Check .env credentials and install CLIs."
    echo "   Run: ./scripts/setup-agents.sh"
    exit 1
fi

echo ""
echo "⏳ Waiting for ${#DISPATCHED[@]} agent(s): ${DISPATCHED[*]}"

for pid in "${PIDS[@]}"; do
    wait $pid 2>/dev/null || true
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ DISPATCH COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo "Batch:    $BATCH_ID"
echo "Agents:   ${DISPATCHED[*]}"
[[ -n "$INJECTION_ID" ]] && echo "Context:  $INJECTION_ID"
echo ""
echo "Results:  $RUNS_DIR/"
echo "Promote:  ./scripts/promote-workspace.sh <run-id> \"message\" --push"
