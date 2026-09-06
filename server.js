/* ============================================================
   SNAPSERVE — Shared Backend Server
   server.js

   • Serves static files
   • Proxies voice transcripts to Gemini API
   • Maintains shared in-memory platform state (synced to data.json)
   • REST API for cross-device sync:
       POST /api/auth/login
       GET  /api/state
       POST /api/workers/register
       POST /api/workers/:id/services
       GET  /api/workers/pending
       GET  /api/workers/verified
       POST /api/workers/:id/verify
       POST /api/requests
       GET  /api/requests
       POST /api/requests/:id/respond
       GET  /api/negotiations/:id
       POST /api/negotiations/:id/step
       GET  /api/events  (SSE)
   ============================================================ */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

// ── Load .env manually ─────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.VERCEL
  ? path.join('/tmp', 'platform_data.json')
  : path.join(__dirname, 'platform_data.json');

// ══════════════════════════════════════════════════════════════
//  SHARED PLATFORM STATE
// ══════════════════════════════════════════════════════════════

// Default empty state — NO fake workers, users, bookings
const EMPTY_STATE = {
  accounts:        [],   // { id, name, role, passwordHash, createdAt }
  workers:         [],   // { id, accountId, name, location, experience, bio, services[], verificationStatus, verifiedAt, available }
  serviceRequests: [],   // { id, customerId, customerName, workerId, serviceCategory, specificWork, problem, urgency, basePrice, offer, message, status, createdAt }
  negotiations:    [],   // { id, requestId, steps[], finalPrice, status }
  bookings:        [],   // { id, requestId, negotiationId, status, jobStatus, completedAt }
  messages:        [],   // { id, requestId, senderId, senderName, senderType, text, createdAt }
};

// In-memory state
let PlatformState = loadState();

// SSE clients
const sseClients = new Set();

// ── Persist state to JSON file ─────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
    const seedFile = path.join(__dirname, 'platform_data.json');
    if (fs.existsSync(seedFile)) {
      const raw = fs.readFileSync(seedFile, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[State] Failed to load data.json, starting fresh:', e.message);
  }
  return JSON.parse(JSON.stringify(EMPTY_STATE));
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(PlatformState, null, 2));
  } catch (e) {
    console.warn('[State] Failed to save data.json:', e.message);
  }
}

// ── Broadcast SSE event to all clients ────────────────────────
function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try { client.write(payload); } catch (e) { sseClients.delete(client); }
  });
}

// ── ID generator ───────────────────────────────────────────────
function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'snapserve_salt').digest('hex');
}

// ══════════════════════════════════════════════════════════════
//  EXPRESS APP
// ══════════════════════════════════════════════════════════════

const app = express();

// CORS for multi-device
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex   = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(rootIndex))   return res.sendFile(rootIndex);
  res.send('SnapServe is running');
});

// Maps Config API
app.get('/api/config/maps', (req, res) => {
  res.json({ apiKey: GOOGLE_MAPS_API_KEY });
});

// ══════════════════════════════════════════════════════════════
//  SSE — GET /api/events
// ══════════════════════════════════════════════════════════════
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state on connect
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  sseClients.add(res);
  console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

  // Heartbeat every 20s
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { /* closed */ }
  }, 20000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(hb);
    console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
  });
});

// ══════════════════════════════════════════════════════════════
//  AUTH — POST /api/auth/login
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { name, password, role } = req.body;
  if (!name || !password || !role) {
    return res.status(400).json({ error: 'Name, password and role are required' });
  }

  let normalizedRole = role.toLowerCase();
  if (normalizedRole === 'user') normalizedRole = 'customer';
  const validRoles = ['customer', 'worker', 'admin'];
  if (!validRoles.includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role. Must be Customer, Worker, or Admin' });
  }
  const roleToSave = normalizedRole;

  const ph = hashPassword(password);
  let account = PlatformState.accounts.find(
    a => a.name.toLowerCase() === name.trim().toLowerCase() && a.role === roleToSave
  );

  if (account) {
    // Existing account — check password
    if (account.passwordHash !== ph) {
      return res.status(401).json({ error: 'Incorrect password for this account' });
    }
  } else {
    // New account
    account = {
      id:           uid(),
      name:         name.trim(),
      role:         roleToSave,
      passwordHash: ph,
      createdAt:    new Date().toISOString(),
    };
    PlatformState.accounts.push(account);
    saveState();
    console.log(`[Auth] New ${roleToSave} account: ${account.name} (${account.id})`);
  }

  const { passwordHash, ...safeAccount } = account;
  res.json({ account: safeAccount });
});

// ══════════════════════════════════════════════════════════════
//  PLATFORM STATE — GET /api/state
// ══════════════════════════════════════════════════════════════
app.get('/api/state', (req, res) => {
  // Return sanitized state (no password hashes)
  const safe = {
    ...PlatformState,
    accounts: PlatformState.accounts.map(({ passwordHash, ...a }) => a),
  };
  res.json(safe);
});

// ══════════════════════════════════════════════════════════════
//  WORKERS — POST /api/workers/register
// ══════════════════════════════════════════════════════════════
app.post('/api/workers/register', (req, res) => {
  const { accountId, name, location, experience, bio } = req.body;
  if (!accountId || !name) {
    return res.status(400).json({ error: 'accountId and name are required' });
  }

  // Check if worker profile already exists
  let worker = PlatformState.workers.find(w => w.accountId === accountId);
  if (worker) {
    // Update existing
    Object.assign(worker, { name, location, experience, bio, updatedAt: new Date().toISOString() });
  } else {
    worker = {
      id:                 uid(),
      accountId,
      name:               name.trim(),
      location:           location || '',
      experience:         Number(experience) || 0,
      bio:                bio || '',
      services:           [],
      verificationStatus: 'pending', // 'pending' | 'approved' | 'rejected'
      available:          false,
      rating:             null,
      totalJobs:          0,
      createdAt:          new Date().toISOString(),
      updatedAt:          new Date().toISOString(),
    };
    PlatformState.workers.push(worker);
  }

  saveState();
  console.log(`[Workers] Registered: ${worker.name} (${worker.id}) — status: ${worker.verificationStatus}`);
  broadcast('worker_registered', { workerId: worker.id, name: worker.name });
  res.json({ worker });
});

// ── Add Service to Worker — POST /api/workers/:id/services ──
app.post('/api/workers/:id/services', (req, res) => {
  const worker = PlatformState.workers.find(w => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  const { category, specificWork, basePrice, experienceYears, description } = req.body;
  if (!category || !specificWork || !basePrice) {
    return res.status(400).json({ error: 'category, specificWork, and basePrice are required' });
  }

  const service = {
    id:              uid(),
    category:        category.trim(),
    specificWork:    specificWork.trim(),
    basePrice:       Number(basePrice),
    experienceYears: Number(experienceYears) || worker.experience || 0,
    description:     description || '',
    addedAt:         new Date().toISOString(),
  };

  worker.services.push(service);
  worker.updatedAt = new Date().toISOString();
  saveState();

  console.log(`[Workers] Service added to ${worker.name}: ${category} — "${specificWork}"`);
  res.json({ worker, service });
});

// ── Delete a worker service — DELETE /api/workers/:id/services/:svcId ──
app.delete('/api/workers/:id/services/:svcId', (req, res) => {
  const worker = PlatformState.workers.find(w => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  const before = worker.services.length;
  worker.services = worker.services.filter(s => s.id !== req.params.svcId);
  if (worker.services.length === before) return res.status(404).json({ error: 'Service not found' });

  saveState();
  res.json({ worker });
});

// ── Submit worker for verification — POST /api/workers/:id/submit ──
app.post('/api/workers/:id/submit', (req, res) => {
  const worker = PlatformState.workers.find(w => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  if (worker.services.length === 0) {
    return res.status(400).json({ error: 'Please add at least one service before submitting' });
  }

  worker.verificationStatus = 'pending';
  worker.submittedAt = new Date().toISOString();
  saveState();

  broadcast('worker_submitted', { workerId: worker.id, name: worker.name });
  console.log(`[Workers] ${worker.name} submitted for verification`);
  res.json({ worker });
});

// ── GET pending workers — GET /api/workers/pending ──
app.get('/api/workers/pending', (req, res) => {
  const pending = PlatformState.workers.filter(w => w.verificationStatus === 'pending');
  res.json({ workers: pending });
});

// ── GET verified workers — GET /api/workers/verified ──
app.get('/api/workers/verified', (req, res) => {
  const { category } = req.query;
  let verified = PlatformState.workers.filter(w => w.verificationStatus === 'approved');
  if (category) {
    verified = verified.filter(w =>
      w.services.some(s => s.category.toLowerCase() === category.toLowerCase())
    );
  }
  res.json({ workers: verified });
});

// ── GET single worker — GET /api/workers/:id ──
app.get('/api/workers/:id', (req, res) => {
  const worker = PlatformState.workers.find(w => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  res.json({ worker });
});

// ── GET worker by accountId — GET /api/workers/by-account/:accountId ──
app.get('/api/workers/by-account/:accountId', (req, res) => {
  const worker = PlatformState.workers.find(w => w.accountId === req.params.accountId);
  res.json({ worker: worker || null });
});

// ── Verify worker — POST /api/workers/:id/verify ──
app.post('/api/workers/:id/verify', (req, res) => {
  const worker = PlatformState.workers.find(w => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  const { action, adminId, adminName } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  worker.verificationStatus = action === 'approve' ? 'approved' : 'rejected';
  worker.verifiedAt    = new Date().toISOString();
  worker.verifiedBy    = adminName || 'Admin';
  if (action === 'approve') worker.available = true;

  saveState();
  console.log(`[Admin] Worker ${worker.name} ${action}d by ${adminName || 'Admin'}`);
  broadcast('worker_verified', {
    workerId: worker.id,
    name: worker.name,
    status: worker.verificationStatus,
  });

  res.json({ worker });
});

// ── Update worker availability — PATCH /api/workers/:id/availability ──
app.patch('/api/workers/:id/availability', (req, res) => {
  const worker = PlatformState.workers.find(w => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (worker.verificationStatus !== 'approved') {
    return res.status(403).json({ error: 'Worker not verified' });
  }

  worker.available = !!req.body.available;
  saveState();
  broadcast('worker_availability', { workerId: worker.id, available: worker.available });
  res.json({ worker });
});

// ══════════════════════════════════════════════════════════════
//  SERVICE REQUESTS — POST /api/requests
// ══════════════════════════════════════════════════════════════
app.post('/api/requests', (req, res) => {
  const customerId = req.body.customerId || req.body.userId;
  const customerName = req.body.customerName || req.body.userName || 'Customer';
  const {
    workerId,
    serviceCategory, specificWork,
    problem, urgency,
    basePrice, message,
  } = req.body;
  const offer = req.body.offer !== undefined ? req.body.offer : req.body.offerAmount;

  if (!customerId || !workerId || !serviceCategory || !basePrice) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const request = {
    id:              uid(),
    customerId,
    customerName,
    workerId,
    serviceCategory,
    specificWork:    specificWork || '',
    problem:         problem || req.body.note || '',
    urgency:         urgency || 'Medium',
    basePrice:       Number(basePrice),
    offer:           Number(offer) || Number(basePrice),
    message:         message || '',
    status:          'pending',   // pending | accepted | countered | declined | completed
    workerCounter:   null,
    finalPrice:      null,
    jobStatus:       null,        // on_the_way | in_progress | completed
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  };

  PlatformState.serviceRequests.push(request);
  saveState();

  console.log(`[Requests] New request: ${customerName} → ${serviceCategory} worker ${workerId}`);
  broadcast('new_request', {
    requestId: request.id,
    customerId,
    customerName,
    workerId,
    serviceCategory,
    offer: request.offer,
  });

  res.json({ request });
});

// ── GET requests — GET /api/requests ──
app.get('/api/requests', (req, res) => {
  let list = PlatformState.serviceRequests;
  const custId = req.query.customerId || req.query.userId;
  if (req.query.workerId) list = list.filter(r => r.workerId === req.query.workerId);
  if (custId)             list = list.filter(r => r.customerId === custId);
  if (req.query.status)   list = list.filter(r => r.status === req.query.status);
  res.json({ requests: list });
});

// ── Respond to a request — POST /api/requests/:id/respond ──
app.post('/api/requests/:id/respond', (req, res) => {
  const request = PlatformState.serviceRequests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const { action, message } = req.body;
  const counterAmount = req.body.counterAmount !== undefined ? req.body.counterAmount : (req.body.amount || req.body.status);
  // action: 'accept' | 'counter' | 'decline' | 'customer_accept' | 'customer_counter' | 'customer_decline' | 'job_update' | 'update_status'

  if (action === 'accept' || action === 'customer_accept') {
    request.status     = 'accepted';
    request.finalPrice = counterAmount ? Number(counterAmount) : request.offer;
    if (!request.jobStatus) request.jobStatus = 'accepted';
  } else if (action === 'counter') {
    request.status        = 'countered';
    request.workerCounter = Number(counterAmount);
  } else if (action === 'customer_counter') {
    request.status = 'pending';
    request.offer  = Number(counterAmount);
    request.workerCounter = null;
  } else if (action === 'decline' || action === 'customer_decline') {
    request.status = 'declined';
  } else if (action === 'job_update' || action === 'update_status') {
    const newStatus = req.body.jobStatus || req.body.status || counterAmount;
    request.jobStatus = newStatus;
    if (newStatus === 'completed') request.status = 'completed';
  }

  if (message) request.lastMessage = message;
  request.updatedAt = new Date().toISOString();
  saveState();

  console.log(`[Requests] ${request.id} — action: ${action}`);
  broadcast('request_updated', {
    requestId: request.id,
    status: request.status,
    jobStatus: request.jobStatus,
    action,
    finalPrice: request.finalPrice,
    workerCounter: request.workerCounter,
    offer: request.offer,
  });

  res.json({ request });
});

// ── GET single request — GET /api/requests/:id ──
app.get('/api/requests/:id', (req, res) => {
  const request = PlatformState.serviceRequests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json({ request });
});

// ══════════════════════════════════════════════════════════════
//  MESSAGES — POST /api/messages
// ══════════════════════════════════════════════════════════════
app.post('/api/messages', (req, res) => {
  const { requestId, senderId, senderName, senderType, text } = req.body;
  if (!requestId || !text) return res.status(400).json({ error: 'requestId and text required' });

  const msg = {
    id: uid(),
    requestId,
    senderId:   senderId || '',
    senderName: senderName || senderType || 'User',
    senderType: senderType || 'user',
    text,
    createdAt: new Date().toISOString(),
  };

  PlatformState.messages.push(msg);
  saveState();
  broadcast('new_message', { requestId, msg });
  res.json({ message: msg });
});

app.get('/api/messages', (req, res) => {
  const { requestId } = req.query;
  let msgs = PlatformState.messages;
  if (requestId) msgs = msgs.filter(m => m.requestId === requestId);
  res.json({ messages: msgs });
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — GET /api/admin/stats
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/stats', (req, res) => {
  const workers = PlatformState.workers;
  const requests = PlatformState.serviceRequests;

  res.json({
    totalCustomers:      PlatformState.accounts.filter(a => a.role === 'customer').length,
    totalWorkers:        workers.length,
    pendingVerification: workers.filter(w => w.verificationStatus === 'pending').length,
    approvedWorkers:     workers.filter(w => w.verificationStatus === 'approved').length,
    rejectedWorkers:     workers.filter(w => w.verificationStatus === 'rejected').length,
    totalRequests:       requests.length,
    activeRequests:      requests.filter(r => ['pending','countered'].includes(r.status)).length,
    acceptedRequests:    requests.filter(r => r.status === 'accepted').length,
    completedRequests:   requests.filter(r => r.status === 'completed').length,
    declinedRequests:    requests.filter(r => r.status === 'declined').length,
  });
});

// ══════════════════════════════════════════════════════════════
//  GEMINI AI PROXY — POST /api/analyze
// ══════════════════════════════════════════════════════════════
app.post('/api/analyze', async (req, res) => {
  try {
    const { transcript, language } = req.body;
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return res.status(400).json({ error: 'Missing or empty transcript' });
    }
    console.log(`[Gemini] Analyzing: "${transcript.slice(0, 80)}" (lang: ${language || 'auto'})`);

    if (!GEMINI_API_KEY) {
      const fallback = keywordFallback(transcript);
      return res.json(fallback);
    }

    const prompt = buildPrompt(transcript, language);
    const geminiResult = await callGemini(prompt);
    if (geminiResult.error) {
      const fallback = keywordFallback(transcript);
      fallback._fallback = true;
      return res.json(fallback);
    }
    return res.json(geminiResult);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gemini call ────────────────────────────────────────────────
async function callGemini(prompt) {
  const modelsToTry = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-1.5-flash'];
  let lastError = null;
  for (const model of modelsToTry) {
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 300, responseMimeType: 'application/json' } };
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) { lastError = `Gemini ${response.status}`; continue; }
      const data = await response.json();
      const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textContent) { lastError = 'Empty response'; continue; }
      let cleaned = textContent.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').replace(/^\uFEFF/, '').trim();
      const parsed = JSON.parse(cleaned);
      return { serviceCategory: parsed.serviceCategory || 'General', problem: parsed.problem || 'Home service needed', houseLocation: parsed.houseLocation || 'Not specified', urgency: parsed.urgency || 'Medium' };
    } catch (err) { lastError = err.message; }
  }
  return { error: lastError || 'All Gemini models failed' };
}

function buildPrompt(transcript, language) {
  return `You are a home services AI assistant for SnapServe, a hyperlocal cooperative platform in India.
A customer just described their problem via voice (may be in Hindi, English, or Hinglish).
Analyze the transcript and return ONLY a JSON object:
{"serviceCategory":"one of: Electrical, Plumbing, AC Repair, Carpentry, Cleaning, Appliance Repair, Painting, Pest Control, General","problem":"clear 1-line English summary","houseLocation":"Kitchen/Bedroom/Bathroom/Living Room/Balcony/Full Home/Not specified","urgency":"High/Medium/Low"}
Rules: urgency=High for safety issues, Medium for broken things, Low for cosmetic/cleaning. Return ONLY JSON.
Customer transcript (${language || 'auto-detect'}): "${transcript}"`;
}

function keywordFallback(transcript) {
  const lower = transcript.toLowerCase();
  const rules = [
    {
      keys: [
        'लाइट', 'बिजली', 'करंट', 'पंखा', 'स्विच', 'बोर्ड', 'तार', 'बल्ब', 'सॉकेट', 'शॉर्ट', 'सर्किट', 'स्पार्क', 'फ्यूज', 'एमसीबी', 'इनवर्टर', 'ट्यूबलाइट', 'कूलर', 'गीजर', 'इलेक्ट्रिक', 'इलेक्ट्रीशियन',
        'bijli', 'light', 'socket', 'wire', 'power', 'current', 'switch', 'fuse', 'electric', 'electrical', 'fan', 'bulb', 'spark', 'mcb', 'short circuit', 'inverter'
      ],
      cat: 'Electrical',
      problem: lower.includes('लाइट') || lower.includes('light') ? 'Light fixture not working / flickering' : 'Electrical wiring / power issue',
      loc: 'Living Room / Bedroom'
    },
    {
      keys: [
        'नल', 'पानी', 'लीक', 'लीकेज', 'पाइप', 'प्लम्बर', 'टॉयलेट', 'बाथरूम', 'ड्रेन', 'शावर', 'वॉशबेसिन', 'सिंक', 'सीवर', 'गटर', 'टैंक', 'टंकी', 'फ्लश', 'जाम', 'बह', 'टपक',
        'nal', 'water', 'leak', 'leaking', 'pipe', 'tap', 'plumb', 'pani', 'toilet', 'drain', 'shower', 'bathroom', 'sink', 'flush', 'sewer'
      ],
      cat: 'Plumbing',
      problem: 'Water leakage / plumbing repair needed',
      loc: 'Kitchen / Bathroom'
    },
    {
      keys: [
        'एसी', 'कूलिंग', 'ठंडा', 'गैस', 'कंप्रेसर', 'फ्रिज', 'रेफ्रिजरेटर', 'टीवी', 'वाशिंग', 'मशीन', 'माइक्रोवेव', 'ओवन', 'मिक्सर', 'हीटर', 'एप्लायंस',
        'ac', 'cool', 'air condition', 'conditioning', 'thanda', 'split', 'fridge', 'tv', 'washing machine', 'appliance', 'microwave', 'geyser', 'heater'
      ],
      cat: 'AC & Appliance Repair',
      problem: lower.includes('एसी') || lower.includes('ac') ? 'AC not cooling properly' : 'Appliance repair needed',
      loc: 'Bedroom / Kitchen'
    },
    {
      keys: [
        'दरवाजा', 'लकड़ी', 'लकडी', 'फर्नीचर', 'अलमारी', 'कारपेंटर', 'मेज', 'कुर्सी', 'टेबल', 'कब्जा', 'ताला', 'लॉक', 'हैंडल', 'दराज', 'बेड',
        'wood', 'door', 'almar', 'almari', 'furniture', 'carpenter', 'table', 'chair', 'hinge', 'lakdi'
      ],
      cat: 'Carpentry',
      problem: 'Furniture / woodwork repair needed',
      loc: 'Room'
    },
    {
      keys: [
        'सफाई', 'साफ', 'धुलाई', 'धोना', 'झाड़ू', 'झाडू', 'पोछा', 'डस्टिंग', 'गंदगी', 'कचरा', 'डीप क्लीन', 'सोफा', 'कारपेट',
        'saaf', 'clean', 'dust', 'wash', 'mop', 'vacuum', 'safai', 'deep clean'
      ],
      cat: 'Cleaning',
      problem: 'Cleaning service needed',
      loc: 'Full Home'
    },
    {
      keys: [
        'पेंट', 'कलर', 'रंग', 'दीवार', 'पुट्टी', 'सफेदी', 'व्हाइटवॉश', 'पेंटिंग', 'छत',
        'paint', 'wall', 'color', 'colour', 'whitewash', 'rang'
      ],
      cat: 'Painting',
      problem: 'Painting needed',
      loc: 'Full Home'
    },
    {
      keys: [
        'कीड़े', 'कीड़ा', 'कॉकरोच', 'चूहा', 'चूहे', 'खटमल', 'दीमक', 'मच्छर', 'मक्खी', 'चींटी', 'पेस्ट कंट्रोल',
        'pest', 'cockroach', 'rat', 'bug', 'termite', 'mosquito', 'keeda'
      ],
      cat: 'Pest Control',
      problem: 'Pest control needed',
      loc: 'Full Home'
    },
  ];
  for (const r of rules) {
    if (r.keys.some(k => lower.includes(k))) {
      const urgent = ['leak', 'burst', 'flood', 'fire', 'shock', 'spark', 'emergency', 'करंट', 'शॉर्ट', 'आग', 'धुआं'].some(w => lower.includes(w));
      return { serviceCategory: r.cat, problem: r.problem, houseLocation: r.loc, urgency: urgent ? 'High' : 'Medium', _fallback: true };
    }
  }
  return { serviceCategory: 'Other', problem: transcript.length > 50 ? transcript.slice(0, 50) + '...' : transcript, houseLocation: 'Home', urgency: 'Medium', _fallback: true };
}

if (require.main === module) {
  function startServer(portToUse) {
    const server = app.listen(portToUse, '0.0.0.0', () => {
      const localIP = Object.values(require('os').networkInterfaces())
        .flat()
        .find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';

      console.log('');
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║   🔧 SnapServe Platform Server Running                  ║');
      console.log(`║   📍 Local:   http://localhost:${portToUse}                    ║`);
      console.log(`║   🌐 Network: http://${localIP}:${portToUse}  (multi-device)   ║`);
      console.log(`║   🔑 Gemini:  ${GEMINI_API_KEY ? '✅ Configured' : '❌ Not set (keyword fallback)'}                    ║`);
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('  For multi-device demo, all devices connect to:');
      console.log(`  http://${localIP}:${portToUse}`);
      console.log('');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️ Port ${portToUse} is in use. Trying port ${portToUse + 1}...`);
        startServer(Number(portToUse) + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  }

  startServer(Number(PORT));
}

app.PlatformState = PlatformState;
module.exports = app;

