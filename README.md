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

**Requirements:**
- **Linux or macOS** server with SSH access and sudo privileges
- GitHub account with personal access token
- At least one AI agent credential (Aider with DeepSeek is cheapest at ~$0.14/MTok)

---

## Quick Start (For AI Agents)

If you are an AI agent helping a user set up Outpost, follow these steps:

### Step 1: Gather Requirements

Prompt your user for:

```yaml
required:
  server_host: "IP or hostname of a Linux or macOS server"
  server_user: "SSH username with sudo privileges"
  ssh_access: "SSH key or password access to server"
  github_token: "GitHub PAT with repo read/write access"

optional_agent_credentials:
  deepseek_api_key: "For Aider (cheapest - recommended to start)"
  anthropic_api_key: "For Claude Code"
  openai_api_key: "For Codex CLI"
  google_api_key: "For Gemini CLI"
```

**Minimum viable setup:** Server + GitHub token + DeepSeek API key (~$0.14/MTok)

### Step 2: Server Setup

SSH to the server and execute:

```bash
# Create directory
sudo mkdir -p /opt/outpost
sudo chown $USER:$USER /opt/outpost
cd /opt/outpost

# Clone Outpost
git clone https://github.com/zeroechelon/outpost.git .

# Configure environment
cp .env.template .env
nano .env  # Add credentials (see detailed instructions below)

# Make scripts executable
chmod +x scripts/*.sh

# Install your chosen agent(s)
./scripts/setup-agents.sh
```

### Step 3: Test Dispatch

```bash
./scripts/dispatch-unified.sh <your-repo-name> "Add a README.md file" --executor=aider
```

---

## Agent Setup Instructions

### Aider with DeepSeek (Recommended - Cheapest)

**Cost: ~$0.14 per million tokens** — Extremely affordable for high-volume use.

Aider is an AI pair programming tool. DeepSeek provides the cheapest high-quality code model.

#### Step 1: Get DeepSeek API Key

1. Go to [platform.deepseek.com](https://platform.deepseek.com/)
2. Click **Sign Up** or **Log In**
3. After login, click your profile icon → **API Keys**
4. Click **Create new API key**
5. Give it a name (e.g., "outpost")
6. **Copy the key immediately** (starts with `sk-`) — you won't see it again

#### Step 2: Install Aider

```bash
# Check Python version (need 3.9+)
python3 --version

# Install via pip
pip3 install aider-chat

# Or use pipx for isolated install (recommended)
pip3 install pipx
pipx install aider-chat

# Verify installation
aider --version
```

**macOS note:** If you get permission errors, use `pip3 install --user aider-chat`

#### Step 3: Configure Outpost

Edit `/opt/outpost/.env`:

```bash
GITHUB_TOKEN="ghp_your_github_token_here"
GITHUB_USER="your-github-username"
DEEPSEEK_API_KEY="sk-your-deepseek-key-here"
```

#### Step 4: Test

```bash
cd /opt/outpost
./scripts/dispatch-unified.sh your-test-repo "Create a hello world script" --executor=aider
```

---

### Claude Code (Most Capable)

**Cost: ~$15/MTok input, ~$75/MTok output OR $100/mo unlimited (Max subscription)**

Claude Code is Anthropic's coding agent — best for complex reasoning and architecture.

#### Option A: API Key (Pay-per-use)

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Click **API Keys** in the left sidebar
4. Click **Create Key**
5. Name it (e.g., "outpost") and copy the key (starts with `sk-ant-`)

Add to `.env`:
```bash
ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

#### Option B: OAuth with Max Subscription ($100/mo unlimited)

1. Subscribe to **Claude Max** at [claude.ai/upgrade](https://claude.ai/upgrade)
2. Install the CLI:
   ```bash
   # Via npm (Node.js required)
   npm install -g @anthropic-ai/claude-code
   
   # Or via Homebrew (macOS)
   brew install anthropic-ai/tap/claude-code
   ```
3. Authenticate via OAuth:
   ```bash
   claude login
   ```
   This opens your browser. Log in with your Claude Max account and authorize.

4. Verify:
   ```bash
   claude --version
   claude whoami  # Should show your account
   ```

**No API key needed in `.env` if using OAuth** — the CLI handles authentication.

---

### OpenAI Codex (Fast Code Generation)

**Cost: ~$10/MTok OR $20/mo (ChatGPT Pro subscription)**

#### Option A: API Key (Pay-per-use)

1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Click your profile (top right) → **API keys**
4. Click **Create new secret key**
5. Name it and copy (starts with `sk-`)

Add to `.env`:
```bash
OPENAI_API_KEY="sk-your-openai-key-here"
```

#### Option B: OAuth with ChatGPT Pro ($20/mo)

1. Subscribe to **ChatGPT Pro** at [chat.openai.com](https://chat.openai.com/)
2. Install the CLI:
   ```bash
   npm install -g @openai/codex
   ```
3. Authenticate:
   ```bash
   codex login
   ```
   Complete the browser OAuth flow with your ChatGPT Pro account.

4. Verify:
   ```bash
   codex --version
   ```

---

### Gemini CLI (Google's Model)

**Cost: Free tier (60 req/min), then ~$0.50/MTok**

#### Option A: API Key (Recommended for simplicity)

1. Go to [aistudio.google.com](https://aistudio.google.com/)
2. Sign in with your Google account
3. Click **Get API Key** in the top right
4. Click **Create API key in new project** (or select existing project)
5. Copy the key

Add to `.env`:
```bash
GOOGLE_API_KEY="your-google-api-key-here"
```

#### Option B: OAuth with Google Cloud (Higher limits)

For production use with higher rate limits:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the **Generative Language API**:
   - Go to APIs & Services → Library
   - Search "Generative Language API"
   - Click Enable
4. Create OAuth credentials:
   - Go to APIs & Services → Credentials
   - Click **Create Credentials** → **OAuth client ID**
   - Select "Desktop app"
   - Download the JSON file
5. Configure:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-credentials.json"
   ```

#### Install Gemini CLI

```bash
pip3 install google-generativeai

# Verify
python3 -c "import google.generativeai as genai; print('OK')"
```

---

## Usage Reference

### Basic Dispatch

```bash
# Single agent
./scripts/dispatch-unified.sh <repo> "<task>" --executor=aider

# Multiple agents in parallel
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude,aider

# All configured agents
./scripts/dispatch-unified.sh <repo> "<task>" --executor=all
```

### Agent Summary

| Agent | Credential | Cost | Best For |
|-------|-----------|------|----------|
| `aider` | `DEEPSEEK_API_KEY` | ~$0.14/MTok | Budget-friendly, iterative coding |
| `claude` | `ANTHROPIC_API_KEY` or OAuth | $100/mo or ~$15-75/MTok | Complex reasoning, architecture |
| `codex` | `OPENAI_API_KEY` or OAuth | $20/mo or ~$10/MTok | Fast code generation |
| `gemini` | `GOOGLE_API_KEY` or OAuth | Free tier available | Broad context, analysis |

### Context Injection (Optional)

For continuity-aware execution:

```bash
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude --context
./scripts/dispatch-unified.sh <repo> "<task>" --executor=claude --context=full
```

Works best with [zeOS](https://github.com/rgsuarez/zeOS) project structure.

### Output Location

```
/opt/outpost/runs/<run-id>/
├── task.md          # Original task
├── output.log       # Agent output
├── summary.json     # Metadata
├── diff.patch       # Git changes
└── workspace/       # Modified repo copy
```

---

## Complete .env Reference

```bash
# ═══════════════════════════════════════════════════════════════════
# REQUIRED
# ═══════════════════════════════════════════════════════════════════
GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
GITHUB_USER="your-username"

# ═══════════════════════════════════════════════════════════════════
# AGENT CREDENTIALS (at least one)
# ═══════════════════════════════════════════════════════════════════
DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"      # For Aider (CHEAPEST)
ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxx" # For Claude
OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxx"        # For Codex
GOOGLE_API_KEY="xxxxxxxxxxxxxxxx"           # For Gemini

# ═══════════════════════════════════════════════════════════════════
# OPTIONAL
# ═══════════════════════════════════════════════════════════════════
AGENT_TIMEOUT=600  # Seconds before timeout (default: 10 min)
```

---

## AI Agent Implementation Checklist

```
[ ] 1. User has SSH access to Linux or macOS server with sudo
[ ] 2. User has GitHub PAT with repo read/write access
[ ] 3. Clone outpost to /opt/outpost, copy .env.template to .env
[ ] 4. Get DeepSeek API key (cheapest) from platform.deepseek.com
[ ] 5. Add GITHUB_TOKEN, GITHUB_USER, DEEPSEEK_API_KEY to .env
[ ] 6. pip3 install aider-chat
[ ] 7. chmod +x scripts/*.sh
[ ] 8. Test: ./scripts/dispatch-unified.sh <repo> "Add README" --executor=aider
[ ] 9. Optional: Add more agents as needed
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `Permission denied` | `chmod +x scripts/*.sh` |
| `aider: command not found` | `pip3 install aider-chat` |
| `GITHUB_TOKEN not set` | Add to `.env` file |
| `Timeout` | Increase `AGENT_TIMEOUT` in `.env` |

---

## License

MIT License — See [LICENSE](LICENSE)

---

## Related

- [zeOS](https://github.com/rgsuarez/zeOS) — Enhanced context injection

---

*Outpost v1.5 — Works standalone. Enhanced with zeOS.*
