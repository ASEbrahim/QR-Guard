/**
 * Shared UI components — nav bar, bottom nav, footer.
 * Import once per page: <script src="/scripts/components.js"></script>
 * Call: renderNav(role), renderFooter()
 */

/**
 * Injects a skip-to-content link at the top of the body and guarantees
 * that `#main-content` exists as a focusable target.
 *
 * Previously the link targeted `#main-content` but no page had that id —
 * the anchor was dead (a prior audit marked it as a fix that wasn't).
 * Now the helper walks the body and marks the first content element
 * (i.e. the first child that is not nav / header / footer / script /
 * bottom-nav) with id="main-content" and tabindex="-1" so pressing the
 * link delivers focus into the main region for screen-reader users.
 */
function ensureSkipLink() {
  if (document.querySelector('.skip-link')) return; // idempotent
  const skip = document.createElement('a');
  skip.className = 'skip-link';
  skip.href = '#main-content';
  skip.textContent = 'Skip to main content';
  document.body.prepend(skip);

  // Defer the main-content marker until after the nav has been injected.
  queueMicrotask(() => {
    if (document.getElementById('main-content')) return;
    const SKIP_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'SCRIPT', 'STYLE', 'LINK']);
    for (const child of document.body.children) {
      if (SKIP_TAGS.has(child.tagName)) continue;
      if (child.classList.contains('skip-link')) continue;
      if (child.classList.contains('bottom-nav')) continue;
      if (child.classList.contains('site-footer')) continue;
      child.id = 'main-content';
      child.setAttribute('tabindex', '-1');
      // Mark as the main landmark so assistive tech has a region to
      // skip into (WCAG 2.4.1 / 1.3.1). role="main" is equivalent to
      // <main> and avoids wrapping existing markup.
      if (child.tagName !== 'MAIN' && !child.hasAttribute('role')) {
        child.setAttribute('role', 'main');
      }
      break;
    }
  });
}

/**
 * Renders the top nav bar.
 * @param {string} userName — display name (empty string if unknown yet)
 */
function renderNav(userName) {
  ensureSkipLink();

  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <div class="nav-left">
      <a href="/" class="nav-brand"><img src="/assets/auk-logo-white.svg" alt="AUK">
        <div>QR-Guard<div class="nav-user" id="userName">${userName || ''}</div></div>
      </a>
    </div>
  `;
  document.body.prepend(nav);
}

/**
 * Renders the top nav with a back button (for sub-pages).
 * @param {string} backUrl — URL to go back to
 * @param {string} backLabel — button text
 */
function renderNavWithBack(backUrl, backLabel) {
  ensureSkipLink();

  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <div class="nav-left">
      <a href="/" class="nav-brand"><img src="/assets/auk-logo-white.svg" alt="AUK">QR-Guard</a>
      <div class="nav-links"><a href="${backUrl}">${backLabel}</a></div>
    </div>
  `;
  document.body.prepend(nav);
}

/**
 * Renders the bottom navigation bar.
 * @param {'student'|'instructor'} role
 * @param {string} activePage — which tab is active: 'courses', 'scan', 'device'
 */
function renderBottomNav(role, activePage) {
  document.body.classList.add('has-bottom-nav');

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';

  // Helper: aria-current on the link that matches activePage (WCAG 4.1.2);
  // decorative glyph spans marked aria-hidden so screen readers speak the
  // label text ("Courses", "Scan") rather than the private-use codepoints.
  const cur = (page) => (activePage === page ? 'aria-current="page"' : '');

  if (role === 'student') {
    nav.innerHTML = `
      <a href="/student/dashboard" class="bottom-nav-item ${activePage === 'courses' ? 'active' : ''}" ${cur('courses')}>
        <span class="bottom-nav-icon" aria-hidden="true">&#9776;</span> Courses
      </a>
      <a href="/student/scan" class="bottom-nav-item ${activePage === 'scan' ? 'active' : ''}" ${cur('scan')}>
        <span class="bottom-nav-icon" aria-hidden="true">&#9634;</span> Scan
      </a>
      <a href="/request-rebind" class="bottom-nav-item ${activePage === 'device' ? 'active' : ''}" ${cur('device')}>
        <span class="bottom-nav-icon" aria-hidden="true">&#9881;</span> Device
      </a>
      <button class="bottom-nav-item" onclick="doLogout()">
        <span class="bottom-nav-icon" aria-hidden="true">&#10140;</span> Sign Out
      </button>
    `;
  } else {
    nav.innerHTML = `
      <a href="/instructor/dashboard" class="bottom-nav-item ${activePage === 'courses' ? 'active' : ''}" ${cur('courses')}>
        <span class="bottom-nav-icon" aria-hidden="true">&#9776;</span> Courses
      </a>
      <button class="bottom-nav-item" onclick="doLogout()">
        <span class="bottom-nav-icon" aria-hidden="true">&#10140;</span> Sign Out
      </button>
    `;
  }

  document.body.appendChild(nav);
}

/**
 * Renders the site footer with campus background.
 */
function renderFooter() {
  document.body.classList.add('has-footer');

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="site-footer-inner">
      <div class="site-footer-brand">QR-Guard</div>
      <p>American University of Kuwait — Attendance System</p>
    </div>
  `;
  // Insert before bottom nav if it exists, otherwise append
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    document.body.insertBefore(footer, bottomNav);
  } else {
    document.body.appendChild(footer);
  }
}

/**
 * Shared logout handler. Navigates to login regardless of whether the
 * POST succeeded (local state should reset either way), but surfaces a
 * warning to the console when it fails so an admin can investigate.
 */
async function doLogout() {
  const res = await apiPost('/api/auth/logout');
  if (!res || !res.ok) {
    console.warn('[components] Logout POST failed; navigating anyway.');
  }
  window.location.href = '/login';
}

/**
 * Loads the current user name into the nav.
 * Call after renderNav() if you didn't pass a name.
 */
async function loadUserName() {
  const res = await apiGet('/api/auth/me');
  if (!res || !res.ok) return;
  const { user } = await res.json();
  const el = document.getElementById('userName');
  if (el) el.textContent = user.name;
  return user;
}

/**
 * Focus-management helpers for bottom-sheet / modal dialogs.
 *
 * openModal(sheetEl) — remembers the currently focused element, focuses
 * the first focusable element inside the sheet, and installs a keydown
 * handler that traps Tab / Shift+Tab within the sheet.
 *
 * closeModal(sheetEl) — removes the handler and restores focus to the
 * element that was focused when openModal was called.
 *
 * Caller is still responsible for the visual open/close transitions and
 * for setting aria-hidden on the sheet.
 */
const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const _modalState = new WeakMap();

function _firstFocusable(el) {
  const list = el.querySelectorAll(FOCUSABLE_SELECTOR);
  for (const node of list) {
    if (node.offsetParent !== null) return node;
  }
  return null;
}

function openModal(sheetEl) {
  if (!sheetEl) return;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(sheetEl.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((n) => n.offsetParent !== null);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handler);
  _modalState.set(sheetEl, { previouslyFocused, handler });
  // Defer focus to let the browser finish any pending open animation/reflow.
  requestAnimationFrame(() => {
    const target = _firstFocusable(sheetEl);
    if (target) target.focus();
  });
}

function closeModal(sheetEl) {
  if (!sheetEl) return;
  const state = _modalState.get(sheetEl);
  if (!state) return;
  document.removeEventListener('keydown', state.handler);
  _modalState.delete(sheetEl);
  if (state.previouslyFocused && typeof state.previouslyFocused.focus === 'function') {
    state.previouslyFocused.focus();
  }
}
