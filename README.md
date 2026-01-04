# Outpost

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

