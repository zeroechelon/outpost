#!/bin/bash
# setup-agents.sh - Install AI agent CLIs for Outpost
#
# Usage: ./setup-agents.sh [agent...]
# Examples:
#   ./setup-agents.sh           # Install all available
#   ./setup-agents.sh aider     # Install only Aider

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPOST_DIR="${OUTPOST_DIR:-$(dirname "$SCRIPT_DIR")}"

# Load environment
[[ -f "$OUTPOST_DIR/.env" ]] && source "$OUTPOST_DIR/.env"

echo "═══════════════════════════════════════════════════════════════"
echo "🔧 OUTPOST AGENT SETUP"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if [[ $# -gt 0 ]]; then
    AGENTS=("$@")
else
    AGENTS=(claude codex gemini aider)
fi

install_aider() {
    echo "📦 Installing Aider..."
    if command -v aider &>/dev/null; then
        echo "   ✅ Already installed: $(aider --version 2>/dev/null || echo 'unknown')"
        return 0
    fi
    pip3 install aider-chat 2>/dev/null || pip install aider-chat 2>/dev/null || {
        echo "   📝 Manual: pip install aider-chat"
        return 1
    }
    echo "   ✅ Installed"
}

install_claude() {
    echo "📦 Installing Claude Code..."
    if command -v claude &>/dev/null; then
        echo "   ✅ Already installed"
        return 0
    fi
    npm install -g @anthropic-ai/claude-code 2>/dev/null || {
        echo "   📝 Manual: npm install -g @anthropic-ai/claude-code"
        echo "   Or authenticate: claude login"
        return 1
    }
    echo "   ✅ Installed"
}

install_codex() {
    echo "📦 Installing OpenAI Codex..."
    if command -v codex &>/dev/null; then
        echo "   ✅ Already installed"
        return 0
    fi
    npm install -g @openai/codex 2>/dev/null || {
        echo "   📝 Manual: npm install -g @openai/codex"
        return 1
    }
    echo "   ✅ Installed"
}

install_gemini() {
    echo "📦 Installing Gemini CLI..."
    if command -v gemini &>/dev/null; then
        echo "   ✅ Already installed"
        return 0
    fi
    pip3 install google-generativeai 2>/dev/null || {
        echo "   📝 Manual: pip install google-generativeai"
        return 1
    }
    echo "   ✅ Installed"
}

INSTALLED=()
FAILED=()

for agent in "${AGENTS[@]}"; do
    echo ""
    case "$agent" in
        aider)  install_aider && INSTALLED+=("aider") || FAILED+=("aider") ;;
        claude) install_claude && INSTALLED+=("claude") || FAILED+=("claude") ;;
        codex)  install_codex && INSTALLED+=("codex") || FAILED+=("codex") ;;
        gemini) install_gemini && INSTALLED+=("gemini") || FAILED+=("gemini") ;;
        *)      echo "⚠️ Unknown agent: $agent" ;;
    esac
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
[[ ${#INSTALLED[@]} -gt 0 ]] && echo "✅ Ready: ${INSTALLED[*]}"
[[ ${#FAILED[@]} -gt 0 ]] && echo "❌ Manual setup needed: ${FAILED[*]}"
echo ""
echo "Next: Edit .env with API keys, then test with dispatch-unified.sh"
