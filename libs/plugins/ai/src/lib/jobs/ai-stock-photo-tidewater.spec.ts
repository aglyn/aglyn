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
  aiStockProductSearches,
  aiStockRelevance,
  aiStockSiteTerms,
} from './ai-layout-stock-photos'
import {
  BODY_LOTION,
  COLD_PROCESS_SOAP_BAR,
  SOAP,
  SOAP_BAR,
  SOAP_BAR_TRIO,
} from './fixtures/ai-stock-photo-saltmarsh-recordings'
import {
  BATH_GIFT_SET,
  HANDMADE_SOAP_TALL,
  SOAP_GIFT_SETS,
  SOAP_SET,
  SOAP_SET_STARTER_SIZE,
} from './fixtures/ai-stock-photo-tidewater-recordings'

/*
 * The beta.242 Tidewater Soap Works start (AGL-3660, job S0vnUzhGar),
 * replayed from what Pixabay answered it. Its hero and its four collection
 * tiles were good; four of its bestseller products were not: a black soap
 * dispenser under "Bath Gift Set Starter Size", a wooden sauna under "Bath
 * Gift Set", blue colognes under "Natural Body Lotion" and a bathroom shelf
 * of baskets under "Soap Bar Trio". Each was the first hit that named the
 * product's word somewhere, taken before a surer photo of its category.
 * Through core's seams only: a fake provider answering each search with its
 * recorded answer for that query and orientation (a search the start never
 * sent answers nothing), and a fake library. No network, no model.
 */

const TIDEWATER =
  'An online shop for handmade cold-process soap, body lotion and bath gift sets'

/** Recorded answers, by query and orientation: every product search here is a tall one. */
const RECORDED: Record<string, StockPhoto[]> = {
  'cold-process soap bar|vertical': COLD_PROCESS_SOAP_BAR,
  'soap bar|vertical': SOAP_BAR,
  'soap bar trio|vertical': SOAP_BAR_TRIO,
  'body lotion|vertical': BODY_LOTION,
  'soap|vertical': SOAP,
  'bath gift set|vertical': BATH_GIFT_SET,
  'soap set starter size|vertical': SOAP_SET_STARTER_SIZE,
  'handmade soap|vertical': HANDMADE_SOAP_TALL,
  'soap set|vertical': SOAP_SET,
  'soap gift sets|vertical': SOAP_GIFT_SETS,
}

/** Every recorded hit, by id. */
const BY_ID = new Map(
  Object.values(RECORDED).flatMap((hits) =>
    hits.map((hit) => [hit.id, hit] as const),
  ),
)
const photo = (id: string) => BY_ID.get(id) as StockPhoto

/** What the start placed under its products that showed something else. */
const PLACED = {
  dispenser: '2389772',
  sauna: '6893064',
  cologne: '7639483',
  shelf: '6822245',
}

function fakes() {
  const asked: string[] = []
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return {
        photos: RECORDED[`${request.query}|${request.orientation}`] ?? [],
        cached: true,
      }
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
      const src = `media:tidewater/${id}`
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
  'Natural Body Lotion',
  'Bath Gift Set',
  'Bath Gift Set Starter Size',
]
const productSlot = (name: string): AiLayoutPictureSlot => ({
  imageId: `product-${name}`,
  frameId: null,
  iconId: null,
  alt: name,
  aspect: 4 / 5,
  sectionIndex: 0,
  role: 'gallery',
  product: { subjects: [name] },
})
const productSlots = PRODUCTS.map(productSlot)

/** The photo id a placed src is of. */
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** A recorded hit's first tags and page slug: what it is a photo OF. */
const leads = (id: string) => {
  const hit = photo(id)
  return [...(hit.tags ?? []).slice(0, 3), hit.pageUrl].join(' ').toLowerCase()
}

/** How a product's search judges a hit, as the source judges it. */
const judgeFor = (
  search: ReturnType<typeof aiStockProductSearches>[number],
  terms: ReturnType<typeof aiStockSiteTerms>,
) => ({
  subject: search.subject ?? '',
  domain: terms.domain,
  named: terms.named,
  rivals: terms.rivals,
  shun: [...terms.shun, ...(search.shun ?? [])],
  strict: !search.broad,
  ...(search.product ? { product: true } : {}),
  ...(search.leadAny ? { leadAny: search.leadAny } : {}),
  ...(search.requires ? { requires: search.requires } : {}),
  ...(search.object ? { object: search.object } : {}),
  ...(search.kin ? { kin: search.kin } : {}),
  ...(search.lead ? { lead: true } : {}),
  ...(search.leadWorld ? { leadWorld: true } : {}),
  ...(search.category ? { category: search.category } : {}),
})

const run = async (avoid: string[] = []) => {
  const fake = fakes()
  const source = aiLayoutStockPhotoSource(
    {
      hostId: 'tidewater',
      uid: 'member-1',
      seed: 'S0vnUzhGar:products',
      business: TIDEWATER,
      sectionNames: ['Products'],
      jobId: 'S0vnUzhGar',
      searches: productSlots.length * 6,
      ...(avoid.length ? { avoid } : {}),
    },
    { provider: () => fake.provider, ingest: () => fake.ingest },
  )
  const photos = (await source?.(productSlots)) ?? []
  return { ...fake, photos, ids: photos.map((found) => idOf(found?.src)) }
}

describe('the Tidewater Soap Works start’s product photos (AGL-3660, beta.242)', () => {
  beforeEach(() => aiStockForgetJobPhotos())

  it('turns down every photo the start placed under its products', () => {
    const terms = aiStockSiteTerms(TIDEWATER)
    const cases: Array<[string, string]> = [
      ['Bath Gift Set Starter Size', PLACED.dispenser],
      ['Bath Gift Set', PLACED.sauna],
      ['Natural Body Lotion', PLACED.cologne],
      ['Soap Bar Trio', PLACED.shelf],
    ]
    for (const [name, id] of cases)
      for (const search of aiStockProductSearches(
        productSlot(name),
        terms.craft,
        terms.domain,
        { broad: terms.broad, core: terms.core },
      ))
        expect([name, search.query, aiStockRelevance(photo(id), judgeFor(search, terms))]).toEqual([
          name,
          search.query,
          0,
        ])
  })

  it('reads a size as no part of the product, and "bath" as what a set is for', () => {
    const terms = aiStockSiteTerms(TIDEWATER)
    const own = (name: string) =>
      aiStockProductSearches(productSlot(name), terms.craft, terms.domain, {
        broad: terms.broad,
        core: terms.core,
      })
    const starter = own('Bath Gift Set Starter Size')
    // Never "soap set starter size", whose head noun was "size".
    expect(starter.map((search) => search.query)).not.toContain('soap set starter size')
    expect(starter.map((search) => search.query)).toEqual(own('Bath Gift Set').map((search) => search.query))
    // "bath gift set soap", never the room; then the set's own kin.
    const sure = starter.filter((search) => !search.tier)
    expect(sure.map((search) => search.query)).toEqual([
      'bath gift set soap',
      'soap gift set',
      'bath products',
      'bath bombs',
    ])
    // A lotion is searched as a lotion or a cream.
    expect(
      own('Natural Body Lotion')
        .filter((search) => !search.tier)
        .map((search) => search.query),
    ).toEqual(['body lotion', 'hand cream', 'cream jar', 'moisturizer'])
    // Every product search turns down rooms and fragrance bottles; the gift and the bars shun a pump.
    for (const search of [...starter, ...own('Soap Bar Trio')]) {
      expect(search.product).toBe(true)
      expect(search.shun).toEqual(expect.arrayContaining(['pump', 'dispenser']))
    }
    // The borrowed photos come before the weak ones, and are OF the category.
    const tiers = starter.map((search) => search.tier ?? 'own')
    expect(tiers.indexOf('borrow')).toBeGreaterThan(tiers.lastIndexOf('own'))
    expect(tiers.lastIndexOf('borrow')).toBeLessThan(tiers.indexOf('weak'))
    for (const search of starter.filter((found) => found.tier === 'borrow'))
      expect(search.leadAny).toEqual(expect.arrayContaining(['soap']))
  })

  it('fills each product with a sure photo of its own or its category’s, never the sauna, the colognes, the shelf or the dispenser', async () => {
    const { ids, photos, stored } = await run()
    expect(photos.every((found) => found?.src.startsWith('media:tidewater/'))).toBe(true)
    for (const id of ids) expect(Object.values(PLACED)).not.toContain(id)
    const [bar, trio, lotion, giftSet, starter] = ids as [string, string, string, string, string]
    // The bars and the gift sets are photos OF soap; the lotion OF a lotion or a cream.
    for (const id of [bar, trio, giftSet, starter]) expect(leads(id)).toMatch(/\bsoaps?\b/)
    expect(leads(lotion)).toMatch(/\b(?:lotion|cream)\b/)
    for (const id of ids) expect(leads(id)).not.toMatch(/sauna|bathroom|perfume|cologne|dispenser/)
    // A repeated photo is the library's one copy, never a second.
    expect(new Set(stored.map((request) => request.stockPhoto?.key)).size).toBe(stored.length)
    // What each now gets, from the start's own answers: a handmade bar, a
    // soap cube with dried flowers, a hand cream, a gift of soaps, and a soap
    // gift flat lay. The two gift sets borrow their collection's photos:
    // "handmade soap", the search that filled the "Gift sets" and "Starter
    // size" tiles.
    expect({ bar, trio, lotion, giftSet, starter }).toEqual({
      bar: '4523469',
      trio: '8227622',
      lotion: '6391400',
      giftSet: '9243',
      starter: '3123468',
    })
    expect(stored.map((request) => request.stockPhoto?.query)).toEqual([
      'soap bar',
      'soap bar trio',
      'body lotion',
      'handmade soap',
      'handmade soap',
    ])
  })

  it('borrows a sure photo the job already shows before it takes a weak one of its own', async () => {
    // Every sure soap photo is already on another page of the job: a collection tile's.
    const shown = [...BY_ID.values()].map((hit) => `pixabay:${hit.id}`)
    const fake = fakes()
    for (const key of shown)
      await fake.ingest.ingest({
        hostId: 'tidewater',
        uid: 'member-1',
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        bytes: new Uint8Array([1]),
        stockPhoto: { key, id: key.split(':')[1] },
      } as unknown as PluginMediaIngestRequest)
    fake.stored.length = 0
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'tidewater',
        uid: 'member-1',
        seed: 'S0vnUzhGar:products',
        business: TIDEWATER,
        sectionNames: ['Products'],
        jobId: 'S0vnUzhGar',
        avoid: shown,
        searches: productSlots.length * 6,
      },
      { provider: () => fake.provider, ingest: () => fake.ingest },
    )
    const photos = (await source?.(productSlots)) ?? []
    const ids = photos.map((found) => idOf(found?.src))
    expect(photos.every((found) => found?.src.startsWith('media:tidewater/'))).toBe(true)
    // Nothing copied twice; the repeats are the library's own copies.
    expect(fake.stored).toHaveLength(0)
    for (const id of ids) expect(Object.values(PLACED)).not.toContain(id)
    for (const id of [ids[0], ids[1], ids[3], ids[4]] as string[]) expect(leads(id)).toMatch(/\bsoaps?\b/)
    expect(leads(ids[2] as string)).toMatch(/\b(?:lotion|cream)\b/)
  })
})
