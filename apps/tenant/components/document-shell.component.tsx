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

// Deep import (not the barrel) so this Server Component doesn't pull the theme
// lib's createContext HOCs into the RSC graph (AGL-405).
import { APP_EMOTION_CACHE_OPTIONS } from '@aglyn/shared-ui-theme/util/emotion-cache'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import type { ReactNode } from 'react'
import ErrorBeacon from './error-beacon.component'

/**
 * The document shell — `<html>`, `<body>` and the emotion/MUI SSR cache —
 * rendered by whichever segment knows what language the document is in
 * (AGL-3153).
 *
 * It used to be the root layout's own JSX. The root layout is host-agnostic,
 * one segment above `[host]`, so the only language it could name was a
 * literal `"en"`: every tenant site declared English whatever it was written
 * in. Resolving the real one there would mean `headers()`, and a dynamic API
 * in the root layout de-opts static generation for every route beneath it —
 * measured on this app, `/_not-found` fell out of the prerender manifest the
 * moment one was added, and the catch-all's hourly ISR window would go the
 * same way at request time.
 *
 * So the shell moved DOWN to the segments that can answer from a path
 * parameter instead: `[host]/layout.tsx` for a tenant site, which resolves the
 * site's own language, and the two host-agnostic boundaries, which have no
 * site and keep the platform default. A path parameter is not a dynamic API,
 * so the catch-all's `revalidate` survives intact — the same trade `[scheme]`
 * made for the visitor's colour scheme (AGL-2708).
 *
 * ⚠️ NO `'use client'`, deliberately. `app/error.tsx` is a Client Component
 * and renders this too, so the file has to be importable from both sides:
 * everything it renders is already a client boundary, and the server layouts
 * keep it out of their RSC payload by being server-rendered themselves.
 */
export default function DocumentShell({
  lang,
  children,
}: {
  /**
   * The BCP-47 language of this document, as `resolvePageLocale` answers it.
   * Required rather than defaulted: a caller that cannot say what language it
   * is serving should be reading the resolver, not inheriting a guess.
   */
  lang: string
  children: ReactNode
}) {
  return (
    <html lang={lang}>
      <body>
        <AppRouterCacheProvider options={APP_EMOTION_CACHE_OPTIONS}>
          {/* THE DOCUMENT'S ONE `main` LANDMARK LIVES ON THE PAGE, NOT HERE
              (AGL-2486).

              It was this wrapper, which made the landmark exist and put the
              site nav and the site footer inside it — the one thing `main` is
              defined as excluding, and the reason a "skip to content" link
              would land on the top of the chrome it was meant to skip.

              Composition places it now, on the region it names: the layout's
              slot (the page content between the chrome), or the screen root
              when a screen has no layout, or wherever an author's HTML-element
              picker put it — `stampDocumentLandmark` picks exactly one. The
              screens that compose no author nodes carry their own: the root
              error and not-found boundaries render `StatusScreenPlain`, and
              the branded site status screen names its own content region.

              ⚠️ STILL EXACTLY ONE. `main` remains unofferable in the Section
              element picker and in author HTML — see `SECTION_ELEMENTS` and
              `ALLOWED_AUTHOR_HTML_ELEMENTS`, both of which drop it and say
              why. The two nodes that may carry it are the ones composition
              arbitrates between. */}
          {children}
          {/* First-party error beacon (AGL-1538): uncaught browser errors
              → /api/errors → Cloud Error Reporting. Sits OUTSIDE the page's
              suspense boundaries so it reports even when a page component
              stays suspended (the AGL-1285-adjacent hydration stall is
              exactly the failure mode it must survive). */}
          <ErrorBeacon />
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}
