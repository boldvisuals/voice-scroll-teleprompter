/* SpeechRecognition wrapper (Web Speech API).
 *
 * Chrome/Edge desktop + Android Chrome only, and only in a secure context
 * (https or localhost). Cloud-backed on Android — needs network (see README).
 *
 * window.VSTVoice = { supported, start, stop, isListening }
 * Callbacks passed to start():
 *   onResult(transcript, isFinal)
 *   onError(code)   // 'not-allowed' = mic denied; degrade to manual
 *   onState(listening)
 */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SR && window.isSecureContext;

  let rec = null;
  let listening = false;
  let shouldRun = false;
  let cbs = {};

  function build(lang) {
    const r = new SR();
    r.lang = lang || 'en-GB';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        cbs.onResult && cbs.onResult(res[0].transcript, res.isFinal);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // benign
      cbs.onError && cbs.onError(e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        shouldRun = false;
      }
    };
    r.onend = () => {
      listening = false;
      cbs.onState && cbs.onState(false);
      // Chrome ends the session periodically; relaunch while we still want it.
      if (shouldRun) { try { r.start(); listening = true; cbs.onState && cbs.onState(true); } catch (_) {} }
    };
    return r;
  }

  function start(lang, callbacks) {
    if (!supported) return false;
    cbs = callbacks || {};
    shouldRun = true;
    rec = build(lang);
    try { rec.start(); listening = true; cbs.onState && cbs.onState(true); }
    catch (_) { /* already started */ }
    return true;
  }

  function stop() {
    shouldRun = false;
    if (rec) { try { rec.stop(); } catch (_) {} }
    listening = false;
  }

  window.VSTVoice = {
    supported,
    start,
    stop,
    get isListening() { return listening; },
  };
})();
