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

import StatusScreenPlain from '@aglyn/shared-ui-jsx/components/status-screen-plain.component'
import { useEffect } from 'react'

/**
 * The console's crash page (AGL-2074).
 *
 * The console had branded NOT-FOUND boundaries (AGL-625) and no error
 * boundary at all, so an uncaught throw anywhere under the root layout
 * dropped a signed-in operator onto Next's own crash page — the same defect
 * the tenant had one app over, on the surface a customer is paying to use.
 *
 * ## Why the plain screen and not the console chrome
 *
 * `not-found.tsx` renders `AuthenticatedLayout > MainLayout` because a 404
 * is a routing outcome: everything around it is healthy and the chrome is
 * exactly what the operator needs to get somewhere else. An ERROR is the
 * opposite case. This boundary catches throws from inside that same provider
 * stack — `FirebaseAppLayout`, `ConsolePluginsGate`, the org scope — so
 * re-mounting the chrome to report the failure risks re-entering whatever
 * just failed and turning one broken page into a loop. A boundary that can
 * itself throw is not a boundary.
 *
 * It also cannot know whose brand to wear. The console renders an agency's
 * branding for a white-label org (AGL-1097), and that resolution lives inside
 * the very stack that is unavailable here — so, as on the tenant, the rule is
 * to name nobody rather than to guess and name us.
 *
 * A full-page link home rather than a router push: the router is part of what
 * may be wrong, and a client navigation that fails leaves the operator on the
 * same dead page with no feedback.
 */
export default function ConsoleError({
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
    <StatusScreenPlain
      code="500"
      title={'Something went wrong'}
      message={'This page didn’t load properly. Please try again.'}
      action={
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '0.6rem 1.1rem',
            borderRadius: '0.5rem',
            borderStyle: 'solid',
            borderWidth: '1px',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {'Try again'}
        </button>
      }
    />
  )
}
