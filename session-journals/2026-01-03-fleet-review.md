# Session Journal: 2026-01-03 Outpost Fleet Review & Fixes

**Status:** In Progress
**Project:** Outpost
**Timestamp:** 2026-01-03T07:55:00Z
**Batch ID:** 20260103-074707-batch-pr03

---

## Executive Summary

Conducted 4-agent parallel review of Outpost codebase. All agents (Claude Code, Gemini, Codex, Aider) completed successfully. Identified critical bugs, security issues, and improvement opportunities.

---

## Fleet Review Results

### Agent Performance

| Agent | Run ID | Status | Quality |
|-------|--------|--------|---------|
| Claude Code | 20260103-074707-l1ar16 | ✅ success | Actionable summary |
| Gemini | 20260103-074707-gemini-sezcwr | ✅ success | Deep analysis |
| Codex | 20260103-074707-codex-8nrrk4 | ✅ success | Critical bugs found |
| Aider | 20260103-074707-aider-yuk2we | ✅ success | Generic (git issue) |

---

## Issues Identified

### 🔴 CRITICAL

#### C1: push-changes.sh is BROKEN
- **Found by:** Codex
- **Location:** scripts/push-changes.sh
- **Problem:** Script commits from `repos/` (shared cache) but v1.3 runs write to `runs/<run-id>/workspace/`. Changes never get pushed.
- **Fix:** Create `promote-workspace.sh` that accepts run-id, copies changes from workspace to repos/, then pushes.

#### C2: Hardcoded GitHub PAT in Scripts
- **Found by:** All agents
- **Locations:** dispatch.sh:17, dispatch-codex.sh:17, dispatch-gemini.sh:17, dispatch-aider.sh:18, dispatch-unified.sh:30
- **Problem:** Security risk, rotation hazard
- **Fix:** Use environment variable only, fail fast if missing

#### C3: Hardcoded origin/main Branch
- **Found by:** Codex
- **Locations:** All dispatch scripts (~line 49-50)
- **Problem:** Repos with master or other defaults fail silently
- **Fix:** Detect origin/HEAD and use that

### 🟠 HIGH PRIORITY

#### H1: No Timeout on Agent Execution
- **Found by:** All agents
- **Problem:** Hung CLI waits until SSM timeout (1 hour)
- **Fix:** Wrap agent execution in `timeout 10m`

#### H2: SSM Output Limit ~24KB
- **Found by:** Gemini
- **Problem:** Large outputs truncate
- **Fix:** Future - S3 offloading (defer to v1.4)

#### H3: Race Condition on Shared Cache
- **Found by:** Gemini
- **Problem:** Concurrent dispatches to same repo could corrupt cache
- **Fix:** Add flock around pre-flight fetch in dispatch-unified.sh

#### H4: No "running" Status Written
- **Found by:** Codex
- **Problem:** Killed runs invisible to list-runs.sh
- **Fix:** Write summary.json with status:running at start

### 🟡 DOCUMENTATION

#### D1: README.md Shows 3 Agents
- Should show 4 (Aider missing)

#### D2: MULTI_AGENT_INTEGRATION.md Stale Models
- Shows claude-sonnet-4, should be claude-opus-4-5-20251101
- Shows gemini-2.5-pro, should be gemini-3-pro-preview

#### D3: No Contributor Guide
- Need instructions for adding new agents

### 🐛 BUG DISCOVERED

#### B1: Aider Git Not Initialized
- Aider output shows "Git repo: none"
- Workspace isolation not setting up git for Aider properly

---

## Fix Implementation Plan

### Phase 1: Critical Security & Functionality
- [x] Document all issues (this file)
- [ ] C2: Externalize GitHub PAT
- [ ] C1: Create promote-workspace.sh
- [ ] C3: Detect default branch

### Phase 2: Reliability
- [ ] H1: Add timeout to all dispatch scripts
- [ ] H3: Add flock for cache updates
- [ ] H4: Write running status at start
- [ ] B1: Fix Aider git initialization

### Phase 3: Documentation
- [ ] D1: Update README.md
- [ ] D2: Update MULTI_AGENT_INTEGRATION.md

---

## Checkpoints

| Checkpoint | Time | Status |
|------------|------|--------|
| Documentation complete | | |
| Phase 1 complete | | |
| Phase 2 complete | | |
| Phase 3 complete | | |

---

*Session in progress*
