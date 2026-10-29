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
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSensitive,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { AGL4092_ANSWERS, AGL4092_HITS, AGL4092_PEOPLE_ANSWERS } from './fixtures/ai-stock-photo-agl4092-recordings'

/*
 * Rut Runners Racing of the 2026-10-28 live check (AGL-4092), an amateur
 * motocross team, replayed from what Pixabay answers its searches
 * (fixtures/ai-stock-photo-agl4092-recordings.ts). Its home page's "The team
 * in pictures: garage, track and podium" was read as portraits of the team,
 * because its name says "team": "Gate drop" searched "motocross race team
 * gate drop" among people and took a man posing with a street bike, tagged
 * "man, model, motorcycle" and, 21st, "susuki" — a Suzuki, one letter off.
 *
 * The brand marks no tag names (the hero's "SHIFT" jersey, a gallery's
 * Yamaha, Fox and Suzuki) are pixels only: a photo is refused for a brand
 * only where its tags or its page address name one, everywhere, with no
 * image read (the 2026-10-28 decision). Its hero still takes 6380133, whose
 * tags name no maker: that is the stated limit.
 *
 * Through core's seams only, no network, no model.
 */

const RUT_RUNNERS = {
  business: 'Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries',
  audience: 'Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join',
  kind: 'fitness',
  name: 'Rut Runners Racing',
  language: 'en',
}

const STREET_BIKE_MODEL = '7169748'
const SHIFT_JERSEY_HERO = '6380133'

/** A hit's first tags name the off-road world: a motocross team's photo is OF it. */
const OFFROAD_LEAD = /\b(?:motocross|motorcross|dirt ?bikes?|enduro|supercross|mx|atv|off[- ]road)\b/

const HOME = [
  'Hero with team tagline and Meet the riders button',
  'How to start: four steps to join the team',
  'Programs: classes our riders race in',
  'The team in pictures: garage, track and podium',
  'Meet the riders',
]

const byId = (id: string) => AGL4092_HITS.get(id) as StockPhoto
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.people ? `${request.query} (people)` : request.query)
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

/** A picture of the home page, its role read as the page's slots read it. */
const picture = (alt: string, sectionIndex: number, aspect = 4 / 3): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex,
  role: aiLayoutPictureRole({ sectionIndex, sectionName: HOME[sectionIndex] ?? '', alt }),
})

/** Every search a slot tries before any wider world, as the source builds it, each with its judgement. */
function searchesOf(terms: AiStockSiteTerms, slot: AiLayoutPictureSlot, sectionName: string) {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  return [...aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName), ...aiStockCraftSearches(slot, terms)].map(
    (search) => ({ search, judgement: aiStockJudgementFor(slot, search, subject, terms, sectionName) }),
  )
}

const tagged = (photo: StockPhoto, tags: readonly string[], slug = 'motocross-rider'): StockPhoto => ({
  ...photo,
  id: `${photo.id}-${tags[0]}`,
  pageUrl: `https://pixabay.com/photos/${slug}-1/`,
  tags: [...tags],
})

beforeEach(() => aiStockForgetJobPhotos())

describe('Rut Runners Racing (AGL-4092, 2026-10-28)', () => {
  const terms = aiStockSourceTerms(RUT_RUNNERS)
  const source = (deps: ReturnType<typeof fakes>) =>
    aiLayoutStockPhotoSource(
      { hostId: 'rut-runners', uid: 'member-1', seed: 'dv72VIGItN:home', ...RUT_RUNNERS, sectionNames: HOME, jobId: 'dv72VIGItN' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('fills "The team in pictures" with motocross, never a man posing with a street bike', async () => {
    const deps = fakes()
    const cells = ['Gate drop', 'Garage nights', 'Podium'].map((alt) => picture(alt, 3))
    const photos = (await source(deps)?.(cells)) ?? []
    expect(deps.asked).not.toContain('motocross race team gate drop (people)')
    expect(deps.asked[0]).toBe('motocross gate drop')
    const ids = photos.map((photo) => idOf(photo?.src))
    expect(ids).not.toContain(STREET_BIKE_MODEL)
    for (const id of ids.filter(Boolean)) expect([id, byId(id).tags.slice(0, 3).join(', ')]).toEqual([id, expect.stringMatching(OFFROAD_LEAD)])
  })

  it('turns the street bike down twice over: its "susuki" names a maker, and it leads with no off-road word', () => {
    const model = byId(STREET_BIKE_MODEL)
    expect(model.tags.indexOf('susuki')).toBe(20)
    expect(aiStockSensitive(model, terms.named)).toBe(true)
    // Without the maker's tags, its lead is still a man posing with a motorcycle.
    const unbranded = { ...model, tags: model.tags.filter((tag) => !tag.includes('susuki')) }
    expect(aiStockSensitive(unbranded, terms.named)).toBe(false)
    expect(terms.lead).not.toContain('motorcycle')
    expect(terms.shunLead).toEqual(expect.arrayContaining(['model', 'urban', 'street']))
    const gate = picture('Gate drop', 3)
    expect(searchesOf(terms, gate, HOME[3] as string).some(({ judgement }) => aiStockRelevance(unbranded, judgement) > 0)).toBe(false)
  })

  it('still opens on the photo whose jersey mark no tag names: the stated limit', () => {
    const hero = picture('Young motocross riders training on a dirt track in Lockhart', 0, 16 / 9)
    const jersey = byId(SHIFT_JERSEY_HERO)
    expect(aiStockSensitive(jersey, terms.named)).toBe(false)
    expect(searchesOf(terms, hero, HOME[0] as string).some(({ judgement }) => aiStockRelevance(jersey, judgement) > 0)).toBe(true)
  })

  it('names a maker one letter off, and gear and tire makers by their phrase, never a common word', () => {
    const rider = byId(SHIFT_JERSEY_HERO)
    for (const mark of ['susuki', 'yamha', 'kawasaky', 'fox racing', 'shift mx', 'alpinestars', 'troy lee', 'michelin', "o'neal"])
      expect([mark, aiStockSensitive(tagged(rider, ['motocross', 'rider', mark]), terms.named)]).toEqual([mark, true])
    // A maker named in the page address alone.
    expect(aiStockSensitive(tagged(rider, ['motocross', 'rider'], 'motocross-fox-racing-jersey'), terms.named)).toBe(true)
    for (const word of ['fox', 'shift', 'barley', 'rental', 'phone', 'harlem', 'racing', 'gear'])
      expect([word, aiStockSensitive(tagged(rider, ['motocross', 'rider', word]), terms.named)]).toEqual([word, false])
    // A fox is a wildlife site's own animal.
    const wildlife = aiStockSiteTerms('Wildlife photography tours: foxes, owls and deer in the hill country')
    expect(aiStockSensitive(tagged(rider, ['fox', 'animal', 'wildlife'], 'fox-animal-wildlife'), wildlife.named)).toBe(false)
    // A site that names its maker shows it.
    const dealer = aiStockSiteTerms('Suzuki motorcycle dealer: new and used bikes')
    expect(aiStockSensitive(tagged(rider, ['motorcycle', 'susuki']), dealer.named)).toBe(false)
  })
})
