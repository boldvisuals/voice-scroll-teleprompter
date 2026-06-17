/* App configuration. Edit this file — no rebuild needed. */
window.VST_CONFIG = {
  /* Phase 2 — manifest preload.
   * URL the app GETs on launch to populate the script picker.
   * Default: a local scripts.json sitting next to the app.
   * Point this at the file your Bold Visuals Drive tooling regenerates. */
  manifestUrl: 'scripts.json',

  /* Default recognition language (BCP-47). Dan = UK English. */
  voiceLang: 'en-GB',

  /* Phase 4 — in-app Google Drive (OPTIONAL, off by default).
   * To enable: set enabled:true, create an OAuth client + consent screen in
   * Google Cloud, paste the client ID, and put the watch-folder's Drive ID.
   * See README §"Phase 4". Until then the manifest path (Phase 2) is used. */
  drive: {
    enabled: false,
    clientId: '',          // e.g. 'xxxx.apps.googleusercontent.com'
    folderId: '',          // Drive folder ID to watch
    apiKey: '',            // optional, for public files
  },
};
