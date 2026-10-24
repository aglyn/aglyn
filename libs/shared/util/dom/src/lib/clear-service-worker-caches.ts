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
 * Drop every Cache Storage entry for this origin (AGL-1056).
 *
 * The other half of AGL-1054's isolation guarantee: nothing this session put
 * on disk may outlive it on a shared or kiosk machine. Called on sign-out —
 * which includes the staff **impersonation exit**, the case where one user's
 * bytes most obviously must not survive.
 *
 * ## Why caches and not `unregister()`
 *
 * A deliberate split, not an oversight. The registration holds no user data —
 * it is a pointer to a script that is identical for everyone. The *cache* is
 * the only thing that could hold bytes, so the cache is what gets cleared.
 *
 * Unregistering would also throw away the precached offline page, so the next
 * person to sign in on this device would get the browser's error page instead
 * of ours the first time their network dropped — a real loss, for no isolation
 * gain. If the worker ever caches something user-scoped, this decision has to
 * be revisited, which is why the reasoning is written down rather than implied.
 *
 * Best effort throughout: a sign-out must never fail because a cache would not
 * open. The session cookie and the Firebase sign-out are what actually end the
 * session; this is defence in depth behind them.
 */
export async function clearServiceWorkerCaches(): Promise<number> {
  // Guarded on `caches` itself rather than on `window`. It is the only global
  // this touches, and keying on `window` made the function untestable outside
  // a DOM for no benefit — the narrower check was also strictly weaker, since
  // `caches` can be absent in a window that exists.
  if (typeof caches === 'undefined') return 0
  try {
    const names = await caches.keys()
    const results = await Promise.all(
      names.map((name) => caches.delete(name).catch(() => false)),
    )
    return results.filter(Boolean).length
  } catch {
    // Storage can be unavailable in a private window or under a strict
    // policy. Nothing was cached in that case either.
    return 0
  }
}

export default clearServiceWorkerCaches
