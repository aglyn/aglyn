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
import { Suspense, useEffect, useState } from 'react'
import CatchAllClient from '../app/[host]/[[...slug]]/catch-all-client'
import type { Props } from '../app/[host]/[[...slug]]/types'
import { useHostBrand } from '../app/[host]/host-brand.context'
import { resolveNotFoundTitle } from '../utils/not-found-title'
import SiteStatusScreen from './site-status-screen.component'

/**
 * The body of a tenant 404 (AGL-2342).
 *
 * A 404 with no way to navigate away strands the visitor. AGL-2187 answered
 * that with a navigable fallback; this answers it with the site's OWN page —
 * the screen its author designed, with the header, nav and footer they put on
 * it.
 *
 * ## Why the screen is fetched instead of rendered with the page
 *
 * Two framework facts, measured on `next@16.2.11` and re-read in the
 * `next@16.3.3` source rather than assumed, and together they leave exactly
 * one place for this to live.
 *
 *  1. **`notFound()` is the only way to emit a `404` status, and it discards
 *     the document's BODY.** The served HTML is `<html id="__next_error__">`
 *     whose `<body>` is a hard-coded empty seed (`getErrorRSCPayload` in
 *     `app-render.js`), and the boundary is rendered by the client off the
 *     flight payload. React's streaming renderer runs no error boundary, so
 *     the shell errors and Next recovers with that seed; there is no userland
 *     hook on the way. Reproduced in a bare Next app with no middleware, no
 *     ISR and a plain route, so it is not something about this app. (The one
 *     escape, `experimental.cacheComponents`, is the Cache Components rewrite.)
 *     The `<head>` of that seed IS rendered, from the `not-found` convention's
 *     own metadata — which is where the title comes from; see `[host]/not-found.tsx`.
 *  2. **A `not-found` boundary is rendered into every SUCCESSFUL response
 *     too.** A 200 page carries its boundary's fully rendered output in the
 *     payload. So composing a screen inside the boundary would put a screen
 *     compose on every page load of every site on the platform.
 *
 * (1) rules out rendering the screen from `page.tsx` — that costs the 404
 * status, and a soft-404 tells crawlers a mistyped URL is a real page. (2)
 * rules out composing it here. What is left is to ship a component that costs
 * a module reference on a 200 and asks for the screen only when it MOUNTS,
 * which is only on a real 404.
 *
 * ## The fallback is not an error path
 *
 * Every way this can fail to produce a designed screen — a host that has
 * designated none, a fetch that fails, a payload with no nodes, a renderer that
 * throws — renders {@link SiteStatusScreen} instead, which has the site's mark,
 * its public top-level pages and a search box. The point of the exercise is to
 * never leave a visitor somewhere they cannot leave, and a site with no error
 * page designed must not come out of this WORSE than a site that never had one.
 *
 * ## Blank while it loads, on purpose
 *
 * Nothing renders until the answer is known, because the alternative is showing
 * the platform fallback and then replacing it with the site's own page — two
 * different pages in the same second. There is nothing to flash away from: the
 * server sent an empty body regardless, per (1) above.
 */
export interface SiteNotFoundProps {
  code: string
  title: string
  message: string
}

export function SiteNotFound({ code, title, message }: SiteNotFoundProps) {
  const { hostKey, brandName, siteTitle, titleSeparator } = useHostBrand()
  // `undefined` is PENDING and `null` is "no designed screen" — two different
  // states that must not collapse, or the fallback renders for a moment on
  // every site that has a 404 screen.
  const [screen, setScreen] = useState<Props | null | undefined>(undefined)

  useEffect(() => {
    if (!hostKey) {
      setScreen(null)
      return
    }
    let live = true
    const query = new URLSearchParams({ host: hostKey })
    void fetch(`/api/screen/not-found?${query}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((payload) => {
        if (!live) return
        setScreen(payload?.nodes ? (payload as Props) : null)
      })
    return () => {
      live = false
    }
  }, [hostKey])

  /**
   * The tab says what the page is (AGL-2291), on a CLIENT-SIDE arrival.
   *
   * A full document load no longer needs this: the served `<head>` carries
   * the title, written by `[host]/not-found.tsx`'s `generateMetadata` (AGL-2648)
   * — the one part of the `__next_error__` shell Next does render on the
   * server. What still arrives with no title is a client-side navigation to a
   * missing URL: no document is loaded, the router carries the previous page's
   * head across, and the page's own metadata answers nothing for a path that
   * resolved nothing. This effect is that case's writer.
   *
   * It composes the SAME string as the server, through the same shared rule
   * and from the same host fields, published for it by `HostBrandProvider`.
   * Anything less and the tab reads one title on arrival and another a
   * moment after hydration. The site's name stands in for its title only
   * when no title was published at all — the layout publishes both, so that
   * is a provider older than this field, never a site without a name.
   *
   * Waits for the fetch to settle so the tab is not written twice; `null` (no
   * designed screen) is a settled answer, `undefined` is still pending.
   */
  useEffect(() => {
    if (screen === undefined) return
    const designed = screen?.data?.screen?.data as
      | { seo?: { title?: string } }
      | undefined
    document.title = resolveNotFoundTitle({
      designedTitle: designed?.seo?.title,
      siteTitle: siteTitle ?? brandName,
      separator: titleSeparator,
    })
  }, [screen, brandName, siteTitle, titleSeparator])

  const fallback = (
    <SiteStatusScreen
      // The 404, and only the 404, offers site search (AGL-2187).
      search
      code={code}
      title={title}
      message={message}
    />
  )

  if (screen === undefined) return null
  if (!screen) return fallback

  return (
    <ErrorBoundaryComponent fallback={fallback}>
      {/* The renderer's plugin gate suspends (`use(...)` in
          `catch-all-client`). On the page that suspension is deliberately
          unwrapped so it blocks the streamed shell (AGL-1541); here there is
          no shell left to block — this mounts on the client, after a fetch —
          so a boundary is what keeps it from throwing. */}
      <Suspense fallback={null}>
        <CatchAllClient {...screen} />
      </Suspense>
    </ErrorBoundaryComponent>
  )
}

SiteNotFound.displayName = 'SiteNotFound'

export default SiteNotFound
