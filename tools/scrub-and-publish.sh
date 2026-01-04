#!/bin/bash
# scrub-and-publish.sh - Publish from private repo to public repo via GitHub API
#
# This script:
# 1. Fetches files from rgsuarez/outpost (private)
# 2. Applies scrubbing (removes hardcoded values)
# 3. Pushes to zeroechelon/outpost (public)
#
# Usage: ./scrub-and-publish.sh [--dry-run] [--message "commit message"]
#
# Required environment variables:
#   GITHUB_TOKEN      - PAT for rgsuarez (private repo read)
#   ZEROECHELON_TOKEN - PAT for zeroechelon (public repo write)

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

PRIVATE_REPO="rgsuarez/outpost"
PUBLIC_REPO="zeroechelon/outpost"
DRY_RUN=false
COMMIT_MSG="Sync from private repo $(date +%Y-%m-%d)"
WORK_DIR="/tmp/outpost-publish-$$"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --message) COMMIT_MSG="$2"; shift 2 ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

# Validate tokens
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "❌ GITHUB_TOKEN not set (needed for private repo)"
    exit 1
fi

if [[ -z "${ZEROECHELON_TOKEN:-}" ]]; then
    echo "❌ ZEROECHELON_TOKEN not set (needed for public repo)"
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 OUTPOST PUBLIC RELEASE"
echo "═══════════════════════════════════════════════════════════════"
echo "Private: $PRIVATE_REPO"
echo "Public:  $PUBLIC_REPO"
echo "Dry run: $DRY_RUN"
echo "Message: $COMMIT_MSG"
echo "═══════════════════════════════════════════════════════════════"
echo ""

mkdir -p "$WORK_DIR"

# ═══════════════════════════════════════════════════════════════════
# FILES TO PUBLISH
# ═══════════════════════════════════════════════════════════════════

PUBLISH_FILES=(
    "scripts/dispatch-unified.sh"
    "scripts/dispatch.sh"
    "scripts/dispatch-codex.sh"
    "scripts/dispatch-gemini.sh"
    "scripts/dispatch-aider.sh"
    "scripts/assemble-context.sh"
    "scripts/scrub-secrets.sh"
    "scripts/setup-agents.sh"
    "scripts/promote-workspace.sh"
    "scripts/list-runs.sh"
    "docs/CONTEXT_INJECTION_SPEC.md"
    "docs/SETUP_SERVER.md"
    "docs/SETUP_AGENTS.md"
)

# ═══════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

fetch_file() {
    local path="$1"
    curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/$PRIVATE_REPO/contents/$path" | \
        python3 -c "import json,sys,base64; d=json.load(sys.stdin); print(base64.b64decode(d.get('content','')).decode() if 'content' in d else '')" 2>/dev/null
}

scrub_content() {
    local content="$1"
    
    # Path generalization
    content=$(echo "$content" | sed 's|/home/ubuntu/claude-executor|${OUTPOST_DIR:-/opt/outpost}|g')
    
    # Remove hardcoded usernames in clone URLs (but keep ${GITHUB_USER} pattern)
    content=$(echo "$content" | sed 's|github.com/rgsuarez/|github.com/${GITHUB_USER}/|g')
    
    # Remove specific instance IDs and IPs
    content=$(echo "$content" | sed 's/mi-0d77bfe39f630bd5c/${SSM_INSTANCE_ID}/g')
    content=$(echo "$content" | sed 's/mi-0ece7b1a53a67e600/${SSM_INSTANCE_ID}/g')
    content=$(echo "$content" | sed 's/52\.44\.78\.2/${OUTPOST_SERVER}/g')
    
    # Remove AWS account IDs
    content=$(echo "$content" | sed 's/311493921645/${AWS_ACCOUNT_ID}/g')
    content=$(echo "$content" | sed 's/535471339422/${AWS_ACCOUNT_ID}/g')
    
    # Remove any leaked credentials (paranoid check)
    content=$(echo "$content" | sed 's/github_pat_[A-Za-z0-9_]\+/\${GITHUB_TOKEN}/g')
    content=$(echo "$content" | sed 's/AKIA[A-Z0-9]\{16\}/\${AWS_ACCESS_KEY_ID}/g')
    content=$(echo "$content" | sed 's/sk-ant-[A-Za-z0-9-]\+/\${ANTHROPIC_API_KEY}/g')
    
    echo "$content"
}

push_file() {
    local path="$1"
    local content="$2"
    local message="$3"
    
    local encoded=$(echo "$content" | base64 -w 0)
    
    # Check if file exists to get SHA
    local sha=$(curl -s -H "Authorization: token $ZEROECHELON_TOKEN" \
        "https://api.github.com/repos/$PUBLIC_REPO/contents/$path" | \
        python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sha',''))" 2>/dev/null || echo "")
    
    local data
    if [[ -n "$sha" && "$sha" != "" ]]; then
        data="{\"message\":\"$message\",\"content\":\"$encoded\",\"sha\":\"$sha\"}"
    else
        data="{\"message\":\"$message\",\"content\":\"$encoded\"}"
    fi
    
    curl -s -X PUT -H "Authorization: token $ZEROECHELON_TOKEN" \
        "https://api.github.com/repos/$PUBLIC_REPO/contents/$path" \
        -d "$data" | \
        python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('commit',{}).get('sha','')[:7] if 'commit' in d else d.get('message','error'))"
}

# ═══════════════════════════════════════════════════════════════════
# PROCESS FILES
# ═══════════════════════════════════════════════════════════════════

echo "📥 Fetching and scrubbing files..."
echo ""

PROCESSED=()
FAILED=()

for file in "${PUBLISH_FILES[@]}"; do
    echo -n "  $file: "
    
    content=$(fetch_file "$file")
    
    if [[ -z "$content" ]]; then
        echo "⚠️ not found in private repo"
        FAILED+=("$file")
        continue
    fi
    
    # Apply scrubbing
    scrubbed=$(scrub_content "$content")
    
    # Save locally for dry-run inspection
    mkdir -p "$WORK_DIR/$(dirname "$file")"
    echo "$scrubbed" > "$WORK_DIR/$file"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "✓ (dry run)"
    else
        result=$(push_file "$file" "$scrubbed" "$COMMIT_MSG")
        echo "$result"
    fi
    
    PROCESSED+=("$file")
done

# ═══════════════════════════════════════════════════════════════════
# GENERATE PUBLIC-ONLY FILES
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "📝 Generating public-only files..."
echo ""

# README.md
README_CONTENT='# Outpost

> Multi-agent coding executor. Dispatch tasks to Claude, Codex, Gemini, and Aider in parallel.

## Quick Start

```bash
# On your Linux or macOS server
sudo mkdir -p /opt/outpost && sudo chown $USER:$USER /opt/outpost
cd /opt/outpost
git clone https://github.com/zeroechelon/outpost.git .
cp .env.template .env
nano .env  # Add GITHUB_TOKEN, GITHUB_USER, and at least one agent key
chmod +x scripts/*.sh
./scripts/setup-agents.sh
./scripts/dispatch-unified.sh <your-repo> "Add README" --executor=aider
```

## Agents

| Agent | Credential | Cost |
|-------|-----------|------|
| `aider` | `DEEPSEEK_API_KEY` | ~$0.14/MTok (cheapest) |
| `claude` | `ANTHROPIC_API_KEY` | $100/mo or ~$15-75/MTok |
| `codex` | `OPENAI_API_KEY` | $20/mo or ~$10/MTok |
| `gemini` | `GOOGLE_API_KEY` | Free tier available |

## Documentation

- [Server Setup](docs/SETUP_SERVER.md) — Install on Linux/macOS
- [Agent Setup](docs/SETUP_AGENTS.md) — Configure API keys and OAuth
- [Context Injection](docs/CONTEXT_INJECTION_SPEC.md) — Enhanced with zeOS

## Usage

```bash
# Single agent
./scripts/dispatch-unified.sh <repo> "<task>" --executor=aider

# Multiple agents
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude,aider

# With context injection
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude --context
```

## License

MIT — See [LICENSE](LICENSE)

## Related

- [zeOS](https://github.com/rgsuarez/zeOS) — Enhanced context injection
'

echo -n "  README.md: "
if [[ "$DRY_RUN" == "true" ]]; then
    echo "$README_CONTENT" > "$WORK_DIR/README.md"
    echo "✓ (dry run)"
else
    result=$(push_file "README.md" "$README_CONTENT" "$COMMIT_MSG")
    echo "$result"
fi

# LICENSE
LICENSE_CONTENT='MIT License

Copyright (c) 2026 Zero Echelon LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'

echo -n "  LICENSE: "
if [[ "$DRY_RUN" == "true" ]]; then
    echo "$LICENSE_CONTENT" > "$WORK_DIR/LICENSE"
    echo "✓ (dry run)"
else
    result=$(push_file "LICENSE" "$LICENSE_CONTENT" "$COMMIT_MSG")
    echo "$result"
fi

# .env.template
ENV_TEMPLATE='# Outpost Environment Configuration

# Required
GITHUB_TOKEN=""
GITHUB_USER=""

# Agents (at least one)
DEEPSEEK_API_KEY=""      # Aider (cheapest)
ANTHROPIC_API_KEY=""     # Claude
OPENAI_API_KEY=""        # Codex
GOOGLE_API_KEY=""        # Gemini

# Optional
AGENT_TIMEOUT=600
'

echo -n "  .env.template: "
if [[ "$DRY_RUN" == "true" ]]; then
    echo "$ENV_TEMPLATE" > "$WORK_DIR/.env.template"
    echo "✓ (dry run)"
else
    result=$(push_file ".env.template" "$ENV_TEMPLATE" "$COMMIT_MSG")
    echo "$result"
fi

# .gitignore
GITIGNORE='.env
runs/
repos/
*.log
.cache-lock-*
.scripts-sync
'

echo -n "  .gitignore: "
if [[ "$DRY_RUN" == "true" ]]; then
    echo "$GITIGNORE" > "$WORK_DIR/.gitignore"
    echo "✓ (dry run)"
else
    result=$(push_file ".gitignore" "$GITIGNORE" "$COMMIT_MSG")
    echo "$result"
fi

# ═══════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [[ "$DRY_RUN" == "true" ]]; then
    echo "🔍 DRY RUN COMPLETE"
    echo "═══════════════════════════════════════════════════════════════"
    echo "Files prepared in: $WORK_DIR"
    echo "Review scrubbed content before actual publish."
else
    echo "✅ PUBLISH COMPLETE"
    echo "═══════════════════════════════════════════════════════════════"
    echo "Published to: https://github.com/$PUBLIC_REPO"
    rm -rf "$WORK_DIR"
fi

echo ""
echo "Processed: ${#PROCESSED[@]} files"
[[ ${#FAILED[@]} -gt 0 ]] && echo "Failed: ${FAILED[*]}"
