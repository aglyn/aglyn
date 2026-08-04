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

/**
 * Drop the cached HTML for specific tenant pages (AGL-1150).
 *
 * Publishing a version wrote the pointer and then everyone waited. The catch-all
 * page is `revalidate = 60`, and time-based ISR does not mean "stale for 60
 * seconds" — after the window the NEXT visitor is still served the stale copy
 * while Next regenerates behind them, so the change appears on the visit after
 * that. Publish, refresh, see nothing, refresh again, see it. That is the
 * reported symptom exactly.
 *
 * This route exists because the cache lives HERE. The console cannot purge it
 * from its own process; only the deployment that rendered a page can drop it.
 *
 * Why a shared secret rather than a user token: the caller is the console's
 * server, not a browser. It has already checked that the person publishing may
 * edit this host — re-deriving that here would mean teaching the tenant runtime
 * about console membership, which is a boundary worth not crossing for a cache
 * hint. What this route can do is bounded: drop cached HTML for paths on ONE
 * host. The worst an attacker with the secret achieves is making pages
 * regenerate, so it is deliberately not treated as an authorization boundary —
 * it is rate-limited by being uninteresting.
 */

import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

/**
 * Bound the blast radius of one call, and of a malformed one (AGL-1239).
 *
 * Was 50, which was picked to be *a* bound rather than from anything measured —
 * and 50 turned out to be roughly the size of a real site. `aglyn-marketing`'s
 * nav component fans out to 48 screens: two more pages carrying the nav and
 * every component publish there would leave the overflow stale for the whole
 * revalidate window. A cap should not be reachable by ordinary use.
 *
 * 250 is chosen the same way a cap should be: from what it costs. Each accepted
 * path is one `revalidatePath` — a cache-key delete, no render, no network — so
 * the work here is linear and small. The expensive half of a publish drop is the
 * console-side dependent scan, and that is bounded separately by its own
 * `SCAN_LIMIT` of 2000. This number therefore only has to be larger than any
 * plausible site and smaller than a payload worth refusing.
 */
const MAX_PATHS = 250

function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['REVALIDATE_SECRET']
  if (!secret) {
    // Fail LOUD rather than silently doing nothing. A revalidation that
    // quietly no-ops is indistinguishable from a slow cache, which is the
    // problem this route exists to end.
    return Response.json(
      { error: 'revalidation is not configured (REVALIDATE_SECRET)' },
      { status: 503 },
    )
  }
  if (request.headers.get('x-revalidate-secret') !== secret) return unauthorized()

  let payload: { host?: unknown; paths?: unknown }
  try {
    payload = (await request.json()) as typeof payload
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const host = String(payload.host ?? '').trim()
  if (!host || host.includes('/')) {
    return Response.json({ error: 'missing or invalid host' }, { status: 400 })
  }

  const paths = Array.isArray(payload.paths) ? payload.paths : []
  if (!paths.length) {
    return Response.json({ error: 'no paths' }, { status: 400 })
  }

  // Say when the cap bites (AGL-1161). `slice` silently discarded the
  // overflow: a caller sending 80 paths got `count: 50` back and nothing to
  // distinguish that from having sent 50. The dropped pages then stayed stale
  // for the full revalidate window while the editor reported a successful
  // publish — the same "reported fast, still slow" confusion AGL-1150 set out
  // to remove. A widely-used component is exactly the case that overflows.
  const requested = paths.length
  const accepted = paths.slice(0, MAX_PATHS)
  const truncated = requested - accepted.length

  const revalidated: string[] = []
  for (const raw of accepted) {
    const path = String(raw ?? '')
    // Only absolute, same-host paths. `..` in a cache key is not a traversal
    // in the filesystem sense, but it is a way to name a page on a DIFFERENT
    // host's tree, and one tenant must never be able to bust another's cache.
    if (!path.startsWith('/') || path.includes('..')) continue
    // The middleware rewrites `https://{host}{path}` to `/{host}{path}`, so
    // that — not the public URL — is the cache key Next stores under.
    const target = `/${host}${path === '/' ? '' : path}`
    revalidatePath(target)
    revalidated.push(target)
  }

  if (truncated > 0) {
    // Logged as well as returned: the caller may not surface it, and this is
    // the only record that some pages were left stale on purpose.
    console.warn(
      JSON.stringify({
        tag: 'AGL-1161:revalidate-truncated',
        host,
        requested,
        cap: MAX_PATHS,
        dropped: truncated,
      }),
    )
  }

  return Response.json(
    {
      revalidated,
      count: revalidated.length,
      // `requested` and `truncated` are what let a caller tell "everything you
      // asked for" apart from "as much as I would take".
      requested,
      truncated,
      ...(truncated > 0 ? { cap: MAX_PATHS } : {}),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
