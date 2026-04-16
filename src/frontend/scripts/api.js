/**
 * Shared fetch wrapper with auth handling.
 * All API calls go through this to handle 401 redirects consistently.
 */

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
    ...options,
  });

  if (res.status === 401 && !path.includes('/api/auth/login') && !path.includes('/api/auth/register')) {
    window.location.href = '/login.html';
    return null;
  }

  return res;
}

async function apiGet(path) {
  return apiFetch(path);
}

async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

async function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
}

async function apiPatch(path, body) {
  return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
}

async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

/**
 * Checks auth status and redirects based on session.
 * Used by index.html for auto-redirect.
 */
async function checkAuthAndRedirect() {
  const res = await apiGet('/api/auth/me');
  if (!res || !res.ok) {
    window.location.href = '/login.html';
    return;
  }
  const data = await res.json();
  if (data.user.role === 'student') {
    window.location.href = '/student/dashboard.html';
  } else {
    window.location.href = '/instructor/dashboard.html';
  }
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function showSuccess(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
    el.className = 'message success';
  }
}

/** Shows a top loading bar. Returns a stop function. */
function showPageLoader() {
  let bar = document.getElementById('pageLoader');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pageLoader';
    bar.className = 'page-loader';
    document.body.prepend(bar);
  }
  bar.style.display = 'block';
  return () => { bar.style.display = 'none'; };
}

/** Sets a button to loading state. Returns a restore function. */
function setButtonLoading(btn) {
  const original = btn.textContent;
  btn.classList.add('loading');
  btn.textContent = original;
  return () => { btn.classList.remove('loading'); btn.textContent = original; };
}

/** Escape HTML to prevent XSS when inserting user data into innerHTML */
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/** Toggle password visibility (shared across auth pages) */
function togglePassword(id, btn) {
  const input = document.getElementById(id);
  if (input.type === 'password') { input.type = 'text'; btn.textContent = 'Hide'; }
  else { input.type = 'password'; btn.textContent = 'Show'; }
}

/** Shows skeleton cards in a container */
function showSkeletons(containerId, count = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-text"></div>
    </div>
  `).join('');
}
