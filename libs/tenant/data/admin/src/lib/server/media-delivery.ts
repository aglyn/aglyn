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

import { Readable } from 'node:stream'
import {
  type MediaVideoRendition,
  mediaRenditionObjectPath,
  parseMediaRenditions,
} from '@aglyn/aglyn/app-utils/media-ref'
import type { ReleaseFlagKey } from '@aglyn/aglyn/app-utils/release-flags'
import {
  type MediaDeliveryClaims,
  type MediaDeliveryProvider,
  mediaDeliveryProvider,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { firebaseAdmin } from './firebase-admin'
import { MEDIA_SIGNATURE_MAX_TTL_MS } from './media-signing'
import { mediaStoragePathInScope } from './media-storage-path'
import { isServerReleaseFlagOnForOrg } from './release-flags'

/**
 * Video delivered from the configured delivery provider (AGL-2824): the
 * platform's half.
 *
 * `serveMediaCdn` keeps every access decision it has always made. When a
 * video request passes all of them, and this module finds a current copy of
 * the requested representation at the delivery provider, the CDN answers
 * with a `302` to a short-lived signed URL on the provider's host instead of
 * streaming the bytes itself. The commerce stream mints the same URL for a
 * buyer. Everything else — images, posters, downloads, and every video with
 * no current copy — serves exactly as it did.
 *
 * ## Three switches, all of which must be on
 *
 * 1. **A provider.** A plugin registers one against core's contract
 *    (`media-delivery-provider`), and it must be configured for the
 *    capability in question: `store` to copy or remove, `deliver` to mint.
 *    With none, every function here returns before any I/O.
 * 2. **The release flag**, per org: {@link MEDIA_DELIVERY_RELEASE_FLAG}. It
 *    gates the COPY as well as the redirect, because a copy is customer data
 *    at the provider. Removal is never gated: a copy made while the flag was
 *    on must still go when its asset does.
 * 3. **A current copy**, recorded on the media document under
 *    {@link MEDIA_DELIVERY_COPIES_FIELD}. A copy is current when it was made
 *    from the asset's present `contentHash` and its key is the one this
 *    module derives for the asset. A replace changes the hash, so every copy
 *    of the previous bytes stops being served in the same write, before
 *    anything at the provider is removed.
 *
 * ## The platform stays the system of record
 *
 * The bucket keeps every byte it kept before, and the storage counter moves
 * exactly as it did: a copy's size is recorded on the copy and never added to
 * `counters/media`, so storage is billed once. Making the provider's copy the
 * only one is a later step, and the storage cost model depends on it (see
 * AGL-2825); nothing here deletes a platform object.
 *
 * ## Keys carry the content hash
 *
 * `{hosts|orgs}/{scopeId}/{mediaId}/{sourceHash}/{representation}/{objectHash}`.
 * The source hash is the asset's `contentHash`; the object hash is the
 * copied object's own digest (for the master the two are the same). A
 * replaced file or a re-encoded rendition therefore gets a new key, so a URL
 * minted for old bytes can never be answered with new ones, and the whole
 * asset is one prefix for removal. The record is written by the server only,
 * but the key it holds is checked against the derivation before it is used:
 * a record copied onto another document names a key that is not that
 * document's own, and is ignored.
 */

/** The per-org release flag both halves — copy and redirect — ask. */
export const MEDIA_DELIVERY_RELEASE_FLAG: ReleaseFlagKey = 'release_video_delivery'

/** The media document field that records the copies at the provider. */
export const MEDIA_DELIVERY_COPIES_FIELD = 'deliveryCopies'

/** The representation name of the uploaded file itself. */
export const MEDIA_DELIVERY_MASTER = 'master'

/**
 * The shortest delivery URL lifetime. A delivery URL is a bearer capability,
 * so it is short, but a player sends its range requests to the URL it was
 * redirected to, so it must outlive a sitting: seeking, pausing and resuming
 * all reuse it.
 */
export const MEDIA_DELIVERY_MIN_TTL_MS = 15 * 60 * 1000

/** The lifetime when the film's duration is unknown. */
export const MEDIA_DELIVERY_DEFAULT_TTL_MS = 60 * 60 * 1000

/** The longest lifetime, shared with every other signed media link. */
export const MEDIA_DELIVERY_MAX_TTL_MS = MEDIA_SIGNATURE_MAX_TTL_MS

/**
 * How long a delivery URL for a film of `durationMs` lives: twice the film,
 * so a viewer who pauses halfway still finishes it, between
 * {@link MEDIA_DELIVERY_MIN_TTL_MS} and {@link MEDIA_DELIVERY_MAX_TTL_MS}.
 */
export function mediaDeliveryTtlMs(durationMs: unknown): number {
  const duration = Number(durationMs)
  if (!Number.isFinite(duration) || duration <= 0) {
    return MEDIA_DELIVERY_DEFAULT_TTL_MS
  }
  return Math.min(
    MEDIA_DELIVERY_MAX_TTL_MS,
    Math.max(MEDIA_DELIVERY_MIN_TTL_MS, Math.round(duration * 2)),
  )
}

/** The asset a copy belongs to. */
export interface MediaDeliveryAsset {
  collection: 'hosts' | 'orgs'
  scopeId: string
  mediaId: string
}

/** An id segment, as the CDN route accepts one. */
const ID_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/
/** A content digest: `contentHash` is 16 hex, a full digest up to 64. */
const DIGEST = /^[a-f0-9]{16,64}$/
/** `master`, or `r-` and a rendition key. */
const REPRESENTATION = /^(?:master|r-[a-z0-9][a-z0-9-]{0,23})$/

/** The representation a rendition (or the master, for none) is copied as. */
export function mediaDeliveryRepresentation(
  rendition: Pick<MediaVideoRendition, 'key'> | null | undefined,
): string {
  return rendition ? `r-${rendition.key}` : MEDIA_DELIVERY_MASTER
}

function validAsset(asset: MediaDeliveryAsset): boolean {
  return (
    (asset.collection === 'hosts' || asset.collection === 'orgs') &&
    ID_SEGMENT.test(asset.scopeId) &&
    ID_SEGMENT.test(asset.mediaId)
  )
}

/**
 * The prefix every copy of one asset lives under, or null for an asset whose
 * identity does not fit the grammar. Ends in `/`, so one asset's prefix is
 * never another's.
 */
export function mediaDeliveryAssetPrefix(asset: MediaDeliveryAsset): string | null {
  if (!validAsset(asset)) return null
  return `${asset.collection}/${asset.scopeId}/${asset.mediaId}/`
}

/** The prefix every copy of one library lives under, for an erasure. */
export function mediaDeliveryScopePrefix(
  collection: 'hosts' | 'orgs',
  scopeId: string,
): string | null {
  if (collection !== 'hosts' && collection !== 'orgs') return null
  if (!ID_SEGMENT.test(scopeId)) return null
  return `${collection}/${scopeId}/`
}

/** The object key of one copy, or null when a part does not fit the grammar. */
export function mediaDeliveryObjectKey(
  asset: MediaDeliveryAsset,
  copy: { sourceHash: string; representation: string; objectHash: string },
): string | null {
  const prefix = mediaDeliveryAssetPrefix(asset)
  if (!prefix) return null
  if (!DIGEST.test(copy.sourceHash) || !DIGEST.test(copy.objectHash)) return null
  if (!REPRESENTATION.test(copy.representation)) return null
  return `${prefix}${copy.sourceHash}/${copy.representation}/${copy.objectHash}`
}

/** One copy at the provider, as the media document records it. */
export interface MediaDeliveryCopy {
  key: string
  /** The asset's `contentHash` when the copy was made. */
  sourceHash: string
  /** The copied object's own digest. */
  objectHash: string
  contentType: string
  sizeBytes: number
  copiedAtMs: number
}

/** The recorded copies of one asset, by representation. */
export type MediaDeliveryCopies = Record<string, MediaDeliveryCopy>

/**
 * The copies a media document records that belong to THIS asset: each entry
 * well formed, and its key exactly the one {@link mediaDeliveryObjectKey}
 * derives from its own fields. Anything else is dropped rather than trusted.
 */
export function parseMediaDeliveryCopies(
  raw: unknown,
  asset: MediaDeliveryAsset,
): MediaDeliveryCopies {
  const copies: MediaDeliveryCopies = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return copies
  for (const [representation, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const sourceHash = String(entry['sourceHash'] ?? '')
    const objectHash = String(entry['objectHash'] ?? '')
    const key = mediaDeliveryObjectKey(asset, { sourceHash, representation, objectHash })
    if (!key || entry['key'] !== key) continue
    const contentType = String(entry['contentType'] ?? '')
    if (!/^video\/[\w.+-]{1,64}$/.test(contentType)) continue
    const sizeBytes = Number(entry['sizeBytes'])
    copies[representation] = {
      key,
      sourceHash,
      objectHash,
      contentType,
      sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.round(sizeBytes) : 0,
      copiedAtMs: Number(entry['copiedAtMs']) || 0,
    }
  }
  return copies
}

/** Whether a served type is one this module delivers: video, nothing else. */
export function isMediaDeliveryType(contentType: unknown): boolean {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
    .startsWith('video/')
}

function currentContentHash(document: { get(field: string): unknown }): string | null {
  const hash = document.get('contentHash')
  return typeof hash === 'string' && DIGEST.test(hash) ? hash : null
}

/*===========================================================================
 * The owning org, for the flag.
 *==========================================================================*/

const ORG_CACHE_TTL_MS = 60_000
const hostOrgCache = new Map<string, { at: number; orgId: string | null }>()

/** Drops the host → org cache. Tests need it between cases. */
export function invalidateMediaDeliveryOrgCache(): void {
  hostOrgCache.clear()
}

/**
 * The org that owns a library: the id itself for an org library, and the
 * host's `hostIndex` entry for a site's. Cached for a minute, like the
 * release-flag reads it feeds; a failed read answers null, which the flag
 * treats as "no org" and so refuses anything short of a full release.
 */
export async function mediaDeliveryOrgIdFor(
  collection: 'hosts' | 'orgs',
  scopeId: string,
): Promise<string | null> {
  if (collection === 'orgs') return scopeId || null
  const hit = hostOrgCache.get(scopeId)
  if (hit && Date.now() - hit.at < ORG_CACHE_TTL_MS) return hit.orgId
  const orgId = await (async (): Promise<string | null> => {
    try {
      const firestore = firebaseAdmin.app().firestore()
      const [index] = await firestore.getAll(
        firestore.collection('hostIndex').doc(scopeId),
        { fieldMask: ['orgId'] },
      )
      const value = index?.get('orgId')
      return typeof value === 'string' && value ? value : null
    } catch {
      return null
    }
  })()
  hostOrgCache.set(scopeId, { at: Date.now(), orgId })
  return orgId
}

/** The flag verdict for one org. */
export function mediaDeliveryEnabledForOrg(orgId: string | null): Promise<boolean> {
  return isServerReleaseFlagOnForOrg(MEDIA_DELIVERY_RELEASE_FLAG, orgId)
}

/*===========================================================================
 * The redirect.
 *==========================================================================*/

export interface MediaDeliveryRedirect {
  location: string
  expiresAtMs: number
  key: string
}

/**
 * The delivery URL for one representation of one asset, or null when the
 * request must be served the way it always was.
 *
 * Called only after the caller has made every access decision. Null for: a
 * type that is not video; an asset with no current copy of this
 * representation; the flag off for the owning org; a lifetime that has
 * already run out; and a provider that fails to mint. The cheap answers come
 * first, so an asset with no copy costs no read at all.
 */
export async function mediaDeliveryRedirect(input: {
  provider: MediaDeliveryProvider
  asset: MediaDeliveryAsset
  document: { get(field: string): unknown }
  /** The rendition being served, or none for the master. */
  rendition?: Pick<MediaVideoRendition, 'key'> | null
  servedType: unknown
  claims: Omit<MediaDeliveryClaims, 'orgId'>
  /** The owning org, asked only once a current copy is found. */
  orgId: () => Promise<string | null>
  /** Defaults to the release flag. */
  deliveryEnabled?: (orgId: string | null) => Promise<boolean>
  /** The URL may not outlive this, e.g. the signature the request carried. */
  notAfterMs?: number
  /** A fixed lifetime; otherwise {@link mediaDeliveryTtlMs} of the film. */
  ttlMs?: number
  nowMs?: number
}): Promise<MediaDeliveryRedirect | null> {
  if (!isMediaDeliveryType(input.servedType)) return null
  const sourceHash = currentContentHash(input.document)
  if (!sourceHash) return null
  const copies = parseMediaDeliveryCopies(
    input.document.get(MEDIA_DELIVERY_COPIES_FIELD),
    input.asset,
  )
  const copy = copies[mediaDeliveryRepresentation(input.rendition)]
  if (!copy || copy.sourceHash !== sourceHash) return null

  const orgId = await input.orgId()
  const enabled = await (input.deliveryEnabled ?? mediaDeliveryEnabledForOrg)(orgId)
  if (!enabled) return null

  const nowMs = input.nowMs ?? Date.now()
  const video = input.document.get('video') as { durationMs?: unknown } | undefined
  const lifetime = Math.min(
    MEDIA_DELIVERY_MAX_TTL_MS,
    input.ttlMs ?? mediaDeliveryTtlMs(video?.durationMs),
  )
  let expiresAtMs = nowMs + lifetime
  if (input.notAfterMs !== undefined) {
    // A bound that cannot be read is no bound, and a URL with none could
    // outlive what the caller was entitled to; serve from the platform.
    if (!Number.isFinite(input.notAfterMs)) return null
    expiresAtMs = Math.min(expiresAtMs, input.notAfterMs)
  }
  if (!(expiresAtMs > nowMs)) return null
  try {
    const location = await input.provider.deliveryUrl({
      key: copy.key,
      expiresAtMs,
      claims: { ...input.claims, orgId },
    })
    return { location, expiresAtMs, key: copy.key }
  } catch (error) {
    console.error(
      '[media-delivery] could not mint a delivery URL',
      JSON.stringify({ key: copy.key }),
      error,
    )
    return null
  }
}

/*===========================================================================
 * Copies.
 *==========================================================================*/

/** The slice of a Storage file the copy reads. */
export interface MediaDeliverySourceFile {
  getMetadata(): Promise<unknown>
  createReadStream(): NodeJS.ReadableStream
}

/** The slice of a Storage bucket the copy reads. */
export interface MediaDeliverySourceBucket {
  file(path: string): MediaDeliverySourceFile
}

export type MediaDeliverySyncStatus =
  | 'no-provider'
  | 'no-asset'
  | 'not-video'
  | 'no-hash'
  | 'disabled'
  | 'replaced'
  | 'synced'

export interface MediaDeliverySyncResult {
  status: MediaDeliverySyncStatus
  /** Representations copied by this call. */
  copied: string[]
  /** Representations whose current copy was already there. */
  kept: string[]
  /** Keys removed from the provider because nothing current names them. */
  removed: string[]
  /** Representations whose copy failed; they keep serving from the platform. */
  failed: string[]
}

/** The md5 Storage records for an object, as hex. */
function md5Hex(metadata: Record<string, unknown>): string | null {
  const raw = metadata['md5Hash']
  if (typeof raw !== 'string' || !raw) return null
  const hex = Buffer.from(raw, 'base64').toString('hex')
  return DIGEST.test(hex) ? hex : null
}

/** One `getMetadata()` answer, unwrapped from the SDK's tuple. */
async function readMetadata(file: MediaDeliverySourceFile): Promise<Record<string, unknown>> {
  const response = await file.getMetadata()
  const metadata = Array.isArray(response) ? response[0] : response
  return (metadata ?? {}) as Record<string, unknown>
}

/**
 * Brings the provider's copies of one video in line with its document: every
 * representation the document serves — the master and each recorded
 * rendition — gets a copy made from its current bytes, and a copy nothing
 * current names is removed.
 *
 * Every copy path runs through here: an upload's finalize, a replace, a
 * restore and the rendition producer. It is safe to run again at any time.
 * The master's copy is current when it was made from the asset's
 * `contentHash`; a rendition's when it was made from that hash AND from the
 * rendition object Storage holds now, since the producer can encode a key
 * again without the master changing.
 *
 * The record is written in a transaction that re-reads the document, and
 * only while the asset still has the content hash the copies were made from.
 * An asset replaced or deleted while its copies were uploading keeps that
 * state, and the copies just made are removed rather than recorded against
 * bytes they are not.
 */
export async function syncMediaDeliveryCopies(options: {
  docRef: FirebaseFirestore.DocumentReference
  asset: MediaDeliveryAsset
  bucket: MediaDeliverySourceBucket
  /** The owning org, when the caller has it; otherwise resolved. */
  orgId?: string | null
  /** Defaults to the registered provider configured to store. */
  provider?: MediaDeliveryProvider | null
  /** Defaults to the release flag. */
  deliveryEnabled?: (orgId: string | null) => Promise<boolean>
  nowMs?: () => number
}): Promise<MediaDeliverySyncResult> {
  const result: MediaDeliverySyncResult = {
    status: 'synced',
    copied: [],
    kept: [],
    removed: [],
    failed: [],
  }
  const done = (status: MediaDeliverySyncStatus): MediaDeliverySyncResult => ({
    ...result,
    status,
  })
  const provider =
    options.provider === undefined ? mediaDeliveryProvider('store') : options.provider
  if (!provider) return done('no-provider')
  const { asset, bucket, docRef } = options
  if (!mediaDeliveryAssetPrefix(asset)) return done('no-asset')

  const snapshot = await docRef.get()
  if (!snapshot.exists || snapshot.get('deletedAt')) return done('no-asset')
  if (!isMediaDeliveryType(snapshot.get('contentType'))) return done('not-video')
  const sourceHash = currentContentHash(snapshot)
  if (!sourceHash) return done('no-hash')

  const orgId =
    options.orgId === undefined
      ? await mediaDeliveryOrgIdFor(asset.collection, asset.scopeId)
      : options.orgId
  const enabled = await (options.deliveryEnabled ?? mediaDeliveryEnabledForOrg)(orgId)
  if (!enabled) return done('disabled')

  const now = options.nowMs ?? Date.now
  const basePath = mediaStoragePathInScope({
    storagePath: snapshot.get('storagePath'),
    base: `${asset.collection}/${asset.scopeId}`,
    mediaId: asset.mediaId,
  })
  const wanted: Array<{ objectPath: string; rendition: MediaVideoRendition | null }> = [
    { objectPath: basePath, rendition: null },
    ...parseMediaRenditions(snapshot.get('videoRenditions')).map((rendition) => ({
      objectPath: mediaRenditionObjectPath(basePath, rendition),
      rendition,
    })),
  ]

  const recorded = parseMediaDeliveryCopies(snapshot.get(MEDIA_DELIVERY_COPIES_FIELD), asset)
  const next: MediaDeliveryCopies = {}
  for (const { objectPath, rendition } of wanted) {
    const representation = mediaDeliveryRepresentation(rendition)
    const existing = recorded[representation]
    try {
      const file = bucket.file(objectPath)
      // The master's digest is on the document already, so a current copy of
      // it costs no Storage read. A rendition's is read every time.
      if (!rendition && existing?.sourceHash === sourceHash) {
        next[representation] = existing
        result.kept.push(representation)
        continue
      }
      const metadata = await readMetadata(file)
      const objectHash = rendition ? md5Hex(metadata) : sourceHash
      if (!objectHash) throw new Error('the object reports no digest')
      if (
        existing &&
        existing.sourceHash === sourceHash &&
        existing.objectHash === objectHash
      ) {
        next[representation] = existing
        result.kept.push(representation)
        continue
      }
      const sizeBytes = Number(metadata['size'])
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw new Error('the object reports no size')
      }
      const contentType = rendition
        ? rendition.contentType
        : String(metadata['contentType'] ?? snapshot.get('contentType') ?? '')
      if (!isMediaDeliveryType(contentType)) throw new Error('the object is not a video')
      const key = mediaDeliveryObjectKey(asset, { sourceHash, representation, objectHash })
      if (!key) throw new Error('no key fits the asset')
      await provider.putObject({
        key,
        body: Readable.toWeb(file.createReadStream() as Readable) as ReadableStream<Uint8Array>,
        contentLength: sizeBytes,
        contentType,
      })
      next[representation] = {
        key,
        sourceHash,
        objectHash,
        contentType,
        sizeBytes,
        copiedAtMs: now(),
      }
      result.copied.push(representation)
    } catch (error) {
      result.failed.push(representation)
      console.error(
        '[media-delivery] copy failed; it keeps serving from the platform',
        JSON.stringify({ ...asset, representation }),
        error,
      )
    }
  }

  const nextKeys = new Set(Object.values(next).map((copy) => copy.key))
  const retired = Object.values(recorded)
    .map((copy) => copy.key)
    .filter((key) => !nextKeys.has(key))
  const madeNow = result.copied
    .map((representation) => next[representation]?.key)
    .filter((key): key is string => Boolean(key))

  if (result.copied.length || retired.length) {
    const written = await docRef.firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(docRef)
      if (!fresh.exists || fresh.get('deletedAt')) return false
      if (currentContentHash(fresh) !== sourceHash) return false
      transaction.update(docRef, { [MEDIA_DELIVERY_COPIES_FIELD]: next })
      return true
    })
    if (!written) {
      // Replaced or deleted while the copies were uploading. Nothing records
      // what was just made, so it goes rather than lingering unreferenced.
      await removeKeys(provider, madeNow, result)
      return done('replaced')
    }
  }
  await removeKeys(provider, retired, result)
  return done('synced')
}

async function removeKeys(
  provider: MediaDeliveryProvider,
  keys: string[],
  result: Pick<MediaDeliverySyncResult, 'removed'>,
): Promise<void> {
  for (const key of keys) {
    try {
      await provider.deleteObject(key)
      result.removed.push(key)
    } catch (error) {
      console.error('[media-delivery] could not remove a retired copy', JSON.stringify({ key }), error)
    }
  }
}

/**
 * Removes every copy of one asset from the provider: a delete, a takedown and
 * a replace all end the life of the bytes the copies were made from.
 *
 * By prefix rather than by the document's record, so a copy the record lost
 * track of goes too. Never gated on the flag, since copies made while it was
 * on must still go, and never throws: the caller's own action has already
 * happened and must not be reported as failed because a copy lingered. Null
 * when no provider is configured to store.
 */
export async function removeMediaDeliveryCopies(options: {
  asset: MediaDeliveryAsset
  provider?: MediaDeliveryProvider | null
}): Promise<{ removed: number; failed: boolean } | null> {
  const provider =
    options.provider === undefined ? mediaDeliveryProvider('store') : options.provider
  if (!provider) return null
  const prefix = mediaDeliveryAssetPrefix(options.asset)
  if (!prefix) return { removed: 0, failed: false }
  try {
    return { removed: await provider.deleteObjectsWithPrefix(prefix), failed: false }
  } catch (error) {
    console.error(
      '[media-delivery] could not remove an asset\'s copies',
      JSON.stringify(options.asset),
      error,
    )
    return { removed: 0, failed: true }
  }
}

/**
 * Removes every copy a library holds at the provider — the erasure of a site
 * or an org. Same posture as {@link removeMediaDeliveryCopies}.
 */
export async function eraseMediaDeliveryScope(options: {
  collection: 'hosts' | 'orgs'
  scopeId: string
  provider?: MediaDeliveryProvider | null
}): Promise<{ removed: number; failed: boolean } | null> {
  const provider =
    options.provider === undefined ? mediaDeliveryProvider('store') : options.provider
  if (!provider) return null
  const prefix = mediaDeliveryScopePrefix(options.collection, options.scopeId)
  if (!prefix) return { removed: 0, failed: false }
  try {
    return { removed: await provider.deleteObjectsWithPrefix(prefix), failed: false }
  } catch (error) {
    console.error(
      '[media-delivery] could not erase a library\'s copies',
      JSON.stringify({ collection: options.collection, scopeId: options.scopeId }),
      error,
    )
    return { removed: 0, failed: true }
  }
}

/**
 * A media document without its copy record, for a restore: the delete that
 * made the tombstone removed the copies, so the record describes objects
 * that are gone.
 */
export function withoutMediaDeliveryCopies(
  media: Record<string, unknown>,
): Record<string, unknown> {
  if (!(MEDIA_DELIVERY_COPIES_FIELD in media)) return media
  const rest = { ...media }
  delete rest[MEDIA_DELIVERY_COPIES_FIELD]
  return rest
}
