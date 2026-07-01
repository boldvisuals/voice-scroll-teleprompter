/* Phase 4 — in-app Google Drive watch folder (OPTIONAL).
 *
 * Disabled until you set config.drive.enabled = true and supply a clientId +
 * folderId (see README §"Phase 4"). Uses Google Identity Services for the
 * OAuth token and Drive API v3 files.list against the folder.
 *
 * This module is intentionally self-contained and lazy: nothing here runs
 * unless preload.js sees drive.enabled and calls listScripts().
 *
 * window.VSTDrive = { listScripts, fetchBody }
 */
(function () {
  const cfg = (window.VST_CONFIG && window.VST_CONFIG.drive) || {};
  const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  let token = null;
  let tokenClient = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return;
    await loadScript('https://accounts.google.com/gsi/client');
  }

  function getToken() {
    return new Promise(async (resolve, reject) => {
      await ensureGis();
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.clientId,
          scope: SCOPE,
          callback: (resp) => {
            if (resp.error) return reject(new Error(resp.error));
            token = resp.access_token;
            resolve(token);
          },
        });
      }
      if (token) return resolve(token);
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  // Returns manifest-shaped scripts: [{ id, title, updated, path:driveDownloadUrl }]
  async function listScripts() {
    if (!cfg.clientId || !cfg.folderId) throw new Error('Drive not configured');
    const tok = await getToken();
    const q = encodeURIComponent(
      `'${cfg.folderId}' in parents and trimmed = false and (mimeType='text/plain' or mimeType='application/vnd.google-apps.document')`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,mimeType)&orderBy=modifiedTime desc`;
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
    if (!res.ok) throw new Error('Drive HTTP ' + res.status);
    const data = await res.json();

    return (data.files || []).map((f) => {
      const isDoc = f.mimeType === 'application/vnd.google-apps.document';
      const dl = isDoc
        ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`
        : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
      return {
        id: f.id,
        title: f.name.replace(/\.txt$/i, ''),
        updated: f.modifiedTime,
        path: dl,
        _auth: true, // marks that fetching the body needs the bearer token
      };
    });
  }

  // Fetches a script body from a `path` returned by listScripts() — either a
  // plain-file `alt=media` URL or a Google Docs `export?mimeType=text/plain`
  // URL. Both need the same bearer token; preload.getBody routes `_auth`
  // scripts here instead of doing a plain fetch.
  async function fetchBody(url) {
    const tok = await getToken();
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + tok },
      cache: 'no-cache',
    });
    if (!res.ok) throw new Error('Drive HTTP ' + res.status);
    return res.text();
  }

  window.VSTDrive = { listScripts, fetchBody };
})();
