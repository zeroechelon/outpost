#!/bin/bash
# install.sh - Outpost installer
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/zeroechelon/outpost/main/install.sh | bash
#
# Options (via environment variables):
#   OUTPOST_DIR      - Installation directory (default: ~/.outpost)
#   GITHUB_TOKEN     - GitHub PAT for repo access
#   GITHUB_USER      - GitHub username
#   DEEPSEEK_API_KEY - For Aider (cheapest agent)
#   OUTPOST_UNATTENDED=1 - Skip all prompts
#
# Example unattended install:
#   GITHUB_TOKEN=ghp_xxx GITHUB_USER=myuser OUTPOST_UNATTENDED=1 \
#     curl -sSL https://raw.githubusercontent.com/zeroechelon/outpost/main/install.sh | bash

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

VERSION="1.5.0"
REPO_URL="https://github.com/zeroechelon/outpost.git"
RAW_URL="https://raw.githubusercontent.com/zeroechelon/outpost/main"
DEFAULT_DIR="$HOME/.outpost"
INSTALL_DIR="${OUTPOST_DIR:-$DEFAULT_DIR}"
UNATTENDED="${OUTPOST_UNATTENDED:-0}"

# Colors (disabled if not terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# ═══════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

prompt() {
    local var_name="$1"
    local prompt_text="$2"
    local default="${3:-}"
    local secret="${4:-false}"
    
    # Check if already set via environment
    if [[ -n "${!var_name:-}" ]]; then
        return 0
    fi
    
    # Skip prompts in unattended mode
    if [[ "$UNATTENDED" == "1" ]]; then
        if [[ -n "$default" ]]; then
            eval "$var_name='$default'"
        fi
        return 0
    fi
    
    # Interactive prompt
    if [[ "$secret" == "true" ]]; then
        read -sp "$prompt_text: " value
        echo ""
    else
        if [[ -n "$default" ]]; then
            read -p "$prompt_text [$default]: " value
            value="${value:-$default}"
        else
            read -p "$prompt_text: " value
        fi
    fi
    
    eval "$var_name='$value'"
}

check_command() {
    command -v "$1" &>/dev/null
}

# ═══════════════════════════════════════════════════════════════════
# MAIN INSTALLER
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🚀 OUTPOST INSTALLER v${VERSION}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Linux*)  OS_TYPE="linux" ;;
    Darwin*) OS_TYPE="macos" ;;
    *)       error "Unsupported OS: $OS. Outpost supports Linux and macOS." ;;
esac
info "Detected OS: $OS_TYPE"

# Check dependencies
info "Checking dependencies..."

MISSING_DEPS=()
check_command git || MISSING_DEPS+=("git")
check_command curl || MISSING_DEPS+=("curl")
check_command bash || MISSING_DEPS+=("bash")

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    error "Missing required dependencies: ${MISSING_DEPS[*]}
    
Install them first:
  Ubuntu/Debian: sudo apt install ${MISSING_DEPS[*]}
  macOS:         brew install ${MISSING_DEPS[*]}
  RHEL/CentOS:   sudo yum install ${MISSING_DEPS[*]}"
fi
success "All dependencies found"

# Check for existing installation
if [[ -d "$INSTALL_DIR" ]]; then
    warn "Existing installation found at $INSTALL_DIR"
    
    if [[ "$UNATTENDED" == "1" ]]; then
        info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull origin main 2>/dev/null || {
            warn "Git pull failed, re-cloning..."
            cd ..
            rm -rf "$INSTALL_DIR"
            git clone "$REPO_URL" "$INSTALL_DIR"
        }
    else
        read -p "Update existing installation? [Y/n]: " update_choice
        if [[ "${update_choice:-Y}" =~ ^[Yy] ]]; then
            info "Updating..."
            cd "$INSTALL_DIR"
            git pull origin main 2>/dev/null || {
                warn "Git pull failed, re-cloning..."
                cd ..
                rm -rf "$INSTALL_DIR"
                git clone "$REPO_URL" "$INSTALL_DIR"
            }
        else
            error "Installation cancelled"
        fi
    fi
else
    # Fresh install
    info "Installing to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR" 2>&1 | grep -v "^Cloning" || true
fi

cd "$INSTALL_DIR"
success "Repository ready"

# Make scripts executable
chmod +x scripts/*.sh 2>/dev/null || true
success "Scripts are executable"

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

echo ""
info "Configuring Outpost..."

# Create .env if it doesn't exist
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cp "$INSTALL_DIR/.env.template" "$INSTALL_DIR/.env" 2>/dev/null || {
        cat > "$INSTALL_DIR/.env" << 'ENVEOF'
# Outpost Configuration
GITHUB_TOKEN=""
GITHUB_USER=""
DEEPSEEK_API_KEY=""
ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GOOGLE_API_KEY=""
AGENT_TIMEOUT=600
ENVEOF
    }
fi

# Prompt for required credentials
echo ""
if [[ "$UNATTENDED" != "1" ]]; then
    info "Enter your credentials (or press Enter to skip):"
    echo ""
fi

prompt GITHUB_TOKEN "GitHub Personal Access Token" "" true
prompt GITHUB_USER "GitHub Username"
prompt DEEPSEEK_API_KEY "DeepSeek API Key (for Aider - cheapest)" "" true

# Write credentials to .env
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    sed -i.bak "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=\"$GITHUB_TOKEN\"|" "$INSTALL_DIR/.env" 2>/dev/null || \
    sed -i '' "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=\"$GITHUB_TOKEN\"|" "$INSTALL_DIR/.env"
fi

if [[ -n "${GITHUB_USER:-}" ]]; then
    sed -i.bak "s|^GITHUB_USER=.*|GITHUB_USER=\"$GITHUB_USER\"|" "$INSTALL_DIR/.env" 2>/dev/null || \
    sed -i '' "s|^GITHUB_USER=.*|GITHUB_USER=\"$GITHUB_USER\"|" "$INSTALL_DIR/.env"
fi

if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
    sed -i.bak "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=\"$DEEPSEEK_API_KEY\"|" "$INSTALL_DIR/.env" 2>/dev/null || \
    sed -i '' "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=\"$DEEPSEEK_API_KEY\"|" "$INSTALL_DIR/.env"
fi

# Clean up backup files
rm -f "$INSTALL_DIR/.env.bak" 2>/dev/null

# Secure .env permissions
chmod 600 "$INSTALL_DIR/.env"
success "Configuration saved to $INSTALL_DIR/.env"

# ═══════════════════════════════════════════════════════════════════
# PATH INTEGRATION
# ═══════════════════════════════════════════════════════════════════

echo ""
info "Setting up PATH integration..."

# Determine bin directory
if [[ -w "/usr/local/bin" ]]; then
    BIN_DIR="/usr/local/bin"
elif [[ -d "$HOME/.local/bin" ]]; then
    BIN_DIR="$HOME/.local/bin"
else
    mkdir -p "$HOME/.local/bin"
    BIN_DIR="$HOME/.local/bin"
fi

# Create wrapper script
WRAPPER="$BIN_DIR/outpost"
cat > "$WRAPPER" << EOF
#!/bin/bash
# Outpost wrapper - dispatches to the actual scripts
OUTPOST_DIR="$INSTALL_DIR"
export OUTPOST_DIR

case "\${1:-}" in
    dispatch|run)
        shift
        exec "\$OUTPOST_DIR/scripts/dispatch-unified.sh" "\$@"
        ;;
    list|runs)
        exec "\$OUTPOST_DIR/scripts/list-runs.sh" "\$@"
        ;;
    promote|push)
        shift
        exec "\$OUTPOST_DIR/scripts/promote-workspace.sh" "\$@"
        ;;
    setup)
        exec "\$OUTPOST_DIR/scripts/setup-agents.sh" "\$@"
        ;;
    config)
        \${EDITOR:-nano} "\$OUTPOST_DIR/.env"
        ;;
    update)
        cd "\$OUTPOST_DIR" && git pull origin main
        ;;
    version|--version|-v)
        echo "Outpost v$VERSION"
        echo "Install: \$OUTPOST_DIR"
        ;;
    help|--help|-h|"")
        echo "Outpost - Multi-agent coding executor"
        echo ""
        echo "Usage: outpost <command> [args]"
        echo ""
        echo "Commands:"
        echo "  dispatch <repo> \"<task>\" [--executor=<agent>] [--context]"
        echo "  list                    List recent runs"
        echo "  promote <run-id> \"msg\" Push changes to GitHub"
        echo "  setup                   Install/check agent CLIs"
        echo "  config                  Edit .env configuration"
        echo "  update                  Update Outpost to latest"
        echo "  version                 Show version info"
        echo ""
        echo "Examples:"
        echo "  outpost dispatch myrepo \"Add tests\" --executor=aider"
        echo "  outpost dispatch myrepo \"Fix bug\" --executor=claude,aider"
        echo "  outpost list"
        echo "  outpost promote 20260104-123456-aider-abc123 \"Added tests\""
        ;;
    *)
        # Pass through to dispatch-unified
        exec "\$OUTPOST_DIR/scripts/dispatch-unified.sh" "\$@"
        ;;
esac
EOF

chmod +x "$WRAPPER"
success "Created wrapper at $WRAPPER"

# Check if BIN_DIR is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    warn "$BIN_DIR is not in your PATH"
    
    # Suggest adding to PATH
    SHELL_RC=""
    case "$SHELL" in
        */zsh)  SHELL_RC="$HOME/.zshrc" ;;
        */bash) SHELL_RC="$HOME/.bashrc" ;;
        *)      SHELL_RC="$HOME/.profile" ;;
    esac
    
    if [[ "$UNATTENDED" != "1" ]]; then
        read -p "Add $BIN_DIR to PATH in $SHELL_RC? [Y/n]: " add_path
        if [[ "${add_path:-Y}" =~ ^[Yy] ]]; then
            echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_RC"
            success "Added to $SHELL_RC (restart terminal or run: source $SHELL_RC)"
        fi
    else
        echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_RC"
        info "Added $BIN_DIR to $SHELL_RC"
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# VERIFY INSTALLATION
# ═══════════════════════════════════════════════════════════════════

echo ""
info "Verifying installation..."

# Check if .env has required values
source "$INSTALL_DIR/.env" 2>/dev/null || true

MISSING_CONFIG=()
[[ -z "${GITHUB_TOKEN:-}" ]] && MISSING_CONFIG+=("GITHUB_TOKEN")
[[ -z "${GITHUB_USER:-}" ]] && MISSING_CONFIG+=("GITHUB_USER")

HAS_AGENT=false
[[ -n "${DEEPSEEK_API_KEY:-}" ]] && HAS_AGENT=true
[[ -n "${ANTHROPIC_API_KEY:-}" ]] && HAS_AGENT=true
[[ -n "${OPENAI_API_KEY:-}" ]] && HAS_AGENT=true
[[ -n "${GOOGLE_API_KEY:-}" ]] && HAS_AGENT=true

if [[ ${#MISSING_CONFIG[@]} -gt 0 ]]; then
    warn "Missing required config: ${MISSING_CONFIG[*]}"
    warn "Edit with: outpost config"
fi

if [[ "$HAS_AGENT" != "true" ]]; then
    warn "No agent credentials configured"
    warn "Add at least one API key with: outpost config"
fi

# ═══════════════════════════════════════════════════════════════════
# COMPLETE
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✓ OUTPOST INSTALLED SUCCESSFULLY${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Install directory: $INSTALL_DIR"
echo "  Wrapper command:   outpost"
echo ""
echo "  Next steps:"
echo "    1. Configure credentials: outpost config"
echo "    2. Install agent CLIs:    outpost setup"
echo "    3. Test dispatch:         outpost dispatch <repo> \"Add README\" --executor=aider"
echo ""
echo "  Documentation: https://github.com/zeroechelon/outpost"
echo ""

# Offer to run setup-agents
if [[ "$UNATTENDED" != "1" && "$HAS_AGENT" == "true" ]]; then
    read -p "Run agent setup now? [Y/n]: " run_setup
    if [[ "${run_setup:-Y}" =~ ^[Yy] ]]; then
        echo ""
        "$INSTALL_DIR/scripts/setup-agents.sh"
    fi
fi
