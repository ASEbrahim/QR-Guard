/**
 * Shared UI components — nav bar, bottom nav, footer.
 * Import once per page: <script src="/scripts/components.js"></script>
 * Call: renderNav(role), renderFooter()
 */

/**
 * Renders the top nav bar.
 * @param {string} userName — display name (empty string if unknown yet)
 */
function renderNav(userName) {
  const skip = document.createElement('a');
  skip.className = 'skip-link';
  skip.href = '#main-content';
  skip.textContent = 'Skip to main content';
  document.body.prepend(skip);

  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <div class="nav-left">
      <a href="/" class="nav-brand"><img src="/assets/auk-logo-white.svg" alt="AUK">QR-Guard</a>
    </div>
    <div class="nav-user" id="userName">${userName || ''}</div>
  `;
  document.body.prepend(nav);
}

/**
 * Renders the top nav with a back button (for sub-pages).
 * @param {string} backUrl — URL to go back to
 * @param {string} backLabel — button text
 */
function renderNavWithBack(backUrl, backLabel) {
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <div class="nav-left">
      <a href="/" class="nav-brand"><img src="/assets/auk-logo-white.svg" alt="AUK">QR-Guard</a>
    </div>
    <div class="nav-links"><a href="${backUrl}">${backLabel}</a></div>
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

  if (role === 'student') {
    nav.innerHTML = `
      <a href="/student/dashboard.html" class="bottom-nav-item ${activePage === 'courses' ? 'active' : ''}">
        <span class="bottom-nav-icon">&#9776;</span> Courses
      </a>
      <a href="/student/scan.html" class="bottom-nav-item ${activePage === 'scan' ? 'active' : ''}">
        <span class="bottom-nav-icon">&#9634;</span> Scan
      </a>
      <a href="/request-rebind.html" class="bottom-nav-item ${activePage === 'device' ? 'active' : ''}">
        <span class="bottom-nav-icon">&#9881;</span> Device
      </a>
      <button class="bottom-nav-item" onclick="doLogout()">
        <span class="bottom-nav-icon">&#10140;</span> Exit
      </button>
    `;
  } else {
    nav.innerHTML = `
      <a href="/instructor/dashboard.html" class="bottom-nav-item ${activePage === 'courses' ? 'active' : ''}">
        <span class="bottom-nav-icon">&#9776;</span> Courses
      </a>
      <button class="bottom-nav-item" onclick="doLogout()">
        <span class="bottom-nav-icon">&#10140;</span> Exit
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
 * Shared logout handler.
 */
async function doLogout() {
  await apiPost('/api/auth/logout');
  window.location.href = '/login.html';
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
