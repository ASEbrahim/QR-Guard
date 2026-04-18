# AUDIT_10 — Dependencies

**Date:** 2026-04-18
**Scope:** Dependency hygiene, supply-chain risk, CDN/SRI, deprecated packages, shadow deps, version pinning.
**Mode:** READ-ONLY — no install / update operations were performed.
**Prior findings (do not repeat):** `qrcode`, `date-fns-tz`, `nodemon` already removed per `docs/SESSION_REPORT_FULL.md`.

---

## 1. Summary

| Category | Count | Severity |
|---|---|---|
| npm audit vulnerabilities — total | 4 | moderate |
| &nbsp;&nbsp;via `drizzle-kit` → `@esbuild-kit/*` → `esbuild` ≤ 0.24.2 (GHSA-67mh-4wv8-2f99) | 4 | moderate (dev-only) |
| Outdated prod deps (installed vs latest) | 0 | — |
| Outdated dev deps (installed vs latest) | 1 (`eslint` 10.2.0 → 10.2.1 patch) | info |
| Unused prod deps | 0 | — |
| Unused dev deps | 0 | — |
| Shadow deps (code imports, missing from package.json) | 0 | — |
| Deprecated packages in direct deps | 0 | — |
| Frontend CDN scripts without SRI hashes | 5 | **high** |
| Critical deps under caret (`^`) instead of pinned | 15/15 prod | medium |
| Cross-origin fetches without integrity | 2 (Nominatim, api.qrserver.com) | medium |

**Top priorities**
1. **No SRI integrity hashes on any of the 5 CDN scripts/stylesheets** — supply-chain compromise of `unpkg.com`, `cdn.socket.io`, `openfpcdn.io` would silently execute attacker code in student / instructor browsers. Direct impact to 6-layer anti-fraud system (fingerprint.js is security-critical).
2. **`drizzle-kit` pulls in vulnerable `esbuild ≤ 0.24.2`** via the abandoned `@esbuild-kit/esm-loader` (archived by author in 2024). Dev-only, but still exposes the dev machine when `drizzle-kit studio` / `push` runs.
3. **No version pinning** — all 15 production deps use `^` ranges; any lockfile regeneration without `--frozen-lockfile` can pull upstream minor versions. `package-lock.json` is present, which mitigates this in CI if used with `npm ci`.
4. **`cors@2.8.6`** — this package is widely considered in maintenance-only mode (last meaningful release years ago; current published version on registry is 2.8.6 at time of audit). Helmet is already installed, so CORS concerns are split across two packages — not duplicate functionality (helmet does not handle CORS), but it is the one dep worth monitoring for abandonment.

---

## 2. `npm audit --json` raw output

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "@esbuild-kit/core-utils": {
      "severity": "moderate",
      "isDirect": false,
      "via": ["esbuild"],
      "effects": ["@esbuild-kit/esm-loader"],
      "range": "*",
      "fixAvailable": { "name": "drizzle-kit", "version": "0.18.1", "isSemVerMajor": true }
    },
    "@esbuild-kit/esm-loader": {
      "severity": "moderate",
      "isDirect": false,
      "via": ["@esbuild-kit/core-utils"],
      "effects": ["drizzle-kit"],
      "range": "*",
      "fixAvailable": { "name": "drizzle-kit", "version": "0.18.1", "isSemVerMajor": true }
    },
    "drizzle-kit": {
      "severity": "moderate",
      "isDirect": true,
      "via": ["@esbuild-kit/esm-loader"],
      "range": "0.17.5-6b7793f - 0.17.5-e5944eb || 0.18.1-065de38 - 0.18.1-f3800bf || 0.19.0-07024c4 - 1.0.0-beta.1-fd8bfcc",
      "fixAvailable": { "name": "drizzle-kit", "version": "0.18.1", "isSemVerMajor": true }
    },
    "esbuild": {
      "severity": "moderate",
      "via": [{
        "source": 1102341,
        "title": "esbuild enables any website to send any requests to the development server and read the response",
        "url": "https://github.com/advisories/GHSA-67mh-4wv8-2f99",
        "cwe": ["CWE-346"],
        "cvss": { "score": 5.3, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N" },
        "range": "<=0.24.2"
      }],
      "effects": ["@esbuild-kit/core-utils"],
      "range": "<=0.24.2"
    }
  },
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 0, "moderate": 4, "high": 0, "critical": 0, "total": 4 },
    "dependencies": { "prod": 128, "dev": 281, "optional": 136, "peer": 27, "total": 409 }
  }
}
```

**Interpretation.** The `fixAvailable` pointer (`drizzle-kit@0.18.1`) is a **downgrade** from the installed `0.31.10` — npm's resolver is confused because 0.18.1 is the last version that didn't depend on `@esbuild-kit/*`. In reality drizzle-kit ≥ 0.22 moved off `@esbuild-kit` to bundled esbuild, but this project is on 0.31.10 and `npm audit` still reports the transitive tree via an older path that survived as an optional dep. Worth a manual `npm dedupe` + verifying with `npm ls esbuild` to see whether the vulnerable tree is actually reachable.

---

## 3. `npm outdated --json` raw output

```json
{
  "eslint": {
    "current": "10.2.0",
    "wanted": "10.2.1",
    "latest": "10.2.1",
    "dependent": "QR-Guard",
    "location": "node_modules/eslint"
  }
}
```

Everything else is at latest. This is excellent dependency hygiene.

---

## 4. Per-dependency status — production

| Package | Declared | Installed | Latest | Used in | Notes |
|---|---|---|---|---|---|
| bcrypt | ^6.0.0 | 6.0.0 | 6.0.0 | `controllers/auth-controller.js` | v6 uses native bindings; native compile required on deploy (Render). |
| connect-pg-simple | ^10.0.0 | 10.0.0 | 10.0.0 | `server.js` | Session store. |
| cors | ^2.8.6 | 2.8.6 | 2.8.6 | `server.js` | Maintenance-only; monitor for abandonment. Not duplicate with helmet (helmet doesn't set CORS headers). |
| csv-stringify | ^6.7.0 | 6.7.0 | 6.7.0 | `controllers/report-controller.js` (uses `/sync` subpath) | OK. |
| date-fns | ^4.1.0 | 4.1.0 | 4.1.0 | `services/session-generator.js` | Only 6 functions imported — tree-shaking via ESM OK. |
| dotenv | ^17.4.2 | 17.4.2 | 17.4.2 | `server.js` (`dotenv/config`) | OK. |
| drizzle-orm | ^0.45.2 | 0.45.2 | 0.45.2 | 25 files | Core ORM. |
| express | ^5.2.1 | 5.2.1 | 5.2.1 | `server.js` + 5 route files | **Express 5** — note breaking changes vs 4.x (error handling for async handlers). |
| express-rate-limit | ^8.3.2 | 8.3.2 | 8.3.2 | `middleware/rate-limiter.js` | OK. |
| express-session | ^1.19.0 | 1.19.0 | 1.19.0 | `server.js` | OK. |
| helmet | ^8.1.0 | 8.1.0 | 8.1.0 | `server.js` | `contentSecurityPolicy: false` — see AUDIT_07 (security). |
| pg | ^8.20.0 | 8.20.0 | 8.20.0 | `config/database.js` | OK. Note pg 9.x is in beta at time of audit. |
| resend | ^6.12.0 | 6.12.0 | 6.12.0 | `services/email-service.js` | OK. |
| socket.io | ^4.8.3 | 4.8.3 | 4.8.3 | `services/socket-service.js` | Server. Must match client CDN version `4.7.5` → **version mismatch** (see §6). |
| zod | ^4.3.6 | 4.3.6 | 4.3.6 | 4 controllers | Zod v4 — breaking API vs v3. |

All 15 prod deps **are used**. No removal candidates.

---

## 5. Per-dependency status — development

| Package | Declared | Installed | Latest | Used in | Notes |
|---|---|---|---|---|---|
| @eslint/js | ^10.0.1 | 10.0.1 | 10.0.1 | `eslint.config.js` | OK. |
| @playwright/test | ^1.59.1 | 1.59.1 | 1.59.1 | `scripts/screenshot-*.js` | Imports `chromium`. Screenshot tooling only — no actual E2E tests. |
| drizzle-kit | ^0.31.10 | 0.31.10 | 0.31.10 | `drizzle.config.js`, npm scripts | **Source of all 4 npm-audit vulns** (see §2). |
| eslint | ^10.2.0 | **10.2.0** | **10.2.1** | `npm run lint` | Patch behind. |
| prettier | ^3.8.3 | 3.8.3 | 3.8.3 | `npm run format` | OK. |
| supertest | ^7.2.2 | 7.2.2 | 7.2.2 | `tests/integration/auth-flow.test.js` | OK. |
| vitest | ^4.1.4 | 4.1.4 | 4.1.4 | 8 test files | OK. |

All 7 dev deps **are used**. No removal candidates.

---

## 6. Frontend CDN assets

| URL | Version pinned | SRI integrity | HTTPS | Crossorigin attr | Fallback | Criticality |
|---|---|---|---|---|---|---|
| `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` | yes (`@1.9.4`) | **no** | yes | no | none | high (instructor dashboard map) |
| `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js` | yes (`@1.9.4`) | **no** | yes | no | none | high |
| `https://cdn.socket.io/4.7.5/socket.io.min.js` | yes (`4.7.5`) | **no** | yes | no | none | high (instructor/session.html realtime) |
| `https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js` | yes (`@2.3.8`) | **no** | yes | no | none | **critical** — student scan flow |
| `https://openfpcdn.io/fingerprintjs/v4` (dynamic `import()`) | **no** (floats on `v4`) | **no** (impossible for dynamic import without modulepreload+integrity) | yes | n/a | none | **critical** — device fingerprint is an anti-fraud layer |

**Runtime tile/API endpoints (not script loads, but third-party trust):**

| URL pattern | Notes |
|---|---|
| `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/...` | ESRI tiles, no key, subject to ESRI ToS for attribution. |
| `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/...` | Same. |
| `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` | CARTO tiles — rate-limited for heavy use. |
| `https://nominatim.openstreetmap.org/search?...` | OSM Nominatim — has a **strict usage policy** (max 1 req/sec, must set HTTP Referer / User-Agent). Autocomplete triggering per-keystroke could violate ToS. |
| `https://api.qrserver.com/v1/create-qr-code/?...` | Third-party QR image generator — **the QR token payload is sent to a third-party service**. This leaks session QR tokens to `api.qrserver.com`. Should be generated server-side or via a local `qrcode` package. (Note: the prior audit **removed** the `qrcode` npm dep, but the HTML still depends on `api.qrserver.com` — they replaced a local dep with a third-party service, which is arguably worse for privacy.) |

**Key findings:**
- **Zero SRI hashes** across the whole frontend. An attacker who compromises `unpkg.com` or `cdn.socket.io` can inject arbitrary JS into every user's browser. unpkg.com has had outage / mis-serve incidents in the past.
- **`openfpcdn.io/fingerprintjs/v4`** is unpinned (floats on `v4` major). Any new release rolls forward immediately; if that CDN is compromised, the entire anti-fraud fingerprint layer becomes attacker-controlled.
- **Version mismatch:** server uses `socket.io@4.8.3`, client loads `4.7.5`. Same major — protocol-compatible — but the drift will grow.
- **`api.qrserver.com` is a supply-chain and privacy regression** compared to generating QR server-side.

---

## 7. Supply-chain risk — known-problem packages

No direct deps currently match known ownership-change / typosquat / protestware lists (e.g. `node-ipc`, `colors`, `faker`, `event-stream`, `ua-parser-js` 2021 incident, `flatmap-stream`, etc.). All 15 prod + 7 dev deps are from well-known publishers (Vercel, Resend, Automattic, etc.).

The `@esbuild-kit/*` packages flagged by `npm audit` were **archived by their author** in 2024 — not malicious, but no longer maintained. Drizzle-kit mainline has moved off these packages but `npm audit` still reports them via a transitive path in the installed tree — worth verifying with `npm ls @esbuild-kit/esm-loader` whether the vulnerable path is actually reachable.

---

## 8. Duplicate functionality

- **cors + helmet** — not duplicate. Helmet does not set `Access-Control-Allow-*`. No overlap.
- **No duplicate logger / validator / ORM / HTTP client** found. Clean.

---

## 9. Shadow dependencies (code imports, missing from package.json)

None found. All imported bare specifiers (`bcrypt`, `connect-pg-simple`, `cors`, `csv-stringify`, `csv-stringify/sync`, `date-fns`, `dotenv/config`, `drizzle-orm`, `drizzle-orm/node-postgres`, `drizzle-orm/pg-core`, `express`, `express-rate-limit`, `express-session`, `helmet`, `pg`, `resend`, `socket.io`, `vitest`, `vitest/config`, `zod`, `@eslint/js`, `@playwright/test`, `supertest`) are declared. `node:crypto`, `node:http`, `node:path`, `node:url` are Node built-ins and OK.

---

## 10. Recommended actions (not performed — this is an audit)

Ranked by impact:

1. **Add SRI integrity hashes** to all 4 static CDN script/link tags (Leaflet CSS+JS, socket.io client, html5-qrcode). Generate with `openssl dgst -sha384 -binary FILE | openssl base64 -A`, then add `integrity="sha384-..." crossorigin="anonymous"` attributes.
2. **Pin `openfpcdn.io/fingerprintjs` to a concrete version** (e.g. `v4.6.2`) instead of floating `v4`. Consider self-hosting the bundle under `/src/frontend/scripts/vendor/` since this is a security-critical fraud layer.
3. **Replace `api.qrserver.com` with server-side QR generation.** The prior audit removed `qrcode` npm dep for being "unused" but the HTML still relies on a third-party to render the token payload into an image — each QR render leaks the signed token to a third-party. Either bring back `qrcode` (server-side) or use a small client lib like `qrcode-generator` self-hosted.
4. **Align socket.io client to 4.8.3** (or pin server to 4.7.5) — keep client/server on the same version.
5. **Run `npm ls esbuild` and `npm dedupe`** to verify whether the vulnerable `esbuild ≤ 0.24.2` tree is actually reachable. If so, file an upstream issue with `drizzle-kit` or add a `package.json` `overrides` entry forcing `esbuild@^0.25`.
6. **Bump eslint patch:** `eslint ^10.2.0 → ^10.2.1`.
7. **Version-pinning policy:** for a security-sensitive app, consider replacing `^` with `~` (allow only patch bumps) on `bcrypt`, `express`, `express-session`, `helmet`, `zod`, `drizzle-orm`. Caret ranges + lockfile are fine for CI with `npm ci`, but a `renovate.json` / Dependabot config would make bumps auditable.
8. **Throttle Nominatim autocomplete** (current code fires per keystroke) — violates OSM Nominatim usage policy (1 req/sec max). Add 300-500 ms debounce.
9. **Self-host ESRI/CARTO tiles behind a proxy** OR obtain API keys — current usage is anonymous and subject to ToS throttling at production traffic.

---

## Appendix A — Files inspected

- `/home/ahmad/Downloads/csis/QR-Guard/package.json`
- `/home/ahmad/Downloads/csis/QR-Guard/package-lock.json` (metadata only)
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/**` (40 files, import scan)
- `/home/ahmad/Downloads/csis/QR-Guard/src/frontend/**` (HTML/JS CDN scan)
- `/home/ahmad/Downloads/csis/QR-Guard/scripts/*.js` (playwright usage)
- `/home/ahmad/Downloads/csis/QR-Guard/tests/integration/auth-flow.test.js` (supertest usage)
- `/home/ahmad/Downloads/csis/QR-Guard/eslint.config.js`, `vitest.config.js`
