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

// Deep import, NOT the barrel. `@aglyn/shared-data-enums`' index re-exports
// `lib/icons`, which names ~100 icons out of `@aglyn/shared-data-mdi` —
// itself a barrel over the generated 6,606-module MDI catalog. This is the
// ROOT LAYOUT of every published page, so the barrel's reach is every page's
// reach, for one application constant.
import { APP_CONSOLE } from '@aglyn/shared-data-enums/aglyn-applications'
// Deep import (not the barrel) so this Server Component doesn't pull the theme
// lib's createContext HOCs into the RSC graph (AGL-405).
import { APP_EMOTION_CACHE_OPTIONS } from '@aglyn/shared-ui-theme/util/emotion-cache'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import ErrorBeacon from '../components/error-beacon.component'

/**
 * App Router root layout (migrated from pages/_app + _document). It owns the
 * document shell and the emotion/MUI SSR cache — `AppRouterCacheProvider`
 * replaces the Pages Router `_EmotionDocumentComponent` extraction, injecting
 * the streamed emotion styles during App Router SSR. Per-host theming and
 * fonts live one level down in `[host]/layout` (they depend on the
 * resolved tenant host), so this layout stays host-agnostic.
 *
 * The cache options are named rather than defaulted (AGL-1266). Emotion's
 * class name is `${cache.key}-${hash}`, so a surface that renders under a
 * different cache emits `css-13b992c` where this one emits `mui-13b992c` —
 * identical styles, different prefix — and React discards the entire server
 * tree at hydration over it. `APP_EMOTION_CACHE_OPTIONS` is the single place
 * that key is decided, shared with the console's root layout.
 */
export const metadata: Metadata = {
  description: APP_CONSOLE.DESCRIPTION,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={APP_EMOTION_CACHE_OPTIONS}>
          {/* THE DOCUMENT'S ONE `main` LANDMARK (AGL-2486).
              Published pages are composed from author nodes, so no screen can
              be relied on to declare the landmark itself — a page built
              entirely of Box and Section nodes has none, and every published
              site was shipping a document whose only landmark was `body`.
              Assistive tech has nothing to skip the chrome with, and it is the
              precondition for a skip link.

              It lives HERE rather than in `[host]/layout` so the guarantee is
              "every document, exactly one" rather than "every host route":
              the root `not-found` and `error` screens render through this
              layout and no other. `main` is `display: block`, the same as the
              `div` the canvas root already renders, so wrapping changes no
              layout — measured against production, where `body` is
              `display: block` with block-level children.

              ⚠️ EXACTLY ONE. A second `main` is its own a11y failure, worse
              than none because it makes the landmark ambiguous. `main` is
              therefore NOT an element an author can choose — see
              `SECTION_ELEMENTS` and `ALLOWED_AUTHOR_HTML_ELEMENTS`, both of
              which drop it and say why. */}
          <main>{children}</main>
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
