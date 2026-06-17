/* Voice-Scroll Teleprompter — main controller.
 *
 * Scroll is position-driven (scrollTop is the single source of truth):
 *   - MANUAL mode advances scrollTop at a constant px/sec.
 *   - VOICE mode sets a *target* scrollTop from the matched word and the same
 *     loop eases toward it; off-script ⇒ target holds ⇒ scroll holds.
 */

const $ = (s) => document.querySelector(s);

const els = {
  setup: $('#setup'),
  prompter: $('#prompter'),
  picker: $('#picker'),
  pickerSource: $('#picker-source'),
  scriptInput: $('#script-input'),
  fontSize: $('#font-size'),
  speed: $('#speed'),
  readlinePos: $('#readline-pos'),
  colWidth: $('#col-width'),
  lineHeight: $('#line-height'),
  themeChips: $('#theme-chips'),
  voiceMode: $('#voice-mode'),
  countdownOn: $('#countdown-on'),
  voiceNote: $('#voice-note'),
  mirrorH: $('#mirror-h'),
  mirrorV: $('#mirror-v'),
  startBtn: $('#start-btn'),
  scrollArea: $('#scroll-area'),
  scriptText: $('#script-text'),
  hud: $('#hud'),
  speedCtl: $('#speed-ctl'),
  hudSpeed: $('#hud-speed'),
  micBtn: $('#mic-btn'),
  prevBtn: $('#prev-btn'),
  nextBtn: $('#next-btn'),
  playPause: $('#playpause-btn'),
  restart: $('#restart-btn'),
  exit: $('#exit-btn'),
  scrub: $('#scrub'),
  status: $('#status-badge'),
  countdown: $('#countdown'),
  progress: $('#progress'),
};

const state = {
  running: false,
  playing: false,
  mode: 'manual',      // 'manual' | 'voice'
  pxPerSec: 90,
  readlineFrac: 0.38,
  theme: 'wb',
  target: 0,           // voice-mode target scrollTop
  lastFrame: 0,
  words: [],           // [{ el, norm }] for matching
  paraStarts: [],      // word indices that begin a paragraph
  lastReadIdx: -1,
  progAccum: 0,        // throttle for progress readout
  wakeLock: null,
  hudDimTimer: null,
};

/* ---------- Settings persistence ---------- */
const SETTINGS_KEY = 'vst.settings.v1';
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.script) els.scriptInput.value = s.script;
    if (s.fontSize) els.fontSize.value = s.fontSize;
    if (s.speed) els.speed.value = s.speed;
    if (s.readlinePos) els.readlinePos.value = s.readlinePos;
    if (s.colWidth) els.colWidth.value = s.colWidth;
    if (s.lineHeight) els.lineHeight.value = s.lineHeight;
    if (s.theme) state.theme = s.theme;
    els.voiceMode.checked = !!s.voiceMode;
    els.countdownOn.checked = s.countdownOn !== false; // default on
    els.mirrorH.checked = !!s.mirrorH;
    els.mirrorV.checked = !!s.mirrorV;
  } catch (_) {}
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    script: els.scriptInput.value,
    fontSize: els.fontSize.value,
    speed: els.speed.value,
    readlinePos: els.readlinePos.value,
    colWidth: els.colWidth.value,
    lineHeight: els.lineHeight.value,
    theme: state.theme,
    voiceMode: els.voiceMode.checked,
    countdownOn: els.countdownOn.checked,
    mirrorH: els.mirrorH.checked,
    mirrorV: els.mirrorV.checked,
  }));
}

/* ---------- Script rendering (word spans + paragraph anchors) ---------- */
function buildScript(text) {
  els.scriptText.textContent = '';
  state.words = [];
  state.paraStarts = [];
  state.lastReadIdx = -1;
  const norm = (window.VSTMatcher && window.VSTMatcher.normalizeToken)
    || ((s) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''));
  let paraPending = true; // first word starts a paragraph
  const parts = (text || '').split(/(\s+)/);
  for (const part of parts) {
    if (part === '') continue;
    if (/^\s+$/.test(part)) {
      els.scriptText.appendChild(document.createTextNode(part));
      if (part.indexOf('\n') !== -1) paraPending = true;
    } else {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = part;
      const n = norm(part);
      if (n) {
        if (paraPending) { state.paraStarts.push(state.words.length); paraPending = false; }
        span.dataset.mi = String(state.words.length);
        state.words.push({ el: span, norm: n });
      }
      els.scriptText.appendChild(span);
    }
  }
  if (window.VSTMatcher) window.VSTMatcher.setWords(state.words);
  els.scrollArea.scrollTop = 0;
  state.target = 0;
}

/* ---------- Wake lock ---------- */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch (_) {}
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running) requestWakeLock();
});

/* ---------- Look ---------- */
function applyMirror() {
  document.body.classList.toggle('mirror-h', els.mirrorH.checked);
  document.body.classList.toggle('mirror-v', els.mirrorV.checked);
}
function applyFontSize() {
  els.scriptText.style.setProperty('--prompter-font', els.fontSize.value + 'px');
}
// Single source of truth for speed; keeps both steppers (setup + HUD) in sync.
function setSpeed(v) {
  const val = setStep('speed', v, false);
  setStep('hud-speed', val, false);
  state.pxPerSec = val;
}
function applySpeed() { setSpeed(readStep('speed')); }
function applyReadline() {
  state.readlineFrac = Number(els.readlinePos.value) / 100;
  document.documentElement.style.setProperty('--readline-top', els.readlinePos.value + 'vh');
}
function applyColWidth() {
  document.documentElement.style.setProperty('--col-width', els.colWidth.value + 'vw');
}
function applyLineHeight() {
  document.documentElement.style.setProperty('--line-height', String(Number(els.lineHeight.value) / 100));
}
function applyTheme() {
  document.body.classList.remove('theme-amber', 'theme-hc');
  if (state.theme === 'amber') document.body.classList.add('theme-amber');
  else if (state.theme === 'hc') document.body.classList.add('theme-hc');
  els.themeChips.querySelectorAll('.theme-chip').forEach((c) =>
    c.classList.toggle('selected', c.dataset.theme === state.theme));
}

/* ---------- Scroll engine ---------- */
function maxScroll() {
  return Math.max(0, els.scrollArea.scrollHeight - els.scrollArea.clientHeight);
}
function readlineOffset() { return els.scrollArea.clientHeight * state.readlineFrac; }

function tick(now) {
  if (!state.running) return;
  const dt = state.lastFrame ? (now - state.lastFrame) / 1000 : 0;
  state.lastFrame = now;

  if (state.playing && dt > 0) {
    if (state.mode === 'voice') {
      const cur = els.scrollArea.scrollTop;
      const diff = state.target - cur;
      if (Math.abs(diff) > 0.5) {
        // time-based ease; higher factor = snappier catch-up to the spoken word
        els.scrollArea.scrollTop = cur + diff * Math.min(1, dt * 11);
        syncScrub();
      }
    } else {
      const next = els.scrollArea.scrollTop + state.pxPerSec * dt;
      const max = maxScroll();
      els.scrollArea.scrollTop = Math.min(next, max);
      syncScrub();
      if (next >= max) setPlaying(false);
    }
  }

  state.progAccum += dt;
  if (state.progAccum > 0.25) { state.progAccum = 0; updateProgress(); }
  requestAnimationFrame(tick);
}
function syncScrub() {
  const max = maxScroll();
  els.scrub.value = max > 0 ? Math.round((els.scrollArea.scrollTop / max) * 1000) : 0;
}

/* ---------- Progress readout ---------- */
function updateProgress() {
  const max = maxScroll();
  const pct = max > 0 ? Math.round((els.scrollArea.scrollTop / max) * 100) : 0;
  const total = state.words.length;
  const done = state.mode === 'voice'
    ? Math.max(0, state.lastReadIdx + 1)
    : Math.round((pct / 100) * total);
  const left = Math.max(0, total - done);
  let txt = `${pct}% · ${left}w`;
  if (state.mode === 'manual' && state.pxPerSec > 0) {
    const secs = Math.round((max - els.scrollArea.scrollTop) / state.pxPerSec);
    const mm = String(Math.floor(secs / 60)).padStart(1, '0');
    const ss = String(secs % 60).padStart(2, '0');
    txt += ` · ${mm}:${ss}`;
  }
  els.progress.textContent = txt;
}

/* ---------- Voice integration ---------- */
function onVoiceResult(transcript, isFinal) {
  const el = window.VSTMatcher.feed(transcript, isFinal);
  if (el) {
    state.target = Math.max(0, Math.min(el.offsetTop - readlineOffset(), maxScroll()));
    markRead(Number(el.dataset.mi));
  }
}
function markRead(idx) {
  if (idx === state.lastReadIdx) return;
  if (idx > state.lastReadIdx) {
    for (let i = state.lastReadIdx + 1; i <= idx; i++) state.words[i] && state.words[i].el.classList.add('read');
  } else {
    for (let i = idx + 1; i <= state.lastReadIdx; i++) state.words[i] && state.words[i].el.classList.remove('read');
  }
  state.lastReadIdx = idx;
}
function startVoice() {
  if (!window.VSTVoice.supported) { showStatus('Voice not supported here', true); return; }
  const ok = window.VSTVoice.start((window.VST_CONFIG || {}).voiceLang, {
    onResult: onVoiceResult,
    onError: (code) => {
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        showStatus('Mic blocked — using manual', true);
        els.micBtn.classList.remove('live');
      }
    },
    onState: (listening) => els.micBtn.classList.toggle('live', listening),
  });
  if (ok) showStatus('Listening — read aloud', false, 1800);
}
function stopVoice() { window.VSTVoice.stop(); els.micBtn.classList.remove('live'); }
function toggleVoice() {
  if (window.VSTVoice.isListening) { stopVoice(); showStatus('Voice off', false, 1200); }
  else startVoice();
}

/* ---------- Play / pause / restart / paragraph jump ---------- */
function setPlaying(on) {
  state.playing = on;
  els.playPause.innerHTML = on ? '&#9208;' : '&#9205;';
  if (!on) showStatus('Paused — tap to resume', false);
  else hideStatus();
}
function togglePlay() { setPlaying(!state.playing); }

function restart() {
  els.scrollArea.scrollTop = 0;
  state.target = 0;
  if (window.VSTMatcher) window.VSTMatcher.reset();
  markRead(-1);
  syncScrub();
  setPlaying(state.mode === 'voice'); // voice resumes following; manual waits
}

// Jump to the previous/next paragraph anchor (Bluetooth clicker friendly).
function jumpParagraph(dir) {
  if (!state.words.length) return;
  const ref = els.scrollArea.scrollTop + readlineOffset();
  const eps = 4;
  let targetIdx = null;
  if (dir > 0) {
    for (const wi of state.paraStarts) {
      if (state.words[wi].el.offsetTop > ref + eps) { targetIdx = wi; break; }
    }
  } else {
    for (let k = state.paraStarts.length - 1; k >= 0; k--) {
      const wi = state.paraStarts[k];
      if (state.words[wi].el.offsetTop < ref - eps) { targetIdx = wi; break; }
    }
  }
  if (targetIdx == null) targetIdx = dir > 0 ? state.words.length - 1 : 0;
  const top = Math.max(0, Math.min(state.words[targetIdx].el.offsetTop - readlineOffset(), maxScroll()));
  els.scrollArea.scrollTop = top;
  state.target = top;
  if (state.mode === 'voice') { window.VSTMatcher.seekToWordIndex(targetIdx); markRead(targetIdx - 1); }
  syncScrub();
  flashHud();
}

/* ---------- Status badge + HUD ---------- */
let statusTimer = null;
function showStatus(text, warn, autohideMs) {
  els.status.textContent = text;
  els.status.classList.toggle('warn', !!warn);
  els.status.classList.remove('hidden');
  clearTimeout(statusTimer);
  if (autohideMs) statusTimer = setTimeout(hideStatus, autohideMs);
}
function hideStatus() { els.status.classList.add('hidden'); }
// Reveal the control bar, then auto-hide it after a few seconds.
function flashHud() {
  els.hud.classList.remove('dim');
  clearTimeout(state.hudDimTimer);
  state.hudDimTimer = setTimeout(() => els.hud.classList.add('dim'), 2800);
}
function hideHud() { clearTimeout(state.hudDimTimer); els.hud.classList.add('dim'); }

/* ---------- Lead-in countdown ---------- */
function runCountdown(done) {
  els.countdown.classList.remove('hidden');
  let c = 3;
  els.countdown.textContent = c;
  const step = () => {
    c -= 1;
    if (c <= 0) { els.countdown.classList.add('hidden'); done(); }
    else { els.countdown.textContent = c; setTimeout(step, 800); }
  };
  setTimeout(step, 800);
}

/* ---------- Enter / exit ---------- */
async function startPrompter() {
  saveSettings();
  state.mode = els.voiceMode.checked && window.VSTVoice.supported ? 'voice' : 'manual';
  buildScript(els.scriptInput.value);
  els.scriptText.classList.toggle('voice', state.mode === 'voice');
  applyFontSize();
  applySpeed();
  applyReadline();
  applyColWidth();
  applyLineHeight();
  applyTheme();
  applyMirror();

  els.setup.classList.add('hidden');
  els.prompter.classList.remove('hidden');
  els.micBtn.classList.toggle('hidden', state.mode !== 'voice');
  els.speedCtl.classList.toggle('hidden', state.mode !== 'manual'); // speed is inert in voice mode
  setStep('hud-speed', readStep('speed'), false);
  els.progress.classList.remove('hidden');
  state.running = true;
  state.playing = false;
  state.lastFrame = 0;

  try { await document.documentElement.requestFullscreen(); } catch (_) {}
  await requestWakeLock();
  syncScrub();
  updateProgress();
  requestAnimationFrame(tick);

  const begin = () => {
    hideHud(); // clean reading screen — controls reappear on tap
    if (state.mode === 'voice') { setPlaying(true); startVoice(); }
    else setPlaying(true);
  };
  if (els.countdownOn.checked) {
    hideHud();              // keep controls hidden through the count-in
    runCountdown(begin);
  } else if (state.mode === 'voice') {
    hideHud();
    setPlaying(true); startVoice();
  } else {
    setPlaying(false);
    showStatus('Tap to start', false); // manual waits for a beat
    flashHud();                         // show controls so the user can begin
  }
}
function exitPrompter() {
  state.running = false;
  setPlaying(false);
  stopVoice();
  releaseWakeLock();
  els.countdown.classList.add('hidden');
  els.progress.classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  els.prompter.classList.add('hidden');
  els.setup.classList.remove('hidden');
  hideStatus();
}

/* ---------- Scrub: live scroll on drag, voice re-seat on release ---------- */
function scrubScroll() {
  const max = maxScroll();
  els.scrollArea.scrollTop = (Number(els.scrub.value) / 1000) * max;
  state.target = els.scrollArea.scrollTop;
}
function scrubReseat() {
  if (state.mode !== 'voice' || !state.words.length) return;
  const aim = els.scrollArea.scrollTop + readlineOffset();
  let best = 0, bestD = Infinity;
  for (let i = 0; i < state.words.length; i++) {
    const d = Math.abs(state.words[i].el.offsetTop - aim);
    if (d < bestD) { bestD = d; best = i; }
  }
  window.VSTMatcher.seekToWordIndex(best);
  markRead(best - 1);
}

/* ---------- Picker (Phase 2) ---------- */
async function buildPicker() {
  if (!window.VSTPreload) return;
  try {
    const { scripts, source, error } = await window.VSTPreload.loadManifest();
    els.pickerSource.textContent = error ? '(offline / none)' : `(${source})`;
    if (!scripts.length) {
      els.picker.innerHTML = '<p class="picker-empty">No scripts found — paste one below.</p>';
      return;
    }
    els.picker.innerHTML = '';
    for (const s of scripts) {
      const item = document.createElement('button');
      item.className = 'script-item';
      item.innerHTML = `<span>${escapeHtml(s.title || s.id)}</span><span class="meta">${escapeHtml(s.updated || '')}</span>`;
      item.addEventListener('click', async () => {
        document.querySelectorAll('.script-item').forEach((n) => n.classList.remove('selected'));
        item.classList.add('selected');
        const label = item.querySelector('span');
        label.textContent = (s.title || s.id) + ' — loading…';
        const body = await window.VSTPreload.getBody(s);
        els.scriptInput.value = body;
        label.textContent = s.title || s.id;
        saveSettings();
      });
      els.picker.appendChild(item);
    }
  } catch (e) {
    els.picker.innerHTML = '<p class="picker-empty">Could not load scripts — paste one below.</p>';
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- Voice availability note ---------- */
function updateVoiceNote() {
  if (!els.voiceMode.checked) { els.voiceNote.classList.add('hidden'); return; }
  let msg;
  if (!window.VSTVoice.supported) {
    msg = window.isSecureContext
      ? 'Voice needs Chrome / Edge. Falling back to manual scroll.'
      : 'Voice needs https or localhost (secure context). Falling back to manual.';
  } else {
    msg = 'Voice is cloud-based on Android — needs a network connection. Manual speed stays available.';
  }
  els.voiceNote.textContent = msg;
  els.voiceNote.classList.remove('hidden');
}

/* ---------- Number steppers (−  value  +) ---------- */
function readStep(id) { return Number(document.getElementById(id).value); }
function fmtStepper(st, v) {
  const scale = Number(st.dataset.scale || 1);
  const unit = st.dataset.unit || '';
  const shown = scale !== 1 ? (v / scale).toFixed(1) : String(v);
  const vEl = st.querySelector('.step-val');
  if (vEl) vEl.textContent = shown + unit;
}
function setStep(id, v, fire) {
  const inp = document.getElementById(id);
  const st = inp.closest('.stepper');
  const min = Number(st.dataset.min), max = Number(st.dataset.max);
  v = Math.max(min, Math.min(max, Math.round(Number(v))));
  inp.value = v;
  fmtStepper(st, v);
  if (fire) inp.dispatchEvent(new Event('input'));
  return v;
}
function wireSteppers() {
  document.querySelectorAll('.stepper').forEach((st) => {
    const id = st.dataset.target;
    const step = Number(st.dataset.step || 1);
    fmtStepper(st, readStep(id));
    const dn = st.querySelector('.step-dn');
    const up = st.querySelector('.step-up');
    dn && dn.addEventListener('click', (e) => { e.stopPropagation(); setStep(id, readStep(id) - step, true); flashHud(); });
    up && up.addEventListener('click', (e) => { e.stopPropagation(); setStep(id, readStep(id) + step, true); flashHud(); });
  });
}

/* ---------- Event wiring ---------- */
els.startBtn.addEventListener('click', startPrompter);
els.exit.addEventListener('click', exitPrompter);
els.restart.addEventListener('click', (e) => { e.stopPropagation(); restart(); flashHud(); });
els.playPause.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); flashHud(); });
els.micBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleVoice(); flashHud(); });
els.prevBtn.addEventListener('click', (e) => { e.stopPropagation(); jumpParagraph(-1); });
els.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); jumpParagraph(1); });

els.fontSize.addEventListener('input', applyFontSize);
els.speed.addEventListener('input', applySpeed);
els.hudSpeed.addEventListener('input', (e) => { e.stopPropagation(); setSpeed(els.hudSpeed.value); flashHud(); });
els.readlinePos.addEventListener('input', applyReadline);
els.colWidth.addEventListener('input', applyColWidth);
els.lineHeight.addEventListener('input', applyLineHeight);
els.mirrorH.addEventListener('change', applyMirror);
els.mirrorV.addEventListener('change', applyMirror);
els.voiceMode.addEventListener('change', updateVoiceNote);
els.themeChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.theme-chip');
  if (!chip) return;
  state.theme = chip.dataset.theme;
  applyTheme();
  saveSettings();
});

els.scrub.addEventListener('input', (e) => { e.stopPropagation(); scrubScroll(); flashHud(); });
els.scrub.addEventListener('change', (e) => { e.stopPropagation(); scrubReseat(); });

els.prompter.addEventListener('click', (e) => {
  if (els.hud.contains(e.target)) return;
  togglePlay();
  flashHud();
});

document.addEventListener('keydown', (e) => {
  if (!state.running) return;
  switch (e.key) {
    case ' ': case 'Enter': case 'b': case 'B': // space / clicker buttons
      e.preventDefault(); togglePlay(); flashHud(); break;
    case 'ArrowUp': setSpeed(state.pxPerSec + 5); flashHud(); break;
    case 'ArrowDown': setSpeed(state.pxPerSec - 5); flashHud(); break;
    case 'PageDown': case 'ArrowRight': e.preventDefault(); jumpParagraph(1); break;
    case 'PageUp': case 'ArrowLeft': e.preventDefault(); jumpParagraph(-1); break;
    case 'm': case 'M': if (state.mode === 'voice') toggleVoice(); break;
    case 'r': case 'R': restart(); flashHud(); break;
    case 'Escape': exitPrompter(); break;
  }
});

/* ---------- Service worker (Phase 3) ---------- */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

/* ---------- Boot ---------- */
loadSettings();
wireSteppers();
applyFontSize();
applyReadline();
applyColWidth();
applyLineHeight();
applyTheme();
updateVoiceNote();
buildPicker();
