#!/bin/bash
# list-runs.sh - List recent Outpost runs
#
# Usage: ./list-runs.sh [count]
# Default: Shows last 10 runs

COUNT=${1:-10}
RUNS_DIR="${OUTPOST_DIR:-/opt/outpost}/runs"

echo "=== Recent Outpost Runs (last $COUNT) ==="
echo ""

for dir in $(ls -1t "$RUNS_DIR" 2>/dev/null | head -$COUNT); do
    if [ -f "$RUNS_DIR/$dir/summary.json" ]; then
        SUMMARY=$(cat "$RUNS_DIR/$dir/summary.json")
        REPO=$(echo "$SUMMARY" | grep -o '"repo": *"[^"]*"' | cut -d'"' -f4)
        STATUS=$(echo "$SUMMARY" | grep -o '"status": *"[^"]*"' | cut -d'"' -f4)
        CHANGES=$(echo "$SUMMARY" | grep -o '"changes": *"[^"]*"' | cut -d'"' -f4)
        
        # Status indicator
        if [ "$STATUS" = "success" ]; then
            ICON="✓"
        elif [ "$STATUS" = "running" ]; then
            ICON="⟳"
        else
            ICON="✗"
        fi
        
        printf "%s  %-28s  %-25s  %s  %s\n" "$ICON" "$dir" "$REPO" "$STATUS" "$CHANGES"
    fi
done

echo ""
echo "Use: ./get-results.sh <run-id> all"
