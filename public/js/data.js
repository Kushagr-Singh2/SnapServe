/* ============================================================
   SNAPSERVE — Central Data & State Management with Live Backend API
   js/data.js
   ============================================================ */

'use strict';

// ── App State ─────────────────────────────────────────────────
const AppState = {
  currentUser: null,
  currentRole: 'user', // 'user' | 'worker' | 'admin'
  activeBooking: null,
  activeNegotiation: null,
  workers: [],
  requests: [],
};

// ── Service Category Definitions (UI Metadata Only — no fake counts) ──
const MockData = {
  users: [],
  workers: [],
  bookings: [],
  messages: [],
  negotiations: [],

  services: [
    { id: 'Electrical',           name: 'Electrical',           emoji: '⚡', color: '#F59E0B' },
    { id: 'Plumbing',             name: 'Plumbing',             emoji: '💧', color: '#3B82F6' },
    { id: 'AC & Appliance Repair',name: 'AC & Appliance Repair',emoji: '❄️', color: '#06B6D4' },
    { id: 'Carpentry',            name: 'Carpentry',            emoji: '🔨', color: '#78716C' },
    { id: 'Cleaning',             name: 'Cleaning',             emoji: '🧹', color: '#22C55E' },
    { id: 'Painting',             name: 'Painting',             emoji: '🖌️', color: '#EC4899' },
    { id: 'Pest Control',         name: 'Pest Control',         emoji: '🐛', color: '#16A34A' },
    { id: 'Other',                name: 'Other',                emoji: '🔧', color: '#8B5CF6' },
  ],

  analytics: {
    weeklyBookings:  [0, 0, 0, 0, 0, 0, 0],
    weeklyLabels:    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    serviceBreakdown: [],
    topLocations:    [],
    avgNegotiatedDiscount: 0,
    totalRevenue:    0,
    activeWorkers:   0,
    totalUsers:      0,
    completedJobs:   0,
  },
};

// ── Backend REST API & SSE Client ──────────────────────────────
const API = {
  baseUrl: window.location.origin,

  async request(endpoint, options = {}) {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const config = {
      ...options,
      headers: { ...defaultHeaders, ...options.headers },
    };
    try {
      const res  = await fetch(`${this.baseUrl}${endpoint}`, config);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      return data;
    } catch (err) {
      console.warn(`API Error [${endpoint}]:`, err.message);
      throw err;
    }
  },

  // ── Auth ─────────────────────────────────────────────────────
  // Returns: { id, name, role, createdAt }
  async login(name, password, role) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, password, role }),
    });
    return res.account; // { id, name, role, createdAt }
  },

  // ── Worker Registration & Profile ─────────────────────────────
  // POST /api/workers/register → { worker }
  async registerWorker(data) {
    const res = await this.request('/api/workers/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.worker;
  },

  // POST /api/workers/:id/services → { worker, service }
  async addWorkerService(workerId, serviceData) {
    const res = await this.request(`/api/workers/${workerId}/services`, {
      method: 'POST',
      body: JSON.stringify(serviceData),
    });
    return res.worker;
  },

  // DELETE /api/workers/:id/services/:svcId → { worker }
  async removeWorkerService(workerId, serviceId) {
    const res = await this.request(`/api/workers/${workerId}/services/${serviceId}`, {
      method: 'DELETE',
    });
    return res.worker;
  },

  // POST /api/workers/:id/submit → { worker }
  async submitWorkerProfile(workerId) {
    const res = await this.request(`/api/workers/${workerId}/submit`, {
      method: 'POST',
    });
    return res.worker;
  },

  // PATCH /api/workers/:id/availability → { worker }
  async updateWorkerAvailability(workerId, available) {
    const res = await this.request(`/api/workers/${workerId}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ available }),
    });
    return res.worker;
  },

  // GET /api/workers/:id → { worker }
  async getWorkerById(workerId) {
    const res = await this.request(`/api/workers/${workerId}`);
    return res.worker;
  },

  // GET /api/workers/by-account/:accountId → { worker }
  async getWorkerByAccount(accountId) {
    const res = await this.request(`/api/workers/by-account/${accountId}`);
    return res.worker || null;
  },

  // ── Worker Discovery ──────────────────────────────────────────
  // status: 'pending' | 'approved' | 'all'
  async getWorkers(category = '', status = 'all') {
    if (status === 'pending') {
      const res = await this.request('/api/workers/pending');
      return res.workers || [];
    } else if (status === 'approved') {
      const q = category ? `?category=${encodeURIComponent(category)}` : '';
      const res = await this.request(`/api/workers/verified${q}`);
      return res.workers || [];
    } else {
      // all — get full state
      const res = await this.request('/api/state');
      let workers = res.workers || [];
      if (category) {
        workers = workers.filter(w =>
          (w.services || []).some(s => s.category.toLowerCase() === category.toLowerCase())
        );
      }
      return workers;
    }
  },

  // POST /api/workers/:id/verify → { worker }
  async verifyWorker(workerId, action) {
    // action: 'approve' | 'reject'
    const act = action.startsWith('approve') ? 'approve' : 'reject';
    const session = Session.get();
    const res = await this.request(`/api/workers/${workerId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ action: act, adminName: session?.name || 'Admin' }),
    });
    return res.worker;
  },

  // ── Service Requests ──────────────────────────────────────────
  // POST /api/requests → { request }
  // Required: customerId, customerName, workerId, serviceCategory, basePrice, offer
  async createRequest(reqData) {
    const res = await this.request('/api/requests', {
      method: 'POST',
      body: JSON.stringify(reqData),
    });
    return res.request;
  },

  // GET /api/requests?customerId=...&workerId=...&status=... → { requests }
  async getRequests(params = {}) {
    const q = new URLSearchParams(params).toString();
    const res = await this.request(`/api/requests${q ? '?' + q : ''}`);
    return res.requests || [];
  },

  // POST /api/requests/:id/respond → { request }
  // action: 'accept' | 'counter' | 'decline' | 'customer_accept' | 'customer_counter' | 'customer_decline' | 'job_update'
  async negotiate(requestId, responseData) {
    const res = await this.request(`/api/requests/${requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify(responseData),
    });
    return res.request;
  },

  // ── Messages ──────────────────────────────────────────────────
  async sendMessage(requestId, messageData) {
    const session = Session.get();
    const res = await this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        requestId,
        senderId:   session?.id || 'anon',
        senderName: session?.name || messageData.senderType,
        senderType: messageData.senderType,
        text:       messageData.text,
      }),
    });
    return res.message;
  },

  async getMessages(requestId) {
    const res = await this.request(`/api/messages?requestId=${encodeURIComponent(requestId)}`);
    return res.messages || [];
  },

  // ── Admin Stats ───────────────────────────────────────────────
  async getAdminStats() {
    const res = await this.request('/api/admin/stats');
    return res;
  },

  // ── Real-Time SSE Sync ────────────────────────────────────────
  setupSSE(onEvent) {
    try {
      const evtSource = new EventSource(`${this.baseUrl}/api/events`);

      // Named events
      const handler = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (onEvent) onEvent({ eventType: e.type, ...data });
        } catch (err) {
          console.warn('SSE parse error:', err);
        }
      };

      evtSource.onmessage = handler;
      evtSource.addEventListener('worker_registered', handler);
      evtSource.addEventListener('worker_submitted', handler);
      evtSource.addEventListener('worker_verified', handler);
      evtSource.addEventListener('new_request', handler);
      evtSource.addEventListener('request_updated', handler);
      evtSource.addEventListener('new_message', handler);
      evtSource.addEventListener('worker_availability', handler);
      evtSource.addEventListener('connected', () => {
        console.log('[SSE] Connected to SnapServe live sync');
      });

      evtSource.onerror = () => {
        console.warn('[SSE] Connection error — will auto-retry');
      };

      return evtSource;
    } catch (err) {
      console.warn('[SSE] setup failed:', err);
      return null;
    }
  },
};

// ── LocalStorage Helpers ───────────────────────────────────────
const Store = {
  KEY_SESSION: 'snap_session',
  KEY_ROLE:    'snap_role',
  KEY_BOOKING: 'snap_active_booking',
  KEY_NEG:     'snap_active_negotiation',

  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Store.save failed:', e);
    }
  },

  load(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Store.load failed:', e);
      return fallback;
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  clear() {
    Object.values(this).forEach(v => {
      if (typeof v === 'string') localStorage.removeItem(v);
    });
  },
};

// ── Session Helper ─────────────────────────────────────────────
// Session shape: { id, name, role, workerId?, createdAt, loginTime }
const Session = {
  get() {
    return Store.load(Store.KEY_SESSION, null);
  },

  getName() {
    return this.get()?.name || 'User';
  },

  getRole() {
    return this.get()?.role || 'user';
  },

  set(sessionData) {
    Store.save(Store.KEY_SESSION, sessionData);
  },

  logout() {
    Store.clear();
    window.location.href = 'login.html';
  },
};

// ── State Manager ──────────────────────────────────────────────
const StateManager = {
  setRole(role) {
    AppState.currentRole = role;
    Store.save(Store.KEY_ROLE, role);
  },

  getRole() {
    return Session.getRole();
  },

  getUser() {
    const s = Session.get();
    if (!s) return { id: 'guest', name: 'Guest', role: 'user', avatar: 'GU' };
    return {
      id:     s.id || ('u_' + (s.name || 'user').toLowerCase().replace(/\s+/g, '')),
      name:   s.name || 'User',
      role:   s.role || 'user',
      avatar: Utils.getInitials(s.name || 'U'),
    };
  },

  getActiveBooking() {
    return Store.load(Store.KEY_BOOKING, null);
  },

  setActiveBooking(booking) {
    Store.save(Store.KEY_BOOKING, booking);
    AppState.activeBooking = booking;
  },

  getActiveNegotiation() {
    return Store.load(Store.KEY_NEG, null);
  },

  setActiveNegotiation(neg) {
    Store.save(Store.KEY_NEG, neg);
    AppState.activeNegotiation = neg;
  },
};

// ── Utility Helpers ────────────────────────────────────────────
const Utils = {
  formatPrice(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '₹—';
    return '₹' + Number(amount).toLocaleString('en-IN');
  },

  timeAgo(isoString) {
    if (!isoString) return 'just now';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  },

  formatTime(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit',
    });
  },

  // Returns the service metadata object for a given category name
  getService(idOrName) {
    if (!idOrName) return MockData.services[0];
    const target = idOrName.toLowerCase();
    return MockData.services.find(s =>
      s.id.toLowerCase() === target ||
      s.name.toLowerCase() === target ||
      target.includes(s.id.toLowerCase()) ||
      s.id.toLowerCase().includes(target)
    ) || MockData.services[MockData.services.length - 1]; // fallback to 'Other'
  },

  statusLabel(status) {
    const labels = {
      pending:        { text: 'Pending',          cls: 'badge-warning' },
      requested:      { text: 'Request Sent',     cls: 'badge-warning' },
      negotiating:    { text: 'Negotiating',      cls: 'badge-primary' },
      countered:      { text: 'Counter Offer',    cls: 'badge-warning' },
      accepted:       { text: 'Accepted',         cls: 'badge-success' },
      declined:       { text: 'Declined',         cls: 'badge-danger'  },
      on_the_way:     { text: 'Worker On The Way',cls: 'badge-primary' },
      in_progress:    { text: 'Work In Progress', cls: 'badge-warning' },
      completed:      { text: 'Completed',        cls: 'badge-success' },
      cancelled:      { text: 'Cancelled',        cls: 'badge-danger'  },
    };
    return labels[status] || { text: status || 'Unknown', cls: 'badge-muted' };
  },

  getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  },

  getInitials(name) {
    if (!name) return 'U';
    return name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  },

  debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  },
};

// Make globally accessible
window.MockData      = MockData;
window.AppState      = AppState;
window.StateManager  = StateManager;
window.Store         = Store;
window.Session       = Session;
window.Utils         = Utils;
window.API           = API;
