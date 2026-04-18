# AUDIT 13 — Accessibility (WCAG 2.1 AA)

**Scope:** `src/frontend/**/*.html` + `src/frontend/styles/main.css` + `src/frontend/scripts/components.js`
**Mode:** READ-ONLY audit. No code changes made.
**Standard:** WCAG 2.1 Level AA
**Date:** 2026-04-18

**Already addressed in prior work (Round 3 audit — excluded from scope below):**
- Focus ring visibility on inputs (`main.css:253–257`)
- `role="alert"` on all error `.message.error` containers
- Skip-to-content link inserted by `renderNav()` (`components.js:12–16`)

---

## 1. Summary Table

Severity: **Critical** = blocks AA compliance for core users; **High** = likely AA failure; **Medium** = AA edge/borderline; **Low** = best-practice nit.

| # | Page / Scope | Issue | Severity | WCAG Criterion |
|---|---|---|---|---|
| 1 | Global (`main.css:14,15,537–540`) | Accent gold `#D4A037` on white/cream fails text contrast (~2.8:1) | High | 1.4.3 Contrast (Minimum) |
| 2 | Global (`main.css:30,429`) | `--text-muted #64748b` on `--bg #f4ecdb` ≈ 3.66:1 — fails AA normal text | High | 1.4.3 |
| 3 | Global (`main.css:23,515`) | `--warning #d97706` and `--success #16a34a` on white/`--warning-light` fail 4.5:1 | High | 1.4.3 |
| 4 | Global (`main.css:529–540`) | `.enrollment-code` gold on cream — large pill but numeric data, ~3:1 | High | 1.4.3 |
| 5 | `index.html:9–13`, all HTML pages | No `<main>` landmark; `<nav>` only injected via JS (fails before JS runs / no-JS SR users) | High | 1.3.1 Info & Relationships, 2.4.1 Bypass Blocks |
| 6 | `components.js:18–27, 36–45, 55–84` | Skip-link target `#main-content` has **no matching element** on any page — skip link is a dead anchor | Critical | 2.4.1 Bypass Blocks |
| 7 | `components.js:11–28, 35–45` | `renderNavWithBack()` does **not** add the skip-link (only `renderNav()` does). Sub-pages lose skip-nav | High | 2.4.1 |
| 8 | `instructor/dashboard.html:24–29` | Form labels not associated — `<label>Course Name</label><input id="cName">` no `for=` | Critical | 1.3.1, 3.3.2 Labels or Instructions, 4.1.2 Name/Role/Value |
| 9 | `instructor/dashboard.html:33,35,39,43,46` | Radius/search/schedule inputs same pattern — orphan labels (`<label>` wraps text only, no `for`) | Critical | 1.3.1, 3.3.2 |
| 10 | `instructor/dashboard.html:251–262` | Dynamically-generated schedule `<select>` elements have no `<label>` or `aria-label` for Day/Start/End | High | 4.1.2, 3.3.2 |
| 11 | `instructor/dashboard.html:261` | Dynamic remove-slot button uses `&times;` with no accessible name | High | 4.1.2 |
| 12 | `instructor/course.html:162` | Remove-student icon button has `aria-label="Remove student"` — but the user's name is not included; SR announces "Remove student" for every row | Medium | 2.5.3 Label in Name / 4.1.2 |
| 13 | `instructor/course.html:64–92` | Bottom-sheet modal opens but focus is **not moved into the sheet** and **not trapped**; focus doesn't return to trigger on close | Critical | 2.4.3 Focus Order, 2.4.7 Focus Visible, 2.1.2 No Keyboard Trap (inverse) |
| 14 | `student/dashboard.html:30–50` | Same modal issue — only partial fix: `codeInput.focus()` at 250ms (`:108`), but no focus trap and no return-focus on close | High | 2.4.3 |
| 15 | `instructor/session.html:113` | `<img id="qrImage" alt="QR Code">` — `alt` text is generic. QR is the core functional content for students; instructors need to know it's refreshing | Medium | 1.1.1 Non-text Content |
| 16 | `instructor/session.html:120–122, 168` | Attendance counter updates live but has no `aria-live` region — SR users don't hear "12 of 30 checked in" | Critical | 4.1.3 Status Messages |
| 17 | `instructor/session.html:159–160, 164` | "Starting..." → "Live" status badge change has no SR announcement | High | 4.1.3 |
| 18 | `student/scan.html:99–100` | `<div id="reader">` (camera viewfinder) is a functional region with **no alternative** for blind users. No "enter code manually" fallback | Critical | 1.1.1, 1.3.3 Sensory Characteristics |
| 19 | `student/scan.html:94–97` | GPS status text updates without `aria-live`; blind users never hear "GPS locked" | High | 4.1.3 |
| 20 | `student/scan.html:200–219` | `showStatus()` writes to `#result` (no `role`/`aria-live`), so scan success/failure silent for SR | Critical | 4.1.3 |
| 21 | `student/scan.html:110–121` | GPS permission denied path — only text changes; no retry button, no explanation of how to re-enable | High | 3.3.3 Error Suggestion |
| 22 | `student/scan.html:103` (html5-qrcode library) | Scanner start errors — camera denial path has a "Reload" action but provides no manual-entry alternative | High | 1.1.1, 2.1.1 Keyboard |
| 23 | `main.css:407–449, 60–71 registry` | `.bottom-nav-item` has ~44px tap height but padding `0.4rem 0 ...` on container + icon 1.2rem + 0.65rem text ≈ 40px combined — **below 44×44 min target** | High | 2.5.5 Target Size (enhanced) / AAA; AA "Target Size (Minimum)" 24×24 passes |
| 24 | `components.js:59–82` | Bottom-nav icons `&#9776; &#9634; &#9881; &#10140;` have visible text labels (good) — but icons are `<span>` with no `aria-hidden="true"`, read twice by some SRs | Medium | 1.3.1 |
| 25 | `components.js:69, 78` | `<button class="bottom-nav-item" onclick="doLogout()">` — inline onclick, no type attribute. `button` defaults to `submit` inside forms; here outside form is OK, but inconsistent with rest of codebase | Low | Best-practice |
| 26 | `login.html:32`, `register.html:40`, `reset-password.html:26` | `<button type="button" class="password-toggle">Show</button>` — no `aria-pressed` or `aria-label="Show password"`; just "Show" is ambiguous | High | 4.1.2 |
| 27 | `login.html:19`, `register.html:20` | `<h1>QR-Guard</h1>` is the same on every auth page (brand), not page-specific. The page's actual purpose ("Log In", "Create account") is only in `<p>` or submit button | Medium | 2.4.6 Headings and Labels |
| 28 | `forgot-password.html:13, 17–19`, `reset-password.html:13`, `verify-email.html:13` | Double-H1: `<h1>QR-Guard</h1>` in `.auth-brand` plus pages have no second heading — confusing for SR users skimming | Medium | 2.4.6, 1.3.1 |
| 29 | `instructor/course.html:40–47` | Tabs: `role="tablist"` + `role="tab"` + `aria-selected` present (good) but missing `aria-controls` linking tab → panel, and panels missing `aria-labelledby` | High | 1.3.1, 4.1.2 |
| 30 | `instructor/course.html:181–196` | Tab keyboard nav — only click listeners. Arrow-key navigation between tabs (required by ARIA Authoring Practices) is missing | High | 2.1.1 Keyboard |
| 31 | `instructor/course.html:169, 175`, `instructor/session.html:205` | `confirm()` native dialog used for destructive ops — generally accessible, but button triggering has no `aria-describedby` hinting consequence | Low | 3.3.4 Error Prevention |
| 32 | `instructor/dashboard.html:55`, `student/dashboard.html:37`, etc. | `.message` containers have `display: none` set via CSS (`main.css:333`) — content set via `showError()` (`api.js:59–65`) doesn't insert `aria-live`; since parent has `role="alert"` it announces, but showSuccess replaces className removing the role (see #33) | High | 4.1.3 |
| 33 | `api.js:67–74` | `showSuccess()` overwrites `el.className = 'message success'`, **stripping any `role="alert"`** attribute only if that role was in class (it's attr so survives) — BUT it does not re-assert `aria-live` and the element may have been display:none before, so SR announcement is unreliable. Also, **`<div id="success">` blocks have no `role`** (only error blocks do) — success messages are silent | High | 4.1.3 |
| 34 | Global (`main.css:2–7, 46, 54–63, 629, 645, 672, 1140`) | Multiple animations (`fadeIn`, `slideUp`, `spin`, `shimmer`, `loading-bar`, `tabFadeIn`, `pulse` in `session.html:36`, `scan.html:21`) — **no `@media (prefers-reduced-motion: reduce)` override anywhere** | High | 2.3.3 Animation from Interactions (AAA) / 2.2.2 Pause, Stop, Hide |
| 35 | `main.css:256` | Focus ring `box-shadow: 0 0 0 3px rgba(154,24,43,0.35)` — 35% alpha red on light `--bg` (#f4ecdb) may not meet 3:1 non-text contrast on all surfaces | Medium | 1.4.11 Non-text Contrast |
| 36 | `main.css:443, 517` | `.bottom-nav-item.active` color `var(--primary)` on white — fine. But **no non-color indicator** for active tab; users with color blindness can't tell which tab is active | Medium | 1.4.1 Use of Color |
| 37 | `main.css:1028–1031` | Session status uses color-only coding on the `::before` stripe (`scheduled`=gold, `active`=green, `closed`=muted, `cancelled`=red). Status also appears as text (`session-row-status`) so passes, but the color legend is never explained | Low | 1.4.1 |
| 38 | `instructor/dashboard.html:68`, `course.html:60`, `student/dashboard.html:26` | FAB has `aria-label` (good) but `title` duplicates it — redundant; SRs may announce twice | Low | Best-practice |
| 39 | `instructor/course.html:68`, `student/dashboard.html:34` | Sheet close button: `aria-label="Close"` — should be "Close dialog" or "Close Add Session" for clarity; bare "Close" context-free | Low | 2.4.6 |
| 40 | `login.html:12, 22, etc.` across all auth pages | AUK logo `<img src="/assets/auk-logo.svg" alt="AUK">` — `alt="AUK"` is an abbreviation; should be "American University of Kuwait" at first occurrence | Low | 1.1.1 |
| 41 | `components.js:22, 40` | Nav brand logo `alt="AUK"` adjacent to text "QR-Guard" — logo is decorative in this context and should be `alt=""` to avoid "AUK QR-Guard" redundancy | Low | 1.1.1 H67 |
| 42 | `instructor/session.html:97, 129`, `register.html:123` | Raw emoji/entity icons (`&#9888;`, `&#9989;`, `&#10003;`) without `aria-hidden="true"` — SRs read "warning sign character" etc | Medium | 1.3.1 |
| 43 | `instructor/dashboard.html:39` | Map instructions "Click the map to set the center point" — no keyboard equivalent for setting geofence center. Leaflet map is **not keyboard-operable for point-drop** | Critical | 2.1.1 Keyboard |
| 44 | `instructor/dashboard.html:136–157` | Dynamically-built search suggestion list uses `<div>` with inline onclick handlers — not keyboard-focusable, no `role="listbox"`/`role="option"`, no arrow-key navigation | High | 2.1.1, 4.1.2 |
| 45 | `instructor/course.html:149–153` | Empty states (`display:block`/`none`) appear/disappear with no announcement | Medium | 4.1.3 |
| 46 | `instructor/dashboard.html:62–63`, `student/dashboard.html:21` | `.skeleton-card` loaders have no `aria-busy="true"` on container; SR doesn't know content is loading | Medium | 4.1.3 |
| 47 | `verify-email.html:20–23` | "Verifying your email..." loading state — no `role="status"` or `aria-live` | High | 4.1.3 |
| 48 | Forms (all pages) | No form-level error summary. On submit failure, only one error banner shown (`#error`). If multiple fields invalid, user has no aggregated list and no per-field `aria-invalid`/`aria-describedby` | High | 3.3.1 Error Identification, 3.3.3 Error Suggestion |
| 49 | Forms (all pages) | `required` attribute used, but no visual or programmatic "(required)" indicator in labels | Medium | 3.3.2 |
| 50 | `main.css:610–614` | `.btn.loading` sets `pointer-events:none; opacity:0.75` — but no `aria-busy="true"` / `aria-disabled="true"`, and no text like "Loading" for SRs | High | 4.1.3, 4.1.2 |
| 51 | `instructor/course.html:64` | Bottom-sheet modal uses `aria-modal="true"` but modal content sits in DOM flow after `#toggleAddSession`; background content is **not `aria-hidden`/inert** while open — SR can still reach it | High | 2.4.3, 4.1.2 |
| 52 | All pages with `confirm()`/alert flows | `confirm('End this session?')` — blocks UI thread; accessible but provides no custom message for assistive context | Low | Best-practice |
| 53 | `main.css:684–687` | `html, body { overflow-x: hidden }` on desktop/mobile — at 200% browser zoom, content may be clipped rather than reflowed if fixed widths elsewhere. Combined with `#map { height: 300px }` (:566) the map does not scale with zoom | Medium | 1.4.10 Reflow, 1.4.4 Resize Text |
| 54 | `scan.html` `#reader { aspect-ratio: 1/1 }` | At 400% zoom the camera feed square may exceed viewport height with no scroll escape | Medium | 1.4.10 |
| 55 | Page titles | All pages use `<title>X — QR-Guard</title>` format (good). `index.html:6` is just `<title>QR-Guard</title>` — no descriptor before the redirect, gives the illusion user is on home page | Low | 2.4.2 Page Titled |
| 56 | `<html lang="en">` | Set correctly on all 12 HTML files — verified OK | PASS | 3.1.1 Language of Page |
| 57 | Heading hierarchy | `instructor/course.html:18, 41, 67`: `<h3 id="courseTitle">` sits inside `.course-hero` while the page has **no `<h1>`** (the page-header `<h1>` pattern from dashboards is missing). Jumps straight to h3 | High | 1.3.1, 2.4.6 |
| 58 | `instructor/session.html` | Entire live-session page has **no `<h1>`** — only h2 "Session Ended" / `<h2 id="errorTitle">` in branches | High | 2.4.6 |
| 59 | `main.css:679–681` `.skip-link` | Uses `transform: translateY(-100%)` to hide — positioned `absolute` but no `left: 0; top: 0;` declared, so actual positioning on focus is browser-default (typically 0,0 but relies on implementation). Safer to set explicit `top:0; left:0;` | Low | 2.4.1 |
| 60 | `instructor/session.html:138`, `instructor/dashboard.html:8, 70`, `student/scan.html:103` | External scripts/CSS loaded from CDNs (leaflet, html5-qrcode, socket.io, qrserver.com) with **no `crossorigin`/SRI** — not strictly a11y but if they fail, no-script fallback absent | Low | Best-practice / robustness |

---

## 2. Detailed Findings

### Finding 1 — Accent gold `#D4A037` fails text contrast

**Files:** `main.css:14` (token), `main.css:529–540` (`.enrollment-code`), `main.css:102–104` (`.brand-accent`), `main.css:1075` (`.session-status-scheduled .session-row-status`).

**Measured contrast:**
- `#D4A037` on `#FFFFFF` → **2.79 : 1** (fail, AA normal requires 4.5, AA large requires 3.0)
- `#D4A037` on `#f4ecdb` (bg) → **2.25 : 1** (fail)
- `#c09030` (accent-hover) on `#fdf6e8` (accent-light, used in `.enrollment-code`) → **3.05 : 1** (fail for normal text)

**Recommended fix:** Introduce `--accent-text: #8a6b1f` (or darker) for any accent-colored text. Keep `#D4A037` only for decorative surfaces (borders, icons, active stripes) where non-text 3:1 is sufficient. Suggested token:
```css
--accent-text: #7a5d16; /* 5.9:1 on white, 4.8:1 on #fdf6e8 */
```
Apply to `.enrollment-code`, `.brand-accent`, `.session-row-status` (scheduled), `.course-hero .enrollment-code`.

---

### Finding 2 — `--text-muted` on cream background

**File:** `main.css:30` (`--text-muted: #64748b`).
**Contrast:** `#64748b` on `#f4ecdb` = **3.66 : 1** — fails AA normal (4.5). Used in `.auth-footer` (`:127`), `.course-card-meta` (`:201`), bottom-nav inactive (`:429`), `.text-muted` (`:556`), `.nav-user` (`:401`) etc.

**Recommended fix:** Change `--text-muted` to `#4b5563` (slate-600) which gives 4.8:1 on #f4ecdb and 7.5:1 on white. Or introduce `--text-muted-on-bg: #4b5563` specifically for use on `--bg`.

---

### Finding 3 — Semantic `warning`/`success` on white

`--warning #d97706` on white: **3.02:1** — fails.
`--success #16a34a` on white: **3.12:1** — fails.
Used in `.badge-success`, `.badge-warning`, `.message.success` text color, `.session-status-active .session-row-status`.

**Recommended fix:**
- `--success-text: #15803d` (5.1:1 on white)
- `--warning-text: #a35a04` (4.8:1 on white) or `#92400e` (6.9:1)
- Keep lighter variants only for backgrounds/icons.

---

### Finding 6 — Dead skip-link anchor (Critical)

`components.js:14` creates `href="#main-content"` but **no element with `id="main-content"` exists** on any of the 12 HTML pages. Verified by grep — zero matches. Pressing skip-link jumps to the top of page (no-op), defeating its purpose.

**Recommended fix (read-only note, do not apply):**
1. Wrap main content in each page: `<main id="main-content" tabindex="-1">...</main>`
2. Ensure `tabindex="-1"` so programmatic focus works after anchor navigation in browsers that don't auto-focus anchor targets.

---

### Finding 7 — Sub-pages lose skip-link

Pages calling `renderNavWithBack()` (`course.html`, `session.html`, `scan.html`, `request-rebind.html`) never get a skip link. Only `dashboard.html` (both roles) and `index.html` paths do.

**Recommended fix:** Move the skip-link creation into a shared helper called by both `renderNav` and `renderNavWithBack`.

---

### Finding 8 / 9 — Label association broken in course-create form

Every `<label>` on `instructor/dashboard.html:24–52` contains only text, no `for` attribute, and the sibling `<input>` has no `aria-labelledby`. Example:
```html
<div class="form-group"><label>Course Name</label><input id="cName" required></div>
```
Clicking the label does not focus the input; screen readers announce the input with no name at all.

**Recommended fix:** Either add `for`:
```html
<label for="cName">Course Name</label><input id="cName" required>
```
Or wrap input inside label: `<label>Course Name <input id="cName" required></label>`. Apply to `cName`, `cCode`, `cSection`, `cSemester`, `cStart`, `cEnd`, `cRadius` (:52), and the "Weekly Schedule" group label (`:33`).

---

### Finding 13 / 51 — Modal focus management

**`instructor/course.html:215–229`** (`openSheet`/`closeSheet`):
```js
function openSheet() {
  setDefaultDateTime();
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('addSessionSheet').classList.add('open');
  document.getElementById('addSessionSheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
```
Problems:
1. No `.focus()` call — focus remains on the FAB button behind the backdrop.
2. Tab can leave the sheet into underlying page content (no focus trap).
3. Background content not `aria-hidden` / `inert` — SR users hear both.
4. On close, focus does not return to `#toggleAddSession`.

**Recommended fix:**
```js
let lastFocus;
function openSheet() {
  lastFocus = document.activeElement;
  // ... existing code ...
  document.querySelectorAll('body > *:not(.sheet-backdrop):not(.bottom-sheet)').forEach(el => el.setAttribute('inert', ''));
  document.getElementById('sessDate').focus();
}
function closeSheet() {
  // ... existing code ...
  document.querySelectorAll('[inert]').forEach(el => el.removeAttribute('inert'));
  if (lastFocus) lastFocus.focus();
}
```
Plus a focus-trap on `keydown` for Tab/Shift+Tab confined to sheet's focusable elements. Same pattern required in `student/dashboard.html:100–116`.

---

### Finding 16 / 17 / 19 / 20 — Missing `aria-live` for dynamic status

The most impactful gap: screen reader users cannot perceive:
- Attendance counter updating (`session.html:168`)
- GPS status changes (`scan.html:114, 118`)
- Scan verification result success/failure (`scan.html:200–219`)
- QR refresh event (visually invisible anyway, but error on QR-image swap unannounced)
- "Live" status badge transition (`session.html:159`)

**Recommended fix:** Add polite/assertive live regions:
- `#counter` (`session.html:120`): add `aria-live="polite" aria-atomic="true"`
- `#gpsStatus` (`scan.html:96`): `aria-live="polite"`
- `#result` (`scan.html:100`): add `role="status" aria-live="polite"` (or `role="alert"` for error types)
- `#statusText` (`session.html:108`): `aria-live="polite"`
- Consider a single off-screen `<div class="sr-only" aria-live="assertive">` announcer used by `showStatus()` for critical transitions.

Also add `.sr-only` utility to `main.css`:
```css
.sr-only {
  position: absolute !important; width: 1px; height: 1px; padding: 0;
  margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
```

---

### Finding 18 / 22 — QR scanner has no alternative input

Blind/low-vision users cannot aim a camera at a QR code. `scan.html` offers no manual code entry. Camera-denial path also lacks fallback.

**Recommended fix:** Add an "Enter attendance code manually" button below `#reader` that opens a text input. Backend scan endpoint (`/api/scan`) would need to accept the QR payload as a short numeric code (or the current token payload pasted). Without this, the app is **unusable for blind students** — this blocks WCAG 1.1.1.

---

### Finding 26 — Password toggle button

**Files:** `login.html:32`, `register.html:40`, `reset-password.html:26`.
```html
<button type="button" class="password-toggle" onclick="togglePassword('password', this)">Show</button>
```

Issues:
1. No `aria-label` — SR announces "Show, button" without context (show what?).
2. No `aria-pressed` state — toggle state invisible to SR.
3. `api.js:101–104` `togglePassword` updates text but not `aria-pressed`.

**Recommended fix:**
```html
<button type="button" class="password-toggle"
        aria-label="Show password" aria-pressed="false"
        onclick="togglePassword('password', this)">Show</button>
```
And in `togglePassword`:
```js
const pressed = input.type === 'text';
btn.setAttribute('aria-pressed', String(pressed));
btn.setAttribute('aria-label', pressed ? 'Hide password' : 'Show password');
```

---

### Finding 29 / 30 — Tab ARIA incomplete + no arrow-key nav

**File:** `instructor/course.html:40–56`, handler `:181–196`.

Missing:
- `aria-controls="sessionsPanel"` on first tab, `aria-controls="studentsPanel"` on second
- `aria-labelledby="sessionsTab"` (and an `id="sessionsTab"` on the button) on each `tab-panel`
- `tabindex="-1"` on inactive tabs + `tabindex="0"` on active tab (roving tabindex pattern)
- Arrow-key handler: Left/Right moves between tabs, Home/End jumps first/last

**Recommended fix (outline):**
```js
tabBar.addEventListener('keydown', e => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...tabBar.querySelectorAll('[role="tab"]')];
  const current = tabs.indexOf(document.activeElement);
  let next;
  if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') next = 0;
  else next = tabs.length - 1;
  tabs[next].click(); tabs[next].focus();
});
```

---

### Finding 34 — `prefers-reduced-motion` never respected

Eight+ animations run unconditionally: `fadeIn` on body, `slideUp` on cards/auth-card (staggered), `spin` on loading buttons, `shimmer` on skeletons, `loading-bar` page loader, `tabFadeIn`, `pulse` (live status dot in session.html + gps-dot in scan.html).

For users with vestibular disorders, `slideUp` + staggered card animations on dashboard loads can trigger symptoms.

**Recommended fix:** Add once at end of `main.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

### Finding 43 / 44 — Leaflet map & search suggestions not keyboard-operable

Leaflet has default keyboard support for panning (arrow keys) and zooming (+/-), but **click-to-set-geofence** relies on mouse/touch. Keyboard-only instructors cannot pick a geofence center.

Search suggestions (`instructor/dashboard.html:136–157`) build a `<div>` list with inline mouse handlers — no `tabindex`, no keyboard selection.

**Recommended fix:**
1. Geofence: Provide a "Use current view center" button that sets `cLat`/`cLng` to `map.getCenter()`. Keyboard users pan/zoom with arrows/+-, then press the button.
2. Suggestions: Use `<button>` or `<li role="option" tabindex="0">` with keyboard handlers (Enter to select, Esc to close, Down/Up arrow navigation).

---

### Finding 48 — No form error summary / per-field errors

Every form uses a single top banner `#error`. If user submits empty form, server likely returns first error only and no `aria-invalid` is set on any field. SR user fixing one error cannot see at a glance what else is wrong.

**Recommended fix:**
```html
<div id="errorSummary" role="alert" aria-live="assertive" tabindex="-1" hidden>
  <h2>Please fix the following:</h2>
  <ul id="errorSummaryList"></ul>
</div>
```
On submit failure, populate, `.removeAttribute('hidden')`, and `.focus()`. Each listed error includes a link `#fieldId` that focuses the invalid field; set `aria-invalid="true"` and `aria-describedby="fieldId-err"` on each invalid input.

---

### Finding 50 — Loading buttons not announced

`.btn.loading` (`main.css:610–627`): adds spinner, removes pointer events, but no ARIA. An SR user pressing "Log In" will hear nothing; if focus stays on the button, the spinner is silent.

**Recommended fix:** `setButtonLoading()` in `api.js:90–95` should:
```js
btn.setAttribute('aria-busy', 'true');
btn.setAttribute('aria-disabled', 'true');
// add an sr-only span with "Loading, please wait"
```
Restore on unload.

---

### Finding 57 / 58 — Missing page `<h1>`s

- `instructor/course.html` — the `.course-hero` uses `<h3>` (`:18`) and there is no `<h1>` at all. The page-header pattern with `<h1>` (used on the dashboards) should apply here (e.g., `<h1 class="sr-only">Course details</h1>` plus the hero).
- `instructor/session.html` — has zero `<h1>`; only `<h2>` for error/closed states.

**Recommended fix:** Add a visible or visually-hidden `<h1>` per page describing purpose: "Course details", "Live session".

---

## 3. Contrast Reference Table (recommended token set)

| Token | Current | On `#fff` | On `#f4ecdb` | Recommended |
|---|---|---|---|---|
| `--primary` `#9a182b` | PASS 7.81:1 | PASS 6.72:1 | keep |
| `--primary-hover` `#7d1323` | PASS ~10:1 | PASS ~8.6:1 | keep |
| `--accent` `#D4A037` | FAIL 2.79:1 | FAIL 2.25:1 | keep for non-text decoration only |
| `--accent-hover` `#c09030` | FAIL 3.3:1 | FAIL 2.67:1 | keep for non-text |
| (NEW) `--accent-text` `#7a5d16` | PASS 5.9:1 | PASS 4.8:1 | add for all gold text |
| `--danger` `#dc2626` | PASS 4.83:1 | PASS 4.01:1 (borderline) | keep; on `--bg` use darker `#b91c1c` |
| `--success` `#16a34a` | FAIL 3.12:1 | FAIL 2.6:1 | use `#15803d` for text (5.1:1 on white) |
| `--warning` `#d97706` | FAIL 3.02:1 | FAIL 2.52:1 | use `#92400e` for text (6.9:1) |
| `--text` `#1e293b` | PASS 14.75:1 | PASS 12.4:1 | keep |
| `--text-muted` `#64748b` | PASS 4.54:1 | **FAIL 3.66:1** | change to `#4b5563` (7.5:1 / 5.9:1) |

---

## 4. Per-page checklist

| Page | lang | title | h1 | main | nav | skip-link reaches target | form labels | live regions | motion-reduce |
|---|---|---|---|---|---|---|---|---|---|
| `index.html` | ✅ | ✅ QR-Guard (weak) | ✅ | ❌ | ❌ | n/a | n/a | n/a | ❌ |
| `login.html` | ✅ | ✅ | ✅ (brand only) | ❌ | ❌ | n/a | ✅ (`for=`) | ❌ | ❌ |
| `register.html` | ✅ | ✅ | ✅ | ❌ | ❌ | n/a | ✅ | ❌ | ❌ |
| `forgot-password.html` | ✅ | ✅ | ✅ | ❌ | ❌ | n/a | ✅ | ❌ | ❌ |
| `reset-password.html` | ✅ | ✅ | ❌ | ❌ | ❌ | n/a | ✅ | ❌ | ❌ |
| `verify-email.html` | ✅ | ✅ | ❌ | ❌ | ❌ | n/a | n/a | ❌ | ❌ |
| `request-rebind.html` | ✅ | ✅ | ✅ | ❌ | JS | ❌ (not injected here) | n/a | ❌ | ❌ |
| `instructor/dashboard.html` | ✅ | ✅ | ✅ | ❌ | JS | ❌ (anchor dead) | ❌ (no `for=`) | ❌ | ❌ |
| `instructor/course.html` | ✅ | ✅ | ❌ (h3 only) | ❌ | JS | ❌ | partial | ❌ | ❌ |
| `instructor/session.html` | ✅ | ✅ | ❌ | ❌ | JS | ❌ | n/a | ❌ (counter!) | ❌ |
| `student/dashboard.html` | ✅ | ✅ | ✅ | ❌ | JS | ❌ | ✅ | ❌ | ❌ |
| `student/scan.html` | ✅ | ✅ | ❌ (h2 only) | ❌ | JS | ❌ | n/a | ❌ (critical) | ❌ |

---

## 5. Priority Remediation (if budget limited)

**Must-fix before production (Critical + High, user-impact ordered):**
1. Finding 6 — add `<main id="main-content">` to every page (skip-link is broken).
2. Finding 18 — manual code entry fallback in `scan.html` (blocks blind users).
3. Finding 16 + 20 — `aria-live` on session counter and scan result (core UX for SR).
4. Finding 13 — focus management in both bottom-sheet modals.
5. Finding 8/9 — fix label `for=` on instructor course-create form.
6. Finding 1/2/3 — contrast token additions for gold, muted, warning, success.
7. Finding 34 — `prefers-reduced-motion` media query.
8. Finding 26 — `aria-pressed` + `aria-label` on password toggles.
9. Finding 43 — keyboard-accessible geofence pick.
10. Finding 57/58 — add `<h1>` to `course.html`, `session.html`, `scan.html`.

**Rough effort:** ~1 developer-day for items 1, 3, 4, 5, 6, 7, 8, 10. Items 2 and 9 require design + possibly backend changes (half-day each).

---

## 6. Not tested (out of scope)

- Actual screen reader behavior (NVDA/JAWS/VoiceOver) — this is static analysis only.
- Keyboard navigation run-through in a real browser (Playwright would help but was not used per READ-ONLY rule).
- iOS/Android mobile SR (TalkBack/VoiceOver mobile).
- Cognitive accessibility (language complexity, instructions clarity) — partial review only.
- The `docs/` admin pages and any future pages not yet in `src/frontend/`.
