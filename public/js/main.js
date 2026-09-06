/* ============================================================
   SEVA CONNECT — Shared Utilities & Demo Role Switcher
   main.js
   ============================================================ */

'use strict';

// ── DOM Ready ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDemoBar();
  initAnimatedBg();
  initToastSystem();
  highlightActiveNav();
});

// ── Demo Session Bar & Header Status ───────────────────────────
function initDemoBar() {
  const bar = document.getElementById('demo-bar');
  if (!bar) return;

  const session = window.Session ? window.Session.get() : null;
  const name    = session ? session.name : 'Guest';
  const roleMap = { user: 'Customer', worker: 'Worker', admin: 'Admin' };
  const role    = session ? (roleMap[session.role] || 'User') : 'Guest';

  bar.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:2px 16px;font-size:11px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="display:inline-block;width:6px;height:6px;background:var(--success);border-radius:50%;animation:pulse 2s infinite"></span>
        <span style="color:var(--text-secondary)">Logged in as: <strong style="color:#fff">${name}</strong> (${role})</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-ghost btn-sm" onclick="Session.logout()" style="padding:2px 10px;font-size:11px;color:var(--danger)">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
        </button>
      </div>
    </div>
  `;
}

// ── Animated Background Orbs ───────────────────────────────────
function initAnimatedBg() {
  const bg = document.querySelector('.bg-animated');
  if (bg) bg.style.pointerEvents = 'none';
}

// ── Toast Notification System ──────────────────────────────────
let toastContainer;

function initToastSystem() {
  toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

window.showToast = function(title, message = '', type = 'info', duration = 3500) {
  if (!toastContainer) initToastSystem();

  const icons = {
    success: '✅',
    error:   '❌',
    danger:  '❌',
    warning: '⚠️',
    info:    'ℹ️',
    notify:  '🔔',
  };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
};

// ── Highlight Active Bottom Nav Item ──────────────────────────
function highlightActiveNav() {
  // Tab switching is handled per-page — nothing to do globally
}

// ── Bottom Nav Tab Switching (fallback) ───────────────────────
if (!window.switchTab) {
  window.switchTab = function(tabName, navEl) {
    const navItems = document.querySelectorAll('.nav-item, .sidebar-nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    if (navEl) navEl.classList.add('active');

    const panels = document.querySelectorAll('[data-tab]');
    panels.forEach(p => {
      p.style.display = 'none';
      p.classList.remove('anim-fade-up');
    });

    const target = document.querySelector(`[data-tab="${tabName}"]`);
    if (target) {
      target.style.display = 'block';
      requestAnimationFrame(() => target.classList.add('anim-fade-up'));
    }
  };
}

// ── Animated Counter ───────────────────────────────────────────
window.animateCounter = function(el, target, duration = 1200, prefix = '', suffix = '') {
  if (!el) return;
  const startTime = performance.now();

  const update = (now) => {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    const current  = Math.round(target * eased);
    el.textContent = prefix + current.toLocaleString('en-IN') + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };

  requestAnimationFrame(update);
};

// ── Intersection Observer for Animations ──────────────────────
window.observeAnimations = function() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('anim-fade-up');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
};

// ── Modal Helpers ──────────────────────────────────────────────
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('open');
  requestAnimationFrame(() => {
    modal.classList.add('modal-open');
    const inner = modal.querySelector('.modal-inner');
    if (inner) inner.classList.add('anim-bounce-in');
  });
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('modal-open', 'open');
  setTimeout(() => { modal.style.display = 'none'; }, 250);
};

// Close modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    const modal = e.target;
    if (modal.id === 'voice-modal') {
      if (typeof closeVoiceModal === 'function') {
        closeVoiceModal();
      } else {
        closeModal(modal.id);
      }
      return;
    }
    if (modal) closeModal(modal.id);
  }
});

// ── Shared Modal Styles (injected) ────────────────────────────
(function injectModalStyles() {
  if (document.getElementById('seva-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'seva-modal-styles';
  style.textContent = `
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(8px);
      z-index: 300;
      align-items: flex-end;
      justify-content: center;
    }
    .modal-backdrop.modal-open,
    .modal-backdrop.open { display: flex; }
    .modal-inner {
      background: var(--bg-elevated);
      border: 1px solid var(--border-card);
      border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
      padding: var(--space-xl);
      width: 100%;
      max-width: 430px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-handle {
      width: 40px;
      height: 4px;
      background: var(--border-card);
      border-radius: 2px;
      margin: 0 auto var(--space-lg);
    }
    .modal-title {
      font-size: var(--text-xl);
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: var(--space-md);
    }
  `;
  document.head.appendChild(style);
})();

// ── Ripple Effect on Buttons ───────────────────────────────────
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn');
  if (!btn || btn.classList.contains('btn-icon')) return;

  const circle = document.createElement('span');
  const rect   = btn.getBoundingClientRect();
  const size   = Math.max(rect.width, rect.height);
  circle.style.cssText = `
    position:absolute;
    border-radius:50%;
    background:rgba(255,255,255,0.2);
    width:${size}px;
    height:${size}px;
    left:${e.clientX - rect.left - size / 2}px;
    top:${e.clientY - rect.top - size / 2}px;
    transform:scale(0);
    animation:ripple 0.5s ease-out forwards;
    pointer-events:none;
  `;

  if (!document.getElementById('ripple-style')) {
    const s = document.createElement('style');
    s.id = 'ripple-style';
    s.textContent = `@keyframes ripple { to { transform:scale(2); opacity:0; } }`;
    document.head.appendChild(s);
  }

  btn.appendChild(circle);
  circle.addEventListener('animationend', () => circle.remove());
});

// ── Fade in on page load ───────────────────────────────────────
document.body.style.opacity = '0';
window.addEventListener('load', () => {
  document.body.style.transition = 'opacity 0.4s ease';
  document.body.style.opacity    = '1';
});
