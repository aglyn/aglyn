/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The console's service worker (AGL-1053) — deliberately does NOTHING.
 *
 * This is the foundation issue's whole point: prove registration, scope and
 * serving work before anything depends on them, so the issues that add real
 * caching (AGL-1054) and update prompting (AGL-1055) are small diffs against a
 * known-good baseline rather than a debugging session with three variables.
 *
 * **No `fetch` handler on purpose.** A service worker with a fetch handler is
 * in the request path for every navigation and asset on the origin, including
 * the authenticated console. Registering one that only logs would still change
 * how failures present, and this file exists to change nothing at all.
 *
 * ## Why a static file and not a toolchain
 *
 * `serwist` was the default the issue proposed, and it is very likely right —
 * for AGL-1054, where its job (generating a precache manifest from the build's
 * output) begins. There is no manifest to generate here, so adopting it now
 * would mean taking on nx + Turbopack build wiring to emit ten lines that a
 * static file in `public/` already serves at the correct scope.
 *
 * The repo-specific risks this baseline actually retires are the routing and
 * lifecycle ones — the middleware matcher swallowing `/sw.js`, the scope, the
 * production-only registration, the teardown incantation. Those are settled
 * independently of the toolchain, so swapping serwist in later is a change of
 * how this file is PRODUCED, not of whether any of the above works.
 *
 * Recorded on AGL-1053 so the decision is reviewable rather than implied.
 */

// Take over as the active worker without waiting for every tab to close.
// Safe precisely because this worker does nothing — there is no old cache to
// serve and no fetch handler whose behaviour could change mid-session. Once
// AGL-1055 adds an update prompt, this becomes its decision to make, not ours.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
