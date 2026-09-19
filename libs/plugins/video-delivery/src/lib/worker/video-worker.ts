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

import { DELIVERY_TOKEN_PARAM, verifyDeliveryToken } from '../delivery-token'
import type { R2BucketBinding, R2ObjectMetadata } from './r2-binding'

/**
 * The delivery Worker (AGL-2824): serves one R2 object to the holder of a
 * token minted for it.
 *
 * `wrangler.jsonc` at the plugin's root deploys this file as the Worker named
 * `video`, with the `aglyn-video` bucket bound as `VIDEO_BUCKET` and the
 * delivery secret set as the Worker secret `MEDIA_VIDEO_DELIVERY_SECRET` —
 * the same value the platform mints with.
 *
 * ## One request
 *
 * `GET|HEAD /{key}?token={token}`. The token is verified before the bucket is
 * touched, and it must name exactly the key in the path:
 *
 * - no secret configured: `503`;
 * - a token that does not verify — malformed, altered, expired, signed with
 *   another secret, or claiming a lifetime no minter issues: `403`;
 * - a genuine token for another object, or an object the bucket does not
 *   hold: `404`.
 *
 * A refusal has no body, so it says nothing about which of those it was
 * beyond its status.
 *
 * ## Ranges
 *
 * A single `bytes=` range is answered `206` with `Content-Range`, the same
 * three forms the platform's CDN route honors (`a-b`, `a-`, `-n`); a range
 * past the end is `416`; anything else — several ranges, another unit,
 * malformed syntax, an `If-Range` that does not match — is ignored and the
 * whole object is sent, which RFC 9110 allows and no client can misread.
 * Every response says `Accept-Ranges: bytes`.
 *
 * ## Caching
 *
 * `private`, for at most as long as the token has left: a viewer's browser
 * may keep the ranges it fetched for the life of the URL that fetched them,
 * and no shared cache — Cloudflare's included — holds anything. So a
 * takedown that removes the object leaves nothing to purge.
 */

export interface VideoWorkerEnv {
  VIDEO_BUCKET: R2BucketBinding
  MEDIA_VIDEO_DELIVERY_SECRET?: string
}

/**
 * The same base policy the platform's media CDN sets on every response
 * (`MEDIA_CDN_BASE_CSP`), restated because the Worker bundles nothing from
 * the platform: a film opened as a top-level document can run nothing.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'"

/** The longest a browser may keep a response, whatever the token has left. */
const MAX_BROWSER_CACHE_SECONDS = 60 * 60

/** Headers every answer carries, refusals included. */
function baseHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'content-security-policy': CONTENT_SECURITY_POLICY,
  })
}

function refusal(status: number, extra: Record<string, string> = {}): Response {
  const headers = baseHeaders()
  headers.set('cache-control', 'no-store')
  for (const [name, value] of Object.entries(extra)) headers.set(name, value)
  return new Response(null, { status, headers })
}

type ParsedRange = { start: number; end: number } | 'unsatisfiable' | null

/**
 * One `bytes=` range against an object of `size` bytes, both ends inclusive,
 * with the platform CDN's semantics: `null` means serve the whole object.
 */
export function parseByteRange(header: string | null, size: number): ParsedRange {
  if (!header) return null
  const unit = /^bytes=(.*)$/i.exec(header.trim())
  if (!unit) return null
  const specs = (unit[1] ?? '').split(',')
  if (specs.length !== 1) return null
  const spec = /^(\d*)-(\d*)$/.exec((specs[0] ?? '').trim())
  if (!spec) return null
  const [, startRaw = '', endRaw = ''] = spec
  if (!startRaw && !endRaw) return null
  if (!startRaw) {
    const suffix = Number(endRaw)
    if (!Number.isSafeInteger(suffix)) return null
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startRaw)
  if (!Number.isSafeInteger(start)) return null
  const end = endRaw ? Number(endRaw) : size - 1
  if (!Number.isSafeInteger(end)) return null
  if (endRaw && end < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/** The object key a path names, or null for one that cannot be decoded. */
function keyFromPath(pathname: string): string | null {
  try {
    const key = pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/')
    return key && !key.split('/').includes('..') ? key : null
  } catch {
    return null
  }
}

function objectHeaders(object: R2ObjectMetadata, maxAgeSeconds: number): Headers {
  const headers = baseHeaders()
  headers.set('content-type', object.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('accept-ranges', 'bytes')
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', `private, max-age=${maxAgeSeconds}`)
  headers.set(
    'access-control-expose-headers',
    'accept-ranges, content-length, content-range, etag',
  )
  return headers
}

export async function handleVideoRequest(
  request: Request,
  env: VideoWorkerEnv,
  nowMs: number = Date.now(),
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    const headers = baseHeaders()
    headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
    headers.set('access-control-allow-headers', 'range, if-range')
    headers.set('access-control-max-age', '86400')
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return refusal(405, { allow: 'GET, HEAD, OPTIONS' })
  }
  if (!env.MEDIA_VIDEO_DELIVERY_SECRET) return refusal(503)

  const url = new URL(request.url)
  const key = keyFromPath(url.pathname)
  if (!key) return refusal(404)
  const verdict = await verifyDeliveryToken(
    url.searchParams.get(DELIVERY_TOKEN_PARAM),
    env.MEDIA_VIDEO_DELIVERY_SECRET,
    { key, nowMs },
  )
  if (verdict.ok === false) {
    if (verdict.refusal === 'secret') return refusal(503)
    return refusal(verdict.refusal === 'key' ? 404 : 403)
  }
  const maxAgeSeconds = Math.max(
    0,
    Math.min(MAX_BROWSER_CACHE_SECONDS, Math.floor((verdict.claims.expiresAtMs - nowMs) / 1000)),
  )

  if (request.method === 'HEAD') {
    const object = await env.VIDEO_BUCKET.head(key)
    if (!object) return refusal(404)
    const headers = objectHeaders(object, maxAgeSeconds)
    headers.set('content-length', String(object.size))
    return new Response(null, { status: 200, headers })
  }

  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    const object = await env.VIDEO_BUCKET.head(key)
    if (!object) return refusal(404)
    const ifRange = request.headers.get('if-range')
    const parsed =
      ifRange && ifRange !== object.httpEtag ? null : parseByteRange(rangeHeader, object.size)
    if (parsed === 'unsatisfiable') {
      return refusal(416, { 'content-range': `bytes */${object.size}` })
    }
    if (parsed) {
      const length = parsed.end - parsed.start + 1
      const ranged = await env.VIDEO_BUCKET.get(key, {
        range: { offset: parsed.start, length },
      })
      if (!ranged) return refusal(404)
      const headers = objectHeaders(ranged, maxAgeSeconds)
      headers.set('content-range', `bytes ${parsed.start}-${parsed.end}/${ranged.size}`)
      headers.set('content-length', String(length))
      return new Response(ranged.body, { status: 206, headers })
    }
  }

  const object = await env.VIDEO_BUCKET.get(key)
  if (!object) return refusal(404)
  const headers = objectHeaders(object, maxAgeSeconds)
  headers.set('content-length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

export default {
  fetch(request: Request, env: VideoWorkerEnv): Promise<Response> {
    return handleVideoRequest(request, env)
  },
}
