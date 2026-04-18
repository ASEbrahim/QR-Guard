<!--
last_updated: 2026-04-18
audience: maintainer, reviewer
audit: 04
scope: Dead code, unreachable branches, stale imports, unused exports, unused CSS, unused constants
method: Static analysis via grep cross-reference. Each "dead" claim verified by enumerating callers.
reference: docs/SESSION_REPORT_FULL.md (prior findings already applied)
note: Prior dead code already removed — getEnrolledStudents, 2 logoutBtn listeners, 3x togglePassword duplicates, 3 unused deps (qrcode, date-fns-tz, nodemon). This audit looks for what remains.
-->

# AUDIT 04: Dead Code

**Date:** 2026-04-18
**Auditor:** Claude (read-only)
**Scope:** `src/backend/` (34 .js files), `src/frontend/` (3 scripts + 12 HTML pages + 1 CSS), `scripts/`, `tests/`
**Method:** Enumerated every exported symbol, function declaration, imported identifier, and CSS class. For each, ran ripgrep across the codebase and counted non-defining references. Verified branches against actual call-sites.

---

## Executive Summary

| Category | Findings |
|---|---|
| Unused exports (JS) | 2 (front-end helpers) |
| Unreachable branches | 2 (email-service `email_verify` config, auth-controller defensive default) |
| Dead code paths kept alive only by tests | 1 (`verifyEmail` controller `email_verify` branch) |
| Stale imports | 0 |
| Commented-out code blocks | 0 |
| Unused constants | 0 (all 22 constants in `config/constants.js` referenced) |
| Unused CSS rules | 13 class selectors |
| Unused schemas | 0 |
| Unused middleware | 0 |
| Unused dependencies | 0 (prior audit removed 3) |
| SMTP placeholder status | Dead placeholder, not a working path |

**Total removable:** ~140 lines (mostly CSS). Code quality is already high — prior audit rounds were thorough.

---

## 1. Unused Exports

| File | Line | Symbol | Reason dead | Confidence |
|---|---|---|---|---|
| `src/frontend/scripts/api.js` | 29 | `apiPut` | Declared but zero call sites. `apiPatch` is used instead by `instructor/course.html:170` to cancel sessions. No PUT endpoint on the frontend. | High — grep across all HTML/JS returns only the definition. |
| `src/frontend/scripts/api.js` | 108 | `showSkeletons` | Declared but zero call sites. Skeleton cards are inlined directly in HTML (`student/dashboard.html:21`, `instructor/dashboard.html` etc. use `<div class="skeleton-card">` markup, not this helper). | High — grep returns only the definition. |

Both are small (4 lines and 9 lines). Removal risk: none.

---

## 2. Unreachable Branches

### 2.1 `sendTokenEmail` — `email_verify` configuration is dead

**File:** `src/backend/services/email-service.js:77-122`

The function accepts `purpose` of `'email_verify' | 'password_reset' | 'device_rebind'`, but the only call sites pass `'password_reset'` (auth-controller.js:307) and `'device_rebind'` (auth-controller.js:395).

Dead lines:
- Line 80: `email_verify: '/verify-email.html'` (paths map entry)
- Line 85: `const expiry = purpose === 'email_verify' ? '24 hours' : '1 hour'` — the ternary-true branch is unreachable
- Lines 88-93: the entire `email_verify` config block (`subject`, `heading`, `message`, `buttonText`)

**Why dead:** Registration verification was migrated from link-based (6-digit code → link-click) to code-based (6-digit code → POST to `/api/auth/verify-code`). The code entry point is `sendVerificationCode()` (email-service.js:129). No caller of `sendTokenEmail` ever passes `'email_verify'`.

**Confidence:** High — verified by grep:
```
sendTokenEmail\([^)]+\)
→ auth-controller.js:307 'password_reset'
→ auth-controller.js:395 'device_rebind'
```

**Caveat:** Keep if you want the path ready for a future email-link re-enablement. But in its current state, the 3 config keys + 2 code lines cannot be reached.

### 2.2 `verifyEmail` controller — `email_verify` branch reachable only by tests

**File:** `src/backend/controllers/auth-controller.js:241-285`

Lines 263-267 (update `emailVerifiedAt` when purpose is `email_verify`) and 276-278 (success response for `email_verify`) are a code path reachable only through direct URL construction against an `email_verify`-purposed token. Production flow uses POST `/api/auth/verify-code` (verifyCode, line 208) with the 6-digit code, never the link-based GET.

**However:** `tests/integration/auth-flow.test.js` lines 118, 142, 164, 216 exercise this branch directly:
```
GET /api/auth/verify-email?token=<6-digit-code-from-DB>
```

So the branch is kept alive by tests, not by production callers. This is not strictly dead code (tests + manual URL construction still reach it), but it is orphaned from the user-facing flow. The frontend `verify-email.html` defaults `purpose` to `'email_verify'` (line 35) as a defensive fallback but no production email generates a link with `purpose=email_verify`.

**Recommendation:** Either (a) remove the `email_verify` branch and update 4 integration tests to POST `/api/auth/verify-code`, or (b) document the branch as "kept for test harness convenience / future email-link re-enablement."

**Confidence:** Medium — reachable in test code, unreachable in production flow.

### 2.3 `verifyEmail` — final defensive fallback

**File:** `src/backend/controllers/auth-controller.js:284`

```js
res.status(400).json({ error: 'Invalid token purpose' });
```

This final line is theoretically unreachable: `emailVerificationTokens.purpose` is a text column with `enum: ['email_verify', 'password_reset', 'device_rebind']` (token.schema.js:9). Lines 263, 268 cover `email_verify` and `device_rebind`. There's no branch for `password_reset` here, so if a `password_reset` token somehow reached this handler, it would fall through to the 400 — but `password_reset` tokens are consumed via POST `/api/auth/reset-password`, not GET `/api/auth/verify-email`. A malicious/accidental GET with a `password_reset` token would hit line 284.

**Status:** Reachable via unexpected input — treat as defensive, not dead. Leave in place.

---

## 3. Unused CSS Rules

Extracted all 109 top-level class selectors from `src/frontend/styles/main.css`. Searched each against HTML attribute values, `classList.*()` calls, and template-literal class-name construction.

The following are NOT referenced anywhere — neither statically nor dynamically:

| Selector | CSS file line (approx) | Reason dead |
|---|---|---|
| `.badge` | — | The base `.badge` class is never applied. Only `count-badge` and `date-badge` exist in HTML/JS. |
| `.badge-danger` | — | Modifier never applied. |
| `.badge-muted` | — | Modifier never applied. |
| `.badge-primary` | — | Modifier never applied. |
| `.badge-success` | — | Modifier never applied. |
| `.badge-warning` | — | Modifier never applied. |
| `.empty-state` | — | Never applied. `#noCourses` uses `.text-muted .text-center` instead (student/dashboard.html:23). |
| `.empty-state-icon` | — | Never applied. |
| `.flex-between` | — | Utility class never used. |
| `.mb-1` | — | Margin utility never used. (`.mb-2`, `.mt-1`, `.mt-2` ARE used.) |
| `.quick-pick` / `.quick-pick-date` / `.quick-pick-time` / `.quick-picks` | — | Quick-pick date/time component is unreferenced. Likely leftover from earlier date-picker design (replaced by `<select>` dropdowns in instructor/dashboard.html). |
| `.section-header` | — | Never applied. Headings are styled directly. |
| `.sheet-divider` | — | Bottom-sheet divider never used. |
| `.sheet-section-label` | — | Bottom-sheet section label never used. |
| `.stat-value` | — | Never applied. Stat tiles use `.stat-tile-value` instead (instructor/course.html:25,29,33). |

**Total: 16 dead class selectors** (5 badges + 4 quick-pick + 7 miscellaneous).

**Verification note:** The following selectors LOOK dead at first glance but are dynamically constructed and ARE used:
- `.course-accent-blue/gold/green/purple/red` — constructed via `course-accent-${accentFor(c.code)}` in student/instructor dashboard. `accentFor()` returns one of `['red','gold','blue','green','purple']` (verified by reading the function body).
- `.session-status-scheduled/active/closed/cancelled` — constructed via `session-status-${s.status}` in instructor/course.html:129. All 4 values are valid enum values in the `sessions.status` column (session.schema.js:15).

Roughly 120+ lines of CSS can be deleted. Exact line counts require inspection of each rule block's length in main.css.

---

## 4. Stale Imports / Commented-Out Code

- **Stale imports:** none found. Every `import { X, Y } from '...'` in the backend references each named import at least once within the file.
- **Commented-out code blocks:** none found. Searched for `^\s*//\s*[a-zA-Z_]+\(`, `^\s*//\s*TODO|FIXME|XXX|HACK`, and `/* ... */` multi-line blocks. Only real JSDoc comments and single-line explanatory comments exist.

---

## 5. Unused Constants

All 22 exported constants in `src/backend/config/constants.js` are referenced at least once outside the defining file. Counts (ref sites across `src/`, `tests/`, `scripts/`):

```
BCRYPT_ROUNDS: 4           PASSWORD_MIN_LENGTH: 3         MAX_LOGIN_ATTEMPTS: 2
LOCKOUT_DURATION_MS: 2     EMAIL_VERIFY_EXPIRY_MS: 3      PASSWORD_RESET_EXPIRY_MS: 2
DEVICE_REBIND_EXPIRY_MS: 2 AUK_ABSENCE_LIMIT_PCT: 1       ENROLLMENT_CODE_LENGTH: 2
ENROLLMENT_CODE_MAX_RETRIES: 1  ENROLLMENT_CODE_ALPHABET: 1  DEFAULT_ATTENDANCE_WINDOW_SECONDS: 2
DEFAULT_WARNING_THRESHOLD_PCT: 2  DEFAULT_QR_REFRESH_INTERVAL_SECONDS: 2
GEOFENCE_MIN_RADIUS_M: 4   GEOFENCE_MAX_RADIUS_M: 4       GEOFENCE_INDOOR_MARGIN_M: 1
AUK_EMAIL_REGEX: 2         SESSION_MAX_AGE_MS: 1          GPS_MAX_ACCURACY_M: 1
IP_API_TIMEOUT_MS: 1       IP_API_EXPECTED_COUNTRY: 1
```

No dead constants.

---

## 6. Unused Schemas / Middleware / Helpers

### Schemas
All 11 table exports from `src/backend/db/schema/index.js` (`users`, `students`, `instructors`, `emailVerificationTokens`, `courses`, `enrollments`, `sessions`, `qrTokens`, `attendance`, `auditLog`, `warningEmailLog`) are imported and used in at least one controller, service, or test. The lowest usage is `auditLog` (2 non-schema refs: `override-controller.js:64`, `validators/audit-logger.js:11`) — still live.

### Middleware
- `requireAuth` — 10 route-level uses. Live.
- `requireRole` — 14 route-level uses across 4 route files. Live.
- Rate limiters: `globalLimiter`, `loginLimiter`, `registerLimiter`, `scanLimiter` — all 4 used in `server.js:39,66,67,68`. Live.

### Validators (scan pipeline)
All 6 layer validators + orchestrator + `ScanError` — referenced, used in tests, used in production orchestrator. Live.

### Services
All service functions (`generateQrToken`, `startRefreshLoop`, `stopRefreshLoop`, `getCurrentToken`, `cleanupExpiredTokens`, `initSocketIO`, `emitQrRefresh`, `emitAttendanceUpdate`, `emitSessionClosed`, `sendEmail`, `sendTokenEmail`, `sendVerificationCode`, `calculateAttendancePct`, `calculateAllAttendancePcts`, `generateSessions`, `generateEnrollmentCode`, `checkThresholdAndNotify`) — all referenced.

### Front-end component helpers
- `renderNav`, `renderNavWithBack`, `renderBottomNav`, `renderFooter`, `doLogout`, `loadUserName` — all called from HTML pages.
- `apiFetch`, `apiGet`, `apiPost`, `apiPatch`, `apiDelete`, `checkAuthAndRedirect`, `showError`, `showSuccess`, `esc`, `togglePassword`, `setButtonLoading`, `showPageLoader` — all referenced in pages.
- `apiPut`, `showSkeletons` — dead (see §1).

---

## 7. SMTP Placeholder in `email-service.js`

**File:** `src/backend/services/email-service.js:1-43`

The top docstring advertises three modes: `console`, `resend`, and `smtp`. In the actual implementation (`sendEmail`, lines 20-43), only `console` and `resend` branches exist. An unknown provider (including `'smtp'`) falls through to the warning + console fallback at lines 41-42:

```js
console.warn(`[email-service] Unknown provider "${provider}", falling back to console`);
console.log(`[EMAIL] To: ${to} | Subject: ${subject}\n${text}`);
```

**Verdict:** The SMTP mode is a **dead placeholder, not a usable path**. Setting `EMAIL_PROVIDER=smtp` silently degrades to console logging — no Nodemailer dependency is installed, no transport is configured, no SMTP code exists. The docstring is misleading.

**Recommendation:** Either (a) remove `'smtp'` from the docstring, or (b) implement it if needed. Given prior audit removed `nodemailer` from unused deps (SESSION_REPORT_FULL.md line 109), option (a) is consistent with the codebase direction.

**Confidence:** High — verified by reading the full `sendEmail` function.

---

## 8. Dead Event Listeners / DOM Wiring

None found beyond the 2 already removed in prior audits (SESSION_REPORT_FULL.md:258 — "Dead event listeners (2 pages)"). Every `addEventListener` and `onclick` in current HTML maps to an element that exists and a handler that does useful work. Spot-verified in `login.html`, `register.html`, `student/dashboard.html`, `instructor/course.html`, `instructor/session.html`, `request-rebind.html`.

---

## 9. Dependencies

`package.json` declares 15 production + 7 dev dependencies. Grep-verified all 22 are imported somewhere:

- **Prod used:** bcrypt, connect-pg-simple, cors, csv-stringify, date-fns, dotenv (server.js:1, seed.js:5), drizzle-orm, express, express-rate-limit, express-session, helmet, pg, resend, socket.io, zod.
- **Dev used:** @eslint/js, @playwright/test (in scripts/screenshot-*.js), drizzle-kit (in package.json scripts + drizzle.config.js), eslint, prettier, supertest, vitest.

No unused dependencies remain. (Prior audit removed `qrcode`, `date-fns-tz`, `nodemon`.)

---

## 10. Summary Table (all findings)

| # | File:Line | Symbol / Block | Category | Removable lines | Risk |
|---|---|---|---|---|---|
| 1 | `src/frontend/scripts/api.js:29-31` | `apiPut` | Unused export | 4 | None |
| 2 | `src/frontend/scripts/api.js:108-117` | `showSkeletons` | Unused export | 9 | None |
| 3 | `src/backend/services/email-service.js:80,85,88-93` | `sendTokenEmail` email_verify config | Unreachable branch | ~8 | None (keep if future email-link verify planned) |
| 4 | `src/backend/controllers/auth-controller.js:263-267, 276-278` | `verifyEmail` email_verify branch | Orphaned from prod flow, kept by tests | ~10 | Medium — breaks 4 integration tests if removed without updating them to POST verify-code |
| 5 | `src/backend/services/email-service.js:1-8` (docstring) | SMTP placeholder mention | Dead docstring claim | 1 | None |
| 6 | `src/frontend/styles/main.css` | `.badge`, `.badge-danger`, `.badge-muted`, `.badge-primary`, `.badge-success`, `.badge-warning` | Unused CSS | ~30 lines across 6 rule blocks | None |
| 7 | `src/frontend/styles/main.css` | `.empty-state`, `.empty-state-icon` | Unused CSS | ~15 lines | None |
| 8 | `src/frontend/styles/main.css` | `.flex-between`, `.mb-1` | Unused CSS utilities | ~5 lines | None |
| 9 | `src/frontend/styles/main.css` | `.quick-pick`, `.quick-pick-date`, `.quick-pick-time`, `.quick-picks` | Unused CSS (leftover from pre-dropdown date picker) | ~40 lines | None |
| 10 | `src/frontend/styles/main.css` | `.section-header` | Unused CSS | ~5 lines | None |
| 11 | `src/frontend/styles/main.css` | `.sheet-divider`, `.sheet-section-label` | Unused CSS (bottom-sheet subcomponents) | ~10 lines | None |
| 12 | `src/frontend/styles/main.css` | `.stat-value` | Unused CSS (superseded by `.stat-tile-value`) | ~5 lines | None |

**Estimated total removable:** ~140 lines (12 JS + 18 branch + 110 CSS). None of the removals affect production behavior except Finding #4 which requires coordinated test update.

---

## 11. Things Verified Alive (to save future auditors time)

These looked suspicious on first pass but are genuinely reachable:

- `verify-email.html` page — reachable via device-rebind email link (device_rebind purpose).
- `verifyEmail` controller — reachable for `device_rebind` purpose (the useful production path) and for tests with `email_verify`.
- `emitQrRefresh` / `emitAttendanceUpdate` / `emitSessionClosed` — each emitted from exactly one controller, consumed by socket.io clients in `instructor/session.html` and `student/scan.html`.
- `course-accent-*` and `session-status-*` CSS — dynamically constructed via template literals (see verification notes in §3).
- `auditLog` table — only 2 write sites and zero read sites in app code. Reads happen via `getAuditLog` (report-controller.js:227) using raw SQL (`db.execute(sql\`SELECT * FROM audit_log ...\`)`), which grep for `auditLog` misses but is a real read path.
- `executeEnrollment` and `getCourseForInstructor` helpers in `course-controller.js` — local (non-exported), each called from multiple handlers.
- `canAccessSession` in `socket-service.js` — local helper, called from `initSocketIO` socket event handlers.
- `getClosedSessionCount` and `notifyInstructorAukLimit` in `notification-service.js` — local helpers, called by `checkThresholdAndNotify`.

---

## 12. Recommended Actions (priority order)

1. **Delete `apiPut` and `showSkeletons`** from `src/frontend/scripts/api.js` — 13 lines, zero risk.
2. **Prune the dead CSS** (16 selectors, ~110 lines) — zero risk.
3. **Fix or remove the SMTP docstring claim** in `email-service.js` — 1 line change.
4. **Decide on Finding #4** (`verifyEmail` `email_verify` branch):
   - If keeping for future link-based verify: remove the `email_verify` config from `sendTokenEmail` (§2.1) but keep the controller branch with a comment explaining it's test-only until re-enabled.
   - If removing: delete the branch, update 4 tests to use POST `/api/auth/verify-code` instead.
5. Leave all other files untouched — the codebase is already lean.
