# Outpost

**Multi-Agent Headless Executor System v1.7.0**

Outpost enables Claude sessions to dispatch coding tasks to remote AI agents. Four agents run in parallel on dedicated infrastructure.

## Quick Invoke

**Read [INVOKE.md](INVOKE.md) for copy-paste commands.**

## Fleet

| Agent | Model | Cost |
|-------|-------|------|
| Claude Code | claude-opus-4-5-20251101 | $100/mo |
| OpenAI Codex | gpt-5.2-codex | $20/mo |
| Gemini CLI | gemini-3-pro-preview | $50/mo |
| Aider | deepseek/deepseek-coder | ~$0.14/MTok |

## Architecture

```
Orchestrator -> AWS SSM -> dispatch-unified.sh
                              |
                              +-> Claude Code
                              +-> OpenAI Codex
                              +-> Gemini CLI
                              +-> Aider
                                   |
                                   +-> Isolated workspace
```

## Features (v1.5+)

- **Context Injection:** `--context` flag prepends zeOS knowledge
- **ANCHORS Section:** Long-lived decisions protected from summarization
- **Security Scrubbing:** 15+ patterns for credential redaction
- **Workspace Isolation:** True parallelism with per-run workspaces

## Documentation

| File | Purpose |
|------|---------|
| [INVOKE.md](INVOKE.md) | **Landing file - copy-paste commands** |
| [OUTPOST_INTERFACE.md](OUTPOST_INTERFACE.md) | Full API specification |
| [docs/MULTI_AGENT_INTEGRATION.md](docs/MULTI_AGENT_INTEGRATION.md) | Integration guide |

## Server

- **Host:** outpost-prod (34.195.223.189)
- **SSM Instance:** mi-0bbd8fed3f0650ddb
- **Region:** us-east-1
- **Profile:** soc

---

*Outpost v1.7.0 - Multi-Agent Headless Executor*
