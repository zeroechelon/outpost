# ⚠️ OUTPOST EXECUTOR - AGENT CONSTRAINTS ⚠️

**DO NOT RUN CLI TOOLS DIRECTLY.**

## ❌ FORBIDDEN PATTERNS (will fail)

```bash
# These WILL FAIL - auth configs are user-specific
claude --print "..."
gemini "..."
codex "..."
aider "..."
```

## ✅ REQUIRED PATTERN (always use this)

```bash
sudo -u ubuntu /home/ubuntu/claude-executor/dispatch.sh <repo> "<task>"
sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh <repo> "<task>" --executor=<agent>
```

## WHY?

1. SSM runs as **root** but CLI credentials are configured for **ubuntu**
2. Dispatch scripts handle `sudo -u ubuntu` automatically
3. Dispatch scripts manage git ownership, env vars, and logging
4. Direct CLI calls bypass all safety/audit mechanisms

## VALID INVOCATION EXAMPLES

```bash
# Single agent
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh zeOS \"review this code\" --executor=claude"]'

# All agents
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh zeOS \"review this code\" --executor=all"]'
```

## REFERENCE

Full API contract: https://github.com/rgsuarez/outpost/blob/main/OUTPOST_INTERFACE.md

---
*This file exists to prevent AI agents from making incorrect assumptions about CLI invocation.*
