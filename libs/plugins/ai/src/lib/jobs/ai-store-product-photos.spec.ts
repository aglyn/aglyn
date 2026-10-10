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

import type { PluginMediaIngest, PluginMediaIngestRequest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiSiteProductChoices } from './ai-job-site-content'
import {
  aiLayoutStockPhotoSource,
  aiStockBusinessWords,
  aiStockCraftWords,
  aiStockForgetJobPhotos,
  aiStockProductSearches,
} from './ai-layout-stock-photos'

/*
 * A store's product photos (AGL-3676). The beta.237 Willow Wick start ("a
 * small-batch candle shop selling hand-poured soy candles online", job
 * MtlXWjvt9P) put a laptop and roses under "Candle Wick Trimmer" and an
 * antique tea set with pearls under "Candle Gift Set": the business read to
 * its end as "soy candles online", its craft "online", and a hit naming only
 * "set" filled a gift set. Through core's seams only: a fake provider and a
 * fake library. No network.
 */

const WILLOW = 'a small-batch candle shop selling hand-poured soy candles online'

const hit = (id: number, tags: string[]): StockPhoto => ({
  provider: 'pexels',
  id: String(id),
  width: 900,
  height: 1125,
  pageUrl: `https://www.pexels.com/photo/${id}/`,
  photographer: `user${id}`,
  tags,
})

const HITS: Record<string, StockPhoto[]> = {
  'candle wick trimmer': [hit(1, ['laptop', 'roses', 'desk']), hit(2, ['candle', 'wick', 'trimmer'])],
  'candle gift set': [hit(3, ['antique', 'tea', 'set', 'pearls'])],
  'candle gift box': [hit(4, ['candle', 'gift', 'box', 'twine'])],
  'tin soy candle': [hit(5, ['candle', 'tin', 'soy'])],
  candle: [hit(5, ['candle', 'tin', 'soy']), hit(6, ['candle', 'jar', 'flame']), hit(7, ['bedroom', 'book', 'cozy'])],
}

function fakes() {
  const asked: string[] = []
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pexels',
    label: 'Pexels',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: HITS[request.query] ?? [], cached: false }
    },
    download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
    credit: (found) => ({
      providerLabel: 'Pexels',
      license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      attributionRequired: false,
      text: `Photo by ${found.photographer} on Pexels.`,
    }),
  }
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      stored.push(request)
      return { ok: true, mediaId: `m${stored.length}`, src: `media:host-1/m${stored.length}`, width: 900, height: 1125 }
    },
    findStockPhoto: async () => null,
  }
  return { provider, ingest, asked, stored }
}

const slot = (name: string, shows = ''): AiLayoutPictureSlot => ({
  imageId: name,
  frameId: null,
  iconId: null,
  alt: name,
  aspect: 4 / 5,
  sectionIndex: 0,
  role: 'gallery',
  product: { subjects: [name, shows].filter(Boolean) },
})

describe('a store’s product photos (AGL-3676)', () => {
  it('reads the shop’s category from what it is, not from what it does', () => {
    expect(aiStockBusinessWords(WILLOW)).toBe('candle shop')
    expect(aiStockCraftWords(aiStockBusinessWords(WILLOW))).toBe('candle')
    // A shop that is only a place has no category to hold its photos to.
    expect(aiStockBusinessWords('An online boutique selling vintage jewelry')).toBe('boutique')
    expect(aiStockCraftWords('boutique')).toBe('')
    // What the business type already read stays as it was.
    expect(aiStockBusinessWords('A family-owned yoga studio in Austin for busy parents')).toBe('yoga studio')
  })

  it('searches for each product by its subject with the shop’s category, then its photo’s, then the category alone', () => {
    const queries = (subjects: string[]) => aiStockProductSearches({ aspect: 4 / 5, product: { subjects } }, 'candle').map((search) => search.query)
    expect(queries(['Candle Wick Trimmer'])).toEqual(['candle wick trimmer', 'candle'])
    expect(queries(['Candle Gift Set', 'A gift box of three soy candles tied with twine'])).toEqual(['candle gift set', 'candle gift box', 'candle'])
    expect(queries(['Travel Tin Soy Candle'])).toEqual(['tin soy candle', 'candle'])
    for (const search of aiStockProductSearches({ aspect: 4 / 5, product: { subjects: ['Wick Trimmer'] } }, 'candle')) {
      expect(search).toMatchObject({ requires: 'candle', orientation: 'vertical' })
    }
  })

  it('fills each product with a photo naming its category, never a lifestyle shot, and never one twice', async () => {
    aiStockForgetJobPhotos()
    const { provider, ingest, asked, stored } = fakes()
    const source = aiLayoutStockPhotoSource(
      { hostId: 'host-1', uid: 'member-1', seed: 'job-willow:products', business: WILLOW, sectionNames: ['Products'], jobId: 'job-willow', searches: 16 },
      { provider: () => provider, ingest: () => ingest },
    )
    const photos = await source?.([
      slot('Candle Wick Trimmer'),
      slot('Candle Gift Set', 'A gift box of three soy candles tied with twine'),
      slot('Travel Tin Soy Candle'),
      slot('Soy Wax Melts'),
    ])
    // Every product has a photo…
    expect(photos?.every((found) => !!found?.src)).toBe(true)
    // …the trimmer, not the laptop; the gift box, not the tea set; the tin;
    // and for the wax melts, which nothing named, a candle not shown yet —
    // never the cozy bedroom.
    expect(stored.map((request) => request.stockPhoto?.id)).toEqual(['2', '4', '5', '6'])
    expect(asked).not.toContain('soy candles online')
  })
})

describe('a store’s first products offer only real choices (AGL-3676)', () => {
  it('leaves out an option of one value — the live gift set’s empty “Scent” select — and keeps the rest', () => {
    expect(
      aiSiteProductChoices([
        { name: 'Scent', values: ['Lavender'] },
        { name: 'Size', values: ['8 oz', '12 oz', ' 8 OZ '] },
        { name: '', values: ['A', 'B'] },
      ]),
    ).toEqual([{ name: 'Size', values: ['8 oz', '12 oz'] }])
    expect(aiSiteProductChoices(undefined)).toEqual([])
  })
})
