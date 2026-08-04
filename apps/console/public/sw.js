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
 * The console's service worker (AGL-1053 baseline, AGL-1054 caching).
 *
 * A cache is a second storage layer with **no security rules in front of it**,
 * on an origin that serves one workspace's data to one signed-in user. So the
 * question this file has to answer is not "is it fast" but *can any bytes
 * belonging to user A be replayed to user B on this device* — which on a
 * shared or kiosk machine is a real question.
 *
 * The answer here is structural rather than careful: **nothing user-scoped can
 * enter the cache**, because the only things that may enter are build-hashed
 * static assets that are byte-identical for every user on every org. There is
 * no A-scoped response to replay because there is no path by which one is
 * stored.
 */

/**
 * Bumped whenever the caching rules change, so an old worker's cache is
 * dropped rather than inherited under new rules it was not written for.
 */
const CACHE_NAME = 'aglyn-console-static-v1'

/**
 * The ONLY things that may be cached.
 *
 * * `/_next/static/*` — build-hashed and immutable. A new build produces new
 *   URLs, so a stale entry can never shadow a fresh asset.
 * * `/_static/*` — brand assets, styles, icons. Already outside the middleware
 *   auth matcher, i.e. already established as not user-scoped.
 *
 * Both are identical for every user, which is the property doing the security
 * work — not the fact that they happen to be assets.
 */
const CACHEABLE_PREFIXES = ['/_next/static/', '/_static/']

/**
 * Hosts whose requests this worker must never touch.
 *
 * Firebase's SDKs run their own offline persistence through IndexedDB and
 * their own long-poll/streaming transports. Intercepting those risks both
 * corruption and cross-org bleed, and buys nothing — they are not assets.
 */
const FORBIDDEN_HOSTS = [
  'firestore.googleapis.com',
  'firebasestorage.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseappcheck.googleapis.com',
]

/**
 * May this request be served from, or written to, the cache?
 *
 * **Deny-first, and every deny is explicit rather than implied by the
 * allowlist.** The allowlist alone would already exclude everything below, but
 * an allowlist is one edit away from being widened by someone who has not read
 * this comment, and these denials are the ones that would turn that edit into
 * a security bug rather than a performance regression. They are asserted in
 * `service-worker-cache-policy.spec.ts` against this exact file.
 */
function isCacheable(request) {
  // Only GET. A cached response to a mutation is meaningless and a replayed
  // one is dangerous.
  if (request.method !== 'GET') return false

  // NEVER a document. The console is `force-dynamic` and its HTML carries the
  // signed-in user's org context — a cached shell would hand one user's
  // context to the next person on the device. This is the single most
  // important line in the file.
  if (request.mode === 'navigate') return false
  if (request.destination === 'document') return false

  // A request the browser attaches credentials to is by definition not a
  // shared asset.
  if (request.credentials === 'include') return false
  if (request.headers && request.headers.get('authorization')) return false

  let url
  try {
    url = new URL(request.url)
  } catch {
    return false
  }

  // Same-origin only, and never the Firebase hosts even if that ever changes.
  if (FORBIDDEN_HOSTS.includes(url.hostname)) return false
  if (url.origin !== self.location.origin) return false

  // The API surface, in its entirety. Redundant against the allowlist below,
  // and stated anyway: this is the rule a future edit is most likely to
  // violate by accident.
  if (url.pathname.startsWith('/api/')) return false

  return CACHEABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

self.addEventListener('install', () => {
  // No precache list. The assets worth caching are build-hashed, so their URLs
  // are only knowable from a build manifest — and generating one is what a
  // toolchain (serwist) is for. Runtime caching reaches the same steady state
  // after one visit without adding that machinery, and crucially it cannot
  // cache something the page did not already ask for.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from earlier rule-sets. A cache written under different
      // rules is exactly the invisible layer this file is trying not to be.
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  // Not `respondWith` at all for anything not cacheable — the request goes to
  // the network exactly as if this worker did not exist. Falling through is
  // safer than proxying it, because a bug in the proxy path cannot then break
  // or observe an authenticated request.
  if (!isCacheable(event.request)) return

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request)
      if (cached) return cached
      const response = await fetch(event.request)
      // Only store a genuinely successful, same-origin response. An opaque
      // response has an unreadable status, so caching one would mean storing
      // something this worker cannot inspect.
      if (response && response.status === 200 && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME)
        cache.put(event.request, response.clone())
      }
      return response
    })(),
  )
})
