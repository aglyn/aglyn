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
  aiStockCraftSearches,
  aiStockForgetJobPhotos,
  aiStockJudgementFor,
  aiStockObjectWord,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  type AiStockSearch,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { aiAgl4065Judgement } from './fixtures/ai-stock-photo-agl4065-judge'
import { AGL4092_ANSWERS, AGL4092_HITS, AGL4092_PEOPLE_ANSWERS } from './fixtures/ai-stock-photo-agl4092-recordings'

/*
 * Pit Row Tacos of the 2026-10-28 live check (AGL-4092), a taco trailer at
 * motocross races, replayed from what Pixabay answers its searches
 * (fixtures/ai-stock-photo-agl4092-recordings.ts):
 *
 * - "Come hungry" read its object as "hungry" and took a cat at a table,
 *   tagged "hungry" and "hangover breakfast": "breakfast" of "street and
 *   breakfast tacos" vouched for it;
 * - "Around town" read its object as "town" and took a European alley,
 *   tagged "street";
 * - "Race day" found nothing for its "day" and took a chicken salad tagged
 *   "taco bowl" from the broad search "tacos";
 * - the trailer took a tank truck at a rest stop, the "Chips and Salsa"
 *   record crisps and a chocolate chip cookie, and "Fountain Drink" a well.
 *
 * Through core's seams only, no network, no model.
 */

const PIT_ROW = {
  business: 'Taco food trailer: street and breakfast tacos at motocross races, events and around town; takes catering requests',
  audience: 'Hungry riders, families and fans at Texas motocross races, plus locals and event planners around Buda',
  kind: 'restaurant',
  name: 'Pit Row Tacos',
  language: 'en',
}

const CAT = '6898134'
const ALLEY = '7116489'
const TACO_BOWL_SALAD = '7756518'
const TANK_TRUCK = '1388933'
const CRISPS = '9183661'
const COOKIES = '940429'
const WELL = '4978200'

/** A hit's first tags are of the taco trailer's own world. */
const TACO_LEAD = /\b(?:tacos?|taqueria|tortillas?|salsa|mexican|street food|food truck|burritos?|quesadillas?|nachos|guacamole)\b/

const byId = (id: string) => AGL4092_HITS.get(id) as StockPhoto
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: [...((request.people ? AGL4092_PEOPLE_ANSWERS : AGL4092_ANSWERS)[request.query] ?? [])], cached: true }
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

const cell = (alt: string, aspect = 4 / 3, extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex: 1,
  role: 'gallery',
  ...extra,
})

/** A dataset record's cover, as the site step draws it (`aiSiteDatasetRecordPhotos`). */
const record = (name: string): AiLayoutPictureSlot => ({ ...cell(name), sectionIndex: 0, record: {} })

/** Every search a slot tries before any wider world, as the source builds it, each with its judgement. */
function searchesOf(terms: AiStockSiteTerms, slot: AiLayoutPictureSlot, sectionName: string) {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  return [...aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName), ...aiStockCraftSearches(slot, terms)].map(
    (search) => ({ search, judgement: aiStockJudgementFor(slot, search, subject, terms, sectionName) }),
  )
}

const GALLERY = 'The food and the track in pictures'
const SECTIONS = ['Hero: race-day tacos, made fresh on the line', GALLERY]

beforeEach(() => aiStockForgetJobPhotos())

describe('Pit Row Tacos (AGL-4092, 2026-10-28)', () => {
  const terms = aiStockSourceTerms(PIT_ROW)
  const takes = (id: string, slot: AiLayoutPictureSlot, sectionName: string) =>
    searchesOf(terms, slot, sectionName).some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[], seed = 'wSE43g080w:home') =>
    aiLayoutStockPhotoSource(
      { hostId: 'pit-row', uid: 'member-1', seed, ...PIT_ROW, sectionNames, jobId: 'wSE43g080w' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('never shows a cat for "Come hungry", an alley for "Around town" or a taco bowl salad for "Race day"', async () => {
    const deps = fakes()
    const photos = (await source(deps, ['Story intro', 'Call to action: visit or book', GALLERY])?.([
      cell('Come hungry', 16 / 9),
      cell('Around town', 4 / 3, { sectionIndex: 2 }),
      cell('Race day', 4 / 3, { sectionIndex: 2 }),
    ])) ?? []
    const ids = photos.map((photo) => idOf(photo?.src))
    for (const id of [CAT, ALLEY, TACO_BOWL_SALAD]) expect(ids).not.toContain(id)
    // Each is a photo OF the trailer's world, or none.
    for (const id of ids.filter(Boolean)) expect([id, byId(id).tags.slice(0, 3).join(', ')]).toEqual([id, expect.stringMatching(TACO_LEAD)])
    // Under none of each slot's searches, the broad ones last.
    expect(takes(CAT, cell('Come hungry', 16 / 9), 'Call to action: visit or book')).toBe(false)
    expect(takes(ALLEY, cell('Around town'), GALLERY)).toBe(false)
    expect(takes(TACO_BOWL_SALAD, cell('Race day'), GALLERY)).toBe(false)
  })

  it('reads no thing in a feeling, a time or a way of being somewhere', () => {
    expect(aiStockObjectWord(aiStockSubjectWords('Come hungry', ''))).toBe('')
    expect(aiStockObjectWord(aiStockSubjectWords('Around town', ''))).toBe('')
    expect(aiStockObjectWord(aiStockSubjectWords('Race day', ''))).toBe('race')
  })

  it('shows "Around town" as its customers at a food truck, never a European street', async () => {
    const deps = fakes()
    const [photo] = (await source(deps, SECTIONS)?.([cell('Around town')])) ?? []
    expect(deps.asked[0]).toBe('food truck crowd')
    expect(deps.asked).not.toContain('taco around town')
    const placed = byId(idOf(photo?.src))
    expect(placed).toBeDefined()
    expect(placed.tags.join(', ')).toMatch(/\b(?:people|crowd|customers?|queue|line)\b/)
    expect(placed.tags.slice(0, 3).join(', ')).not.toMatch(/\b(?:alley|village|cobblestone)\b/)
    const [first] = searchesOf(terms, cell('Around town'), GALLERY)
    expect(first?.search.query).toBe('food truck crowd')
    expect(first?.search.needs).toEqual(expect.arrayContaining(['people', 'crowd', 'customer', 'food truck']))
    expect(first?.search.refuseLead).toEqual(expect.arrayContaining(['alley', 'village', 'cobblestone', 'old town']))
  })

  it('holds a picture of a thing to the trailer’s own world, never to "street" or "breakfast" of its type', () => {
    // As "Come hungry" was read: its object "hungry", which the cat is tagged with.
    const slot = cell('Hungry riders at the window')
    const [search] = aiStockSearchesFor(slot, terms, 'hungry riders', undefined, GALLERY)
    const hungry = { ...aiAgl4065Judgement(terms, slot, search as AiStockSearch, 'hungry riders'), object: 'hungry', strict: true }
    expect(terms.domain).toEqual(expect.arrayContaining(['street', 'breakfast']))
    expect(aiStockRelevance(byId(CAT), hungry)).toBe(0)
    expect(aiStockRelevance(byId(ALLEY), { ...hungry, object: 'town' })).toBe(0)
    // A photo of tacos named by its object still is one.
    expect(aiStockRelevance(byId('4179895'), { ...hungry, object: 'taco' })).toBeGreaterThan(0)
  })

  it('shows the trailer as a food truck, never a tank truck', async () => {
    const trailer = cell('Our trailer at the track')
    const deps = fakes()
    const [photo] = (await source(deps, ['Contact intro', 'Where to find the trailer'])?.([trailer])) ?? []
    expect(deps.asked).toContain('taco truck')
    expect(idOf(photo?.src)).not.toBe(TANK_TRUCK)
    if (photo?.src) expect(byId(idOf(photo.src)).tags.slice(0, 3).join(', ')).toMatch(TACO_LEAD)
    expect(takes(TANK_TRUCK, trailer, 'Where to find the trailer')).toBe(false)
  })

  it('covers "Chips and Salsa" with tortilla chips and "Fountain Drink" with a soda, never crisps, a cookie or a well', async () => {
    const deps = fakes()
    const [chips, drink] = (await source(deps, ['Menu'], 'wSE43g080w:records')?.([record('Chips and Salsa'), record('Fountain Drink')])) ?? []
    expect(deps.asked).toContain('tortilla chips salsa')
    expect([CRISPS, COOKIES]).not.toContain(idOf(chips?.src))
    expect(idOf(drink?.src)).not.toBe(WELL)
    if (chips?.src) expect(byId(idOf(chips.src)).tags.slice(0, 3).join(', ')).toMatch(/\b(?:nachos|tortilla chips?|chips)\b/)
    if (drink?.src) expect(byId(idOf(drink.src)).tags.join(', ')).toMatch(/\b(?:soda|soft drink|iced tea|agua fresca|lemonade)\b/)
    expect(takes(CRISPS, record('Chips and Salsa'), 'Menu')).toBe(false)
    expect(takes(COOKIES, record('Chips and Salsa'), 'Menu')).toBe(false)
    expect(takes(WELL, record('Fountain Drink'), 'Menu')).toBe(false)
  })
})

describe('Copper Kettle Catering keeps its catering world (AGL-3831, AGL-4065, AGL-4092)', () => {
  it('still reads a caterer as catering, with its own broad searches, and no trade or street of its own', () => {
    const terms = aiStockSiteTerms('Family-run Austin caterer: Texas barbecue and Tex-Mex for weddings, office lunches and parties')
    expect(terms.craft).toBe('caterer')
    expect(terms.broad.slice(0, 2)).toEqual(['caterer', 'catering buffet'])
    expect(terms.making[0]).toBe('chef cooking')
    expect(terms.held).toBeUndefined()
    expect(terms.out).toBeUndefined()
  })
})
