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
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockPhotoWordsOf,
  aiStockPhotoWordsSubject,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSourceTerms,
} from './ai-layout-stock-photos'
import { BAKERY, PAN_DULCE_CONCHAS } from './fixtures/ai-stock-photo-agl3769-recordings'

/*
 * Panaderia La Espiga Dorada (job Eynu8Iag2Z, beta.247, AGL-3769), replayed
 * from what Pixabay answered its start: its plan's photo words were "bakery
 * pan dulce conchas", and its full-bleed home hero, behind the headline, took
 * purple ceanothus flowers. Through core's seams only: a fake provider
 * answering each search with its recorded answer whatever the shape asked (a
 * search the start never sent answers nothing), and a fake library. No
 * network, no model.
 */

const BRIEF =
  'Una panadería familiar de San Antonio con pan dulce, conchas y pasteles de tres leches al estilo de Oaxaca'

/** What the plan answered, as production holds it. */
const PHOTO_WORDS = 'bakery pan dulce conchas'

/** The ceanothus the hero took, and the other "concha" photos the start placed. */
const CEANOTHUS = '4965870'
const CONCHA_PHOTOS = [CEANOTHUS, '4955734', '109343']

/** The hero, as the home page's first section laid it out: a full-bleed background behind the headline. */
const HERO: AiLayoutPictureSlot = {
  imageId: 'uuEyAlnXuz',
  frameId: null,
  iconId: null,
  alt: 'Canasta de conchas y pan dulce recién horneado sobre el mostrador de la panaderí',
  aspect: 1280 / 853,
  sectionIndex: 0,
  role: 'hero',
}

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

const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''
const byId = (hits: readonly StockPhoto[], id: string) => hits.find((hit) => hit.id === id) as StockPhoto

const source = { hostId: 'rTonZdtAGl', uid: 'member-1', seed: 'Eynu8Iag2Z:home', business: BRIEF, sectionNames: ['Hero con pan fresco'], jobId: 'Eynu8Iag2Z' }
const words = aiStockPhotoWordsOf({ plan: { language: 'es', photoWords: PHOTO_WORDS } })

beforeEach(() => aiStockForgetJobPhotos())

describe('a site’s photo words are read subject first (AGL-3769, Panaderia La Espiga Dorada)', () => {
  it('read "bakery pan dulce conchas" head last: the business "pan dulce conchas", the craft "concha"', () => {
    const terms = aiStockSiteTerms(PHOTO_WORDS)
    expect(terms.business).toBe('pan dulce conchas')
    expect(terms.craft).toBe('concha')
    expect(aiStockSearchesFor(HERO, terms, '')[0]?.query).toBe('pan dulce conchas')
    // And held the hero to "concha" in its first tag, which "ceanothus concha" names.
    const ceanothus = byId(PAN_DULCE_CONCHAS, CEANOTHUS)
    expect(ceanothus.tags[0]).toBe('ceanothus concha')
    expect(aiStockRelevance(ceanothus, { subject: '', domain: terms.domain, category: terms.core, named: terms.named, rivals: terms.rivals, first: true })).toBeGreaterThan(0)
  })

  it('takes the subject the words lead with, and the place or person that names it', () => {
    expect(aiStockPhotoWordsSubject(PHOTO_WORDS)).toBe('bakery')
    expect(aiStockPhotoWordsSubject('bakery bread pastries')).toBe('bakery')
    expect(aiStockPhotoWordsSubject('candle shop soy candles')).toBe('candle shop')
    expect(aiStockPhotoWordsSubject('ceramic artist stoneware bowls')).toBe('ceramic artist')
    expect(aiStockPhotoWordsSubject('fresh bread pastries')).toBe('bread')
    expect(aiStockPhotoWordsSubject('')).toBe('')
  })

  it('searches every slot by the bakery, never "pan dulce conchas", and turns every concha photo down as its hero', () => {
    const terms = aiStockSourceTerms({ business: BRIEF, ...words })
    expect(terms.business).toBe('bakery')
    expect(terms.domain).not.toContain('concha')
    const searches = aiStockSearchesFor(HERO, terms, '')
    for (const search of searches) expect(search.query).not.toMatch(/concha|dulce|\bpan\b/)
    expect(searches[0]).toMatchObject({ query: 'bakery', first: true })
    for (const id of CONCHA_PHOTOS)
      expect(aiStockRelevance(byId(PAN_DULCE_CONCHAS, id), { subject: '', domain: terms.domain, category: terms.core, named: terms.named, rivals: terms.rivals, first: true })).toBe(0)
  })

  it('placed the ceanothus as the full-bleed hero; with the subject read first it places a bakery photo', async () => {
    const recorded = { 'pan dulce conchas': PAN_DULCE_CONCHAS, bakery: BAKERY }

    // As production read the words, head last: the hero searched "pan dulce conchas" and took the flowers.
    const before = fakes(recorded)
    const [was] =
      (await aiLayoutStockPhotoSource({ ...source, business: PHOTO_WORDS }, { provider: () => before.provider, ingest: () => before.ingest })?.([HERO])) ?? []
    expect(before.asked[0]).toBe('pan dulce conchas')
    // Which of its accepted hits it placed turns by the seed; production's was the ceanothus.
    expect(PAN_DULCE_CONCHAS.map((hit) => hit.id)).toContain(idOf(was?.src))

    aiStockForgetJobPhotos()

    const after = fakes(recorded)
    const [placed] =
      (await aiLayoutStockPhotoSource({ ...source, ...words }, { provider: () => after.provider, ingest: () => after.ingest })?.([HERO])) ?? []
    expect(after.asked).not.toContain('pan dulce conchas')
    expect(after.asked[0]).toBe('bakery')
    const id = idOf(placed?.src)
    expect(id).not.toBe('')
    expect(CONCHA_PHOTOS).not.toContain(id)
    expect(byId(BAKERY, id)?.tags[0]).toMatch(/bakery|bread|pastr|cake|baker/)
  })

  it('keeps an English site searched by its business type, whatever its photo words', () => {
    expect(aiStockSourceTerms({ business: 'A family bakery', language: 'en', photoWords: 'pan dulce' }).business).toBe(
      aiStockSiteTerms('A family bakery').business,
    )
  })
})

/*
 * Panaderia El Trigal (job iGmqrEgyW4, beta.249, AGL-3771): its plan gave no
 * photo words, so every slot searched its Spanish business type, "con pan
 * dulce", and its story section placed the Río Dulce at dusk. A site in
 * another language whose plan gave none is searched by its kind of site.
 */
describe('a site in another language with no photo words (AGL-3771)', () => {
  it('reads the English name of the kind of site the person picked', () => {
    expect(aiStockPhotoWordsOf({ plan: { language: 'es' }, inputs: { siteKind: 'restaurant', businessType: BRIEF } })).toEqual({
      language: 'es',
      kindWords: 'restaurant cafe',
    })
  })

  it('is searched by its kind of site, never its business type in its own language', () => {
    const terms = aiStockSourceTerms({ business: BRIEF, language: 'es', kindWords: 'restaurant cafe' })
    expect(terms).toEqual(aiStockSiteTerms('restaurant cafe'))
    expect(JSON.stringify(terms)).not.toContain('dulce')
  })

  it('keeps its plan photo words first, and an English site its business type', () => {
    expect(aiStockSourceTerms({ business: BRIEF, language: 'es', photoWords: PHOTO_WORDS, kindWords: 'restaurant cafe' })).toEqual(
      aiStockSiteTerms('bakery'),
    )
    expect(aiStockSourceTerms({ business: 'A family bakery', language: 'en', kindWords: 'restaurant cafe' })).toEqual(
      aiStockSiteTerms('A family bakery'),
    )
  })
})
