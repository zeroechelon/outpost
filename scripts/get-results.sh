#!/bin/bash
# get-results.sh - Retrieve results from an Outpost run
#
# Usage: ./get-results.sh <run-id> [component]
# Components: summary (default), output, diff, task, all
#
# Example: ./get-results.sh 20260102-205023-cs429e all

RUN_ID=$1
COMPONENT=${2:-summary}
RUN_DIR="/home/ubuntu/claude-executor/runs/$RUN_ID"

if [ ! -d "$RUN_DIR" ]; then
    echo "ERROR: Run $RUN_ID not found"
    echo "Available runs:"
    ls -1 /home/ubuntu/claude-executor/runs/ 2>/dev/null | tail -10
    exit 1
fi

case $COMPONENT in
    summary)
        cat "$RUN_DIR/summary.json"
        ;;
    output)
        cat "$RUN_DIR/output.log"
        ;;
    diff)
        if [ -f "$RUN_DIR/diff.patch" ]; then
            cat "$RUN_DIR/diff.patch"
        else
            echo "No changes in this run"
        fi
        ;;
    task)
        cat "$RUN_DIR/task.md"
        ;;
    all)
        echo "=== TASK ==="
        cat "$RUN_DIR/task.md"
        echo -e "\n=== SUMMARY ==="
        cat "$RUN_DIR/summary.json"
        echo -e "\n=== OUTPUT (last 100 lines) ==="
        tail -100 "$RUN_DIR/output.log"
        echo -e "\n=== DIFF ==="
        if [ -f "$RUN_DIR/diff.patch" ]; then
            cat "$RUN_DIR/diff.patch"
        else
            echo "No changes"
        fi
        ;;
    *)
        echo "Unknown component: $COMPONENT"
        echo "Usage: ./get-results.sh <run-id> [summary|output|diff|task|all]"
        exit 1
        ;;
esac
