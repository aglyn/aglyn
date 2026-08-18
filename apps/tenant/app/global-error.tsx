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

import PlainStatusScreen from '../components/plain-status-screen.component'

/**
 * Last boundary of all (AGL-2074): a throw in the ROOT layout.
 *
 * `global-error` REPLACES the root layout, so it must render its own
 * `<html>` and `<body>` — and everything the root layout provides is gone
 * with it: no `AppRouterCacheProvider`, so no emotion, so no MUI styling,
 * and no `ErrorBeacon`, so nothing is listening for the report. Hence plain
 * elements with inline styles, and a direct `reportError` at render rather
 * than an effect handing off to a beacon that is not mounted.
 *
 * In practice this should never render — the root layout does almost nothing.
 * It exists because the alternative when it DOES is Next's own crash page on
 * a customer's domain, which is the entire defect this issue is about, and a
 * boundary that only covers the likely cases leaves the platform's worst
 * moment as its least designed one.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  if (typeof window !== 'undefined') {
    try {
      ;(
        window as Window & { reportError?: (error: unknown) => void }
      ).reportError?.(error)
    } catch {
      // Reporting never breaks the page.
    }
  }
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <PlainStatusScreen
          code="500"
          title={'Something went wrong'}
          message={
            'This site couldn’t be loaded. Please try again in a moment.'
          }
        />
      </body>
    </html>
  )
}
