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

import type {
  PluginMediaIngest,
  PluginMediaIngestRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type {
  StockPhoto,
  StockPhotoProvider,
  StockPhotoSearchRequest,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import {
  registerStockPhotoPicker,
  stockPhotoPicker,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import { AI_LAYOUT_STARTER_PHOTOS } from '../layout-language/ai-layout-pictures'
import { aiLayoutStockPhotoSource, aiStockForgetJobPhotos } from './ai-layout-stock-photos'
import { aiStockPhotoPick } from './ai-stock-photo-picker'

/**
 * The stock photo picker another plugin's writer asks for (AGL-3755): one
 * photo for one subject, through core's seams only — a fake library answering
 * recorded-shape hits and a fake media door. No network, no model.
 */

const hit = (id: number, slug: string, tags: string[]): StockPhoto => ({
  provider: 'pixabay',
  id: String(id),
  width: 1280,
  height: 853,
  pageUrl: `https://pixabay.com/photos/${slug}-${id}/`,
  photographer: `user${id}`,
  tags,
})

/** What a bakery's event searches find, in the library's own tag shape. */
const LOAF = hit(101, 'bread-sourdough-loaf', ['sourdough', 'bread', 'loaf', 'baking', 'bakery'])
const DOUGH = hit(102, 'dough-sourdough-baking', ['sourdough', 'dough', 'baking', 'flour', 'bread'])
const LAPTOP = hit(103, 'laptop-desk-office', ['laptop', 'desk', 'office', 'workspace'])

function fakeProvider(answer: (request: StockPhotoSearchRequest) => StockPhoto[] | null) {
  const searches: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      searches.push(request.query)
      const photos = answer(request)
      return photos ? { photos, cached: false } : null
    },
    download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
    credit: (found) => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: `Photo by ${found.photographer} on Pixabay.`,
    }),
  }
  return { provider, searches }
}

function fakeLibrary(held: Record<string, string> = {}) {
  const stored: PluginMediaIngestRequest[] = []
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      stored.push(request)
      // A stored photo is held from now on, as the real library's source key holds it.
      held[request.stockPhoto?.key ?? ''] = `m${stored.length}`
      return { ok: true, mediaId: `m${stored.length}`, src: `media:host-1/m${stored.length}`, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) =>
      held[sourceKey] ? { mediaId: held[sourceKey], src: `media:host-1/${held[sourceKey]}`, width: 1280, height: 853 } : null,
  }
  return { ingest, stored }
}

const sourceOver =
  (provider: StockPhotoProvider | null, ingest: PluginMediaIngest | null): typeof aiLayoutStockPhotoSource =>
  (input) =>
    aiLayoutStockPhotoSource(input, { provider: () => provider, ingest: () => ingest })

const BAKERY = (photos: StockPhoto[]) => (request: StockPhotoSearchRequest) =>
  /sourdough|bread|bak/.test(request.query) ? photos : []

const REQUEST = {
  hostId: 'host-1',
  uid: 'member-1',
  subject: 'Autumn sourdough workshop',
  business: 'a sourdough bakery',
  scope: 'job-1',
  seed: 'job-1-i0',
}

const STARTER_SRCS = Object.values(AI_LAYOUT_STARTER_PHOTOS).map((photo) => photo.src)

beforeEach(() => aiStockForgetJobPhotos())

describe('the stock photo picker (AGL-3755)', () => {
  it('copies the photo of the subject’s world into the site’s library and answers its site address', async () => {
    const { provider, searches } = fakeProvider(BAKERY([LAPTOP, LOAF]))
    const { ingest, stored } = fakeLibrary()
    const pick = await aiStockPhotoPick(REQUEST, { source: sourceOver(provider, ingest) })
    expect(pick).toMatchObject({ origin: 'library', src: 'media:host-1/m1', width: 1280, height: 853 })
    expect(pick?.url.startsWith('/api/media/cdn/')).toBe(true)
    expect(pick?.url).toContain('m1')
    // Never the whole sentence, and the laptop never placed.
    // A workshop shows the craft at work, searched in the bakery's own words (recorded 2026-10-13).
    expect(searches[0]).toBe('baker kneading dough')
    expect(searches).not.toContain('Autumn sourdough workshop')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ hostId: 'host-1', uid: 'member-1', alt: 'Autumn sourdough workshop' })
    expect(stored[0]?.stockPhoto?.key).toBe(`pixabay:${LOAF.id}`)
  })

  it('reuses a photo the library already holds, and stores no second copy', async () => {
    const { provider } = fakeProvider(BAKERY([LOAF]))
    const { ingest, stored } = fakeLibrary({ [`pixabay:${LOAF.id}`]: 'held-1' })
    const pick = await aiStockPhotoPick(REQUEST, { source: sourceOver(provider, ingest) })
    expect(pick).toMatchObject({ origin: 'library', src: 'media:host-1/held-1' })
    expect(stored).toEqual([])
  })

  it('never places one photo twice in one act: the next event takes the next photo', async () => {
    const { provider } = fakeProvider(BAKERY([LOAF, DOUGH]))
    const { ingest, stored } = fakeLibrary()
    const source = sourceOver(provider, ingest)
    const first = await aiStockPhotoPick(REQUEST, { source })
    const second = await aiStockPhotoPick({ ...REQUEST, subject: 'Winter sourdough workshop', seed: 'job-1-i1' }, { source })
    expect(first?.src).not.toBe(second?.src)
    expect(new Set(stored.map((request) => request.stockPhoto?.key))).toEqual(
      new Set([`pixabay:${LOAF.id}`, `pixabay:${DOUGH.id}`]),
    )
    // The same draft asked again keeps its own photo.
    const again = await aiStockPhotoPick(REQUEST, { source })
    expect(again?.src).toBe(first?.src)
  })

  it('takes a starter photo when the library answers nothing of the business’s world', async () => {
    const { provider } = fakeProvider(() => [LAPTOP])
    const pick = await aiStockPhotoPick(REQUEST, { source: sourceOver(provider, fakeLibrary().ingest) })
    expect(pick?.origin).toBe('starter')
    expect(STARTER_SRCS).toContain(pick?.src)
    expect(pick?.url).toBe(pick?.src)
  })

  it('takes a starter photo when the library is down, unconfigured, or the media door is missing', async () => {
    for (const source of [
      sourceOver(fakeProvider(() => null).provider, fakeLibrary().ingest),
      sourceOver(null, fakeLibrary().ingest),
      sourceOver(fakeProvider(BAKERY([LOAF])).provider, null),
      (() => {
        throw new Error('library down')
      }) as unknown as typeof aiLayoutStockPhotoSource,
    ]) {
      const pick = await aiStockPhotoPick(REQUEST, { source })
      expect(pick?.origin).toBe('starter')
      expect(pick?.url.startsWith('/_static/starter/')).toBe(true)
    }
  })

  it('answers nothing for a subject with no words', async () => {
    expect(await aiStockPhotoPick({ ...REQUEST, subject: '  ' })).toBeNull()
  })

  it('is the deployment’s picker on core’s seam once registered', async () => {
    registerStockPhotoPicker({ pick: (request) => aiStockPhotoPick(request, { source: sourceOver(null, null) }) }, { pluginId: 'ai' })
    const pick = await stockPhotoPicker()?.pick(REQUEST)
    expect(pick?.origin).toBe('starter')
  })
})
