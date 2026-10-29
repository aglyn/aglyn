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
import {
  AI_LAYOUT_STARTER_PHOTOS,
  aiLayoutPictureRole,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import type { AiJob } from '../model/ai-jobs.types'
import { aiSiteDatasetRecordPhotos, aiSiteDatasetRecordsFromOwn } from './ai-job-site-datasets'
import {
  aiLayoutStockPhotoSource,
  aiStockCraftSearches,
  aiStockForeignStreet,
  aiStockForgetJobPhotos,
  aiStockJudgementFor,
  aiStockPhotoWordsOf,
  aiStockProductSearches,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  aiStockThingOfItsOwn,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { aiSiteListPhotos } from './ai-site-late-photos'
import { AGL4092_1029_ANSWERS, AGL4092_1029_HITS, aiAgl40921029AnswerKey } from './fixtures/ai-stock-photo-agl4092-1029-recordings'

/*
 * Pit Row Tacos, started afresh on beta.291 for the 2026-10-29 live check
 * (AGL-4092): a taco trailer at motocross races near Buda, Texas. Replayed
 * from what production's search cache held for every search it sent
 * (fixtures/ai-stock-photo-agl4092-1029-recordings.ts):
 *
 * - its home gallery, "The trailer and the food in pictures", showed a food
 *   truck under the Chicago skyscrapers ("The trailer at the track"), a man
 *   with a cart in the rain ("The crew at work", tagged "street food") and a
 *   woman with a bagel cart in Antalya ("Families and fans", tagged "street
 *   food" in its page address and "antalya, turkey");
 * - its menu's "Bottled Water" searched "taco water", then the broad
 *   "tacos", and took tomatoes beside a bowl of salsa, tagged "salsa".
 *
 * The page's pictures' own words were replaced by their photos' (the stored
 * alt texts describe the photos), so each cell's words here are its caption;
 * every search the replay sends on the code that built the site was in
 * production's cache, so production sent the same. Through core's seams
 * only, no network, no model.
 */

const INPUTS = {
  businessType: 'Taco food trailer: street and breakfast tacos at motocross races, events and around town; takes catering requests',
  audience: 'Hungry riders, families and fans at Texas motocross races, plus locals and event planners around Buda',
  siteKind: 'restaurant',
  businessName: 'Pit Row Tacos',
}
const PLAN = { language: 'en' }
const SITE = { business: INPUTS.businessType, ...aiStockPhotoWordsOf({ plan: PLAN as never, inputs: INPUTS }) }
const HOST = 'pit-row-1029'

const CHICAGO_FOOD_TRUCK = '2375246'
const CART_IN_THE_RAIN = '5524488'
const BAGEL_CART_ANTALYA = '7038572'
const ICE_CREAM_VAN = '1662327'
const TOMATOES_SALSA = '5372165'

/** A hit's first tags are of the taco trailer's own world, its truck among them. */
const TACO_LEAD = /\b(?:tacos?|taqueria|tortillas?|salsa|mexican|food truck|taco truck|burritos?|quesadillas?|nachos|guacamole)\b/
/** What a photo of bottled water names. */
const WATER = /\b(?:bottled water|water bottles?|bottles? of water|mineral water|drinking water|sparkling water)\b/

const byId = (id: string) => AGL4092_1029_HITS.get(id) as StockPhoto
const idOf = (src: string | undefined | null) => src?.split('/').pop() ?? ''
const firstTags = (id: string) => byId(id).tags.slice(0, 3).join(', ')

function fakes(answer: (key: string) => readonly StockPhoto[] | undefined = (key) => AGL4092_1029_ANSWERS[key]) {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: [...(answer(aiAgl40921029AnswerKey(request)) ?? [])], cached: true }
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
      const src = `media:${HOST}/${id}`
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

const HOME = [
  'Hero: race-day tacos, made fresh on the line',
  'Our story: a trailer born at the track',
  'Menu highlights',
  'The trailer and the food in pictures',
  'How catering works',
  'Where to find us',
  'Call to action: book catering or find the trailer',
]
const GALLERY = 3

const picture = (alt: string, sectionIndex: number, aspect: number): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex,
  role: aiLayoutPictureRole({ sectionIndex, sectionName: HOME[sectionIndex] ?? '', alt }),
})

/** The home page's pictures, each cell of the gallery its caption and its frame's shape as production searched it. */
const HOME_SLOTS = [
  picture('Race-day tacos made fresh at the trailer window', 0, 16 / 9),
  picture('The taco trailer cooking at the track', 1, 4 / 3),
  picture('The trailer at the track', GALLERY, 4 / 3),
  picture('Breakfast tacos', GALLERY, 3 / 4),
  picture('Street tacos', GALLERY, 3 / 4),
  picture('Chips and Salsa', GALLERY, 4 / 3),
  picture('The crew at work', GALLERY, 4 / 3),
  picture('Families and fans', GALLERY, 3 / 4),
]
const TRAILER = HOME_SLOTS[2] as AiLayoutPictureSlot
const CREW = HOME_SLOTS[6] as AiLayoutPictureSlot
const FAMILIES = HOME_SLOTS[7] as AiLayoutPictureSlot

/** A menu record's cover, as the site step draws it (`aiSiteDatasetRecordPhotos`). */
const record = (name: string, category: string): AiLayoutPictureSlot => ({
  imageId: `record-${name}`,
  frameId: null,
  iconId: null,
  alt: name,
  aspect: 4 / 3,
  sectionIndex: 0,
  role: 'gallery',
  standIn: true,
  record: { category },
})

/** The menu as production wrote it, in its order. */
const MENU: ReadonlyArray<readonly [string, string]> = [
  ['Bacon, Egg and Cheese Breakfast Taco', 'Breakfast tacos'],
  ['Potato and Egg Breakfast Taco', 'Breakfast tacos'],
  ['Chorizo and Egg Breakfast Taco', 'Breakfast tacos'],
  ['Carne Asada Street Taco', 'Street tacos'],
  ['Al Pastor Street Taco', 'Street tacos'],
  ['Chicken Street Taco', 'Street tacos'],
  ['Chips and Salsa', 'Sides'],
  ['Bottled Water', 'Drinks'],
]

/** The dataset unit's job: the list's own id, the site job its origin. */
const menuJob = {
  $id: 'zQ3EOPeK7f',
  hostId: HOST,
  createdBy: 'member-1',
  brief: 'A 5-page website for a taco food trailer.',
  inputs: { ...INPUTS, originJobId: 'IRsWT6HtMi' },
  plan: PLAN,
} as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

/** Every search a slot tries before any wider world, as the source builds it, each with its judgement. */
function searchesOf(terms: AiStockSiteTerms, slot: AiLayoutPictureSlot, sectionName: string) {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  return [
    ...aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName),
    ...aiStockCraftSearches(slot, terms, subject),
  ].map((search) => ({ search, judgement: aiStockJudgementFor(slot, search, subject, terms, sectionName) }))
}

beforeEach(() => aiStockForgetJobPhotos())

describe('Pit Row Tacos home gallery (AGL-4092, 2026-10-29)', () => {
  const terms = aiStockSourceTerms(SITE)
  const takes = (id: string, slot: AiLayoutPictureSlot) =>
    searchesOf(terms, slot, HOME[slot.sectionIndex] ?? '').some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)

  it('replays the home page: no Chicago street, no cart in the rain, no bagel cart in Antalya', async () => {
    const deps = fakes()
    const photos =
      (await aiLayoutStockPhotoSource(
        { hostId: HOST, uid: 'member-1', seed: 'IRsWT6HtMi:Kw2oaynSte', ...SITE, sectionNames: HOME, jobId: 'IRsWT6HtMi' },
        { provider: () => deps.provider, ingest: () => deps.ingest },
      )?.(HOME_SLOTS)) ?? []
    const ids = photos.map((photo) => idOf(photo?.src))
    for (const id of [CHICAGO_FOOD_TRUCK, CART_IN_THE_RAIN, BAGEL_CART_ANTALYA]) expect(ids).not.toContain(id)
    // Every gallery cell is a photo OF the trailer's world, its food or its truck, or none.
    for (const id of ids.slice(2).filter(Boolean)) {
      expect([id, firstTags(id)]).toEqual([id, expect.stringMatching(TACO_LEAD)])
      expect(aiStockForeignStreet(byId(id), [])).toBe(false)
    }
  })

  it('turns each of them down under every search its cell sends', () => {
    expect(takes(CHICAGO_FOOD_TRUCK, TRAILER)).toBe(false)
    expect(takes(CART_IN_THE_RAIN, CREW)).toBe(false)
    expect(takes(BAGEL_CART_ANTALYA, FAMILIES)).toBe(false)
    // An ice cream van tagged "food truck" is another trailer's.
    expect(takes(ICE_CREAM_VAN, TRAILER)).toBe(false)
    // A taco truck still is the trailer's.
    expect(takes('558254', TRAILER)).toBe(true)
  })

  it('reads a street in another city or country from the tags, whatever the caption', () => {
    expect(aiStockForeignStreet(byId(CHICAGO_FOOD_TRUCK), [])).toBe(true)
    expect(aiStockForeignStreet(byId(BAGEL_CART_ANTALYA), [])).toBe(true)
    // Tacos tagged "mexico" are a dish, not a street.
    expect(byId('4828272').tags).toEqual(expect.arrayContaining(['mexico']))
    expect(aiStockForeignStreet(byId('4828272'), [])).toBe(false)
    // A city the site's own words name is its own.
    const chicagoCart = { tags: ['food truck', 'chicago', 'street', 'hot dog'] }
    expect(aiStockForeignStreet(chicagoCart, ['chicago', 'hot', 'dog', 'stand'])).toBe(false)
    expect(aiStockForeignStreet(chicagoCart, [])).toBe(true)
  })

  it('reads "street food" as the trailer’s world only beside its own food or its truck', () => {
    expect(terms.lead).not.toContain('street food')
    expect(terms.lead).toEqual(expect.arrayContaining(['taco', 'food truck', 'taco truck']))
    // Still searched: "Around town" asks for its customers out where it is.
    expect(terms.out).toContain('street food customers')
  })
})

describe('Pit Row Tacos "Bottled Water" (AGL-4092, 2026-10-29)', () => {
  const terms = aiStockSourceTerms(SITE)
  const water = record('Bottled Water', 'Drinks')

  it('replays the menu: Bottled Water is a bottle of water, never tomatoes or a taco, and the tacos keep theirs', async () => {
    const deps = fakes()
    const photos = await aiSiteDatasetRecordPhotos({
      job: menuJob,
      name: 'Menu items',
      names: MENU.map(([name]) => name),
      categories: MENU.map(([, category]) => category),
      pictures: 'things',
      stockPhotos: (input, options) => aiLayoutStockPhotoSource(input, { ...options, provider: () => deps.provider, ingest: () => deps.ingest }),
    })
    const bottled = idOf(photos[7]?.placed)
    expect(bottled).not.toBe(TOMATOES_SALSA)
    expect(byId(bottled).tags.slice(0, 3).join(', ')).toMatch(WATER)
    expect(photos[7]?.itsOwn).toBe(true)
    expect(deps.asked).toContain('bottled water')
    expect(deps.asked).not.toContain('taco water')
    expect(deps.asked).not.toContain('taco bottled water')
    // The tacos and the chips keep photos of their own world, as production's did.
    for (const photo of photos.slice(0, 6)) expect(firstTags(idOf(photo.placed))).toMatch(TACO_LEAD)
    expect(firstTags(idOf(photos[6]?.placed))).toMatch(/\b(?:tortilla chips?|chips and salsa|nachos)\b/)
    // A taco is the trailer's own; its chips, like its water, are things of their own.
    for (const photo of photos.slice(0, 6)) expect(photo.itsOwn).toBeUndefined()
    expect(photos[6]?.itsOwn).toBe(true)
  })

  it('takes no photo of the trailer’s world under any of its searches', () => {
    const searches = searchesOf(terms, water, 'Menu items')
    expect(searches.map(({ search }) => search.query)).toEqual(['bottled water', 'water bottle'])
    for (const hit of [...(AGL4092_1029_ANSWERS['tacos|horizontal|900|'] ?? []), ...(AGL4092_1029_ANSWERS['taco|horizontal|900|'] ?? [])])
      expect([hit.id, searches.some(({ judgement }) => aiStockRelevance(hit, judgement) > 0)]).toEqual([hit.id, false])
  })

  it('takes a neutral starter when the library has no bottle of water, never another record’s taco', async () => {
    const deps = fakes((key) => (key.startsWith('bottled water|') || key.startsWith('water bottle|') ? [] : AGL4092_1029_ANSWERS[key]))
    const photos = await aiSiteDatasetRecordPhotos({
      job: menuJob,
      name: 'Menu items',
      names: MENU.map(([name]) => name),
      categories: MENU.map(([, category]) => category),
      pictures: 'things',
      stockPhotos: (input, options) => aiLayoutStockPhotoSource(input, { ...options, provider: () => deps.provider, ingest: () => deps.ingest }),
    })
    const neutral = new Set<string>([AI_LAYOUT_STARTER_PHOTOS.hero.src, AI_LAYOUT_STARTER_PHOTOS.desk.src])
    expect(photos[7]?.placed).toBeNull()
    expect(neutral.has(String(photos[7]?.src))).toBe(true)
    expect(photos[7]?.itsOwn).toBe(true)
  })

  it('keeps none of the list’s photos, nor the job’s in the late photo pass', () => {
    const taco: AiLayoutPicturePhoto = { src: `media:${HOST}/4828272`, width: 1280, height: 853, alt: 'Tacos' }
    const chips: AiLayoutPicturePhoto = { src: `media:${HOST}/58709`, width: 1280, height: 853, alt: 'A tortilla chip' }
    expect(
      aiSiteDatasetRecordsFromOwn(
        [
          { name: 'Chips and Salsa', category: 'Sides' },
          { name: 'Bottled Water', category: 'Drinks', itsOwn: true },
          { name: 'Chicken Street Taco', category: 'Street tacos' },
        ],
        [chips, null, null],
        'seed',
      ).map((photo) => idOf(photo?.src)),
    ).toEqual(['58709', '', '58709'])
    const late = aiSiteListPhotos(
      {
        dataset: 'menu',
        imageField: 'image',
        records: [
          { name: 'Chicken Street Taco', category: 'Street tacos', value: '/api/media/cdn/x/1', photo: taco },
          { name: 'Bottled Water', category: 'Drinks', value: AI_LAYOUT_STARTER_PHOTOS.hero.src, itsOwn: true },
        ],
      },
      new Map(),
      [chips],
      'seed',
    )
    expect(late[1]).toBeNull()
  })

  it('is a thing of its own, as a soda and an agua fresca are, and a taco is not', () => {
    expect(aiStockThingOfItsOwn('bottled water', terms)).toBe(true)
    expect(aiStockThingOfItsOwn('fountain drink', terms)).toBe(true)
    expect(aiStockThingOfItsOwn('agua fresca', terms)).toBe(true)
    expect(aiStockThingOfItsOwn('egg breakfast taco', terms)).toBe(false)
    // A soap shop's soap bar is still its soap.
    expect(aiStockThingOfItsOwn('lavender soap bar', aiStockSiteTerms('An online shop for handmade cold-process soap'))).toBe(false)
  })

  it('searches a "Bottled Water" product by its own words, never the trailer’s broad photos', () => {
    const product: AiLayoutPictureSlot = { ...record('Bottled Water', 'Drinks'), record: undefined, product: { subjects: ['Bottled Water'] } }
    const searches = aiStockProductSearches(product, terms.craft, terms.domain, { broad: terms.broad, core: terms.core })
    expect(searches.map((search) => search.query)).toEqual(expect.arrayContaining(['bottled water', 'water bottle']))
    for (const query of terms.broad) expect(searches.map((search) => search.query)).not.toContain(query)
    expect(aiStockCraftSearches(product, terms, 'bottled water')).toEqual([])
    expect(searches.some((search) => aiStockRelevance(byId(TOMATOES_SALSA), aiStockJudgementFor(product, search, 'bottled water', terms)) > 0)).toBe(false)
  })
})
