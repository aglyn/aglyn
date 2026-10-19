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
import { encodeMediaDisplay, type loadSharp } from './media-variants'

/** The sharp factory `loadSharp` answers. */
type SharpFactory = Awaited<ReturnType<typeof loadSharp>>

/**
 * A SITE'S PHOTO LINK (AGL-3957): an address a site member hands to someone
 * with photos on their phone — the owner of the business the site is being
 * built for, at a booth or on a doorstep — so the photos land in the site's
 * media library without a sign-in.
 *
 * The link is `{origin}/p/{linkId}#{secret}`, and the page composes the
 * token `{linkId}.{secret}` from its path and its fragment. The secret rides
 * in the FRAGMENT because a fragment never leaves the browser: no request
 * line carries it, so no server or edge log, no analytics page view and no
 * `Referer` header ever holds a working link. The page sends the token to
 * the public route in a POST body. The database holds the SHA-256
 * of the secret and never the secret, the same shape as an emailed
 * confirmation link (`account-emails.ts`): a reader of the database cannot
 * upload to anybody's site. A link lives seven days, takes a bounded number
 * of photos and bytes, and can be revoked by any member who could have
 * minted it. Every upload it takes is stored AS THE MEMBER WHO MINTED IT,
 * through the media ingest's own door (`core.media-ingest`), so a member who
 * lost the site, a locked site, a takedown and the storage band refuse the
 * link's uploads exactly as they refuse that member's.
 *
 * Documents live in the top-level `photoLinks` collection, keyed by link id
 * and carrying the site: a token alone names no site, and a top-level
 * collection answers it in one read with no collection-group index. Only the
 * Admin SDK reads or writes them.
 */

export const PHOTO_LINKS_COLLECTION = 'photoLinks'

/** Where the console serves the page a link opens. */
export const PHOTO_LINK_PATH = '/p'

/** How long a link takes photos, from its minting. */
export const PHOTO_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The most photos one link takes. */
export const PHOTO_LINK_MAX_UPLOADS = 40

/** The most bytes one link takes, over all its photos, after they are stored. */
export const PHOTO_LINK_MAX_BYTES = 200 * 1024 * 1024

/** The folder the link's photos are filed in, created in the site's library when the first link is minted. */
export const PHOTO_LINK_FOLDER_NAME = 'From the owner'

/**
 * What the page accepts from the phone. The page re-encodes what it picks
 * (a HEIC, a 12 MB camera original) into one of these before it sends it, so
 * a format a browser cannot draw never reaches the server.
 */
export const PHOTO_LINK_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** The most bytes one photo may arrive as, before it is stored. */
export const PHOTO_LINK_PHOTO_MAX_BYTES = 8 * 1024 * 1024

/** What one phone may ask of the link's page in a window, and how long the window is. */
export const PHOTO_LINK_RATE_LIMIT = Object.freeze({ limit: 80, windowMs: 10 * 60 * 1000 })

export interface PhotoLinkDoc {
  hostId: string
  /** The member the link's uploads are stored as. */
  createdBy: string
  createdAt: number
  expiresAt: number
  revokedAt?: number
  revokedBy?: string
  /** SHA-256 of the secret half of the token, hex. */
  digest: string
  /** The library folder the photos are filed in; null files them at the root. */
  folderId: string | null
  /** Photos stored through the link, and their stored bytes. */
  uploads: number
  bytes: number
  lastUploadAt?: number
}

export type PhotoLinkState = 'live' | 'expired' | 'revoked' | 'full'

/** What a link's page and its minter see of it. */
export interface PhotoLinkSummary {
  linkId: string
  state: PhotoLinkState
  createdAt: number
  expiresAt: number
  uploads: number
  bytes: number
  remainingUploads: number
  remainingBytes: number
}

/** A fresh token: the id the document is keyed by, the secret the link carries, and the digest the document keeps. */
export function mintPhotoLinkToken(): { linkId: string; secret: string; digest: string; token: string } {
  const linkId = randomBytes(12).toString('hex')
  const secret = randomBytes(24).toString('hex')
  return { linkId, secret, digest: photoLinkDigest(secret), token: `${linkId}.${secret}` }
}

export function photoLinkDigest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** The two halves of a token as the page received it, or null for anything that is not shaped like one. */
export function parsePhotoLinkToken(raw: unknown): { linkId: string; secret: string } | null {
  const token = String(raw ?? '').trim()
  const separator = token.indexOf('.')
  if (separator <= 0) return null
  const linkId = token.slice(0, separator)
  const secret = token.slice(separator + 1)
  if (!/^[a-f0-9]{24}$/.test(linkId) || !/^[a-f0-9]{48}$/.test(secret)) return null
  return { linkId, secret }
}

/** Constant-time: the stored digest against the secret the page presented. */
export function photoLinkSecretMatches(digest: unknown, secret: string): boolean {
  const expected = photoLinkDigest(secret)
  if (typeof digest !== 'string' || digest.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(expected, 'hex'))
}

/**
 * The address the link opens, on the console origin given: the link id in
 * the path, the secret in the fragment, which the browser never sends.
 */
export function photoLinkUrl(origin: string, linkId: string, secret: string): string {
  return `${origin.replace(/\/+$/, '')}${PHOTO_LINK_PATH}/${encodeURIComponent(linkId)}#${encodeURIComponent(secret)}`
}

export function photoLinkState(doc: Pick<PhotoLinkDoc, 'expiresAt' | 'revokedAt' | 'uploads' | 'bytes'>, now = Date.now()): PhotoLinkState {
  if (doc.revokedAt) return 'revoked'
  if (now >= doc.expiresAt) return 'expired'
  if (doc.uploads >= PHOTO_LINK_MAX_UPLOADS || doc.bytes >= PHOTO_LINK_MAX_BYTES) return 'full'
  return 'live'
}

export function photoLinkSummary(linkId: string, doc: PhotoLinkDoc, now = Date.now()): PhotoLinkSummary {
  return {
    linkId,
    state: photoLinkState(doc, now),
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    uploads: doc.uploads,
    bytes: doc.bytes,
    remainingUploads: Math.max(0, PHOTO_LINK_MAX_UPLOADS - doc.uploads),
    remainingBytes: Math.max(0, PHOTO_LINK_MAX_BYTES - doc.bytes),
  }
}

/** The stored document, read defensively: a field the writer never set reads as its zero. */
export function readPhotoLinkDoc(data: Record<string, unknown> | undefined): PhotoLinkDoc | null {
  if (!data || typeof data['hostId'] !== 'string' || typeof data['digest'] !== 'string') return null
  const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    hostId: data['hostId'],
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
    createdAt: number(data['createdAt']),
    expiresAt: number(data['expiresAt']),
    ...(number(data['revokedAt']) ? { revokedAt: number(data['revokedAt']) } : {}),
    ...(typeof data['revokedBy'] === 'string' ? { revokedBy: data['revokedBy'] } : {}),
    digest: data['digest'],
    folderId: typeof data['folderId'] === 'string' && data['folderId'] ? data['folderId'] : null,
    uploads: number(data['uploads']),
    bytes: number(data['bytes']),
    ...(number(data['lastUploadAt']) ? { lastUploadAt: number(data['lastUploadAt']) } : {}),
  }
}

type Firestore = FirebaseFirestore.Firestore

export function photoLinkRef(firestore: Firestore, linkId: string): FirebaseFirestore.DocumentReference {
  return firestore.collection(PHOTO_LINKS_COLLECTION).doc(linkId)
}

/** Mints a link for the site as the member, and stores its document. The secret is returned once and never stored. */
export async function createPhotoLink(
  firestore: Firestore,
  input: { hostId: string; uid: string; folderId: string | null; now?: number },
): Promise<{ linkId: string; secret: string; token: string; expiresAt: number }> {
  const now = input.now ?? Date.now()
  const minted = mintPhotoLinkToken()
  const doc: PhotoLinkDoc = {
    hostId: input.hostId,
    createdBy: input.uid,
    createdAt: now,
    expiresAt: now + PHOTO_LINK_TTL_MS,
    digest: minted.digest,
    folderId: input.folderId,
    uploads: 0,
    bytes: 0,
  }
  await photoLinkRef(firestore, minted.linkId).create(doc)
  return { linkId: minted.linkId, secret: minted.secret, token: minted.token, expiresAt: doc.expiresAt }
}

export type PhotoLinkRefusal = 'invalid' | 'expired' | 'revoked' | 'full'

export type PhotoLinkLookup =
  | { ok: true; linkId: string; ref: FirebaseFirestore.DocumentReference; doc: PhotoLinkDoc; summary: PhotoLinkSummary }
  | { ok: false; reason: PhotoLinkRefusal }

/**
 * The link a token names, when the token is well-formed, its document exists,
 * its secret matches and the link still takes photos. Every other case is a
 * refusal that says only what the page needs to tell the person holding the
 * phone; an unknown id and a wrong secret read the same.
 */
export async function readPhotoLinkByToken(firestore: Firestore, token: unknown, now = Date.now()): Promise<PhotoLinkLookup> {
  const parsed = parsePhotoLinkToken(token)
  if (!parsed) return { ok: false, reason: 'invalid' }
  const ref = photoLinkRef(firestore, parsed.linkId)
  const snapshot = await ref.get()
  const doc = readPhotoLinkDoc(snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined)
  if (!doc || !photoLinkSecretMatches(doc.digest, parsed.secret)) return { ok: false, reason: 'invalid' }
  const state = photoLinkState(doc, now)
  if (state !== 'live') return { ok: false, reason: state }
  return { ok: true, linkId: parsed.linkId, ref, doc, summary: photoLinkSummary(parsed.linkId, doc, now) }
}

/**
 * Claims one photo's place on the link before its bytes are stored, inside a
 * transaction, so forty phones racing one link cannot store eighty photos.
 * `releasePhotoLinkUpload` gives the place back when the store refused.
 */
export async function claimPhotoLinkUpload(
  firestore: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  bytes: number,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: PhotoLinkRefusal }> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const doc = readPhotoLinkDoc(snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined)
    if (!doc) return { ok: false, reason: 'invalid' as const }
    const state = photoLinkState(doc, now)
    if (state !== 'live') return { ok: false, reason: state }
    if (doc.bytes + bytes > PHOTO_LINK_MAX_BYTES) return { ok: false, reason: 'full' as const }
    transaction.update(ref, { uploads: doc.uploads + 1, bytes: doc.bytes + bytes, lastUploadAt: now })
    return { ok: true as const }
  })
}

export async function releasePhotoLinkUpload(
  firestore: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  bytes: number,
): Promise<void> {
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const doc = readPhotoLinkDoc(snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined)
    if (!doc) return
    transaction.update(ref, { uploads: Math.max(0, doc.uploads - 1), bytes: Math.max(0, doc.bytes - bytes) })
  })
}

/** Marks the link revoked. Idempotent; a link of another site is left alone and reported as not found. */
export async function revokePhotoLink(
  firestore: Firestore,
  input: { hostId: string; linkId: string; uid: string; now?: number },
): Promise<boolean> {
  const ref = photoLinkRef(firestore, input.linkId)
  const snapshot = await ref.get()
  const doc = readPhotoLinkDoc(snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined)
  if (!doc || doc.hostId !== input.hostId) return false
  if (doc.revokedAt) return true
  await ref.update({ revokedAt: input.now ?? Date.now(), revokedBy: input.uid })
  return true
}

/** The site's links that still take photos, newest first. */
export async function listLivePhotoLinks(firestore: Firestore, hostId: string, now = Date.now()): Promise<PhotoLinkSummary[]> {
  const snapshot = await firestore
    .collection(PHOTO_LINKS_COLLECTION)
    .where('hostId', '==', hostId)
    .where('expiresAt', '>', now)
    .limit(50)
    .get()
  const live: PhotoLinkSummary[] = []
  for (const document of snapshot.docs) {
    const doc = readPhotoLinkDoc(document.data() as Record<string, unknown>)
    if (!doc) continue
    const summary = photoLinkSummary(document.id, doc, now)
    if (summary.state === 'live') live.push(summary)
  }
  return live.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * The bytes a link's photo is stored as: oriented the way the phone held it,
 * no wider than the delivery edge, and carrying no EXIF, XMP or IPTC — so a
 * photo's GPS position, taken in somebody's driveway, never reaches the
 * library. The display encoder already does exactly this for a delivery
 * copy; here its answer IS the original. A photo that carries nothing and
 * needs no turning is stored as it came.
 */
export async function storedPhotoLinkBytes(
  sharp: SharpFactory,
  bytes: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const display = await encodeMediaDisplay(sharp, bytes, contentType)
  return display ? { bytes: display.bytes, contentType: display.copy.contentType } : { bytes, contentType }
}

/**
 * The address a request to the link's page is counted under: the first
 * forwarded address, which is the client's at Vercel's edge, else the
 * literal `unknown`, which shares one budget rather than none.
 */
export function photoLinkCallerAddress(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0]?.trim()
  return first || headers.get('x-real-ip')?.trim() || 'unknown'
}
