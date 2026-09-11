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

import {
  hostQualifiedScope,
  MEDIA_CDN_ROUTE,
  paidMediaAssetOfObject,
  parsePaidMediaSource,
} from '@aglyn/aglyn/server'
import {
  assertMediaSignatureTtl,
  mediaSignatureQuery,
  mintMediaSignature,
} from './media-signing'
import { isMediaStoragePathInScope } from './media-storage-path'
import { mediaCdnScopeRefusal, parseMediaCdnScope } from './serve-media-cdn'

/**
 * Turning a URL stored on a product into a link a buyer may follow (AGL-2814).
 *
 * A product's paid media — its members videos — is stored as whatever the
 * author's picker wrote: a media reference, a CDN path, a raw Storage download
 * URL, or a hotlink somebody typed. `parsePaidMediaSource` says which of those
 * a value is. The commerce routes verify who is entitled and then redirect;
 * this module decides WHERE they may redirect, and its whole job is that the
 * answer is never a URL that outlives the purchase.
 *
 * ## The rules, in the order they are applied
 *
 * 1. **A library asset is delivered only when it is PRIVATE**, as a CDN URL
 *    signed with {@link mintMediaSignature}. The CDN refuses a private asset on
 *    every path without an unexpired signature, which is what makes the link
 *    die. A public asset is refused here instead of redirected to: its URL
 *    works for anyone forever, so handing it to a buyer is the leak itself.
 * 2. **A Storage download URL is never redirected to.** Its token lives as
 *    long as the object. When the object belongs to a library asset, rule 1
 *    applies to that asset. When no asset owns it (a legacy object, a derived
 *    rendition file), it gets a V4 signed read URL with the same bounded
 *    lifetime. When it is not in this platform's bucket, or not inside the
 *    site's own library or its org's, it is refused.
 * 3. **Only the requesting site's own libraries are signed.** A product is
 *    author data. Signing whatever scope it names would let one site's author
 *    mint working links to another org's private files, so a host scope must
 *    be this site and an org scope must be this site's org, and the signed
 *    scope is always qualified with this site so the CDN's `visibleTo` check
 *    runs against the site actually selling it.
 * 4. **A hotlink to somebody else's server passes through unchanged.** No code
 *    of ours runs there and nothing here can make its URL expire. That is the
 *    author's hosting decision, and the docs say so.
 */

/** Why a stored URL was not turned into a link. */
export type PaidMediaRefusal =
  /** A library asset the public can still fetch without a signature. */
  | 'not-private'
  /** No such asset, a deleted one, or one not shared with this site. */
  | 'not-found'
  /** Another site's library, another org's, or outside the media prefixes. */
  | 'out-of-scope'
  /** A Storage URL for a bucket this platform does not serve from. */
  | 'foreign-storage'
  /** Not a value any delivery can be built from. */
  | 'malformed'

export type PaidMediaDelivery =
  | {
      ok: true
      via: 'signed-cdn'
      location: string
      expiresAtMs: number
      /** The scope segment the signature covers. */
      scope: string
      mediaId: string
    }
  | {
      ok: true
      via: 'signed-storage'
      location: string
      expiresAtMs: number
      objectPath: string
    }
  | { ok: true; via: 'external'; location: string }
  | { ok: false; refusal: PaidMediaRefusal }

/** A document read, reduced to what this module asks of one. */
export interface PaidMediaDocument {
  exists: boolean
  get(field: string): unknown
}

/** Every read and signature this module needs, injectable for tests. */
export interface PaidMediaDeliveryIo {
  /** The platform's media bucket; empty when unconfigured. */
  bucketName: string
  readMedia(
    collection: 'hosts' | 'orgs',
    scopeId: string,
    mediaId: string,
  ): Promise<PaidMediaDocument>
  /** The org a site belongs to, or null for an unindexed site. */
  orgIdForHost(hostId: string): Promise<string | null>
  /** A V4 signed read URL for one object in {@link bucketName}. */
  signStorageRead(objectPath: string, expiresAtMs: number): Promise<string>
}

/**
 * Resolves a stored product media URL to a redirect target that expires, or
 * says why there is none. See the module comment for the rules.
 *
 * `cdnParams` ride on a signed CDN URL ahead of the signature, which covers
 * `(scope, mediaId, exp)` and never the parameters, so they select a
 * representation of the one asset the signature names and nothing else.
 */
export async function resolvePaidMediaDelivery(options: {
  stored: unknown
  /** The site selling the media; the only libraries it may sign from. */
  hostId: string
  /** The lifetime of the link; bounded by `assertMediaSignatureTtl`. */
  ttlMs: number
  cdnParams?: ReadonlyArray<readonly [string, string]>
  nowMs?: number
  io: PaidMediaDeliveryIo
}): Promise<PaidMediaDelivery> {
  const { hostId, ttlMs, io } = options
  const nowMs = options.nowMs ?? Date.now()
  const refuse = (refusal: PaidMediaRefusal): PaidMediaDelivery => ({
    ok: false,
    refusal,
  })
  if (!hostId) return refuse('out-of-scope')

  // One lookup per call, and only for the forms that need to know the org.
  let orgId: Promise<string | null> | undefined
  const siteOrgId = () => (orgId ??= io.orgIdForHost(hostId))

  const deliverAsset = async (
    scope: string,
    mediaId: string,
  ): Promise<PaidMediaDelivery> => {
    const parsed = parseMediaCdnScope(scope)
    if (!parsed) return refuse('malformed')
    let collection: 'hosts' | 'orgs'
    let deliveryScope: string
    if (parsed.isOrg) {
      const owner = await siteOrgId()
      if (!owner || parsed.scopeId !== owner) return refuse('out-of-scope')
      collection = 'orgs'
      deliveryScope = hostQualifiedScope(scope, hostId)
    } else {
      if (parsed.scopeId !== hostId) return refuse('out-of-scope')
      collection = 'hosts'
      deliveryScope = hostId
    }
    const deliveryParsed = parseMediaCdnScope(deliveryScope)
    if (!deliveryParsed) return refuse('malformed')
    const document = await io.readMedia(collection, parsed.scopeId, mediaId)
    if (!document?.exists || document.get('deletedAt')) {
      return refuse('not-found')
    }
    // The CDN would 404 an org asset this site is not allowed to use, so a
    // link to one is a link that cannot play.
    if (mediaCdnScopeRefusal(deliveryParsed, document.get('visibleTo'))) {
      return refuse('not-found')
    }
    if (document.get('private') !== true) return refuse('not-private')
    const signature = mintMediaSignature(deliveryScope, mediaId, nowMs, ttlMs)
    const params = new URLSearchParams()
    for (const [key, value] of options.cdnParams ?? []) {
      if (key !== 'exp' && key !== 'sig') params.set(key, value)
    }
    const prefix = params.toString()
    return {
      ok: true,
      via: 'signed-cdn',
      location:
        `${MEDIA_CDN_ROUTE}/${deliveryScope}/${mediaId}?` +
        `${prefix ? `${prefix}&` : ''}${mediaSignatureQuery(signature)}`,
      expiresAtMs: signature.exp,
      scope: deliveryScope,
      mediaId,
    }
  }

  const source = parsePaidMediaSource(options.stored)
  switch (source.kind) {
    case 'malformed':
      return refuse('malformed')
    case 'external':
      return { ok: true, via: 'external', location: source.url }
    case 'asset':
      return deliverAsset(source.scope, source.mediaId)
    case 'storage-object': {
      if (!io.bucketName || source.bucket !== io.bucketName) {
        return refuse('foreign-storage')
      }
      const { objectPath } = source
      const segments = objectPath.split('/')
      let base: string | null = null
      if (segments[0] === 'hosts' && segments[1] === hostId) {
        base = `hosts/${hostId}`
      } else if (segments[0] === 'orgs' && segments[1]) {
        const owner = await siteOrgId()
        if (owner && segments[1] === owner) base = `orgs/${owner}`
      }
      // The same prefix test the CDN applies to a document's `storagePath`,
      // which also refuses traversal and empty segments.
      if (!base || !isMediaStoragePathInScope(objectPath, base)) {
        return refuse('out-of-scope')
      }
      // An object keyed like an asset IS that asset, and the asset's own rules
      // decide — including refusing it when the asset is still public.
      const asset = paidMediaAssetOfObject(objectPath)
      if (asset) return deliverAsset(asset.scope, asset.mediaId)
      assertMediaSignatureTtl(ttlMs)
      const expiresAtMs = nowMs + ttlMs
      return {
        ok: true,
        via: 'signed-storage',
        location: await io.signStorageRead(objectPath, expiresAtMs),
        expiresAtMs,
        objectPath,
      }
    }
  }
}

/**
 * The production reads behind {@link resolvePaidMediaDelivery}, built on the
 * caller's Firestore and bucket handles so a route's own mocks reach them.
 */
export function createPaidMediaDeliveryIo(options: {
  firestore: {
    collection(name: string): {
      doc(id: string): {
        get(): Promise<PaidMediaDocument>
        collection(name: string): {
          doc(id: string): { get(): Promise<PaidMediaDocument> }
        }
      }
    }
  }
  bucket: {
    name?: string
    file(path: string): {
      getSignedUrl(config: {
        version: 'v4'
        action: 'read'
        expires: number
      }): Promise<[string] | string[]>
    }
  }
}): PaidMediaDeliveryIo {
  const { firestore, bucket } = options
  return {
    bucketName: String(bucket?.name ?? ''),
    readMedia: (collection, scopeId, mediaId) =>
      firestore
        .collection(collection)
        .doc(scopeId)
        .collection('media')
        .doc(mediaId)
        .get(),
    orgIdForHost: async (hostId) => {
      const index = await firestore.collection('hostIndex').doc(hostId).get()
      const orgId = index.exists ? index.get('orgId') : undefined
      return typeof orgId === 'string' && orgId ? orgId : null
    },
    signStorageRead: async (objectPath, expiresAtMs) => {
      const [url] = await bucket.file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiresAtMs,
      })
      return String(url)
    },
  }
}
