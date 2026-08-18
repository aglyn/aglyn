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

import { Button } from '@mui/material'
import { useEffect } from 'react'
import SiteStatusScreen from '../../components/site-status-screen.component'

/**
 * The tenant's branded crash page (AGL-2074).
 *
 * ## What reaches this, and what does not
 *
 * Three boundaries now sit on the tenant render path and they catch different
 * things — do not collapse them:
 *
 *  * `[[...slug]]/page-body-boundary.tsx` (AGL-1556) confines a throwing
 *    plugin gate to the page BODY so `SiteAnalytics` and the error beacon
 *    survive. Anything it catches never gets here, which is the point of it.
 *  * **This** catches what escapes that — a throw in `page.tsx` itself, in
 *    `load-page-data`, or in the metadata pass — and renders in place of the
 *    page, INSIDE `[host]/layout`, so the site's theme and mark are intact.
 *  * `app/error.tsx` catches a throw in `[host]/layout` itself, which this
 *    file structurally cannot: an error boundary never catches an error from
 *    the layout of its own segment.
 *
 * ## Reporting
 *
 * React 19 routes CAUGHT errors to `console.error` and only uncaught ones to
 * `reportError`, so a boundary that renders quietly turns a reported crash
 * into an invisible one — the exact trap `page-body-boundary` documents. The
 * effect below re-dispatches so the AGL-1538 beacon still sees it. Guarded and
 * swallowed: jsdom and older Safari have no `reportError`, and a boundary
 * that throws while reporting is the one failure this may never have.
 */
export default function HostError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      ;(
        window as Window & { reportError?: (error: unknown) => void }
      ).reportError?.(error)
    } catch {
      // Reporting never breaks the page.
    }
  }, [error])

  return (
    <SiteStatusScreen
      code="500"
      title={'Something went wrong'}
      message={
        'This page didn’t load properly. Trying again often fixes it — if it ' +
        'doesn’t, the rest of the site is still available.'
      }
      action={
        <Button variant="outlined" onClick={() => reset()}>
          {'Try again'}
        </Button>
      }
    />
  )
}
