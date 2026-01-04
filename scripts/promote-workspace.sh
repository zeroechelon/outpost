#!/bin/bash
# promote-workspace.sh - Promote workspace changes to main repo and push
# C1 FIX: Works with v1.3+ workspace isolation
#
# Usage: ./promote-workspace.sh <run-id> [commit-message] [--push]
#
# Example: 
#   ./promote-workspace.sh 20260103-074707-l1ar16 "Add login feature" --push

RUN_ID=$1
MESSAGE=${2:-"Changes from Outpost run $RUN_ID"}
PUSH_FLAG=$3

RUNS_DIR="${OUTPOST_DIR:-/opt/outpost}/runs"
REPOS_DIR="${OUTPOST_DIR:-/opt/outpost}/repos"
RUN_DIR="$RUNS_DIR/$RUN_ID"

if [[ -z "$RUN_ID" ]]; then
    echo "Usage: promote-workspace.sh <run-id> [commit-message] [--push]"
    echo ""
    echo "Recent runs with changes:"
    for dir in $(ls -1t "$RUNS_DIR" 2>/dev/null | head -10); do
        if [[ -f "$RUNS_DIR/$dir/summary.json" ]]; then
            CHANGES=$(grep -o '"changes": *"[^"]*"' "$RUNS_DIR/$dir/summary.json" | cut -d'"' -f4)
            if [[ "$CHANGES" == "committed" || "$CHANGES" == "uncommitted" ]]; then
                REPO=$(grep -o '"repo": *"[^"]*"' "$RUNS_DIR/$dir/summary.json" | cut -d'"' -f4)
                echo "  $dir ($REPO) - $CHANGES"
            fi
        fi
    done
    exit 1
fi

if [[ ! -d "$RUN_DIR" ]]; then
    echo "❌ Run not found: $RUN_ID"
    exit 1
fi

if [[ ! -f "$RUN_DIR/summary.json" ]]; then
    echo "❌ No summary.json found for run $RUN_ID"
    exit 1
fi

# Parse summary
WORKSPACE=$(grep -o '"workspace": *"[^"]*"' "$RUN_DIR/summary.json" | cut -d'"' -f4)
REPO=$(grep -o '"repo": *"[^"]*"' "$RUN_DIR/summary.json" | cut -d'"' -f4)
CHANGES=$(grep -o '"changes": *"[^"]*"' "$RUN_DIR/summary.json" | cut -d'"' -f4)

if [[ -z "$WORKSPACE" || ! -d "$WORKSPACE" ]]; then
    echo "❌ Workspace not found: $WORKSPACE"
    exit 1
fi

if [[ "$CHANGES" == "none" ]]; then
    echo "ℹ️  No changes to promote in run $RUN_ID"
    exit 0
fi

REPO_DIR="$REPOS_DIR/$REPO"

echo "═══════════════════════════════════════════════════════════════"
echo "📤 PROMOTE WORKSPACE"
echo "═══════════════════════════════════════════════════════════════"
echo "Run ID:    $RUN_ID"
echo "Repo:      $REPO"
echo "Workspace: $WORKSPACE"
echo "Changes:   $CHANGES"
echo "Message:   $MESSAGE"
echo "═══════════════════════════════════════════════════════════════"

# Step 1: Copy changes from workspace to repo cache
echo ""
echo "📦 Syncing workspace → repo cache..."

if [[ "$CHANGES" == "committed" ]]; then
    # Agent already committed - we need to cherry-pick or reset
    cd "$WORKSPACE"
    AFTER_SHA=$(git rev-parse HEAD)
    BEFORE_SHA=$(grep -o '"before_sha": *"[^"]*"' "$RUN_DIR/summary.json" | cut -d'"' -f4)
    
    # Generate patch from the commits
    git format-patch "$BEFORE_SHA".."$AFTER_SHA" -o "$RUN_DIR/patches" 2>/dev/null
    
    cd "$REPO_DIR"
    git fetch origin 2>/dev/null
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
    git reset --hard "origin/$DEFAULT_BRANCH"
    
    # Apply patches
    if [[ -d "$RUN_DIR/patches" && "$(ls -A $RUN_DIR/patches 2>/dev/null)" ]]; then
        git am "$RUN_DIR/patches"/*.patch
    fi
else
    # Uncommitted changes - use diff.patch
    if [[ -s "$RUN_DIR/diff.patch" ]]; then
        cd "$REPO_DIR"
        git fetch origin 2>/dev/null
        DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
        DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
        git reset --hard "origin/$DEFAULT_BRANCH"
        
        # Apply the diff
        git apply "$RUN_DIR/diff.patch"
        git add -A
        git commit -m "$MESSAGE"
    else
        echo "❌ No diff.patch found"
        exit 1
    fi
fi

echo "✅ Changes applied to repo cache"

# Step 2: Push if requested
if [[ "$PUSH_FLAG" == "--push" ]]; then
    echo ""
    echo "🚀 Pushing to origin..."
    cd "$REPO_DIR"
    git push origin HEAD
    PUSH_RESULT=$?
    if [[ $PUSH_RESULT -eq 0 ]]; then
        echo "✅ Pushed successfully"
    else
        echo "❌ Push failed (exit code: $PUSH_RESULT)"
        exit $PUSH_RESULT
    fi
else
    echo ""
    echo "ℹ️  Changes staged in repo cache. Run with --push to push to origin."
    echo "   Or manually: cd $REPO_DIR && git push origin HEAD"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ PROMOTION COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
