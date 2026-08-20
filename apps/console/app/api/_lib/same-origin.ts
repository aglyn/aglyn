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
 * Fail-closed same-origin check for a state-changing POST (AGL-1902, D9).
 *
 * The repo has no `Sec-Fetch-*` checks anywhere and no CSRF module — AGL-919
 * deleted the last one for having zero callers and a fail-open
 * `CSRF_SECRET || ''` default. This is deliberately not a revival of that: it
 * is a small shared helper with no configuration and no secret, so there is
 * nothing to leave unset.
 *
 * Two headers, and the asymmetry between them is the whole design:
 *
 * - **`Origin` must be present and must equal this request's own host.** Every
 *   browser sends `Origin` on a `fetch` POST, so absence means the caller is
 *   not a browser doing what this route expects. Absence REFUSES.
 * - **`Sec-Fetch-Site` must be `same-origin` when present.** Not every client
 *   sends it, so absence cannot refuse without breaking callers that are fine;
 *   a mismatched value, though, is a browser telling us plainly that this is
 *   cross-site.
 *
 * The scheme is compared too. `http://example.com` and `https://example.com`
 * are different origins, and accepting the first would let a network attacker
 * on a plaintext sibling drive a request that must be HTTPS-only.
 *
 * This must genuinely reject rather than warn. A gate that logs is a property
 * that is claimed, not held.
 */
export function sameOriginRefusal(request: Request): Response | null {
  const host = String(request.headers.get('host') ?? '').toLowerCase()
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')

  if (site && site !== 'same-origin') {
    return Response.json(
      { error: 'Cross-site request refused', reason: 'cross-site' },
      { status: 403 },
    )
  }
  if (!origin || !host) {
    return Response.json(
      { error: 'Cross-site request refused', reason: 'no-origin' },
      { status: 403 },
    )
  }
  let originHost: string
  let originProtocol: string
  try {
    const parsed = new URL(origin)
    originHost = parsed.host.toLowerCase()
    originProtocol = parsed.protocol
  } catch {
    return Response.json(
      { error: 'Cross-site request refused', reason: 'bad-origin' },
      { status: 403 },
    )
  }
  if (originHost !== host) {
    return Response.json(
      { error: 'Cross-site request refused', reason: 'origin-mismatch' },
      { status: 403 },
    )
  }
  // Localhost is the one place the console legitimately runs on `http`.
  const isLocal =
    originHost === 'localhost' ||
    originHost.startsWith('localhost:') ||
    originHost.startsWith('127.0.0.1')
  if (originProtocol !== 'https:' && !isLocal) {
    return Response.json(
      { error: 'Cross-site request refused', reason: 'insecure-origin' },
      { status: 403 },
    )
  }
  return null
}
