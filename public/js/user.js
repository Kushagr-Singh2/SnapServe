/* ============================================================
   SNAPSERVE — Customer Interface Logic (SIH Real-Data Architecture)
   js/user.js
   ============================================================ */

'use strict';

const CustomerState = {
  currentTab: 'home',
  activeServiceFilter: 'all',
  activeMapFilter: 'all',
  selectedWorkerId: null,
  searchQuery: '',
  workers: [],
  requests: [],
  map: {
    canvas: null,
    ctx: null,
    zoom: 1.0,
    workerPins: [],
    selectedPinId: null,
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initCustomerPage();
});

async function initCustomerPage() {
  const session = Session.get();
  if (!session || (session.role !== 'customer' && session.role !== 'user')) {
    window.location.href = 'login.html';
    return;
  }

  renderUserHeader();
  renderUserProfileTab();
  await loadCustomerDataFromServer();
  initGlobalSearch();
  initDiscoveryMap();
  animatePageEntrance();

  // Setup SSE for cross-device live updates
  API.setupSSE((eventData) => {
    console.log('[Customer SSE Event]:', eventData);
    loadCustomerDataFromServer();
  });
}

async function loadCustomerDataFromServer() {
  try {
    // Fetch only verified/approved workers from backend
    CustomerState.workers = await API.getWorkers('', 'approved');

    // Fetch requests for current user
    const user = StateManager.getUser();
    CustomerState.requests = await API.getRequests({ customerId: user.id });

    // Update nav counters
    const activeRequests = CustomerState.requests.filter(r => !['completed', 'declined', 'cancelled'].includes(r.status));
    const snavCount = document.getElementById('snav-booking-count');
    if (snavCount) {
      snavCount.textContent = activeRequests.length;
      snavCount.style.display = activeRequests.length > 0 ? 'inline-block' : 'none';
    }
    const bookingBadge = document.getElementById('booking-badge-count');
    if (bookingBadge) {
      bookingBadge.textContent = `Active: ${activeRequests.length}`;
    }

    renderServiceCategories(CustomerState.activeServiceFilter);
    renderNearbyWorkers();
    renderBookingsTab();
    renderActiveNegotiationCard();

    if (CustomerState.map.canvas) {
      updateMapPins();
      drawDiscoveryMap();
    }
  } catch (err) {
    console.warn('Error loading customer data:', err);
  }
}

// ── Header & Greeting ────────────────────────────────────────────────
function renderUserHeader() {
  const user = StateManager.getUser();
  const greeting = Utils.getGreeting();

  ['mobile-avatar', 'sidebar-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = Utils.getInitials(user.name);
  });

  const lineEl = document.getElementById('greeting-line');
  const nameEl = document.getElementById('greeting-name');
  const subEl  = document.getElementById('greeting-sub');

  if (lineEl) lineEl.textContent = greeting + ',';
  if (nameEl) nameEl.textContent = user.name + ' 👋';
  if (subEl)  subEl.innerHTML = `<i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:10px"></i> <span>Connaught Place, New Delhi</span>`;

  const sbName = document.getElementById('sidebar-user-name');
  if (sbName) sbName.textContent = user.name;
}

// ── Services & Category Discovery ────────────────────────────────────
window.filterServices = function(category, btnEl) {
  CustomerState.activeServiceFilter = category;
  document.querySelectorAll('#filter-pills-bar .filter-pill').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  renderServiceCategories(category);
};

function renderServiceCategories(filterCategory = 'all') {
  const grid = document.getElementById('service-grid');
  if (!grid) return;

  let services = MockData.services;
  if (filterCategory !== 'all') {
    services = services.filter(s =>
      s.name.toLowerCase().includes(filterCategory.toLowerCase()) ||
      s.id.toLowerCase().includes(filterCategory.toLowerCase())
    );
  }

  grid.innerHTML = services.map(svc => {
    const categoryWorkers = CustomerState.workers.filter(w =>
      (w.services || []).some(s => s.category.toLowerCase() === svc.name.toLowerCase())
    );

    let priceSnippet = '';
    if (categoryWorkers.length > 0) {
      const prices = categoryWorkers.map(w => {
        const s = (w.services || []).find(sv => sv.category.toLowerCase() === svc.name.toLowerCase());
        return s ? Number(s.basePrice) : 9999;
      }).filter(p => !isNaN(p));
      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
      priceSnippet = `<div class="service-chip-price">from ${Utils.formatPrice(minPrice)}</div>`;
    } else {
      priceSnippet = `<div class="service-chip-price" style="color:var(--text-muted);font-size:11px">Awaiting workers</div>`;
    }

    return `
      <div class="service-chip" role="button" tabindex="0" onclick="selectServiceCategory('${svc.name}')" id="svc-${svc.id}">
        <span class="service-chip-emoji">${svc.emoji}</span>
        <div class="service-chip-name">${svc.name}</div>
        <div class="service-chip-count" style="color:${categoryWorkers.length > 0 ? 'var(--success)' : 'var(--text-muted)'}">
          ${categoryWorkers.length > 0 ? `${categoryWorkers.length} verified` : 'No workers yet'}
        </div>
        ${priceSnippet}
      </div>
    `;
  }).join('');
}

window.selectServiceCategory = function(categoryName) {
  const svc = Utils.getService(categoryName);
  showServiceModal(svc || { name: categoryName, emoji: '⚡' });
};

function showServiceModal(svc) {
  const inner = document.getElementById('service-modal-inner');
  if (!inner) return;

  // Filter approved workers offering this category
  const workers = CustomerState.workers.filter(w =>
    (w.services || []).some(s => s.category.toLowerCase() === svc.name.toLowerCase())
  );

  inner.innerHTML = `
    <div class="modal-handle"></div>
    <div class="flex items-center gap-md mb-lg">
      <span style="font-size:38px">${svc.emoji}</span>
      <div>
        <div class="modal-title" style="margin:0;font-size:var(--text-xl)">${svc.name} Services</div>
        <div style="font-size:var(--text-xs);color:var(--text-muted)">
          ${workers.length > 0 ? `${workers.length} verified professional(s) available` : 'Hyperlocal Service Category'}
        </div>
      </div>
    </div>

    <div style="margin-bottom:var(--space-lg)">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:var(--space-sm)">
        Verified ${svc.name} Professionals
      </div>

      ${workers.length === 0 ? `
        <div style="padding:32px 20px;text-align:center;background:var(--bg-glass);border:1px dashed var(--border-card);border-radius:18px">
          <div style="font-size:34px;margin-bottom:10px">🛠️</div>
          <div style="font-weight:800;color:#fff;font-size:15px">No verified ${svc.name} workers available yet.</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px;line-height:1.5">
            Workers will appear here once verified by Admin.<br/>Register a service worker account to test this flow!
          </div>
        </div>
      ` : workers.map(w => {
        const specificSvc = (w.services || []).find(s => s.category.toLowerCase() === svc.name.toLowerCase()) || w.services[0] || {};
        return `
          <div onclick="viewWorkerProfile('${w.id}');closeModal('service-modal')"
            style="display:flex;align-items:center;gap:var(--space-md);padding:14px;background:var(--bg-glass);border:1px solid var(--border-card);border-radius:var(--radius-lg);margin-bottom:10px;cursor:pointer;transition:transform 0.2s"
            onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">

            <div class="wm-avatar-wrap">
              <div class="wm-avatar">${Utils.getInitials(w.name)}</div>
              <span class="wm-online"></span>
            </div>

            <div style="flex:1">
              <div style="font-weight:800;font-size:var(--text-sm);color:var(--text-primary);display:flex;align-items:center;gap:6px">
                ${w.name}
                <i class="fa-solid fa-circle-check" style="color:var(--success);font-size:11px" title="Admin Verified"></i>
              </div>
              <div style="font-size:12px;color:var(--primary-light);margin:2px 0;font-weight:600">
                "${specificSvc.specificWork || 'Service Provider'}"
              </div>
              <div style="font-size:11px;color:var(--text-muted)">
                📍 ${w.location || 'Local Area'} · ${w.experience || 0} yrs exp
              </div>
            </div>

            <div style="text-align:right">
              <div style="font-weight:900;font-size:var(--text-base);color:var(--primary-light)">
                ${Utils.formatPrice(specificSvc.basePrice)}
              </div>
              <div style="font-size:9px;color:var(--text-muted)">Base Rate</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <button class="btn btn-ghost btn-full" onclick="closeModal('service-modal')" style="color:var(--text-muted)">
      Close
    </button>
  `;

  openModal('service-modal');
}

// ── Nearby Workers Listing ───────────────────────────────────────────
function renderNearbyWorkers() {
  const mainStrip = document.getElementById('workers-strip-main');
  const sideStrip = document.getElementById('workers-strip-side');

  if (CustomerState.workers.length === 0) {
    const emptyHtml = `
      <div style="padding:28px 20px;text-align:center;background:var(--bg-glass);border:1px dashed var(--border-card);border-radius:16px;color:var(--text-muted);font-size:12px;width:100%">
        <div style="font-size:26px;margin-bottom:6px">📍</div>
        <div style="font-weight:700;color:#fff;margin-bottom:4px">No verified professionals available yet.</div>
        <div>Workers will appear here once approved by Admin.</div>
      </div>
    `;
    if (mainStrip) mainStrip.innerHTML = emptyHtml;
    if (sideStrip) sideStrip.innerHTML = emptyHtml;
    return;
  }

  if (mainStrip) {
    mainStrip.innerHTML = CustomerState.workers.map(w => {
      const firstSvc = w.services && w.services[0] ? w.services[0] : { category: 'Service', basePrice: 0 };
      return `
        <div class="worker-card-mini" onclick="viewWorkerProfile('${w.id}')" role="button" tabindex="0" style="min-width:150px;cursor:pointer">
          <div class="wm-avatar-wrap">
            <div class="wm-avatar">${Utils.getInitials(w.name)}</div>
            <span class="wm-online"></span>
          </div>
          <div class="wm-name" style="font-weight:800">${w.name}</div>
          <div class="wm-role">${firstSvc.category}</div>
          <div class="wm-price">${Utils.formatPrice(firstSvc.basePrice)}</div>
        </div>
      `;
    }).join('');
  }

  if (sideStrip) {
    sideStrip.innerHTML = CustomerState.workers.map(w => {
      const firstSvc = w.services && w.services[0] ? w.services[0] : { category: 'Service', basePrice: 0 };
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg-glass);border:1px solid var(--border-card);border-radius:var(--radius-lg);cursor:pointer"
          onclick="viewWorkerProfile('${w.id}')">
          <div class="wm-avatar" style="width:40px;height:40px;font-size:14px">${Utils.getInitials(w.name)}</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:var(--text-xs);color:var(--text-primary)">${w.name}</div>
            <div style="font-size:11px;color:var(--text-muted)">${firstSvc.category} · ${w.experience || 0}y exp</div>
          </div>
          <div style="font-size:var(--text-xs);font-weight:800;color:var(--primary-light)">${Utils.formatPrice(firstSvc.basePrice)}</div>
        </div>
      `;
    }).join('');
  }
}

// ── Worker Profile View & Manual Price Negotiation ───────────────────
window.viewWorkerProfile = function(workerId, prefillProblem, preferredCategory) {
  const worker = CustomerState.workers.find(w => w.id === workerId);
  if (!worker) return;

  const inner = document.getElementById('worker-modal-inner');
  if (!inner) return;

  const services = worker.services || [];

  // Determine initial selected service (match voice AI result if applicable)
  const targetCategory = preferredCategory || (typeof VoiceAI !== 'undefined' && VoiceAI.lastResult ? VoiceAI.lastResult.serviceCategory : null);
  let selectedIdx = 0;
  if (targetCategory && services.length > 0) {
    const foundIdx = services.findIndex(s => 
      s.category.toLowerCase().includes(targetCategory.toLowerCase()) || 
      targetCategory.toLowerCase().includes(s.category.toLowerCase())
    );
    if (foundIdx >= 0) selectedIdx = foundIdx;
  }

  const primaryService = services[selectedIdx] || services[0] || { category: 'Home Services', specificWork: 'Service Provider', basePrice: 300 };

  const defaultNote = prefillProblem !== undefined 
    ? prefillProblem 
    : (typeof VoiceAI !== 'undefined' && VoiceAI.lastResult ? `${VoiceAI.lastResult.problem || ''}${VoiceAI.lastResult.houseLocation ? ' (' + VoiceAI.lastResult.houseLocation + ')' : ''}`.trim() : '');

  const noteSafe = (defaultNote || '').replace(/"/g, '&quot;');

  inner.innerHTML = `
    <div class="modal-handle"></div>

    <div style="text-align:center;margin-bottom:var(--space-xl)">
      <div class="wm-avatar" style="width:72px;height:72px;font-size:26px;margin:0 auto 12px;background:var(--gradient-primary)">
        ${Utils.getInitials(worker.name)}
      </div>

      <div class="badge badge-success" style="margin-bottom:6px;display:inline-flex;align-items:center;gap:4px">
        <i class="fa-solid fa-circle-check"></i> Verified Local Professional
      </div>

      <h3 style="font-size:var(--text-2xl);font-weight:800;color:var(--text-primary);margin-bottom:2px">${worker.name}</h3>
      <div style="font-size:12px;color:var(--text-muted)">
        📍 ${worker.location || 'Local Area'} · ${worker.experience || 0} years experience
      </div>
      ${worker.bio ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:6px;font-style:italic">"${worker.bio}"</div>` : ''}
    </div>

    <!-- Services Offered -->
    <div style="margin-bottom:var(--space-md)">
      <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);display:block;margin-bottom:8px">
        Select Service to Request
      </label>
      <div id="worker-service-selector">
        ${services.map((svc, idx) => {
          const isSel = idx === selectedIdx;
          return `
          <div class="worker-service-option ${isSel ? 'selected' : ''}" data-idx="${idx}"
            onclick="selectServiceForOffer(${idx}, ${svc.basePrice}, '${svc.category}', '${encodeURIComponent(svc.specificWork)}', this)"
            style="padding:12px;background:${isSel ? 'rgba(255,107,0,0.12)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isSel ? 'var(--primary)' : 'var(--border-card)'};border-radius:12px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:800;font-size:13px;color:#fff">${svc.category}</div>
              <div style="font-size:12px;color:var(--text-secondary)">"${svc.specificWork}"</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:900;color:var(--primary-light);font-size:14px">${Utils.formatPrice(svc.basePrice)}</div>
              <div style="font-size:9px;color:var(--text-muted)">Base Rate</div>
            </div>
          </div>
        `}).join('')}
      </div>
    </div>

    <!-- Manual Price Offer Box (Strictly Manual — No Preset Chips) -->
    <div style="padding:16px;background:linear-gradient(135deg,rgba(255,107,0,0.08),rgba(232,184,75,0.05));border:1px solid rgba(255,107,0,0.3);border-radius:var(--radius-xl);margin-bottom:var(--space-md)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--primary);text-transform:uppercase">Worker Base Starting Price</div>
          <div id="selected-service-base-price" style="font-size:var(--text-2xl);font-weight:900;color:var(--primary-light)">
            ${Utils.formatPrice(primaryService.basePrice)}
          </div>
        </div>
      </div>

      <div style="margin-top:10px">
        <label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:6px">
          Your Offer (₹):
        </label>
        <input type="number" id="custom-offer-input" placeholder="Enter your offer in ₹" value="${primaryService.basePrice}"
          style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,107,0,0.4);border-radius:12px;padding:12px 14px;color:#fff;font-weight:800;font-size:18px;margin-bottom:10px" />

        <label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:6px">
          Optional Message / Problem Description:
        </label>
        <input type="text" id="offer-note-input" placeholder="e.g. Need repair urgently today" value="${noteSafe}"
          style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 14px;color:#fff;font-size:12px" />
      </div>
    </div>

    <input type="hidden" id="selected-offer-category" value="${primaryService.category}" />
    <input type="hidden" id="selected-offer-specific" value="${primaryService.specificWork}" />
    <input type="hidden" id="selected-offer-base" value="${primaryService.basePrice}" />

    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
      <button class="btn btn-ghost" onclick="closeModal('worker-modal')">Cancel</button>
      <button class="btn btn-primary" onclick="submitCustomerOffer('${worker.id}')">
        🤝 Send Offer
      </button>
    </div>
  `;

  openModal('worker-modal');
};

window.selectServiceForOffer = function(idx, basePrice, category, specificWorkEncoded, el) {
  document.querySelectorAll('.worker-service-option').forEach(opt => {
    opt.style.background = 'rgba(255,255,255,0.03)';
    opt.style.borderColor = 'var(--border-card)';
  });
  if (el) {
    el.style.background = 'rgba(255,107,0,0.12)';
    el.style.borderColor = 'var(--primary)';
  }

  const basePriceEl = document.getElementById('selected-service-base-price');
  if (basePriceEl) basePriceEl.textContent = Utils.formatPrice(basePrice);

  const offerInput = document.getElementById('custom-offer-input');
  if (offerInput) offerInput.value = basePrice;

  document.getElementById('selected-offer-category').value = category;
  document.getElementById('selected-offer-specific').value = decodeURIComponent(specificWorkEncoded);
  document.getElementById('selected-offer-base').value = basePrice;
};

window.submitCustomerOffer = async function(workerId) {
  const offerAmount = Number(document.getElementById('custom-offer-input')?.value);
  const note        = document.getElementById('offer-note-input')?.value?.trim() || '';
  const category    = document.getElementById('selected-offer-category')?.value || 'General';
  const specificWork= document.getElementById('selected-offer-specific')?.value || '';
  const basePrice   = Number(document.getElementById('selected-offer-base')?.value || offerAmount);

  if (!offerAmount || isNaN(offerAmount) || offerAmount <= 0) {
    showToast('Invalid Amount', 'Please enter your offer amount in ₹', 'danger');
    return;
  }

  closeModal('worker-modal');
  const user = StateManager.getUser();

  try {
    const req = await API.createRequest({
      customerId:      user.id,
      customerName:    user.name,
      workerId:        workerId,
      serviceCategory: category,
      specificWork:    specificWork,
      basePrice:       basePrice,
      offer:           offerAmount,
      message:         note,
      problem:         note || specificWork || 'Service Request',
    });

    showToast('🤝 Offer Sent!', `Sent ${Utils.formatPrice(offerAmount)} offer to worker`, 'success');
    await loadCustomerDataFromServer();
    openNegotiationModal(req.id);
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

// ── Customer Negotiation Modal ───────────────────────────────────────
window.openNegotiationModal = async function(reqId) {
  const req = CustomerState.requests.find(r => r.id === reqId) || CustomerState.requests[0];
  if (!req) return;

  const inner = document.getElementById('negotiation-modal-inner');
  if (!inner) return;

  renderCustomerNegotiationModal(req, inner);
  openModal('negotiation-modal');
};

function renderCustomerNegotiationModal(req, inner) {
  const worker = CustomerState.workers.find(w => w.id === req.workerId);
  const workerName = worker ? worker.name : 'Assigned Worker';

  const statusObj = Utils.statusLabel(req.status);

  inner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);padding-bottom:12px;border-bottom:1px solid var(--border-subtle)">
      <div>
        <div style="font-weight:800;font-size:var(--text-base);color:var(--text-primary)">${workerName}</div>
        <div style="font-size:11px;color:var(--text-muted)">
          ${req.serviceCategory} · ${req.specificWork ? `"${req.specificWork}" · ` : ''}Base: ${Utils.formatPrice(req.basePrice)}
        </div>
      </div>
      <button class="btn-icon" onclick="closeModal('negotiation-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <!-- Status Strip -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.25);border-radius:12px;margin-bottom:14px">
      <span class="badge ${statusObj.cls}">${statusObj.text}</span>
      <div style="text-align:right">
        <div style="font-weight:900;font-size:var(--text-lg);color:var(--primary-light)">
          ${Utils.formatPrice(req.finalPrice || req.workerCounter || req.offer)}
        </div>
        <div style="font-size:10px;color:var(--text-muted)">
          ${req.finalPrice ? 'Agreed Price' : req.workerCounter ? 'Worker Counter' : 'Your Offer'}
        </div>
      </div>
    </div>

    <!-- Request Details / Problem Note -->
    ${req.problem ? `
      <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;margin-bottom:12px;font-size:12px;color:var(--text-secondary)">
        <strong style="color:var(--text-primary)">Problem:</strong> "${req.problem}"
      </div>
    ` : ''}

    <!-- Worker Counter Offer Action Box -->
    ${req.status === 'countered' ? `
      <div style="background:linear-gradient(135deg,rgba(234,179,8,0.12),rgba(255,107,0,0.08));border:1px solid rgba(234,179,8,0.3);border-radius:14px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--warning);text-transform:uppercase;margin-bottom:4px">
          🔔 Worker Countered
        </div>
        <div style="font-size:13px;color:#fff;margin-bottom:8px">
          The worker countered with <strong style="font-size:16px;color:var(--primary-light)">${Utils.formatPrice(req.workerCounter)}</strong>
          ${req.lastMessage ? `<br/><span style="font-size:11px;color:var(--text-muted);font-style:italic">"${req.lastMessage}"</span>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn btn-success btn-sm" onclick="customerAcceptCounter('${req.id}', ${req.workerCounter})">
            ✓ Accept ${Utils.formatPrice(req.workerCounter)}
          </button>
          <button class="btn btn-ghost btn-sm" onclick="toggleCustomerCounterForm()">
            ✏️ Counter Again
          </button>
        </div>

        <div id="customer-counter-form" style="display:none;margin-top:12px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.1)">
          <label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px">Enter Your Counter Offer (₹):</label>
          <input type="number" id="cust-new-counter-val" placeholder="Enter amount in ₹"
            style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,107,0,0.4);border-radius:8px;padding:8px 10px;color:#fff;font-weight:800;margin-bottom:8px" />
          <button class="btn btn-primary btn-full btn-sm" onclick="customerSendCounter('${req.id}')">Send Counter Offer</button>
        </div>
      </div>
    ` : ''}

    ${req.status === 'accepted' ? `
      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:12px;padding:12px;text-align:center;margin-bottom:14px">
        <div style="font-size:14px;font-weight:800;color:#22C55E">🎉 Booking Confirmed at ${Utils.formatPrice(req.finalPrice)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          ${req.jobStatus === 'on_the_way' ? '🚀 Worker is on the way!' : req.jobStatus === 'in_progress' ? '🔧 Work is in progress' : req.jobStatus === 'completed' ? '✅ Work completed' : 'Worker accepted your deal'}
        </div>
      </div>
    ` : ''}

    <button class="btn btn-ghost btn-full btn-sm" onclick="closeModal('negotiation-modal')">Close</button>
  `;
}

window.customerAcceptCounter = async function(reqId, amount) {
  try {
    await API.negotiate(reqId, {
      action: 'customer_accept',
      counterAmount: amount,
      message: 'Customer accepted worker counter offer.'
    });
    showToast('🎉 Deal Agreed!', `Price locked at ${Utils.formatPrice(amount)}`, 'success');
    await loadCustomerDataFromServer();
    openNegotiationModal(reqId);
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

window.toggleCustomerCounterForm = function() {
  const form = document.getElementById('customer-counter-form');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.customerSendCounter = async function(reqId) {
  const amount = Number(document.getElementById('cust-new-counter-val')?.value);
  if (!amount || isNaN(amount) || amount <= 0) {
    showToast('Invalid Amount', 'Please enter your counter offer amount in ₹', 'danger');
    return;
  }

  try {
    await API.negotiate(reqId, {
      action: 'customer_counter',
      counterAmount: amount,
      message: `Customer countered with ${Utils.formatPrice(amount)}`
    });
    showToast('Counter Sent', `Offered ${Utils.formatPrice(amount)}`, 'info');
    await loadCustomerDataFromServer();
    openNegotiationModal(reqId);
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
};

function renderActiveNegotiationCard() {
  const mainCol = document.getElementById('content-main-col');
  if (!mainCol) return;

  const activeReq = CustomerState.requests.find(r => ['pending', 'countered', 'accepted'].includes(r.status));
  let card = document.getElementById('home-active-neg-card');

  if (!activeReq) {
    if (card) card.remove();
    return;
  }

  if (!card) {
    card = document.createElement('div');
    card.id = 'home-active-neg-card';
    card.style.cssText = 'margin-bottom:var(--space-md)';
    mainCol.insertBefore(card, mainCol.children[1] || mainCol.firstChild);
  }

  const worker = CustomerState.workers.find(w => w.id === activeReq.workerId);
  const workerName = worker ? worker.name : 'Worker';

  card.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(255,107,0,0.12), rgba(34,197,94,0.06));border:1px solid rgba(255,107,0,0.35);border-radius:var(--radius-xl);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer"
      onclick="openNegotiationModal('${activeReq.id}')">
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--primary);text-transform:uppercase;margin-bottom:2px">
          ${activeReq.status === 'accepted' ? '🟢 Active Booking' : activeReq.status === 'countered' ? '⏳ Counter Received' : '💬 Request Pending'}
        </div>
        <div style="font-weight:800;font-size:14px;color:#fff">
          ${activeReq.serviceCategory} with ${workerName} · ${Utils.formatPrice(activeReq.finalPrice || activeReq.workerCounter || activeReq.offer)}
        </div>
      </div>
      <button class="btn btn-primary btn-sm">View Status</button>
    </div>
  `;
}

// ── Map Canvas Engine ────────────────────────────────────────────────
function initDiscoveryMap() {
  const canvas = document.getElementById('discovery-map-canvas');
  if (!canvas) return;

  CustomerState.map.canvas = canvas;
  CustomerState.map.ctx = canvas.getContext('2d');

  canvas.addEventListener('click', handleMapClick);
  window.addEventListener('resize', resizeMapCanvas);
  resizeMapCanvas();
}

function resizeMapCanvas() {
  const container = document.getElementById('map-container');
  const canvas = CustomerState.map.canvas;
  if (!container || !canvas) return;

  const rect = container.getBoundingClientRect();
  canvas.width = rect.width * (window.devicePixelRatio || 1);
  canvas.height = (rect.height || 360) * (window.devicePixelRatio || 1);

  updateMapPins();
  drawDiscoveryMap();
}

function updateMapPins() {
  let filtered = CustomerState.workers;
  if (CustomerState.activeMapFilter !== 'all') {
    filtered = filtered.filter(w =>
      (w.services || []).some(s => s.category.toLowerCase().includes(CustomerState.activeMapFilter.toLowerCase()))
    );
  }

  CustomerState.map.workerPins = filtered.map((w, i) => {
    const angle = (i / Math.max(1, filtered.length)) * Math.PI * 2 + 0.4;
    const r = 0.22 + (i % 3) * 0.08;
    return {
      id: w.id,
      worker: w,
      relX: 0.5 + Math.cos(angle) * r,
      relY: 0.5 + Math.sin(angle) * r,
    };
  });
}

function drawDiscoveryMap() {
  const { canvas, ctx, zoom, selectedPinId } = CustomerState.map;
  if (!canvas || !ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;

  ctx.clearRect(0, 0, width, height);

  // Background grid
  ctx.fillStyle = '#0B0D12';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const step = 40 * zoom;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Radar range ring around user
  ctx.strokeStyle = 'rgba(255, 107, 0, 0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 120 * zoom, 0, Math.PI * 2);
  ctx.stroke();

  // User Dot
  ctx.fillStyle = '#FF6B00';
  ctx.beginPath();
  ctx.arc(cx, cy, 9 * zoom, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('YOU ARE HERE', cx, cy - 14 * zoom);

  // Empty state if no pins
  if (CustomerState.map.workerPins.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No verified professionals nearby yet.', cx, cy + 50 * zoom);
  }

  // Render Worker Pins
  CustomerState.map.workerPins.forEach(pin => {
    const px = cx + (pin.relX - 0.5) * width * zoom;
    const py = cy + (pin.relY - 0.5) * height * zoom;
    pin.px = px;
    pin.py = py;

    const isSelected = selectedPinId === pin.id;

    // Pin circle
    ctx.fillStyle = isSelected ? '#FF6B00' : 'rgba(255, 107, 0, 0.7)';
    ctx.beginPath();
    ctx.arc(px, py, (isSelected ? 16 : 12) * zoom, 0, Math.PI * 2);
    ctx.fill();

    // Pin border
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pin text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pin.worker.name, px, py - 16 * zoom);
  });

  renderMapWorkersGrid();
}

function handleMapClick(e) {
  const canvas = CustomerState.map.canvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clickX = (e.clientX - rect.left) * scaleX;
  const clickY = (e.clientY - rect.top) * scaleY;

  let clickedPin = null;
  CustomerState.map.workerPins.forEach(pin => {
    if (!pin.px || !pin.py) return;
    if (Math.hypot(clickX - pin.px, clickY - pin.py) < 35) clickedPin = pin;
  });

  if (clickedPin) {
    CustomerState.map.selectedPinId = clickedPin.id;
    drawDiscoveryMap();
    viewWorkerProfile(clickedPin.worker.id);
  }
}

function renderMapWorkersGrid() {
  const grid = document.getElementById('map-workers-list-grid');
  if (!grid) return;

  if (CustomerState.workers.length === 0) {
    grid.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;grid-column:1/-1;background:var(--bg-glass);border:1px dashed var(--border-card);border-radius:14px">
        No verified professionals nearby yet. Approved workers will appear on the map dynamically.
      </div>
    `;
    return;
  }

  grid.innerHTML = CustomerState.workers.map(w => {
    const s = w.services && w.services[0] ? w.services[0] : { category: 'Service', basePrice: 0 };
    return `
      <div style="padding:12px;background:var(--bg-glass);border:1px solid var(--border-card);border-radius:var(--radius-xl);cursor:pointer;display:flex;align-items:center;gap:10px"
        onclick="viewWorkerProfile('${w.id}')">
        <div class="wm-avatar" style="width:36px;height:36px;font-size:12px">${Utils.getInitials(w.name)}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:13px;color:#fff">${w.name}</div>
          <div style="font-size:11px;color:var(--primary-light)">${s.category} · ${Utils.formatPrice(s.basePrice)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Map Controls
window.setMapFilter = function(category, chipEl) {
  CustomerState.activeMapFilter = category;
  document.querySelectorAll('#map-category-bar .map-cat-chip').forEach(c => c.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');
  updateMapPins();
  drawDiscoveryMap();
};

window.zoomMap = function(factor) {
  CustomerState.map.zoom = Math.max(0.5, Math.min(2.5, CustomerState.map.zoom * factor));
  drawDiscoveryMap();
};

window.resetMapCenter = function() {
  CustomerState.map.zoom = 1.0;
  CustomerState.map.selectedPinId = null;
  drawDiscoveryMap();
};

window.recenterMap = window.resetMapCenter;

// ── Bookings Tab ─────────────────────────────────────────────────────
function renderBookingsTab() {
  const activeContainer = document.getElementById('user-active-bookings-list');
  const pastContainer   = document.getElementById('user-past-bookings-list');

  if (!activeContainer || !pastContainer) return;

  const active = CustomerState.requests.filter(r => !['completed', 'declined', 'cancelled'].includes(r.status));
  const past   = CustomerState.requests.filter(r => ['completed', 'declined', 'cancelled'].includes(r.status));

  activeContainer.innerHTML = active.length === 0 ? `
    <div style="padding:36px 20px;text-align:center;color:var(--text-muted);font-size:12px;background:var(--bg-glass);border:1px dashed var(--border-card);border-radius:18px">
      <div style="font-size:32px;margin-bottom:8px">📋</div>
      <div style="font-weight:700;color:#fff;font-size:14px">No active requests or bookings</div>
      <div style="margin-top:4px">Discover verified workers or use AI Voice Booking to send a service request.</div>
    </div>
  ` : active.map(r => {
    const worker = CustomerState.workers.find(w => w.id === r.workerId);
    const workerName = worker ? worker.name : 'Assigned Worker';
    const statusObj = Utils.statusLabel(r.status);

    return `
      <div style="background:var(--bg-glass);border:1px solid rgba(255,107,0,0.3);border-radius:16px;padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span class="badge ${statusObj.cls}">${statusObj.text}</span>
          <span style="font-size:11px;color:var(--text-muted)">${Utils.timeAgo(r.updatedAt || r.createdAt)}</span>
        </div>
        <div style="font-weight:800;font-size:15px;color:#fff">${workerName}</div>
        <div style="font-size:12px;color:var(--text-secondary)">${r.serviceCategory} · ${r.specificWork ? `"${r.specificWork}"` : 'Service Request'}</div>
        <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:10px;color:var(--text-muted)">${r.finalPrice ? 'Agreed Price' : 'Current Offer'}</div>
            <div style="font-weight:900;font-size:16px;color:var(--primary-light)">
              ${Utils.formatPrice(r.finalPrice || r.workerCounter || r.offer)}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openNegotiationModal('${r.id}')">
            View Details & Chat
          </button>
        </div>
      </div>
    `;
  }).join('');

  pastContainer.innerHTML = past.length === 0 ? `
    <div style="padding:20px;text-align:center;font-size:12px;color:var(--text-muted);background:rgba(255,255,255,0.02);border-radius:12px">
      No past bookings recorded yet.
    </div>
  ` : past.map(r => {
    const worker = CustomerState.workers.find(w => w.id === r.workerId);
    const workerName = worker ? worker.name : 'Worker';

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--bg-glass);border:1px solid var(--border-card);border-radius:12px;margin-bottom:8px">
        <div>
          <div style="font-weight:700;font-size:13px;color:#fff">${workerName}</div>
          <div style="font-size:11px;color:var(--text-muted)">${r.serviceCategory} · ${Utils.timeAgo(r.updatedAt || r.createdAt)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:800;font-size:13px;color:${r.status === 'completed' ? 'var(--success)' : 'var(--danger)'}">
            ${Utils.formatPrice(r.finalPrice || r.offer)}
          </div>
          <span class="badge ${r.status === 'completed' ? 'badge-success' : 'badge-danger'}" style="font-size:9px">
            ${r.status}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// ── Profile Tab ──────────────────────────────────────────────────────
function renderUserProfileTab() {
  const container = document.getElementById('user-profile-card');
  if (!container) return;

  const session = Session.get();
  const name = session ? session.name : 'Customer';

  container.innerHTML = `
    <div style="background:var(--bg-glass);border:1px solid var(--border-card);border-radius:24px;padding:24px;text-align:center;backdrop-filter:blur(16px);position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--gradient-primary)"></div>
      <div class="avatar" style="width:72px;height:72px;font-size:26px;margin:0 auto 12px;background:var(--gradient-primary)">
        ${Utils.getInitials(name)}
      </div>
      <h2 style="font-size:22px;font-weight:800;color:#fff;margin-bottom:2px">${name}</h2>
      <div style="font-size:12px;color:var(--primary-light);font-weight:600;margin-bottom:12px">👤 Customer Account</div>
      <div style="display:inline-block;padding:4px 12px;background:rgba(255,255,255,0.05);border-radius:12px;font-size:11px;color:var(--text-muted)">
        📍 Connaught Place, New Delhi · Active Demo Session
      </div>
    </div>
  `;
}

// ── Global Search ─────────────────────────────────────────────────────
function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  if (!input) return;

  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      const overlay = document.getElementById('search-results-overlay');
      if (overlay) overlay.classList.remove('open');
    });
  }

  input.addEventListener('input', Utils.debounce(e => {
    const q = e.target.value.trim().toLowerCase();
    const overlay = document.getElementById('search-results-overlay');
    if (!q) {
      if (overlay) overlay.classList.remove('open');
      return;
    }

    const svcContainer = document.getElementById('search-services-results');
    const wrkContainer = document.getElementById('search-workers-results');
    if (!overlay || !svcContainer || !wrkContainer) return;

    const matchedServices = MockData.services.filter(s =>
      s.name.toLowerCase().includes(q)
    );

    const matchedWorkers = CustomerState.workers.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.services || []).some(s =>
        s.category.toLowerCase().includes(q) ||
        (s.specificWork || '').toLowerCase().includes(q)
      )
    );

    svcContainer.innerHTML = matchedServices.length === 0 ? `
      <div style="font-size:11px;color:var(--text-muted);padding:8px">No matching categories</div>
    ` : matchedServices.map(svc => `
      <div class="service-chip" onclick="selectServiceCategory('${svc.name}');document.getElementById('search-results-overlay').classList.remove('open')">
        <span class="service-chip-emoji">${svc.emoji}</span>
        <div class="service-chip-name">${svc.name}</div>
      </div>
    `).join('');

    wrkContainer.innerHTML = matchedWorkers.length === 0 ? `
      <div style="font-size:11px;color:var(--text-muted);padding:8px">No matching verified workers found</div>
    ` : matchedWorkers.map(w => {
      const s = w.services && w.services[0] ? w.services[0] : {};
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-glass);border:1px solid var(--border-card);border-radius:12px;cursor:pointer"
          onclick="viewWorkerProfile('${w.id}');document.getElementById('search-results-overlay').classList.remove('open')">
          <div class="wm-avatar">${Utils.getInitials(w.name)}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:13px;color:#fff">${w.name}</div>
            <div style="font-size:11px;color:var(--text-muted)">${s.category || 'Service'} · "${s.specificWork || ''}"</div>
          </div>
          <div style="font-weight:800;color:var(--primary-light);font-size:13px">${Utils.formatPrice(s.basePrice)}</div>
        </div>
      `;
    }).join('');

    overlay.classList.add('open');
  }, 200));
}

// ── Tab Switching & Animation ─────────────────────────────────────────
window.switchTab = function(tabId, navBtnEl) {
  CustomerState.currentTab = tabId;
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${tabId}`);
  if (target) target.classList.add('active');

  // Update nav active states
  document.querySelectorAll('.bottom-nav .nav-item, .sidebar-nav-item').forEach(btn => {
    if (btn.dataset.tab === tabId) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  const titles = { home: 'Home', discover: 'Discover Map', bookings: 'My Bookings', profile: 'My Profile' };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = titles[tabId] || 'Home';

  if (tabId === 'discover') {
    setTimeout(resizeMapCanvas, 60);
  }
};

function animatePageEntrance() {
  const elements = document.querySelectorAll('.service-chip, .worker-card-mini');
  elements.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    setTimeout(() => {
      el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, i * 30);
  });
}
