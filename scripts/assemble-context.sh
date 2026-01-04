#!/bin/bash
# assemble-context.sh - Build context injection payload
# Version: 1.0
# Part of Outpost Context Injection System
#
# Usage: assemble-context.sh <repo> [level] [output_dir]
# Levels: minimal (600), standard (1200), full (1800), or custom number

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTOR_DIR="${SCRIPT_DIR}/.."

# Arguments
REPO="${1:-}"
LEVEL="${2:-standard}"
OUTPUT_DIR="${3:-/tmp}"

if [[ -z "$REPO" ]]; then
    echo "Usage: assemble-context.sh <repo> [level] [output_dir]" >&2
    echo "Levels: minimal | standard | full | <number>" >&2
    exit 1
fi

# Generate injection ID
INJECTION_ID="INJ-$(date +%Y%m%d)-$(date +%H%M%S)-$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)"

# Determine token budget
case "$LEVEL" in
    minimal)  MAX_TOKENS=600 ;;
    standard) MAX_TOKENS=1200 ;;
    full)     MAX_TOKENS=1800 ;;
    off)      
        echo ""
        exit 0
        ;;
    [0-9]*)   MAX_TOKENS=$LEVEL ;;
    *)        
        echo "Unknown level: $LEVEL" >&2
        exit 1
        ;;
esac

# Hard cap
[[ $MAX_TOKENS -gt 2000 ]] && MAX_TOKENS=2000

# Token estimation (conservative: chars/4)
count_tokens() {
    local text="$1"
    echo $(( ${#text} / 4 ))
}

# Summarize deterministically: first N + last M tokens
summarize_deterministic() {
    local content="$1"
    local first_chars=$(( ${2:-150} * 4 ))
    local last_chars=$(( ${3:-100} * 4 ))
    
    local len=${#content}
    if [[ $len -le $((first_chars + last_chars + 50)) ]]; then
        echo "$content"
        return
    fi
    
    echo "${content:0:$first_chars}"
    echo ""
    echo "...[summarized for token budget]..."
    echo ""
    echo "${content: -$last_chars}"
}

# Initialize provenance tracking
declare -A PROVENANCE
declare -A TOKEN_COUNTS

# ============================================
# SOUL Section (Required - Never Dropped)
# ============================================
SOUL=""
SOUL_SOURCE=""

# Try to find SOUL file
SOUL_PATHS=(
    "$EXECUTOR_DIR/repos/$REPO/docs/${REPO^^}_SOUL.md"
    "$EXECUTOR_DIR/repos/$REPO/docs/SOUL.md"
    "$EXECUTOR_DIR/repos/$REPO/${REPO^^}_SOUL.md"
    "$EXECUTOR_DIR/repos/$REPO/README.md"
)

for path in "${SOUL_PATHS[@]}"; do
    if [[ -f "$path" ]]; then
        # Extract key info from SOUL
        SOUL_RAW=$(cat "$path" | head -50)
        SOUL="Project: $REPO
$(echo "$SOUL_RAW" | grep -E '^(Purpose|Type|Identity|Constraints|Directives):' | head -10 || echo "Purpose: See project documentation")"
        SOUL_SOURCE="$path"
        break
    fi
done

# Fallback SOUL if none found
if [[ -z "$SOUL" ]]; then
    SOUL="Project: $REPO
Type: unknown
Purpose: [SOUL file not found - using minimal identity]"
    SOUL_SOURCE="[generated]"
fi

PROVENANCE["soul"]="$SOUL_SOURCE"
TOKEN_COUNTS["soul"]=$(count_tokens "$SOUL")

# ============================================
# ANCHORS Section (Standard+ - Never Summarized)
# ============================================
ANCHORS=""
ANCHORS_SOURCE=""

if [[ "$LEVEL" != "minimal" ]]; then
    ANCHORS_PATH="$EXECUTOR_DIR/repos/$REPO/docs/ANCHORS.md"
    if [[ -f "$ANCHORS_PATH" ]]; then
        ANCHORS=$(cat "$ANCHORS_PATH" | head -30)
        ANCHORS_SOURCE="$ANCHORS_PATH"
    else
        # Try to extract from SOUL
        if [[ -n "$SOUL_SOURCE" && "$SOUL_SOURCE" != "[generated]" ]]; then
            ANCHORS=$(grep -A 5 -E '^(Non-Negotiables|Decisions|Constraints):' "$SOUL_SOURCE" 2>/dev/null | head -10 || echo "")
            ANCHORS_SOURCE="[extracted from SOUL]"
        fi
    fi
fi

PROVENANCE["anchors"]="$ANCHORS_SOURCE"
TOKEN_COUNTS["anchors"]=$(count_tokens "$ANCHORS")

# ============================================
# PROFILE Section (Standard+)
# ============================================
PROFILE=""
PROFILE_SOURCE=""

if [[ "$LEVEL" != "minimal" ]]; then
    # Hardcoded profile for now (would fetch from zeOS in production)
    PROFILE="Operator: Richie Suarez
Style: Direct, military precision, BLUF

Standards:
- GitOps discipline mandatory
- Systems over tasks
- Production-grade code"
    PROFILE_SOURCE="profiles/richie/PROFILE.md"
fi

PROVENANCE["profile"]="$PROFILE_SOURCE"
TOKEN_COUNTS["profile"]=$(count_tokens "$PROFILE")

# ============================================
# JOURNAL Section (Standard+ - Summarized When Stale)
# ============================================
JOURNAL=""
JOURNAL_SOURCE=""
JOURNAL_AGE=0
JOURNAL_SUMMARIZED=false

if [[ "$LEVEL" != "minimal" ]]; then
    JOURNAL_DIR="$EXECUTOR_DIR/repos/$REPO/session-journals"
    
    if [[ -d "$JOURNAL_DIR" ]]; then
        # Find most recent journal
        LATEST_JOURNAL=$(ls -t "$JOURNAL_DIR"/*.md 2>/dev/null | head -1 || echo "")
        
        if [[ -n "$LATEST_JOURNAL" && -f "$LATEST_JOURNAL" ]]; then
            JOURNAL_SOURCE="$LATEST_JOURNAL"
            
            # Calculate age in days
            JOURNAL_MTIME=$(stat -c %Y "$LATEST_JOURNAL" 2>/dev/null || stat -f %m "$LATEST_JOURNAL" 2>/dev/null || echo "0")
            NOW=$(date +%s)
            JOURNAL_AGE=$(( (NOW - JOURNAL_MTIME) / 86400 ))
            
            JOURNAL_RAW=$(cat "$LATEST_JOURNAL")
            
            # Apply staleness rules
            if [[ $JOURNAL_AGE -gt 7 ]]; then
                JOURNAL=$(summarize_deterministic "$JOURNAL_RAW" 150 100)
                JOURNAL_SUMMARIZED=true
            elif [[ $JOURNAL_AGE -gt 3 ]]; then
                # Keep header + accomplishments + next action
                JOURNAL=$(echo "$JOURNAL_RAW" | grep -E '^(#|Status:|Last Session:|Accomplishments:|Next Action:|-)' | head -20)
                if [[ -z "$JOURNAL" ]]; then
                    JOURNAL=$(echo "$JOURNAL_RAW" | head -30)
                fi
            else
                JOURNAL=$(echo "$JOURNAL_RAW" | head -50)
            fi
        fi
    fi
fi

PROVENANCE["journal"]="$JOURNAL_SOURCE"
TOKEN_COUNTS["journal"]=$(count_tokens "$JOURNAL")

# ============================================
# ROADMAP Section (Full Only)
# ============================================
ROADMAP=""
ROADMAP_SOURCE=""

if [[ "$LEVEL" == "full" ]]; then
    ROADMAP_PATH="$EXECUTOR_DIR/repos/$REPO/docs/MASTER_ROADMAP.md"
    if [[ -f "$ROADMAP_PATH" ]]; then
        # Extract current phase info
        ROADMAP=$(cat "$ROADMAP_PATH" | head -40 | grep -E '^(#|Phase|Current|Goal|Next|Blocker)' | head -15 || cat "$ROADMAP_PATH" | head -20)
        ROADMAP_SOURCE="$ROADMAP_PATH"
    fi
fi

PROVENANCE["roadmap"]="$ROADMAP_SOURCE"
TOKEN_COUNTS["roadmap"]=$(count_tokens "$ROADMAP")

# ============================================
# Assemble Context
# ============================================
assemble() {
    local ctx="<zeos_context version=\"1.0\" injection_id=\"$INJECTION_ID\">"
    ctx+=$'\n\n## SOUL\n\n'"$SOUL"
    
    [[ -n "$ANCHORS" ]] && ctx+=$'\n\n## ANCHORS\n\n'"$ANCHORS"
    [[ -n "$PROFILE" ]] && ctx+=$'\n\n## PROFILE\n\n'"$PROFILE"
    [[ -n "$JOURNAL" ]] && ctx+=$'\n\n## JOURNAL\n\n'"$JOURNAL"
    [[ -n "$ROADMAP" ]] && ctx+=$'\n\n## ROADMAP\n\n'"$ROADMAP"
    
    ctx+=$'\n\n</zeos_context>'
    echo "$ctx"
}

CONTEXT=$(assemble)

# ============================================
# Security Scrubbing
# ============================================
ORIGINAL_LEN=${#CONTEXT}
if [[ -f "$SCRIPT_DIR/scrub-secrets.sh" ]]; then
    CONTEXT=$(echo "$CONTEXT" | "$SCRIPT_DIR/scrub-secrets.sh")
fi
REDACTION_COUNT=0
if [[ ${#CONTEXT} -ne $ORIGINAL_LEN ]]; then
    REDACTION_COUNT=$(( (ORIGINAL_LEN - ${#CONTEXT}) / 10 ))  # Rough estimate
fi

# ============================================
# Trimming Logic
# ============================================
TOKEN_ESTIMATE=$(count_tokens "$CONTEXT")
DROPPED_SECTIONS=()
JOURNAL_TRIMMED=0

while [[ $TOKEN_ESTIMATE -gt $MAX_TOKENS ]]; do
    if [[ -n "$ROADMAP" ]]; then
        ROADMAP=""
        DROPPED_SECTIONS+=("roadmap")
    elif [[ -n "$PROFILE" ]]; then
        PROFILE=""
        DROPPED_SECTIONS+=("profile")
    elif [[ $(count_tokens "$JOURNAL") -gt 200 ]]; then
        OLD_TOKENS=$(count_tokens "$JOURNAL")
        JOURNAL=$(summarize_deterministic "$JOURNAL" 100 50)
        JOURNAL_TRIMMED=$((OLD_TOKENS - $(count_tokens "$JOURNAL")))
        JOURNAL_SUMMARIZED=true
    else
        break  # SOUL + ANCHORS untouchable
    fi
    
    CONTEXT=$(assemble)
    TOKEN_ESTIMATE=$(count_tokens "$CONTEXT")
done

# ============================================
# Output
# ============================================
mkdir -p "$OUTPUT_DIR"

# Write context file
echo "$CONTEXT" > "$OUTPUT_DIR/context.md"

# Build sections array
SECTIONS_JSON="[\"soul\""
[[ -n "$ANCHORS" ]] && SECTIONS_JSON+=",\"anchors\""
[[ -n "$PROFILE" ]] && SECTIONS_JSON+=",\"profile\""
[[ -n "$JOURNAL" ]] && SECTIONS_JSON+=",\"journal\""
[[ -n "$ROADMAP" ]] && SECTIONS_JSON+=",\"roadmap\""
SECTIONS_JSON+="]"

# Build dropped array
DROPPED_JSON="["
for i in "${!DROPPED_SECTIONS[@]}"; do
    [[ $i -gt 0 ]] && DROPPED_JSON+=","
    DROPPED_JSON+="\"${DROPPED_SECTIONS[$i]}\""
done
DROPPED_JSON+="]"

# Write provenance log
cat > "$OUTPUT_DIR/context.json" << EOF
{
  "injection_id": "$INJECTION_ID",
  "timestamp": "$(date -Iseconds)",
  "repo": "$REPO",
  "level": "$LEVEL",
  "max_tokens": $MAX_TOKENS,
  "sections": $SECTIONS_JSON,
  "provenance": {
    "soul": "${PROVENANCE["soul"]:-}",
    "anchors": "${PROVENANCE["anchors"]:-}",
    "profile": "${PROVENANCE["profile"]:-}",
    "journal": "${PROVENANCE["journal"]:-}",
    "roadmap": "${PROVENANCE["roadmap"]:-}"
  },
  "token_counts": {
    "soul": ${TOKEN_COUNTS["soul"]:-0},
    "anchors": ${TOKEN_COUNTS["anchors"]:-0},
    "profile": ${TOKEN_COUNTS["profile"]:-0},
    "journal": ${TOKEN_COUNTS["journal"]:-0},
    "roadmap": ${TOKEN_COUNTS["roadmap"]:-0},
    "total": $TOKEN_ESTIMATE
  },
  "journal_age_days": $JOURNAL_AGE,
  "journal_summarized": $JOURNAL_SUMMARIZED,
  "trimming": {
    "sections_dropped": $DROPPED_JSON,
    "journal_trimmed_tokens": $JOURNAL_TRIMMED
  },
  "security": {
    "redactions_applied": $REDACTION_COUNT
  }
}
EOF

# Output injection ID
echo "$INJECTION_ID"
