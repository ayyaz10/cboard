# CBoard PWA

CBoard uses React 19, Vite 7 and Tailwind with custom history routing. Production lives under `/cboard/`. The PWA adds no package dependencies and does not change any Supabase tables, account storage keys, local drafts or authentication rules.

## Build and publish

```sh
npm run build
npm run verify:pwa
npm run test:pwa
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
```

`scripts/pwa-build.js` runs after Vite, emitting `dist/manifest.webmanifest` and `dist/sw.js`. Every build automatically fingerprints the public files and worker source. `npm run deploy` builds and copies to the tracked `docs/` GitHub Pages directory, preserving Markdown documentation. Publish that directory (or publish `dist/` with another static host). No backend migration is required.

`.gitattributes` preserves exact generated deployment bytes across Windows/Git checkouts so integrity hashes stay valid. After staging, `node scripts/verify-pwa.js docs --staged` verifies the actual Git blobs that will be published.

Use HTTPS in production; localhost/loopback is allowed for development previews. Serve `sw.js` as JavaScript at `/cboard/sw.js`, with scope `/cboard/`. Serve the manifest as `application/manifest+json` (JSON is also accepted). Never rewrite these files to the SPA HTML. Keep the complete directory structure. Prefer `Cache-Control: no-cache` for HTML, manifest and worker, and immutable caching for hashed `assets/`. GitHub Pages handles HTTPS; ensure Enforce HTTPS is enabled in Pages settings. Custom hosts need SPA fallback to `index.html`. The existing generated `404.html` handles first-load GitHub Pages deep links before a worker exists.

If moving to a different base path, change Vite's `base` and regenerate everything. A changed origin/path may create a different installed app identity; retain `/cboard/` for existing installations. The old Pages 404 redirect helper assumes either root hosting or one repository path segment.

## Installation and appearance

The generated manifest declares CBoard, standalone display, a stable ID/start URL/scope and the existing cream theme. Orientation remains flexible. `public/icons/` contains 192px and 512px icons, a separate maskable 512px icon whose artwork fits the central safe zone, and a 180px Apple touch icon. All reuse `src/assets/cal-favicon.png`; no new brand was introduced. The original favicon remains linked.

- Chromium: use the browser's Install app menu/address-bar affordance when offered.
- iPhone/iPad Safari: Share → Add to Home Screen, then open the home-screen icon.
- Supported macOS Safari versions: File → Add to Dock.

No custom install popup or notification permission request is added. Platform support and installation prompts are browser-controlled. Installed apps use the same origin and existing storage keys; some Apple/browser contexts isolate storage and may require signing in again. A manifest cannot override that platform behavior.

Apple metadata, `viewport-fit=cover`, safe-area insets and dynamic viewport heights protect the main shell, launcher, mobile menu and finance dialogs. Existing bottom navigation/timer safe-area rules remain in place. Actual iOS notches, keyboard behavior and installed Safari windows must also be checked on physical Apple devices.

## Cache and offline policy

- Install precaches the public HTML shell, hashed JS/CSS (including lazy Training), branding and icons. Integrity hashes prevent activating a partially deployed/mixed build.
- Navigation inside CBoard uses the shell associated with the active worker, including offline deep links. User data is loaded separately under existing auth/RLS.
- Bundled public nutrition data and recipe examples are cached only when requested. The allowlist is generated at build time, so runtime cache growth is bounded by the shipped files.
- Supabase/auth responses, tokens, passwords, private media, external images/fonts, API calls and query variants are never stored by this worker. Known offline Supabase requests fail immediately with a connection message. Other network failures retain existing error handling and also show a global connection notice.
- Loaded React state and existing local storage remain available while the app stays open. Offline relaunch opens the shell; cloud-backed modules still need a connection and valid session to load data. This is **not** offline editing or offline authentication. Expired sessions need an online refresh. No new private-data cache or write queue is created.
- Reconnection never repeats a mutation or automatically reloads a draft. Retry existing load controls, or reload after preserving unsaved work. Check interrupted saves before resubmitting: a connection can drop after a server has accepted a write.
- Logout retains the existing Supabase behavior. Worker caches contain only public resources and never restore a user's private data. No user storage is cleared by worker installation, activation or cache cleanup.

## Updates and failure handling

The worker checks for updates on registration, return to a visible window, reconnection and hourly while visible/online. A new worker waits and the UI offers **New version available → Update / Later**. Update explicitly activates and reloads the accepting tab. Other open tabs keep their state and receive an update action instead of being silently reloaded. Save drafts first. Closing all app windows also allows the browser's normal waiting-worker activation.

Activation retains the current and one preceding public cache for old tabs' lazy chunks, deleting only older CBoard shell caches for this scope. Tabs kept open across multiple deployments should update before opening a not-yet-loaded module. Missing/corrupted caches fall back to the network; offline storage eviction shows a reconnect page. Registration/storage failures leave the ordinary online app usable. No automatic reload loop, background sync or push subscription is installed.

Service workers are registered only in production builds. Use Vite development on port 5173 and production preview on 4173 to avoid an existing production worker controlling a dev origin. If production was previously served from the dev origin, unregister that origin's worker once using DevTools; do not clear user data.

## Verification

`src/pwa/*.test.js` covers offline routes, network bypass for private/auth/mutating requests, single-opening cache activation, incomplete installs, cache eviction, bounded runtime reference data and old chunks. `scripts/verify-pwa.js` checks the built manifest, scope, icon dimensions and every precache integrity hash. Existing feature tests and a production build should pass before publishing.

Verification completed: 230 JavaScript tests passed and the production build passed with the existing bundle-size/import warnings. Chromium checks covered registration/activation, public cache inventory with no private API entries, an unvisited Finance deep link with the preview server stopped, a new build waiting for explicit Update then reloading successfully, and simulated offline/reconnection notices in a 390px viewport. Platform installation, standalone launches and signed-in CRUD on real iOS/Android/macOS devices are release smoke checks; automated cache tests cannot establish those outcomes. No authenticated records are modified as part of the PWA tests.

References: [service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [Apple web app configuration](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html), [WebKit safe areas](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).
