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
  pluginMediaIngest,
  type PluginMediaIngest,
  type PluginMediaIngestRequest,
} from '../../plugin-manager/plugin-media-ingest'
import {
  stockPhotoProvider,
  stockPhotoSourceKey,
  type StockPhoto,
  type StockPhotoProvider,
} from '../../plugin-manager/stock-photo-provider'
import {
  normalizeStockPhotoQuery,
  STOCK_PHOTO_GONE_MESSAGE,
  stockPhotoHitRefOf,
  stockPhotoOrientationOf,
  stockPhotoPickerMediaOf,
  stockPhotoSafeLink,
  STOCK_PHOTOS_UNCONFIGURED_MESSAGE,
  stockPhotosBusyMessage,
  stockPhotoTargetOf,
  type StockPhotoHitRef,
  type StockPhotoImportAnswer,
  type StockPhotoPickerHit,
  type StockPhotoPickerTarget,
  type StockPhotoSearchAnswer,
  type StockPhotoStatusAnswer,
} from './stock-photo-picker'

/**
 * The server half of the media picker's Stock photos tab (AGL-4066). The
 * console's route verifies the caller and hands this the request body with
 * two doors of its own: {@link StockPhotoPickerServerDeps.authorize}, the
 * same scope check an upload makes (the member may add files to that
 * library, the lockdown's uploads gate), and
 * {@link StockPhotoPickerServerDeps.readMedia}, the stored document. The rest
 * is here, against core's contracts alone:
 *
 * - `status` — whether a library is configured, and its name.
 * - `search` — the provider's own search, its 24-hour cache and its rate
 *   limit in charge. A `null` answer (rate-limited, or the library down) is
 *   `busy`, a state the tab shows, never a 5xx: a library's bad minute is
 *   not a fault of the console's.
 * - `preview` — a hit's small copy, as bytes, so no browser loads an
 *   address at the library.
 * - `import` — the photo copied into the library through `core.media-ingest`
 *   as the member, which makes the upload's own checks (access, lockdown,
 *   structure, takedowns, plan and storage band). A copy the library already
 *   holds under the photo's source key is placed instead, never stored a
 *   second time. The credit rides the asset as the AI build writes it:
 *   `description` "Photo by … on …" and `stockPhoto` with the photographer,
 *   the photo's page and the license.
 *
 * A hit is found again by the search that found it, which the provider
 * answers from its cache, so the addresses and the credit are always the
 * provider's own and never what a browser sent.
 */

/** The largest stored copy a photo may be. */
export const STOCK_PHOTO_IMPORT_MAX_BYTES = 10 * 1024 * 1024
/** The largest preview handed to a browser. */
export const STOCK_PHOTO_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
/** How long a browser may keep a preview. */
const PREVIEW_CACHE_CONTROL = 'private, max-age=3600'
/** How long one process keeps a search's photos to find hits again in, before asking the provider. */
export const STOCK_PHOTO_HIT_MEMO_MS = 5 * 60 * 1000
/** Searches one process keeps in that memo. */
const HIT_MEMO_SIZE = 50
/** The tags a hit shows. */
const HIT_TAGS = 8
/** The file extension a stored copy is named with, by type. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface StockPhotoPickerServerDeps {
  /** The signed-in member. */
  uid: string
  /**
   * `null` when the member may add files to `target`'s library; otherwise
   * the refusal to answer with (401, 403, 404, 423 …).
   */
  authorize(target: StockPhotoPickerTarget): Promise<Response | null>
  /** The stored media document `mediaId` in `target`'s library, or `null`. */
  readMedia(target: StockPhotoPickerTarget, mediaId: string): Promise<Record<string, unknown> | null>
  provider?: () => StockPhotoProvider | null
  ingest?: () => PluginMediaIngest | null
  memo?: StockPhotoHitMemo
  signal?: AbortSignal
}

/** A process's recent searches, to find a hit again without asking the provider. */
export interface StockPhotoHitMemo {
  get(key: string): StockPhoto[] | null
  set(key: string, photos: StockPhoto[]): void
}

/** A memo of the last {@link HIT_MEMO_SIZE} searches, each kept {@link STOCK_PHOTO_HIT_MEMO_MS}. */
export function createStockPhotoHitMemo(now: () => number = Date.now): StockPhotoHitMemo {
  const held = new Map<string, { at: number; photos: StockPhoto[] }>()
  return {
    get(key) {
      const entry = held.get(key)
      if (!entry) return null
      if (now() - entry.at > STOCK_PHOTO_HIT_MEMO_MS) {
        held.delete(key)
        return null
      }
      return entry.photos
    },
    set(key, photos) {
      held.delete(key)
      held.set(key, { at: now(), photos })
      while (held.size > HIT_MEMO_SIZE) held.delete(held.keys().next().value as string)
    },
  }
}

const processMemo = createStockPhotoHitMemo()

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const refused = (status: number, message: string): Response => json({ status: 'refused', message }, status)

/** The memo's key for a search. */
const memoKey = (provider: StockPhotoProvider, ref: Pick<StockPhotoHitRef, 'query' | 'orientation'>) =>
  `${provider.id}\n${ref.orientation}\n${ref.query.toLowerCase()}`

/** A provider's hit as the tab shows it. */
export function stockPhotoPickerHitOf(
  provider: Pick<StockPhotoProvider, 'credit'>,
  photo: StockPhoto,
  search: Pick<StockPhotoHitRef, 'query' | 'orientation'>,
): StockPhotoPickerHit | null {
  const pageUrl = stockPhotoSafeLink(photo.pageUrl)
  if (!photo.id || !pageUrl || !(photo.width > 0) || !(photo.height > 0)) return null
  const credit = provider.credit(photo)
  const licenseUrl = stockPhotoSafeLink(credit.licenseUrl)
  const photographerUrl = stockPhotoSafeLink(photo.photographerUrl)
  return {
    ref: { query: search.query, orientation: search.orientation, id: photo.id },
    sourceKey: stockPhotoSourceKey(photo),
    width: photo.width,
    height: photo.height,
    photographer: photo.photographer,
    ...(photographerUrl ? { photographerUrl } : {}),
    pageUrl,
    tags: (photo.tags ?? []).slice(0, HIT_TAGS),
    ...(photo.alt ? { alt: photo.alt } : {}),
    credit: credit.text,
    license: credit.license,
    licenseUrl: licenseUrl ?? '',
    attributionRequired: credit.attributionRequired,
  }
}

/**
 * What the stored copy of `photo` is sent to the media library as: the
 * shape the AI build's copies take, so every stock asset carries one credit.
 */
export function stockPhotoPickerIngestRequest(input: {
  provider: Pick<StockPhotoProvider, 'credit'>
  target: StockPhotoPickerTarget
  uid: string
  photo: StockPhoto
  bytes: { bytes: Uint8Array; contentType: string }
  query: string
  folderId?: string | null
}): PluginMediaIngestRequest {
  const { photo, bytes, target } = input
  const credit = input.provider.credit(photo)
  const photographerUrl = stockPhotoSafeLink(photo.photographerUrl)
  return {
    hostId: target.hostId ?? '',
    ...(target.orgId ? { orgId: target.orgId } : {}),
    uid: input.uid,
    fileName: `${photo.provider}-${photo.id}.${EXTENSIONS[bytes.contentType] ?? 'jpg'}`,
    contentType: bytes.contentType,
    bytes: bytes.bytes,
    ...(photo.alt ? { alt: photo.alt } : {}),
    description: credit.text,
    ...(input.folderId ? { folderId: input.folderId } : {}),
    stockPhoto: {
      key: stockPhotoSourceKey(photo),
      provider: photo.provider,
      providerLabel: credit.providerLabel,
      id: photo.id,
      pageUrl: photo.pageUrl,
      photographer: photo.photographer,
      ...(photographerUrl ? { photographerUrl } : {}),
      license: credit.license,
      licenseUrl: credit.licenseUrl,
      attributionRequired: credit.attributionRequired,
      query: input.query,
    },
  }
}

/** The photo `ref` names, found again in its search; `null` when the provider cannot be asked, `false` when it is gone. */
async function findHit(
  provider: StockPhotoProvider,
  ref: StockPhotoHitRef,
  memo: StockPhotoHitMemo,
  signal?: AbortSignal,
): Promise<StockPhoto | null | false> {
  const key = memoKey(provider, ref)
  let photos = memo.get(key)
  if (!photos) {
    const answer = await provider.search({ query: ref.query, orientation: ref.orientation }, signal ? { signal } : undefined)
    if (!answer) return null
    photos = answer.photos
    memo.set(key, photos)
  }
  return photos.find((photo) => photo.id === ref.id) ?? false
}

/** Answers one request of the Stock photos tab. Never throws for the library's sake. */
export async function answerStockPhotoPickerRequest(
  body: unknown,
  deps: StockPhotoPickerServerDeps,
): Promise<Response> {
  const record = (body ?? {}) as Record<string, unknown>
  const action = record['action']
  if (action !== 'status' && action !== 'search' && action !== 'preview' && action !== 'import') {
    return refused(400, 'Unknown request')
  }
  const target = stockPhotoTargetOf(record)
  if (!target) return refused(400, 'Name the site or the workspace whose library to use')
  const denied = await deps.authorize(target)
  if (denied) return denied

  const provider = (deps.provider ?? stockPhotoProvider)()
  if (!provider) {
    if (action === 'preview') return new Response(null, { status: 204 })
    return json({ status: 'unconfigured', message: STOCK_PHOTOS_UNCONFIGURED_MESSAGE } satisfies StockPhotoStatusAnswer)
  }
  const library = { label: provider.label }
  const memo = deps.memo ?? processMemo
  const signal = deps.signal

  if (action === 'status') return json({ status: 'ready', library } satisfies StockPhotoStatusAnswer)

  if (action === 'search') {
    const query = normalizeStockPhotoQuery(record['query'])
    if (!query) return refused(400, 'Type a few words to search for, up to 100 characters')
    const orientation = stockPhotoOrientationOf(record['orientation'])
    let answer: Awaited<ReturnType<StockPhotoProvider['search']>> = null
    try {
      answer = await provider.search({ query, orientation }, signal ? { signal } : undefined)
    } catch (error) {
      console.warn('stock photos: the search failed', { provider: provider.id, error: String(error).slice(0, 160) })
    }
    if (!answer) return json({ status: 'busy', message: stockPhotosBusyMessage(provider.label) } satisfies StockPhotoSearchAnswer)
    memo.set(memoKey(provider, { query, orientation }), answer.photos)
    const hits = answer.photos
      .map((photo) => stockPhotoPickerHitOf(provider, photo, { query, orientation }))
      .filter((hit): hit is StockPhotoPickerHit => hit !== null)
    return json({ status: 'ok', library, query, orientation, hits } satisfies StockPhotoSearchAnswer)
  }

  const ref = stockPhotoHitRefOf(record['ref'])
  if (!ref) return refused(400, 'That photo could not be read. Search again and choose it from the results.')
  let photo: StockPhoto | null | false = null
  try {
    photo = await findHit(provider, ref, memo, signal)
  } catch (error) {
    console.warn('stock photos: a search to find a photo again failed', { provider: provider.id, error: String(error).slice(0, 160) })
  }

  if (action === 'preview') {
    if (!photo || typeof provider.preview !== 'function') return new Response(null, { status: 204 })
    const small = await provider.preview(photo, { maxBytes: STOCK_PHOTO_PREVIEW_MAX_BYTES, ...(signal ? { signal } : {}) }).catch((): null => null)
    if (!small) return new Response(null, { status: 204 })
    return new Response(new Uint8Array(small.bytes), {
      status: 200,
      headers: { 'Content-Type': small.contentType, 'Cache-Control': PREVIEW_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff' },
    })
  }

  // import
  if (photo === null) return json({ status: 'busy', message: stockPhotosBusyMessage(provider.label) } satisfies StockPhotoImportAnswer)
  if (photo === false) return json({ status: 'gone', message: STOCK_PHOTO_GONE_MESSAGE } satisfies StockPhotoImportAnswer, 404)
  const ingest = (deps.ingest ?? pluginMediaIngest)()
  if (!ingest) return refused(503, 'The media library cannot take photos this way right now. Try again in a minute.')
  const sourceKey = stockPhotoSourceKey(photo)
  const placed = async (mediaId: string, reused: boolean): Promise<Response> => {
    const data = await deps.readMedia(target, mediaId)
    if (!data) return refused(500, 'The photo was stored but could not be read back. It is in the library; choose it there.')
    return json({ status: 'ok', reused, media: stockPhotoPickerMediaOf(mediaId, data) } satisfies StockPhotoImportAnswer)
  }
  const held = await ingest.findStockPhoto({
    hostId: target.hostId ?? '',
    sourceKey,
    ...(target.orgId ? { orgId: target.orgId } : {}),
  })
  if (held) return placed(held.mediaId, true)
  const bytes = await provider
    .download(photo, { maxBytes: STOCK_PHOTO_IMPORT_MAX_BYTES, ...(signal ? { signal } : {}) })
    .catch((): null => null)
  if (!bytes) return json({ status: 'busy', message: stockPhotosBusyMessage(provider.label) } satisfies StockPhotoImportAnswer)
  const folderId = typeof record['folderId'] === 'string' && record['folderId'] ? String(record['folderId']).slice(0, 64) : null
  const stored = await ingest.ingest(
    stockPhotoPickerIngestRequest({ provider, target, uid: deps.uid, photo, bytes, query: ref.query, folderId }),
  )
  if (stored.ok === false) return refused(stored.status >= 400 ? stored.status : 500, stored.reason)
  return placed(stored.mediaId, false)
}
