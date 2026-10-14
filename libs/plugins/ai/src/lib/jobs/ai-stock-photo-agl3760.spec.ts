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
import {
  stockPhotoSourceKey,
  type StockPhoto,
  type StockPhotoProvider,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockPhotoWordsOf,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
} from './ai-layout-stock-photos'
import { CANDLE_SHOP_TALL_HERO, CON_PAN_DULCE_HERO } from './fixtures/ai-stock-photo-agl3760-recordings'

/*
 * Two beta.246 heroes (AGL-3760), replayed from what Pixabay answered them:
 * a Spanish bakery's, the Río Dulce at dusk, and an English candle shop's, a
 * latte with a candle behind it. Through core's seams only: a fake provider
 * answering each search with its recorded answer whatever the shape asked (a
 * search the start never sent answers nothing), and a fake library. No
 * network, no model.
 */

const PANADERIA =
  'Una panadería familiar de San Antonio con pan dulce, conchas y pasteles de tres leches al estilo de Oaxaca'
const COPPER_FERN = 'An online shop for hand-poured soy candles, wax melts and candle gift sets'

/** What the Panadería plan would say in English, as its tool now asks. */
const PANADERIA_WORDS = 'bakery bread pastries'

/** The four Río Dulce photos the Panadería start placed, the hero among them. */
const RIO_DULCE = ['3619205', '3619206', '3619207', '3619208']

/** The latte the Copper Fern start placed as its hero. */
const LATTE = '9380550'

function fakes(recorded: Record<string, StockPhoto[]>) {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: recorded[request.query] ?? [], cached: true }
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
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      const id = String(request.stockPhoto?.id)
      const src = `media:site/${id}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: id, src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
    },
  }
  return { provider, ingest, asked }
}

const hero = (alt: string, aspect: number): AiLayoutPictureSlot => ({
  imageId: 'hero',
  frameId: null,
  iconId: null,
  alt,
  aspect,
  sectionIndex: 0,
  role: 'hero',
})

/** The photo id a placed src is of. */
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** A hero's judgement, as the source builds it for each of its searches. */
function heroScore(photo: StockPhoto, business: string, first: boolean): number {
  const terms = aiStockSiteTerms(business)
  return aiStockRelevance(photo, {
    subject: '',
    domain: terms.domain,
    category: terms.core,
    named: terms.named,
    rivals: terms.rivals,
    ...(first ? { first: true } : {}),
  })
}

const byId = (hits: readonly StockPhoto[], id: string) => hits.find((hit) => hit.id === id) as StockPhoto

beforeEach(() => aiStockForgetJobPhotos())

describe('a Spanish start is searched in English (AGL-3760, Panadería Sol de Oaxaca)', () => {
  it('read its Spanish business type as "con pan dulce", which is what found the river', () => {
    const terms = aiStockSiteTerms(PANADERIA)
    expect(terms.business).toBe('con pan dulce')
    expect(aiStockSearchesFor(hero('x', 16 / 9), terms, '')[0]?.query).toBe('con pan dulce')
  })

  it('searches its hero by the plan’s English words, subject first, never a place', () => {
    const terms = aiStockSiteTerms(PANADERIA_WORDS)
    const queries = aiStockSearchesFor(hero('x', 16 / 9), terms, '').map((search) => search.query)
    expect(queries[0]).toBe('bakery bread pastries')
    for (const query of queries) expect(query).not.toMatch(/oaxaca|antonio|dulce|con\b/)
  })

  it('turns down the Río Dulce, and a cake whose first tag is "dulce", as a bakery hero', () => {
    for (const id of RIO_DULCE) expect(heroScore(byId(CON_PAN_DULCE_HERO, id), PANADERIA_WORDS, true)).toBe(0)
    expect(heroScore(byId(CON_PAN_DULCE_HERO, '3147645'), PANADERIA_WORDS, true)).toBe(0)
  })

  it('placed the river from "con pan dulce", and with the plan’s words never sends that search', async () => {
    const slot = hero('Charola de conchas y pan dulce recién salidos del horno en la panadería', 16 / 9)
    const base = { hostId: 'panaderia', uid: 'member-1', seed: 'ODSFzsGM91:home', business: PANADERIA, sectionNames: ['Hero con pan fresco'], jobId: 'ODSFzsGM91' }

    const before = fakes({ 'con pan dulce': CON_PAN_DULCE_HERO })
    const [was] = (await aiLayoutStockPhotoSource(base, { provider: () => before.provider, ingest: () => before.ingest })?.([slot])) ?? []
    expect(was).toBeTruthy()
    expect(before.asked[0]).toBe('con pan dulce')

    aiStockForgetJobPhotos()
    const after = fakes({ 'con pan dulce': CON_PAN_DULCE_HERO })
    const words = aiStockPhotoWordsOf({ plan: { language: 'es', photoWords: PANADERIA_WORDS } })
    const [now] = (await aiLayoutStockPhotoSource({ ...base, ...words }, { provider: () => after.provider, ingest: () => after.ingest })?.([slot])) ?? []
    expect(after.asked).not.toContain('con pan dulce')
    // By the words' subject, which they lead with (AGL-3769).
    expect(after.asked[0]).toBe('bakery')
    // Nothing recorded answers the English searches, so the starter photos fill it: never the river.
    expect(RIO_DULCE).not.toContain(idOf(now?.src))
  })

  it('asks a gallery slot of a Spanish site no search in Spanish', async () => {
    const { provider, ingest, asked } = fakes({})
    const source = aiLayoutStockPhotoSource(
      { hostId: 'panaderia', uid: 'member-1', seed: 'ODSFzsGM91:home', business: PANADERIA, language: 'es', photoWords: PANADERIA_WORDS, sectionNames: ['Galería de la panadería'] },
      { provider: () => provider, ingest: () => ingest },
    )
    await source?.([{ imageId: 'g0', frameId: null, iconId: null, alt: 'Mesa de la panadería con pan de yema y pan dulce surtido', aspect: 1, sectionIndex: 0, role: 'gallery' }])
    expect(asked.length).toBeGreaterThan(0)
    for (const query of asked) expect(query).not.toMatch(/panader|mesa|yema|dulce|surtido/)
  })

  it('keeps an English site, or one whose plan gave no English words, searched by its business type', () => {
    expect(aiStockPhotoWordsOf({ plan: { language: 'es' } })).toEqual({ language: 'es' })
    expect(aiStockPhotoWordsOf({ plan: null })).toEqual({})
  })
})

describe('a hero is OF the site’s world, by its first tag (AGL-3760, Copper Fern Candle Co)', () => {
  it('took the latte because "candle" was its fifth tag; its first is "coffee"', () => {
    const latte = byId(CANDLE_SHOP_TALL_HERO, LATTE)
    expect(heroScore(latte, COPPER_FERN, false)).toBeGreaterThan(0)
    expect(heroScore(latte, COPPER_FERN, true)).toBe(0)
  })

  it('keeps a hero whose first tag is a candle', () => {
    for (const id of ['5850280', '6668364', '4220874', '397965']) expect(heroScore(byId(CANDLE_SHOP_TALL_HERO, id), COPPER_FERN, true)).toBeGreaterThan(0)
    // A reading nook whose first tag is the camera is not a candle shop's hero.
    expect(heroScore(byId(CANDLE_SHOP_TALL_HERO, '4597415'), COPPER_FERN, true)).toBe(0)
  })

  it('fills the tall hero with a candle once the start’s other photos are spoken for, never the latte', async () => {
    // What the start's other slots had already placed from this answer.
    const placed = ['4597415', '5850280', '6942931', '4870097', '1584711', '6668364', '4220874']
    const avoid = placed.map((id) => stockPhotoSourceKey(byId(CANDLE_SHOP_TALL_HERO, id)))
    const { provider, ingest, asked } = fakes({ 'candle shop': CANDLE_SHOP_TALL_HERO })
    const source = aiLayoutStockPhotoSource(
      { hostId: 'copper-fern', uid: 'member-1', seed: 'UoGN1DHzur:home', business: COPPER_FERN, sectionNames: ['Hero'], jobId: 'UoGN1DHzur', avoid },
      { provider: () => provider, ingest: () => ingest },
    )
    const [found] = (await source?.([hero('A Hand-Poured Soy Candle in a glass jar, lit, on a wooden shelf beside a fern', 0.67)])) ?? []
    expect(asked[0]).toBe('candle shop')
    const id = idOf(found?.src)
    expect(id).not.toBe(LATTE)
    expect(placed).not.toContain(id)
    expect(byId(CANDLE_SHOP_TALL_HERO, id)?.tags[0]).toMatch(/candle/)
  })
})
