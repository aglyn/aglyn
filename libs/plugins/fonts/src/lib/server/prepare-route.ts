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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { FONT_UPLOAD_MAX_BYTES, type PrepareFontResponse } from '../installer/constants'
import { FontPrepareError, prepareFontFile } from '../installer/prepare-font'

/**
 * `POST /api/fonts/prepare?hostId=…` (AGL-3656): one font file in as the
 * request body, its facts and a WOFF2 ready for the site's media library out.
 *
 * The console's dispatcher has already refused an unverified account, a
 * lockdown, a caller over the write limit and a site with the plugin off.
 * What it cannot know is the member, so this asks:
 *
 *   401  no bearer token, or one the verifier refused
 *   500  the token could not be checked at all
 *   403  unverified address (impersonation exempt), or not a site admin or
 *        editor — the people who may change its theme
 *   400  no site named
 *   404  no such site
 *   413  over the size a font file may be, before the body is read
 *   415  not a font, or a collection
 *   422  a license that forbids embedding, or a file that cannot be read
 *
 * It stores nothing. The console uploads the WOFF2 through the media
 * library's own route, which is what keeps one copy, the storage band, the
 * counters and quarantine in one place.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

const refuse = (status: number, error: string, code?: string) =>
  Response.json({ error, ...(code ? { code } : {}) }, { status, headers: NO_STORE })

/** Host roles that may change a site's theme. */
const THEME_ROLES = new Set(['admin', 'editor'])

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

export async function prepareFontRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return refuse(401, 'Unauthenticated')
  let decoded: Parameters<typeof isEmailVerified>[0]
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    // A refused credential is the caller's 401. A failure to check one is
    // ours and keeps a 5xx, so an outage pages instead of reading as a bad
    // token (AGL-2852).
    if (isRefusedIdToken(error)) return refuse(401, 'Unauthenticated')
    console.error('[fonts] the caller could not be verified', error)
    return refuse(500, 'The sign-in could not be checked. Try again.')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return refuse(403, 'Verify your email address first')
  }
  const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
  if (!HOST_ID.test(hostId)) return refuse(400, 'Missing hostId')
  const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
  if (!host.exists) return refuse(404, 'Unknown site')
  const role = String((host.get('memberRoles') as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (decoded['staff'] !== true && !THEME_ROLES.has(role)) {
    return refuse(403, "Only a site admin or editor can change this site's fonts")
  }

  // Refused before the body is read when the request says it is too big.
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > FONT_UPLOAD_MAX_BYTES) {
    return refuse(413, `A font file can be up to ${Math.round(FONT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB.`, 'too-large')
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  try {
    const { face, woff2 } = await prepareFontFile(bytes)
    const body: PrepareFontResponse = { face, woff2: Buffer.from(woff2).toString('base64') }
    return Response.json(body, { status: 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof FontPrepareError) return refuse(error.status, error.message, error.code)
    console.error('[fonts] prepare failed', error)
    return refuse(500, 'The font could not be prepared. Try again.')
  }
}
