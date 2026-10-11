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
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
} from './ai-layout-stock-photos'
import {
  BATH_GIFT_BOX,
  BODY_CARE,
  BODY_LOTION,
  COLD_PROCESS_SOAP_BAR,
  HANDMADE_SOAP,
  SHOP,
  SOAP,
  SOAP_BAR,
  SOAP_BAR_TRIO,
  SOAP_BARS,
  SOAP_MAKING,
} from './fixtures/ai-stock-photo-saltmarsh-recordings'

/*
 * The beta.241 Saltmarsh Soap Co start (AGL-3660, job achIX_dUDU), replayed
 * from what Pixabay answered it. Its collection tiles were good; its four
 * bestseller products took the starter photos (a laptop and roses, a living
 * room of plants, a person at a desk of tools) and its hero a florist's
 * bouquet, because the craft read as nothing and #1373's head-noun rule
 * turned every product hit down. Through core's seams only: a fake provider
 * answering each search with its recorded answer whatever the shape asked
 * (a search the start never sent answers nothing), and a fake library. No
 * network, no model.
 */

const SALTMARSH =
  'An online shop for handmade cold-process soap, body lotion and bath gift sets'

const RECORDED: Record<string, StockPhoto[]> = {
  'cold-process soap bar': COLD_PROCESS_SOAP_BAR,
  'soap bar': SOAP_BAR,
  'soap bar trio': SOAP_BAR_TRIO,
  'body lotion': BODY_LOTION,
  soap: SOAP,
  'bath gift box': BATH_GIFT_BOX,
  'body care': BODY_CARE,
  shop: SHOP,
  'handmade soap': HANDMADE_SOAP,
  'soap bars': SOAP_BARS,
  'soap making': SOAP_MAKING,
}

/** Every recorded hit, by id. */
const BY_ID = new Map(
  Object.values(RECORDED).flatMap((hits) =>
    hits.map((hit) => [hit.id, hit] as const),
  ),
)

/** What the start placed that showed something else: the florist hero, the supermarket fridge, the bubbles. */
const OFF_TOPIC = [
  '2264812',
  '949912',
  '1853439',
  '2417438',
  '2417439',
  '3527380',
  '3527363',
  '3576085',
  '2403673',
  '2403696',
]

function fakes() {
  const asked: string[] = []
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: RECORDED[request.query] ?? [], cached: true }
    },
    download: async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      contentType: 'image/jpeg',
    }),
    credit: (found) => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: `Photo by ${found.photographer} on Pixabay.`,
    }),
  }
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      stored.push(request)
      const id = String(request.stockPhoto?.id)
      const src = `media:saltmarsh/${id}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: id, src, width: 853, height: 1280 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src
        ? {
            mediaId: src.split('/').pop() as string,
            src,
            width: 853,
            height: 1280,
          }
        : null
    },
  }
  return { provider, ingest, asked, stored }
}

/** The products step's slots, as `aiSiteProductPhotos` builds them from the catalog's names. */
const PRODUCTS = [
  'Handmade Cold-Process Soap Bar',
  'Soap Bar Trio',
  'Gentle Body Lotion',
  'Soap and Lotion Gift Set',
  'Bath Gift Box',
]
const productSlots: AiLayoutPictureSlot[] = PRODUCTS.map((name, index) => ({
  imageId: `product${index}`,
  frameId: null,
  iconId: null,
  alt: name,
  aspect: 4 / 5,
  sectionIndex: 0,
  role: 'gallery',
  product: { subjects: [name] },
}))

/** The home hero, as the start wrote it. */
const HERO: AiLayoutPictureSlot = {
  imageId: 'hero',
  frameId: null,
  iconId: null,
  alt: 'Handmade Cold-Process Soap Bar on a wooden dish beside a bottle of Gentle Body Lotion',
  aspect: 16 / 9,
  sectionIndex: 0,
  role: 'hero',
}

/** The photo id a placed src is of. */
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** Whether a recorded hit names one of these words among its tags. */
const names = (id: string, words: readonly string[]) =>
  (BY_ID.get(id)?.tags ?? []).some((tag) =>
    words.some((word) => tag.toLowerCase().split(/\s+/).includes(word)),
  )

describe('the Saltmarsh Soap Co start’s photos (AGL-3660, beta.241)', () => {
  beforeEach(() => aiStockForgetJobPhotos())

  it('reads the craft from what the shop is for, not "shop"', () => {
    const terms = aiStockSiteTerms(SALTMARSH)
    expect(terms).toMatchObject({
      business: 'soap shop',
      craft: 'soap',
      broad: ['handmade soap', 'natural skincare'],
    })
    expect(terms.core).toEqual(expect.arrayContaining(['soap', 'skincare']))
    // How a soap is made, and "natural", are not its world: they let in a fridge and a florist.
    for (const word of ['cold', 'process', 'natural'])
      expect(terms.domain).not.toContain(word)
    expect(terms.domain).toEqual(
      expect.arrayContaining(['soap', 'lotion', 'bath']),
    )
  })

  it('fills every product with a photo of its own craft, never a starter, reusing one before it gives up', async () => {
    const { provider, ingest, stored } = fakes()
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'saltmarsh',
        uid: 'member-1',
        seed: 'achIX_dUDU:products',
        business: SALTMARSH,
        sectionNames: ['Products'],
        jobId: 'achIX_dUDU',
        searches: productSlots.length * 6,
      },
      { provider: () => provider, ingest: () => ingest },
    )
    const photos = (await source?.(productSlots)) ?? []
    const ids = photos.map((photo) => idOf(photo?.src))
    // Every product has a stock photo: none is left to the starters' desk or living room.
    expect(
      photos.every((photo) => photo?.src.startsWith('media:saltmarsh/')),
    ).toBe(true)
    for (const id of ids) expect(OFF_TOPIC).not.toContain(id)
    const [bar, trio, lotion, giftSet, giftBox] = ids as [
      string,
      string,
      string,
      string,
      string,
    ]
    // The soap bars name soap; the lotion names lotion or cream; the gifts name soap.
    expect(names(bar, ['soap', 'soaps'])).toBe(true)
    expect(names(trio, ['soap', 'soaps'])).toBe(true)
    expect(names(lotion, ['lotion', 'cream'])).toBe(true)
    expect(names(giftSet, ['soap', 'soaps'])).toBe(true)
    expect(names(giftBox, ['soap', 'soaps', 'gift'])).toBe(true)
    // A repeated photo is the library's one copy, never a second.
    expect(new Set(stored.map((request) => request.stockPhoto?.key)).size).toBe(
      stored.length,
    )
    // What each now gets, from the start's own answers: a stack of soap bars,
    // a handmade bar, a lotion bottle, soap cubes, a soap gift flat lay.
    expect({ bar, trio, lotion, giftSet, giftBox }).toEqual({
      bar: '9243',
      trio: '8429699',
      lotion: '7639482',
      giftSet: '8227622',
      giftBox: '3123468',
    })
  })

  it('reuses a photo the job already shows before a product takes a starter, and copies nothing twice', async () => {
    const { provider, ingest, stored } = fakes()
    // Every soap photo Pixabay answered is already on another page of the job.
    const shown = [...BY_ID.values()].map((hit) => `pixabay:${hit.id}`)
    for (const key of shown)
      await ingest.ingest({
        hostId: 'saltmarsh',
        uid: 'member-1',
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        bytes: new Uint8Array([1]),
        stockPhoto: { key, id: key.split(':')[1] },
      } as unknown as PluginMediaIngestRequest)
    stored.length = 0
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'saltmarsh',
        uid: 'member-1',
        seed: 'achIX_dUDU:products',
        business: SALTMARSH,
        sectionNames: ['Products'],
        jobId: 'achIX_dUDU',
        avoid: shown,
        searches: productSlots.length * 6,
      },
      { provider: () => provider, ingest: () => ingest },
    )
    const photos = (await source?.(productSlots)) ?? []
    expect(
      photos.every((photo) => photo?.src.startsWith('media:saltmarsh/')),
    ).toBe(true)
    expect(stored).toHaveLength(0)
    const ids = photos.map((photo) => idOf(photo?.src))
    for (const id of ids) expect(OFF_TOPIC).not.toContain(id)
    expect(names(ids[2] as string, ['lotion', 'cream'])).toBe(true)
  })

  it('opens the home page with a photo of soap, never "shop"', async () => {
    const terms = aiStockSiteTerms(SALTMARSH)
    const searches = aiStockSearchesFor(HERO, terms, '')
    expect(searches.map((search) => search.query)).toEqual([
      'soap shop',
      'handmade soap',
      'natural skincare',
    ])
    for (const search of searches) expect(search.category).toEqual(terms.core)
    // The florist and the supermarket fridge "shop" answered name no soap.
    for (const id of ['2264812', '949912', '1853439'])
      expect(
        aiStockRelevance(BY_ID.get(id) as StockPhoto, {
          domain: terms.domain,
          category: terms.core,
          named: terms.named,
        }),
      ).toBe(0)
    const { provider, ingest, asked } = fakes()
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'saltmarsh',
        uid: 'member-1',
        seed: 'achIX_dUDU:home',
        business: SALTMARSH,
        sectionNames: ['Hero'],
        jobId: 'achIX_dUDU',
      },
      { provider: () => provider, ingest: () => ingest },
    )
    const [hero] = (await source?.([HERO])) ?? []
    // Handmade cupcake soaps, from "handmade soap" ("soap shop" was never sent, so answers nothing here).
    expect(idOf(hero?.src)).toBe('447658')
    expect(asked).not.toContain('shop')
    expect(names(idOf(hero?.src), ['soap', 'soaps'])).toBe(true)
    expect(OFF_TOPIC).not.toContain(idOf(hero?.src))
  })

  it('never shows soap bubbles, a dispenser or detergent for a soapmaker', () => {
    const terms = aiStockSiteTerms(SALTMARSH)
    const judge = {
      domain: terms.domain,
      named: terms.named,
      rivals: terms.rivals,
    }
    for (const hit of SOAP_MAKING.filter((photo) =>
      photo.tags?.some((tag) => /bubble/.test(tag)),
    ))
      expect(aiStockRelevance(hit, judge)).toBe(0)
    const dispenser = BY_ID.get('5078746') as StockPhoto
    expect(aiStockRelevance(dispenser, judge)).toBe(0)
    // A handmade bar is still the soapmaker's.
    expect(
      aiStockRelevance(BY_ID.get('601239') as StockPhoto, judge),
    ).toBeGreaterThan(0)
  })
})
