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
import { aiLayoutStockPhotoSource, aiStockForgetJobPhotos, aiStockPhotoAlt } from './ai-layout-stock-photos'

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
    const said = (placed?.tags ?? []).slice(0, 3).join(', ')
    expect(image?.props['alt']).toBe(`${said.charAt(0).toUpperCase()}${said.slice(1)}`)
    expect(stored[0]?.alt).toBe(image?.props['alt'])
  })

  it("keeps an English slot's own words when they name the thing the photo is of", () => {
    expect(aiStockPhotoAlt(CAKE, slot('A homemade cake dusted with powdered sugar on a linen cloth'))).toBeNull()
    expect(aiStockPhotoAlt(BAKERY[2] as StockPhoto, slot('A fresh loaf on the counter', 'gallery'))).toBeNull()
    // A product is held to its own name as well.
    expect(aiStockPhotoAlt(CAKE, { ...slot('Our signature', 'gallery'), product: { subjects: ['Tres leches cake'] } })).toBeNull()
  })

  it("describes the photo by its first tags when the slot's words do not, and by the library's own description where it writes one", () => {
    expect(aiStockPhotoAlt(CAKE, slot('Fresh conchas on a tray at the bakery counter'))).toBe('Cake, homemade, dessert')
    expect(aiStockPhotoAlt(BAKERY[3] as StockPhoto, slot('The family kneading pan dulce in the kitchen', 'about'))).toBe('Cake, candles, bithday cake')
    const pexels = { ...CAKE, alt: 'Round cake dusted with powdered sugar on a white cloth' }
    expect(aiStockPhotoAlt(pexels, slot('Fresh conchas on a tray'))).toBe('Round cake dusted with powdered sugar on a white cloth')
    expect(aiStockPhotoAlt({ ...CAKE, tags: [] }, slot('Fresh conchas on a tray'))).toBe('Illustrative photo')
  })

  it("never keeps a slot's words on a site in another language: the libraries' words are English, so its own phrase stands in", () => {
    expect(aiStockPhotoAlt(CAKE, slot(CONCHAS), { language: 'es' })).toBe('Foto ilustrativa')
    expect(aiStockPhotoAlt(CAKE, slot('Pastel casero espolvoreado con azúcar'), { language: 'es-MX' })).toBe('Foto ilustrativa')
    expect(aiStockPhotoAlt(CAKE, slot('Gâteau maison'), { language: 'fr' })).toBe('Photo d’illustration')
    expect(aiStockPhotoAlt(CAKE, slot('A homemade cake'), { language: 'en-US' })).toBeNull()
  })
})
