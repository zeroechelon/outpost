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
  --instance-ids "mi-0bbd8fed3f0650ddb" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh zeOS \"review this code\" --executor=claude"]'

# All agents
aws ssm send-command \
  --instance-ids "mi-0bbd8fed3f0650ddb" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh zeOS \"review this code\" --executor=all"]'
```

## REPOSITORY NAME FORMATS

All dispatch scripts support both bare and namespaced repository names:

```bash
# Bare format (traditional)
dispatch.sh "awsaudit" "analyze code"
dispatch.sh "zeOS" "review changes"

# Namespaced format (GitHub-style) - NEW
dispatch.sh "rgsuarez/awsaudit" "analyze code"
dispatch.sh "rgsuarez/zeOS" "review changes"

# Both formats produce identical results:
# - Namespace automatically stripped (rgsuarez/awsaudit → awsaudit)
# - Cache path: /home/ubuntu/claude-executor/repos/awsaudit
# - Workspace: /tmp/workspaces/awsaudit_<timestamp>
```

This feature enables seamless integration with external APIs (like MCPify) that send fully-qualified GitHub repository names.

## TROUBLESHOOTING

### Empty Workspace / Rsync Cache Failures

**Symptom:** Agent reports empty workspace or "no files found" errors.

**Cause:** Repository name format mismatch. If caller sends "rgsuarez/awsaudit" but dispatch script expects "awsaudit", cache path construction fails:
- Expected: `/home/ubuntu/claude-executor/repos/awsaudit`
- Incorrect: `/home/ubuntu/claude-executor/repos/rgsuarez/awsaudit` (doesn't exist)

**Solution:** All dispatch scripts (v1.5+) now automatically strip namespace prefixes. Verify your scripts are up to date:

```bash
# Check dispatch script version
grep "v1\.[5-6]" /home/ubuntu/claude-executor/dispatch.sh

# Verify namespace stripping present
grep "REPO_NAME##" /home/ubuntu/claude-executor/dispatch.sh
```

**Rollback:** If issues persist, restore from backup:
```bash
# Backups located in:
ls -lt /home/ubuntu/claude-executor/scripts_backup_*/
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Empty workspace` | Namespace not stripped | Update to dispatch scripts v1.5+ |
| `rsync: link_stat failed` | Cache path incorrect | Verify namespace stripping logic |
| `fatal: detected dubious ownership` | Git safe.directory not configured | Run: `git config --global --add safe.directory <path>` |

### Related Documentation

- Blueprint: `/home/richie/projects/outpost/blueprints/OUTPOST_DISPATCH_NAMESPACE_FIX.bp.md`
- Specification: `/home/richie/projects/outpost/docs/DISPATCH_NAMESPACE_FIX_SPEC.md`
- Test Suite: `/home/richie/projects/outpost/tests/unit/test_namespace_parsing.sh`

## REFERENCE

Full API contract: https://github.com/rgsuarez/outpost/blob/main/OUTPOST_INTERFACE.md

---
*This file exists to prevent AI agents from making incorrect assumptions about CLI invocation.*
