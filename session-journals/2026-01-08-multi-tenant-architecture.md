# Session Journal: Multi-Tenant Architecture Consultation

**Date:** 2026-01-08
**Project:** Outpost
**Version:** v1.8 → v2.0 Planning
**Session Type:** Architecture

---

## Session Summary

Fleet consultation on evolving Outpost from single-operator tool to multi-tenant SaaS. All 5 agents queried with standard context injection. Unanimous consensus on architecture approach.

---

## Work Completed

### 1. Fleet Consultation Dispatched

Query sent to all 5 Outpost agents:
- **Task:** Architecture consultation for multi-tenant SaaS evolution
- **Requirements:** API key auth, per-user quotas, billing isolation, horizontal scalability, audit trail
- **Context:** Standard level injection
- **Batch ID:** 20260108-071744-batch-f9e7

### 2. Agent Responses Received

| Agent | Run ID | Status | Key Recommendation |
|-------|--------|--------|-------------------|
| Claude | 20260108-071744-2tpthd | SUCCESS | BYOK model, PostgreSQL, 4-phase migration |
| Codex | 20260108-071744-codex-yv5k3j | SUCCESS | API Gateway + Kong, tenant-aware auth |
| Gemini | 20260108-071744-gemini-ctnafx | SUCCESS | Full proposal doc after existing review |
| Aider | 20260108-071744-aider-9aoyqz | SUCCESS | Code changes to dispatch-unified.sh |
| Grok | 20260108-071744-grok-eldoe2 | SUCCESS | Serverless-first, DynamoDB, 4-6 week timeline |

### 3. Consensus Architecture

```
Clients → API Gateway (auth/rate-limit) → SQS Queue → ECS Fargate Workers → Data Layer
```

**Key Components:**
- API Gateway + Lambda Authorizer
- SQS task queue with priority tiers
- ECS Fargate auto-scaling workers
- DynamoDB/PostgreSQL for users/keys/quotas/audit
- S3 for artifacts
- Secrets Manager for BYOK credentials
- Stripe for billing

### 4. Critical Decision: BYOK vs Metered

Fleet consensus: **BYOK (Bring Your Own Keys)** for MVP
- Users provide their own API keys (GitHub, Claude, OpenAI, etc.)
- Outpost charges for orchestration, not API usage
- Zero billing complexity
- Add metered billing later as premium tier

### 5. Cost Estimates

| Scale | Monthly Infrastructure |
|-------|----------------------|
| MVP (10 users) | ~$300 |
| Growth (100 users) | ~$600 |
| Scale (1000 users) | ~$2000 |

### 6. Migration Timeline

4-6 weeks across 4 phases:
1. API Layer (2 weeks)
2. BYOK + Secrets (1 week)
3. Queue + Scaling (2 weeks)
4. Billing + Quotas (1 week)

---

## Artifacts Generated (in agent workspaces)

- `docs/MULTI_TENANT_ARCHITECTURE.md` by Grok
- `docs/MULTI_TENANT_ARCHITECTURE.md` by Aider
- Code modifications to `dispatch-unified.sh` by Aider (not promoted)

---

## Next Steps

1. Analyze Grok and Aider workspace artifacts
2. Draft consolidated specification
3. Generate official Blueprint with --depth 2
4. Implementation planning

---

## Decisions Made

- Multi-tenant architecture required for product roadmap
- BYOK billing model for MVP (fleet consensus)
- API Gateway + SQS + Fargate as target architecture
- 4-6 week implementation timeline

---

*Outpost v2.0 Multi-Tenant Planning — Checkpoint*
