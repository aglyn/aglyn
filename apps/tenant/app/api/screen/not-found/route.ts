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

// lockdown-423: via apps/tenant/app/[host]/[[...slug]]/load-page-data.ts
// `loadNotFoundScreen` sits in the same loader and behind the same lockdown
// branch; a locked host has no designed 404 body to hand out.

import { loadNotFoundScreen } from '../../../[host]/[[...slug]]/load-page-data'

/**
 * The host's designed 404 body (AGL-2342).
 *
 * ## Why the 404 screen is fetched rather than rendered with the page
 *
 * Next 16 gives exactly one way to emit a `404` status from a page render —
 * `notFound()` — and `notFound()` replaces the whole document: measured on
 * `next@16.2.11`, both at request time (`app-render.js`, the `getErrorRSCPayload`
 * branch) and on the prerender path (which server-renders the boundary only
 * when `experimental.cacheComponents` is on), the served HTML is
 * `<html id="__next_error__">` with an EMPTY body and the boundary is rendered
 * by the client from the flight payload. Verified against production and
 * reproduced in a bare Next app with no middleware and no ISR.
 *
 * So the designed body cannot travel with the page. It also cannot travel with
 * the BOUNDARY: a `not-found` boundary is serialized into every successful
 * response too (confirmed in the same repro — a 200 page carries its 404
 * boundary's rendered output), so composing a screen there would put a full
 * screen compose on every page load of every site on the platform.
 *
 * Fetching it is what keeps the happy path free. The boundary ships a client
 * component that calls this route only when it actually mounts, which is only
 * on a real 404.
 *
 * ## The 404-on-no-screen answer is the point, not an error
 *
 * A host that has designated nothing gets `404 { error: 'Not found' }` and the
 * boundary falls back to the platform status screen. That branch is load-bearing
 * — it is the floor that keeps a site without a designed error page from
 * trading a chrome-less page for a blank one — so it must stay cheap and
 * total: `loadNotFoundScreen` answers `null` for every failure, not just for
 * "unset".
 */
export async function GET(request: Request): Promise<Response> {
  const host = new URL(request.url).searchParams.get('host')
  if (!host) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const props = await loadNotFoundScreen(host)
    if (!props?.nodes) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json(props, {
      headers: {
        // Caches like the page it stands in for. One compose per host per
        // minute, however many missing URLs get hit in that minute — which
        // matters here more than on a real page, because 404 traffic is
        // exactly the traffic nobody is watching.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Load failed' }, { status: 500 })
  }
}
