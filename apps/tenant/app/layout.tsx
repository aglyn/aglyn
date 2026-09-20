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
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

/**
 * App Router root layout (migrated from pages/_app + _document). It owns the
 * document-wide `metadata` and `viewport` defaults. Per-host theming and fonts
 * live one level down in `[host]/[scheme]/layout` (they depend on the resolved
 * tenant host), so this layout stays host-agnostic.
 *
 * ⚠️ IT NO LONGER RENDERS `<html>` (AGL-3153). The shell — `<html>`, `<body>`
 * and the emotion/MUI SSR cache — is `DocumentShell`, rendered by each segment
 * that can say what language the document is in: `[host]/layout.tsx` for a
 * tenant site, and the two host-agnostic boundaries beside this file for a
 * request that resolves to no site.
 *
 * Being host-agnostic is exactly why it cannot own the shell any more. The
 * `lang` attribute was the literal `"en"` here, so a site written in Spanish
 * still told every browser, screen reader and search engine it was English.
 * This segment sits above `[host]` and Next gives it no params, so the only
 * way to answer from here is `headers()` — and a dynamic API in the root
 * layout de-opts static generation for everything beneath it. Measured on
 * this app: adding one dropped `/_not-found` out of the prerender manifest
 * entirely, and the catch-all's `revalidate = 3600` would fall the same way
 * when it regenerates at request time.
 *
 * Next's root-layout check reads the streamed document for `<html>` and
 * `<body>` rather than this file, so moving them down a segment satisfies it.
 * Every route below either passes through `[host]/layout.tsx` or is one of the
 * boundaries that renders its own shell; `global-error.tsx` has always
 * rendered its own, because it replaces this tree rather than nesting in it.
 *
 * The cache options are named rather than defaulted (AGL-1266). Emotion's
 * class name is `${cache.key}-${hash}`, so a surface that renders under a
 * different cache emits `css-13b992c` where this one emits `mui-13b992c` —
 * identical styles, different prefix — and React discards the entire server
 * tree at hydration over it. `APP_EMOTION_CACHE_OPTIONS` is the single place
 * that key is decided, shared with the console's root layout, and
 * `DocumentShell` is now the single place it is applied.
 */
export const metadata: Metadata = {
  description: APP_CONSOLE.DESCRIPTION,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}
