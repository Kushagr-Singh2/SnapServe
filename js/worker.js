/* ============================================================
   SNAPSERVE — Worker Interface Logic (SIH Real-Data Architecture)
   js/worker.js
   ============================================================ */

'use strict';

let currentWorkerData = null;
let currentRequests = [];

document.addEventListener('DOMContentLoaded', () => {
  initWorkerPage();
});

async function initWorkerPage() {
  const session = Session.get();
  if (!session || session.role !== 'worker') {
    window.location.href = 'login.html';
    return;
  }

  // Initial skeleton
  currentWorkerData = {
    accountId: session.id,
    name: session.name,
    verificationStatus: 'pending',
    services: [],
    available: false,
    experience: 0,
    location: '',
    bio: '',
  };

  renderWorkerHeader();
  await loadWorkerDataFromServer();

  // Setup SSE for real-time live synchronization
  API.setupSSE((eventData) => {
    console.log('[Worker SSE Event]:', eventData);
    loadWorkerDataFromServer();
  });
}

async function loadWorkerDataFromServer() {
  const session = Session.get();
  if (!session) return;

  try {
    // 1. Fetch worker profile by account ID
    let worker = await API.getWorkerByAccount(session.id);

    // Also check by name as backup
    if (!worker) {
      const allWorkers = await API.getWorkers('', 'all');
      worker = allWorkers.find(w => w.name.toLowerCase() === session.name.toLowerCase()) || null;
    }

    if (!worker) {
      // Worker hasn't completed onboarding yet
      showOnboardingCard(session.name);
      return;
    }

    // Worker profile exists
    hideOnboardingCard();
    currentWorkerData = worker;

    // 2. Fetch requests for this worker
    const reqs = await API.getRequests({ workerId: currentWorkerData.id });
    currentRequests = reqs || [];

    renderVerificationBanner();
    renderWorkerHeader();
    renderWorkerStats();
    renderIncomingRequests();
    renderMyServices();
    renderWorkerProfileTab();
    updateOnlineUI(currentWorkerData.available);
  } catch (err) {
    console.warn('Error loading worker data:', err);
  }
}

// ── Onboarding Gate ──────────────────────────────────────────
function showOnboardingCard(name) {
  const obCard = document.getElementById('worker-onboarding-card');
  const dashContent = document.getElementById('worker-dashboard-content');
  const nameInput = document.getElementById('ob-worker-name');

  if (obCard) obCard.style.display = 'block';
  if (dashContent) dashContent.style.display = 'none';
  if (nameInput && name) nameInput.value = name;

  const banner = document.getElementById('demand-banner');
  if (banner) {
    banner.style.background = 'linear-gradient(135deg, rgba(255,107,0,0.1), rgba(232,184,75,0.06))';
    banner.style.border = '1px solid rgba(255,107,0,0.3)';
    banner.innerHTML = `
      <span class="demand-icon" style="font-size:24px">👋</span>
      <div>
        <div class="demand-text" style="color:#fff;font-weight:800">Welcome to SnapServe, ${name}!</div>
        <div class="demand-sub" style="color:var(--text-muted)">
          Please complete your onboarding profile below to begin offering services.
        </div>
      </div>
    `;
  }
}

function hideOnboardingCard() {
  const obCard = document.getElementById('worker-onboarding-card');
  const dashContent = document.getElementById('worker-dashboard-content');
  if (obCard) obCard.style.display = 'none';
  if (dashContent) dashContent.style.display = 'block';
}

window.handleWorkerOnboarding = async function(e) {
  e.preventDefault();
  const session = Session.get();
  const name = document.getElementById('ob-worker-name').value.trim();
  const location = document.getElementById('ob-worker-location').value.trim();
  const experience = Number(document.getElementById('ob-worker-exp').value) || 0;
  const bio = document.getElementById('ob-worker-bio').value.trim();

  if (!name || !location) {
    showToast('Required', 'Please fill in your name and location', 'warning');
    return;
  }

  try {
    const worker = await API.registerWorker({
      accountId: session.id,
      name,
      location,
      experience,
      bio,
    });

    currentWorkerData = worker;
    showToast('Profile Created!', 'Now add the services you provide', 'success');
    hideOnboardingCard();
    await loadWorkerDataFromServer();

    // Switch to profile tab and prompt to add service
    switchWorkerView('profile');
    openAddServiceModal();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Verification Banner ──────────────────────────────────────
function renderVerificationBanner() {
  const banner = document.getElementById('demand-banner');
  if (!banner || !currentWorkerData) return;

  const status = currentWorkerData.verificationStatus;
  const services = currentWorkerData.services || [];

  if (status === 'approved') {
    banner.className = 'demand-banner success-banner';
    banner.style.background = 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(6,182,212,0.1))';
    banner.style.border = '1px solid rgba(34,197,94,0.3)';
    banner.innerHTML = `
      <span class="demand-icon" style="font-size:24px">🟢</span>
      <div style="flex:1">
        <div class="demand-text" style="color:#22C55E;font-weight:800">Verified Professional</div>
        <div class="demand-sub" style="color:var(--text-muted)">
          Your profile is active and visible to nearby customers in service discovery and map.
        </div>
      </div>
      <span class="badge badge-success">Live on Platform</span>
    `;
  } else if (status === 'rejected') {
    banner.className = 'demand-banner danger-banner';
    banner.style.background = 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(255,107,0,0.08))';
    banner.style.border = '1px solid rgba(239,68,68,0.3)';
    banner.innerHTML = `
      <span class="demand-icon" style="font-size:24px">🔴</span>
      <div style="flex:1">
        <div class="demand-text" style="color:#EF4444;font-weight:800">Verification Rejected</div>
        <div class="demand-sub" style="color:var(--text-muted)">
          Your application was reviewed and rejected. You are not visible to customers.
        </div>
      </div>
    `;
  } else {
    // Pending
    banner.className = 'demand-banner warning-banner';
    banner.style.background = 'linear-gradient(135deg, rgba(234,179,8,0.15), rgba(255,107,0,0.1))';
    banner.style.border = '1px solid rgba(234,179,8,0.3)';
    banner.innerHTML = `
      <span class="demand-icon" style="font-size:24px">🟡</span>
      <div style="flex:1">
        <div class="demand-text" style="color:#EAB308;font-weight:800">Pending Verification</div>
        <div class="demand-sub" style="color:var(--text-muted)">
          Your profile has been submitted for admin verification. You will become visible to customers after approval.
        </div>
      </div>
      ${services.length === 0 ? `
        <button class="btn btn-sm btn-primary" onclick="switchWorkerView('profile');openAddServiceModal()">
          + Add Services
        </button>
      ` : ''}
    `;
  }
}

// ── Worker Header ────────────────────────────────────────────
function renderWorkerHeader() {
  if (!currentWorkerData) return;
  const worker = currentWorkerData;
  const greeting = Utils.getGreeting();
  const firstSvc = worker.services && worker.services[0] ? worker.services[0].category : 'Service Specialist';

  const greetEl  = document.getElementById('worker-greeting');
  const nameEl   = document.getElementById('worker-name');
  const roleTag  = document.getElementById('worker-role-tag');
  if (greetEl)  greetEl.textContent = greeting + ',';
  if (nameEl)   nameEl.textContent  = worker.name + ' 👋';
  if (roleTag)  roleTag.textContent = firstSvc;

  const sAvatar = document.getElementById('sidebar-worker-avatar');
  const sName   = document.getElementById('sidebar-worker-name');
  const sRole   = document.getElementById('sidebar-worker-role');
  const sRating = document.getElementById('sidebar-worker-rating');
  if (sAvatar)  sAvatar.textContent = Utils.getInitials(worker.name);
  if (sName)    sName.textContent   = worker.name;
  if (sRole)    sRole.textContent   = firstSvc;
  if (sRating)  {
    const isApproved = worker.verificationStatus === 'approved';
    const isRejected = worker.verificationStatus === 'rejected';
    sRating.textContent = isApproved ? '🟢 Verified' : isRejected ? '🔴 Rejected' : '🟡 Pending';
  }

  const dtAvatar = document.getElementById('dt-avatar');
  if (dtAvatar) dtAvatar.textContent = Utils.getInitials(worker.name);

  const dwGreeting = document.getElementById('dw-greeting');
  const dwName     = document.getElementById('dw-name');
  const dwTag      = document.getElementById('dw-tag');
  if (dwGreeting) dwGreeting.textContent = greeting + ',';
  if (dwName)     dwName.textContent     = worker.name;
  if (dwTag)      dwTag.textContent      = worker.verificationStatus === 'approved' ? '📍 Online & Ready for Requests' : '⏳ Awaiting Admin Approval';
}

// ── Stats Grid ───────────────────────────────────────────────
function renderWorkerStats() {
  const earningsEl = document.getElementById('stat-earnings');
  const jobsEl     = document.getElementById('stat-jobs');
  const pendingEl  = document.getElementById('stat-pending');

  const pendingCount = currentRequests.filter(r => ['pending', 'countered'].includes(r.status)).length;
  const completedJobs = currentRequests.filter(r => r.status === 'completed');
  const totalEarnings = completedJobs.reduce((sum, r) => sum + (Number(r.finalPrice) || Number(r.offer) || 0), 0);

  if (earningsEl) earningsEl.textContent = Utils.formatPrice(totalEarnings);
  if (jobsEl)     jobsEl.textContent     = completedJobs.length;
  if (pendingEl)  pendingEl.textContent  = pendingCount;

  // Sidebar strips
  const sEarn = document.getElementById('sidebar-earn-val');
  const sJobs = document.getElementById('sidebar-jobs-val');
  if (sEarn) sEarn.textContent = Utils.formatPrice(totalEarnings);
  if (sJobs) sJobs.textContent = completedJobs.length;

  const wEarn = document.getElementById('week-earn');
  const wJobs = document.getElementById('week-jobs');
  if (wEarn) wEarn.textContent = Utils.formatPrice(totalEarnings);
  if (wJobs) wJobs.textContent = completedJobs.length;
}

// ── Incoming Requests ────────────────────────────────────────
function renderIncomingRequests() {
  const container = document.getElementById('requests-container');
  const tabContainer = document.getElementById('requests-tab-container');
  if (!container) return;

  const badge   = document.getElementById('req-count-badge');
  const sideReq = document.getElementById('sidebar-req-count');

  const pendingRequests = currentRequests.filter(r => !['completed', 'declined', 'cancelled'].includes(r.status));
  if (badge)   badge.textContent  = pendingRequests.length + ' active';
  if (sideReq) sideReq.textContent = pendingRequests.length;

  const activeJobsHtml = renderActiveJobsTracker();

  if (currentRequests.length === 0) {
    const emptyState = activeJobsHtml + `
      <div style="padding:40px 20px;text-align:center;background:var(--bg-glass);border:1px dashed var(--border-card);border-radius:20px">
        <div style="font-size:36px;margin-bottom:8px">📭</div>
        <div style="font-weight:700;color:#fff;font-size:14px">No incoming requests yet</div>
        <div style="font-size:12px;margin-top:4px;color:var(--text-muted)">
          Stay online. Requests from nearby customers will appear here dynamically.
        </div>
      </div>
    `;
    container.innerHTML = emptyState;
    if (tabContainer) tabContainer.innerHTML = emptyState;
    return;
  }

  const cardsHtml = activeJobsHtml + currentRequests.map(req => {
    const isAccepted = req.status === 'accepted';
    const isDeclined = req.status === 'declined';
    const isPending  = req.status === 'pending';
    const isCountered= req.status === 'countered';

    const statusBadge = isAccepted
      ? '<span class="badge badge-success">🟢 Offer Accepted</span>'
      : isDeclined
      ? '<span class="badge badge-danger">🔴 Offer Declined</span>'
      : isCountered
      ? '<span class="badge badge-warning">💬 Your Counter Sent</span>'
      : '<span class="badge badge-primary">⚡ Action Required</span>';

    return `
      <div class="request-card new" id="req-${req.id}" style="border:1px solid ${isAccepted ? 'rgba(34,197,94,0.4)' : 'rgba(255,107,0,0.3)'};margin-bottom:16px;background:var(--bg-glass);border-radius:20px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">
          ${statusBadge}
          <span style="font-size:11px;color:var(--text-muted)">${Utils.timeAgo(req.updatedAt || req.createdAt)}</span>
        </div>

        <div class="flex items-center gap-md mb-md">
          <div class="avatar" style="background:var(--gradient-primary)">${Utils.getInitials(req.customerName || 'Customer')}</div>
          <div>
            <div style="font-weight:700;color:var(--text-primary)">${req.customerName || 'Customer'}</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted)">${req.serviceCategory} · ${req.specificWork || 'Service Request'}</div>
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-card);border-radius:12px;padding:12px;margin-bottom:var(--space-md)">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Problem Description</div>
          <div style="font-size:var(--text-sm);color:var(--text-primary);font-weight:500">
            "${req.problem || req.message || 'Service request.'}"
          </div>
        </div>

        <div class="flex justify-between items-center mb-md" style="padding:10px 14px;background:rgba(255,107,0,0.06);border-radius:12px;margin-bottom:14px">
          <div>
            <div style="font-size:10px;color:var(--text-muted)">Base Price</div>
            <div style="font-weight:700;color:var(--text-secondary)">${Utils.formatPrice(req.basePrice)}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted)">${isCountered ? 'Your Counter' : 'Customer Offer'}</div>
            <div style="font-size:16px;font-weight:900;color:var(--primary-light)">
              ${Utils.formatPrice(isCountered ? req.workerCounter : req.offer)}
            </div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted)">Status</div>
            <div style="font-weight:700;color:#fff;font-size:12px;text-transform:capitalize">${req.status}</div>
          </div>
        </div>

        ${isPending ? `
          <div class="request-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn btn-success" onclick="workerAcceptOffer('${req.id}', ${req.offer})">
              ✓ Accept ${Utils.formatPrice(req.offer)}
            </button>
            <button class="btn btn-primary" onclick="showWorkerCounterModal('${req.id}')">
              💬 Counter Offer
            </button>
            <button class="btn btn-ghost" onclick="workerDeclineOffer('${req.id}')"
              style="grid-column:1/-1;color:var(--danger);font-size:var(--text-xs);padding:6px">
              Decline Offer
            </button>
          </div>
        ` : isCountered ? `
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-muted)">
            <span>Waiting for customer response to ${Utils.formatPrice(req.workerCounter)}...</span>
            <button class="btn btn-ghost btn-sm" onclick="openWorkerChatModal('${req.id}')">Open Chat</button>
          </div>
        ` : `
          <button class="btn btn-ghost btn-full btn-sm" onclick="openWorkerChatModal('${req.id}')">
            💬 Open Chat & Messages
          </button>
        `}
      </div>
    `;
  }).join('');

  container.innerHTML = cardsHtml;
  if (tabContainer) tabContainer.innerHTML = cardsHtml;
}

// ── Negotiation Actions ──────────────────────────────────────
window.workerAcceptOffer = async function(reqId, amount) {
  try {
    await API.negotiate(reqId, {
      action: 'accept',
      counterAmount: amount,
      message: 'Worker accepted the offer!'
    });
    showToast('✅ Job Agreed!', `Deal accepted at ${Utils.formatPrice(amount)}`, 'success');
    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

window.workerDeclineOffer = async function(reqId) {
  try {
    await API.negotiate(reqId, {
      action: 'decline',
      message: 'Worker declined the offer.'
    });
    showToast('Offer Declined', 'Customer has been notified.', 'warning');
    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Manual Counter Offer Modal (Strictly Manual Input) ────────
window.showWorkerCounterModal = function(reqId) {
  const req = currentRequests.find(r => r.id === reqId);
  if (!req) return;

  let backdrop = document.getElementById('worker-neg-modal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'worker-neg-modal';
    backdrop.className = 'modal-backdrop';
    backdrop.style.display = 'none';
    document.body.appendChild(backdrop);
  }

  const basePrice = req.basePrice || 300;
  const currOffer = req.offer || 250;

  backdrop.innerHTML = `
    <div class="modal-inner" style="max-width:440px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);padding-bottom:10px;border-bottom:1px solid var(--border-subtle)">
        <div style="font-weight:800;font-size:var(--text-lg);color:var(--text-primary)">💬 Make Counter Offer</div>
        <button class="btn-icon" onclick="closeModal('worker-neg-modal')"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div style="padding:12px;background:rgba(255,107,0,0.06);border:1px solid rgba(255,107,0,0.2);border-radius:12px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)">
          <span>Your Base Price: <strong>${Utils.formatPrice(basePrice)}</strong></span>
          <span>Customer Offer: <strong style="color:var(--primary-light)">${Utils.formatPrice(currOffer)}</strong></span>
        </div>
      </div>

      <!-- Strict Manual Input — No Preset Chips -->
      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:6px">
          Your Counter Offer (₹):
        </label>
        <input type="number" id="worker-counter-input" placeholder="Enter custom counter amount in ₹"
          style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,107,0,0.4);border-radius:12px;padding:12px 14px;color:#fff;font-weight:800;font-size:18px;margin-bottom:12px" />

        <label style="font-size:12px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:6px">
          Optional Message to Customer:
        </label>
        <textarea id="worker-counter-msg" rows="2" placeholder="e.g. Includes travel and required tools."
          style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px;color:#fff;font-size:12px;resize:none"></textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
        <button class="btn btn-ghost" onclick="closeModal('worker-neg-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="submitWorkerCounter('${req.id}')">Send Counter Offer</button>
      </div>
    </div>
  `;

  openModal('worker-neg-modal');
};

window.submitWorkerCounter = async function(reqId) {
  const amount = Number(document.getElementById('worker-counter-input')?.value);
  const msg = document.getElementById('worker-counter-msg')?.value?.trim() || '';

  if (!amount || isNaN(amount) || amount <= 0) {
    showToast('Invalid Amount', 'Please enter your counter offer in ₹', 'danger');
    return;
  }

  closeModal('worker-neg-modal');

  try {
    await API.negotiate(reqId, {
      action: 'counter',
      counterAmount: amount,
      message: msg
    });
    showToast('💬 Counter Offer Sent', `Offered ${Utils.formatPrice(amount)} to customer`, 'info');
    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Active Jobs Progress Tracker ─────────────────────────────
function renderActiveJobsTracker() {
  const activeJobs = currentRequests.filter(r =>
    ['accepted', 'on_the_way', 'in_progress'].includes(r.jobStatus) ||
    (r.status === 'accepted' && r.jobStatus !== 'completed')
  );

  if (activeJobs.length === 0) return '';

  return activeJobs.map(req => {
    const currentStep = req.jobStatus || 'accepted';
    const steps = [
      { key: 'accepted',    label: 'Price Agreed',  icon: '🤝' },
      { key: 'on_the_way',   label: 'On the Way',    icon: '🚀' },
      { key: 'in_progress',  label: 'In Progress',   icon: '🔧' },
      { key: 'completed',    label: 'Completed',     icon: '✅' },
    ];
    const currentIdx = steps.findIndex(s => s.key === currentStep);

    return `
      <div class="request-card" style="border:1px solid var(--success);background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(255,107,0,0.04));margin-bottom:20px;border-radius:20px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span class="badge badge-success">🟢 Active Job in Progress</span>
          <span style="font-size:11px;color:var(--text-muted)">
            Agreed Price: <strong style="color:#fff;font-size:14px">${Utils.formatPrice(req.finalPrice || req.offer)}</strong>
          </span>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div class="avatar" style="background:var(--gradient-primary);width:44px;height:44px">${Utils.getInitials(req.customerName || 'Customer')}</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:15px;color:#fff">${req.customerName || 'Customer'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${req.serviceCategory} · ${req.specificWork || 'Service Job'}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="openWorkerChatModal('${req.id}')" style="border:1px solid rgba(255,255,255,0.15)">
            💬 Chat
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:16px;text-align:center">
          ${steps.map((s, idx) => {
            const isDone = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            return `
              <div style="padding:6px 2px;background:${isDone ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isCurrent ? 'var(--success)' : isDone ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'};border-radius:10px">
                <div style="font-size:14px">${s.icon}</div>
                <div style="font-size:9px;font-weight:700;color:${isDone ? '#22C55E' : '#777'};margin-top:2px">${s.label}</div>
              </div>
            `;
          }).join('')}
        </div>

        ${currentStep === 'accepted' ? `
          <button class="btn btn-primary btn-full" onclick="advanceJobStatus('${req.id}', 'on_the_way')">
            🚀 On the Way to Customer Location
          </button>
        ` : currentStep === 'on_the_way' ? `
          <button class="btn btn-primary btn-full" onclick="advanceJobStatus('${req.id}', 'in_progress')">
            🔧 Arrived & Start Work (In Progress)
          </button>
        ` : currentStep === 'in_progress' ? `
          <button class="btn btn-success btn-full" onclick="advanceJobStatus('${req.id}', 'completed')">
            ✅ Complete Work & Collect ${Utils.formatPrice(req.finalPrice || req.offer)}
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.advanceJobStatus = async function(reqId, newStatus) {
  try {
    await API.negotiate(reqId, {
      action: 'job_update',
      counterAmount: newStatus,
      status: newStatus,
      message: `Job status updated to ${newStatus}`
    });

    if (newStatus === 'completed') {
      showToast('🎉 Job Completed!', 'Work completed and saved to platform history.', 'success');
    } else {
      showToast('Status Updated', `Job status: ${newStatus.replace(/_/g, ' ')}`, 'info');
    }

    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── My Offered Services ──────────────────────────────────────
function renderMyServices() {
  const container = document.getElementById('my-services-list');
  if (!container || !currentWorkerData) return;

  const services = currentWorkerData.services || [];

  if (services.length === 0) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:16px;color:var(--text-muted);font-size:12px">
        No services added yet. Click "+ Add Service" above to specify your exact skills and prices.
      </div>
    `;
    return;
  }

  container.innerHTML = services.map((svc) => `
    <div class="service-list-item" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg-glass);border:1px solid var(--border-card);border-radius:16px;margin-bottom:10px">
      <div>
        <div style="font-weight:800;color:#fff;font-size:14px">${svc.category}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin:2px 0">"${svc.specificWork}"</div>
        <div style="font-size:11px;color:var(--primary-light);font-weight:600">
          Base Starting Price: ${Utils.formatPrice(svc.basePrice)} · ${svc.experienceYears || currentWorkerData.experience || 0} yrs exp
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="removeService('${svc.id}')" style="color:var(--danger)">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

window.openAddServiceModal = function() {
  openModal('add-service-modal');
};

window.submitAddService = async function() {
  if (!currentWorkerData || !currentWorkerData.id) {
    showToast('Profile Missing', 'Please complete worker profile first', 'warning');
    return;
  }

  const category     = document.getElementById('new-svc-category')?.value || 'Electrical';
  const specificWork = document.getElementById('new-svc-work')?.value?.trim();
  const price        = Number(document.getElementById('new-svc-price')?.value);
  const exp          = Number(document.getElementById('new-svc-exp')?.value) || currentWorkerData.experience || 0;
  const desc         = document.getElementById('new-svc-desc')?.value?.trim() || '';

  if (!specificWork) {
    showToast('Required', 'Please describe the specific work you provide (e.g. Fan installation)', 'warning');
    return;
  }

  if (!price || isNaN(price) || price <= 0) {
    showToast('Required', 'Please enter a valid base starting price', 'warning');
    return;
  }

  try {
    await API.addWorkerService(currentWorkerData.id, {
      category,
      specificWork,
      basePrice: price,
      experienceYears: exp,
      description: desc,
    });

    closeModal('add-service-modal');
    showToast('Service Added!', `${category}: "${specificWork}" added`, 'success');

    // Clear inputs
    document.getElementById('new-svc-work').value = '';
    document.getElementById('new-svc-desc').value = '';

    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

window.removeService = async function(serviceId) {
  if (!currentWorkerData || !currentWorkerData.id) return;
  try {
    await API.removeWorkerService(currentWorkerData.id, serviceId);
    showToast('Service Removed', 'Updated your services list', 'info');
    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Profile Tab ──────────────────────────────────────────────
function renderWorkerProfileTab() {
  const container = document.getElementById('worker-profile-content');
  if (!container || !currentWorkerData) return;

  const worker = currentWorkerData;
  const isApproved = worker.verificationStatus === 'approved';
  const isRejected = worker.verificationStatus === 'rejected';

  container.innerHTML = `
    <div style="background:var(--bg-glass);border:1px solid var(--border-card);border-radius:24px;padding:24px;text-align:center;backdrop-filter:blur(16px);position:relative;overflow:hidden;margin-bottom:var(--space-md)">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--gradient-primary)"></div>

      <div class="avatar avatar-xl" style="margin:0 auto 12px;font-size:26px;width:72px;height:72px;background:var(--gradient-primary)">
        ${Utils.getInitials(worker.name)}
      </div>

      <h2 style="font-size:22px;font-weight:800;color:#fff;margin-bottom:2px">${worker.name}</h2>
      <div style="font-size:12px;color:var(--primary-light);margin-bottom:10px;font-weight:600">
        📍 ${worker.location || 'Local Area'} · ${worker.experience || 0} years experience
      </div>

      <div style="display:flex;justify-content:center;gap:12px;margin-bottom:16px">
        <span class="badge ${isApproved ? 'badge-success' : isRejected ? 'badge-danger' : 'badge-warning'}">
          ${isApproved ? '🟢 Verified Professional' : isRejected ? '🔴 Verification Rejected' : '🟡 Pending Admin Verification'}
        </span>
      </div>

      ${worker.bio ? `
        <div style="text-align:left;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;font-size:12px;color:var(--text-secondary);margin-bottom:14px">
          "${worker.bio}"
        </div>
      ` : ''}

      ${!isApproved && !isRejected ? `
        <button class="btn btn-primary btn-full btn-sm" onclick="submitForVerification()">
          🚀 Submit Profile for Admin Verification
        </button>
      ` : ''}
    </div>
  `;
}

window.submitForVerification = async function() {
  if (!currentWorkerData || !currentWorkerData.id) return;
  if (!currentWorkerData.services || currentWorkerData.services.length === 0) {
    showToast('Add Service First', 'Please add at least one service before submitting', 'warning');
    return;
  }

  try {
    await API.submitWorkerProfile(currentWorkerData.id);
    showToast('Submitted for Review!', 'Admin has received your verification request', 'success');
    await loadWorkerDataFromServer();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Online/Offline Toggle ────────────────────────────────────
window.toggleOnlineStatus = async function() {
  if (!currentWorkerData || !currentWorkerData.id) return;
  if (currentWorkerData.verificationStatus !== 'approved') {
    showToast('Verification Required', 'You can toggle online status once verified by Admin', 'warning');
    return;
  }

  const nextStatus = !currentWorkerData.available;
  try {
    await API.updateWorkerAvailability(currentWorkerData.id, nextStatus);
    currentWorkerData.available = nextStatus;
    updateOnlineUI(nextStatus);
    showToast(
      nextStatus ? '🟢 You are Online' : '🔴 You are Offline',
      nextStatus ? 'Customers can now discover you on the map.' : 'Incoming requests paused.',
      nextStatus ? 'success' : 'info'
    );
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

function updateOnlineUI(isOnline) {
  document.querySelectorAll('.online-btn').forEach(btn => {
    btn.classList.toggle('online', !!isOnline);
    btn.classList.toggle('offline', !isOnline);
  });
  document.querySelectorAll('[id$="-online-label"]').forEach(lbl => {
    lbl.textContent = isOnline ? 'Online' : 'Offline';
  });
}

// ── Live Customer Chat Modal ─────────────────────────────────
window.openWorkerChatModal = async function(reqId) {
  const box = document.getElementById('worker-chat-history-box');
  if (!box) return;

  try {
    const msgs = await API.getMessages(reqId);
    box.dataset.activeReqId = reqId;

    const req = currentRequests.find(r => r.id === reqId);
    const custNameEl = document.getElementById('chat-customer-name');
    if (custNameEl && req) {
      custNameEl.textContent = req.customerName || 'Customer';
    }

    box.innerHTML = msgs.length === 0 ? `
      <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">
        No messages yet. Send a message to start communicating with the customer.
      </div>
    ` : msgs.map(m => `
      <div style="margin-bottom:10px;text-align:${m.senderType === 'worker' ? 'right' : 'left'}">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">
          ${m.senderName || (m.senderType === 'worker' ? 'You' : 'Customer')} · ${Utils.formatTime(m.createdAt)}
        </div>
        <div style="display:inline-block;padding:8px 12px;border-radius:12px;font-size:12px;max-width:80%;background:${m.senderType === 'worker' ? 'var(--gradient-primary)' : 'rgba(255,255,255,0.08)'};color:#fff">
          ${m.text}
        </div>
      </div>
    `).join('');

    openModal('worker-chat-modal');
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

window.sendWorkerChatMessage = async function() {
  const input = document.getElementById('worker-chat-input');
  const box = document.getElementById('worker-chat-history-box');
  const reqId = box?.dataset?.activeReqId;

  if (!input || !input.value.trim() || !reqId) return;
  const text = input.value.trim();
  input.value = '';

  try {
    await API.sendMessage(reqId, { text, senderType: 'worker' });
    await openWorkerChatModal(reqId);
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Tab Switching ────────────────────────────────────────────
window.switchWorkerView = function(viewName, btnEl) {
  // Update desktop sidebar items
  document.querySelectorAll('.worker-desktop-sidebar .sidebar-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
  if (btnEl) btnEl.classList.add('active');

  // Update mobile bottom nav
  document.querySelectorAll('.worker-bottom-nav .nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });

  // Switch visible tab panel
  document.querySelectorAll('[data-worker-tab]').forEach(tab => {
    tab.style.display = tab.dataset.workerTab === viewName ? 'block' : 'none';
  });

  const titles = { dashboard: 'Dashboard', requests: 'Requests', messages: 'Messages', profile: 'My Profile', settings: 'Settings' };
  const titleEl = document.getElementById('dt-title');
  if (titleEl) titleEl.textContent = titles[viewName] || 'Dashboard';

  if (viewName === 'profile') {
    renderWorkerProfileTab();
    renderMyServices();
  }
};

window.switchWorkerTab = window.switchWorkerView;
