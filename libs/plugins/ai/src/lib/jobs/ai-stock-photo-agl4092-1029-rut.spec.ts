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
  aiStockCraftSearches,
  aiStockForgetJobPhotos,
  aiStockJudgementFor,
  aiStockPhotoWordsOf,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { AGL4092_1029_ANSWERS, AGL4092_1029_HITS, aiAgl40921029AnswerKey } from './fixtures/ai-stock-photo-agl4092-1029-recordings'

/*
 * Rut Runners Racing, started afresh on beta.291 for the 2026-10-29 live
 * check (AGL-4092): an amateur motocross team. Replayed from what
 * production's search cache held for every search it sent
 * (fixtures/ai-stock-photo-agl4092-1029-recordings.ts):
 *
 * - the riders page's closing band searched the motorcycle repair shop's
 *   "motorcycle workshop" for the team and took a model posing with a
 *   street bike in a garage ("motorbike, bike, biker, …, garage, repair, …,
 *   road");
 * - the sponsors page's closing band, "Ready to ride with us", took a man in
 *   a motorcycle suit on a street bike at sunset, tagged "motorcycle, ride,
 *   motocross, …, trip, …, to travel, …, motorcycle suit, helmet, vacations":
 *   its third tag says motocross, and nothing it names is the ground a dirt
 *   bike rides.
 *
 * Each band's words are reconstructed (the stored alt texts describe the
 * photos placed); every search the replay sends on the code that built the
 * site was in production's cache, so production sent the same. Through
 * core's seams only, no network, no model.
 */

const INPUTS = {
  businessType: 'Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries',
  audience: 'Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join',
  siteKind: 'fitness',
  businessName: 'Rut Runners Racing',
}
const SITE = { business: INPUTS.businessType, ...aiStockPhotoWordsOf({ plan: { language: 'en' } as never, inputs: INPUTS }) }
const HOST = 'rut-runners-1029'

const MODEL_IN_A_GARAGE = '4607838'
const STREET_BIKE_TRIP = '5284133'

const byId = (id: string) => AGL4092_1029_HITS.get(id) as StockPhoto
const idOf = (src: string | undefined | null) => src?.split('/').pop() ?? ''

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: [...(AGL4092_1029_ANSWERS[aiAgl40921029AnswerKey(request)] ?? [])], cached: true }
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

const RIDERS = ['Riders intro', 'Rider profiles', 'How young riders join', 'Call to action: ask about joining']
const SPONSORS = ['Why local businesses sponsor riders', 'What sponsors receive', 'How sponsoring works, step by step', 'Call to action: become a sponsor']

const picture = (alt: string, sectionIndex: number, sectionNames: readonly string[]): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect: 16 / 9,
  sectionIndex,
  role: aiLayoutPictureRole({ sectionIndex, sectionName: sectionNames[sectionIndex] ?? '', alt }),
})

const RIDERS_BAND = picture('A young rider and the team at the track', 3, RIDERS)
const SPONSORS_BAND = picture('Ready to ride with us', 3, SPONSORS)

/** Every search a slot tries before any wider world, as the source builds it, each with its judgement. */
function searchesOf(terms: AiStockSiteTerms, slot: AiLayoutPictureSlot, sectionName: string) {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  return [
    ...aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName),
    ...aiStockCraftSearches(slot, terms, subject),
  ].map((search) => ({ search, judgement: aiStockJudgementFor(slot, search, subject, terms, sectionName) }))
}

/** A page's hero and its closing band, through the source, as the page step runs it. */
async function page(sectionNames: readonly string[], band: AiLayoutPictureSlot, seed: string) {
  const deps = fakes()
  const photos =
    (await aiLayoutStockPhotoSource(
      { hostId: HOST, uid: 'member-1', seed, ...SITE, sectionNames, jobId: '4oNdPtBCbz' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )?.([picture('Motocross riders on the track', 0, sectionNames), band])) ?? []
  return { ids: photos.map((photo) => idOf(photo?.src)), asked: deps.asked }
}

/** What an off-road photo names: the ground, or a track. */
const GROUND = /\b(?:dirt|mud|dust|dusty|sand|dunes?|desert|gravel|trail|terrain|off-?road|track|jump|berm|dirt ?bike|enduro|supercross)\b/

beforeEach(() => aiStockForgetJobPhotos())

describe('Rut Runners Racing closing bands (AGL-4092, 2026-10-29)', () => {
  const terms = aiStockSourceTerms(SITE)
  const takes = (id: string, slot: AiLayoutPictureSlot, sectionNames: readonly string[]) =>
    searchesOf(terms, slot, sectionNames[slot.sectionIndex] ?? '').some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)

  it('replays the riders page: its band is the team racing, never a model with a street bike in a garage', async () => {
    const { ids, asked } = await page(RIDERS, RIDERS_BAND, '4oNdPtBCbz:6xp7JjW5Dx')
    expect(ids[1]).not.toBe(MODEL_IN_A_GARAGE)
    expect(asked).not.toContain('motorcycle workshop')
    expect(asked).not.toContain('motorcycle mechanic')
    expect(byId(ids[1] as string).tags.join(', ')).toMatch(GROUND)
  })

  it('replays the sponsors page: its band is never a street bike on a road trip', async () => {
    const { ids } = await page(SPONSORS, SPONSORS_BAND, '4oNdPtBCbz:YxdQC1RV-i')
    expect(ids[1]).not.toBe(STREET_BIKE_TRIP)
    expect(byId(ids[1] as string).tags.join(', ')).toMatch(GROUND)
  })

  it('turns both down under every search their bands send', () => {
    expect(takes(MODEL_IN_A_GARAGE, RIDERS_BAND, RIDERS)).toBe(false)
    expect(takes(STREET_BIKE_TRIP, SPONSORS_BAND, SPONSORS)).toBe(false)
  })

  it('searches a team by its riders and their racing, never the repair shop’s bench', () => {
    expect(terms.making).toEqual(['motocross rider gear', 'dirt bike racing'])
    expect(terms.broad).toEqual(expect.arrayContaining(['motocross', 'dirt bike', 'motocross race', 'motocross rider', 'motocross track']))
    // The library answers a paddock with horses and pits with fruit: a team asks neither.
    for (const key of ['motocross paddock|horizontal|900|', 'motocross pits|horizontal|900|']) {
      expect([...terms.making, ...terms.broad]).not.toContain(key.split('|')[0])
      expect((AGL4092_1029_ANSWERS[key] ?? []).slice(0, 3).map((hit) => hit.tags[0])).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/motocross|dirt bike|motorcycle/)]),
      )
    }
    // A parts shop still shows its mechanic at work.
    expect(aiStockSiteTerms('Dirt bike and ATV parts shop: OEM and aftermarket parts, tires and riding gear').making).toEqual([
      'motorcycle mechanic',
      'motorcycle workshop',
    ])
  })

  it('reads a street bike from every tag, unless the photo names the ground an off-road bike rides', () => {
    const search = searchesOf(terms, SPONSORS_BAND, SPONSORS[3] as string)[0]?.search
    const broad = aiStockJudgementFor(SPONSORS_BAND, { query: search?.query ?? '', broad: true }, '', terms, SPONSORS[3])
    expect(aiStockRelevance(byId(STREET_BIKE_TRIP), broad)).toBe(0)
    expect(aiStockRelevance(byId(MODEL_IN_A_GARAGE), broad)).toBe(0)
    // "road", "travel" and "adventure" beside "off-road", "desert" and "sand": a dirt bike in the dunes.
    expect(byId('10388622').tags).toEqual(expect.arrayContaining(['road', 'travel', 'off-road', 'desert']))
    expect(aiStockRelevance(byId('10388622'), broad)).toBeGreaterThan(0)
    // A business of the whole motorcycle world reads none of it.
    expect(aiStockSiteTerms('Motorcycle repair shop: tune-ups, tires and street bike service').road).toBeUndefined()
  })
})
