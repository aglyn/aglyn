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

import type { HostUid, ScreenUid } from '@aglyn/aglyn/server'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import type { Metadata } from 'next'
import SiteNotFound from '../../components/site-not-found.component'
import { resolveNotFoundScreenId } from '../../utils/not-found-screen-id'
import {
  hostSeoTitleParts,
  resolveNotFoundTitle,
} from '../../utils/not-found-title'
import { getHostCached } from './host-data'

/**
 * The tenant's branded 404 (AGL-2074).
 *
 * ## When this renders
 *
 * On EVERY unmatched path (AGL-2342). `page.tsx` calls `notFound()` whenever
 * `load-page-data` resolves no screen and no collection entry, and there is no
 * longer a second exit that bypasses this boundary.
 *
 * There used to be: a host with `errorScreens.notFound` bound got its designed
 * screen back from the loader as ordinary props — a `200 OK` carrying
 * `noindex`. Two things were wrong with that. The status was a lie, and it was
 * a lie nobody was collecting on: measured on production 2026-08-19,
 * `errorScreens` was unset on all six hosts, so the branch had never once
 * fired and every 404 on the platform was the fallback below.
 *
 * The designed screen now arrives THROUGH this boundary instead, so it and the
 * real `404` status ship together. `SiteNotFound` holds the whole mechanism
 * and the two measured framework facts that force it.
 *
 * ## Why it lives at `[host]/` and not at the app root
 *
 * Placement is the whole design. A not-found boundary renders inside its
 * segment's layout, and `[host]/layout.tsx` is where the host is resolved:
 * put here, the 404 inherits `HostThemeProvider` (the site's colors and
 * fonts), the site's favicon and manifest links, and — via
 * `HostBrandProvider` — its logo and name. Put at `app/`, it would render
 * above all of that and could only ever be generic. The root boundary still
 * exists for requests that never resolve a host; it is deliberately the
 * plainer one.
 *
 * AGL-2187 leaned on that placement again: the site's public top-level pages
 * ride the same context down from the layout, so the FALLBACK renders a real
 * header, nav and footer instead of a single button. `SiteStatusScreen` has
 * the whole rule, including why the site's AUTHORED nav cannot appear on it
 * and what is offered in its place. AGL-2342 leans on it a third time: the
 * host key the designed screen is fetched by rides down the same context.
 *
 * ## Status code, and what the server does and does not render
 *
 * Next emits a real 404 for this boundary, which is what `x-matched-path:
 * /[host]/[[...slug]]` returning `HTTP/2 404` on `https://aglyn.com/edit-access`
 * already showed — the status was never the defect. The BODY was, and still
 * is: Next 16 serves `notFound()` as a `__next_error__` document whose body is
 * a hard-coded empty seed, and lets the client render this boundary from the
 * flight payload. Measured on production 2026-09-07 against `next@16.3.3`
 * (`<html id="__next_error__">`, `<body><div hidden>…</div></body>`, the
 * boundary present only in the inlined payload) and read in the source:
 * `getErrorRSCPayload` in `app-render.js` builds that seed, every shell error
 * from `notFound()` lands there, and React's streaming renderer runs no error
 * boundary that could render this component first. No userland change puts
 * markup in that body — see `SiteNotFound`.
 *
 * The HEAD of that document is the exception, and it is where the server does
 * render (AGL-2648). The recovery shell resolves metadata through the
 * `not-found` convention: each segment's `not-found` module may export
 * `metadata`/`generateMetadata`, the deepest one wins, and it is called with
 * the segment's `params` — so `generateMetadata` below can read the host that
 * the component cannot. That is what puts a `<title>` on the served 404.
 *
 * What must NOT be "fixed" by rendering this content from `page.tsx` instead:
 * that trades the 404 for a 200, and a soft-404 tells every crawler a mistyped
 * URL is a real page.
 */

/**
 * The served `<title>` of a tenant 404 (AGL-2648).
 *
 * Paid for ONLY on a 404: Next reads a `not-found` module's metadata solely
 * when it is recovering from `notFound()` — a successful render never calls
 * this — so, unlike the component itself (fact 2 in `SiteNotFound`), reading
 * host data here costs the happy path nothing. What it reads is cheap even
 * so: the host document the layout already fetched, and the designed 404
 * screen's DOCUMENT for its authored SEO title. Not the compose — the body is
 * fetched by the client for the reasons `SiteNotFound` records, and a title
 * does not need three hundred nodes to answer.
 *
 * Composed through the one rule both writers share (`utils/not-found-title`),
 * from the same fields `buildMetadata` reads for every routed page. Never
 * throws: a host that will not resolve, a screen read that fails, or any
 * other surprise answers the page's bare name, because a metadata resolver
 * that throws inside the recovery shell has nothing left to recover into.
 *
 * No `robots` entry on purpose. Next's own `NonIndex` writes
 * `<meta name="robots" content="noindex">` into this head whenever the status
 * is 404, and the boundary writes its own after hydration; a third copy would
 * only be noise.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>
}): Promise<Metadata> {
  const { host } = await params
  return { title: await resolveHostNotFoundTitle(host) }
}

async function resolveHostNotFoundTitle(hostParam: string): Promise<string> {
  try {
    const hostRes = await getHostCached(hostParam)
    const host = hostRes.host
    if (!host) return resolveNotFoundTitle({})
    const screenId = resolveNotFoundScreenId(host)
    const screen = screenId
      ? (
          await getScreen({
            hostId: host.$id as HostUid,
            screenId: screenId as ScreenUid,
          })
        ).screen
      : undefined
    return resolveNotFoundTitle({
      designedTitle: screen?.seo?.title,
      ...hostSeoTitleParts(host),
    })
  } catch (error) {
    console.error('not-found title lookup failed:', error)
    return resolveNotFoundTitle({})
  }
}

export default function HostNotFound() {
  return (
    <SiteNotFound
      code="404"
      title={'We can’t find that page'}
      message={
        'The link may be out of date, or the page may have been moved or ' +
        'removed. Everything else on the site is still here.'
      }
    />
  )
}
