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
import { AGL4092_1101_ANSWERS, AGL4092_1101_HITS } from './fixtures/ai-stock-photo-agl4092-1101-recordings'

/*
 * An amateur motocross team, started afresh for the 2026-11-01 live check
 * (AGL-4092). Every photo it placed was real motocross but one: the riders
 * page's section about joining the team searched "joining young rider" and took
 * a kitesurfer (Pixabay 7288297, "kitesurfer, young, rider, nature, kitesurfing,
 * sea, …"). The slot's search and photo are the media doc's, its words
 * reconstructed; the search's answers are Pixabay's own (fixtures/
 * ai-stock-photo-agl4092-1101-recordings.ts). Through core's seams only, no
 * network, no model.
 */

const INPUTS = {
  businessType: 'Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries',
  audience: 'Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join',
  siteKind: 'fitness',
  businessName: 'Rut Runners Racing',
}
const SITE = { business: INPUTS.businessType, ...aiStockPhotoWordsOf({ plan: { language: 'en' } as never, inputs: INPUTS }) }
const HOST = 'rut-runners-1101'

const KITESURFER = '7288297'

const byId = (id: string) => (AGL4092_1101_HITS.get(id) ?? AGL4092_1029_HITS.get(id)) as StockPhoto
const idOf = (src: string | undefined | null) => src?.split('/').pop() ?? ''

const answers = (key: string) => AGL4092_1101_ANSWERS[key] ?? AGL4092_1029_ANSWERS[key] ?? []

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: [...answers(aiAgl40921029AnswerKey(request))], cached: true }
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

const picture = (alt: string, sectionIndex: number, sectionNames: readonly string[]): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect: 16 / 9,
  sectionIndex,
  role: aiLayoutPictureRole({ sectionIndex, sectionName: sectionNames[sectionIndex] ?? '', alt }),
})

const JOINING = picture('Joining young rider', 2, RIDERS)

/** Every search a slot tries before any wider world, as the source builds it, each with its judgement. */
function searchesOf(terms: AiStockSiteTerms, slot: AiLayoutPictureSlot, sectionName: string) {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  return [
    ...aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName),
    ...aiStockCraftSearches(slot, terms, subject),
  ].map((search) => ({ search, judgement: aiStockJudgementFor(slot, search, subject, terms, sectionName) }))
}

/** The page's hero and its section about joining, through the source, as the page step runs it. */
async function page(seed: string) {
  const deps = fakes()
  const photos =
    (await aiLayoutStockPhotoSource(
      { hostId: HOST, uid: 'member-1', seed, ...SITE, sectionNames: RIDERS, jobId: 'job-1101' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )?.([picture('Motocross riders on the track', 0, RIDERS), JOINING])) ?? []
  return { ids: photos.map((photo) => idOf(photo?.src)), asked: deps.asked }
}

/** A picture on a gallery of a business's site, judged by the search of its own words, as the first rung of its slot. */
function strictly(business: string, subject: string) {
  const terms = aiStockSiteTerms(business)
  const slot = { role: 'gallery' as const, alt: subject, aspect: 16 / 9 }
  return aiStockJudgementFor(slot, { query: subject }, subject, terms, 'Gallery')
}

/** A hit as Pixabay gives one: its page address is its first tags run together. */
const tagged = (id: number, ...tags: string[]): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width: 1280,
    height: 853,
    pageUrl: `https://pixabay.com/photos/${tags.slice(0, 4).join('-').replace(/\s+/g, '-')}-${id}/`,
    photographer: 'A Pixabay contributor',
    tags,
  }) as StockPhoto

beforeEach(() => aiStockForgetJobPhotos())

describe('a picture of a business in a clear world belongs to that world (AGL-4092, 2026-11-01)', () => {
  const terms = aiStockSourceTerms(SITE)

  it('replays the riders page: joining the team is never a kitesurfer, and is a photo of motocross', async () => {
    for (const seed of ['job-1101:riders', 'job-1101:riders-2', 'job-1101:riders-3']) {
      const { ids, asked } = await page(seed)
      expect(asked).toContain('joining young rider')
      expect(ids[1]).not.toBe(KITESURFER)
      expect(byId(ids[1] as string).tags.join(', ')).toMatch(/\b(?:motocross|dirt ?bike|enduro|supercross)\b/)
    }
  })

  it('turns the kitesurfer down under every search the slot sends', () => {
    const searches = searchesOf(terms, JOINING, RIDERS[2] as string)
    expect(searches[0]?.search.query).toBe('joining young rider')
    expect(searches.filter(({ judgement }) => aiStockRelevance(byId(KITESURFER), judgement) > 0).map(({ search }) => search.query)).toEqual([])
  })

  it('reads the phrase from no run of two tags, nor from a tag that says it whole', () => {
    const judgement = searchesOf(terms, JOINING, RIDERS[2] as string)[0]?.judgement ?? {}
    // Pixabay's page address runs "young" and "rider" together: no tag says them as one.
    expect(byId(KITESURFER).tags).toEqual(expect.arrayContaining(['young', 'rider']))
    expect(byId(KITESURFER).tags).not.toContain('young rider')
    expect(aiStockRelevance(byId(KITESURFER), judgement)).toBe(0)
    // A tag that does names a person's age, and nothing of the team's world.
    expect(aiStockRelevance(tagged(1, 'kitesurfer', 'young rider', 'kitesurfing', 'sea'), judgement)).toBe(0)
    expect(aiStockRelevance(tagged(2, 'young rider', 'kitesurfing', 'sea'), judgement)).toBe(0)
  })

  it('keeps what the same search took rightly: a rider of the world, however the photo says it', () => {
    const judgement = searchesOf(terms, JOINING, RIDERS[2] as string)[0]?.judgement ?? {}
    // Each tagged "rider" and of the team's world, as production's own answers for it were.
    for (const id of ['1868996', '8548196', '2007900', '330815']) expect(aiStockRelevance(byId(id), judgement)).toBeGreaterThan(0)
    // Its phrase, named with the world, still counts most.
    expect(aiStockRelevance(tagged(3, 'young rider', 'motocross', 'dirt'), judgement)).toBeGreaterThan(
      aiStockRelevance(tagged(4, 'rider', 'motocross', 'dirt'), judgement),
    )
  })

  it.each([
    // A word for what someone is like names no world of theirs, in any trade.
    ['Youth soccer club: teams, coaches and match schedules', 'young player', ['guitarist', 'young', 'player', 'music']],
    ['Swim school: lessons for children and adults', 'young swimmer', ['triathlon', 'young', 'swimmer', 'ocean']],
    ['Driving school: lessons and road tests', 'young driver', ['surfer', 'young', 'driver', 'bus']],
    ['Riding stable: lessons, trail rides and boarding', 'young rider', ['motocross', 'young', 'rider', 'dirt']],
    // Nor does a person: a rider, a coach, a player is in every world.
    ['Youth soccer club: teams, coaches and match schedules', 'head coach', ['head coach', 'basketball', 'court']],
    ['Amateur motocross race team: rider profiles and race results', 'stunt rider', ['stunt rider', 'arena', 'show']],
    ['Taco food trailer: street and breakfast tacos', 'old truck', ['old', 'truck', 'farm', 'barn']],
  ])('holds %s\'s "%s" to its world', (business, subject, tags) => {
    expect(aiStockRelevance(tagged(9, ...tags), strictly(business, subject))).toBe(0)
  })

  it("keeps a thing's own name, which is that thing in any world: a potter's espresso cup", () => {
    const studio = 'A small-batch ceramics studio in Asheville making tableware'
    expect(aiStockRelevance(tagged(1, 'espresso', 'cup', 'coffee'), strictly(studio, 'espresso cup'))).toBeGreaterThan(0)
    expect(aiStockRelevance(tagged(2, 'bud vase', 'flowers', 'table'), strictly(studio, 'bud vase'))).toBeGreaterThan(0)
    const candles = 'Hand-poured soy candle shop'
    expect(aiStockRelevance(tagged(3, 'wick trimmer', 'tool', 'brass'), strictly(candles, 'wick trimmer'))).toBeGreaterThan(0)
    // Further down its tags, the same two words are no name: another thing is what it shows.
    expect(aiStockRelevance(tagged(4, 'latte', 'espresso', 'cup', 'coffee'), strictly(studio, 'espresso cup'))).toBe(0)
  })
})
