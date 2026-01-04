#!/bin/bash
# setup-agents.sh - Install AI agent CLIs for Outpost
#
# Usage: ./setup-agents.sh [agent...]
# Examples:
#   ./setup-agents.sh           # Install all available
#   ./setup-agents.sh claude    # Install only Claude
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

# Determine which agents to install
if [[ $# -gt 0 ]]; then
    AGENTS=("$@")
else
    AGENTS=(claude codex gemini aider)
fi

install_claude() {
    echo "📦 Installing Claude Code..."
    
    if command -v claude &>/dev/null; then
        echo "   ✅ Already installed: $(claude --version 2>/dev/null || echo 'unknown version')"
        return 0
    fi
    
    # Claude Code installation via npm
    if command -v npm &>/dev/null; then
        npm install -g @anthropic-ai/claude-code 2>/dev/null || {
            echo "   ⚠️ npm install failed, trying alternative..."
        }
    fi
    
    # Alternative: direct binary (if available)
    if ! command -v claude &>/dev/null; then
        echo "   📝 Manual installation required:"
        echo "      Visit: https://claude.ai/code"
        echo "      Or: npm install -g @anthropic-ai/claude-code"
        return 1
    fi
    
    echo "   ✅ Installed"
    
    # Configure if API key provided
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "   🔑 API key found in .env"
    else
        echo "   💡 Run 'claude login' to authenticate with Max subscription"
        echo "      Or add ANTHROPIC_API_KEY to .env"
    fi
}

install_codex() {
    echo "📦 Installing OpenAI Codex CLI..."
    
    if command -v codex &>/dev/null; then
        echo "   ✅ Already installed: $(codex --version 2>/dev/null || echo 'unknown version')"
        return 0
    fi
    
    if command -v npm &>/dev/null; then
        npm install -g @openai/codex 2>/dev/null || {
            echo "   ⚠️ npm install failed"
        }
    fi
    
    if ! command -v codex &>/dev/null; then
        echo "   📝 Manual installation required:"
        echo "      npm install -g @openai/codex"
        return 1
    fi
    
    echo "   ✅ Installed"
    
    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
        echo "   🔑 API key found in .env"
    else
        echo "   ⚠️ Add OPENAI_API_KEY to .env"
    fi
}

install_gemini() {
    echo "📦 Installing Gemini CLI..."
    
    if command -v gemini &>/dev/null; then
        echo "   ✅ Already installed: $(gemini --version 2>/dev/null || echo 'unknown version')"
        return 0
    fi
    
    if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
        pip3 install google-generativeai-cli 2>/dev/null || pip install google-generativeai-cli 2>/dev/null || {
            echo "   ⚠️ pip install failed"
        }
    fi
    
    if ! command -v gemini &>/dev/null; then
        echo "   📝 Manual installation required:"
        echo "      pip install google-generativeai-cli"
        return 1
    fi
    
    echo "   ✅ Installed"
    
    if [[ -n "${GOOGLE_API_KEY:-}" ]]; then
        echo "   🔑 API key found in .env"
    else
        echo "   ⚠️ Add GOOGLE_API_KEY to .env"
        echo "      Get key at: https://aistudio.google.com/apikey"
    fi
}

install_aider() {
    echo "📦 Installing Aider..."
    
    if command -v aider &>/dev/null; then
        echo "   ✅ Already installed: $(aider --version 2>/dev/null || echo 'unknown version')"
        return 0
    fi
    
    if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
        pip3 install aider-chat 2>/dev/null || pip install aider-chat 2>/dev/null || {
            echo "   ⚠️ pip install failed"
        }
    fi
    
    if ! command -v aider &>/dev/null; then
        echo "   📝 Manual installation required:"
        echo "      pip install aider-chat"
        return 1
    fi
    
    echo "   ✅ Installed"
    
    if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
        echo "   🔑 DeepSeek API key found in .env"
    elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
        echo "   🔑 Will use OpenAI API key from .env"
    else
        echo "   ⚠️ Add DEEPSEEK_API_KEY or OPENAI_API_KEY to .env"
        echo "      DeepSeek recommended (~$0.14/MTok): https://platform.deepseek.com/"
    fi
}

# Run installations
INSTALLED=()
FAILED=()

for agent in "${AGENTS[@]}"; do
    echo ""
    case "$agent" in
        claude)
            install_claude && INSTALLED+=("claude") || FAILED+=("claude")
            ;;
        codex)
            install_codex && INSTALLED+=("codex") || FAILED+=("codex")
            ;;
        gemini)
            install_gemini && INSTALLED+=("gemini") || FAILED+=("gemini")
            ;;
        aider)
            install_aider && INSTALLED+=("aider") || FAILED+=("aider")
            ;;
        *)
            echo "⚠️ Unknown agent: $agent"
            ;;
    esac
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📊 SETUP SUMMARY"
echo "═══════════════════════════════════════════════════════════════"

if [[ ${#INSTALLED[@]} -gt 0 ]]; then
    echo "✅ Ready: ${INSTALLED[*]}"
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
    echo "❌ Need manual setup: ${FAILED[*]}"
fi

echo ""
echo "Next: Edit .env with your API keys, then test with:"
echo "  ./scripts/dispatch-unified.sh <repo> \"Test task\" --executor=${INSTALLED[0]:-aider}"
