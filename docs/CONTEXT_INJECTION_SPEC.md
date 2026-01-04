# Context Injection Specification v1.0

> **Outpost Multi-Agent Fleet — Context Injection Protocol**
> 
> **Fleet Reviewed:** 2026-01-03 | **Agents:** Codex, Gemini, Aider, Claude Code

This document defines how zeOS context is injected into agent prompts before task execution.

---

## Overview

Context injection prepends zeOS knowledge (SOUL, profile, journals, anchors) to agent tasks, enabling continuity-aware execution. Agents receive relevant history without re-explanation.

**Design Principle:** Minimal viable context. Every token must earn its place.

---

## Activation

```bash
# Context injection is OFF by default
dispatch-unified.sh <repo> "<task>" --executor=claude

# Enable with --context flag
dispatch-unified.sh <repo> "<task>" --executor=claude --context

# Specify context level
dispatch-unified.sh <repo> "<task>" --executor=claude --context=minimal
dispatch-unified.sh <repo> "<task>" --executor=claude --context=standard
dispatch-unified.sh <repo> "<task>" --executor=claude --context=full

# Custom token budget (power users)
dispatch-unified.sh <repo> "<task>" --executor=claude --context=1400
```

| Level | Token Budget | Use Case |
|-------|--------------|----------|
| `minimal` | ~600 | Simple tasks, known repos |
| `standard` | ~1200 | Default, balanced context |
| `full` | ~1800 | Complex tasks, new agents |
| `<number>` | 600-2000 | Custom exact budget |

**Hard Cap:** 2000 tokens. Beyond this, context competes with task reasoning.

---

## Schema

Context is injected as a structured Markdown block with XML wrapper:

```xml
<zeos_context version="1.0" injection_id="INJ-20260103-183000-a1b2c3">
<!-- SOUL: Project identity and constraints -->
<!-- ANCHORS: Long-lived decisions (never summarized) -->
<!-- PROFILE: Operator preferences -->
<!-- JOURNAL: Recent session state -->
<!-- ROADMAP: Current phase (optional) -->
</zeos_context>

<task>
[Original task content here]
</task>
```

---

## Section Structure

### 1. SOUL (Required — Never Dropped)

Project identity. Always included at all levels.

```markdown
## SOUL

Project: {project_name}
Type: {venture|infrastructure|research}
Purpose: {one-line purpose}

Constraints:
- {constraint_1}
- {constraint_2}
```

**Source:** `apps/{app_id}/*_SOUL.md` or project README
**Token Budget:** 150-200
**Provenance Log:** `soul_source: "apps/outpost/OUTPOST_SOUL.md"`

### 2. ANCHORS (Standard+ — Never Summarized)

Long-lived decisions and non-negotiables. Protected from journal summarization.

```markdown
## ANCHORS

Decisions:
- {decision_1}: {rationale} ({date})
- {decision_2}: {rationale} ({date})

Non-Negotiables:
- {constraint that must persist}
```

**Source:** `docs/ANCHORS.md` or extracted from SOUL
**Token Budget:** 100-150
**Provenance Log:** `anchors_source: "docs/ANCHORS.md"`

> **Fleet Recommendation (Codex):** This section prevents critical decisions from being lost when journals are summarized.

### 3. PROFILE (Standard+)

Operator preferences. Included at standard level and above.

```markdown
## PROFILE

Operator: {name}
Style: {communication preferences}

Standards:
- {standard_1}
- {standard_2}
```

**Source:** `profiles/{profile_id}/PROFILE.md`
**Token Budget:** 100-150
**Provenance Log:** `profile_source: "profiles/richie/PROFILE.md"`

### 4. JOURNAL (Standard+ — Summarized When Stale)

Recent session state. Most valuable for continuity.

```markdown
## JOURNAL

Last Session: {date}
Status: {complete|in-progress}

Accomplishments:
- {item_1}
- {item_2}

Next Action: {what was queued}
```

**Source:** Latest `session-journals/*.md` from project repo
**Token Budget:** 400-600
**Provenance Log:** `journal_source: "session-journals/2026-01-03-session.md"`

#### Staleness Rule & Summarization Strategy

> **Fleet Requirement (Codex, Gemini):** Deterministic summarization, not ambiguous.

| Journal Age | Strategy |
|-------------|----------|
| 0-3 days | Include full content (up to budget) |
| 4-7 days | Keep: header + accomplishments + next action |
| >7 days | **Deterministic summary:** First 150 tokens + Last 100 tokens |

**Summarization Algorithm:**
```python
def summarize_stale_journal(content, age_days):
    if age_days <= 3:
        return content  # Full
    elif age_days <= 7:
        return extract_sections(content, ["header", "accomplishments", "next_action"])
    else:
        # Deterministic: first 150 + last 100 tokens
        tokens = tokenize(content)
        return detokenize(tokens[:150] + ["...[summarized]..."] + tokens[-100:])
```

### 5. ROADMAP (Full Only)

Current project phase. Only for complex multi-phase work.

```markdown
## ROADMAP

Phase: {current_phase}
Goal: {phase_goal}
Blockers: {known_blockers}
```

**Source:** `docs/MASTER_ROADMAP.md` from project repo
**Token Budget:** 150-200
**Provenance Log:** `roadmap_source: "docs/MASTER_ROADMAP.md"`

---

## Token Budget Allocation (Updated per Fleet)

| Level | SOUL | ANCHORS | PROFILE | JOURNAL | ROADMAP | Total |
|-------|------|---------|---------|---------|---------|-------|
| `minimal` | 200 | — | — | 400 | — | 600 |
| `standard` | 200 | 150 | 150 | 500 | — | 1000 |
| `full` | 200 | 150 | 150 | 600 | 200 | 1300 |

**Buffer:** Each level has ~200-500 token headroom below hard cap for safety.

> **Fleet Change:** Increased from 500/1000/1500 to 600/1200/1800 budgets per Codex feedback.

---

## Precedence Rules (Trimming Order)

When context exceeds budget, sections are trimmed in this order:

1. **ROADMAP** — First to drop (strategic, not tactical)
2. **PROFILE** — Second (operator style is nice-to-have)
3. **JOURNAL** — Summarized per staleness rules, never fully dropped
4. **ANCHORS** — Never summarized, never dropped
5. **SOUL** — Never dropped (identity is foundational)

**Trimming Algorithm:**
```python
def trim_context(sections, budget):
    while total_tokens(sections) > budget:
        if sections.has("roadmap"):
            sections.drop("roadmap")
        elif sections.has("profile"):
            sections.drop("profile")
        elif sections.journal_tokens > 200:
            sections.summarize_journal(target=200)
        else:
            break  # SOUL + ANCHORS are untouchable
    return sections
```

---

## Security Scrubbing (Expanded per Fleet)

> **Fleet Requirement (Codex):** Original patterns missed common secrets.

### Pattern List (v1.0)

```bash
SCRUB_PATTERNS=(
    # GitHub tokens
    'github_pat_[A-Za-z0-9_]+'
    'ghp_[A-Za-z0-9]+'
    'gho_[A-Za-z0-9]+'
    'ghu_[A-Za-z0-9]+'
    
    # AWS credentials
    'AKIA[A-Z0-9]{16}'
    'ASIA[A-Z0-9]{16}'
    
    # OpenAI / Anthropic
    'sk-[A-Za-z0-9]{32,}'
    'sk-ant-[A-Za-z0-9-]+'
    
    # Slack tokens
    'xoxb-[A-Za-z0-9-]+'
    'xoxp-[A-Za-z0-9-]+'
    'xoxa-[A-Za-z0-9-]+'
    
    # PEM keys
    '-----BEGIN [A-Z ]+ KEY-----'
    '-----BEGIN CERTIFICATE-----'
    
    # Generic high-entropy (40+ hex chars)
    '[0-9a-fA-F]{40,}'
    
    # JWT tokens (3 base64 segments)
    'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
)
```

### Scrub Implementation

```bash
scrub_content() {
    local content="$1"
    
    # Apply all patterns
    for pattern in "${SCRUB_PATTERNS[@]}"; do
        content=$(echo "$content" | sed -E "s/$pattern/[REDACTED]/g")
    done
    
    echo "$content"
}
```

---

## Logging Format (Enhanced with Provenance)

> **Fleet Requirement (Gemini):** Include source file paths for debugging.

Every injection is logged for A/B analysis:

```json
{
  "injection_id": "INJ-20260103-183000-a1b2c3",
  "timestamp": "2026-01-03T18:30:00Z",
  "run_id": "20260103-183000-claude-abc123",
  "repo": "swords-of-chaos-reborn",
  "executor": "claude",
  "level": "standard",
  
  "sections": ["soul", "anchors", "profile", "journal"],
  
  "provenance": {
    "soul": "apps/swords-of-chaos/SOC_SOUL.md",
    "anchors": "docs/ANCHORS.md",
    "profile": "profiles/richie/PROFILE.md",
    "journal": "session-journals/2026-01-03-session.md"
  },
  
  "token_counts": {
    "soul": 187,
    "anchors": 142,
    "profile": 98,
    "journal": 423,
    "total": 850
  },
  
  "journal_age_days": 1,
  "journal_summarized": false,
  
  "trimming": {
    "sections_dropped": [],
    "journal_trimmed_tokens": 0
  },
  
  "security": {
    "patterns_matched": 0,
    "redactions_applied": 0
  },
  
  "outcome": {
    "status": "success",
    "changes": "committed",
    "duration_sec": 45
  }
}
```

**Log Location:** `runs/<run-id>/context.json`

### Outcome Classification

| Status | Meaning |
|--------|---------|
| `success` | Context injected within budget, no issues |
| `trimmed` | Sections dropped or journal summarized |
| `scrubbed` | Security patterns detected and redacted |
| `error` | Context assembly failed |

---

## Injection ID Generation

> **Fleet Requirement (Codex):** Specify format explicitly.

**Format:** `INJ-{YYYYMMDD}-{HHMMSS}-{random6}`

```bash
generate_injection_id() {
    echo "INJ-$(date +%Y%m%d)-$(date +%H%M%S)-$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)"
}

# Example: INJ-20260103-183000-a1b2c3
```

---

## Context Assembly Script

```bash
#!/bin/bash
# assemble-context.sh <repo> <level> <output_dir>

set -euo pipefail

REPO=$1
LEVEL=${2:-standard}
OUTPUT_DIR=$3
INJECTION_ID=$(generate_injection_id)

# Determine token budget
case $LEVEL in
    minimal)  MAX_TOKENS=600 ;;
    standard) MAX_TOKENS=1200 ;;
    full)     MAX_TOKENS=1800 ;;
    [0-9]*)   MAX_TOKENS=$LEVEL ;;  # Custom
    *)        echo "Unknown level: $LEVEL"; exit 1 ;;
esac

# Cap at 2000
[[ $MAX_TOKENS -gt 2000 ]] && MAX_TOKENS=2000

# Fetch sections with provenance tracking
SOUL=$(fetch_soul "$REPO")
SOUL_SOURCE=$(get_soul_path "$REPO")

ANCHORS=""
ANCHORS_SOURCE=""
if [[ "$LEVEL" != "minimal" ]]; then
    ANCHORS=$(fetch_anchors "$REPO")
    ANCHORS_SOURCE=$(get_anchors_path "$REPO")
fi

PROFILE=""
PROFILE_SOURCE=""
if [[ "$LEVEL" != "minimal" ]]; then
    PROFILE=$(fetch_profile)
    PROFILE_SOURCE="profiles/richie/PROFILE.md"
fi

JOURNAL=""
JOURNAL_SOURCE=""
JOURNAL_AGE=0
JOURNAL_SUMMARIZED=false
if [[ "$LEVEL" != "minimal" ]]; then
    JOURNAL_DATA=$(fetch_journal "$REPO")
    JOURNAL=$(echo "$JOURNAL_DATA" | jq -r '.content')
    JOURNAL_SOURCE=$(echo "$JOURNAL_DATA" | jq -r '.source')
    JOURNAL_AGE=$(echo "$JOURNAL_DATA" | jq -r '.age_days')
    
    # Apply staleness rules
    if [[ $JOURNAL_AGE -gt 7 ]]; then
        JOURNAL=$(summarize_deterministic "$JOURNAL" 150 100)
        JOURNAL_SUMMARIZED=true
    elif [[ $JOURNAL_AGE -gt 3 ]]; then
        JOURNAL=$(extract_key_sections "$JOURNAL")
    fi
fi

ROADMAP=""
ROADMAP_SOURCE=""
if [[ "$LEVEL" == "full" ]]; then
    ROADMAP=$(fetch_roadmap "$REPO")
    ROADMAP_SOURCE="docs/MASTER_ROADMAP.md"
fi

# Assemble context
CONTEXT="<zeos_context version=\"1.0\" injection_id=\"$INJECTION_ID\">

## SOUL
$SOUL
"

[[ -n "$ANCHORS" ]] && CONTEXT+="
## ANCHORS
$ANCHORS
"

[[ -n "$PROFILE" ]] && CONTEXT+="
## PROFILE
$PROFILE
"

[[ -n "$JOURNAL" ]] && CONTEXT+="
## JOURNAL
$JOURNAL
"

[[ -n "$ROADMAP" ]] && CONTEXT+="
## ROADMAP
$ROADMAP
"

CONTEXT+="
</zeos_context>"

# Security scrub
REDACTION_COUNT=0
ORIGINAL_CONTEXT="$CONTEXT"
CONTEXT=$(scrub_content "$CONTEXT")
if [[ "$CONTEXT" != "$ORIGINAL_CONTEXT" ]]; then
    REDACTION_COUNT=$(diff <(echo "$ORIGINAL_CONTEXT") <(echo "$CONTEXT") | grep -c "REDACTED" || true)
fi

# Token estimation (conservative: chars/4)
TOKEN_ESTIMATE=$(( ${#CONTEXT} / 4 ))

# Trimming if over budget
DROPPED_SECTIONS=()
JOURNAL_TRIMMED=0

while [[ $TOKEN_ESTIMATE -gt $MAX_TOKENS ]]; do
    if [[ -n "$ROADMAP" ]]; then
        ROADMAP=""
        DROPPED_SECTIONS+=("roadmap")
    elif [[ -n "$PROFILE" ]]; then
        PROFILE=""
        DROPPED_SECTIONS+=("profile")
    elif [[ $(echo "$JOURNAL" | wc -c) -gt 800 ]]; then
        OLD_LEN=${#JOURNAL}
        JOURNAL=$(summarize_deterministic "$JOURNAL" 100 50)
        JOURNAL_TRIMMED=$((OLD_LEN - ${#JOURNAL}))
        JOURNAL_SUMMARIZED=true
    else
        break  # SOUL + ANCHORS untouchable
    fi
    
    # Reassemble and recount
    CONTEXT=$(reassemble_context "$SOUL" "$ANCHORS" "$PROFILE" "$JOURNAL" "$ROADMAP")
    TOKEN_ESTIMATE=$(( ${#CONTEXT} / 4 ))
done

# Write context file
echo "$CONTEXT" > "$OUTPUT_DIR/context.md"

# Write provenance log
cat > "$OUTPUT_DIR/context.json" << EOF
{
  "injection_id": "$INJECTION_ID",
  "timestamp": "$(date -Iseconds)",
  "repo": "$REPO",
  "level": "$LEVEL",
  "sections": [$(build_sections_array)],
  "provenance": {
    "soul": "$SOUL_SOURCE",
    "anchors": "$ANCHORS_SOURCE",
    "profile": "$PROFILE_SOURCE",
    "journal": "$JOURNAL_SOURCE",
    "roadmap": "$ROADMAP_SOURCE"
  },
  "token_counts": {
    "soul": $(count_tokens "$SOUL"),
    "anchors": $(count_tokens "$ANCHORS"),
    "profile": $(count_tokens "$PROFILE"),
    "journal": $(count_tokens "$JOURNAL"),
    "roadmap": $(count_tokens "$ROADMAP"),
    "total": $TOKEN_ESTIMATE
  },
  "journal_age_days": $JOURNAL_AGE,
  "journal_summarized": $JOURNAL_SUMMARIZED,
  "trimming": {
    "sections_dropped": [$(printf '"%s",' "${DROPPED_SECTIONS[@]}" | sed 's/,$//')]
    "journal_trimmed_tokens": $JOURNAL_TRIMMED
  },
  "security": {
    "redactions_applied": $REDACTION_COUNT
  }
}
EOF

echo "$INJECTION_ID"
```

---

## Integration with dispatch-unified.sh

```bash
# In dispatch-unified.sh, after parsing args:

if [[ -n "$CONTEXT_FLAG" ]]; then
    CONTEXT_LEVEL=${CONTEXT_LEVEL:-standard}
    
    echo "📋 Building context (level: $CONTEXT_LEVEL)..."
    INJECTION_ID=$(assemble-context.sh "$REPO" "$CONTEXT_LEVEL" "$RUN_DIR")
    
    # Prepend context to task
    CONTEXT_CONTENT=$(cat "$RUN_DIR/context.md")
    FULL_PROMPT="$CONTEXT_CONTENT

<task>
$TASK
</task>"
    
    echo "   Injection ID: $INJECTION_ID"
    echo "   Tokens: ~$(( ${#CONTEXT_CONTENT} / 4 ))"
else
    FULL_PROMPT="$TASK"
fi
```

---

## Graceful Degradation

> **Fleet Requirement (Gemini):** Handle missing files without cascade failure.

```bash
fetch_section_safe() {
    local path="$1"
    local section_name="$2"
    
    if [[ -f "$path" ]]; then
        cat "$path"
    else
        echo "# $section_name: [Not found: $path]"
        return 0  # Don't fail
    fi
}
```

| Missing File | Behavior |
|--------------|----------|
| SOUL | **FAIL** — Cannot proceed without identity |
| ANCHORS | Skip section, log warning |
| PROFILE | Skip section, log warning |
| JOURNAL | Skip section, log warning |
| ROADMAP | Skip section (expected at non-full levels) |

---

## Versioning Strategy

| Version | Changes |
|---------|---------|
| 1.0 | Initial specification with fleet recommendations |
| 1.1 | (Planned) Debug mode (`--context=standard --debug`) |
| 1.2 | (Planned) Caching for frequently-used contexts |
| 2.0 | (Future) Dynamic context selection via ML |

**Compatibility:** Context version is embedded in XML wrapper. Agents should gracefully handle unknown versions by extracting raw text.

---

## Implementation Checklist

- [ ] Create `scripts/assemble-context.sh`
- [ ] Create `scripts/scrub-secrets.sh` with expanded patterns
- [ ] Add `--context` flag to `dispatch-unified.sh`
- [ ] Create `docs/ANCHORS.md` template
- [ ] Add provenance fields to `context.json`
- [ ] Test with all 4 agents
- [ ] Update OUTPOST_INTERFACE.md

---

## Example: Full Context Injection

```xml
<zeos_context version="1.0" injection_id="INJ-20260103-183000-a1b2c3">

## SOUL

Project: Swords of Chaos: Reborn
Type: venture
Purpose: Faithful recreation of 1994 MajorBBS classic MUD

Constraints:
- Preserve original game feel
- Modern terminal compatibility
- Session persistence for players

## ANCHORS

Decisions:
- Use WebSocket for real-time: proven technology (2025-12-15)
- SQLite for player data: simplicity over scale (2025-12-20)

Non-Negotiables:
- Never delete player save data without explicit command
- Combat formulas must match original 1994 mechanics

## PROFILE

Operator: Richie Suarez
Style: Direct, military precision, BLUF

Standards:
- GitOps discipline mandatory
- Systems over tasks
- Production-grade code

## JOURNAL

Last Session: 2026-01-02
Status: Complete

Accomplishments:
- Implemented GOSSIP command
- Fixed combat damage calculation
- Added 5 new room descriptions

Next Action: Implement PARTY system for group combat

</zeos_context>

<task>
Add the PARTY command that lets players form groups. Include: invite, accept, leave, list members.
</task>
```

---

## Fleet Review Integration

This specification incorporates feedback from all 4 Outpost agents:

| Recommendation | Source | Status |
|----------------|--------|--------|
| Increase token budgets | Codex | ✅ Implemented (600/1200/1800) |
| Add ANCHORS section | Codex | ✅ Implemented |
| Deterministic summarization | Codex, Gemini | ✅ Implemented |
| Expand security patterns | Codex | ✅ Implemented (15+ patterns) |
| Add provenance logging | Gemini | ✅ Implemented |
| Custom token level | Aider | ✅ Implemented |
| Debug mode | Aider | ⏳ Deferred to v1.1 |

---

*Context Injection Spec v1.0 — Outpost Multi-Agent Fleet*
*Fleet Reviewed: 2026-01-03*
*"Minimal viable context. Every token earns its place."*
