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
  aiStockRelevance,
  aiStockSiteTerms,
  aiStockSourceTerms,
  aiStockSubjectWords,
} from './ai-layout-stock-photos'
import { aiAgl4065Searches } from './fixtures/ai-stock-photo-agl4065-judge'
import {
  AGL4065_HITS,
  BREAKFAST_TACO,
  CATERER,
  CATERING_BACON,
  CATERING_POTATO,
  CHEF_COOKING,
  STREET_TACOS,
} from './fixtures/ai-stock-photo-agl4065-recordings'

/*
 * Pit Row Tacos of the 2026-10-25 booth kit (AGL-4065), a taco trailer that
 * also "takes catering requests", replayed from the photos Pixabay gave it
 * (fixtures/ai-stock-photo-agl4065-recordings.ts). Its craft was read as
 * catering, the last clause of its business type, so its heroes searched
 * "caterer" and opened on hotel buffets, its story on a chef in a white
 * jacket, and its menu record "Potato and egg breakfast taco" searched
 * "catering potato" and showed raw potatoes. Through core's seams only, no
 * network, no model.
 */

const PIT_ROW = {
  business: 'Taco food trailer: street and breakfast tacos at motocross races, events and around town; takes catering requests',
  audience: 'Hungry riders, families and fans at Texas motocross races, plus locals and event planners around Buda',
  kind: 'restaurant',
  name: 'Pit Row Tacos',
  language: 'en',
}

const BUFFETS = ['4797476', '7165148', '315691']
const CHEF = '4625935'
const POTATOES = '3440360'

const RECORDED: Record<string, StockPhoto[]> = {
  caterer: CATERER,
  'chef cooking': CHEF_COOKING,
  'catering potato': CATERING_POTATO,
  'catering bacon': CATERING_BACON,
  'breakfast taco': BREAKFAST_TACO,
  'asada street taco': STREET_TACOS,
}

const byId = (id: string) => AGL4065_HITS.get(id) as StockPhoto
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: request.people ? [] : (RECORDED[request.query] ?? []), cached: true }
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

const slot = (alt: string, aspect: number, role: AiLayoutPictureSlot['role'], extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex: role === 'hero' ? 0 : 1,
  role,
  ...extra,
})

beforeEach(() => aiStockForgetJobPhotos())

describe('Pit Row Tacos (AGL-4065, 2026-10-25)', () => {
  const terms = aiStockSourceTerms(PIT_ROW)
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[]) =>
    aiLayoutStockPhotoSource(
      { hostId: 'pit-row', uid: 'member-1', seed: '2NuneC5WZ4:home', ...PIT_ROW, sectionNames, jobId: '2NuneC5WZ4' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )
  const takes = (id: string, picture: AiLayoutPictureSlot, sectionName: string) =>
    aiAgl4065Searches(terms, picture, sectionName).some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)

  it('never opens on a hotel buffet', async () => {
    const deps = fakes()
    const [hero] = (await source(deps, ['Hero: race-day tacos, made fresh on the line'])?.([slot('Race-day tacos, made fresh on the line', 16 / 9, 'hero', { standIn: true })])) ?? []
    expect(BUFFETS).not.toContain(idOf(hero?.src))
    expect(deps.asked).not.toContain('caterer')
    for (const id of BUFFETS) expect([id, takes(id, slot('Race-day tacos', 16 / 9, 'hero'), 'Hero')]).toEqual([id, false])
  })

  it('tells the trailer’s story by the trailer, never by a chef in whites', async () => {
    const story = slot('Our trailer on race day', 4 / 5, 'about', { standIn: true })
    expect(takes(CHEF, story, 'Our story: a taco trailer from Buda')).toBe(false)
    const deps = fakes()
    const [photo] = (await source(deps, ['Hero', 'Our story: a taco trailer from Buda'])?.([story])) ?? []
    expect(idOf(photo?.src)).not.toBe(CHEF)
    expect(deps.asked).not.toContain('chef cooking')
    expect(deps.asked).toContain('taco truck cooking')
  })

  it('covers "Potato and egg breakfast taco" as a taco, never as raw potatoes', async () => {
    const record = slot('Potato and egg breakfast taco', 4 / 3, 'gallery', { record: {} })
    expect(aiStockSubjectWords(record.alt, 'Menu highlights')).toBe('egg breakfast taco')
    expect(takes(POTATOES, record, 'Menu highlights')).toBe(false)
    const deps = fakes()
    const [cover] = (await source(deps, ['Hero', 'Menu highlights'])?.([record])) ?? []
    expect(deps.asked).not.toContain('catering potato')
    expect(idOf(cover?.src)).not.toBe(POTATOES)
  })

  it('takes the tacos production placed for its street taco records', () => {
    expect(takes('4179895', slot('Carne asada street taco', 4 / 3, 'gallery', { record: {} }), 'Menu highlights')).toBe(true)
  })
})

describe('Copper Kettle Catering keeps its catering world (AGL-3831, AGL-4065)', () => {
  it('still reads a caterer as catering, with its own broad searches', () => {
    const terms = aiStockSiteTerms('Family-run Austin caterer: Texas barbecue and Tex-Mex for weddings, office lunches and parties')
    expect(terms.craft).toBe('caterer')
    expect(terms.broad.slice(0, 2)).toEqual(['caterer', 'catering buffet'])
    expect(terms.making[0]).toBe('chef cooking')
  })
})
