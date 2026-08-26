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

import { resolveSeoTitle } from '@aglyn/aglyn'
import ErrorBoundaryComponent from '@aglyn/shared-ui-jsx/components/error-boundary.component'
import { Suspense, useEffect, useState } from 'react'
import CatchAllClient from '../app/[host]/[[...slug]]/catch-all-client'
import type { Props } from '../app/[host]/[[...slug]]/types'
import { useHostBrand } from '../app/[host]/host-brand.context'
import SiteStatusScreen from './site-status-screen.component'

/**
 * The body of a tenant 404 (AGL-2342).
 *
 * navigable fallback; this answers it with the site's OWN page — the screen its
 * author designed, with the header, nav and footer they put on it.
 *
 * ## Why the screen is fetched instead of rendered with the page
 *
 * Two framework facts, both measured on `next@16.2.11` rather than assumed, and
 * together they leave exactly one place for this to live.
 *
 *  1. **`notFound()` is the only way to emit a `404` status, and it discards
 *     the document.** The served HTML is `<html id="__next_error__">` with an
 *     empty `<body>`; the boundary is rendered by the client off the flight
 *     payload. Reproduced in a bare Next app with no middleware, no ISR and a
 *     plain route, so it is not something about this app. (The one escape,
 *     `experimental.cacheComponents`, is the Cache Components rewrite.)
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
  const { hostKey, brandName } = useHostBrand()
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
   * The tab says what the page is (AGL-2291).
   *
   * A 404 shipped with NO `<title>` at all — measured across the live
   * marketing routes — and the reason is fact (1) in the docblock above: the
   * served document is Next's empty `__next_error__` shell, so there is no
   * head for `generateMetadata` to fill and no server-rendered `<title>` to
   * inherit. Every other page's title is composed in `buildMetadata`; this is
   * the one surface that has to write its own, and it can only do so here,
   * after mount, for exactly the same reason the body is fetched here.
   *
   * Composed through the SAME resolver as every other page (AGL-1341): the
   * designed screen's authored SEO title wins verbatim, otherwise the visible
   * heading joins the site's name. `brandName` is the SITE's name, never the
   * platform's — a white-label 404 must not read "Aglyn" any more than a
   * white-label homepage may.
   *
   * Waits for the fetch to settle so the tab is not written twice; `null` (no
   * designed screen) is a settled answer, `undefined` is still pending.
   */
  useEffect(() => {
    if (screen === undefined) return
    const designed = screen?.data?.screen?.data as
      | { seo?: { title?: string } }
      | undefined
    document.title = resolveSeoTitle({
      title: designed?.seo?.title,
      name: title,
      siteTitle: brandName,
      fallback: title,
    })
  }, [screen, title, brandName])

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
