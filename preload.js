/* Phase 2 — preload-on-load.
 *
 * On launch: fetch the manifest (config.manifestUrl), cache it + bodies in
 * IndexedDB for offline + instant reopen, and expose the script list. Bodies
 * may be inline (`body`) or referenced (`path`, fetched lazily on select).
 *
 * Falls back to the cached manifest when offline / fetch fails.
 *
 * window.VSTPreload = { loadManifest, getBody }
 */
(function () {
  const cfg = window.VST_CONFIG || {};
  const MANIFEST_KEY = 'manifest';
  const bodyKey = (id) => 'body:' + id;

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // Returns { scripts: [...], source: 'network'|'cache'|'drive', error? }
  async function loadManifest() {
    // Phase 4 hook: if Drive is enabled and ready, prefer it.
    if (cfg.drive && cfg.drive.enabled && window.VSTDrive) {
      try {
        const scripts = await window.VSTDrive.listScripts();
        await window.VSTStore.set(MANIFEST_KEY, { scripts });
        return { scripts, source: 'drive' };
      } catch (e) { /* fall through to manifest/cache */ }
    }

    try {
      const data = await fetchJson(cfg.manifestUrl);
      const scripts = data.scripts || [];
      await window.VSTStore.set(MANIFEST_KEY, data);
      // Warm the cache for inline bodies.
      for (const s of scripts) {
        if (typeof s.body === 'string') await window.VSTStore.set(bodyKey(s.id), s.body);
      }
      return { scripts, source: 'network' };
    } catch (e) {
      const cached = await window.VSTStore.get(MANIFEST_KEY);
      if (cached && cached.scripts) return { scripts: cached.scripts, source: 'cache' };
      return { scripts: [], source: 'cache', error: e.message };
    }
  }

  // Resolve a script's text: inline body > cached body > fetch by path.
  async function getBody(script) {
    if (typeof script.body === 'string') return script.body;
    const cached = await window.VSTStore.get(bodyKey(script.id));
    if (typeof cached === 'string') return cached;
    if (script.path) {
      const res = await fetch(script.path, { cache: 'no-cache' });
      const text = await res.text();
      await window.VSTStore.set(bodyKey(script.id), text);
      return text;
    }
    return '';
  }

  window.VSTPreload = { loadManifest, getBody };
})();
