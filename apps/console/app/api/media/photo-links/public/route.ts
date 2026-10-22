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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  claimPhotoLinkUpload,
  consumeRateLimit,
  firebaseAdmin,
  loadSharp,
  PHOTO_LINK_PHOTO_MAX_BYTES,
  PHOTO_LINK_RATE_LIMIT,
  PHOTO_LINK_TYPES,
  photoLinkCallerAddress,
  photoLinkSummary,
  readPhotoLinkByToken,
  releasePhotoLinkUpload,
  storedPhotoLinkBytes,
  type PhotoLinkRefusal,
} from '@aglyn/tenant-data-admin'
import { normalizeUploadContentType } from '@aglyn/aglyn/app-utils/console/media-upload-limits'
import { ingestMedia } from '../../../../../utils/server/media-ingest'

/**
 * THE PAGE A PHOTO LINK OPENS TALKS TO THIS (AGL-3957): the one route in the
 * console that stores bytes with NO signed-in user. The `token` in the body
 * is the whole credential, checked by `readPhotoLinkByToken` on every call —
 * well-formed, present, secret matching, not expired, not revoked, not full.
 *
 * The token travels in a POST body and never in this route's address. The
 * page reads the secret from its own URL fragment, which the browser never
 * sends, so no request line — and so no server log, edge log or analytics
 * hit — ever carries a working link.
 *
 * - `{action: 'open', token}`: what the page shows before the first photo —
 *   the site's name, and how many photos the link still takes. A refused
 *   token answers with a `reason` the page words for the person holding the
 *   phone, and no more: an unknown link and a wrong secret read the same.
 * - `{action: 'store', token, fileName, contentType, data}`: one photo, with
 *   `data` base64, the shape the console's own upload route takes. JPEG, PNG
 *   or WebP; the page re-encodes what the phone picked before it sends, and
 *   the server never trusts that: the bytes are re-encoded here too,
 *   oriented and stripped of EXIF, XMP and IPTC, so a GPS position never
 *   reaches the library. The photo's place on the link is claimed in a
 *   transaction before it is stored, then stored through the media ingest AS
 *   THE MEMBER WHO MINTED THE LINK — their access, the site's lockdown, the
 *   takedown list and the workspace's storage band all apply — and the place
 *   is given back when the ingest refuses.
 *
 * Rate limited per phone and per link, in the durable store: a link is a
 * public address, and the budget is what keeps one from being a free upload
 * endpoint for the week it lives.
 */

const REFUSAL_STATUS: Record<PhotoLinkRefusal, number> = {
  invalid: 404,
  expired: 410,
  revoked: 410,
  full: 409,
}

const NO_STORE = { 'cache-control': 'no-store' }

function answer(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

function refusal(reason: PhotoLinkRefusal): Response {
  return answer({ ok: false, reason }, REFUSAL_STATUS[reason])
}

async function overBudget(key: string): Promise<boolean> {
  const verdict = await consumeRateLimit(key, PHOTO_LINK_RATE_LIMIT)
  return !verdict.allowed
}

const BUSY = (): Response => answer({ ok: false, reason: 'busy' }, 429)

async function open(request: Request, token: unknown): Promise<Response> {
  if (await overBudget(`photo-link:read:${photoLinkCallerAddress(request.headers)}`)) return BUSY()
  const firestore = firebaseAdmin.app().firestore()
  const link = await readPhotoLinkByToken(firestore, token)
  if (link.ok === false) return refusal(link.reason)
  const host = await firestore.collection('hosts').doc(link.doc.hostId).get()
  const name = String(host.get('displayName') ?? host.get('subdomain') ?? 'your site')
  return answer({ ok: true, site: { name }, link: link.summary }, 200)
}

async function store(request: Request, body: Record<string, unknown>): Promise<Response> {
  if (await overBudget(`photo-link:store:${photoLinkCallerAddress(request.headers)}`)) return BUSY()
  const firestore = firebaseAdmin.app().firestore()
  const link = await readPhotoLinkByToken(firestore, body['token'])
  if (link.ok === false) return refusal(link.reason)
  if (await overBudget(`photo-link:store:${link.linkId}`)) return BUSY()

  const fileName = String(body['fileName'] ?? 'photo').slice(0, 200)
  const contentType = normalizeUploadContentType(String(body['contentType'] ?? ''), fileName)
  if (!PHOTO_LINK_TYPES.has(contentType)) {
    return answer({ ok: false, reason: 'type', error: 'Send a JPEG, PNG or WebP photo' }, 415)
  }
  const sent = Buffer.from(String(body['data'] ?? ''), 'base64')
  if (!sent.length || sent.length > PHOTO_LINK_PHOTO_MAX_BYTES) {
    return answer(
      { ok: false, reason: 'size', error: `A photo can be ${Math.round(PHOTO_LINK_PHOTO_MAX_BYTES / 1024 / 1024)} MB at most` },
      413,
    )
  }
  let stored: { bytes: Buffer; contentType: string }
  try {
    stored = await storedPhotoLinkBytes(await loadSharp(), sent, contentType)
  } catch {
    return answer({ ok: false, reason: 'type', error: 'That file is not a photo this page can read' }, 415)
  }

  const claim = await claimPhotoLinkUpload(firestore, link.ref, stored.bytes.length)
  if (claim.ok === false) return refusal(claim.reason)
  // lockdown-423: via apps/console/utils/server/media-scope.ts — the ingest
  // resolves the minting member's scope through the same resolver, so a
  // locked workspace stores nothing and the place is given back. `open`
  // reads only the link's own document and the site's name.
  const result = await ingestMedia({
    hostId: link.doc.hostId,
    uid: link.doc.createdBy,
    fileName,
    contentType: stored.contentType,
    bytes: new Uint8Array(stored.bytes),
    folderId: link.doc.folderId,
    ownerPhotoLinkId: link.linkId,
  })
  if (result.ok === false) {
    await releasePhotoLinkUpload(firestore, link.ref, stored.bytes.length).catch(() => undefined)
    // The member's own refusal, worded for the phone: the site is full,
    // locked, or no longer theirs. Never the reason itself.
    return answer({ ok: false, reason: 'refused', error: 'This site is not taking photos right now' }, result.status)
  }
  const after = await link.ref.get()
  const summary = photoLinkSummary(link.linkId, { ...link.doc, ...(after.data() as Partial<typeof link.doc>) })
  return answer({ ok: true, mediaId: result.mediaId, link: summary }, 200)
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { body } = await pluginRequestFromWeb(request)
    const fields = (body ?? {}) as Record<string, unknown>
    if (fields['action'] === 'open') return await open(request, fields['token'])
    if (fields['action'] === 'store') return await store(request, fields)
    return answer({ ok: false, reason: 'action' }, 400)
  } catch (error) {
    console.error(error)
    return answer({ ok: false, reason: 'failed' }, 500)
  }
}

export const dynamic = 'force-dynamic'
