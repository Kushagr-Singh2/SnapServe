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
  currentLocation: localStorage.getItem('snapserve_user_loc') || 'Select Location',
  coords: (() => {
    try {
      const saved = localStorage.getItem('snapserve_user_coords');
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  })(),
  workers: [],
  requests: [],
  osmMap: null,
  userMarker: null,
  workerMarkers: [],
  map: {
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

  initLocationService();
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

    if (CustomerState.osmMap) {
      updateOpenStreetMap();
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
  
  const curLoc = CustomerState.currentLocation || localStorage.getItem('snapserve_user_loc') || 'Select Location';
  if (subEl)  subEl.innerHTML = `<i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:10px"></i> <span id="greeting-user-loc">${curLoc}</span> <i class="fa-solid fa-chevron-down" style="font-size:8px;opacity:0.6;margin-left:2px"></i>`;

  const sbName = document.getElementById('sidebar-user-name');
  if (sbName) sbName.textContent = user.name;
  const sbLoc = document.getElementById('sidebar-user-loc');
  if (sbLoc) sbLoc.textContent = curLoc;
  const topLoc = document.getElementById('location-text');
  if (topLoc) topLoc.textContent = curLoc;
}

// ── Location Management & Geolocation (100% Free OpenStreetMap) ──────
window.initLocationService = function() {
  const saved = localStorage.getItem('snapserve_user_loc');
  if (saved && saved !== 'Select Location') {
    CustomerState.currentLocation = saved;
    updateLocationUI(saved, CustomerState.coords);
  } else {
    CustomerState.currentLocation = 'Select Location';
    updateLocationUI('Select Location');
    // Prompt browser for GPS location
    detectCurrentLocation(false);
  }
};

function getPresetCoords(locName) {
  if (!locName) return null;
  const presets = {
    'Connaught Place, New Delhi': { lat: 28.6315, lon: 77.2167 },
    'South Extension, New Delhi': { lat: 28.5684, lon: 77.2215 },
    'Noida Sector 62, NCR':       { lat: 28.6270, lon: 77.3623 },
    'Cyber City, Gurugram':       { lat: 28.4950, lon: 77.0895 },
    'Koramangala, Bengaluru':     { lat: 12.9352, lon: 77.6245 },
    'Bandra West, Mumbai':        { lat: 19.0596, lon: 72.8295 },
    'Hitec City, Hyderabad':      { lat: 17.4474, lon: 78.3762 },
    'Kothrud, Pune':              { lat: 18.5074, lon: 73.8077 },
  };
  return presets[locName] || null;
}

function updateLocationUI(locName, coords = null) {
  CustomerState.currentLocation = locName;
  if (coords) {
    CustomerState.coords = coords;
  } else if (getPresetCoords(locName)) {
    CustomerState.coords = getPresetCoords(locName);
  }

  const locText = document.getElementById('location-text');
  if (locText) locText.textContent = locName;

  const sideLoc = document.getElementById('sidebar-user-loc');
  if (sideLoc) sideLoc.textContent = locName;

  const greetLoc = document.getElementById('greeting-user-loc');
  if (greetLoc) greetLoc.textContent = locName;

  if (CustomerState.osmMap) {
    const targetCoords = CustomerState.coords || { lat: 28.6139, lon: 77.2090 };
    CustomerState.osmMap.setView([targetCoords.lat, targetCoords.lon], 14);
    updateOpenStreetMap();
  }
}

window.openLocationModal = function() {
  const modal = document.getElementById('location-modal');
  if (modal) modal.classList.add('open');
};

window.closeLocationModal = function() {
  const modal = document.getElementById('location-modal');
  if (modal) modal.classList.remove('open');
};

window.selectPresetLocation = function(locName) {
  const coords = getPresetCoords(locName);
  localStorage.setItem('snapserve_user_loc', locName);
  if (coords) localStorage.setItem('snapserve_user_coords', JSON.stringify(coords));
  updateLocationUI(locName, coords);
  closeLocationModal();
  if (window.showToast) showToast('Location Updated', `Set to ${locName}`, 'success');
};

window.applyManualLocation = async function() {
  const input = document.getElementById('manual-loc-input');
  if (!input || !input.value.trim()) return;
  const query = input.value.trim();

  closeLocationModal();
  input.value = '';
  if (window.showToast) showToast('Locating...', query, 'info');

  try {
    // 100% Free OpenStreetMap Nominatim Search API
    const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
    const res = await fetch(osmUrl, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const results = await res.json();
      if (results && results.length > 0) {
        const first = results[0];
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);
        const locName = first.display_name.split(',').slice(0, 2).join(',').trim();
        localStorage.setItem('snapserve_user_loc', locName);
        localStorage.setItem('snapserve_user_coords', JSON.stringify({ lat, lon }));
        updateLocationUI(locName, { lat, lon });
        if (window.showToast) showToast('Location Set', locName, 'success');
        return;
      }
    }
  } catch (e) {
    console.warn('OSM search error:', e);
  }

  // Fallback if network search is blocked
  localStorage.setItem('snapserve_user_loc', query);
  updateLocationUI(query);
  if (window.showToast) showToast('Location Set', query, 'success');
};

window.detectCurrentLocation = function(userTriggered = false) {
  const btn = document.getElementById('btn-detect-loc');
  if (userTriggered && btn) {
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Detecting GPS...`;
    btn.disabled = true;
  }

  if (!navigator.geolocation) {
    if (userTriggered) {
      alert('Geolocation is not supported by your browser. Please select or type your location.');
      if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> Use Current Location (GPS)`;
        btn.disabled = false;
      }
    }
    updateLocationUI('Select Location');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const coords = { lat: latitude, lon: longitude };
      CustomerState.coords = coords;
      localStorage.setItem('snapserve_user_coords', JSON.stringify(coords));

      try {
        const locName = await reverseGeocode(latitude, longitude);
        localStorage.setItem('snapserve_user_loc', locName);
        updateLocationUI(locName, coords);
        if (userTriggered) {
          closeLocationModal();
          if (window.showToast) showToast('Location Detected', locName, 'success');
        }
      } catch (err) {
        console.warn('Reverse geocode error:', err);
        const fallbackName = `Lat: ${latitude.toFixed(2)}, Lon: ${longitude.toFixed(2)}`;
        localStorage.setItem('snapserve_user_loc', fallbackName);
        updateLocationUI(fallbackName, coords);
        if (userTriggered) closeLocationModal();
      } finally {
        if (btn) {
          btn.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> Use Current Location (GPS)`;
          btn.disabled = false;
        }
      }
    },
    (error) => {
      console.warn('Geolocation denied or failed:', error.code, error.message);
      if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> Use Current Location (GPS)`;
        btn.disabled = false;
      }
      const saved = localStorage.getItem('snapserve_user_loc');
      if (!saved || saved === 'Select Location') {
        updateLocationUI('Select Location');
      }
      if (userTriggered) {
        alert('Location access was not allowed. You can select your city or type your area below.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
};

async function reverseGeocode(lat, lon) {
  // 1. Free client-side reverse geocoding via BigDataCloud (instant, high accuracy)
  try {
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(bdcUrl);
    if (res.ok) {
      const data = await res.json();
      const area = data.locality || data.principalSubdivision;
      const city = data.city || data.principalSubdivision || data.countryName;
      if (area && city && area !== city) return `${area}, ${city}`;
      if (area) return area;
      if (city) return city;
    }
  } catch (e) {
    console.warn('BigDataCloud geocode error:', e);
  }

  // 2. OpenStreetMap Nominatim Reverse Geocoding (100% Free & Open Source)
  try {
    const osmUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
    const res = await fetch(osmUrl, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const sub = addr.suburb || addr.neighbourhood || addr.residential || addr.subdistrict;
      const city = addr.city || addr.town || addr.state_district || addr.state;
      if (sub && city) return `${sub}, ${city}`;
      if (sub) return sub;
      if (city) return city;
      if (data.display_name) return data.display_name.split(',').slice(0, 2).join(',').trim();
    }
  } catch (e) {
    console.warn('Nominatim geocode error:', e);
  }

  return `Current Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
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

// ── Free OpenStreetMap Leaflet Engine ────────────────────────────────
function initDiscoveryMap() {
  const mapDiv = document.getElementById('osm-map');
  if (!mapDiv || typeof L === 'undefined') return;

  const coords = CustomerState.coords || getPresetCoords(CustomerState.currentLocation) || { lat: 28.6139, lon: 77.2090 };

  if (!CustomerState.osmMap) {
    CustomerState.osmMap = L.map('osm-map', {
      center: [coords.lat, coords.lon],
      zoom: 14,
      zoomControl: false
    });

    // 100% Free OpenStreetMap Dark Matter Tiles (Powered by CartoDB / OSM)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(CustomerState.osmMap);

    // Clicking on map outside pins dismisses preview
    CustomerState.osmMap.on('click', () => {
      const preview = document.getElementById('map-worker-preview');
      if (preview) preview.style.display = 'none';
    });
  } else {
    CustomerState.osmMap.setView([coords.lat, coords.lon], 14);
  }

  updateOpenStreetMap();
}

function updateOpenStreetMap() {
  if (!CustomerState.osmMap || typeof L === 'undefined') return;

  const coords = CustomerState.coords || getPresetCoords(CustomerState.currentLocation) || { lat: 28.6139, lon: 77.2090 };

  // 1. Update or create User Pulse Marker
  const userPinHtml = `
    <div class="osm-user-pin-wrap">
      <div class="osm-user-pulse"></div>
      <div class="osm-user-dot"><i class="fa-solid fa-location-arrow"></i></div>
    </div>
  `;
  const userIcon = L.divIcon({
    className: 'osm-user-icon-container',
    html: userPinHtml,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });

  const locLabel = (CustomerState.currentLocation && CustomerState.currentLocation !== 'Select Location')
    ? CustomerState.currentLocation
    : 'Your Location';

  if (CustomerState.userMarker) {
    CustomerState.userMarker.setLatLng([coords.lat, coords.lon]);
    CustomerState.userMarker.setPopupContent(`
      <div style="font-weight:700;font-size:12px;color:#fff;padding:2px">
        📍 ${locLabel}
      </div>
    `);
  } else {
    CustomerState.userMarker = L.marker([coords.lat, coords.lon], { icon: userIcon, zIndexOffset: 1000 })
      .addTo(CustomerState.osmMap)
      .bindPopup(`
        <div style="font-weight:700;font-size:12px;color:#fff;padding:2px">
          📍 ${locLabel}
        </div>
      `, { className: 'snapserve-map-popup' });
  }

  // 2. Clear previous worker markers
  if (CustomerState.workerMarkers && CustomerState.workerMarkers.length) {
    CustomerState.workerMarkers.forEach(m => m.remove());
  }
  CustomerState.workerMarkers = [];

  // 3. Filter workers
  let filtered = CustomerState.workers || [];
  if (CustomerState.activeMapFilter !== 'all') {
    filtered = filtered.filter(w =>
      (w.services || []).some(s => s.category.toLowerCase().includes(CustomerState.activeMapFilter.toLowerCase()))
    );
  }

  // 4. Place worker markers
  const emojiMap = {
    electrical: '⚡',
    plumbing: '💧',
    ac: '❄️',
    cleaning: '🧹',
    carpentry: '🪚',
    painting: '🎨',
    appliance: '🔌'
  };

  filtered.forEach((w, i) => {
    const s = w.services && w.services[0] ? w.services[0] : { category: 'Service', basePrice: 499 };
    const catLower = (s.category || '').toLowerCase();
    let catEmoji = '🛠️';
    for (const [k, v] of Object.entries(emojiMap)) {
      if (catLower.includes(k)) { catEmoji = v; break; }
    }

    // Geographically scatter workers around user coordinates (approx 400m - 2.5km)
    const angle = (i / Math.max(1, filtered.length)) * Math.PI * 2 + 0.45;
    const radius = 0.005 + ((i % 4) * 0.004);
    const workerLat = coords.lat + Math.sin(angle) * radius;
    const workerLon = coords.lon + Math.cos(angle) * (radius * 1.15);

    const workerIcon = L.divIcon({
      className: 'osm-worker-pin-wrap',
      html: `
        <div class="osm-worker-pin">
          <span class="osm-worker-emoji">${catEmoji}</span>
          <span class="osm-worker-badge">${Utils.formatPrice(s.basePrice)}</span>
        </div>
      `,
      iconSize: [68, 36],
      iconAnchor: [34, 18]
    });

    const popupContent = `
      <div class="osm-popup-card">
        <div class="osm-popup-header">
          <div class="osm-popup-avatar">${Utils.getInitials(w.name)}</div>
          <div>
            <div class="osm-popup-name">${w.name} <i class="fa-solid fa-circle-check" style="color:#22c55e;font-size:10px"></i></div>
            <div class="osm-popup-sub">${s.category} · 📍 ${w.location || 'Local Area'}</div>
          </div>
        </div>
        <div class="osm-popup-pricing">
          <span>Starting at</span>
          <strong>${Utils.formatPrice(s.basePrice)}</strong>
        </div>
        <button class="btn btn-primary btn-sm osm-popup-book-btn" onclick="viewWorkerProfile('${w.id}')">
          View Profile & Book
        </button>
      </div>
    `;

    const marker = L.marker([workerLat, workerLon], { icon: workerIcon })
      .addTo(CustomerState.osmMap)
      .bindPopup(popupContent, { className: 'snapserve-map-popup', maxWidth: 260 });

    marker.on('click', () => {
      showWorkerMapPreview(w);
    });

    CustomerState.workerMarkers.push(marker);
  });

  renderMapWorkersGrid(filtered);
}

function showWorkerMapPreview(w) {
  const preview = document.getElementById('map-worker-preview');
  if (!preview) return;

  const s = w.services && w.services[0] ? w.services[0] : { category: 'Service', basePrice: 499 };
  preview.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="viewWorkerProfile('${w.id}')">
        <div class="wm-avatar" style="width:40px;height:40px;font-size:13px">${Utils.getInitials(w.name)}</div>
        <div>
          <div style="font-weight:800;font-size:14px;color:#fff">${w.name} <i class="fa-solid fa-circle-check" style="color:#22c55e;font-size:11px"></i></div>
          <div style="font-size:11px;color:var(--primary-light)">${s.category} · ${Utils.formatPrice(s.basePrice)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="viewWorkerProfile('${w.id}')" style="font-size:11px;padding:6px 12px">
          Book
        </button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('map-worker-preview').style.display='none'" style="font-size:12px;padding:6px 8px;color:var(--text-muted)">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  `;
  preview.style.display = 'block';
}

function renderMapWorkersGrid(filteredWorkers = null) {
  const grid = document.getElementById('map-workers-list-grid');
  if (!grid) return;

  const workers = filteredWorkers || CustomerState.workers || [];

  if (workers.length === 0) {
    grid.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;grid-column:1/-1;background:var(--bg-glass);border:1px dashed var(--border-card);border-radius:14px">
        No verified professionals nearby for this filter. Approved workers will appear on the map dynamically.
      </div>
    `;
    return;
  }

  grid.innerHTML = workers.map(w => {
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
  updateOpenStreetMap();
};

window.zoomMap = function(delta) {
  if (!CustomerState.osmMap) return;
  if (delta > 0) CustomerState.osmMap.zoomIn();
  else CustomerState.osmMap.zoomOut();
};

window.resetMapCenter = function() {
  if (!CustomerState.osmMap) return;
  const coords = CustomerState.coords || getPresetCoords(CustomerState.currentLocation) || { lat: 28.6139, lon: 77.2090 };
  CustomerState.osmMap.setView([coords.lat, coords.lon], 14, { animate: true });
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
      <div style="display:inline-block;padding:4px 12px;background:rgba(255,255,255,0.05);border-radius:12px;font-size:11px;color:var(--text-muted);cursor:pointer" onclick="openLocationModal()" title="Change location">
        📍 ${CustomerState.currentLocation || 'Select Location'} · Active Session
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
    setTimeout(() => {
      if (!CustomerState.osmMap) {
        initDiscoveryMap();
      } else {
        CustomerState.osmMap.invalidateSize();
      }
    }, 80);
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
