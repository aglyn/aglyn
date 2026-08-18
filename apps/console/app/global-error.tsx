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

/**
 * Last boundary of all for the console (AGL-2074): a throw in the ROOT
 * layout.
 *
 * It REPLACES the root layout, so it renders its own `<html>`/`<body>` and
 * loses everything that layout provides — `AppRouterCacheProvider`, so no
 * emotion and no MUI styling. Plain elements with inline styles are the one
 * thing that can still paint.
 *
 * Should never render; the console's root layout does almost nothing. It
 * exists because the alternative when it does is the framework's crash page
 * on a paying operator's screen, and a set of boundaries that covers only the
 * likely cases leaves the product's worst moment as its least designed one.
 */
export default function ConsoleGlobalError({
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
        <StatusScreenPlain
          code="500"
          title={'Something went wrong'}
          message={'The console couldn’t be loaded. Please try again in a moment.'}
        />
      </body>
    </html>
  )
}
