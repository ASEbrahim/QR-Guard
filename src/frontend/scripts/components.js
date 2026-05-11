/**
 * Shared UI components — nav bar, bottom nav, footer.
 * Import once per page: <script src="/scripts/components.js"></script>
 * Call: renderNav(role), renderFooter()
 */

/**
 * Renders the top nav bar.
 * @param {string} userName  display name (empty string if unknown yet)
 */
function renderNav(userName) {
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
 * @param {string} backUrl   URL to go back to
 * @param {string} backLabel button text
 */
function renderNavWithBack(backUrl, backLabel) {
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

/**
 * Wires drag-to-dismiss on a bottom sheet's .sheet-handle.
 * pointerdown on the handle starts tracking; pointermove translates the
 * sheet downward only (we don't allow lifting it above its open position);
 * pointerup either snaps back (< 100 px drag) or fires closeFn() (>= 100 px).
 *
 * Idempotent per sheet element  if the same sheet is opened twice we don't
 * re-attach listeners.
 *
 * @param {HTMLElement} sheetEl  the .bottom-sheet element
 * @param {Function}    closeFn  page-level close handler (e.g. closeSheet)
 */
function enableSheetDrag(sheetEl, closeFn) {
  if (!sheetEl || sheetEl.dataset.dragWired === '1') return;
  const handle = sheetEl.querySelector('.sheet-handle');
  if (!handle) return;
  sheetEl.dataset.dragWired = '1';

  let startY = 0;
  let currentY = 0;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    currentY = 0;
    sheetEl.style.transition = 'none';
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    currentY = Math.max(0, e.clientY - startY); // downward only
    sheetEl.style.transform = `translateY(${currentY}px)`;
  });

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    sheetEl.style.transform = '';
    if (currentY > 100) closeFn();
  };

  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}
