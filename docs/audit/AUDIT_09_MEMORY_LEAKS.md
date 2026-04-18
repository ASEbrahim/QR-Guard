# AUDIT_09 — Memory Leaks

**Scope:** QR-Guard (Node 20 / Express / Socket.IO / drizzle-orm / pg Pool backend; static HTML + Leaflet + html5-qrcode + socket.io-client frontend).
**Mode:** READ-ONLY review.
**Prior fixes (not re-reported):**
- `setInterval(cleanupExpiredTokens, 10 min)` on startup (`server.js:104`).
- Orphaned `active` sessions force-closed on startup (`server.js:108`).
- `stopRefreshLoop(sessionId)` called on `/sessions/:id/stop` (`session-controller.js:64`).
- `activeLoops.delete(sessionId)` on stop (`qr-service.js:83`).

---

## Summary

| Severity | Count | Area |
|----------|-------|------|
| High     | 2     | Backend shutdown, frontend scanner |
| Medium   | 4     | Frontend QR polling, map, socket, GPS getCurrentPosition timeout |
| Low      | 3     | ip-validator timer, signal handlers absent, status-card listener accumulation |
| Info     | 2     | connect-pg-simple pruning, Socket.IO room cap |

Overall: the *server-side* leak surface is small and well-bounded — the single `activeLoops` Map has correct allocation/free pairing. The real risks are **frontend** (SPA-style page stays open, camera/scanner/leaflet instances never torn down) and **missing graceful-shutdown** on the backend (no SIGTERM → no `stopRefreshLoop` sweep, no `pool.end()`, no `io.close()`).

---

## Findings

### H1. Backend — no graceful shutdown; in-flight intervals and DB pool leak on SIGTERM

**Allocation sites:**
- `src/backend/server.js:104` — `setInterval(cleanupExpiredTokens, 10*60*1000)` (return value discarded — handle is lost, cannot clear).
- `src/backend/services/qr-service.js:62` — `setInterval` per active session, stored in `activeLoops: Map<sessionId, Timeout>`.
- `src/backend/config/database.js:7` — pg `Pool` (process-global).
- `src/backend/services/socket-service.js:46` — `io = new Server(httpServer, …)` (process-global).

**Should be freed:** in a `SIGTERM` / `SIGINT` handler:
```js
process.once('SIGTERM', async () => {
  clearInterval(tokenCleanupHandle);
  for (const [id, t] of activeLoops) { clearInterval(t); activeLoops.delete(id); }
  io?.close();
  httpServer.close();
  await pool.end();
});
```

**Why it isn't:** a grep of the entire `src/` tree for `SIGTERM|SIGINT|uncaughtException|unhandledRejection|process\.on` returns **zero matches**. There is no shutdown hook anywhere.

**Impact:** in a container restart / rolling deploy, Node is killed by SIGTERM after a short grace window. During that window:
- HTTP/Socket.IO connections are dropped without `io.close()` being awaited (clients get RST rather than a clean disconnect).
- pg `Pool` idle clients never call `.end()`, so connections leave PG backends in "terminated abnormally" state (PG logs + brief orphan slots).
- `cleanupExpiredTokens` interval handle was never stored — even if somebody adds a handler later, they can't clear it.
- The process can fail to exit before the orchestrator's kill-timeout, forcing SIGKILL and leaving partially-written state.

This is the single highest-value backend fix and is not tracked by any prior finding.

---

### H2. Frontend — `html5-qrcode` scanner and camera stream leak on navigation

**Allocation site:** `src/frontend/student/scan.html:124`
```js
const scanner = new Html5Qrcode('reader');
scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: {…} }, onScanSuccess, () => {});
```

**Should be freed:** `scanner.stop(); scanner.clear()` from a `pagehide` / `beforeunload` / `visibilitychange=hidden` handler, plus on component teardown.

**Currently freed only at:** line 146 (`try { await scanner.stop(); } catch {}`) — *inside `onScanSuccess`, i.e. only after a successful decode*. If the user:
- Taps "Back to Dashboard",
- Navigates away via the bottom nav (renderBottomNav),
- Locks their phone / switches tabs,
- Gets an error path that doesn't call `onScanSuccess`,

…then `scanner` — and more importantly the `MediaStream` obtained from `getUserMedia` — is never released. On mobile this manifests as:
1. Camera LED stays on in the BFCache'd page.
2. Subsequent apps/tabs get `NotReadableError` ("camera in use").
3. Retained `<video>` + canvas buffers (several MB each) pin memory.

The retry path at line 192 also re-calls `scanner.start(...)` without stopping first — html5-qrcode tolerates this, but it still creates a new render loop while the previous one is still paused, increasing the chance of stuck streams.

---

### M1. Frontend — `instructor/session.html` Socket.IO + polling interval leak on navigation

**Allocation sites (`src/frontend/instructor/session.html`):**
- Line 143: `const socket = io({ withCredentials: true });`
- Line 176: `pollInterval = setInterval(async () => { apiGet(`/api/sessions/${sessionId}/qr`) … }, 10000);` — started from the `disconnect` handler as a fallback.

**Should be freed on page hide:**
```js
window.addEventListener('pagehide', () => {
  if (pollInterval) clearInterval(pollInterval);
  socket.disconnect();
});
```

**Why it isn't:** no `pagehide` / `beforeunload` / visibility handler exists. Today it mostly "works" because the browser tears down the page on hard navigation, but:
- On back-forward cache (BFCache, standard on iOS Safari + Android Chrome) the page is *suspended*, not torn down. The `socket.io-client` heartbeat keeps running from the cached page; when the user returns, a second `socket` is constructed and both occupy a session room.
- The `pollInterval` started in a `socket.on('disconnect')` handler is **never cleared if the socket never reconnects** before navigation — so on BFCache restore the 10 s polling keeps hitting `/api/sessions/:id/qr` from a zombie tab.
- On successful reconnect (line 185) it *is* cleared — good — but the disconnect path is only partially symmetric.

Also: `socket.emit('join-session', sessionId)` is called on every reconnect with no dedupe, and there is no `leave-session` on unload — this combines with F5 below.

---

### M2. Frontend — Leaflet `map` instance never `.remove()`d

**Allocation site:** `src/frontend/instructor/dashboard.html:85`
```js
map = L.map('map').setView([29.3117, 47.9835], 16);
```
with tile layers (`L.tileLayer(...)`), a `layers` control, click handler (`map.on('click', …)`), and dynamically added `marker` / `circle`.

**Should be freed:**
- `map.remove()` on page hide (detaches all DOM listeners, XHR tile-requests, and animation frames Leaflet keeps internally).
- Or at minimum `map.off()` + `marker.remove()` + `circle.remove()`.

**Why it isn't:** `Grep` for `map\.remove\b` returns only `map.removeLayer(marker)` / `map.removeLayer(circle)` inside the click handler (layer swaps, not map teardown). There is no page-level teardown. Each Leaflet map instance holds:
- A document-level `mousemove` / `touchmove` listener (zoom handler).
- A tile-layer event loop that keeps firing `load`/`error` until all queued tile HTTP requests settle — so navigating away mid-load leaves pending `fetch` callbacks holding references.

`initMap()` is guarded by `if (!map)` so it only runs once per page load (good), but on BFCache restore the old listeners are still alive.

Also note the `document.addEventListener('click', …)` at dashboard.html:189 — a **document-level** listener installed from inside `initMap()`. Even if `initMap` were re-run defensively, this listener is never removed, so repeat calls would stack duplicates.

---

### M3. Frontend — scan.html GPS `getCurrentPosition` has no pending-request cancel

**Allocation site:** `src/frontend/student/scan.html:110`
```js
navigator.geolocation.getCurrentPosition(success, err, { timeout: 10000, enableHighAccuracy: true });
```

Not technically `watchPosition`, so no `clearWatch` is needed. But: on high-accuracy mode the browser keeps GPS hardware powered until either callback fires or the 10 s timeout expires. If the user navigates away within that window, the hardware request continues in the background against the *unloaded page's* callbacks, which the browser eventually GCs. No long-lived leak, but:

- If the request is still outstanding when the page is BFCache'd, the success callback can run against a frozen page, flipping `gpsDot.active` on a hidden document and leaving `gpsData` captured in a closure.
- Combined with H2 (scanner still running) this extends the camera-LED-on window.

**Recommendation:** move to `watchPosition` (better fix) and clearWatch on pagehide, or wrap `getCurrentPosition` in an `AbortController`-equivalent flag that is checked in the callbacks.

---

### M4. Frontend — `status-card` action button listener accumulation

**Allocation site:** `src/frontend/student/scan.html:213-217`
```js
if (actionLabel) {
  const btn = el.querySelector('#statusAction');
  btn.textContent = actionLabel;
  btn.addEventListener('click', actionFn);
}
```
`showStatus()` is called many times during a scan session (verifying → success/error/retry). Each call replaces `el.innerHTML` with a freshly-parsed tree, so the old `#statusAction` node + its listener become unreachable and will be GC'd — *normally*. But `actionFn` closures capture `location.reload`, which itself is harmless.

Low-severity and mostly benign (GC reclaims the detached DOM), but flagged because:
- The pattern of `innerHTML = ...` followed by `addEventListener` on a query-selected child is fragile — if anyone later holds a reference to the outer `el` via another selector cache, the listener stays pinned.
- Accessibility alert listeners (role="alert") accumulate briefly before GC.

Preferred fix: delegate via a single listener on `#result`.

---

### L1. Backend — `ip-validator.js` timer not cleared on fetch throw

**Allocation site:** `src/backend/validators/ip-validator.js:18`
```js
const timeout = setTimeout(() => controller.abort(), IP_API_TIMEOUT_MS);
const res = await fetch(...);
clearTimeout(timeout);    // line 23 — only reached if fetch resolves
```

**Should be freed:** in a `finally` block.

**Why it isn't:** if `fetch` throws synchronously (DNS failure inside node-fetch, AbortError, TypeError on malformed URL), control jumps to `catch` at line 42 and `clearTimeout` is skipped. The timer still fires and calls `controller.abort()` on an already-consumed controller (harmless), **but** the Timeout object is kept alive by Node's timer list until it fires. For the default `IP_API_TIMEOUT_MS`, this is a few seconds per failed scan — negligible leak, but the idiom is wrong and will be copy-pasted.

```js
// Fix
try {
  const res = await fetch(url, { signal: controller.signal });
  ...
} finally {
  clearTimeout(timeout);
}
```

---

### L2. Backend — no `process.on('uncaughtException'|'unhandledRejection')`

**Allocation site (missing):** `src/backend/server.js`.

Not a listener leak per se — but the absence means:
- An `unhandledRejection` in the `db.update(...)` call at server.js:108 is caught (`.catch(...)`), good.
- An `unhandledRejection` inside the `setInterval` refresh callback at `qr-service.js:62` is caught by the inner `try/catch`, good.
- But a thrown sync error anywhere outside those will crash the process with no cleanup (see H1).

Impact is coupled with H1. Single listener each, installed with `.once(...)`, is sufficient — there's no current risk of duplicate listeners because no module installs any process listener.

---

### L3. Frontend — `document.addEventListener('click', …)` inside `initMap()` never removed

**Allocation site:** `src/frontend/instructor/dashboard.html:189`
```js
document.addEventListener('click', (e) => {
  if (!e.target.closest('#mapSearch') && !e.target.closest('#mapSuggestions')) {
    suggestionsEl.style.display = 'none';
  }
});
```

`initMap()` is guarded by `if (!map) initMap()` so it only runs once per page load — this mitigates the leak today. Flagged because:
- Any future refactor that re-opens the create-course panel after closing would re-run `initMap()` and stack duplicate document listeners on each call.
- The closure pins `suggestionsEl` (a `querySelector`-sourced node) for the life of the document, which is longer than the panel's visibility.

---

## Info-level (verified OK, worth recording)

### I1. connect-pg-simple session store pruning

`src/backend/server.js:49`:
```js
store: new PgSession({ pool, createTableIfMissing: true })
```
No `pruneSessionInterval` override. **Default is 15 minutes** (active pruning on by default since connect-pg-simple v6) — so expired session rows are removed. No leak. Could be tuned, but no action required.

### I2. Socket.IO room cap

`src/backend/services/socket-service.js:70`: `if (socket.rooms.size > 5) return;` — prevents unbounded room-join accumulation per socket. Also the `join-session` handler validates UUID format and re-runs the auth check, so a malicious client cannot grow the socket's room set beyond 5 + the socket's own id.

Socket.IO itself manages the `connections` / `rooms` maps and cleans up on `disconnect` automatically; no custom tracking structure was added to the codebase that would need manual cleanup.

### I3. Bounded in-memory Maps

All `new Map()` call sites:
| File | Line | Lifetime | Bound |
|------|------|----------|-------|
| `services/qr-service.js` | 6 | Process-global | ≤ number of concurrent active sessions (add on start, remove on stop). No leak. |
| `services/attendance-calculator.js` | 71 | Function-local | GC'd on return. |
| `controllers/report-controller.js` | 40, 43, 51, 163, 166, 173 | Function-local | GC'd on return. |

No module-level `Set` or accumulating closure was found.

### I4. Rate-limiter store

`src/backend/middleware/rate-limiter.js` uses `express-rate-limit` with default memory store. Default store uses an LRU with `windowMs` expiry per key — bounded by distinct IPs within the window (10 min / 60 min / 1 min). On a single-process small deployment this is fine. For multi-instance / production, swap to a Redis store (separate concern — scaling, not leak).

### I5. PostgreSQL pool

No `pool.connect()` / manual client acquisition in production code paths — all queries go through Drizzle, which acquires and releases a client per query. No `client.release()` footguns exist. See H1 for the missing `pool.end()` on shutdown.

---

## Recommended remediation order

1. **H1** — add a SIGTERM handler that clears the token-cleanup interval handle, iterates `activeLoops` calling `clearInterval`, closes Socket.IO, ends the pg Pool. ~30 lines in `server.js`.
2. **H2** — on `student/scan.html`, install `pagehide` + `visibilitychange` handlers that call `scanner.stop()` + `scanner.clear()`. Fixes camera-LED complaints.
3. **M1** — on `instructor/session.html`, clear `pollInterval` and `socket.disconnect()` on `pagehide`.
4. **M2** — on `instructor/dashboard.html`, call `map.remove()` on `pagehide`.
5. **L1** — wrap the `ip-validator` timeout clear in `finally`.
6. **M3, M4, L2, L3** — opportunistic cleanup; individually low impact.
