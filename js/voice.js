/* ============================================================
   SNAPSERVE — Voice AI Engine (Phase 3 + Phase 4)
   js/voice.js

   Phase 3: Real Web Speech API capture (Hindi, English, Hinglish)
   Phase 4: Multi-tier AI Parsing (Server Gemini -> Direct Gemini 2.0 Flash -> Smart Local Multilingual Engine)
   Includes:
     • Native Hindi Devanagari script recognition (e.g. "लाइट नहीं चल रही है")
     • Robust cross-browser Web Speech API support
     • Direct 1-Click Worker Booking from Voice Modal
     • Automatic pre-fill into Worker Offer / Booking flow
     • Modal controls (open, close, toggle, language switcher)
   ============================================================ */

'use strict';

const VoiceAI = (() => {
  // ── Private State ────────────────────────────────────────────
  let recognition  = null;
  let isListening  = false;
  let currentLang  = 'hi-IN';
  let finalText    = '';
  let interimText  = '';
  let lastResult   = null;
  let listenersBound = false;

  const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechAPI;
  console.log('[VoiceAI] Web Speech API supported:', supported);

  // ── Canonical Service Category Normalizer (Bilingual) ─────────
  function normalizeCategory(rawCat) {
    if (!rawCat) return 'Other';
    const lower = rawCat.toLowerCase().trim();

    if (
      lower.includes('plumb') || lower.includes('water') || lower.includes('pipe') || lower.includes('nal') || lower.includes('tap') || lower.includes('drain') ||
      lower.includes('नल') || lower.includes('पानी') || lower.includes('लीक') || lower.includes('पाइप') || lower.includes('प्लम्बर') || lower.includes('टॉयलेट') || lower.includes('टंकी') || lower.includes('शावर') || lower.includes('गीजर')
    ) {
      return 'Plumbing';
    }
    if (
      lower.includes('electr') || lower.includes('bijli') || lower.includes('wire') || lower.includes('switch') || lower.includes('light') || lower.includes('fan') || lower.includes('current') || lower.includes('bulb') || lower.includes('fuse') || lower.includes('mcb') || lower.includes('socket') ||
      lower.includes('इलेक्ट्रिक') || lower.includes('बिजली') || lower.includes('लाइट') || lower.includes('पंखा') || lower.includes('स्विच') || lower.includes('तार') || lower.includes('बल्ब') || lower.includes('करंट') || lower.includes('सॉकेट') || lower.includes('फ्यूज')
    ) {
      return 'Electrical';
    }
    if (
      lower.includes('ac') || lower.includes('appliance') || lower.includes('cool') || lower.includes('fridge') || lower.includes('refriger') || lower.includes('washing') || lower.includes('geyser') || lower.includes('air condition') || lower.includes('microwave') || lower.includes('heater') ||
      lower.includes('एसी') || lower.includes('कूलिंग') || lower.includes('ठंडा') || lower.includes('फ्रिज') || lower.includes('वाशिंग') || lower.includes('मशीन') || lower.includes('रेफ्रिजरेटर') || lower.includes('ओवन')
    ) {
      return 'AC & Appliance Repair';
    }
    if (
      lower.includes('carpent') || lower.includes('wood') || lower.includes('door') || lower.includes('furniture') || lower.includes('almar') || lower.includes('lakdi') || lower.includes('hinge') || lower.includes('lock') ||
      lower.includes('कारपेंटर') || lower.includes('लकड़ी') || lower.includes('लकडी') || lower.includes('दरवाजा') || lower.includes('अलमारी') || lower.includes('फर्नीचर') || lower.includes('मेज') || lower.includes('कुर्सी') || lower.includes('ताला')
    ) {
      return 'Carpentry';
    }
    if (
      lower.includes('clean') || lower.includes('safai') || lower.includes('dust') || lower.includes('mop') || lower.includes('wash') || lower.includes('pocha') ||
      lower.includes('सफाई') || lower.includes('साफ') || lower.includes('पोछा') || lower.includes('झाड़ू') || lower.includes('झाडू') || lower.includes('धुलाई')
    ) {
      return 'Cleaning';
    }
    if (
      lower.includes('paint') || lower.includes('wall') || lower.includes('rang') || lower.includes('color') || lower.includes('whitewash') || lower.includes('putty') ||
      lower.includes('पेंट') || lower.includes('रंग') || lower.includes('दीवार') || lower.includes('पुट्टी') || lower.includes('सफेदी')
    ) {
      return 'Painting';
    }
    if (
      lower.includes('pest') || lower.includes('cockroach') || lower.includes('rat') || lower.includes('bug') || lower.includes('termite') || lower.includes('keeda') || lower.includes('machhar') || lower.includes('chuha') ||
      lower.includes('पेस्ट') || lower.includes('कीड़ा') || lower.includes('कीड़े') || lower.includes('कॉकरोच') || lower.includes('चूहा') || lower.includes('खटमल') || lower.includes('दीमक') || lower.includes('मच्छर')
    ) {
      return 'Pest Control';
    }
    return 'Other';
  }

  // ── Public API ───────────────────────────────────────────────
  const api = {
    get isListening() { return isListening; },
    get isSupported() { return supported; },
    get lastResult()  { return lastResult; },
    get currentLang()  { return currentLang; },

    // ── Set Language ────────────────────────────────────────────
    setLanguage(langCode) {
      currentLang = langCode;
      if (recognition) {
        try { recognition.lang = langCode; } catch (e) { /* ignore */ }
      }

      // Update UI active button
      document.querySelectorAll('#lang-btns button').forEach(btn => {
        if (btn.dataset.lang === langCode) {
          btn.classList.add('active-lang');
        } else {
          btn.classList.remove('active-lang');
        }
      });

      const names = { 'hi-IN': 'Hindi 🇮🇳', 'en-IN': 'English 🇬🇧', 'en-US': 'English 🇺🇸' };
      if (typeof showToast === 'function') {
        showToast('Language', 'Set to ' + (names[langCode] || langCode), 'info', 2000);
      }

      if (isListening) {
        this.stop();
        setTimeout(() => this.start(), 350);
      }
    },

    // ── Toggle Listening ─────────────────────────────────────────
    toggle() {
      if (isListening) {
        this.stop();
      } else {
        this.start();
      }
    },

    // ── Start Listening ──────────────────────────────────────────
    start() {
      console.log('[VoiceAI] start() — supported=' + supported + ' listening=' + isListening);

      if (!supported) {
        setStatus('Microphone Not Available');
        setTranscript('⚠️ Web Speech is not supported in this browser. You can click a sample prompt or type your request below.');
        if (typeof showToast === 'function') {
          showToast('Mic Unavailable', 'Type your problem or choose a sample prompt below', 'warning', 4000);
        }
        const fallbackInput = document.getElementById('voice-manual-input');
        if (fallbackInput) fallbackInput.focus();
        return;
      }

      if (isListening) {
        this.stop();
        return;
      }

      try {
        if (recognition) {
          try { recognition.abort(); } catch (e) { /* ignore */ }
        }

        recognition = new SpeechAPI();
        recognition.continuous     = false;
        recognition.interimResults = true;
        recognition.lang           = currentLang;
        recognition.maxAlternatives = 1;

        recognition.onstart  = onStart;
        recognition.onresult = onResult;
        recognition.onerror  = onError;
        recognition.onend    = onEnd;

        finalText = '';
        interimText = '';

        // Clear previous result UI
        const resEl = document.getElementById('voice-ai-result');
        if (resEl) { resEl.style.display = 'none'; resEl.innerHTML = ''; }

        recognition.start();
        console.log('[VoiceAI] recognition.start() — lang=' + currentLang);
      } catch (err) {
        console.error('[VoiceAI] Failed to start recognition:', err);
        isListening = false;
        updateMicUI(false);
        setStatus('Ready to Speak');
        setTranscript('⚠️ Could not start microphone: ' + err.message + '. You can type your request below.');
        if (typeof showToast === 'function') {
          showToast('Voice Error', 'Microphone error. You can type your request below.', 'error');
        }
      }
    },

    // ── Stop Listening ───────────────────────────────────────────
    stop() {
      console.log('[VoiceAI] stop()');
      if (recognition) {
        try { recognition.stop(); } catch (e) { /* ignore */ }
      }
      isListening = false;
      updateMicUI(false);
    },

    // ── Analyze Direct Text (Sample Chips & Manual Input) ────────
    analyzeText(text) {
      if (!text || !text.trim()) return;
      const clean = text.trim();
      if (isListening) this.stop();
      finalText = clean;
      interimText = '';
      setStatus('⏳ Analyzing with AI...');
      setTranscript('"' + clean + '"');

      const resEl = document.getElementById('voice-ai-result');
      if (resEl) { resEl.style.display = 'none'; resEl.innerHTML = ''; }

      analyzeWithBackend(clean);
    },

    // ── Prompt for Optional Gemini API Key ───────────────────────
    promptGeminiKey() {
      const existing = localStorage.getItem('snapserve_gemini_key') || '';
      const key = prompt('Enter your Google Gemini API Key (optional — for live cloud AI parsing):', existing);
      if (key !== null) {
        const trimmed = key.trim();
        if (trimmed) {
          localStorage.setItem('snapserve_gemini_key', trimmed);
          if (typeof showToast === 'function') {
            showToast('Gemini API Key', 'Key saved! Voice AI will use live Gemini 2.0 Flash.', 'success', 4000);
          }
        } else {
          localStorage.removeItem('snapserve_gemini_key');
          if (typeof showToast === 'function') {
            showToast('Gemini API Key', 'Key removed. Using instant local multilingual AI engine.', 'info', 3000);
          }
        }
      }
    },

    // ── Called from UI: user confirmed the analysis ─────────────
    confirmResult() {
      if (!lastResult) return;
      const canonicalCategory = normalizeCategory(lastResult.serviceCategory);
      if (typeof closeVoiceModal === 'function') closeVoiceModal();
      if (typeof selectServiceCategory === 'function') {
        selectServiceCategory(canonicalCategory);
      }
    },

    // ── Called from UI: user wants to edit / try again ───────────
    editResult() {
      setStatus("Tell us what's wrong");
      setTranscript('');
      const resEl = document.getElementById('voice-ai-result');
      if (resEl) { resEl.style.display = 'none'; resEl.innerHTML = ''; }
      const manualInput = document.getElementById('voice-manual-input');
      if (manualInput) {
        manualInput.value = lastResult?.problem || '';
        manualInput.focus();
      }
    },

    // ── Configure Gemini API Key from UI ─────────────────────────
    promptGeminiKey() {
      const current = localStorage.getItem('snapserve_gemini_key') || '';
      const key = prompt('Google Gemini API Key for Voice AI Booking:', current);
      if (key !== null) {
        const trimmed = key.trim();
        if (trimmed) {
          localStorage.setItem('snapserve_gemini_key', trimmed);
          if (typeof showToast === 'function') {
            showToast('Gemini API Key', 'Key saved! Voice AI is powered by Google Gemini.', 'success', 3500);
          }
        } else {
          localStorage.removeItem('snapserve_gemini_key');
          if (typeof showToast === 'function') {
            showToast('Gemini API Key', 'Reset to default key.', 'info', 3000);
          }
        }
      }
    },

    // ── Called from result card: find workers for a service ──────
    findWorkers(category) {
      if (typeof closeVoiceModal === 'function') closeVoiceModal();
      const canonicalCategory = normalizeCategory(category || lastResult?.serviceCategory);
      if (typeof selectServiceCategory === 'function') {
        selectServiceCategory(canonicalCategory);
      }
    },

    // ── Direct 1-Click Worker Booking from Voice Modal ────────────
    bookWorker(workerId) {
      if (!workerId) return;
      if (typeof closeVoiceModal === 'function') closeVoiceModal();
      const canonicalCategory = normalizeCategory(lastResult?.serviceCategory);
      const prefill = lastResult
        ? `${lastResult.problem || ''}${lastResult.houseLocation ? ' (' + lastResult.houseLocation + ')' : ''}`.trim()
        : '';

      if (typeof viewWorkerProfile === 'function') {
        viewWorkerProfile(workerId, prefill, canonicalCategory);
      }
    },

    // ── Bind Modal Controls & Listeners ──────────────────────────
    initListeners() {
      if (listenersBound) return;

      const micBtn = document.getElementById('voice-modal-mic');
      if (micBtn) {
        micBtn.onclick = (e) => {
          e.preventDefault();
          this.toggle();
        };
      }

      const tapBtn = document.getElementById('tap-to-speak-btn');
      if (tapBtn) {
        tapBtn.onclick = (e) => {
          e.preventDefault();
          this.toggle();
        };
      }

      // Language buttons
      const langBtns = document.querySelectorAll('#lang-btns button');
      langBtns.forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          const lang = btn.dataset.lang || 'hi-IN';
          this.setLanguage(lang);
        };
      });

      // Quick sample prompt chips
      document.querySelectorAll('.voice-chip-btn').forEach(chip => {
        chip.onclick = (e) => {
          e.preventDefault();
          const sample = chip.dataset.sample || chip.textContent.trim();
          this.analyzeText(sample);
        };
      });

      // Manual text fallback
      const manualInput = document.getElementById('voice-manual-input');
      const manualBtn = document.getElementById('voice-manual-btn');
      if (manualBtn && manualInput) {
        manualBtn.onclick = (e) => {
          e.preventDefault();
          const val = manualInput.value.trim();
          if (val) this.analyzeText(val);
        };
        manualInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const val = manualInput.value.trim();
            if (val) this.analyzeText(val);
          }
        };
      }

      listenersBound = true;
      console.log('[VoiceAI] Modal controls successfully wired');
    },

    // ── Reset Modal State ────────────────────────────────────────
    resetModalUI() {
      isListening = false;
      finalText = '';
      interimText = '';
      updateMicUI(false);
      setStatus("Tell us what's wrong");
      setTranscript('');
      const resEl = document.getElementById('voice-ai-result');
      if (resEl) {
        resEl.style.display = 'none';
        resEl.innerHTML = '';
      }
      const manualInput = document.getElementById('voice-manual-input');
      if (manualInput) manualInput.value = '';
    }
  };

  // ══════════════════════════════════════════════════════════════
  //  PRIVATE: Speech Recognition Event Handlers
  // ══════════════════════════════════════════════════════════════

  function onStart() {
    console.log('[VoiceAI] onstart');
    isListening = true;
    updateMicUI(true);
    setStatus('🎤 Listening... Speak now');
    setTranscript('Listening for your voice...');
    if (typeof showToast === 'function') {
      showToast('🎙️ Listening', 'Speak your problem clearly', 'info', 2500);
    }
  }

  function onResult(e) {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) finalText += ' ' + final;
    interimText = interim;
    const display = (finalText + ' ' + interimText).trim();
    console.log('[VoiceAI] onresult:', display);
    setTranscript('"' + display + '"');
  }

  function onError(e) {
    console.warn('[VoiceAI] onerror:', e.error);
    isListening = false;
    updateMicUI(false);
    const msgs = {
      'not-allowed':         '🔒 Microphone permission was denied. Please allow microphone access or type your problem below.',
      'no-speech':           '🔇 No speech detected. Tap Speak again or use the sample prompts below.',
      'audio-capture':       '🎙️ No microphone found on this device. You can type your request below.',
      'network':             '🌐 Network error during voice recognition. Try again or type below.',
      'aborted':             'Voice capture cancelled.',
      'service-not-allowed': '🔒 Speech service blocked. Check browser permissions or type below.',
    };
    const msg = msgs[e.error] || ('Voice note: ' + e.error);
    setStatus('Ready to Speak');
    setTranscript('⚠️ ' + msg);
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      if (typeof showToast === 'function') showToast('Voice Info', msg, 'warning', 4000);
    }
  }

  function onEnd() {
    console.log('[VoiceAI] onend — finalText="' + finalText.trim() + '"');
    isListening = false;
    updateMicUI(false);

    const text = finalText.trim() || interimText.trim();
    if (text) {
      setStatus('⏳ Analyzing with AI...');
      setTranscript('"' + text + '"');
      analyzeWithBackend(text);
    } else {
      setStatus("Tell us what's wrong");
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  PRIVATE: Multi-Tier AI Analysis Engine
  //  1. Server POST /api/analyze (if backend node server running)
  //  2. Direct Gemini 2.0 Flash Call (if API key saved)
  //  3. Smart Multilingual Keyword Engine (Devanagari Hindi + English)
  // ══════════════════════════════════════════════════════════════

  async function analyzeWithBackend(transcript) {
    // Tier 1: Try server endpoint
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, language: currentLang }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result && !result.error && result.serviceCategory && result.serviceCategory !== 'Other') {
          console.log('[VoiceAI] Server Gemini analysis result:', result);
          lastResult = result;
          setStatus('✅ Problem Identified');
          renderGeminiResult(result, transcript);
          return;
        }
      }
    } catch (err) {
      console.log('[VoiceAI] Server /api/analyze unavailable, proceeding to direct/local AI engine');
    }

    // Tier 2: Direct Gemini API call (Cloud Google Generative AI)
    const clientKey = (typeof window !== 'undefined' && window.GEMINI_API_KEY)
      || localStorage.getItem('snapserve_gemini_key')
      || localStorage.getItem('gemini_api_key');

    if (clientKey) {
      const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-1.5-flash'];
      const prompt = `You are an expert home services assistant for SnapServe in India.
A customer just described their home problem in Hindi (may be in Devanagari script), English, or Hinglish: "${transcript}".
Analyze the problem and respond ONLY with a raw JSON object (NO markdown, NO code block):
{
  "serviceCategory": "Electrical | Plumbing | AC & Appliance Repair | Carpentry | Cleaning | Painting | Pest Control | Other",
  "problem": "Clear 1-line English summary",
  "houseLocation": "Living Room | Bedroom | Kitchen | Bathroom | Full Home | Room",
  "urgency": "High | Medium | Low"
}

Categorization Rules:
1. If the problem is about lights, bulbs, fans, switches, wiring, sockets, power, sparks, MCB, or electricity (e.g. "लाइट नहीं चल रही है", "बिजली चली गई", "पंखा खराब है", "switch spark", "bulb"), serviceCategory MUST be "Electrical".
2. If about water, pipes, taps, leakage, toilets, drains, or tanks (e.g. "नल टपक रहा है", "पानी लीक हो रहा है"), serviceCategory MUST be "Plumbing".
3. If about AC, cooling, fridge, washing machine, microwave, or appliances, serviceCategory MUST be "AC & Appliance Repair".
4. If about wooden doors, locks, almirah, furniture, or carpentry, serviceCategory MUST be "Carpentry".
5. If about cleaning, sofa cleaning, dusting, or mopping, serviceCategory MUST be "Cleaning".
6. If about painting, whitewash, walls, or color, serviceCategory MUST be "Painting".
7. If about pests, insects, cockroaches, rats, or termites, serviceCategory MUST be "Pest Control".
8. Set urgency to "High" for safety/flooding/sparking/emergencies, "Medium" for broken items, "Low" for general cleaning or cosmetic.`;

      for (const model of models) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${clientKey}`;
          const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
            })
          });

          if (geminiRes.ok) {
            const data = await geminiRes.json();
            const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textContent) {
              const cleaned = textContent.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
              const parsed = JSON.parse(cleaned);
              parsed._fallback = false;
              parsed._model = model;
              parsed.serviceCategory = normalizeCategory(parsed.serviceCategory);
              console.log(`[VoiceAI] Successfully analyzed by Gemini (${model}):`, parsed);
              lastResult = parsed;
              setStatus('✅ Problem Identified');
              renderGeminiResult(parsed, transcript);
              return;
            }
          } else {
            console.warn(`[VoiceAI] Gemini ${model} returned status ${geminiRes.status}`);
          }
        } catch (geminiErr) {
          console.warn(`[VoiceAI] Gemini ${model} error:`, geminiErr.message);
        }
      }
    }

    // Tier 3: High-accuracy multilingual local engine (Devanagari Hindi + English + Hinglish)
    const fallback = keywordFallback(transcript);
    fallback._fallback = true;
    lastResult = fallback;
    setStatus('✅ Problem Identified');
    renderGeminiResult(fallback, transcript);
  }

  // ══════════════════════════════════════════════════════════════
  //  PRIVATE: Comprehensive Multilingual Keyword Classifier
  //  Supports Hindi Devanagari script, Hinglish, & English
  // ══════════════════════════════════════════════════════════════

  function keywordFallback(transcript) {
    const lower = transcript.toLowerCase();

    // Specific problem detail generators
    function getProblemDetails(category, text) {
      if (category === 'Electrical') {
        if (text.includes('लाइट') || text.includes('light') || text.includes('बल्ब') || text.includes('bulb') || text.includes('ट्यूबलाइट')) {
          return { problem: 'Light fixture not working / flickering', loc: 'Living Room / Bedroom' };
        }
        if (text.includes('पंखा') || text.includes('fan')) {
          return { problem: 'Ceiling / exhaust fan not functioning', loc: 'Bedroom' };
        }
        if (text.includes('स्विच') || text.includes('switch') || text.includes('सॉकेट') || text.includes('socket') || text.includes('बोर्ड') || text.includes('board')) {
          return { problem: 'Switch board or socket malfunction', loc: 'Room' };
        }
        if (text.includes('करंट') || text.includes('current') || text.includes('शॉर्ट') || text.includes('spark') || text.includes('स्पार्क') || text.includes('shock')) {
          return { problem: 'Sparking / short circuit danger in wiring', loc: 'Room', urgency: 'High' };
        }
        if (text.includes('बिजली') || text.includes('power') || text.includes('mcb') || text.includes('fuse')) {
          return { problem: 'Power outage / tripped MCB breaker', loc: 'Full Home' };
        }
        return { problem: 'Electrical wiring / power supply issue', loc: 'Living Room / Bedroom' };
      }

      if (category === 'Plumbing') {
        if (text.includes('नल') || text.includes('tap') || text.includes('टपक')) {
          return { problem: 'Tap leaking continuously / water loss', loc: 'Kitchen / Bathroom' };
        }
        if (text.includes('पाइप') || text.includes('pipe')) {
          return { problem: 'Water pipe leakage / burst issue', loc: 'Bathroom' };
        }
        if (text.includes('टॉयलेट') || text.includes('कमोड') || text.includes('toilet') || text.includes('flush') || text.includes('फ्लश')) {
          return { problem: 'Toilet flush / drainage blockage', loc: 'Bathroom' };
        }
        if (text.includes('टंकी') || text.includes('tank')) {
          return { problem: 'Overhead water tank leakage / overflow', loc: 'Terrace' };
        }
        return { problem: 'Water leakage & plumbing repair needed', loc: 'Bathroom / Kitchen' };
      }

      if (category === 'AC & Appliance Repair') {
        if (text.includes('एसी') || text.includes('ac') || text.includes('कूलिंग') || text.includes('cool')) {
          return { problem: 'AC not cooling / needs gas refill & filter clean', loc: 'Bedroom' };
        }
        if (text.includes('फ्रिज') || text.includes('fridge') || text.includes('refriger')) {
          return { problem: 'Refrigerator cooling failure / compressor issue', loc: 'Kitchen' };
        }
        if (text.includes('वाशिंग') || text.includes('washing')) {
          return { problem: 'Washing machine drum / motor repair', loc: 'Utility Area' };
        }
        return { problem: 'Home appliance repair & maintenance needed', loc: 'Kitchen / Room' };
      }

      if (category === 'Carpentry') {
        if (text.includes('दरवाजा') || text.includes('door') || text.includes('कब्जा') || text.includes('hinge')) {
          return { problem: 'Door hinge broken / lock alignment issue', loc: 'Room' };
        }
        if (text.includes('अलमारी') || text.includes('almar')) {
          return { problem: 'Wardrobe / almirah drawer repair needed', loc: 'Bedroom' };
        }
        return { problem: 'Furniture woodwork & hardware repair needed', loc: 'Room' };
      }

      if (category === 'Cleaning') {
        if (text.includes('सोफा') || text.includes('कारपेट') || text.includes('sofa') || text.includes('carpet')) {
          return { problem: 'Sofa & upholstery deep cleaning', loc: 'Living Room' };
        }
        if (text.includes('बाथरूम') || text.includes('bathroom')) {
          return { problem: 'Bathroom & tile deep descaling', loc: 'Bathroom' };
        }
        return { problem: 'Full home deep cleaning & sanitization', loc: 'Full Home' };
      }

      if (category === 'Painting') {
        return { problem: 'Wall painting, putty & waterproofing touchup', loc: 'Full Home' };
      }

      if (category === 'Pest Control') {
        return { problem: 'Pest eradication & insect fumigation needed', loc: 'Full Home' };
      }

      return { problem: transcript, loc: 'Home' };
    }

    const rules = [
      {
        cat: 'Electrical',
        keys: [
          // Devanagari Hindi
          'लाइट', 'बिजली', 'करंट', 'पंखा', 'स्विच', 'बोर्ड', 'तार', 'बल्ब', 'सॉकेट', 'शॉर्ट', 'सर्किट',
          'स्पार्क', 'फ्यूज', 'एमसीबी', 'इनवर्टर', 'ट्यूबलाइट', 'कूलर', 'गीजर', 'इलेक्ट्रिक', 'इलेक्ट्रीशियन',
          'शौक', 'वोल्टेज', 'सप्लाई', 'प्लग', 'वायरिंग',
          // Latin / Hinglish / English
          'light', 'bijli', 'socket', 'wire', 'power', 'current', 'switch', 'fuse', 'electric', 'electrical',
          'fan', 'bulb', 'spark', 'mcb', 'short circuit', 'inverter', 'wiring', 'tubelight', 'voltage',
          'breaker', 'plug', 'cooler', 'meter', 'choke', 'sparking'
        ]
      },
      {
        cat: 'Plumbing',
        keys: [
          // Devanagari Hindi
          'नल', 'पानी', 'लीक', 'लीकेज', 'पाइप', 'प्लम्बर', 'टॉयलेट', 'बाथरूम', 'ड्रेन', 'शावर',
          'वॉशबेसिन', 'सिंक', 'सीवर', 'गटर', 'टैंक', 'टंकी', 'फ्लश', 'जाम', 'बह', 'टपक', 'नलका', 'कमोड',
          // Latin / Hinglish / English
          'nal', 'water', 'leak', 'leaking', 'pipe', 'plumb', 'plumber', 'plumbing', 'pani', 'toilet',
          'drain', 'drainage', 'shower', 'bathroom', 'sink', 'flush', 'sewer', 'tank', 'tanki', 'overflow',
          'blockage', 'choked', 'tapak', 'tap'
        ]
      },
      {
        cat: 'AC & Appliance Repair',
        keys: [
          // Devanagari Hindi
          'एसी', 'कूलिंग', 'ठंडा', 'गैस', 'कंप्रेसर', 'फ्रिज', 'रेफ्रिजरेटर', 'टीवी', 'वाशिंग', 'मशीन',
          'माइक्रोवेव', 'ओवन', 'मिक्सर', 'हीटर', 'एप्लायंस', 'फ्रीजर',
          // Latin / Hinglish / English
          'ac', 'cool', 'cooling', 'air condition', 'air conditioner', 'conditioning', 'thanda', 'split',
          'gas', 'compressor', 'filter', 'fridge', 'refrigerator', 'tv', 'television', 'washing machine',
          'appliance', 'microwave', 'oven', 'mixer', 'heater', 'freezer'
        ]
      },
      {
        cat: 'Carpentry',
        keys: [
          // Devanagari Hindi
          'दरवाजा', 'लकड़ी', 'लकडी', 'फर्नीचर', 'अलमारी', 'कारपेंटर', 'मेज', 'कुर्सी', 'टेबल', 'कब्जा',
          'ताला', 'लॉक', 'हैंडल', 'दराज', 'बेड', 'पलंग', 'खिड़की',
          // Latin / Hinglish / English
          'wood', 'door', 'darwaza', 'almar', 'almari', 'furniture', 'carpenter', 'table', 'chair',
          'hinge', 'lakdi', 'bed', 'handle', 'lock', 'drawer', 'cabinet', 'palang', 'khidki', 'window'
        ]
      },
      {
        cat: 'Cleaning',
        keys: [
          // Devanagari Hindi
          'सफाई', 'साफ', 'धुलाई', 'धोना', 'झाड़ू', 'झाडू', 'पोछा', 'डस्टिंग', 'गंदगी', 'कचरा', 'डीप क्लीन',
          'कारपेट', 'क्लीनिंग', 'क्लीनर',
          // Latin / Hinglish / English
          'saaf', 'clean', 'dust', 'wash', 'mop', 'vacuum', 'safai', 'pocha', 'deep clean', 'sofa',
          'carpet', 'kitchen clean', 'bathroom clean', 'jhadu', 'cleaning'
        ]
      },
      {
        cat: 'Painting',
        keys: [
          // Devanagari Hindi
          'पेंट', 'कलर', 'रंग', 'दीवार', 'पुट्टी', 'सफेदी', 'व्हाइटवॉश', 'पेंटिंग', 'छत', 'सीलन',
          // Latin / Hinglish / English
          'paint', 'wall', 'color', 'colour', 'whitewash', 'rang', 'putty', 'deewar', 'ceiling',
          'painter', 'seelan', 'dampness'
        ]
      },
      {
        cat: 'Pest Control',
        keys: [
          // Devanagari Hindi
          'कीड़े', 'कीड़ा', 'कॉकरोच', 'चूहा', 'चूहे', 'खटमल', 'दीमक', 'मच्छर', 'मक्खी', 'चींटी', 'पेस्ट कंट्रोल',
          // Latin / Hinglish / English
          'pest', 'cockroach', 'rat', 'chuha', 'bug', 'khatmal', 'termite', 'deemak', 'mosquito',
          'machhar', 'keeda', 'ant', 'pest control'
        ]
      }
    ];

    for (const r of rules) {
      if (r.keys.some(k => lower.includes(k))) {
        const details = getProblemDetails(r.cat, lower);
        const urgent = ['leak', 'burst', 'flood', 'fire', 'shock', 'spark', 'emergency', 'short circuit', 'current', 'dhuan', 'धुआं', 'शॉर्ट', 'स्पार्क', 'करंट', 'आग'].some(w => lower.includes(w));
        return {
          serviceCategory: r.cat,
          problem: details.problem,
          houseLocation: details.loc,
          urgency: details.urgency || (urgent ? 'High' : 'Medium')
        };
      }
    }

    return {
      serviceCategory: 'Other',
      problem: transcript.length > 50 ? transcript.slice(0, 50) + '...' : transcript,
      houseLocation: 'Home',
      urgency: 'Medium'
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  PRIVATE: Render Structured Analysis Result
  // ══════════════════════════════════════════════════════════════

  function renderGeminiResult(result, transcript) {
    const el = document.getElementById('voice-ai-result');
    if (!el) return;

    const canonicalCat = normalizeCategory(result.serviceCategory);
    result.serviceCategory = canonicalCat;

    const svc = (typeof Utils !== 'undefined' && Utils.getService)
      ? Utils.getService(canonicalCat)
      : (typeof MockData !== 'undefined' ? MockData.services.find(s => s.name === canonicalCat || s.id === canonicalCat) : null);

    const emoji = svc ? svc.emoji : '⚡';
    const activeWorkers = (typeof CustomerState !== 'undefined' && CustomerState.workers)
      ? CustomerState.workers.filter(w => 
          (w.services || []).some(s => 
            s.category.toLowerCase().includes(canonicalCat.toLowerCase()) || 
            canonicalCat.toLowerCase().includes(s.category.toLowerCase())
          )
        )
      : [];
    const workersCount = activeWorkers.length;
    const formatPrice = (typeof Utils !== 'undefined' && Utils.formatPrice)
      ? Utils.formatPrice
      : (p) => '₹' + p;

    let subText = '';
    if (workersCount > 0) {
      const prices = activeWorkers.map(w => {
        const s = (w.services || []).find(sv => 
          sv.category.toLowerCase().includes(canonicalCat.toLowerCase()) || 
          canonicalCat.toLowerCase().includes(sv.category.toLowerCase())
        );
        return s ? Number(s.basePrice) : null;
      }).filter(p => p !== null && !isNaN(p));
      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
      subText = minPrice ? `${workersCount} verified worker(s) nearby · from ${formatPrice(minPrice)}` : `${workersCount} verified worker(s) nearby`;
    } else {
      subText = 'Verified professionals available upon request';
    }

    const urgBadge = result.urgency === 'High' ? 'badge-danger'
                   : result.urgency === 'Low'  ? 'badge-success'
                   : 'badge-warning';

    const urgIcon = result.urgency === 'High' ? '🔴'
                  : result.urgency === 'Low'  ? '🟢'
                  : '🟡';

    const fallbackNote = result._fallback
      ? `<div style="font-size:10px;color:#888;margin-top:8px;text-align:center;font-style:italic">
           ⚡ Analyzed by SnapServe Multilingual Engine
         </div>`
      : `<div style="font-size:10px;color:#22C55E;margin-top:8px;text-align:center;font-weight:700">
           ✨ Analyzed by Google Gemini AI (${result._model || 'gemini-2.0-flash'})
         </div>`;

    // Render 1-2 top matching worker quick cards if available
    let workerQuickCards = '';
    if (workersCount > 0) {
      const topWorkers = activeWorkers.slice(0, 2);
      workerQuickCards = `
        <div style="margin-top:12px;text-align:left">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">
            Available Verified Professionals:
          </div>
          ${topWorkers.map(w => {
            const specificSvc = (w.services || []).find(s => s.category.toLowerCase().includes(canonicalCat.toLowerCase()) || canonicalCat.toLowerCase().includes(s.category.toLowerCase())) || w.services[0] || {};
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:28px;height:28px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#fff">
                    ${(w.name || 'W').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style="font-size:12px;font-weight:800;color:#fff">${w.name}</div>
                    <div style="font-size:10px;color:var(--text-muted)">${w.location || 'Local'} · ${specificSvc.specificWork || canonicalCat}</div>
                  </div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" onclick="VoiceAI.bookWorker('${w.id}')" style="font-size:11px;padding:5px 10px;border-radius:8px">
                  Book · ${formatPrice(specificSvc.basePrice || 300)}
                </button>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    el.style.display = 'block';
    el.innerHTML = `
      <div style="background:linear-gradient(135deg,#1C0E05 0%,#2B1305 50%,#1A0A02 100%);border:1px solid rgba(255,107,0,0.35);border-radius:20px;padding:18px;margin-top:14px;animation:fadeInUp 0.35s ease;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(255,107,0,0.8),rgba(232,184,75,0.6),transparent)"></div>

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div style="width:8px;height:8px;border-radius:50%;background:#22C55E;box-shadow:0 0 8px #22C55E"></div>
          <span style="font-size:12px;font-weight:800;color:#22C55E;letter-spacing:0.02em">✓ Problem Identified</span>
          <span class="badge ${urgBadge}" style="font-size:10px;margin-left:auto">${urgIcon} ${result.urgency} Urgency</span>
        </div>

        <!-- Service Category -->
        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.2);border-radius:14px;margin-bottom:12px">
          <span style="font-size:34px;line-height:1">${emoji}</span>
          <div style="flex:1">
            <div style="font-size:17px;font-weight:800;color:#fff">${canonicalCat}</div>
            <div style="font-size:11px;color:#aaa">${subText}</div>
          </div>
        </div>

        <!-- Details Grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:10px">
            <div style="font-size:9px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">Problem</div>
            <div style="font-size:12px;font-weight:600;color:#fff;line-height:1.3">${result.problem}</div>
          </div>
          <div style="padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:10px">
            <div style="font-size:9px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">Location</div>
            <div style="font-size:12px;font-weight:600;color:#fff">📍 ${result.houseLocation}</div>
          </div>
        </div>

        <!-- Transcript -->
        <div style="padding:8px 10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:12px;font-size:11px;color:#bbb;text-align:left">
          <strong style="color:#FF8C3A">You said:</strong> "${transcript}"
        </div>

        <!-- Nearby Worker Quick Cards (if available) -->
        ${workerQuickCards}

        <!-- Action Buttons -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;margin-bottom:8px">
          <button type="button" class="btn btn-primary" onclick="VoiceAI.confirmResult()" style="font-size:12px;padding:10px;border-radius:10px">
            ✓ Find Workers
          </button>
          <button type="button" class="btn btn-ghost" onclick="VoiceAI.editResult()" style="font-size:12px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12)">
            ✏️ Try Again
          </button>
        </div>

        ${fallbackNote}
      </div>
    `;

    if (typeof showToast === 'function') {
      showToast('✅ ' + canonicalCat, result.problem, 'success', 3500);
    }
  }

  // ── UI Helpers ───────────────────────────────────────────────

  function setStatus(text) {
    const el = document.getElementById('vm-status');
    if (el) el.textContent = text;
  }

  function setTranscript(text) {
    const box = document.getElementById('voice-transcript-box');
    if (!box) return;
    box.style.display = text ? 'block' : 'none';
    box.textContent = text;
    box.style.borderColor = text && text.startsWith('⚠️') ? 'var(--danger,#e53e3e)' : 'rgba(255,107,0,0.4)';
  }

  function updateMicUI(listening) {
    const micBtn = document.getElementById('voice-modal-mic');
    if (micBtn) {
      micBtn.style.background = listening ? 'linear-gradient(135deg, #E8B84B, #FF6B00)' : '';
      micBtn.style.boxShadow  = listening ? '0 0 32px rgba(255,107,0,0.8), 0 0 16px rgba(232,184,75,0.6)' : '';
      micBtn.style.transform  = listening ? 'scale(1.12)' : '';
      micBtn.innerHTML = listening ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-microphone"></i>';
      micBtn.setAttribute('aria-label', listening ? 'Stop Listening' : 'Start Listening');
    }

    const ring1 = document.getElementById('vm-ring-1');
    const ring2 = document.getElementById('vm-ring-2');
    if (ring1) { ring1.style.opacity = listening ? '1' : '0'; }
    if (ring2) { ring2.style.opacity = listening ? '1' : '0'; }

    const tapBtn = document.getElementById('tap-to-speak-btn');
    if (tapBtn) {
      if (listening) {
        tapBtn.innerHTML = '<i class="fa-solid fa-stop"></i> STOP LISTENING';
        tapBtn.className = 'btn btn-ghost btn-full';
        tapBtn.style.color = 'var(--primary-light,#FF8C3A)';
        tapBtn.style.borderColor = 'rgba(255,107,0,0.4)';
      } else {
        tapBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> TAP TO SPEAK';
        tapBtn.className = 'btn btn-primary btn-full';
        tapBtn.style.color = '';
        tapBtn.style.borderColor = '';
      }
    }
  }

  return api;
})();

// ── Global Modal Open / Close Helpers ─────────────────────────
window.openVoiceModal = function() {
  VoiceAI.initListeners();
  VoiceAI.resetModalUI();

  if (typeof openModal === 'function') {
    openModal('voice-modal');
  } else {
    const modal = document.getElementById('voice-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('open', 'modal-open');
    }
  }
};

window.closeVoiceModal = function() {
  if (VoiceAI.isListening) {
    VoiceAI.stop();
  }
  if (typeof closeModal === 'function') {
    closeModal('voice-modal');
  } else {
    const modal = document.getElementById('voice-modal');
    if (modal) {
      modal.classList.remove('modal-open', 'open');
      setTimeout(() => { modal.style.display = 'none'; }, 200);
    }
  }
};

// ── Auto-initialize when DOM is ready ─────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  VoiceAI.initListeners();
});

window.VoiceAI = VoiceAI;
