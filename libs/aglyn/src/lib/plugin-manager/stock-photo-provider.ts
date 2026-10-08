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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * STOCK PHOTOS (AGL-3660): a library of licensed photos outside this
 * platform that a server process searches and copies from.
 *
 * Core defines the contract and never names a library. A plugin registers a
 * provider from its server declarations, and a caller — the AI site build is
 * the first — asks for {@link stockPhotoProvider} and gets the first one
 * this deployment configured, or `null`. Nothing here stores a photo: a
 * caller that keeps one copies its bytes into the site's own media library
 * (`plugin-media-ingest.ts`), because a page that names a library's own
 * address would hotlink it, and most libraries' terms refuse that.
 *
 * What a provider owes its library's terms — caching searches, its rate
 * limit, the hosts it may fetch from — it keeps inside itself, so a caller
 * cannot get them wrong. What it owes the caller is {@link
 * StockPhotoProvider.credit}: the words and links the asset records about
 * where it came from, and whether the library requires them shown.
 *
 * A provider that is registered and not configured (its key unset) answers
 * as absent, so a deployment without the key behaves as one without the
 * plugin.
 */

/** The shape a caller wants; a provider maps it onto its own filter. */
export type StockPhotoOrientation = 'horizontal' | 'vertical' | 'any'

export interface StockPhotoSearchRequest {
  /** Plain search words, at most {@link STOCK_PHOTO_QUERY_MAX_CHARS}. */
  query: string
  orientation?: StockPhotoOrientation
  /** The smallest original a hit may have, in pixels. */
  minWidth?: number
  minHeight?: number
  /** A hint that the photo should show people, where the library can filter by it. */
  people?: boolean
}

/** The longest query a caller sends; libraries refuse or truncate longer ones. */
export const STOCK_PHOTO_QUERY_MAX_CHARS = 100

/** One photo a search found. */
export interface StockPhoto {
  /** The registering provider's id. */
  provider: string
  /** The library's own id for the photo, stable across searches. */
  id: string
  /** The size of the copy {@link StockPhotoProvider.download} fetches. */
  width: number
  height: number
  /** The photo's page at the library, for the credit. */
  pageUrl: string
  /** The contributor's name as the library shows it. */
  photographer: string
  /** The contributor's page at the library, when it has one. */
  photographerUrl?: string
  /** The library's tags, lowercase. */
  tags: string[]
}

/** What an asset copied from a library records about where it came from. */
export interface StockPhotoCredit {
  /** The library's name, as its terms ask it written. */
  providerLabel: string
  /** The license the photo is used under. */
  license: string
  licenseUrl: string
  /** Whether the license requires the credit shown wherever the photo is. */
  attributionRequired: boolean
  /** A sentence crediting the photo, for the asset's description. */
  text: string
}

export interface StockPhotoSearchResult {
  photos: StockPhoto[]
  /** Whether the answer came from the provider's own cache. */
  cached: boolean
}

export interface StockPhotoDownload {
  bytes: Uint8Array
  /** `image/jpeg`, `image/png` or `image/webp`. */
  contentType: string
}

export interface StockPhotoProvider {
  /** A stable id, the prefix of every source key: `pixabay`. */
  id: string
  /** The library's name, in customer copy. */
  label: string
  /** Whether this deployment holds what the provider needs to search. */
  isConfigured(): boolean
  /**
   * The photos matching `request`, best first. `null` when the provider
   * cannot ask right now — its rate limit is spent, or the library failed —
   * which a caller treats as "no photo", never as an error to retry.
   */
  search(
    request: StockPhotoSearchRequest,
    options?: { signal?: AbortSignal },
  ): Promise<StockPhotoSearchResult | null>
  /**
   * The photo's bytes, fetched only from the library's own image hosts, or
   * `null` when they cannot be had within `maxBytes` and the signal.
   */
  download(
    photo: StockPhoto,
    options: { maxBytes: number; signal?: AbortSignal },
  ): Promise<StockPhotoDownload | null>
  /** How an asset copied from `photo` credits it. */
  credit(photo: StockPhoto): StockPhotoCredit
}

/**
 * Many plugins may each register a library; a caller is handed the first
 * configured one, highest priority first.
 */
export const STOCK_PHOTO_PROVIDERS = definePluginServiceContract<StockPhotoProvider>(
  'core.stock-photos',
  { multiple: true },
)

/** The key an asset copied from a library is found again by: `{provider}:{id}`. */
export function stockPhotoSourceKey(photo: Pick<StockPhoto, 'provider' | 'id'>): string {
  return `${photo.provider}:${photo.id}`
}

/**
 * Registers a library. The owner is the loader's marker when a register fn
 * is running, else `options.pluginId`; the provider's own id tells two
 * libraries of one plugin apart.
 */
export function registerStockPhotoProvider(
  provider: StockPhotoProvider,
  options?: { pluginId?: string; priority?: number },
): void {
  if (!provider?.id?.trim()) throw new Error('a stock photo provider needs an id')
  registerPluginService(STOCK_PHOTO_PROVIDERS, provider, {
    key: provider.id,
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    ...(options?.priority !== undefined ? { priority: options.priority } : {}),
  })
}

/**
 * The first registered library this deployment configured, or `null`.
 * Synchronous and free of I/O. A provider whose configuration check throws
 * answers as unconfigured: a stock photo is decoration, and its failure
 * leaves the caller's own fallback standing.
 */
export function stockPhotoProvider(): StockPhotoProvider | null {
  for (const { impl } of resolvePluginServices(STOCK_PHOTO_PROVIDERS)) {
    try {
      if (impl.isConfigured()) return impl
    } catch {
      // Unconfigured, as the note says.
    }
  }
  return null
}
