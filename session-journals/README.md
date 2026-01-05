# Session Journals

This directory contains session journals for the **Outpost** project.

## Overview

Session journals document AI-human collaborative work sessions, providing:
- Audit trails for all changes
- Context restoration for resumed sessions
- Knowledge preservation for future reference

## File Naming Convention

```
YYYY-MM-DD-NNN-topic.md
```

| Component | Description | Example |
|-----------|-------------|---------|
| `YYYY-MM-DD` | UTC date of session start | `2026-01-05` |
| `NNN` | Daily sequence number (001-999) | `001` |
| `topic` | Kebab-case session topic | `auth-refactor` |

## Required Frontmatter

Every journal must begin with:

```yaml
---
type: session-journal
project: outpost
status: active | completed | abandoned | paused
started: 2026-01-05T10:30:00Z
ended: null | 2026-01-05T14:30:00Z
---
```

## Creating a New Journal

1. Determine the next sequence number for today
2. Create file with proper naming convention
3. Add required frontmatter with `status: active`
4. Document session objectives
5. Add checkpoints following Shell Protocol Delta Rule
6. Update `status` and `ended` when session concludes

## Checkpoint Format

```markdown
## Checkpoint: Brief Title

**Time:** HH:MM UTC
**Delta:** One-line change summary

### State Before
...

### Actions Taken
1. First action
2. Second action

### State After
...

### Artifacts
- Created: path/to/file
- Modified: path/to/other
```

## Standards Reference

Full specification: `ZEOS_MODULE_004_JOURNAL_SCHEMA`

---

*This README was generated according to ZEOS_MODULE_004_JOURNAL_SCHEMA v1.0.0*
