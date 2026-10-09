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
  resetPluginServicesForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-services'
import { stockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import { STOCK_PHOTO_SEARCH_CACHE_COLLECTION, STOCK_PHOTO_SEARCH_CACHE_MS } from './constants'
import { registerStockPhotosConsoleServerDeclarations } from './declarations.console-server'
import { createPixabayStockPhotoProvider } from './pixabay-provider'
import type { PixabayPhoto } from './providers/pixabay'
import { createFirestoreSearchCache, stockPhotoSearchCacheKey } from './server/search-cache'
import { stockPhotosSubprocessors } from './subprocessors'
import {
  PIXABAY_CERAMIC_POTTERY_ANSWER,
  PIXABAY_EMPTY_ANSWER,
  PIXABAY_YOGA_STUDIO_ANSWER,
  pixabayResponse,
  TINY_JPEG,
} from './testing/pixabay-fixtures'

/**
 * Pixabay as core's provider (AGL-3660): every search answered from the
 * 24-hour cache first, downloads only from its own hits, and the credit an
 * asset records.
 */

/** A Firestore stand-in holding one collection's documents. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = docs.get(`${name}/${id}`)
          return { exists: Boolean(data), data: () => data }
        },
        set: async (data: Record<string, unknown>) => {
          docs.set(`${name}/${id}`, data)
        },
      }),
    }),
  }
  return { firestore: firestore as never, docs }
}

const KEY = 'test-key-not-real'

describe('the Pixabay provider', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    resetPluginServicesForTests()
  })

  it('answers the second search for the same words from the cache, for 24 hours', async () => {
    let now = 1_700_000_000_000
    const { firestore, docs } = fakeFirestore()
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER))
      .mockResolvedValueOnce(pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER))
    const provider = createPixabayStockPhotoProvider({
      apiKey: () => KEY,
      fetch,
      now: () => now,
      cache: createFirestoreSearchCache<PixabayPhoto>({ firestore: async () => firestore, now: () => now }),
    })
    const first = await provider.search({ query: 'Yoga studio', orientation: 'horizontal' })
    expect(first).toMatchObject({ cached: false })
    expect(first?.photos).toHaveLength(6)
    // The same canonical request, however it was spelled.
    const second = await provider.search({ query: ' yoga   STUDIO', orientation: 'horizontal' })
    expect(second).toMatchObject({ cached: true })
    expect(second?.photos).toEqual(first?.photos)
    expect(fetch).toHaveBeenCalledTimes(1)

    const [[path, stored]] = [...docs.entries()]
    expect(path.startsWith(`${STOCK_PHOTO_SEARCH_CACHE_COLLECTION}/`)).toBe(true)
    expect((stored['expiresAt'] as Date).getTime() - now).toBe(STOCK_PHOTO_SEARCH_CACHE_MS)
    // The key is never part of what is stored or what it is stored under.
    expect(JSON.stringify([...docs.entries()])).not.toContain(KEY)

    now += STOCK_PHOTO_SEARCH_CACHE_MS + 1
    expect(await provider.search({ query: 'yoga studio', orientation: 'horizontal' })).toMatchObject({
      cached: false,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('caches an empty answer too, and keys different filters apart', async () => {
    const { firestore } = fakeFirestore()
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(pixabayResponse(PIXABAY_EMPTY_ANSWER))
      .mockResolvedValueOnce(pixabayResponse(PIXABAY_CERAMIC_POTTERY_ANSWER))
    const provider = createPixabayStockPhotoProvider({
      apiKey: () => KEY,
      fetch,
      cache: createFirestoreSearchCache<PixabayPhoto>({ firestore: async () => firestore }),
    })
    expect((await provider.search({ query: 'zzqx' }))?.photos).toEqual([])
    expect((await provider.search({ query: 'zzqx' }))?.cached).toBe(true)
    expect((await provider.search({ query: 'ceramic pottery', orientation: 'vertical' }))?.photos).toHaveLength(4)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(stockPhotoSearchCacheKey('pixabay', 'q=a')).not.toBe(stockPhotoSearchCacheKey('pixabay', 'q=b'))
  })

  it('answers null when the library could not be asked, and does not cache it', async () => {
    const { firestore, docs } = fakeFirestore()
    const provider = createPixabayStockPhotoProvider({
      apiKey: () => KEY,
      fetch: jest.fn().mockResolvedValue(pixabayResponse('API rate limit exceeded', { status: 429 })),
      cache: createFirestoreSearchCache<PixabayPhoto>({ firestore: async () => firestore }),
    })
    expect(await provider.search({ query: 'yoga' })).toBeNull()
    expect(docs.size).toBe(0)
  })

  it('searches on when the cache cannot be reached', async () => {
    const provider = createPixabayStockPhotoProvider({
      apiKey: () => KEY,
      fetch: jest.fn().mockResolvedValue(pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER)),
      cache: createFirestoreSearchCache<PixabayPhoto>({
        firestore: async () => {
          throw new Error('offline')
        },
      }),
    })
    expect((await provider.search({ query: 'yoga' }))?.photos).toHaveLength(6)
  })

  it('downloads only its own hits, from their large copy', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER))
      .mockResolvedValueOnce(new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }))
    const provider = createPixabayStockPhotoProvider({ apiKey: () => KEY, fetch })
    const [photo] = (await provider.search({ query: 'yoga' }))?.photos ?? []
    expect(await provider.download({ ...photo, provider: 'other' }, { maxBytes: 1000 })).toBeNull()
    expect(
      await provider.download({ ...photo, downloadUrl: 'https://evil.example/a.jpg' } as never, { maxBytes: 1000 }),
    ).toBeNull()
    const got = await provider.download(photo, { maxBytes: 1_000_000 })
    expect(got?.contentType).toBe('image/jpeg')
    expect(fetch.mock.calls[1][0]).toBe('https://pixabay.com/get/g7101001large_1280.jpg')
  })

  it('credits the photographer and the license, which asks no credit shown', async () => {
    const provider = createPixabayStockPhotoProvider({ apiKey: () => KEY })
    expect(
      provider.credit({
        provider: 'pixabay',
        id: '1',
        width: 1,
        height: 1,
        pageUrl: 'https://pixabay.com/photos/x-1/',
        photographer: 'ClayHands',
        tags: [],
      }),
    ).toEqual({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: 'Photo by ClayHands on Pixabay.',
    })
  })

  it('registers at the console boot and answers as absent until the key is set', () => {
    const previous = process.env['PIXABAY_API_KEY']
    try {
      delete process.env['PIXABAY_API_KEY']
      registerStockPhotosConsoleServerDeclarations()
      expect(stockPhotoProvider()).toBeNull()
      process.env['PIXABAY_API_KEY'] = KEY
      expect(stockPhotoProvider()?.id).toBe('pixabay')
    } finally {
      if (previous === undefined) delete process.env['PIXABAY_API_KEY']
      else process.env['PIXABAY_API_KEY'] = previous
    }
  })

  it('declares both hosts it reaches, as no recipient of personal data', () => {
    const answer = stockPhotosSubprocessors() as { subprocessors?: readonly unknown[]; hosts?: ReadonlyArray<{ host: string }> }
    expect(answer.subprocessors).toEqual([])
    expect(answer.hosts?.map((host) => host.host)).toEqual(['pixabay.com', 'cdn.pixabay.com'])
  })
})
