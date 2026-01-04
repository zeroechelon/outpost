# Outpost Master Roadmap

**Last Updated:** 2026-01-04
**Current Phase:** 1.5 (Infrastructure Migration)
**Next Milestone:** Dedicated server operational

---

## Phase Summary

| Phase | Name | Status | Target |
|-------|------|--------|--------|
| 1.0 | Core Fleet | ✅ Complete | — |
| 1.5 | **Infrastructure Migration** | 🔄 Active | 2026-01-10 |
| 2.0 | Outpost-as-a-Service (OaaS) | 📋 Planned | 2026-02 |
| 3.0 | Multi-Tenant Scaling | 📋 Future | TBD |

---

## Phase 1.0: Core Fleet ✅

**Status:** Complete (v1.5.0 released 2026-01-04)

### Delivered
- [x] 4-agent fleet (Claude Code, Codex, Gemini, Aider)
- [x] Unified dispatch (`dispatch-unified.sh`)
- [x] Workspace isolation per task
- [x] Context injection system (minimal/standard/full)
- [x] ANCHORS section (protected from summarization)
- [x] Security scrubbing (15+ patterns)
- [x] Public release (`zeroechelon/outpost`)
- [x] Curl installer (`install.sh`)
- [x] Fleet consultation pattern validated

### Documentation
- OUTPOST_INTERFACE.md (API contract)
- CONTEXT_INJECTION_SPEC.md
- SETUP_SERVER.md / SETUP_AGENTS.md

---

## Phase 1.5: Infrastructure Migration 🔄

**Status:** Active
**Goal:** Dedicated Outpost server, separate from SOC

### Problem
- Outpost and SOC share same Lightsail instance
- Causing conflicts and resource contention
- Need isolation before OaaS development

### Decision
- **Provider:** AWS Lightsail (SSM compatibility, minimal changes)
- **Instance:** large_3_0 (8GB RAM, 2 vCPU, 160GB disk)
- **Cost:** $44/mo
- **Fallback:** Can migrate to Hetzner ($15/mo) with HTTP API later

### Tasks
- [ ] Provision `outpost-prod` Lightsail instance
- [ ] Configure SSM hybrid activation
- [ ] Clone dispatch scripts and agent CLIs
- [ ] Configure .env with API keys
- [ ] Test all 4 agents on new server
- [ ] Update SSM instance ID in:
  - [ ] zeOS apps/outpost/OUTPOST_SOUL.md
  - [ ] zeOS apps/REGISTRY.json
  - [ ] rgsuarez/outpost OUTPOST_INTERFACE.md
  - [ ] User preferences
- [ ] Decommission Outpost from SOC server
- [ ] Update session journal

### Success Criteria
- All 4 agents execute successfully on new server
- SOC server has no Outpost remnants
- Zero downtime for SOC game

---

## Phase 2.0: Outpost-as-a-Service (OaaS) 📋

**Status:** Planned
**Goal:** Paid API for external developers

### Fleet Consultation (2026-01-04)
- **Vote:** 4/4 YES (with conditions)
- **Recommended Model:** BYOK (Bring Your Own Keys) for MVP
- **Critical Risk:** API ToS compliance (need provider agreements)
- **Key Differentiator:** Context injection + intelligent routing

### MVP Scope (BYOK)
- [ ] REST API: POST /v1/tasks, GET /v1/tasks/:id
- [ ] API key authentication (op_live_xxx, op_test_xxx)
- [ ] Webhook callbacks on task completion
- [ ] Usage tracking (tasks/month per account)
- [ ] Simple billing tiers:
  - Free: 50 tasks/mo, public repos
  - Pro ($29): 500 tasks/mo, private repos, context injection
  - Team ($99): Unlimited, dedicated queue

### Tech Stack (Proposed)
- API Gateway: Lambda + API Gateway (serverless)
- Queue: SQS
- Worker: Dedicated Outpost server(s)
- Storage: S3 (artifacts), DynamoDB (tasks, accounts)
- Auth: Cognito or custom JWT

### Not in MVP
- Managed keys (users provide their own)
- Intelligent routing (manual agent selection)
- Multi-tenant isolation (single queue)
- SDKs (Python, TypeScript)

### Dependencies
- Phase 1.5 complete (dedicated server)
- ToS review for Claude Code, Codex, Gemini
- Domain: api.outpost.dev or similar

---

## Phase 3.0: Multi-Tenant Scaling 📋

**Status:** Future (after OaaS validation)

### Capabilities
- [ ] Auto-scaling worker pool
- [ ] Intelligent agent routing (auto-select best agent)
- [ ] Managed keys option (per-task pricing)
- [ ] Enterprise features (SSO, audit logs, dedicated queues)
- [ ] SDKs: Python, TypeScript, CLI
- [ ] SLA guarantees

### Infrastructure
- Multiple worker instances
- Load balancer
- Redis for real-time status
- CloudWatch dashboards

---

## Cost Model

| Component | Current | After 1.5 | After 2.0 |
|-----------|---------|-----------|-----------|
| Fleet subscriptions | $170/mo | $170/mo | $170/mo |
| SOC server (shared) | $24/mo | $24/mo | $24/mo |
| Outpost server | $0 | $44/mo | $44/mo |
| API infra (Lambda, etc) | $0 | $0 | ~$20/mo |
| **Total** | **$194/mo** | **$238/mo** | **$258/mo** |

Revenue target to break even: 9 Pro users ($29 × 9 = $261)

---

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-03 | v1.5 public release | Curl installer, context injection complete |
| 2026-01-04 | Fleet approves OaaS | 4/4 YES, BYOK recommended |
| 2026-01-04 | Infrastructure migration priority | SOC conflicts blocking progress |
| 2026-01-04 | Lightsail large for MVP | SSM compat, minimal changes, $44/mo |

---

## References

- [OUTPOST_INTERFACE.md](./OUTPOST_INTERFACE.md) — API contract
- [OUTPOST_INFRASTRUCTURE_ANALYSIS.md](./docs/OUTPOST_INFRASTRUCTURE_ANALYSIS.md) — Server evaluation
- [CONTEXT_INJECTION_SPEC.md](./docs/CONTEXT_INJECTION_SPEC.md) — Context system
