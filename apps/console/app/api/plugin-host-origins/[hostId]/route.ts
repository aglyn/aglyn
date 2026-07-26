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
 * A host's extra framing origins for the sandbox plugin loader (AGL-884).
 *
 * GET /api/plugin-host-origins/{hostId} → { origins: string[] }
 *
 * The plugin origin's `/load` widens its `frame-ancestors` CSP to the
 * framing site's VERIFIED custom domain — but only via this server-side
 * lookup of `hosts/{hostId}.cname` (written transactionally by the
 * domain-attach flow), never from a caller-supplied origin. Public data
 * (a site's domain is public by definition), cache-friendly, empty when
 * the host has no custom domain.
 */
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { NextRequest, NextResponse } from 'next/server'

const HOST_ID = /^[A-Za-z0-9_-]{1,64}$/
// A bare hostname — no scheme, path, port, or whitespace.
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ hostId: string }> },
) {
  const { hostId } = await context.params
  if (!HOST_ID.test(hostId ?? '')) {
    return NextResponse.json(
      { error: 'Bad host id' },
      { status: 400, headers: CORS_HEADERS },
    )
  }
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    const cname = String(snapshot.get('cname') ?? '').toLowerCase()
    const origins =
      snapshot.exists && HOSTNAME.test(cname) ? [`https://${cname}`] : []
    return NextResponse.json(
      { origins },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          // Domains change rarely; a short shared cache keeps the loader
          // fast without letting a detached domain linger for long.
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    )
  } catch (error) {
    console.error('plugin host-origins lookup failed:', error)
    return NextResponse.json(
      { origins: [] },
      { status: 200, headers: CORS_HEADERS },
    )
  }
}
