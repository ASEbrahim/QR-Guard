# QR-Guard — P2 + Safe P3 Remediation Summary

**Session date:** 2026-04-18 (follow-up to P0 + P1)
**Scope:** 21 P2 items (of 97) + a safe subset of P3 cleanup
**Result:** 4 batched commits on `main`. 43/43 tests pass. Lint clean.
**Backup tag:** `pre-p2-remediation-20260418-1920`

---

## Commits Applied

| # | Batch | SHA | Items | Summary |
|---|---|---|---|---|
| 1 | F · Error + memory | `4f316d3` | P2-5..13 | Socket.IO try/catch, defensive res.json(), WKT surface error, request-context error handler, Zod on 3 ad-hoc endpoints, camera teardown on pagehide, socket + polling teardown, Leaflet .remove(), ip-validator clearTimeout in finally |
| 2 | G · Limits + perf | `149edc8` | P2-14,15,17,18,19,20 | Socket.IO maxHttpBufferSize=4kB, CSV 100k-row cap, weeklySchedule .max(14), scan limiter per-student, Promise.all parallelization, calculateAllAttendancePcts CROSS JOIN rewrite |
| 3 | H · A11y polish | `f525877` | P2-25..28, 30 | password toggle aria-pressed, h1 landmarks on 3 pages, role="main", tabs keyboard (ArrowLeft/Right/Home/End), setButtonLoading aria-busy + disabled |
| 4 | I · P3 cleanup | `3e95f9d` | P3 subset | Removed unused `apiPut` + `showSkeletons`, 11 unused CSS selectors (~75 lines), corrected email-service docstring, added test-results/ to .gitignore |

**21 files changed, 314 insertions, 213 deletions.**

---

## Validation

- `npm test` → **43/43 pass** after every batch (4 runs)
- `npm run lint` → clean
- `node --check` on every touched `.js` file → clean
- `calculateAllAttendancePcts` rewrite: new SQL sanity-checked against local DB with an empty-course UUID to confirm the query plans and returns 0 rows cleanly

**Known gaps:**
- Frontend accessibility changes (tab keyboard nav, aria-busy button, modal focus) verified only by code inspection. A11y final sign-off should run NVDA or VoiceOver against the live app.
- `calculateAllAttendancePcts` math-equivalence with the old CROSS JOIN derivation is documented in the code comment but not tested end-to-end (no existing test covers the bulk function). Consider adding one in P3 or next pass.
- The camera-stream pagehide cleanup (scan.html) was not tested against a real mobile BFCache path.

---

## Deferred Items (NOT done in this pass)

### P2-1 through P2-4 — Multi-instance readiness
**Why:** The `activeLoops` Map, unconditional orphan-session cleanup at startup, in-memory rate limiter, and QR refresh loops all assume single-instance deployment. Making the app multi-instance-safe requires either Redis (for rate limiter + QR scheduler leader-election) or accepting "single-instance forever" and documenting that constraint. This is an infrastructure decision, not a silent fix.

### P2-16 — Retention / archival jobs
**Why:** `audit_log`, `email_verification_tokens`, `warning_email_log`, and old-semester `sessions` grow unbounded. Adding retention requires a cron/scheduled-task decision (a separate process, an in-app setInterval, Render cron jobs, etc.). Each has different cost and failure modes. Flagged in P2 summary for your call.

### P2-21 — BCRYPT_ROUNDS 12 → 11
**Why:** Dropping one round saves ~125 ms on login/reset but weakens password hashing. OWASP currently recommends ≥10; 12 is still within range. A cost/security trade-off that should be explicit, not silent.

### P2-22 — Async queueing for notifications
**Why:** The scan hot path still synchronously invokes `checkThresholdAndNotify` and (inside it) `sendEmail`. A proper queue (BullMQ + Redis, or a lightweight in-process queue) would move those off the request path. Infra decision, like P2-1.

### P2-23 — Color contrast fixes
**Why:** Gold `#D4A037` on white = 2.79:1 (fails AA). Changing the brand token affects every gold accent in the UI. This is a design decision about AUK branding — not mine to silently pick.

### P2-29 — Form error summary
**Why:** Aggregated error-summary regions at the top of forms + per-field `aria-invalid`/`aria-describedby` is a larger UX scope. Worth a dedicated a11y-focused PR with screen-reader validation.

### P3 partial cleanup
Five CSS selectors (`.empty-state`, `.flex-between`, `.mb-1`, `.section-header`, `.stat-value`) look unused per AUDIT_04 but touch visually-similar siblings; kept for a pass with browser verification.
`email_verify` dead branch in `sendTokenEmail` / `verifyEmail` was retained — AUDIT_04 noted tests exercise it; removing needs a decision about the verification-link vs 6-digit-code flow.

---

## Deploy

### No new migrations this round
All 21 P2 items + the P3 cleanup are in code only. The three pending migrations (`0004`, `0005`, `0006`) from the P1 pass are still the only DB changes that need to run against Neon. (And `0003_enum_checks.sql` from P0 if you haven't applied that yet.)

### Env vars
No new env vars. `PG_POOL_MAX` (P1) is optional; `ALLOWED_ORIGIN` and `RESEND_API_KEY` (P1) are still the open ones you need to populate in Render dashboard.

### Smoke tests after deploy
- Instructor course-detail page: arrow-key between Sessions/Students tabs works.
- Student scan page: leave the tab while camera is running → camera LED goes off.
- CSV export with no date filter on a course with 30+ sessions: returns CSV (under the 100k row cap) or 413 with a helpful message.
- `POST /api/courses/enroll` 21 times in 10 min from same IP → 429 on the 21st. Same user scanning 31 times in 1 min → 429 on 31st.

---

## Rollback

### Per-batch

```bash
git revert 3e95f9d   # Batch I P3 cleanup
git revert f525877   # Batch H a11y
git revert 149edc8   # Batch G limits + perf
git revert 4f316d3   # Batch F errors + memory
```

### Full P2 rollback

```bash
git reset --hard pre-p2-remediation-20260418-1920
```

(Keeps P0 + P1 fixes intact. For a full pre-audit state, reset to `pre-audit-remediation-20260418-0645`.)

---

## Remaining Work

- **P2:** 76 items still open (6 deferred with reason above, 70 smaller items — most are accessibility refinements and docs drift that can be picked up opportunistically).
- **P3:** ~85 cleanup items still open. Safest chunks done; rest are better batched with a browser verification loop.
