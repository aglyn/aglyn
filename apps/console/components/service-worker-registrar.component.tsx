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
'use client'

import { useEffect } from 'react'

/** Scope `/`, so the worker can later cover the whole origin (AGL-1053). */
export const SERVICE_WORKER_URL = '/sw.js'

/**
 * Registers the console's service worker (AGL-1053).
 *
 * Renders nothing. Mounted once from the root layout so registration happens
 * on any entry point rather than only the pages someone remembered to wire.
 *
 * ## Production only, and not for convenience
 *
 * Under `next dev` a service worker mostly gets in the way: chunks are served
 * unhashed and regenerated constantly, so a worker that caches anything serves
 * yesterday's build, and even one that does not adds a lifecycle to every
 * reload. Worse, it OUTLIVES the dev server — a worker registered on
 * `localhost:4200` stays registered against whatever the next project to use
 * that port is. Hence the guard, and hence the teardown steps in
 * `docs/E2E_LOCAL.md`.
 *
 * Verified against a production build for the same reason: registration, scope
 * and update behaviour all differ under dev, so a dev-only smoke test proves
 * nothing about what ships.
 *
 * Failure is deliberately quiet. Registration is an enhancement — an
 * unsupported browser, a private window, or a blocked request must leave the
 * console working exactly as it does today, which is also the property that
 * makes this baseline safe to land ahead of anything that depends on it.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    let cancelled = false
    // After `load` so registration never competes with the first paint for
    // bandwidth — the worker does nothing yet, so it has nothing to be early
    // for.
    const register = () => {
      if (cancelled) return
      navigator.serviceWorker
        .register(SERVICE_WORKER_URL, { scope: '/' })
        .catch((error) => {
          // Named so a registration failure is greppable rather than silent —
          // the whole point of AGL-1053 is that later issues can assume this
          // works.
          console.warn(
            '[sw] registration failed',
            (error as { message?: string })?.message ?? error,
          )
        })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('load', register)
    }
  }, [])

  return null
}

export default ServiceWorkerRegistrar
