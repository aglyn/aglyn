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

import type { PluginMediaIngest, PluginMediaIngestRequest } from '../../plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider, StockPhotoSearchRequest } from '../../plugin-manager/stock-photo-provider'
import {
  answerStockPhotoPickerRequest,
  createStockPhotoHitMemo,
  STOCK_PHOTO_HIT_MEMO_MS,
  STOCK_PHOTO_IMPORT_MAX_BYTES,
  type StockPhotoPickerServerDeps,
} from './stock-photo-picker-server'

/**
 * The server half of the media picker's Stock photos tab (AGL-4066), against
 * a fake provider and a fake media ingest: no library is ever asked. The
 * hits are a recorded Pixabay answer as the stock-photos plugin parses it.
 */

/** Two hits of a recorded "yoga studio" answer, as the provider hands them over. */
const YOGA: Array<StockPhoto & { downloadUrl: string; previewUrl: string }> = [
  {
    provider: 'pixabay',
    id: '7101001',
    width: 1280,
    height: 853,
    pageUrl: 'https://pixabay.com/photos/yoga-7101001/',
    photographer: 'StudioLight',
    photographerUrl: 'https://pixabay.com/users/StudioLight-101/',
    tags: ['yoga', 'studio', 'woman', 'meditation'],
    downloadUrl: 'https://pixabay.com/get/g7101001large_1280.jpg',
    previewUrl: 'https://pixabay.com/get/g7101001web_340.jpg',
  },
  {
    provider: 'pixabay',
    id: '7101003',
    width: 853,
    height: 1280,
    pageUrl: 'https://pixabay.com/photos/yoga-7101003/',
    photographer: 'QuietMornings',
    tags: ['yoga', 'pose', 'stretching'],
    downloadUrl: 'https://pixabay.com/get/g7101003large_1280.jpg',
    previewUrl: 'https://pixabay.com/get/g7101003web_340.jpg',
  },
]

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

function fakeProvider(overrides: Partial<StockPhotoProvider> = {}) {
  const searches: StockPhotoSearchRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: jest.fn(async (request: StockPhotoSearchRequest) => {
      searches.push(request)
      return { photos: YOGA, cached: searches.length > 1 }
    }),
    download: jest.fn(async () => ({ bytes: JPEG, contentType: 'image/jpeg' })),
    preview: jest.fn(async () => ({ bytes: JPEG, contentType: 'image/jpeg' })),
    credit: (photo) => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: `Photo by ${photo.photographer} on Pixabay.`,
    }),
    ...overrides,
  }
  return { provider, searches }
}

function fakeIngest(held: Record<string, string> = {}) {
  const stored: PluginMediaIngestRequest[] = []
  const finds: unknown[] = []
  const ingest: PluginMediaIngest = {
    findStockPhoto: jest.fn(async (input) => {
      finds.push(input)
      const mediaId = held[input.sourceKey]
      return mediaId ? { mediaId, src: `media:host-1/${mediaId}` } : null
    }),
    ingest: jest.fn(async (request: PluginMediaIngestRequest) => {
      stored.push(request)
      return { ok: true as const, mediaId: 'new-1', src: 'media:host-1/new-1', width: 1280, height: 853 }
    }),
  }
  return { ingest, stored, finds }
}

const MEDIA_DOCS: Record<string, Record<string, unknown>> = {
  'new-1': { fileName: 'pixabay-7101001.jpg', contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/new-1', url: 'https://storage.example/new-1', width: 1280, height: 853 },
  'held-1': { fileName: 'pixabay-7101001.jpg', contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/held-1', url: 'https://storage.example/held-1' },
}

function deps(overrides: Partial<StockPhotoPickerServerDeps> = {}): StockPhotoPickerServerDeps {
  return {
    uid: 'member-1',
    authorize: jest.fn(async () => null),
    readMedia: jest.fn(async (_target, mediaId) => MEDIA_DOCS[mediaId] ?? null),
    memo: createStockPhotoHitMemo(),
    ...overrides,
  }
}

const ask = (body: Record<string, unknown>, with_: StockPhotoPickerServerDeps) => answerStockPhotoPickerRequest(body, with_)
const REF = { query: 'yoga studio', orientation: 'horizontal', id: '7101001' }

describe('the Stock photos route (AGL-4066)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('checks the member against the library before anything else, and answers with its refusal', async () => {
    const { provider } = fakeProvider()
    const refusal = Response.json({ error: 'Not a site admin' }, { status: 403 })
    const answer = await ask(
      { action: 'search', hostId: 'host-1', query: 'yoga' },
      deps({ provider: () => provider, authorize: async () => refusal }),
    )
    expect(answer.status).toBe(403)
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('refuses a request that names no library, or two, or no action', async () => {
    const authorize = jest.fn(async () => null)
    expect((await ask({ action: 'status' }, deps({ authorize }))).status).toBe(400)
    expect((await ask({ action: 'status', hostId: 'h', orgId: 'o' }, deps({ authorize }))).status).toBe(400)
    expect((await ask({ action: 'delete', hostId: 'h' }, deps({ authorize }))).status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('says so when the deployment has no stock photo library', async () => {
    for (const action of ['status', 'search', 'import']) {
      const answer = await ask({ action, hostId: 'host-1', query: 'yoga', ref: REF }, deps({ provider: () => null }))
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual({ status: 'unconfigured', message: expect.stringMatching(/not set up/) })
    }
    expect((await ask({ action: 'preview', hostId: 'host-1', ref: REF }, deps({ provider: () => null }))).status).toBe(204)
  })

  it('names the library when it is ready', async () => {
    const { provider } = fakeProvider()
    const answer = await ask({ action: 'status', orgId: 'org-1' }, deps({ provider: () => provider }))
    expect(await answer.json()).toEqual({ status: 'ready', library: { label: 'Pixabay' } })
  })

  it('searches the provider and shows each hit with its photographer, credit and source key', async () => {
    const { provider, searches } = fakeProvider()
    const answer = await ask(
      { action: 'search', hostId: 'host-1', query: '  Yoga   studio ', orientation: 'horizontal' },
      deps({ provider: () => provider }),
    )
    expect(answer.status).toBe(200)
    const body = await answer.json()
    expect(searches).toEqual([{ query: 'Yoga studio', orientation: 'horizontal' }])
    expect(body).toMatchObject({ status: 'ok', library: { label: 'Pixabay' }, query: 'Yoga studio', orientation: 'horizontal' })
    expect(body.hits).toHaveLength(2)
    expect(body.hits[0]).toEqual({
      ref: { query: 'Yoga studio', orientation: 'horizontal', id: '7101001' },
      sourceKey: 'pixabay:7101001',
      width: 1280,
      height: 853,
      photographer: 'StudioLight',
      photographerUrl: 'https://pixabay.com/users/StudioLight-101/',
      pageUrl: 'https://pixabay.com/photos/yoga-7101001/',
      tags: ['yoga', 'studio', 'woman', 'meditation'],
      credit: 'Photo by StudioLight on Pixabay.',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
    })
    // The library's own addresses never reach the browser.
    expect(JSON.stringify(body)).not.toContain('pixabay.com/get/')
  })

  it('answers a library that cannot be asked as busy, never as a 5xx', async () => {
    const { provider } = fakeProvider({ search: jest.fn(async () => null) })
    const answer = await ask({ action: 'search', hostId: 'host-1', query: 'yoga' }, deps({ provider: () => provider }))
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ status: 'busy', message: 'Pixabay is busy right now. Try again in a minute.' })
    const throwing = fakeProvider({ search: jest.fn(async () => Promise.reject(new Error('socket hang up'))) }).provider
    expect(await (await ask({ action: 'search', hostId: 'host-1', query: 'yoga' }, deps({ provider: () => throwing }))).json()).toMatchObject({
      status: 'busy',
    })
  })

  it('refuses an empty or overlong search', async () => {
    const { provider } = fakeProvider()
    expect((await ask({ action: 'search', hostId: 'host-1', query: '  ' }, deps({ provider: () => provider }))).status).toBe(400)
    expect((await ask({ action: 'search', hostId: 'host-1', query: 'x'.repeat(101) }, deps({ provider: () => provider }))).status).toBe(400)
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('serves a preview as bytes, finding the hit again in its search without asking twice', async () => {
    const { provider } = fakeProvider()
    const memo = createStockPhotoHitMemo()
    await ask({ action: 'search', hostId: 'host-1', query: 'yoga studio', orientation: 'horizontal' }, deps({ provider: () => provider, memo }))
    const answer = await ask({ action: 'preview', hostId: 'host-1', ref: REF }, deps({ provider: () => provider, memo }))
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('image/jpeg')
    expect(answer.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(JPEG)
    expect(provider.search).toHaveBeenCalledTimes(1)
    expect((provider.preview as jest.Mock).mock.calls[0][0]).toMatchObject({ id: '7101001', previewUrl: YOGA[0].previewUrl })
  })

  it('answers a preview it cannot have with no content', async () => {
    const { provider } = fakeProvider({ preview: jest.fn(async () => null) })
    expect((await ask({ action: 'preview', hostId: 'host-1', ref: REF }, deps({ provider: () => provider }))).status).toBe(204)
    const without = fakeProvider({ preview: undefined }).provider
    expect((await ask({ action: 'preview', hostId: 'host-1', ref: REF }, deps({ provider: () => without }))).status).toBe(204)
    const gone = { ...REF, id: '999' }
    expect((await ask({ action: 'preview', hostId: 'host-1', ref: gone }, deps({ provider: () => provider }))).status).toBe(204)
  })

  it('copies a photo into the site library as the member, with the credit the AI build records', async () => {
    const { provider } = fakeProvider()
    const { ingest, stored, finds } = fakeIngest()
    const answer = await ask(
      { action: 'import', hostId: 'host-1', ref: REF, folderId: 'covers' },
      deps({ provider: () => provider, ingest: () => ingest }),
    )
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
      status: 'ok',
      reused: false,
      media: { $id: 'new-1', ...MEDIA_DOCS['new-1'] },
    })
    expect(finds).toEqual([{ hostId: 'host-1', sourceKey: 'pixabay:7101001' }])
    expect((provider.download as jest.Mock).mock.calls[0][1]).toMatchObject({ maxBytes: STOCK_PHOTO_IMPORT_MAX_BYTES })
    expect(stored).toEqual([
      {
        hostId: 'host-1',
        uid: 'member-1',
        fileName: 'pixabay-7101001.jpg',
        contentType: 'image/jpeg',
        bytes: JPEG,
        description: 'Photo by StudioLight on Pixabay.',
        folderId: 'covers',
        stockPhoto: {
          key: 'pixabay:7101001',
          provider: 'pixabay',
          providerLabel: 'Pixabay',
          id: '7101001',
          pageUrl: 'https://pixabay.com/photos/yoga-7101001/',
          photographer: 'StudioLight',
          photographerUrl: 'https://pixabay.com/users/StudioLight-101/',
          license: 'Pixabay Content License',
          licenseUrl: 'https://pixabay.com/service/license-summary/',
          attributionRequired: false,
          query: 'yoga studio',
        },
      },
    ])
  })

  it('places the copy the library already holds instead of storing a second', async () => {
    const { provider } = fakeProvider()
    const { ingest, stored } = fakeIngest({ 'pixabay:7101001': 'held-1' })
    const answer = await ask({ action: 'import', hostId: 'host-1', ref: REF }, deps({ provider: () => provider, ingest: () => ingest }))
    expect(await answer.json()).toEqual({ status: 'ok', reused: true, media: { $id: 'held-1', ...MEDIA_DOCS['held-1'] } })
    expect(provider.download).not.toHaveBeenCalled()
    expect(stored).toHaveLength(0)
  })

  it("files into the workspace's shared library when that is the target", async () => {
    const { provider } = fakeProvider()
    const { ingest, stored, finds } = fakeIngest()
    const readMedia = jest.fn(async () => MEDIA_DOCS['new-1'])
    await ask({ action: 'import', orgId: 'org-1', ref: REF }, deps({ provider: () => provider, ingest: () => ingest, readMedia }))
    expect(finds).toEqual([{ hostId: '', orgId: 'org-1', sourceKey: 'pixabay:7101001' }])
    expect(stored[0]).toMatchObject({ hostId: '', orgId: 'org-1', uid: 'member-1' })
    expect(readMedia).toHaveBeenCalledWith({ orgId: 'org-1' }, 'new-1')
  })

  it('stores what the provider says about a photo, never what the browser claims', async () => {
    const { provider } = fakeProvider()
    const { ingest, stored } = fakeIngest()
    await ask(
      {
        action: 'import',
        hostId: 'host-1',
        ref: { ...REF, photographer: 'Someone Else', downloadUrl: 'https://evil.example/x.jpg' },
        credit: 'Photo by me',
      },
      deps({ provider: () => provider, ingest: () => ingest }),
    )
    expect(stored[0].stockPhoto?.photographer).toBe('StudioLight')
    expect(stored[0].description).toBe('Photo by StudioLight on Pixabay.')
    expect((provider.download as jest.Mock).mock.calls[0][0]).toMatchObject({ downloadUrl: YOGA[0].downloadUrl })
  })

  it('says a photo no longer in the results is gone, and a library that cannot send it is busy', async () => {
    const { provider } = fakeProvider()
    const { ingest } = fakeIngest()
    const gone = await ask({ action: 'import', hostId: 'host-1', ref: { ...REF, id: '999' } }, deps({ provider: () => provider, ingest: () => ingest }))
    expect(gone.status).toBe(404)
    expect(await gone.json()).toMatchObject({ status: 'gone' })

    const silent = fakeProvider({ download: jest.fn(async () => null) }).provider
    const busy = await ask({ action: 'import', hostId: 'host-1', ref: REF }, deps({ provider: () => silent, ingest: () => ingest }))
    expect(busy.status).toBe(200)
    expect(await busy.json()).toMatchObject({ status: 'busy' })
    expect(ingest.ingest).not.toHaveBeenCalled()

    const down = fakeProvider({ search: jest.fn(async () => null) }).provider
    expect(await (await ask({ action: 'import', hostId: 'host-1', ref: REF }, deps({ provider: () => down, ingest: () => ingest }))).json()).toMatchObject({
      status: 'busy',
    })
  })

  it("answers the media library's own refusal with its status and words", async () => {
    const { provider } = fakeProvider()
    const ingest: PluginMediaIngest = {
      findStockPhoto: async () => null,
      ingest: async () => ({ ok: false, status: 403, reason: 'Storage limit reached (100 MB)' }),
    }
    const answer = await ask({ action: 'import', hostId: 'host-1', ref: REF }, deps({ provider: () => provider, ingest: () => ingest }))
    expect(answer.status).toBe(403)
    expect(await answer.json()).toEqual({ status: 'refused', message: 'Storage limit reached (100 MB)' })
  })

  it('keeps a search for a few minutes, then asks the provider again', () => {
    let now = 1_000
    const memo = createStockPhotoHitMemo(() => now)
    memo.set('k', YOGA)
    expect(memo.get('k')).toBe(YOGA)
    now += STOCK_PHOTO_HIT_MEMO_MS + 1
    expect(memo.get('k')).toBeNull()
  })
})
