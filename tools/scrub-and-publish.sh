#!/bin/bash
# scrub-and-publish.sh - Extract and publish to public Outpost repo
#
# This script:
# 1. Extracts publishable files from the private working repo (rgsuarez/outpost)
# 2. Scrubs any me-specific values (converts to environment variables)
# 3. Commits to the public repo (zeroechelon/outpost)
#
# Usage: ./scrub-and-publish.sh [--dry-run] [--message "commit message"]
#
# Run from the private repo root or specify PRIVATE_REPO path.

set -euo pipefail

# Configuration
PRIVATE_REPO="${PRIVATE_REPO:-$(pwd)}"
PUBLIC_REPO_URL="https://github.com/zeroechelon/outpost.git"
WORK_DIR="/tmp/outpost-publish-$$"
DRY_RUN=false
COMMIT_MSG="Sync from private repo"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --message)
            COMMIT_MSG="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 OUTPOST PUBLIC RELEASE"
echo "═══════════════════════════════════════════════════════════════"
echo "Private repo: $PRIVATE_REPO"
echo "Public repo:  $PUBLIC_REPO_URL"
echo "Dry run:      $DRY_RUN"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════
# FILES TO PUBLISH
# ═══════════════════════════════════════════════════════════════════

# These files are copied from private to public
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

# These files are generated fresh for public (not copied)
GENERATED_FILES=(
    "README.md"
    ".env.template"
    "LICENSE"
    ".gitignore"
)

# These are EXCLUDED (never publish)
EXCLUDE_PATTERNS=(
    "session-journals/*"
    ".env"
    "runs/*"
    "repos/*"
    "*.log"
    "OUTPOST_INTERFACE.md"  # Has me-specific SSM IDs
)

# ═══════════════════════════════════════════════════════════════════
# SCRUB PATTERNS
# ═══════════════════════════════════════════════════════════════════

scrub_file() {
    local file="$1"
    
    # Replace hardcoded values with environment variables
    sed -i \
        -e 's/rgsuarez/\${GITHUB_USER}/g' \
        -e 's/mi-0d77bfe39f630bd5c/\${SSM_INSTANCE_ID}/g' \
        -e 's/mi-0ece7b1a53a67e600/\${SSM_INSTANCE_ID}/g' \
        -e 's/52\.44\.78\.2/\${OUTPOST_SERVER}/g' \
        -e 's/311493921645/\${AWS_ACCOUNT_ID}/g' \
        -e 's/535471339422/\${AWS_ACCOUNT_ID}/g' \
        -e 's|/home/ubuntu/claude-executor|/opt/outpost|g' \
        "$file"
    
    # Remove any lines with actual secrets (paranoid check)
    sed -i \
        -e '/github_pat_/d' \
        -e '/AKIA[A-Z0-9]\{16\}/d' \
        -e '/sk-ant-/d' \
        "$file"
}

# ═══════════════════════════════════════════════════════════════════
# SETUP WORK DIRECTORY
# ═══════════════════════════════════════════════════════════════════

echo "📦 Setting up work directory..."
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Clone public repo (or init if empty)
if git clone "$PUBLIC_REPO_URL" public 2>/dev/null; then
    echo "   Cloned existing public repo"
else
    echo "   Initializing new public repo"
    mkdir public
    cd public
    git init
    git remote add origin "$PUBLIC_REPO_URL"
    cd ..
fi

cd public

# ═══════════════════════════════════════════════════════════════════
# COPY AND SCRUB FILES
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "📝 Processing files..."

# Create directory structure
mkdir -p scripts docs templates

# Copy and scrub publishable files
for file in "${PUBLISH_FILES[@]}"; do
    src="$PRIVATE_REPO/$file"
    if [[ -f "$src" ]]; then
        echo "   ✅ $file"
        cp "$src" "$file"
        scrub_file "$file"
    else
        echo "   ⚠️ $file (not found, skipping)"
    fi
done

# ═══════════════════════════════════════════════════════════════════
# GENERATE PUBLIC-ONLY FILES
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "📝 Generating public files..."

# README.md - AI-agent optimized
cat > README.md << 'READMEEOF'
# Outpost

> Multi-agent coding executor. Dispatch tasks to Claude, Codex, Gemini, and Aider in parallel.

## What This Is

Outpost runs AI coding agents on a remote server. You send a task, it executes across one or more agents in isolated workspaces, and returns results.

```
Your Session ──► SSH ──► Remote Server ──► [Claude, Codex, Gemini, Aider]
                                                      │
                                              Isolated Workspaces
                                                      │
                                              Results + Diffs
```

## Quick Start (For AI Agents)

If you are an AI agent helping a user set up Outpost, follow these steps:

### Step 1: Gather Requirements

Prompt your user for:

```yaml
required:
  server_host: "IP or hostname of a Linux server"
  server_user: "SSH username with sudo privileges"
  ssh_access: "SSH key or password access to server"
  github_token: "GitHub PAT with repo read/write access"

optional_agent_credentials:
  anthropic_api_key: "For Claude Code"
  openai_api_key: "For Codex CLI"
  google_api_key: "For Gemini CLI"
  deepseek_api_key: "For Aider (cheapest option)"
```

At minimum, user needs ONE agent credential. Aider with DeepSeek is cheapest (~$0.14/MTok).

### Step 2: Server Setup

SSH to the server and execute:

```bash
# Create directory
sudo mkdir -p /opt/outpost
sudo chown $USER:$USER /opt/outpost
cd /opt/outpost

# Clone Outpost
git clone https://github.com/zeroechelon/outpost.git .

# Configure
cp .env.template .env
nano .env  # Add credentials

# Make executable
chmod +x scripts/*.sh

# Install agents
./scripts/setup-agents.sh
```

### Step 3: Test

```bash
./scripts/dispatch-unified.sh <user-repo> "Add a README" --executor=aider
```

## Usage

```bash
# Single agent
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude

# Multiple agents in parallel
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude,aider

# All agents
./scripts/dispatch-unified.sh <repo> "<task>" --executor=all

# With context injection (recommended with zeOS)
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude --context
```

## Agents

| Agent | Credential | Cost |
|-------|-----------|------|
| `claude` | `ANTHROPIC_API_KEY` | ~$15/MTok or $100/mo Max |
| `codex` | `OPENAI_API_KEY` | ~$10/MTok or $20/mo Pro |
| `gemini` | `GOOGLE_API_KEY` | Free tier available |
| `aider` | `DEEPSEEK_API_KEY` | ~$0.14/MTok (recommended) |

## Context Injection

For continuity-aware execution, use `--context`:

```bash
--context=minimal    # 600 tokens (SOUL + JOURNAL)
--context=standard   # 1200 tokens (default)
--context=full       # 1800 tokens
```

Works best with [zeOS](https://github.com/rgsuarez/zeOS) project structure.

## License

MIT License - See [LICENSE](LICENSE)
READMEEOF

echo "   ✅ README.md"

# .env.template
cat > .env.template << 'ENVEOF'
# Outpost Environment Configuration

# Required
GITHUB_TOKEN=""
GITHUB_USER=""

# Agent credentials (at least one)
ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GOOGLE_API_KEY=""
DEEPSEEK_API_KEY=""

# Optional
AGENT_TIMEOUT=600
ENVEOF

echo "   ✅ .env.template"

# .gitignore
cat > .gitignore << 'IGNOREEOF'
.env
runs/
repos/
*.log
.cache-lock-*
.scripts-sync
IGNOREEOF

echo "   ✅ .gitignore"

# ═══════════════════════════════════════════════════════════════════
# COMMIT AND PUSH
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "📊 Changes:"
git status --short

if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "🔍 DRY RUN - Not committing"
    echo "   Files prepared in: $WORK_DIR/public"
else
    echo ""
    echo "📤 Committing and pushing..."
    git add -A
    git commit -m "$COMMIT_MSG" || echo "   No changes to commit"
    git push origin main || git push -u origin main
    
    echo ""
    echo "✅ Published to: $PUBLIC_REPO_URL"
fi

# Cleanup
if [[ "$DRY_RUN" == "false" ]]; then
    rm -rf "$WORK_DIR"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ PUBLISH COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
