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

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import { aiLayoutPictureRole, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockProductSearches,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSensitive,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSubjectWords,
} from './ai-layout-stock-photos'
import {
  BED_SCENE,
  CANDLE_GIFT,
  CANDLE_MAKING,
  DEVOTIONAL_CANDLES,
  FLUID_ART,
  GLASS_ART,
  MANNEQUIN_HANDS,
  NUDE_TORSO,
  POTTER_AT_WHEEL,
  SOY_CANDLE,
  STONEWARE_BOWLS,
  TAPER_CANDLE,
  WAX_MELTS,
} from './fixtures/ai-stock-photo-ember-oak-hits'

/*
 * The beta.239 Ember & Oak Candle Co start (AGL-3660), slot by slot, against
 * hits in Pixabay's shape that include each photo it placed. Through core's
 * seams only: a fake provider and a fake library. No network.
 */

const EMBER =
  'A small-batch candle shop selling hand-poured soy candles, wax melts and gift sets online'

/**
 * What the library answers, as loosely as Pixabay does: the bad photos
 * answer the searches the old rules sent ("candle hands", "gifts", "soy
 * candle", "candle"), and the new ones meet them too.
 */
const ANSWERS: Record<string, StockPhoto[]> = {
  // The old story search, and the maker at work.
  'candle hands': [MANNEQUIN_HANDS],
  'candle hand': [MANNEQUIN_HANDS],
  'candle making': [MANNEQUIN_HANDS, CANDLE_MAKING],
  'pouring wax': [MANNEQUIN_HANDS, CANDLE_MAKING],
  'handmade candles': [MANNEQUIN_HANDS, FLUID_ART, DEVOTIONAL_CANDLES, TAPER_CANDLE],
  'scented candles': [DEVOTIONAL_CANDLES, TAPER_CANDLE],
  // The wax melts tile and product.
  'wax melts': [FLUID_ART, TAPER_CANDLE],
  melt: [FLUID_ART],
  'wax melt warmer': [TAPER_CANDLE, WAX_MELTS],
  'wax melt gift set': [TAPER_CANDLE],
  // The gifts tile.
  gifts: [DEVOTIONAL_CANDLES],
  gift: [DEVOTIONAL_CANDLES],
  'candle gifts': [DEVOTIONAL_CANDLES, CANDLE_GIFT],
  'candle gift': [DEVOTIONAL_CANDLES, CANDLE_GIFT],
  // The soy candle product.
  'soy candle': [BED_SCENE],
  candle: [BED_SCENE, TAPER_CANDLE, SOY_CANDLE],
}

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: ANSWERS[request.query] ?? [], cached: true }
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
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      const id = String(request.stockPhoto?.id)
      return { ok: true, mediaId: id, src: `media:h/${id}`, width: 1280, height: 1600 }
    },
    findStockPhoto: async () => null,
  }
  return { provider, ingest, asked }
}

const SECTIONS = ['Hero', 'Poured by hand, in small batches', 'Shop by collection', 'Products']

const pictureSlot = (index: number, sectionIndex: number, alt: string, aspect = 4 / 5): AiLayoutPictureSlot => ({
  imageId: `img${index}`,
  frameId: null,
  iconId: null,
  alt,
  aspect,
  sectionIndex,
  role: aiLayoutPictureRole({ sectionIndex, sectionName: SECTIONS[sectionIndex] ?? '', alt }),
})

const productSlot = (name: string, shows = ''): AiLayoutPictureSlot => ({
  imageId: name,
  frameId: null,
  iconId: null,
  alt: name,
  aspect: 4 / 5,
  sectionIndex: 3,
  role: 'gallery',
  product: { subjects: [name, shows].filter(Boolean) },
})

async function place(slots: AiLayoutPictureSlot[], seed: string) {
  const { provider, ingest, asked } = fakes()
  const source = aiLayoutStockPhotoSource(
    { hostId: 'h', uid: 'u', seed, business: EMBER, sectionNames: SECTIONS, searches: 40 },
    { provider: () => provider, ingest: () => ingest },
  )
  const photos = (await source?.(slots)) ?? []
  return { placed: photos.map((found) => found?.src?.replace('media:h/', '') ?? null), asked }
}

describe('the Ember & Oak start’s photos (AGL-3660, beta.239)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    aiStockForgetJobPhotos()
  })
  afterEach(() => warn.mockRestore())

  it('never reads "hand-poured", "handmade" or "by hand" as hands', () => {
    expect(aiStockSubjectWords('Hand-poured soy candles', '')).toBe('soy candles')
    expect(aiStockSubjectWords('Hands at work pouring wax, by hand', '')).not.toMatch(/\bhands?\b/)
    expect(aiStockSubjectWords('Hands pouring melted wax into a jar', '')).toBe('pouring melted wax')
    expect(aiStockSubjectWords('Handcrafted candles, made by hand', '')).toBe('candles')
    expect(aiStockSubjectWords('', 'Poured by hand, in small batches')).not.toMatch(/\bhands?\b/)
    // A thing sold for hands keeps them.
    expect(aiStockSubjectWords('Lavender hand soap', '')).toBe('lavender hand soap')
  })

  it('reads the site’s world without its wrappers: "gift sets" is not a world', () => {
    const terms = aiStockSiteTerms(EMBER)
    expect(terms).toMatchObject({ business: 'candle shop', craft: 'candle', making: ['candle making', 'pouring wax'] })
    expect(terms.domain).toEqual(expect.arrayContaining(['candle', 'soy', 'wax']))
    expect(terms.domain).not.toContain('gift')
    expect(terms.domain).not.toContain('hand')
  })

  it('a story of the craft asks for the maker at work, never hands', () => {
    const terms = aiStockSiteTerms(EMBER)
    const slot = pictureSlot(1, 1, 'Hands at work pouring wax, by hand')
    expect(aiStockSlotPart(slot, SECTIONS[1] as string)).toBe('story')
    const searches = aiStockSearchesFor(slot, terms, aiStockSubjectWords(slot.alt, SECTIONS[1] as string), 'story')
    expect(searches.slice(0, 2)).toEqual([
      expect.objectContaining({ query: 'candle making', broad: true, requires: 'candle' }),
      expect.objectContaining({ query: 'pouring wax', broad: true, requires: 'candle' }),
    ])
    expect(searches.every((search) => !/\bhands?\b/.test(search.query))).toBe(true)
  })

  it('rejects religious, funeral, political, weapon, alcohol, child and mannequin imagery the brief never named', () => {
    const named = aiStockSiteTerms(EMBER).named
    expect(aiStockSensitive(DEVOTIONAL_CANDLES, named)).toBe(true)
    expect(aiStockSensitive(MANNEQUIN_HANDS, named)).toBe(true)
    for (const tags of [
      ['candle', 'memorial', 'grief'],
      ['candle', 'flag', 'protest'],
      ['candle', 'gun'],
      ['candle', 'wine', 'glass'],
      ['candle', 'kids', 'birthday'],
      ['candle', 'mosque'],
    ]) {
      expect(aiStockSensitive({ tags, pageUrl: 'https://pixabay.com/photos/x-1/' }, named)).toBe(true)
    }
    expect(aiStockSensitive(CANDLE_GIFT, named)).toBe(false)
    // "cross-stitch" is not a cross.
    expect(aiStockSensitive({ tags: ['cross-stitch', 'embroidery'], pageUrl: 'https://pixabay.com/photos/x-1/' }, named)).toBe(false)
    // A brief that names the topic lets it in: a church's candles, a winery's wine.
    expect(aiStockSensitive(DEVOTIONAL_CANDLES, aiStockSiteTerms('A parish church shop selling candles').named)).toBe(false)
    expect(
      aiStockSensitive({ tags: ['wine', 'glass'], pageUrl: 'https://pixabay.com/photos/x-1/' }, aiStockSiteTerms('A family winery').named),
    ).toBe(false)
    expect(aiStockRelevance(DEVOTIONAL_CANDLES, { domain: aiStockSiteTerms(EMBER).domain, named })).toBe(0)
  })

  it('names the product’s head noun among the first tags: no lifestyle bed for a soy candle, no taper for wax melts', () => {
    const terms = aiStockSiteTerms(EMBER)
    const melts = aiStockProductSearches(productSlot('Wax Melt Gift Set'), terms.craft, terms.domain)
    expect(melts.map((search) => search.query)).toEqual([
      'wax melt gift set',
      'wax melts',
      'wax melt warmer',
      'scented wax cubes',
    ])
    // The category alone never stands in for a wax melt.
    expect(melts.map((search) => search.query)).not.toContain('candle')
    const candle = aiStockProductSearches(productSlot('Hand-Poured Soy Candle'), terms.craft, terms.domain)
    expect(candle.map((search) => search.query)).toEqual(['soy candle', 'candle'])
    const judge = (search: (typeof melts)[number]) => ({
      subject: search.subject ?? '',
      domain: terms.domain,
      named: terms.named,
      strict: true,
      ...(search.requires ? { requires: search.requires } : {}),
      ...(search.object ? { object: search.object } : {}),
      ...(search.kin ? { kin: search.kin } : {}),
      ...(search.lead ? { lead: true } : {}),
    })
    expect(aiStockRelevance(BED_SCENE, judge(candle[0] as (typeof candle)[number]))).toBe(0)
    expect(aiStockRelevance(SOY_CANDLE, judge(candle[1] as (typeof candle)[number]))).toBeGreaterThan(0)
    for (const search of melts) {
      expect(aiStockRelevance(TAPER_CANDLE, judge(search))).toBe(0)
      expect(aiStockRelevance(FLUID_ART, judge(search))).toBe(0)
      expect(aiStockRelevance(WAX_MELTS, judge(search))).toBeGreaterThan(0)
    }
  })

  it('fills the home: the maker at work, a wax melt tile of wax melts, a gift tile with no cross', async () => {
    const { placed, asked } = await place(
      [
        pictureSlot(1, 1, 'Hands at work pouring wax, by hand', 4 / 3),
        pictureSlot(2, 2, 'Wax melts'),
        pictureSlot(3, 2, 'Gifts for melt fans'),
      ],
      'ember-oak:/',
    )
    expect(placed).toEqual([CANDLE_MAKING.id, WAX_MELTS.id, CANDLE_GIFT.id])
    for (const bad of [MANNEQUIN_HANDS, FLUID_ART, DEVOTIONAL_CANDLES, TAPER_CANDLE]) expect(placed).not.toContain(bad.id)
    expect(asked.every((query) => !/\bhands?\b/.test(query))).toBe(true)
  })

  it('fills the products: a plain soy candle over the bed, wax melts over the taper', async () => {
    const { placed } = await place(
      [productSlot('Hand-Poured Soy Candle'), productSlot('Wax Melt Gift Set')],
      'ember-oak:products',
    )
    expect(placed).toEqual([SOY_CANDLE.id, WAX_MELTS.id])
  })
})

describe('the Kiln & Clover start’s photos (AGL-3660)', () => {
  const KILN =
    'A portfolio for a ceramic artist making wheel-thrown stoneware bowls, mugs and vases, with commissions and classes'
  /** The searches its about band and Work hero sent, answered with the photos they placed among good ones. */
  const KILN_ANSWERS: Record<string, StockPhoto[]> = {
    'ceramic artist': [GLASS_ART, NUDE_TORSO, STONEWARE_BOWLS],
    'handmade ceramics': [GLASS_ART, STONEWARE_BOWLS],
    pottery: [GLASS_ART, STONEWARE_BOWLS],
    'pottery wheel': [NUDE_TORSO, POTTER_AT_WHEEL],
    'potter at work': [NUDE_TORSO, POTTER_AT_WHEEL],
  }
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    aiStockForgetJobPhotos()
  })
  afterEach(() => warn.mockRestore())

  async function placeKiln(slots: AiLayoutPictureSlot[], sectionNames: string[]) {
    const { provider, ingest } = fakes()
    const source = aiLayoutStockPhotoSource(
      { hostId: 'h', uid: 'u', seed: 'kiln-clover', business: KILN, sectionNames, searches: 40 },
      {
        provider: () => ({
          ...provider,
          search: async (request) => ({ photos: KILN_ANSWERS[request.query] ?? [], cached: true }),
        }),
        ingest: () => ingest,
      },
    )
    const photos = (await source?.(slots)) ?? []
    return photos.map((found) => found?.src?.replace('media:h/', '') ?? null)
  }

  const at = (tags: string[]) => ({ tags, pageUrl: 'https://pixabay.com/photos/x-1/' })

  it('never places nudity, for any business, whatever its brief says', () => {
    const terms = aiStockSiteTerms(KILN)
    expect(aiStockSensitive(NUDE_TORSO, terms.named)).toBe(true)
    // Not even where the brief names it.
    expect(aiStockSensitive(NUDE_TORSO, aiStockSiteTerms('A sculptor making nude torso and body studies').named)).toBe(true)
    for (const word of ['naked', 'breast', 'erotic', 'sensual', 'lingerie', 'bikini', 'nudity']) {
      expect(aiStockSensitive(at(['art', word]), terms.named)).toBe(true)
    }
    expect(aiStockRelevance(NUDE_TORSO, { domain: terms.domain, named: terms.named })).toBe(0)
  })

  it('never reads glass art as pottery: a hit naming glass names the potter’s own words too', () => {
    const terms = aiStockSiteTerms(KILN)
    // "Wheel-thrown" says how, not what: a car's wheel is not pottery.
    expect(terms.domain).not.toContain('wheel')
    const judge = { domain: terms.domain, named: terms.named, rivals: terms.rivals }
    expect(aiStockRelevance(GLASS_ART, judge)).toBe(0)
    expect(aiStockRelevance(STONEWARE_BOWLS, judge)).toBeGreaterThan(0)
    // A ceramic bowl beside a glass is still pottery.
    expect(aiStockRelevance(at(['ceramic bowl', 'glass', 'table']), judge)).toBeGreaterThan(0)
  })

  it('fills the about band with the potter at work and the Work hero with stoneware', async () => {
    const sections = ['Hero', 'About the artist and the process']
    const alt = 'The artist at the wheel, shaping a stoneware bowl by hand'
    const about = await placeKiln(
      [
        {
          imageId: 'a',
          frameId: null,
          iconId: null,
          alt,
          aspect: 4 / 5,
          sectionIndex: 1,
          role: aiLayoutPictureRole({ sectionIndex: 1, sectionName: sections[1] as string, alt }),
        },
      ],
      sections,
    )
    expect(about).toEqual([POTTER_AT_WHEEL.id])
    const work = await placeKiln(
      [{ imageId: 'h', frameId: null, iconId: null, alt: 'Selected work', aspect: 16 / 9, sectionIndex: 0, role: 'hero' }],
      ['Work'],
    )
    expect(work).toEqual([STONEWARE_BOWLS.id])
  })
})
