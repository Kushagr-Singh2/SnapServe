/* ============================================================
   SNAPSERVE — Admin Control Center (SIH Real-Data Architecture)
   js/admin.js
   ============================================================ */

'use strict';

let adminWorkers = [];
let adminRequests = [];
let adminAccounts = [];
let currentWorkerFilter = 'pending';

document.addEventListener('DOMContentLoaded', () => {
  initAdminPage();
});

async function initAdminPage() {
  const session = Session.get();
  if (!session || session.role !== 'admin') {
    window.location.href = 'login.html';
    return;
  }

  renderAdminHeader();
  initSidebar();
  initAdminNav();
  await loadAdminDataFromServer();
  animateAdminEntrance();

  // Setup SSE for cross-device synchronization
  API.setupSSE((eventData) => {
    console.log('[Admin SSE Event]:', eventData);
    // Show notification indicator
    const notifDot = document.getElementById('admin-notif-dot');
    if (notifDot) notifDot.style.display = 'block';

    if (eventData.eventType === 'worker_submitted' || eventData.eventType === 'worker_registered') {
      showToast('🔔 New Worker Application', `${eventData.name || 'Worker'} submitted profile for verification`, 'notify');
    } else if (eventData.eventType === 'new_request') {
      showToast('⚡ New Service Request', `${eventData.customerName} → ${eventData.serviceCategory}`, 'info');
    }

    loadAdminDataFromServer();
  });
}

function renderAdminHeader() {
  const session = Session.get();
  const adminName = session ? session.name : 'Admin';
  const greeting = Utils.getGreeting();

  const greetingEl = document.getElementById('admin-greeting-heading');
  if (greetingEl) {
    greetingEl.innerHTML = `${greeting}, ${adminName} 👋 <span style="font-size:12px;color:var(--primary-light);font-weight:600">(Platform Control)</span>`;
  }

  const sbAdminName = document.getElementById('sidebar-admin-name');
  if (sbAdminName) sbAdminName.textContent = adminName;
}

async function loadAdminDataFromServer() {
  try {
    // 1. Fetch full state from server
    const state = await API.request('/api/state');
    adminWorkers = state.workers || [];
    adminRequests = state.serviceRequests || [];
    adminAccounts = (state.accounts || []).filter(a => a.role === 'customer' || a.role === 'user');

    renderAdminStats();
    renderWorkerVerificationTable();
    renderBookingsTable();
    renderNegotiationsTable();
    renderAdminActivityFeed();
    renderUsersTable();
    renderAnalyticsTab();
  } catch (err) {
    console.warn('Error loading admin data from server:', err);
  }
}

// ── Admin Dynamic Stats ──────────────────────────────────────
function renderAdminStats() {
  const pendingVerifications = adminWorkers.filter(w => w.verificationStatus === 'pending').length;
  const verifiedWorkers      = adminWorkers.filter(w => w.verificationStatus === 'approved').length;
  const activeRequests       = adminRequests.filter(r => ['pending', 'countered', 'accepted'].includes(r.status) && r.jobStatus !== 'completed').length;
  const completedBookings    = adminRequests.filter(r => r.status === 'completed' || r.jobStatus === 'completed').length;

  const elPending   = document.getElementById('stat-pending-workers');
  const elVerified  = document.getElementById('stat-verified-workers');
  const elActive    = document.getElementById('stat-active-requests');
  const elCompleted = document.getElementById('stat-completed-bookings');

  if (elPending)   elPending.textContent   = pendingVerifications;
  if (elVerified)  elVerified.textContent  = verifiedWorkers;
  if (elActive)    elActive.textContent    = activeRequests;
  if (elCompleted) elCompleted.textContent = completedBookings;

  // Update nav badges
  const uBadge = document.getElementById('snav-users-count');
  const wBadge = document.getElementById('snav-workers-count');
  const bBadge = document.getElementById('snav-bookings-count');

  if (uBadge) uBadge.textContent = adminAccounts.length;
  if (wBadge) {
    wBadge.textContent = pendingVerifications > 0 ? `${pendingVerifications} Pending` : `${verifiedWorkers} Verified`;
    wBadge.style.background = pendingVerifications > 0 ? 'var(--warning)' : 'var(--success)';
  }
  if (bBadge) bBadge.textContent = adminRequests.length;

  // Update tab counts
  const tp = document.getElementById('tab-pending-count');
  const ta = document.getElementById('tab-approved-count');
  const tr = document.getElementById('tab-rejected-count');
  const tall = document.getElementById('tab-all-count');

  if (tp) tp.textContent = pendingVerifications;
  if (ta) ta.textContent = verifiedWorkers;
  if (tr) tr.textContent = adminWorkers.filter(w => w.verificationStatus === 'rejected').length;
  if (tall) tall.textContent = adminWorkers.length;
}

// ── Live Activity Stream ──────────────────────────────────────
function renderAdminActivityFeed() {
  const feed = document.getElementById('admin-activity-feed');
  if (!feed) return;

  if (adminRequests.length === 0 && adminWorkers.length === 0) {
    feed.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">
        No platform activity yet. New registrations and booking requests will appear here in real-time.
      </div>
    `;
    return;
  }

  const activities = [];

  adminWorkers.forEach(w => {
    const isApproved = w.verificationStatus === 'approved';
    const isRejected = w.verificationStatus === 'rejected';
    activities.push({
      timestamp: new Date(w.createdAt || Date.now()).getTime(),
      icon: isApproved ? '🟢' : isRejected ? '🔴' : '🟡',
      text: isApproved ? `Worker Approved: ${w.name}` : isRejected ? `Worker Rejected: ${w.name}` : `New Verification Request: ${w.name}`,
      detail: w.services && w.services[0] ? `${w.services[0].category} · "${w.services[0].specificWork}" (${Utils.formatPrice(w.services[0].basePrice)})` : 'Profile Registered',
      time: Utils.timeAgo(w.createdAt)
    });
  });

  adminRequests.forEach(r => {
    activities.push({
      timestamp: new Date(r.updatedAt || r.createdAt || Date.now()).getTime(),
      icon: r.status === 'completed' ? '✅' : r.status === 'accepted' ? '🤝' : r.status === 'countered' ? '💬' : '⚡',
      text: `Customer Request (${r.status.toUpperCase()}): ${r.customerName || 'Customer'} → ${r.serviceCategory}`,
      detail: `${r.specificWork ? `"${r.specificWork}" · ` : ''}Offer: ${Utils.formatPrice(r.finalPrice || r.workerCounter || r.offer)} · ${r.jobStatus || r.status}`,
      time: Utils.timeAgo(r.updatedAt || r.createdAt)
    });
  });

  activities.sort((a, b) => b.timestamp - a.timestamp);

  feed.innerHTML = activities.slice(0, 6).map(a => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">${a.icon}</span>
        <div>
          <div style="font-weight:700;font-size:13px;color:#fff">${a.text}</div>
          <div style="font-size:11px;color:var(--text-muted)">${a.detail}</div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:600">${a.time}</div>
    </div>
  `).join('');
}

// ── Worker Verification Table ────────────────────────────────
window.filterAdminWorkers = function(filterStatus, btnEl) {
  currentWorkerFilter = filterStatus;
  document.querySelectorAll('#worker-verification-tabs .filter-pill').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderWorkerVerificationTable();
};

function renderWorkerVerificationTable() {
  const tbody = document.getElementById('workers-tbody');
  if (!tbody) return;

  let filtered = adminWorkers;
  if (currentWorkerFilter === 'pending') {
    filtered = adminWorkers.filter(w => w.verificationStatus === 'pending');
  } else if (currentWorkerFilter === 'approved') {
    filtered = adminWorkers.filter(w => w.verificationStatus === 'approved');
  } else if (currentWorkerFilter === 'rejected') {
    filtered = adminWorkers.filter(w => w.verificationStatus === 'rejected');
  }

  if (filtered.length === 0) {
    const filterLabels = { pending: 'pending verification', approved: 'approved', rejected: 'rejected', all: 'registered' };
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:36px;color:var(--text-muted);font-size:13px">
          No ${filterLabels[currentWorkerFilter] || ''} workers found.
          ${currentWorkerFilter === 'pending' ? '<br/><span style="font-size:11px">Register a worker account to test the verification approval workflow.</span>' : ''}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(w => {
    const isApproved = w.verificationStatus === 'approved';
    const isRejected = w.verificationStatus === 'rejected';

    const verBadge = isApproved
      ? '<span class="badge badge-success">🟢 Verified</span>'
      : isRejected
      ? '<span class="badge badge-danger">🔴 Rejected</span>'
      : '<span class="badge badge-warning">🟡 Pending Review</span>';

    const servicesDetail = (w.services || []).map(s =>
      `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">
        <strong style="color:#fff">${s.category}:</strong> "${s.specificWork}"
        <span style="color:var(--primary-light);font-weight:700">(${Utils.formatPrice(s.basePrice)})</span>
      </div>`
    ).join('') || '<span style="font-size:11px;color:var(--text-muted);font-style:italic">No services added yet</span>';

    return `
      <tr>
        <td>
          <div class="flex items-center gap-sm">
            <div class="avatar" style="width:38px;height:38px;font-size:13px;background:var(--gradient-primary)">
              ${Utils.getInitials(w.name)}
            </div>
            <div>
              <div class="td-name" style="font-weight:800;color:#fff">${w.name}</div>
              <div style="font-size:10px;color:var(--text-muted)">Joined ${Utils.timeAgo(w.createdAt)}</div>
            </div>
          </div>
        </td>
        <td style="font-size:12px;color:var(--text-secondary)">📍 ${w.location || 'Local Area'}</td>
        <td style="max-width:200px">
          <div style="font-size:12px;font-weight:700;color:#fff">${w.experience || 0} yrs experience</div>
          ${w.bio ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-style:italic">"${w.bio}"</div>` : ''}
        </td>
        <td style="max-width:260px">${servicesDetail}</td>
        <td>${verBadge}</td>
        <td>
          <div class="flex gap-xs" style="gap:6px;flex-wrap:wrap">
            ${!isApproved ? `
              <button class="btn btn-sm btn-success" onclick="approveWorkerAdmin('${w.id}')" style="padding:6px 12px;font-size:11px">
                ✓ Approve
              </button>
            ` : ''}
            ${!isRejected ? `
              <button class="btn btn-sm btn-ghost" onclick="rejectWorkerAdmin('${w.id}')" style="padding:6px 10px;font-size:11px;color:var(--danger)">
                ✗ Reject
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.approveWorkerAdmin = async function(workerId) {
  try {
    await API.verifyWorker(workerId, 'approve');
    showToast('🟢 Worker Approved', 'Worker is now approved and live for customer booking & map!', 'success');
    await loadAdminDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

window.rejectWorkerAdmin = async function(workerId) {
  try {
    await API.verifyWorker(workerId, 'reject');
    showToast('🔴 Verification Rejected', 'Worker hidden from discovery.', 'warning');
    await loadAdminDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Bookings & Lifecycle ──────────────────────────────────────
function renderBookingsTable() {
  const tbody1 = document.getElementById('bookings-tbody');
  const tbody2 = document.getElementById('all-bookings-tbody');

  const renderRows = (reqs) => {
    if (reqs.length === 0) {
      return `
        <tr>
          <td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">
            No bookings recorded yet.
          </td>
        </tr>
      `;
    }
    return reqs.map(r => {
      const worker = adminWorkers.find(w => w.id === r.workerId);
      const workerName = worker ? worker.name : 'Worker';
      const status = Utils.statusLabel(r.status);

      return `
        <tr>
          <td>
            <div class="flex items-center gap-sm">
              <div class="avatar" style="width:30px;height:30px;font-size:11px">${Utils.getInitials(r.customerName || 'Customer')}</div>
              <span class="td-name">${r.customerName || 'Customer'}</span>
            </div>
          </td>
          <td>
            <div class="flex items-center gap-sm">
              <div class="avatar" style="width:30px;height:30px;font-size:11px;background:var(--gradient-primary)">
                ${Utils.getInitials(workerName)}
              </div>
              <span>${workerName}</span>
            </div>
          </td>
          <td>
            <div style="font-weight:600;color:#fff">${r.serviceCategory}</div>
            <div style="font-size:10px;color:var(--text-muted)">${r.specificWork || ''}</div>
          </td>
          <td style="font-weight:800;color:var(--primary-light)">
            ${Utils.formatPrice(r.finalPrice || r.workerCounter || r.offer)}
          </td>
          <td><span class="badge ${status.cls}">${status.text}</span></td>
          <td style="color:var(--text-muted);font-size:11px">${Utils.timeAgo(r.updatedAt || r.createdAt)}</td>
        </tr>
      `;
    }).join('');
  };

  if (tbody1) tbody1.innerHTML = renderRows(adminRequests.slice(0, 5));
  if (tbody2) tbody2.innerHTML = renderRows(adminRequests);
}

// ── Negotiations Monitoring Table ─────────────────────────────
function renderNegotiationsTable() {
  const tbody = document.getElementById('negotiations-tbody');
  if (!tbody) return;

  if (adminRequests.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">
          No active negotiations recorded yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = adminRequests.map(r => {
    const status = Utils.statusLabel(r.status);
    return `
      <tr>
        <td class="td-name" style="font-weight:700;color:#fff">
          ${r.serviceCategory}
          <div style="font-size:10px;color:var(--text-muted);font-weight:400">${r.customerName || 'Customer'}</div>
        </td>
        <td>${Utils.formatPrice(r.basePrice)}</td>
        <td style="color:var(--warning);font-weight:700">${Utils.formatPrice(r.offer)}</td>
        <td style="color:var(--primary-light);font-weight:700">${r.workerCounter ? Utils.formatPrice(r.workerCounter) : '—'}</td>
        <td style="color:var(--success);font-weight:800">${r.finalPrice ? Utils.formatPrice(r.finalPrice) : '—'}</td>
        <td>${r.workerCounter ? '2' : '1'} round(s)</td>
        <td><span class="badge ${status.cls}">${status.text}</span></td>
      </tr>
    `;
  }).join('');
}

// ── Registered Users Table (Real Data) ────────────────────────
function renderUsersTable() {
  const tbody = document.querySelector('[data-admin-section="users"] tbody');
  if (!tbody) return;

  if (adminAccounts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">
          No customer accounts created yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = adminAccounts.map(u => {
    const userBookings = adminRequests.filter(r => r.customerId === u.id);
    return `
      <tr>
        <td>
          <div class="flex items-center gap-sm">
            <div class="avatar" style="width:34px;height:34px;font-size:12px">${Utils.getInitials(u.name)}</div>
            <div>
              <div class="td-name" style="font-weight:700;color:#fff">${u.name}</div>
              <div style="font-size:10px;color:var(--text-muted)">ID: ${u.id.slice(0, 8)}...</div>
            </div>
          </div>
        </td>
        <td style="font-size:12px;color:var(--text-muted)">Customer Account</td>
        <td style="font-size:var(--text-xs)">Connaught Place, New Delhi</td>
        <td><span class="badge badge-primary">${userBookings.length} booking(s)</span></td>
        <td style="color:var(--text-muted);font-size:var(--text-xs)">${Utils.timeAgo(u.createdAt)}</td>
      </tr>
    `;
  }).join('');
}

// ── Analytics Tab (Computed Real Metrics) ─────────────────────
function renderAnalyticsTab() {
  const completedJobs = adminRequests.filter(r => r.status === 'completed' || r.jobStatus === 'completed');
  const totalCompletedVal = completedJobs.reduce((sum, r) => sum + (Number(r.finalPrice) || Number(r.offer) || 0), 0);

  // Discount calculation
  let totalDiscountPercent = 0;
  let discountedCount = 0;
  adminRequests.forEach(r => {
    if (r.finalPrice && r.basePrice && r.basePrice > 0) {
      const disc = ((r.basePrice - r.finalPrice) / r.basePrice) * 100;
      if (disc > 0) {
        totalDiscountPercent += disc;
        discountedCount++;
      }
    }
  });
  const avgDiscount = discountedCount > 0 ? (totalDiscountPercent / discountedCount).toFixed(1) + '%' : '0%';

  const metrics = document.querySelectorAll('[data-admin-section="analytics"] .admin-stat-card .stat-card-value');
  if (metrics.length >= 4) {
    metrics[0].textContent = avgDiscount;
    metrics[1].textContent = adminRequests.length > 0 ? ((completedJobs.length / adminRequests.length) * 100).toFixed(0) + '%' : '0%';
    metrics[2].textContent = `${adminWorkers.filter(w => w.verificationStatus === 'approved').length} Active`;
    metrics[3].textContent = Utils.formatPrice(totalCompletedVal);
  }
}

// ── Sidebar & Layout ──────────────────────────────────────────
function initSidebar() {
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar   = document.getElementById('admin-sidebar');
  const overlay   = document.getElementById('sidebar-overlay');

  if (!toggleBtn || !sidebar) return;

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay && overlay.classList.toggle('visible');
  });

  overlay && overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  });
}

function initAdminNav() {
  const navItems = document.querySelectorAll('.sidebar-nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      const section = item.dataset.section;
      if (section) showAdminSection(section);
    });
  });
}

window.showAdminSection = function(section) {
  const sections = document.querySelectorAll('[data-admin-section]');
  sections.forEach(s => {
    s.style.display = 'none';
  });

  const target = document.querySelector(`[data-admin-section="${section}"]`);
  if (target) target.style.display = 'block';

  const titleEl = document.getElementById('topbar-title');
  const pageEl  = document.getElementById('topbar-page');
  const labels = {
    dashboard:    'Dashboard Overview',
    users:        'Customer Accounts',
    workers:      'Worker Verification & Profiles',
    bookings:     'Customer Bookings Lifecycle',
    services:     'Service Categories',
    negotiations: 'Live Price Negotiations',
    analytics:    'Platform Metrics',
  };
  if (titleEl) titleEl.textContent = labels[section] || 'Dashboard';
  if (pageEl)  pageEl.textContent  = labels[section] || 'Overview';
};

function animateAdminEntrance() {
  const cards = document.querySelectorAll('.admin-stat-card, .admin-table-wrap');
  cards.forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, i * 60 + 100);
  });
}
