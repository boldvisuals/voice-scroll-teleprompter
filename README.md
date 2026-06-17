# Voice-Scroll Teleprompter

Bold Visuals' own teleprompter — **voice-paced auto-scroll** + **scripts auto-loaded from a Drive folder**, free, no accounts. Clean-room build on standard browser APIs (see handover §11).

Android-first (Nothing Phone 3a), installable PWA, works full-screen for hand-held or beamsplitter rigs.

## Run it

Voice recognition and the service worker need a **secure context** (https or `localhost`) — `file://` won't do voice/offline. From this folder:

```powershell
./serve.ps1
```

It serves on `http://localhost:8080` and opens the page. (Uses Python if installed, otherwise a built-in .NET server — no install needed.)

To use it **on the phone**: serve from the PC and browse to `http://<pc-ip>:8080` on the same wifi, or host the folder anywhere over HTTPS (GitHub Pages, Netlify, a Drive-served bucket…) and open that on the phone.

## Using it

1. On launch the **script picker** populates from `scripts.json` (Phase 2). Tap a script to load it — or paste your own in the box.
2. Set it up: font size, manual speed, **read-line height** (eyeline to match your lens), **column width**, **line spacing**, **colour preset** (white/amber/high-contrast), **3-2-1 lead-in**, optional **voice-following** and mirror flips. All persist.
3. **Start prompting** → full-screen, screen stays awake. A 3-2-1 counts you in (toggleable; manual without it starts paused so you can settle).
   - **Tap** anywhere = pause/resume. The corner readout shows **% · words-left · time-left**.
   - **Mic button** (voice mode) = voice on/off. Read aloud and the text follows you; pause or go off-script and it holds. Numbers match either way ("five" ↔ "5").
   - **Paragraph jump** ↑/↓ buttons, or **PgUp/PgDn** (and ←/→) — great with a Bluetooth clicker.
   - **Scrub bar / Restart (R)** = rewind for another take — always available, independent of the voice engine (beats PromptSmart's forward-only trap).
   - **Clicker / keys:** Space·Enter·`b` = play/pause, ↑/↓ = speed, PgUp/PgDn = jump paragraph, **Esc** exit.

## How it's wired

| File | Role |
|---|---|
| `index.html` / `style.css` | UI shell — setup screen + full-screen prompter |
| `app.js` | Controller + position-driven scroll engine (manual = constant px/s; voice = ease toward matched-word target) |
| `voice.js` | `SpeechRecognition` wrapper (continuous, interim, auto-restart) |
| `matcher.js` | Aligns spoken tail vs. a forward window of script words; advances a cursor; holds when off-script |
| `preload.js` | Phase 2 — fetch manifest, cache bodies, offline fallback |
| `store.js` | IndexedDB key/value (offline script store) |
| `drive.js` | Phase 4 — in-app Google Drive (off by default) |
| `service-worker.js` + `manifest.webmanifest` | Phase 3 — installable + offline app shell |
| `config.js` | **All tunables live here** — manifest URL, voice language, Drive creds |

## Phases

- **Phase 0** — static prompter (manual speed, mirror, full-screen, wake-lock). ✅
- **Phase 1** — voice-following scroll + off-script hold + manual rewind. ✅
- **Phase 2** — preload scripts from manifest on launch, cache offline. ✅
- **Phase 3** — installable PWA (manifest + service worker). ✅ *(install from Chrome's "Add to home screen" when served over https.)*
- **Phase 4** — in-app Google Drive watch folder. ⚙️ *Scaffolded, off by default — needs your credentials (below).*

## The manifest (Phase 2 — recommended path)

`scripts.json` is the contract. Your existing Bold Visuals Drive tooling regenerates it (dump-folder → extract pattern): scripts land in a Drive folder, tooling rebuilds `scripts.json`, the app reads it on launch.

```json
{
  "updated": "2026-06-17T09:00:00Z",
  "scripts": [
    { "id": "welcome", "title": "Welcome", "updated": "2026-06-17", "body": "inline text…" },
    { "id": "sizzle-intro", "title": "Sizzle Intro", "updated": "2026-06-15", "path": "scripts/sizzle-intro.txt" }
  ]
}
```

Bodies inline (`body`) for short scripts or referenced (`path`) and fetched lazily. Point `config.js → manifestUrl` at wherever your tooling publishes it.

## Phase 4 — in-app Drive (optional)

Only worth it if the manifest path proves annoying. To enable:

1. Google Cloud → create an **OAuth client ID** (Web), configure the consent screen, enable the **Drive API**.
2. In `config.js` set:
   ```js
   drive: { enabled: true, clientId: 'xxxx.apps.googleusercontent.com', folderId: '<drive-folder-id>' }
   ```
3. The app then lists `.txt` / Google Docs from that folder via Drive API v3 and uses them in place of the manifest. (Body fetch for Drive files still needs the bearer token wired into `preload.getBody` — noted as the remaining Phase-4 task.)

## Known caveats (from the handover)

- **Voice needs network on Android** — `SpeechRecognition` is cloud-backed there. Fine in a wifi studio; not a no-signal field tool. Manual speed is the always-there fallback.
- Recognition accuracy varies with accent/pace — keep manual ready.
- Mic permission is requested on first voice use; deny → graceful manual fallback.
- Long full-screen + mic + wake-lock sessions use battery/heat.
