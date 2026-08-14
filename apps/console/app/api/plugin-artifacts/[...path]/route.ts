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
 * Immutable plugin-artifact streaming (AGL-879).
 *
 * GET /api/plugin-artifacts/{listingId}/{version}/{sha256}.bundle
 *
 * The artifacts bucket stays PRIVATE; this route is the only read path.
 * The dedicated plugin origin (plugins.aglyn.com, tools/plugin-loader/
 * origin) edge-rewrites its `/artifacts/:path*` to here, so both the
 * sandbox loader's same-origin fetch and the realm loaders' cross-origin
 * fetches resolve through one authenticated-at-rest, public-at-edge
 * stream.
 *
 * Deliberately unauthenticated (like the media CDN routes): bundles are
 * public content-addressed code — the marketplace lists them publicly, a
 * URL requires knowing the exact sha256, and every consumer re-verifies
 * that hash (realm loads additionally verify the staff Ed25519 signature)
 * before executing a byte. Responses are immutable — a new version is a
 * new URL — so the CDN caches them forever.
 */
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { NextRequest, NextResponse } from 'next/server'

// lockdown-423: exempt — content-addressed public artifact delivery (immutable sha-named
// bundles, CORS *); no caller identity, no org scope at this surface.

const LISTING_ID = /^[A-Za-z0-9_-]{1,64}$/
const VERSION = /^[A-Za-z0-9._-]{1,32}$/
const BUNDLE_FILE = /^[a-f0-9]{64}\.bundle$/

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const [listingId, version, file] = path ?? []
  if (
    !LISTING_ID.test(listingId ?? '') ||
    !VERSION.test(version ?? '') ||
    !BUNDLE_FILE.test(file ?? '')
  ) {
    return NextResponse.json(
      { error: 'Bad artifact path' },
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const bucketName = process.env.PLUGIN_ARTIFACTS_BUCKET
  if (!bucketName) {
    return NextResponse.json(
      { error: 'Plugin artifacts are not configured' },
      { status: 501, headers: CORS_HEADERS },
    )
  }

  try {
    const object = firebaseAdmin
      .app()
      .storage()
      .bucket(bucketName)
      .file(`artifacts/${listingId}/${version}/${file}`)
    const [exists] = await object.exists()
    if (!exists) {
      return NextResponse.json(
        { error: 'Unknown artifact' },
        { status: 404, headers: CORS_HEADERS },
      )
    }
    const [bytes] = await object.download()
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('plugin artifact stream failed:', error)
    return NextResponse.json(
      { error: 'Artifact unavailable' },
      { status: 502, headers: CORS_HEADERS },
    )
  }
}
