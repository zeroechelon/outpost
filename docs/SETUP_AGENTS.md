# Agent Setup Guide

> Detailed setup instructions for each AI agent

## Overview

Outpost supports 4 AI coding agents. You need at least one configured.

| Agent | Cost | Best For |
|-------|------|----------|
| Aider + DeepSeek | ~$0.14/MTok | Budget-friendly, recommended start |
| Claude Code | $100/mo or ~$15-75/MTok | Complex reasoning, architecture |
| OpenAI Codex | $20/mo or ~$10/MTok | Fast code generation |
| Gemini | Free tier available | Broad context, analysis |

---

## Aider with DeepSeek (Recommended)

**Cost:** ~$0.14 per million tokens — extremely affordable.

### Step 1: Get DeepSeek API Key

1. Go to [platform.deepseek.com](https://platform.deepseek.com/)
2. Click **Sign Up** or **Log In**
3. Click profile icon → **API Keys**
4. Click **Create new API key**
5. Name it (e.g., "outpost")
6. **Copy immediately** — you won't see it again

### Step 2: Install Aider

```bash
# Python 3.9+ required
python3 --version

# Install
pip3 install aider-chat

# Verify
aider --version
```

### Step 3: Configure

Add to `/opt/outpost/.env`:
```bash
DEEPSEEK_API_KEY="sk-your-key-here"
```

### Step 4: Test

```bash
./scripts/dispatch-unified.sh your-repo "Add hello world" --executor=aider
```

---

## Claude Code

**Cost:** ~$15/MTok input, ~$75/MTok output, OR $100/mo unlimited

### Option A: API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Click **API Keys** → **Create Key**
4. Copy key (starts with `sk-ant-`)

Add to `.env`:
```bash
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
```

### Option B: OAuth (Max Subscription)

1. Subscribe to Claude Max at [claude.ai/upgrade](https://claude.ai/upgrade)
2. Install CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
3. Authenticate:
   ```bash
   claude login
   ```
   Complete browser OAuth flow.

4. Verify:
   ```bash
   claude whoami
   ```

No `.env` key needed with OAuth.

---

## OpenAI Codex

**Cost:** ~$10/MTok or $20/mo with Pro

### Option A: API Key

1. Go to [platform.openai.com](https://platform.openai.com/)
2. Click profile → **API keys** → **Create new secret key**
3. Copy key (starts with `sk-`)

Add to `.env`:
```bash
OPENAI_API_KEY="sk-your-key-here"
```

### Option B: OAuth (ChatGPT Pro)

1. Subscribe to ChatGPT Pro at [chat.openai.com](https://chat.openai.com/)
2. Install CLI:
   ```bash
   npm install -g @openai/codex
   ```
3. Authenticate:
   ```bash
   codex login
   ```

---

## Gemini

**Cost:** Free tier (60 req/min), then ~$0.50/MTok

### Option A: API Key (Simple)

1. Go to [aistudio.google.com](https://aistudio.google.com/)
2. Sign in with Google
3. Click **Get API Key** → **Create API key**
4. Copy key

Add to `.env`:
```bash
GOOGLE_API_KEY="your-key-here"
```

### Option B: OAuth (Google Cloud)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create/select project
3. Enable **Generative Language API**
4. Create OAuth credentials (Desktop app)
5. Download JSON, set:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
   ```

---

## Complete .env Example

```bash
# Required
GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
GITHUB_USER="your-username"

# Agents (at least one)
DEEPSEEK_API_KEY="sk-xxxxxxxx"        # Aider
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"   # Claude
OPENAI_API_KEY="sk-xxxxxxxx"          # Codex  
GOOGLE_API_KEY="xxxxxxxx"             # Gemini

# Optional
AGENT_TIMEOUT=600
```

---

## Verification

```bash
# Check which agents are configured
./scripts/setup-agents.sh

# Test each agent
./scripts/dispatch-unified.sh test-repo "Add README" --executor=aider
./scripts/dispatch-unified.sh test-repo "Add README" --executor=claude
./scripts/dispatch-unified.sh test-repo "Add README" --executor=codex
./scripts/dispatch-unified.sh test-repo "Add README" --executor=gemini
```
