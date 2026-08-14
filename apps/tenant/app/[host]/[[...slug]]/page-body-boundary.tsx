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

import ErrorBoundaryComponent from '@aglyn/shared-ui-jsx/components/error-boundary.component'
import type { ReactNode } from 'react'

/**
 * Re-report a caught failure so it still reaches the error beacon (AGL-1538).
 *
 * React 19 routes errors that an error boundary CATCHES to `console.error`,
 * and only uncaught ones to `reportError` — so a boundary that stays quiet
 * converts a reported crash into an invisible one. `reportError` dispatches an
 * `error` event on `window`, which is the listener `installErrorBeacon`
 * registers, so the failure lands in Cloud Error Reporting exactly as it would
 * have. Optional because jsdom (and older Safari) has no `reportError`; a
 * missing one costs the report, never the page.
 */
function reportToErrorBeacon(error: Error): void {
  if (typeof window === 'undefined') return
  try {
    ;(window as Window & { reportError?: (error: unknown) => void }).reportError?.(
      error,
    )
  } catch {
    // Reporting never breaks the page.
  }
}

/**
 * Isolates the tenant page BODY from the measurement/consent surface that
 * `page.tsx` renders beside it (AGL-1556).
 *
 * ## What this catches, and what it deliberately does not
 *
 * An error boundary, NOT a Suspense boundary — and that distinction is the
 * entire reason this file exists rather than the obvious `<Suspense>`.
 *
 * - **Reject** — a site-plugin chunk that 404s (the classic shape: a visitor
 *   holding HTML from the previous deploy) makes `use(sitePluginLoader
 *   .ensure(...))` throw during hydration. Without a boundary here that throw
 *   escapes the whole root: measured, `SiteAnalytics` renders NOTHING and the
 *   error reaches Next's default global error boundary, which replaces the
 *   document — root layout, `ErrorBeacon` and all. This boundary confines it
 *   to the page body, so GA, the consent surface and the beacon survive a
 *   failure they never had anything to do with.
 * - **Suspend** — a gate that hangs is untouched by this, on purpose. React
 *   will not commit a tree while any part of it is suspended and an error
 *   boundary does not change that; only a Suspense boundary would, and that
 *   is precisely the page-wide `<Suspense fallback={null}>` AGL-1541 had to
 *   delete (its reveal AND its hydration retry both ride
 *   `requestAnimationFrame`, which never fires in hidden, occluded or
 *   prerendered tabs). Adding one back here for the suspend case would trade
 *   AGL-1541's regression for AGL-1556's, which is a much worse deal — see
 *   the note in `specs/analytics-survive-plugin-stall.spec.tsx` for why the
 *   "warm renders only" variant does not survive contact with a cold server.
 *
 * ## Why it lives here and not in an `error.tsx`
 *
 * An `error.tsx` at the `[[...slug]]` segment wraps that segment's PAGE — and
 * `page.tsx` is what renders `SiteAnalytics`, so the file that was supposed to
 * isolate the body would take the analytics surface down with it. Hoisting
 * `SiteAnalytics` into `[host]/layout.tsx` to get above such a boundary would
 * cost the screen id (a layout cannot see its child segment's slug), and with
 * it the per-screen attribution of AGL-151. A boundary INSIDE `page.tsx`,
 * wrapping only `CatchAllClient`, buys the isolation at neither price.
 *
 * Note it buys nothing on the SERVER: React 19.2 does not run error boundaries
 * during streaming SSR at all (verified — `getDerivedStateFromError` never
 * fires and a shell throw yields zero HTML), so an `ensure` that rejects
 * server-side is still a 500, with or without this. That is the correct
 * outcome and not what this addresses: the realistic reject is client-only,
 * because the server has the chunk the stale browser is missing.
 *
 * The fallback is an empty fragment rather than `null` — the shared boundary
 * defaults an absent fallback to visible "Something went wrong…" text via
 * `??`, and `null` is absent as far as `??` is concerned.
 */
export default function PageBodyBoundary({
  children,
}: {
  children: ReactNode
}) {
  return (
    <ErrorBoundaryComponent fallback={<></>} onCatch={reportToErrorBeacon}>
      {children}
    </ErrorBoundaryComponent>
  )
}
