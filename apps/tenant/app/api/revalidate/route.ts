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

/** Bound the blast radius of one call, and of a malformed one. */
const MAX_PATHS = 50

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

  const revalidated: string[] = []
  for (const raw of paths.slice(0, MAX_PATHS)) {
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

  return Response.json(
    { revalidated, count: revalidated.length },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
