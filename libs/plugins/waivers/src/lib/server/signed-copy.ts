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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { NO_CLIENT_ADDRESS_BUCKET, readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { consumeRateLimit } from '@aglyn/tenant-data-admin'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import type { StoredWaiverSignature } from '../model/waiver-signature'
import { isDocumentId, waiversRefs } from './db'
import { signaturePdf, signaturePdfFilename } from './documents'
import { publicSite, refuse } from './gate'
import { readStoredSignature, siteBusinessName, waiversNow } from './sign'

/*==========================================
 * THE SIGNER'S OWN COPY, TO DOWNLOAD (AGL-4042, e-sign consent v2).
 *
 * The consent tells a signer they can download their signed copy when they
 * finish, and a signer who gave no email has no other way to keep one. So
 * every electronic signing answers with a link to its PDF: on the signer's
 * own device a download button, on the window's tablet or the register's
 * display a code to scan. The link carries a one-hour secret whose SHA-256
 * is on the signature (`signedCopy`); it opens that one signature and
 * nothing else, and a paper signing gets none (it agreed to nothing
 * electronic and its signer holds the paper).
 *=========================================*/

/** How long a signed copy's link works. */
export const WAIVER_SIGNED_COPY_MS = 60 * 60 * 1000

/** Downloads one device may make a minute. */
const RATE_MAX = 20
const RATE_WINDOW_MS = 60 * 1000

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * A fresh link to a signature's PDF, recorded as its hash: a new one each
 * time (a replayed press gets its own), the last one the one that works.
 * Null for a paper signing.
 */
export async function signedCopyPath(input: {
  orgId: string
  hostId: string
  signature: Pick<StoredWaiverSignature, 'id' | 'method'>
}): Promise<string | null> {
  if (input.signature.method === 'paper') return null
  const token = randomBytes(24).toString('base64url')
  await waiversRefs
    .signature(input.orgId, input.signature.id)
    .set({ signedCopy: { tokenSha256: sha256(token), expiresAtMs: waiversNow() + WAIVER_SIGNED_COPY_MS } }, { merge: true })
  const query = new URLSearchParams({ hostId: input.hostId, signatureId: input.signature.id, token })
  return `/api/${WAIVERS_API_ROUTES.signedCopy}?${query.toString()}`
}

function matches(stored: unknown, token: string): boolean {
  if (typeof stored !== 'string' || stored.length !== 64 || !token) return false
  const given = Buffer.from(sha256(token), 'hex')
  const held = Buffer.from(stored, 'hex')
  return given.length === held.length && timingSafeEqual(given, held)
}

/** `GET waivers/signed-copy?hostId=&signatureId=&token=`: the signer's PDF, within the hour. */
export async function signedCopyRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const params = new URL(request.url).searchParams
  const hostId = String(params.get('hostId') ?? '')
  const signatureId = String(params.get('signatureId') ?? '')
  const token = String(params.get('token') ?? '').slice(0, 100)
  const gone = () => refuse(404, 'This link has expired. Ask the business for your signed copy.')
  if (!isDocumentId(hostId) || !isDocumentId(signatureId) || !token) return gone()
  const ip = readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
  const rate = await consumeRateLimit(`waiver-copy:${ip}`, { limit: RATE_MAX, windowMs: RATE_WINDOW_MS })
  if (!rate.allowed) return refuse(429, 'Too many downloads. Wait a minute and try again.')
  const site = await publicSite(hostId)
  if (site.ok === false) return gone()
  const snapshot = await waiversRefs.signature(site.orgId, signatureId).get()
  const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined
  const copy = data?.['signedCopy'] as { tokenSha256?: unknown; expiresAtMs?: unknown } | undefined
  if (!data || data['hostId'] !== hostId || !matches(copy?.tokenSha256, token)) return gone()
  if (!(Number(copy?.expiresAtMs) > waiversNow())) return gone()
  const signature = readStoredSignature(data)
  if (!signature) return gone()
  const bytes = signaturePdf(signature, siteBusinessName(site.host))
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${signaturePdfFilename(signature)}"`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
