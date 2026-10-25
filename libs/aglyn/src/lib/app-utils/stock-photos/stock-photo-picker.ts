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
  STOCK_PHOTO_QUERY_MAX_CHARS,
  type StockPhotoOrientation,
} from '../../plugin-manager/stock-photo-provider'

/**
 * STOCK PHOTOS IN THE MEDIA PICKER (AGL-4066): the wire between the
 * console's media picker and its server route, `/api/media/stock-photos`.
 *
 * A person editing a site by hand searches the deployment's stock photo
 * library from the picker's Stock photos tab and places one. The route asks
 * core's `core.stock-photos` provider and copies the chosen photo into the
 * library the picker is filing into through `core.media-ingest`, as the
 * signed-in member; the placed image is always that copy, never an address
 * at the library. This module is the shapes both sides agree on, the checks
 * the server makes on what a browser sends, and the browser's client. It
 * names no library: the provider's own label comes back in every answer.
 *
 * Every request names one library, the target: a site's (`hostId`) or the
 * workspace's shared one (`orgId`). A hit is named back to the server by
 * {@link StockPhotoHitRef} — the search that found it and its id — never by
 * the addresses or the credit, so the server finds the photo again in the
 * provider's own cached answer and nothing a browser claims about a photo
 * is stored.
 */

/** The console route the picker's Stock photos tab talks to. */
export const STOCK_PHOTO_PICKER_ROUTE = '/api/media/stock-photos'

/** The library a request searches for and copies into. */
export type StockPhotoPickerTarget = { hostId: string; orgId?: undefined } | { orgId: string; hostId?: undefined }

/** The orientations the tab offers, in its order. */
export const STOCK_PHOTO_PICKER_ORIENTATIONS: readonly StockPhotoOrientation[] = ['any', 'horizontal', 'vertical']

/** How a search result names its photo back to the server. */
export interface StockPhotoHitRef {
  /** The search words exactly as searched, after {@link normalizeStockPhotoQuery}. */
  query: string
  orientation: StockPhotoOrientation
  /** The library's own id for the photo. */
  id: string
}

/** One photo a search found, as the tab shows it. */
export interface StockPhotoPickerHit {
  ref: StockPhotoHitRef
  /** `{provider}:{id}`: what the library reuses an earlier copy by. */
  sourceKey: string
  /** The size of the copy that is stored when the photo is used. */
  width: number
  height: number
  photographer: string
  photographerUrl?: string
  /** The photo's page at the library. */
  pageUrl: string
  /** The library's tags, a few, lowercase. */
  tags: string[]
  /** The library's own description of the photo, where it writes one. */
  alt?: string
  /** The sentence the stored copy's description carries: "Photo by … on …". */
  credit: string
  license: string
  licenseUrl: string
  attributionRequired: boolean
}

/** The library the deployment searches, by the name its terms ask for. */
export interface StockPhotoPickerLibrary {
  label: string
}

/** What the tab is told when it opens. */
export type StockPhotoStatusAnswer =
  | { status: 'ready'; library: StockPhotoPickerLibrary }
  | { status: 'unconfigured'; message: string }
  | { status: 'refused'; message: string }

/** What a search answers. `busy`: the library could not be asked just now. */
export type StockPhotoSearchAnswer =
  | { status: 'ok'; library: StockPhotoPickerLibrary; query: string; orientation: StockPhotoOrientation; hits: StockPhotoPickerHit[] }
  | { status: 'busy'; message: string }
  | { status: 'unconfigured'; message: string }
  | { status: 'refused'; message: string }

/**
 * A stored asset as the picker places it: the media document's own fields,
 * the ones a library pick hands on.
 */
export interface StockPhotoPickerMedia {
  $id: string
  fileName?: string
  contentType?: string
  sizeBytes?: number
  url?: string
  cdnPath?: string
  folderId?: string | null
  alt?: string
  description?: string
  width?: number
  height?: number
  variants?: number[]
  visibleTo?: string[]
}

/** What using a photo answers. `reused`: the library already held a copy, which is placed. */
export type StockPhotoImportAnswer =
  | { status: 'ok'; reused: boolean; media: StockPhotoPickerMedia }
  | { status: 'busy'; message: string }
  | { status: 'gone'; message: string }
  | { status: 'unconfigured'; message: string }
  | { status: 'refused'; message: string }

/** Said when the deployment has no stock photo library. */
export const STOCK_PHOTOS_UNCONFIGURED_MESSAGE =
  'Stock photos are not set up here, so there is no library to search. ' +
  'You can still upload your own photos in the library tabs.'

/** Said when the library could not be asked, or could not send a photo, just now. */
export function stockPhotosBusyMessage(label: string): string {
  return `${label || 'The stock photo library'} is busy right now. Try again in a minute.`
}

/** Said when the photo is no longer among the search's results. */
export const STOCK_PHOTO_GONE_MESSAGE =
  'That photo is no longer in the search results. Search again and choose it from the new results.'

/** The longest id a library may give a photo here. */
const MAX_ID_CHARS = 64

/** A library id: a site's or a workspace's document id, never a path. */
const isDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && value.trim() === value

/**
 * The search words as searched: control characters dropped, runs of space
 * made one, trimmed. `null` when nothing is left or it is longer than
 * {@link STOCK_PHOTO_QUERY_MAX_CHARS}.
 */
export function normalizeStockPhotoQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const query = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!query || query.length > STOCK_PHOTO_QUERY_MAX_CHARS) return null
  return query
}

/** An orientation the tab offers, `any` for anything else. */
export function stockPhotoOrientationOf(value: unknown): StockPhotoOrientation {
  return STOCK_PHOTO_PICKER_ORIENTATIONS.includes(value as StockPhotoOrientation)
    ? (value as StockPhotoOrientation)
    : 'any'
}

/** The library a request names, or `null` when it names none, or both. */
export function stockPhotoTargetOf(body: unknown): StockPhotoPickerTarget | null {
  const record = (body ?? {}) as Record<string, unknown>
  const hostId = record['hostId']
  const orgId = record['orgId']
  const hasHost = hostId !== undefined && hostId !== null && hostId !== ''
  const hasOrg = orgId !== undefined && orgId !== null && orgId !== ''
  if (hasHost === hasOrg) return null
  if (hasHost) return isDocumentId(hostId) ? { hostId } : null
  return isDocumentId(orgId) ? { orgId } : null
}

/** The photo a request names, or `null` when it is not one a search could have found. */
export function stockPhotoHitRefOf(value: unknown): StockPhotoHitRef | null {
  const record = (value ?? {}) as Record<string, unknown>
  const query = normalizeStockPhotoQuery(record['query'])
  const id = record['id']
  if (!query || typeof id !== 'string' || !id || id.length > MAX_ID_CHARS || !/^[\w.-]+$/.test(id)) return null
  return { query, orientation: stockPhotoOrientationOf(record['orientation']), id }
}

/** `value` when it is an https address, else `undefined`: nothing else is ever linked. */
export function stockPhotoSafeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** The fields of a stored media document the picker hands on, from the document. */
export function stockPhotoPickerMediaOf(mediaId: string, data: Record<string, unknown>): StockPhotoPickerMedia {
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined)
  const count = (key: string) => (typeof data[key] === 'number' && Number.isFinite(data[key]) ? (data[key] as number) : undefined)
  const list = <T>(key: string, keep: (item: unknown) => item is T): T[] | undefined =>
    Array.isArray(data[key]) ? (data[key] as unknown[]).filter(keep) : undefined
  const media: StockPhotoPickerMedia = { $id: mediaId }
  const fields: Partial<StockPhotoPickerMedia> = {
    fileName: text('fileName'),
    contentType: text('contentType'),
    sizeBytes: count('sizeBytes'),
    url: text('url'),
    cdnPath: text('cdnPath'),
    alt: text('alt'),
    description: text('description'),
    width: count('width'),
    height: count('height'),
    variants: list('variants', (item): item is number => typeof item === 'number'),
    visibleTo: list('visibleTo', (item): item is string => typeof item === 'string'),
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (media as unknown as Record<string, unknown>)[key] = value
  }
  if (typeof data['folderId'] === 'string' || data['folderId'] === null) media.folderId = data['folderId'] as string | null
  return media
}

/** Posts one JSON request to the route, with whatever credentials the caller adds. */
export type StockPhotoPickerPost = (body: Record<string, unknown>) => Promise<Response>

/** The browser's side of the route, for one library. */
export interface StockPhotoPickerClient {
  status(): Promise<StockPhotoStatusAnswer>
  search(query: string, orientation: StockPhotoOrientation): Promise<StockPhotoSearchAnswer>
  /** The hit's small copy, or `null` when none can be had. */
  preview(ref: StockPhotoHitRef): Promise<Blob | null>
  /** Copies the photo into the library, or finds the copy it holds. */
  importPhoto(ref: StockPhotoHitRef, options?: { folderId?: string | null }): Promise<StockPhotoImportAnswer>
}

/** Said when a request failed before the server could answer it. */
const UNREACHABLE = 'Stock photos could not be reached. Check your connection and try again.'

/** What a refusal says: the route's own words, else `fallback`. */
async function refusalOf(response: Response, fallback: string): Promise<{ status: 'refused'; message: string }> {
  const body = (await response.json().catch((): null => null)) as { message?: unknown; error?: unknown } | null
  const said = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : ''
  return { status: 'refused', message: said || fallback }
}

/** The JSON answer of a request, or a refusal that says why there is none. */
async function answerOf<Answer>(request: () => Promise<Response>): Promise<Answer | { status: 'refused'; message: string }> {
  let response: Response
  try {
    response = await request()
  } catch {
    return { status: 'refused', message: UNREACHABLE }
  }
  if (!response.ok) return refusalOf(response, UNREACHABLE)
  const body = (await response.json().catch((): null => null)) as Answer | null
  return body && typeof (body as { status?: unknown }).status === 'string' ? body : { status: 'refused', message: UNREACHABLE }
}

/**
 * The client for one library. `post` carries the member's credentials: the
 * console hands in `authorizedFetch` bound to the route.
 */
export function createStockPhotoPickerClient(
  post: StockPhotoPickerPost,
  target: StockPhotoPickerTarget,
): StockPhotoPickerClient {
  const library = target.hostId ? { hostId: target.hostId } : { orgId: target.orgId }
  return {
    status: () => answerOf<StockPhotoStatusAnswer>(() => post({ action: 'status', ...library })),
    search: (query, orientation) =>
      answerOf<StockPhotoSearchAnswer>(() => post({ action: 'search', ...library, query, orientation })),
    async preview(ref) {
      try {
        const response = await post({ action: 'preview', ...library, ref })
        if (response.status !== 200) return null
        const blob = await response.blob()
        return blob.size && blob.type.startsWith('image/') ? blob : null
      } catch {
        return null
      }
    },
    importPhoto: (ref, options) =>
      answerOf<StockPhotoImportAnswer>(() =>
        post({
          action: 'import',
          ...library,
          ref,
          ...(options?.folderId ? { folderId: options.folderId } : {}),
        }),
      ),
  }
}
