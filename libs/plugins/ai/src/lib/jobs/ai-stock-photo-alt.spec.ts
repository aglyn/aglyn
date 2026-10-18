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
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiResolveLayoutPictures, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiLayoutStockPhotoSource, aiStockForgetJobPhotos, aiStockPhotoAlt, aiStockTagsAlt } from './ai-layout-stock-photos'
import { BRIGHTPATH_PLACED, IRONWOOD_PLACED, SILVER_FIR_PLACED } from './fixtures/ai-stock-photo-agl3856-people-recordings'

/*
 * The beta.253 Panadería La Concha Dorada start (2026-10-15, job eg4maZMGtN,
 * site panaderia-la-concha-dorada): every photo its pages placed came from
 * one search, "bakery", and kept the alt text the model wrote before any
 * photo was found. Its home hero, a round cake dusted "HOME MADE" on a cloth
 * (Pixabay 3946227), read "Conchas recién horneadas sobre una charola en el
 * mostrador de la panadería". The hits below are what production's
 * `stockPhotoSearches` cache held for that search, read back, never searched
 * again: ids, sizes, page slugs and tags are Pixabay's own, in its order; the
 * contributor is left out. Through core's seams only: no network, no model.
 */

const hit = (id: number, width: number, height: number, slug: string, tags: string): StockPhoto => ({
  provider: 'pixabay',
  id: String(id),
  width,
  height,
  pageUrl: `https://pixabay.com/photos/${slug}/`,
  photographer: 'A Pixabay contributor',
  tags: tags.split(', '),
})

/** `bakery`, as the Concha Dorada pages searched it. */
const BAKERY: StockPhoto[] = [
  hit(6245204, 1280, 853, 'bread-basket-food-breakfast-snack-6245204', 'bread, basket, food, breakfast, snack, baked, delicious, bakery, closeup'),
  hit(3946227, 1280, 853, 'cake-homemade-dessert-roasted-3946227', 'cake, homemade, dessert, roasted, bakery, tasty, sweetness, party, cake, cake, cake, cake, cake'),
  hit(8503298, 1280, 853, 'bread-loaf-chef-cook-food-bakery-8503298', 'bread, loaf, chef, cook, food, bakery, bake, baking, bread, bread, bread, bread, bread, chef, bakery'),
  hit(
    2338813,
    1280,
    853,
    'birthday-cake-candles-bithday-cake-2338813',
    'cake, candles, bithday cake, birthday candles, beautiful flowers, flower background, dessert, pastry, birthday celebration, happy birthday, party, birthday party, nature, celebration, flower wallpaper, flowers',
  ),
  hit(1281053, 1280, 857, 'bread-baked-food-freshly-baked-1281053', 'bread, baked, food, freshly baked, artisan bread, dough, homemade, homemade bread, carbohydrates, eat, food photography, bread, bread, bread, bread, bread'),
]
const CAKE = BAKERY[1] as StockPhoto

/** The home hero's words, as the page step stored them. */
const CONCHAS = 'Conchas recién horneadas sobre una charola en el mostrador de la panadería'

const slot = (alt: string, role: AiLayoutPictureSlot['role'] = 'hero'): AiLayoutPictureSlot => ({
  imageId: 'img',
  frameId: 'frame',
  iconId: null,
  alt,
  aspect: 16 / 9,
  sectionIndex: role === 'hero' ? 0 : 1,
  role,
})

function fakes() {
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    // A search the start never sent answers nothing.
    search: async (request) => ({ photos: request.query === 'bakery' ? BAKERY : [], cached: true }),
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
      stored.push(request)
      const id = String(request.stockPhoto?.id)
      return { ok: true, mediaId: id, src: `media:site/${id}`, width: 1280, height: 853 }
    },
    findStockPhoto: async () => null,
  }
  return { provider, ingest, stored }
}

/** A stored page holding one empty hero slot, as the compiler writes it. */
function heroPage(alt: string): NodesMap {
  return {
    root: { componentId: 'canvas', nodes: ['hero'] },
    hero: { componentId: 'muiBox', nodes: ['frame'] },
    frame: { componentId: 'muiBox', sx: { aspectRatio: '16 / 9' }, nodes: ['icon', 'img'] },
    icon: { componentId: 'icon', props: {} },
    img: { componentId: 'image', props: { alt } },
  } as unknown as NodesMap
}

const SOURCE = {
  hostId: 'ltM_YVi33K',
  uid: 'member',
  seed: 'eg4maZMGtN:5ZdrA-eIND',
  sectionNames: ['Hero'],
}

beforeEach(() => aiStockForgetJobPhotos())

describe("a stock photo's alt text says what the photo shows (AGL-3805)", () => {
  it("gives the Spanish hero the platform's own words for an illustrative photo, never the conchas it does not show", async () => {
    const { provider, ingest, stored } = fakes()
    const nodes = await aiResolveLayoutPictures(heroPage(CONCHAS), {
      rootId: 'root',
      sectionIds: ['hero'],
      sectionNames: ['Hero'],
      seed: SOURCE.seed,
      source: aiLayoutStockPhotoSource(
        {
          ...SOURCE,
          business: 'Una panadería familiar de San Antonio con pan dulce, conchas y pasteles de tres leches al estilo de Oaxaca',
          language: 'es',
          photoWords: 'bakery pan dulce conchas',
        },
        { provider: () => provider, ingest: () => ingest },
      ),
    })
    const image = (nodes as unknown as Record<string, { props: Record<string, unknown> }>)['img']
    expect(image?.props['src']).toMatch(/^media:site\/\d+$/)
    expect(image?.props['alt']).toBe('Foto ilustrativa')
    // The site's library keeps the same words with the photo.
    expect(stored.map((request) => request.alt)).toEqual(['Foto ilustrativa'])
  })

  it("describes an English site's hero by the photo's own tags when its words name something else", async () => {
    const { provider, ingest, stored } = fakes()
    const nodes = await aiResolveLayoutPictures(heroPage('Fresh conchas on a tray at the bakery counter'), {
      rootId: 'root',
      sectionIds: ['hero'],
      sectionNames: ['Hero'],
      seed: SOURCE.seed,
      source: aiLayoutStockPhotoSource({ ...SOURCE, business: 'bakery' }, { provider: () => provider, ingest: () => ingest }),
    })
    const image = (nodes as unknown as Record<string, { props: Record<string, unknown> }>)['img']
    const placed = BAKERY.find((photo) => image?.props['src'] === `media:site/${photo.id}`)
    expect(placed).toBeDefined()
    // An English phrase of what its first tags name, never the library's tag list (AGL-3856).
    expect(image?.props['alt']).toBe(aiStockTagsAlt(placed?.tags ?? []))
    expect(image?.props['alt']).not.toBe((placed?.tags ?? []).slice(0, 3).join(', '))
    expect(stored[0]?.alt).toBe(image?.props['alt'])
  })

  it("keeps an English slot's own words when they name the thing the photo is of", () => {
    expect(aiStockPhotoAlt(CAKE, slot('A homemade cake dusted with powdered sugar on a linen cloth'))).toBeNull()
    expect(aiStockPhotoAlt(BAKERY[2] as StockPhoto, slot('A fresh loaf on the counter', 'gallery'))).toBeNull()
    // A product is held to its own name as well.
    expect(aiStockPhotoAlt(CAKE, { ...slot('Our signature', 'gallery'), product: { subjects: ['Tres leches cake'] } })).toBeNull()
  })

  it("describes the photo by its first tags when the slot's words do not, and by the library's own description where it writes one", () => {
    expect(aiStockPhotoAlt(CAKE, slot('Fresh conchas on a tray at the bakery counter'))).toBe('A cake in a bakery')
    expect(aiStockPhotoAlt(BAKERY[3] as StockPhoto, slot('The family kneading pan dulce in the kitchen', 'about'))).toBe(
      'A bithday cake and birthday candles',
    )
    const pexels = { ...CAKE, alt: 'Round cake dusted with powdered sugar on a white cloth' }
    expect(aiStockPhotoAlt(pexels, slot('Fresh conchas on a tray'))).toBe('Round cake dusted with powdered sugar on a white cloth')
    expect(aiStockPhotoAlt({ ...CAKE, tags: [] }, slot('Fresh conchas on a tray'))).toBe('Fresh conchas on a tray')
  })

  it("never keeps a slot's words on a site in another language: the libraries' words are English, so its own phrase stands in", () => {
    expect(aiStockPhotoAlt(CAKE, slot(CONCHAS), { language: 'es' })).toBe('Foto ilustrativa')
    expect(aiStockPhotoAlt(CAKE, slot('Pastel casero espolvoreado con azúcar'), { language: 'es-MX' })).toBe('Foto ilustrativa')
    expect(aiStockPhotoAlt(CAKE, slot('Gâteau maison'), { language: 'fr' })).toBe('Photo d’illustration')
    expect(aiStockPhotoAlt(CAKE, slot('A homemade cake'), { language: 'en-US' })).toBeNull()
  })
})

describe('a stock photo described by a phrase, never a tag list wearing articles (AGL-3856, beta.262)', () => {
  // Pixabay's own tags for the photos placed on the Whitmore Lane Family Law and Synchronicity Gym starts.
  const tagged = (id: number, slug: string, tags: string) => hit(id, 1280, 853, slug, tags)
  const LAWYER = tagged(7123797, 'lawyer-law-confident-court-7123797', 'lawyer, law, confident, court, lawyer, lawyer, lawyer, lawyer, lawyer')
  const BUSINESSMAN = tagged(6857244, 'man-businessman-lawyer-portrait-6857244', 'man, businessman, lawyer, portrait, black man, poc, bipoc')
  const CHALKBOARD = tagged(
    3700116,
    'board-chalk-feedback-review-study-3700116',
    'board, chalk, feedback, review, study, school, university, training, blackboard, good, smiley, job, business, work, positive, negative, write a review, social, communication, office',
  )
  const SUBWAY = tagged(
    8517089,
    'train-station-subway-metro-8517089',
    'train, station, subway, metro, architecture, cityscape, transport, modern, futuristic, building, steel construction, germany, hamburg',
  )
  const stand = { ...slot('Family law consultation in Columbus', 'gallery'), standIn: true }

  it('says a quality before its thing, and leaves out an idea and a word inside another', () => {
    expect(aiStockTagsAlt(LAWYER.tags)).toBe('A confident lawyer in court')
  })

  it('says one person, a role over a man, and a portrait as a portrait of them', () => {
    expect(aiStockTagsAlt(BUSINESSMAN.tags)).toBe('A portrait of a businessman')
  })

  it('says where a thing is, and no feedback, study or school as a thing', () => {
    expect(aiStockTagsAlt(CHALKBOARD.tags)).toBe('A board at a school')
  })

  it('says where a thing is, not three nouns in a row', () => {
    expect(aiStockTagsAlt(SUBWAY.tags)).toBe('A train at a station')
  })

  it('describes each placed photo the same way, never as a list', () => {
    for (const [photo, said] of [
      [LAWYER, 'A confident lawyer in court'],
      [BUSINESSMAN, 'A portrait of a businessman'],
      [CHALKBOARD, 'A board at a school'],
      [SUBWAY, 'A train at a station'],
    ] as const) {
      const alt = aiStockPhotoAlt(photo, stand)
      expect(alt).toBe(said)
      expect(alt).not.toContain(',')
    }
  })

  it("falls back to the slot's own subject where no tag names a thing, never empty", () => {
    const ideas = tagged(1977987, 'feedback-customer-satisfaction-1977987', 'feedback, customer satisfaction, review, opinion, good, positive')
    expect(aiStockTagsAlt(ideas.tags)).toBeNull()
    expect(aiStockPhotoAlt(ideas, stand)).toBe('Family law consultation in Columbus')
    expect(aiStockPhotoAlt(ideas, { ...stand, alt: '' }, { sectionName: 'consultation call to action' })).toBe('Consultation call to action')
  })
})

describe('a stock photo described by concrete things, each said once (AGL-3856, beta.264)', () => {
  // Every photo the Brightpath Adult Learning Center, Ironwood Barbell Gym and
  // Silver Fir Film and Portrait pages placed, by Pixabay id, with the words
  // production gave it and the words its own tags say now.
  const PLACED = new Map([...BRIGHTPATH_PLACED, ...IRONWOOD_PLACED, ...SILVER_FIR_PLACED].map((photo) => [photo.id, photo]))
  const SAID: ReadonlyArray<[id: string, before: string, after: string]> = [
    ['3293452', 'A kettlebell and fitness', 'A kettlebell in a gym'],
    ['841171', 'A bookwork and a read', 'A woman with a book in a library'],
    ['4126483', 'A book and a read', 'A college student with a book'],
    ['10165350', 'A participation in a classroom', 'Women in a classroom'],
    ['4184870', 'A board and training', 'A board at a school'],
    ['5630022', 'A camera and an analog', 'An analog camera'],
    ['351528', 'A camera and a digital', 'A digital camera'],
    ['4123304', 'A photo-camera and a sony', 'A mirrorless camera'],
    ['6653517', 'An elderly couple and an elderly', 'An elderly couple on a trail'],
    ['950382', 'A spot and headlights', 'Headlights in a studio'],
    ['7942150', 'A human in a forest', 'A photographer in a forest'],
    ['6900381', 'A school at a desk', 'A desk at a school'],
    ['2093744', 'A school in a classroom', 'A classroom'],
    ['1699745', 'A lecture hall in a classroom', 'A classroom'],
    ['3516208', 'A lift in a gym', 'A weight in a gym'],
    ['5730110', 'Weightlifting and a workout', 'An athlete in a gym'],
    ['5584375', 'A camera and a photographer', 'A photographer with a camera'],
    ['8111723', 'A bridge and a camera', 'A photographer with a camera on a bridge'],
    ['3669915', 'An indian wedding and a couple', 'A couple at a wedding'],
    ['1846114', 'A wedding and an aisle', 'An aisle at a wedding'],
    ['7527978', 'A portrait of photo model', 'A portrait of a model'],
    ['7638972', 'A family and a mom', 'A family'],
    ['6553467', 'A graduate and a girl', 'A graduate'],
    ['351977', 'A schoolgirl and a student', 'A schoolgirl'],
    ['951818', 'Studying and exams', 'A room'],
  ]

  it.each(SAID)('describes %s, once "%s", as "%s"', (id, before, after) => {
    const photo = PLACED.get(id) as StockPhoto
    expect(photo).toBeDefined()
    const alt = aiStockTagsAlt(photo.tags ?? [])
    expect(alt).toBe(after)
    expect(alt).not.toBe(before)
  })

  it("never says a word twice, a maker's name, or a doing or an idea as a thing", () => {
    for (const photo of PLACED.values()) {
      const alt = aiStockTagsAlt(photo.tags ?? []) ?? ''
      const content = alt
        .toLowerCase()
        .split(/[^a-z-]+/)
        .filter((word) => word.length > 2 && !['and', 'with', 'the'].includes(word))
      expect(new Set(content).size).toBe(content.length)
      expect(alt).not.toMatch(/\b(?:sony|canon|crossfit|fitness|training|reading|read|participation|analog|digital|elderly|human|spot|photo)$/i)
      // An adjective is said only before its thing: "an analog camera", never "an analog".
      expect(alt).not.toMatch(/\b(?:an?|and) (?:analog|digital|elderly)(?: and| in| on| at|$)/i)
      expect(alt).not.toMatch(/\b(?:an?|and) (?:read|training|fitness|participation|sony|spot|lift|workout)\b/i)
    }
  })
})
