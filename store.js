/* Tiny IndexedDB wrapper — offline store for the manifest + script bodies.
 * Exposes window.VSTStore: { ready, get, set, getAll }.
 */
(function () {
  const DB_NAME = 'vst';
  const STORE = 'kv';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const out = fn(store);
      t.oncomplete = () => resolve(out.result);
      t.onerror = () => reject(t.error);
    });
  }

  window.VSTStore = {
    get: (key) => tx('readonly', (s) => s.get(key)),
    set: (key, val) => tx('readwrite', (s) => s.put(val, key)),
    del: (key) => tx('readwrite', (s) => s.delete(key)),
  };
})();
