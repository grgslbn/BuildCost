# Architecture Decisions

> **Living document. Add decisions as they're made.**

## ADR-001: Monorepo with Next.js

**Decision:** Single Next.js 14 app (App Router) handling both frontend and API routes.

**Why:** Fastest path to MVP in 48h. No CORS issues, shared types, single deployment. API routes handle backend logic, Supabase handles persistence.

**Trade-off:** If processing becomes too heavy for Vercel serverless (plan extraction timeout), we move heavy endpoints to Railway.

---

## ADR-002: Claude Sonnet 4 for Vision

**Decision:** Use Claude Sonnet 4 (`claude-sonnet-4-6`) as primary model for plan extraction.

**Why:** Best balance of vision quality, speed, and cost. Opus is overkill for structured extraction. GPT-4o is an alternative to benchmark.

**Fallback:** If Sonnet accuracy is insufficient on specific plan types, upgrade those to Opus.

---

## ADR-003: Supabase for Everything Persistent

**Decision:** Supabase handles auth, database, file storage, and realtime updates.

**Why:** Single platform, fast setup, built-in auth with magic links, storage for plan uploads, Postgres for all data, realtime for processing status updates.

---

## ADR-004: Scale Detection Chain

**Decision:** Try multiple scale detection methods in order:
1. Find scale bar on plan → parse ratio
2. Find dimension text on walls → calculate pixels-per-meter
3. Calibrate from standard door width (80cm Belgian standard)
4. Ask user to input scale or a known dimension

**Why:** No single method works for all plans. Chain gives best coverage.

---

## ADR-005: QQP Weights Start at Zero

**Decision:** All QQP weights initialized at 0. First 10 reference dossiers set initial correlations.

**Why:** Expert intuition about "expected correlation" is noted but not used as weight. Let the data speak. We track expected vs actual correlation for validation.

---

## ADR-006: Finishing Coefficient 0.70–1.50

**Decision:** Finishing coefficient is continuous, mapped to 5 named levels.

| Level | Range |
|-------|-------|
| Basic | 0.70–0.85 |
| Standard | 0.85–1.00 |
| Comfort | 1.00–1.15 |
| Luxury | 1.15–1.35 |
| Premium | 1.35–1.50 |

**Why:** Continuous allows precision; named levels allow communication. Base "Standard" at 1.00 means standard = base price.

---

## ADR-007: Mock Data Strategy for Parallel Work

**Decision:** Georges can start WS2 with hand-created SQM JSON (reading plans visually) while Tiemen automates extraction.

**Why:** Unblocks parallel work. The SQM_CONTRACT.md defines the interface — both build to it independently.

---

## ADR-008: Magic Link Auth + Auto-Tenant Creation

**Decision:** Authentication via Supabase magic link (email). On first login, auto-create a tenant for the user's email domain (or personal tenant for gmail/outlook).

**Why:** Lowest friction for product-led growth. No passwords to manage.

---

## ADR-009: Processing is Async

**Decision:** Plan processing (SQM extraction + QQP analysis + cost calc) runs asynchronously. Frontend polls or uses Supabase Realtime for status updates.

**Why:** Claude Vision calls take 5-30 seconds. Can't block the HTTP request. User sees a processing screen with status updates.

**Implementation:** 
- Upload → create estimation row with status 'uploading'
- Trigger processing (API route or edge function)
- Update status as each step completes
- Frontend subscribes to Realtime on the estimation row

---

## ADR-010: Reference Dossier Processing Pipeline

**Decision:** Reference dossiers go through a staged pipeline:
```
pending → extracting_sqm → sqm_done → extracting_qqp → analyzed → validated
```

**Why:** Each stage can fail independently. Human validation is the final step. Status tracking enables dashboard monitoring.
