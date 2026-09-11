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
 * The decisions behind `backfill-gated-media-private.mjs` (AGL-2814), kept
 * apart from the project I/O so every one is provable without a project.
 *
 * ## What the backfill repairs
 *
 * Before AGL-2814 a product's members video was delivered by redirecting the
 * buyer to the file's permanent address: its public CDN path, or, for a
 * library without the media CDN, its raw Storage download URL, whose token
 * lives as long as the object. Every buyer who pressed play holds a URL that
 * still works. The stream route now refuses to deliver a video whose file is
 * not private, so nothing new leaks; this closes what was already handed out:
 *
 * 1. the file is marked PRIVATE, which closes its CDN URL to anyone without a
 *    signature, and loses the `cdnPath` and `url` fields that named its public
 *    addresses — the same writes "Make private" in the media library makes;
 * 2. the object's download token is ROTATED, which kills every raw Storage URL
 *    already handed out, at Google's edge;
 * 3. a product entry that stored a raw download URL is REWRITTEN to the file's
 *    media reference, because after the rotation that URL names nothing.
 *
 * ## What it will not do on its own
 *
 * A public file that is ALSO used somewhere else, a trailer on a home page, is
 * listed and left alone unless `--include-shared` is passed. Making it private
 * breaks that page, and that is the owner's decision to make with the list in
 * front of them. The stream route keeps refusing to deliver such a video in the
 * meantime, so leaving it costs playback, not secrecy.
 *
 * It mints no token where an object has none, which would create a public URL.
 * It never touches another site's or another org's library, and it never
 * follows a hotlink, which no code of ours serves.
 *
 * ## Why the URL grammar is a copy
 *
 * An `.mjs` script cannot import the TypeScript it mirrors:
 * `libs/aglyn/src/lib/app-utils/paid-media-source.ts` and `media-ref.ts`, and
 * `mediaStoragePathInScope` in `libs/tenant/data/admin`. The test file drives
 * the same shapes their specs drive, so a divergence fails a test instead of
 * rewriting a customer document it should not.
 */

import { decode } from '@msgpack/msgpack'

/** Mirrors `MEDIA_CDN_ROUTE`. */
export const MEDIA_CDN_ROUTE = '/api/media/cdn'
/** The custom-metadata key a Firebase download URL's token lives under. */
export const DOWNLOAD_TOKEN_METADATA_KEY = 'firebaseStorageDownloadTokens'

const MEDIA_REF_PREFIX = 'media:'
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/
const STORAGE_DOWNLOAD_HOST = 'firebasestorage.googleapis.com'
const GCS_HOST = 'storage.googleapis.com'
/** Mirrors `FIRST_PARTY_APEXES` in media-ref.ts, without a self-host's own. */
const FIRST_PARTY_APEXES = ['aglyn.com', 'aglyn.app', 'aglyn.io', 'aglyn.dev', 'localhost']

function isMediaCdnScope(scope) {
  if (!scope.startsWith('org:')) return SEGMENT.test(scope)
  const parts = scope.slice('org:'.length).split(':')
  if (parts.length < 1 || parts.length > 2) return false
  return parts.every((part) => SEGMENT.test(part))
}

/** Mirrors `parseMediaRef`: `{ scope, mediaId }`, the content pin dropped. */
export function parseMediaRef(value) {
  if (typeof value !== 'string' || !value.startsWith(MEDIA_REF_PREFIX)) return null
  const rest = value.slice(MEDIA_REF_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const scope = rest.slice(0, slash)
  const tail = rest.slice(slash + 1)
  const at = tail.indexOf('@')
  const mediaId = at === -1 ? tail : tail.slice(0, at)
  if (!isMediaCdnScope(scope) || !SEGMENT.test(mediaId)) return null
  return { scope, mediaId }
}

function isFirstPartyHost(hostname) {
  const lower = hostname.toLowerCase()
  return FIRST_PARTY_APEXES.some((apex) => lower === apex || lower.endsWith(`.${apex}`))
}

function assetFromCdnPath(path) {
  const rest = path.slice(`${MEDIA_CDN_ROUTE}/`.length).split(/[?#]/)[0]
  const segments = rest.split('/')
  if (segments.length < 2 || segments.length > 3) return { kind: 'malformed' }
  let scope
  try {
    scope = decodeURIComponent(segments[0])
  } catch {
    return { kind: 'malformed' }
  }
  const ref = parseMediaRef(`${MEDIA_REF_PREFIX}${scope}/${segments[1]}`)
  return ref ? { kind: 'asset', scope: ref.scope, mediaId: ref.mediaId } : { kind: 'malformed' }
}

function decodePath(pieces) {
  try {
    return pieces.map((piece) => decodeURIComponent(piece)).join('/')
  } catch {
    return null
  }
}

/** Mirrors `parsePaidMediaSource`. */
export function parsePaidMediaSource(stored, options = {}) {
  const value = typeof stored === 'string' ? stored.trim() : ''
  if (!value) return { kind: 'malformed' }
  if (value.startsWith(MEDIA_REF_PREFIX)) {
    const ref = parseMediaRef(value)
    return ref ? { kind: 'asset', scope: ref.scope, mediaId: ref.mediaId } : { kind: 'malformed' }
  }
  if (value.startsWith(`${MEDIA_CDN_ROUTE}/`)) return assetFromCdnPath(value)
  if (!/^https?:\/\//i.test(value)) return { kind: 'malformed' }
  let url
  try {
    url = new URL(value)
  } catch {
    return { kind: 'malformed' }
  }
  const hostname = url.hostname.toLowerCase()
  const emulator = String(options.emulatorHost ?? '').trim().toLowerCase()
  if (hostname === STORAGE_DOWNLOAD_HOST || (emulator && url.host.toLowerCase() === emulator)) {
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname)
    const bucket = match ? decodePath([match[1]]) : null
    const objectPath = match ? decodePath([match[2]]) : null
    return bucket && objectPath ? { kind: 'storage-object', bucket, objectPath } : { kind: 'malformed' }
  }
  if (hostname === GCS_HOST) {
    const [, bucketPiece, ...objectPieces] = url.pathname.split('/')
    const bucket = bucketPiece ? decodePath([bucketPiece]) : null
    const objectPath = objectPieces.length ? decodePath(objectPieces) : null
    return bucket && objectPath ? { kind: 'storage-object', bucket, objectPath } : { kind: 'malformed' }
  }
  if (isFirstPartyHost(hostname) && url.pathname.startsWith(`${MEDIA_CDN_ROUTE}/`)) {
    return assetFromCdnPath(url.pathname)
  }
  return { kind: 'external', url: value }
}

/** Mirrors `paidMediaAssetOfObject`. */
export function paidMediaAssetOfObject(objectPath) {
  const segments = String(objectPath ?? '').split('/')
  if (segments.length < 4 || segments[2] !== 'media') return null
  if (segments.some((segment) => !segment || segment === '..')) return null
  const [root, scopeId] = segments
  const scope = root === 'hosts' ? scopeId : root === 'orgs' ? `org:${scopeId}` : null
  if (!scope) return null
  const ref = parseMediaRef(`${MEDIA_REF_PREFIX}${scope}/${segments[segments.length - 1]}`)
  return ref ? { scope: ref.scope, mediaId: ref.mediaId } : null
}

/** Mirrors `isMediaStoragePathInScope`. */
export function isMediaStoragePathInScope(candidate, base) {
  if (typeof candidate !== 'string') return false
  const value = candidate.trim()
  if (!value || value !== candidate || !base) return false
  const prefix = `${base}/media/`
  if (!value.startsWith(prefix) || value.length === prefix.length) return false
  if (value.includes('//')) return false
  return !value.split('/').includes('..')
}

/** Mirrors `mediaStoragePathInScope`: the recorded key, or the flat layout. */
export function mediaStoragePathInScope({ storagePath, base, mediaId }) {
  const fallback = `${base}/media/${mediaId}`
  if (storagePath === undefined || storagePath === null || storagePath === '') return fallback
  return isMediaStoragePathInScope(storagePath, base) ? storagePath : fallback
}

/** The token a Firebase download URL carries, or null. */
export function tokenOfDownloadUrl(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    return new URL(value).searchParams.get('token') || null
  } catch {
    return null
  }
}

/** The tokens an object's metadata value holds; Firebase allows a list. */
export function tokensOfMetadata(value) {
  return String(value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

/**
 * A document serialized for a text search, with every msgpack-encoded `nodes`
 * tree decoded first. A raw Buffer serializes as `{"type":"Buffer",...}`,
 * which contains none of the strings the page does, so a search that skipped
 * the decode would report a trailer on a compressed page as used nowhere.
 */
export function haystackOf(data) {
  return JSON.stringify(data ?? null, (_key, value) => {
    const bytes =
      value instanceof Uint8Array
        ? value
        : value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)
          ? Uint8Array.from(value.data)
          : null
    if (!bytes) return value
    try {
      return decode(bytes)
    } catch {
      return null
    }
  })
}

/** Whether a serialized document mentions this media id as a whole token. */
export function mentionsMediaId(haystack, mediaId) {
  if (!SEGMENT.test(String(mediaId ?? ''))) return false
  return new RegExp(`(^|[^A-Za-z0-9_-])${mediaId}(?![A-Za-z0-9_-])`).test(haystack)
}

/** The library a scope names, when it is this site's or its org's. */
function libraryOfScope(scope, site) {
  if (scope.startsWith('org:')) {
    const orgId = scope.slice('org:'.length).split(':')[0]
    return site.orgId && orgId === site.orgId
      ? { collection: 'orgs', scopeId: orgId, referenceScope: `org:${orgId}` }
      : null
  }
  return scope === site.hostId ? { collection: 'hosts', scopeId: scope, referenceScope: scope } : null
}

/** The library an object key sits in, when it is this site's or its org's. */
function libraryOfObject(objectPath, site) {
  const [root, scopeId] = String(objectPath).split('/')
  const owned =
    (root === 'hosts' && scopeId === site.hostId) ||
    (root === 'orgs' && Boolean(site.orgId) && scopeId === site.orgId)
  if (!owned || !isMediaStoragePathInScope(objectPath, `${root}/${scopeId}`)) return null
  return {
    collection: root,
    scopeId,
    referenceScope: root === 'orgs' ? `org:${scopeId}` : scopeId,
  }
}

/**
 * Every members-video entry across the given sites, grouped by the library
 * asset it names; the in-scope objects no asset owns; and the entries skipped,
 * with why.
 */
export function collectGatedMedia(sites, options) {
  const assets = new Map()
  const orphans = new Map()
  const skipped = []
  const counts = {
    sites: 0,
    products: 0,
    productsWithGatedVideos: 0,
    deletedProductsWithGatedVideos: 0,
    entries: 0,
  }
  for (const site of sites) {
    counts.sites += 1
    for (const product of site.products ?? []) {
      counts.products += 1
      const list = Array.isArray(product.gatedVideos) ? product.gatedVideos : []
      if (!list.length) continue
      counts.productsWithGatedVideos += 1
      if (product.deleted) counts.deletedProductsWithGatedVideos += 1
      list.forEach((entry, index) => {
        counts.entries += 1
        const url = entry && typeof entry === 'object' ? entry.url : undefined
        const at = {
          hostId: site.hostId,
          productId: product.id,
          productName: product.name,
          deleted: Boolean(product.deleted),
          index,
          url,
        }
        const source = parsePaidMediaSource(url, options)
        if (source.kind === 'external' || source.kind === 'malformed') {
          skipped.push({ ...at, reason: source.kind })
          return
        }
        let named = source.kind === 'asset' ? source : null
        let objectPath = null
        if (source.kind === 'storage-object') {
          if (source.bucket !== options.bucket) {
            skipped.push({ ...at, reason: 'foreign-storage' })
            return
          }
          objectPath = source.objectPath
          named = paidMediaAssetOfObject(objectPath)
        }
        const library = named ? libraryOfScope(named.scope, site) : libraryOfObject(objectPath, site)
        if (!library || (objectPath && !libraryOfObject(objectPath, site))) {
          skipped.push({ ...at, reason: 'out-of-scope' })
          return
        }
        if (!named) {
          const orphan = orphans.get(objectPath) ?? { objectPath, entries: [] }
          orphan.entries.push({ ...at, objectPath })
          orphans.set(objectPath, orphan)
          return
        }
        const key = `${library.collection}/${library.scopeId}/media/${named.mediaId}`
        const asset = assets.get(key) ?? {
          key,
          collection: library.collection,
          scopeId: library.scopeId,
          mediaId: named.mediaId,
          base: `${library.collection}/${library.scopeId}`,
          reference: `${MEDIA_REF_PREFIX}${library.referenceScope}/${named.mediaId}`,
          entries: [],
        }
        asset.entries.push({ ...at, objectPath })
        assets.set(key, asset)
      })
    }
  }
  return { assets: [...assets.values()], orphans: [...orphans.values()], skipped, counts }
}

/**
 * What the backfill does to one asset, from what the project holds.
 *
 * `objectTokens` maps each object key the asset may live at to the token
 * value its metadata carries, or null. `otherUses` is where else the file is
 * used; only a public file is searched, since a private one is already
 * unusable anywhere a signature is not minted.
 */
export function planAsset({ asset, media, objectTokens, otherUses = [], includeShared = false }) {
  const handedOut = new Set()
  for (const entry of asset.entries) {
    const token = entry.objectPath ? tokenOfDownloadUrl(entry.url) : null
    if (token) handedOut.add(token)
  }
  const mediaUrlToken = media ? tokenOfDownloadUrl(media.url) : null
  if (mediaUrlToken) handedOut.add(mediaUrlToken)
  const carriesHandedOutToken = (path) =>
    tokensOfMetadata(objectTokens.get(path)).some((token) => handedOut.has(token))
  const base = {
    key: asset.key,
    reference: asset.reference,
    entries: asset.entries.length,
    products: [...new Set(asset.entries.map((entry) => `${entry.hostId}/${entry.productId}`))],
    otherUses,
    markPrivate: false,
    deleteUrl: false,
    deleteCdnPath: false,
    rotate: [],
    rewrites: [],
  }

  if (!media || media.deletedAt) {
    // Nothing to make private and nothing to rewrite to. What is still worth
    // doing is killing a download link a buyer was already handed.
    const paths = [...new Set(asset.entries.map((entry) => entry.objectPath).filter(Boolean))]
    return { ...base, status: 'missing', rotate: paths.filter(carriesHandedOutToken) }
  }

  const objectPath = mediaStoragePathInScope({
    storagePath: media.storagePath,
    base: asset.base,
    mediaId: asset.mediaId,
  })
  const wasPublic = media.private !== true
  const rotate =
    tokensOfMetadata(objectTokens.get(objectPath)).length > 0 &&
    (wasPublic || carriesHandedOutToken(objectPath))
      ? [objectPath]
      : []
  const rewrites = asset.entries
    .filter((entry) => entry.objectPath && tokenOfDownloadUrl(entry.url))
    .map((entry) => ({
      hostId: entry.hostId,
      productId: entry.productId,
      index: entry.index,
      from: entry.url,
      to: asset.reference,
    }))
  const plan = {
    ...base,
    objectPath,
    markPrivate: wasPublic,
    deleteUrl: media.url !== undefined && media.url !== null,
    deleteCdnPath: media.cdnPath !== undefined && media.cdnPath !== null,
    rotate,
    rewrites,
  }
  if (wasPublic && otherUses.length && !includeShared) {
    return { ...base, objectPath, status: 'shared' }
  }
  const work =
    plan.markPrivate || plan.deleteUrl || plan.deleteCdnPath || rotate.length || rewrites.length
  return { ...plan, status: work ? 'fix' : 'protected' }
}

/** What the backfill does to an in-scope object no asset owns. */
export function planOrphan({ orphan, token }) {
  const handedOut = new Set(orphan.entries.map((entry) => tokenOfDownloadUrl(entry.url)).filter(Boolean))
  const rotate = tokensOfMetadata(token).some((value) => handedOut.has(value))
  return {
    objectPath: orphan.objectPath,
    entries: orphan.entries.length,
    status: rotate ? 'fix' : 'protected',
    rotate: rotate ? [orphan.objectPath] : [],
  }
}

/**
 * The whole run against an injected project. Writes happen only with
 * `apply`, only for a plan whose status is `fix`, token first, so a run that
 * stops part-way has already killed the link it was about to hide.
 */
export async function runGatedMediaBackfill({ io, bucket, apply = false, includeShared = false, hostFilter = null, emulatorHost = '' }) {
  const sites = []
  for (const site of await io.listSites(hostFilter)) {
    sites.push({ ...site, products: await io.listProducts(site.hostId) })
  }
  const collected = collectGatedMedia(sites, { bucket, emulatorHost })
  const report = {
    counts: collected.counts,
    skipped: collected.skipped,
    assets: [],
    orphans: [],
    applied: { tokensRotated: 0, madePrivate: 0, entriesRewritten: 0, failures: [] },
  }

  const attempt = async (label, work) => {
    try {
      return await work()
    } catch (error) {
      report.applied.failures.push({ label, message: String(error?.message ?? error) })
      return null
    }
  }

  for (const asset of collected.assets) {
    const media = await io.readMedia(asset.collection, asset.scopeId, asset.mediaId)
    const exists = Boolean(media && !media.deletedAt)
    const paths = exists
      ? [mediaStoragePathInScope({ storagePath: media.storagePath, base: asset.base, mediaId: asset.mediaId })]
      : [...new Set(asset.entries.map((entry) => entry.objectPath).filter(Boolean))]
    const objectTokens = new Map()
    for (const path of paths) objectTokens.set(path, await io.readObjectToken(path))
    let otherUses = []
    if (exists && media.private !== true) {
      const hostIds = asset.collection === 'orgs' ? await io.listOrgSites(asset.scopeId) : [asset.scopeId]
      otherUses = await io.findOtherUses({ asset, hostIds })
    }
    const plan = planAsset({ asset, media, objectTokens, otherUses, includeShared })
    report.assets.push(plan)
    if (!apply || plan.status !== 'fix') continue
    for (const path of plan.rotate) {
      if (await attempt(`rotate ${path}`, () => io.rotateToken(path))) report.applied.tokensRotated += 1
    }
    if (plan.markPrivate || plan.deleteUrl || plan.deleteCdnPath) {
      const done = await attempt(`private ${asset.key}`, async () => {
        await io.updateMedia(asset, { deleteUrl: plan.deleteUrl, deleteCdnPath: plan.deleteCdnPath })
        return true
      })
      if (done) report.applied.madePrivate += 1
    }
    const byProduct = new Map()
    for (const rewrite of plan.rewrites) {
      const key = `${rewrite.hostId}/${rewrite.productId}`
      byProduct.set(key, [...(byProduct.get(key) ?? []), rewrite])
    }
    for (const [key, rewrites] of byProduct) {
      const [hostId, productId] = key.split('/')
      const changed = await attempt(`rewrite ${key}`, () => io.rewriteProductEntries(hostId, productId, rewrites))
      report.applied.entriesRewritten += Number(changed ?? 0)
    }
  }

  for (const orphan of collected.orphans) {
    const plan = planOrphan({ orphan, token: await io.readObjectToken(orphan.objectPath) })
    report.orphans.push(plan)
    if (!apply || plan.status !== 'fix') continue
    if (await attempt(`rotate ${orphan.objectPath}`, () => io.rotateToken(orphan.objectPath))) {
      report.applied.tokensRotated += 1
    }
  }
  return report
}

/** The one-line totals a run prints, dry or applied. */
export function summarize(report) {
  const byStatus = (list, status) => list.filter((plan) => plan.status === status).length
  const reasons = {}
  for (const entry of report.skipped) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1
  return {
    ...report.counts,
    skipped: reasons,
    assets: report.assets.length,
    assetsToFix: byStatus(report.assets, 'fix'),
    assetsAlreadyProtected: byStatus(report.assets, 'protected'),
    assetsSharedLeftAlone: byStatus(report.assets, 'shared'),
    assetsMissing: byStatus(report.assets, 'missing'),
    wouldMarkPrivate: report.assets.filter((plan) => plan.status === 'fix' && plan.markPrivate).length,
    wouldRotateTokens:
      report.assets.reduce((sum, plan) => sum + (plan.status === 'shared' ? 0 : plan.rotate.length), 0) +
      report.orphans.reduce((sum, plan) => sum + plan.rotate.length, 0),
    wouldRewriteEntries: report.assets.reduce(
      (sum, plan) => sum + (plan.status === 'fix' ? plan.rewrites.length : 0),
      0,
    ),
    orphanObjects: report.orphans.length,
  }
}
