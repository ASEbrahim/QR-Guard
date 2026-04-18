<!--
audit: 05
scope: Error propagation, unhandled rejections, swallowed errors, stack-trace leaks, transaction rollback
date: 2026-04-18
reviewer: Claude Opus 4.7 (1M context)
classification: READ-ONLY AUDIT (no code changes made)
excludes: items already documented as fixed in docs/SESSION_REPORT_FULL.md (ScanVerifier finally block, ip-api FAIL-OPEN, audit-logger never throws, course.html error swallowing)
-->

# AUDIT 05 — Error Propagation

**Scope:** every `async` function in `src/backend/` (47 total across 17 files), every `setInterval`/`setTimeout` callback, every Socket.IO handler, all Zod validators, all fetch calls on frontend (28 call sites across 13 HTML files), the global Express error handler, transactions in `auth-controller.js`, `notification-service.js`, `scan-controller.js`.

**Methodology:** Read every controller, service, validator, route, and frontend page. Classified findings as (a) unhandled rejection, (b) swallowed error, (c) leak of internals, (d) transactional gap, (e) frontend gap. Cross-checked against SESSION_REPORT_FULL.md to skip already-fixed items.

---

## 1. Summary

| Category | Count | Critical | High | Medium | Low |
|----------|-------|----------|------|--------|-----|
| Backend — unhandled rejections | 5 | 1 | 2 | 1 | 1 |
| Backend — swallowed errors | 4 | 0 | 1 | 2 | 1 |
| Backend — internal leaks | 2 | 0 | 1 | 1 | 0 |
| Backend — transactional gaps | 4 | 1 | 2 | 1 | 0 |
| Backend — Zod/validation | 2 | 0 | 0 | 2 | 0 |
| Frontend — missing `.ok` or error handling | 6 | 0 | 1 | 4 | 1 |
| Frontend — swallowed errors / unhandled rejections | 4 | 0 | 1 | 2 | 1 |
| **Total** | **27** | **2** | **8** | **13** | **4** |

### Top priorities (Critical + High)

1. **CRITICAL** — `scan-controller.js:47-63` records attendance in ONE `db.insert` (no transaction). If the subsequent `emitAttendanceUpdate` or `checkThresholdAndNotify` were to partially succeed and fail mid-way, the attendance row is already committed. A harder issue: **the attempt is audit-logged as `'success'` (by scan-verifier finally) BEFORE `attendance` is actually inserted.** If the insert throws (not UNIQUE — say a DB connection drop), audit log says success but no attendance row exists. Fix: merge audit-log write and attendance insert under one transaction, OR audit-log `result='recorded'` only after the insert succeeds.
2. **CRITICAL** — `qr-service.js:62-69` `setInterval` callback catches errors, but the `onRefresh(token.payload, ...)` call at line 65 is OUTSIDE the try body of the generate (wait — re-read: `onRefresh` IS inside the try). Re-read shows the try/catch wraps both. But the **callback passed to startRefreshLoop from `session-controller.js:39-41` calls `emitQrRefresh` which under `socket.io` v4 should not throw synchronously** — however, if `io` is null and someone holds a stale reference, or if emit throws on a disconnected namespace, it would propagate inside the setInterval try and be logged. Acceptable. The **real issue** is that **there is no global `process.on('unhandledRejection')` handler** — any async rejection from a handler not in a try block, or from inside an `onRefresh` chain where the caller returns, will crash Node in Node 20+ (`--unhandled-rejections=throw` is the default since Node 15).
3. **HIGH** — `server.js:89-92` global error handler logs `err` (full object) but responds with `{ error: 'Internal server error' }` — good for prod. But it does NOT check `NODE_ENV` to optionally expose detail in dev. Devs debugging have to check server logs. Minor, but combined with: **the handler does NOT filter Zod errors**; if any Zod `.parse()` (not `.safeParse()`) throws anywhere it reaches the global handler and is logged as "Unhandled error" with full stack — see Finding 3.2.
4. **HIGH** — Login flow calls `req.session.regenerate((err) => ...)` inside the `login` async handler at `auth-controller.js:183-190`. The outer async function returns BEFORE the callback fires — any rejection from the db queries preceding `regenerate` is forwarded to the global handler, but the `regenerate` callback runs later. If the db query at line 152-155 (reset failed count) throws AFTER password validation passed, the user sees "Login failed" at line 184 only if `regenerate` failed — but actually the DB rejection would fire between the `await` returns and `req.session.regenerate`. Net effect: inconsistent state possible (counter reset failed but login proceeds). Low-likelihood.
5. **HIGH** — `notification-service.js:46-77` sends a warning email in the middle of a non-transactional write sequence: INSERT warning_email_log → SELECT users → sendEmail → (maybe) notifyInstructorAukLimit. If `sendEmail` throws, **the warning_email_log row is already committed** and the "one-per-crossing" invariant is now broken — next scan sees an open crossing and won't retry. Documented in §4.2.
6. **HIGH** — `scan-controller.js:81-83` and `:90-92`: threshold check and attendance broadcast each log to console but swallow on failure. That's correct by design (scan should succeed even if broadcast fails). However, `notification-service.js` can throw inside `sendEmail` (Resend API outage), and the **audit log does NOT record that the warning email failed.** The student whose attendance dropped gets no warning, and the system silently forgets. See §2.3.
7. **HIGH** — `scan.html:161-169` does not check `res.ok` on the critical `/api/scan` call before parsing `data` and branching. It does `if (res.ok)` AFTER `await res.json()`. If the server returns a 500 with non-JSON (e.g., Render's HTML 502 page), `res.json()` throws an unhandled rejection. See §5.1.
8. **HIGH** — `session.html:205-208` "End Session" click handler calls `await apiPost('/api/sessions/${sessionId}/stop')` without checking the response. `showClosed()` is called unconditionally even if the stop failed (session still active on server). User thinks it ended; next student scan succeeds. See §5.3.

---

## 2. Backend — Unhandled Rejections

### 2.1 No `process.on('unhandledRejection')` or `process.on('uncaughtException')`

| Location | Severity | Proof | Impact |
|---|---|---|---|
| `server.js` (entire file) | **Critical** | No `process.on('unhandledRejection', ...)` anywhere in backend. `grep -n "process\.on" src/backend` returns zero matches. | In Node 20+, unhandled promise rejections crash the process (default is `--unhandled-rejections=throw`). A single unhandled async reject anywhere — e.g., from a detached Promise in a Socket.IO `join-session` handler, or from `emitAttendanceUpdate` dispatch — will take the entire server down on Render, forcing a 30-60s cold restart and dropping all active sessions. |

**Root cause:** startup code (`server.js:94-109`) never registers a global safety net. Express 5 auto-forwards rejections from `req`/`res` handlers, but NOT from:
- `setInterval` callbacks that spawn promises
- Socket.IO event handlers (see §2.2)
- Fire-and-forget `.then().catch()` chains (only one such chain exists at `server.js:108` — OK)

**Fix:** add at the top of `server.js` (after imports):
```js
process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); });
```

### 2.2 Socket.IO `join-session` handler: unhandled rejection on DB failure

| Location | Severity | Proof |
|---|---|---|
| `socket-service.js:66-76` | **High** | Handler is `async (sessionId) => { ... await canAccessSession(...) }`. `canAccessSession` issues db queries. If the Postgres pool is exhausted or Neon is briefly down, `canAccessSession` rejects. Socket.IO does NOT catch async errors in event listeners (v4 behavior: thrown/rejected errors inside a listener become unhandled rejections). |

Impact: DB hiccup during classroom ramp-up (60+ students joining in one minute) → Socket.IO listener rejects → with no `process.on('unhandledRejection')` → process crash → everyone disconnects.

Fix: wrap the body in `try { ... } catch (err) { console.error('[socket] join-session failed:', err.message); }` so failed checks simply don't join the room instead of crashing.

### 2.3 `checkThresholdAndNotify` swallowed in scan-controller, but swallowed too broadly

| Location | Severity | Proof |
|---|---|---|
| `scan-controller.js:86-92` | Medium | `try { await checkThresholdAndNotify(...) } catch (err) { console.error(...) }` — logs to console only. No audit_log row, no fallback delivery queue. |
| `override-controller.js:80-84` | Medium | Identical pattern — swallow `checkThresholdAndNotify` error to console. |

Impact: Resend API outage (or SMTP down, or student's email rejected) means the warning email is lost forever. No retry mechanism, no visibility to the instructor. Because the `warning_email_log` row was already inserted (see §4.2), the next scan sees an "open crossing" and doesn't try again.

Fix: either (a) insert to `warning_email_log` only AFTER successful email send, or (b) log an audit_log row with `event_type='warning_email_failed'` inside the catch.

### 2.4 `cleanupExpiredTokens` interval — unhandled if logger itself fails

| Location | Severity | Proof |
|---|---|---|
| `qr-service.js:107-113` | Low | `try { await db.execute(...) } catch (err) { console.error('[qr-service] Token cleanup failed:', err.message); }`. |
| `server.js:104` | Low | `setInterval(cleanupExpiredTokens, 10 * 60 * 1000)`. |

OK, this is handled. But: `server.js:105` calls `cleanupExpiredTokens()` once immediately without `await` and without `.catch()`. Because the function itself catches internally, this is safe. Downgrade to Low — correct by coincidence, not by design.

### 2.5 Orphaned-session cleanup on startup — Promise chain catches err, but doesn't await

| Location | Severity | Proof |
|---|---|---|
| `server.js:108` | Low | `db.update(sessions).set(...).where(...).then(() => {}).catch(err => console.error(...))` runs inside the listen callback. Server accepts requests before this finishes. If cleanup takes 3s and a student starts a scan on a session marked `active` (but from a dead instance), the scan proceeds against a stale session. |

Impact: tiny race window on first 1-3 seconds after boot. Acceptable given the once-per-semester impact. Documented for completeness.

---

## 3. Backend — Swallowed Errors & Internal Leaks

### 3.1 `scan-controller.js:57-63` — UNIQUE-constraint branch swallows, but re-throws other errors

| Location | Severity | Proof |
|---|---|---|
| `scan-controller.js:57-63` | Medium | `catch (err) { if (err.code === '23505') { return 409 } throw err; }` — the `throw err` goes to Express 5 auto-catch, lands in global handler. |

Root cause: the thrown error includes the full PG error object (`err.detail`, `err.constraint`, `err.table`). The global handler at `server.js:89-92` does `console.error('[server] Unhandled error:', err)` then `res.status(500).json({ error: 'Internal server error' })`. The client sees a generic 500 — GOOD. The log output is verbose — acceptable.

BUT: **the scan-verifier already wrote audit_log with `result='success'` at this point** (the finally block ran BEFORE the attendance insert). So now we have an audit log row saying "scan succeeded" but no attendance row. Silent inconsistency. See §4.1.

### 3.2 Zod `.safeParse()` everywhere — but shape of error inconsistent

| Location | Severity | Proof |
|---|---|---|
| `auth-controller.js:72-74, 118-120, 345-347` | Medium | `parsed.error.issues[0].message` — uses index `[0]` only. |
| `course-controller.js:103-105, 266-268, 287-289, 344-347` | Medium | Same pattern. |
| `scan-controller.js:22-25`, `override-controller.js:20-23` | Medium | Same. |
| `auth-controller.js:209-210` | Medium | `verifyCode` does NOT use Zod — raw `if (!email || !code)` check. Inconsistent shape: `{ error: 'Email and code required' }` vs Zod `{ error: '<first issue>' }`. |
| `auth-controller.js:291-293, 319-321, 384-385` | Medium | `forgotPassword`, `resendVerification`, `requestRebind` do NOT use Zod. |

Impact: frontend code expects `data.error` as a string everywhere. Shape matches, but:
- Only the FIRST validation issue is shown to user. If a user submits 3 invalid fields (e.g., bad email + short password + missing name), they see only "Enter a valid email" and think everything else is fine. After fixing email, they see "Password must be at least 8 characters". Three round-trips.
- Non-Zod endpoints don't benefit from the rich Zod messages. `verifyCode` returns a single generic message.

Fix: (a) return `{ error, issues: parsed.error.issues }` so frontend can show all issues; (b) move all validation to Zod schemas for consistency.

### 3.3 `auth-controller.js:184` — `regenerate` callback returns 500 with generic error

| Location | Severity | Proof |
|---|---|---|
| `auth-controller.js:183-190` | Low | `req.session.regenerate((err) => { if (err) return res.status(500).json({ error: 'Login failed' }); ... })` |

No leak — `err` is logged nowhere. So if `regenerate` fails repeatedly for a given user (e.g., session store corruption), there's no diagnostic trail. Fix: add `console.error('[auth] regenerate failed:', err);` before returning.

### 3.4 `logout` errors logged nowhere

| Location | Severity | Proof |
|---|---|---|
| `auth-controller.js:197-201` | Low | `req.session.destroy((err) => { if (err) return res.status(500).json({ error: 'Logout failed' }); ... })` — `err` lost. |

Same pattern as §3.3. Add `console.error('[auth] destroy failed:', err);`.

### 3.5 `generateQrToken` — geofence parse silently defaults to (0,0)

| Location | Severity | Proof |
|---|---|---|
| `qr-service.js:18-20` | High (leak of system behavior) | `const match = course.geofenceCenter.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/); const lng = match ? parseFloat(match[1]) : 0;` |

Root cause: if `geofenceCenter` is NULL or malformed (e.g., admin manually edits DB), the QR payload embeds `lat=0, lng=0`. **No error, no log.** Students near (0°N, 0°E) in the Gulf of Guinea would pass the geofence check, but that's moot; the real harm is that **nobody can scan** (they're nowhere near 0,0) and the system looks broken with no signal. Fix: if `!match`, throw — session can't start without a valid geofence.

### 3.6 Global Express error handler — acceptable in prod, but swallows context

| Location | Severity | Proof |
|---|---|---|
| `server.js:89-92` | Medium | `(err, _req, res, _next) => { console.error('[server] Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); }` |

Good: hides internals in prod (no stack to client). BUT:
- No request context logged (URL, method, user ID). Diagnosis on Render log stream requires correlation by timestamp alone.
- In dev (`NODE_ENV !== 'production'`), same generic message — devs must tail server logs.
- `err.stack` goes to `console.error` implicitly (Node prints `.stack` when logging an Error). That's fine.

Fix: log `{method: _req.method, url: _req.url, userId: _req.session?.userId}` with the error. In dev, return `{error: err.message, stack: err.stack}`.

---

## 4. Backend — Transactional Gaps

### 4.1 **CRITICAL — audit-log-before-attendance inversion in scan pipeline**

| Location | Severity | Proof |
|---|---|---|
| `scan-verifier.js:55-72` + `scan-controller.js:47-63` | **Critical** | Pipeline order: (1) `verifyScan` finally block calls `logAudit({result: 'success'})` — row committed; (2) controller THEN attempts `db.insert(attendance)` — row may fail (DB connection drop, 23505 if retry). |

Proof:
1. `scan-verifier.js:57` runs `logAudit` **after** the verification checks pass but **before** control returns to the controller.
2. `scan-controller.js:47-56` inserts the attendance row AFTER `verifyScan` returns.
3. If the attendance insert fails for any reason OTHER than 23505 (e.g., `pool.connect` throws), the re-throw at line 62 propagates to the global handler. User sees 500, but **audit_log already says `result='success'`**.

Impact: instructor audits scan → sees "30 successful scans" but attendance table has 28. Undermines the core trust property of the audit log (append-only, source of truth).

Fix: either
- (a) Insert attendance INSIDE the `verifyScan` pipeline (so it's part of the same transaction as other checks), and have `logAudit` run in finally AFTER attendance is committed; OR
- (b) Change scan-verifier audit log to write `result='verified'` (not `'success'`), and add a second `logAudit({result: 'recorded'})` after the attendance insert commits. Then `result='success'` would be derived from the pair.

### 4.2 **notification-service: warning_email_log committed before email sent**

| Location | Severity | Proof |
|---|---|---|
| `notification-service.js:44-77` | High | Line 46: `await db.insert(warningEmailLog).values({...})` — committed. Line 62-76: `await sendEmail({...})` — can throw. No rollback. |

Impact: email infra outage → warning_email_log says "email sent at T" → real student never got email → student under threshold, no notification. The "one-per-crossing" invariant is violated *in favor of* undersending (worse than double-sending).

Fix:
```js
try {
  await sendEmail({...});
  await db.insert(warningEmailLog).values({..., emailSentAt: new Date()});  // commit AFTER send
} catch (sendErr) {
  console.error('[notification] sendEmail failed:', sendErr.message);
  // Don't log the crossing — retry next scan
}
```

### 4.3 `overrideAttendance` — 3 writes with no transaction

| Location | Severity | Proof |
|---|---|---|
| `override-controller.js:44-77` | High | Three separate awaits: (1) update or insert attendance; (2) insert audit_log; (3) threshold check. If (2) fails after (1) succeeds, attendance is flipped but the audit log is missing — and the audit log is the "append-only evidence of all state changes" per schema triggers. |

Proof: there's no `db.transaction(async (tx) => {...})` wrapping these three writes. Each is independently committed.

Impact: instructor marks student "excused" → attendance updated to excused → audit_log insert fails (e.g., triggers reject, DB down) → attendance flipped without trace. Schema says audit_log is append-only, so a student could later claim "I was marked absent unfairly" and instructor has no proof of the override.

Fix: wrap lines 44-77 in `db.transaction(async (tx) => { ... })`. Then the threshold-check call at line 80-84 stays outside (and can already fail safely since warning_email_log is a separate concern).

### 4.4 `startSession` — status update before QR refresh loop starts

| Location | Severity | Proof |
|---|---|---|
| `session-controller.js:33-43` | Medium | Line 33-36 sets status='active' in DB. Line 39 calls `startRefreshLoop` which hits `generateQrToken` which inserts into `qr_tokens`. If `generateQrToken` fails (e.g., geofence parse — §3.5), session is marked active but has NO QR token. Students scan, QrValidator fails with `qr_expired`, instructor sees "0/30 attendance" with no obvious cause. |

Fix: wrap status update + first QR generation in a transaction; OR call `generateQrToken` first (don't update status until first token succeeds).

---

## 5. Frontend — Missing `.ok` / Swallowed / Unhandled

### 5.1 **`scan.html:161-170` — no `res.ok` check before `res.json()`**

| Location | Severity | Proof |
|---|---|---|
| `scan.html:161-172` | **High** | ```js\nconst res = await apiPost('/api/scan', { ... });\nif (!res) { scanning = false; return; }\nconst data = await res.json();  // <-- throws if body is not JSON\n\nif (res.ok) { ... }\n``` |

Root cause: `apiFetch` at `api.js:13-18` redirects on 401, otherwise returns the `Response` object regardless of status. If the server returns a 502 HTML page from Render (edge case: scan right during deploy), `res.json()` throws SyntaxError. The error is NOT caught anywhere (no try/catch around onScanSuccess). Result: unhandled rejection in the browser console, `scanning` stays `true` forever, scanner is permanently frozen.

Fix:
```js
const res = await apiPost('/api/scan', {...});
if (!res) { scanning = false; return; }
let data;
try { data = await res.json(); } catch { data = { error: 'Server error', code: 'internal_error' }; }
if (res.ok) {...} else {...}
```

Also set `scanning = false` in a `finally` to guarantee recovery.

### 5.2 `register.html:135` — resend-verification fire-and-forget

| Location | Severity | Proof |
|---|---|---|
| `register.html:133-137` | Medium | ```js\nresendCodeBtn.addEventListener('click', async (e) => {\n  e.preventDefault();\n  await apiPost('/api/auth/resend-verification', { email: registeredEmail });\n  e.target.textContent = 'Code resent!';\n``` |

Does NOT check `res.ok`. If rate limit kicks in (429) or server returns 500, user sees "Code resent!" and no code arrives. Fix: check `res.ok`, show error message.

### 5.3 **`session.html:204-208` — "End Session" ignores stop response**

| Location | Severity | Proof |
|---|---|---|
| `session.html:204-208` | **High** | ```js\ndocument.getElementById('stopBtn').addEventListener('click', async () => {\n  if (!confirm(...)) return;\n  await apiPost(`/api/sessions/${sessionId}/stop`);\n  showClosed();\n});\n``` |

Does not check response. `showClosed()` swaps to the "Session Ended" view regardless. If the stop POST fails (network blip, 403 instructor-not-owner race), the session remains `active` in DB, QR tokens keep generating, students keep scanning, instructor believes class is over.

Fix: check `res && res.ok` before `showClosed()`; show error toast otherwise.

### 5.4 `request-rebind.html:29-40` — OK but no network-failure handling

| Location | Severity | Proof |
|---|---|---|
| `request-rebind.html:29-40` | Medium | Handles `res.ok === false` path (shows `data.error`), but if `apiPost` returns a non-redirect null (it only returns null on 401 which redirects), OK. If `fetch` itself throws (network offline), the await rejects, no catch — silent button hang. |

Not blocking but: wrap in try/catch and show "Network error — try again" in the error box.

### 5.5 `forgot-password.html:37-43` — always shows success even on error

| Location | Severity | Proof |
|---|---|---|
| `forgot-password.html:35-43` | Medium | ```js\nconst res = await apiPost(...);\nif (!res) return;\nconst data = await res.json();\nshowSuccess('success', data.message);\n``` |

Never checks `res.ok`. If backend returns 400 (e.g., `email required`), the error body is rendered as a success message. Intentional "always 200 to avoid email leak" would make this fine — but the backend at `auth-controller.js:293` returns 400 on missing email. So a user with an empty email field sees "If that email exists, a reset link has been sent." as a success (green), even though it came back 400.

Fix: check `res.ok`; on failure, `showError('error', data.error)`.

### 5.6 `instructor/course.html:170-177` — cancel/remove with quiet no-op on failure

| Location | Severity | Proof |
|---|---|---|
| `course.html:170-171, 176-177` | Low | `if (res && res.ok) loadCourse();` — on failure, nothing happens. No toast, no error message. |

User clicks "Cancel" on a session, sees no feedback, session still shows "Scheduled". Tries again, same. Fix: show error banner on failure branch.

### 5.7 `instructor/course.html:248` — addSession no-op on failure

| Location | Severity | Proof |
|---|---|---|
| `course.html:244-249` | Medium | `if (res && res.ok) { closeSheet(); loadCourse(); }` — on 400 or 500, sheet stays open but no visible error is shown. |

User clicks "Add Session", nothing happens visually. Fix: populate `#sheetError` on the else branch.

### 5.8 `instructor/dashboard.html:332-353` — course creation falls through on bad-status

| Location | Severity | Proof |
|---|---|---|
| `dashboard.html:345-352` | Medium | ```js\nif (!res) return;\nconst data = await res.json();  // may throw on non-JSON 502\nif (res.ok) { ... } else { showError('createError', data.error); }\n``` |

Same class of issue as §5.1 — `res.json()` before `res.ok` check. If Render returns a 502 HTML page during redeploy, browser gets unhandled rejection.

### 5.9 `register.html:115-131` — verify code, same `res.json()`-before-`res.ok` pattern

| Location | Severity | Proof |
|---|---|---|
| `register.html:115-130` | Medium | Same pattern as 5.1 and 5.8. |

### 5.10 Nominatim search errors in `dashboard.html:175-177, 208-210`

| Location | Severity | Proof |
|---|---|---|
| `dashboard.html:175-177` | Low | `catch { suggestionsEl.style.display = 'none'; }` — silent swallow, OK for autocomplete. |
| `dashboard.html:208-210` | Low | `catch { searchBtn.textContent = 'Search'; }` — silent swallow, OK. |

Correct behavior. Noted for completeness.

### 5.11 `socket.io` client: no error handler on `session.html`

| Location | Severity | Proof |
|---|---|---|
| `session.html:143, 164-171` | High | `const socket = io({ withCredentials: true });` — no listener for `connect_error` or `error`. If server rejects the connection (line 58-63 of socket-service.js disconnects unauthenticated), instructor sees no feedback; Socket.IO retries silently, QR frame stays on "Generating QR code..." |

Fix:
```js
socket.on('connect_error', (err) => { console.error('socket error:', err); /* show reconnecting banner */ });
```

---

## 6. Zod & Validation Consistency

### 6.1 Non-Zod endpoints — 4 found

| Endpoint | File:Line | Issue |
|---|---|---|
| `POST /api/auth/verify-code` | `auth-controller.js:208-210` | Inline `if (!email || !code)` — no format check on email, no length check on code. |
| `POST /api/auth/forgot-password` | `auth-controller.js:292-293` | Inline `if (!email)` — no email format validation. |
| `POST /api/auth/resend-verification` | `auth-controller.js:319-320` | Same. |
| `POST /api/auth/request-rebind` | `auth-controller.js:380-397` | No input validation at all (reads from session only — acceptable). |

Impact: `verify-code` accepts non-6-digit codes (the downstream `eq(emailVerificationTokens.token, code)` just won't match — so no security hole, but error message is "Invalid code" instead of "Code must be 6 digits"). Minor UX gap.

### 6.2 `PATCH /api/courses/:id/sessions/:sessionId` — partial Zod

| Location | Severity | Proof |
|---|---|---|
| `course-controller.js:370-373` | Medium | `const { status } = req.body; if (status !== 'cancelled') return 400;` — no Zod. Accepts arbitrary body, silently ignores extra fields. If request is malformed JSON, express.json parser throws (caught by global handler, returns 500 with "Internal server error" — but should be 400). |

Fix: use Zod schema for this endpoint too.

---

## 7. Findings NOT included (already fixed per SESSION_REPORT_FULL.md)

Skipped per instructions:
- ScanVerifier Layer 6 (audit log) runs in `finally` block — §73
- `ip-validator.js` FAIL-OPEN policy — §70
- `audit-logger.js` never throws (wraps db call in try/catch + console.error) — §108
- `course.html` error swallowing fix — §261

---

## 8. Recommended Remediation Order

1. Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers in `server.js` (prevents Node 20+ crash on any missed rejection).
2. Fix the audit-log-before-attendance inversion in the scan pipeline (`scan-verifier.js` + `scan-controller.js`).
3. Wrap `overrideAttendance` 3-write sequence in `db.transaction()`.
4. Flip order in `notification-service.js`: send email THEN insert `warning_email_log`.
5. Wrap Socket.IO `join-session` handler in try/catch.
6. Fix `scan.html` — guard `res.json()` with try/catch, set `scanning = false` in finally.
7. Fix `session.html` stop button — check `res.ok` before `showClosed()`.
8. Add `connect_error` listener on both session.html socket and (optional) dashboards.
9. Move `verify-code`, `forgot-password`, `resend-verification` to Zod schemas.
10. Add request context (method, url, userId) to global error handler log line.
