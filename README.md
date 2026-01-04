# Outpost

> Multi-agent coding executor. Dispatch tasks to Claude, Codex, Gemini, and Aider in parallel.

## One-Line Install

```bash
curl -sSL https://raw.githubusercontent.com/zeroechelon/outpost/main/install.sh | bash
```

**Unattended install** (for AI agents):
```bash
GITHUB_TOKEN=ghp_xxx GITHUB_USER=myuser DEEPSEEK_API_KEY=sk-xxx OUTPOST_UNATTENDED=1 \
  curl -sSL https://raw.githubusercontent.com/zeroechelon/outpost/main/install.sh | bash
```

## Quick Start

After install:

```bash
# Configure credentials
outpost config

# Install agent CLIs
outpost setup

# Run your first dispatch
outpost dispatch <your-repo> "Add a README" --executor=aider
```

## Agents

| Agent | Credential | Cost |
|-------|-----------|------|
| `aider` | `DEEPSEEK_API_KEY` | ~$0.14/MTok (cheapest) |
| `claude` | `ANTHROPIC_API_KEY` | $100/mo or ~$15-75/MTok |
| `codex` | `OPENAI_API_KEY` | $20/mo or ~$10/MTok |
| `gemini` | `GOOGLE_API_KEY` | Free tier available |

## Usage

```bash
# Single agent
outpost dispatch <repo> "<task>" --executor=aider

# Multiple agents in parallel
outpost dispatch <repo> "<task>" --executor=claude,aider

# All agents
outpost dispatch <repo> "<task>" --executor=all

# With context injection
outpost dispatch <repo> "<task>" --executor=claude --context
```

## Commands

| Command | Description |
|---------|-------------|
| `outpost dispatch` | Run task on agent(s) |
| `outpost list` | Show recent runs |
| `outpost promote` | Push changes to GitHub |
| `outpost setup` | Install agent CLIs |
| `outpost config` | Edit credentials |
| `outpost update` | Update Outpost |

## Documentation

- [Server Setup](docs/SETUP_SERVER.md) — Manual install on Linux/macOS
- [Agent Setup](docs/SETUP_AGENTS.md) — Configure API keys and OAuth
- [Context Injection](docs/CONTEXT_INJECTION_SPEC.md) — Enhanced with zeOS

## Requirements

- Linux or macOS
- git, curl, bash
- GitHub PAT with repo access
- At least one agent credential

## License

MIT — See [LICENSE](LICENSE)

## Related

- [zeOS](https://github.com/rgsuarez/zeOS) — Enhanced context injection

---

*Outpost v1.5.0*

