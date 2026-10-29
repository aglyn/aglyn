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
import {
  AI_LAYOUT_NO_PHOTO,
  AI_LAYOUT_STARTER_PHOTOS,
  aiResolveLayoutPictures,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockObjectWord,
  aiStockProperWords,
  aiStockRank,
  aiStockRelevance,
  aiStockSiteTerms,
  aiStockSubjectWords,
  aiStockTagsAlt,
  type AiStockJudgement,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { aiStockPhotoPick } from './ai-stock-photo-picker'
import {
  BASIC,
  FILM,
  GYM_STRENGTH_SESSION,
  INTRO_BARBELL_BASICS,
  SMALL_GROUP_STRENGTH_CLASS,
  STRENGTH,
  TWO_ATTORNEY_LAW_FIRM_SQUARE,
  TWO_ATTORNEY_LAW_FIRM_TALL,
  WEDDING_WIDE,
} from './fixtures/ai-stock-photo-agl3856-recordings'

/*
 * Three beta.259 guided starts on 2026-10-16 (AGL-3856), replayed from what
 * Pixabay answered them (fixtures/ai-stock-photo-agl3856-recordings.ts):
 *
 * - Hartwell Reyes Family Law: the home hero, its LCP image, was a typewriter
 *   printing "terms of service" (Pixabay 5243222, tagged "law, general terms
 *   and conditions, attorney"), and kept the model's words "Two attorneys
 *   speaking calmly with a client in a bright Columbus office".
 * - Ironline Strength Studio: its three events took a yoga pose on a beach
 *   (2587066, tagged "yoga, strength"), a heart-shaped potato (3486048,
 *   "basic food … strength") and a yoga class (1179452), each drawn with
 *   `alt=""`.
 * - Juniper and Rye Photography: the "Film" card was a horse's head
 *   (3601033, "horse, portrait, western film"), six designed pictures were
 *   decorative stand-ins drawn with `alt=""`, and the hero's alt was the
 *   library's tag list "Wedding dress, bride, extravagant".
 *
 * Through core's seams only: a fake provider answering each search with its
 * recorded answer (a search the start never sent answers nothing) and a fake
 * library. No network, no model.
 */

const LAW = 'A two-attorney family law firm in Columbus, Ohio: divorce, custody, adoption and prenups'
const GYM = 'A strength and conditioning gym in Austin, Texas: small-group classes, barbell coaching, open gym'
const PHOTOGRAPHER = 'A wedding and portrait photographer in Asheville, North Carolina shooting film and digital'

/** The model's words for the law firm's home hero. */
const LAW_HERO_ALT = 'Two attorneys speaking calmly with a client in a bright Columbus office'

const TYPEWRITER = '5243222'
const YOGA_ON_THE_BEACH = '2587066'
const HEART_POTATO = '3486048'
const YOGA_CLASS = '1179452'
const HORSE = '3601033'

const ALL = [
  TWO_ATTORNEY_LAW_FIRM_TALL,
  TWO_ATTORNEY_LAW_FIRM_SQUARE,
  GYM_STRENGTH_SESSION,
  STRENGTH,
  INTRO_BARBELL_BASICS,
  BASIC,
  SMALL_GROUP_STRENGTH_CLASS,
  FILM,
  WEDDING_WIDE,
]
const BY_ID = new Map(ALL.flatMap((hits) => hits.map((hit) => [hit.id, hit] as const)))
const byId = (id: string) => BY_ID.get(id) as StockPhoto

/** Each search's recorded answer, by its query, orientation and size, as the cache keyed it. */
const RECORDED: Record<string, StockPhoto[]> = {
  'two-attorney law firm|vertical|1600|0': TWO_ATTORNEY_LAW_FIRM_TALL,
  'two-attorney law firm|any|1600|0': TWO_ATTORNEY_LAW_FIRM_SQUARE,
  'gym strength session|horizontal|900|0': GYM_STRENGTH_SESSION,
  'strength|horizontal|900|0': STRENGTH,
  'intro barbell basics|horizontal|900|0': INTRO_BARBELL_BASICS,
  'basic|horizontal|900|0': BASIC,
  'small-group strength class|horizontal|900|0': SMALL_GROUP_STRENGTH_CLASS,
  'film|vertical|0|900': FILM,
  'wedding|horizontal|1600|0': WEDDING_WIDE,
}

function fakes() {
  const asked: string[] = []
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      const key = `${request.query}|${request.orientation ?? 'any'}|${request.minWidth ?? 0}|${request.minHeight ?? 0}`
      return { photos: request.people ? [] : (RECORDED[key] ?? []), cached: true }
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
      stored.push(request)
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
  return { provider, ingest, asked, stored }
}

const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** How a slot's hits are judged, as the source judges them. */
const judged = (terms: AiStockSiteTerms, extra: AiStockJudgement): AiStockJudgement => ({
  domain: terms.domain,
  named: terms.named,
  rivals: terms.rivals,
  ...(terms.shun.length ? { shun: terms.shun } : {}),
  ...(terms.shunLead.length ? { shunLead: terms.shunLead } : {}),
  ...extra,
})

const slot = (alt: string, aspect: number, role: AiLayoutPictureSlot['role'], extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: 'img',
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex: role === 'hero' ? 0 : 1,
  role,
  ...extra,
})

beforeEach(() => aiStockForgetJobPhotos())

describe('the Hartwell Reyes Family Law hero (AGL-3856, beta.259)', () => {
  const terms = aiStockSiteTerms(LAW)
  const source = (deps: ReturnType<typeof fakes>) =>
    aiLayoutStockPhotoSource(
      { hostId: 'iwqf1gWJ9C', uid: 'member-1', seed: 'E4PIY8RJS5:ST8cU0gPFf', business: LAW, language: 'en', sectionNames: ['Hero with consultation call to action'], jobId: 'E4PIY8RJS5' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('reads a law practice by its people and its office, and Columbus, Ohio as where it is', () => {
    expect(terms.craft).toBe('law')
    expect(terms.domain).toEqual(expect.arrayContaining(['law', 'attorney', 'lawyer', 'office', 'divorce', 'custody']))
    expect(terms.domain).not.toContain('ohio')
    expect(terms.shunLead).toEqual(expect.arrayContaining(['term', 'condition', 'typewriter']))
  })

  it('never takes the typewriter printing terms of service, for the hero or any picture', () => {
    const typewriter = byId(TYPEWRITER)
    expect(typewriter.tags.slice(0, 3)).toEqual(['law', 'general terms and conditions', 'attorney'])
    expect(aiStockRelevance(typewriter, judged(terms, { subject: '', category: terms.core, first: true }))).toBe(0)
    expect(aiStockRelevance(typewriter, judged(terms, { subject: '' }))).toBe(0)
    // Nor a statue of justice, nor the police.
    for (const id of ['2722004', '5211993', '2585928']) expect(aiStockRelevance(byId(id), judged(terms, { subject: '' }))).toBe(0)
  })

  it('leaves its tall home hero without a photo, not the typewriter, when nothing recorded shows the practice', async () => {
    const deps = fakes()
    const hero = slot(LAW_HERO_ALT, 4 / 5, 'hero')
    expect(await source(deps)?.([hero])).toEqual([AI_LAYOUT_NO_PHOTO])
    expect(deps.asked[0]).toBe('two-attorney law firm')
    expect(deps.stored).toHaveLength(0)
  })

  it('fills a square hero with the law office, described by its own words rather than the model’s', async () => {
    const deps = fakes()
    const [photo] = (await source(deps)?.([slot(LAW_HERO_ALT, 1, 'hero')])) ?? []
    const placed = byId(idOf(photo?.src))
    expect(placed.id).not.toBe(TYPEWRITER)
    expect(placed.tags[0]).toBe('law office')
    // The office shows no two attorneys and no client: it says what it shows.
    expect(photo?.alt).toBe('A lawyer in a law office')
    expect(deps.stored[0]?.alt).toBe(photo?.alt)
  })
})

describe('the Ironline Strength Studio events (AGL-3856, beta.259)', () => {
  const terms = aiStockSiteTerms(GYM)
  const pick = (deps: ReturnType<typeof fakes>, id: string, title: string) =>
    aiStockPhotoPick(
      { hostId: 'MEo5ZeWQB2', uid: 'member-1', subject: title, business: GYM, orientation: 'horizontal', scope: 'rglwQoGmLQ', seed: id },
      { source: (input) => aiLayoutStockPhotoSource(input, { provider: () => deps.provider, ingest: () => deps.ingest }) },
    )

  it('reads the gym’s world, and Austin, Texas as where it is', () => {
    expect(terms.domain).toEqual(expect.arrayContaining(['gym', 'barbell', 'fitness', 'workout']))
    expect(terms.domain).not.toContain('texas')
    expect(terms.domain).not.toContain('class')
    expect(terms.shunLead).toEqual(expect.arrayContaining(['yoga', 'beach']))
  })

  it('reads an event’s title by the thing it is of, never "basics", "class" or "session"', () => {
    const object = (title: string) => aiStockObjectWord(aiStockSubjectWords(title, ''))
    expect(object('Intro to barbell basics')).toBe('barbell')
    expect(object('Small-group strength class')).toBe('strength')
    expect(object('Open gym strength session')).toBe('strength')
  })

  it('turns down the yoga pose, the heart-shaped potato and the yoga class production placed', () => {
    const strength = judged(terms, { subject: '' })
    expect(aiStockRelevance(byId(YOGA_ON_THE_BEACH), strength)).toBe(0)
    expect(aiStockRelevance(byId(YOGA_CLASS), judged(terms, { subject: 'small-group strength class', strict: true }))).toBe(0)
    // The potato is "basic food", never a lesson's basics, and no lifting at all.
    expect(aiStockRelevance(byId(HEART_POTATO), judged(terms, { subject: 'intro barbell basics', strict: true }))).toBe(0)
  })

  it('turns down another sport’s ball, as the beta.261 deadlift night’s basketball court (AGL-3864)', () => {
    const court = { ...byId(YOGA_ON_THE_BEACH), id: 'basketball-court', tags: ['sport', 'basketball', 'ball'] }
    expect(aiStockRelevance(court, judged(terms, { subject: 'deadlift pr night', strict: true }))).toBe(0)
    expect(terms.shunLead).toEqual(expect.arrayContaining(['basketball', 'football', 'tennis']))
  })

  it('turns down a cricket ball on a wooden court for "Deadlift PR night", and every other ball sport (AGL-3856)', () => {
    // The event's object was its "night"; a hit tagged with it and the gym's
    // world would otherwise have filled it. A night is never a thing (AGL-4092):
    // the event is of its deadlift, which no ball names.
    const subject = aiStockSubjectWords('Deadlift PR night', '')
    expect(aiStockObjectWord(subject)).toBe('deadlift')
    const deadlift = judged(terms, { subject, strict: true })
    const night = { ...deadlift, object: 'night' }
    const broad = judged(terms, { subject: '' })
    const ball = (id: string, tags: string[]) => ({ ...byId(YOGA_ON_THE_BEACH), id, pageUrl: `https://pixabay.com/photos/${id}/`, tags })
    const cricket = ball('cricket-ball', ['ball', 'cricket', 'wooden court', 'night', 'fitness', 'sport'])
    expect(aiStockRelevance(cricket, deadlift)).toBe(0)
    // Held to the night, as the event was read before, the ball sport is what turns it down.
    expect(aiStockRelevance(cricket, { ...night, shunLead: [] })).toBeGreaterThan(0)
    expect(aiStockRelevance(cricket, night)).toBe(0)
    expect(aiStockRelevance(cricket, broad)).toBe(0)
    for (const sport of ['squash', 'badminton', 'bowling', 'billiards', 'pool', 'lacrosse', 'softball', 'handball', 'ping pong']) {
      const hit = ball(sport, [sport, 'ball', 'night', 'fitness'])
      expect(aiStockRelevance(hit, { ...night, shunLead: [] })).toBeGreaterThan(0)
      expect(aiStockRelevance(hit, night)).toBe(0)
      expect(aiStockRelevance(hit, deadlift)).toBe(0)
    }
    expect(terms.shunLead).toEqual(expect.arrayContaining(['cricket', 'squash', 'badminton', 'bowling', 'billiard', 'lacrosse', 'softball', 'handball']))
    // A medicine ball is a gym's own.
    expect(aiStockRelevance(ball('medicine-ball', ['medicine ball', 'gym', 'night', 'workout']), night)).toBeGreaterThan(0)
    expect(aiStockRelevance(ball('medicine-ball', ['medicine ball', 'gym', 'deadlift', 'workout']), deadlift)).toBeGreaterThan(0)
  })

  it('covers each event with a photo of lifting or training, described by its own words', async () => {
    const deps = fakes()
    const events: Array<[string, string]> = [
      ['H16KUlejZd', 'Open gym strength session'],
      ['KHTXZDB4wE', 'Intro to barbell basics'],
      ['LjlDllWFM5', 'Small-group strength class'],
    ]
    const covers = []
    for (const [id, title] of events) covers.push(await pick(deps, id, title))
    const ids = covers.map((cover) => idOf(cover?.src))
    expect(new Set(ids).size).toBe(3)
    for (const [index, cover] of covers.entries()) {
      expect(cover?.origin).toBe('library')
      const placed = byId(ids[index] as string)
      expect([YOGA_ON_THE_BEACH, HEART_POTATO, YOGA_CLASS]).not.toContain(placed.id)
      expect(placed.tags.slice(0, 3).join(' ')).toMatch(/gym|fitness|barbell|weight|strength|workout|crossfit/)
      expect(placed.tags.slice(0, 3).join(' ')).not.toMatch(/yoga|beach/)
      // Never empty, never the title beside it, never the library's list.
      expect(cover?.alt).toBe(aiStockTagsAlt(placed.tags))
      expect(cover?.alt).not.toBe(events[index]?.[1])
      expect(cover?.alt).not.toBe(placed.tags.slice(0, 3).join(', '))
    }
    expect(byId(ids[1] as string).tags.slice(0, 3)).toContain('barbell')
  })
})

describe('the Juniper and Rye Photography home page (AGL-3856, beta.259)', () => {
  const terms = aiStockSiteTerms(PHOTOGRAPHER)

  it('reads a photographer: film and digital are what it shoots, never its world, and North Carolina is where it is', () => {
    expect(terms.craft).toBe('photographer')
    expect(terms.domain).toEqual(expect.arrayContaining(['wedding', 'portrait', 'photographer', 'camera']))
    for (const word of ['film', 'digital', 'north', 'carolina', 'shooting']) expect(terms.domain).not.toContain(word)
  })

  it('never takes the horse of a western film for the "Film" card, and takes a camera on film', () => {
    const card = judged(terms, { subject: 'film', strict: true })
    expect(aiStockRelevance(byId(HORSE), card)).toBe(0)
    // Nor the movie projector or the film shoot of a movie set.
    expect(aiStockRelevance(byId('1290368'), card)).toBe(0)
    expect(aiStockRelevance(byId('7135326'), card)).toBe(0)
    const [first] = aiStockRank(FILM, new Set(), 'FrKrUct5mk:bXqMYf8l9n:2:film', card)
    expect(first?.id).not.toBe(HORSE)
    expect(first?.tags.slice(0, 2).join(' ')).toMatch(/camera|film/)
  })

  it('describes the hero by an English phrase of its own words, never the tag list', async () => {
    const deps = fakes()
    const source = aiLayoutStockPhotoSource(
      { hostId: 'nVj_-hl115', uid: 'member-1', seed: 'FrKrUct5mk:bXqMYf8l9n', business: PHOTOGRAPHER, language: 'en', photoWords: 'wedding portrait photographer', sectionNames: ['Hero with call to book'], jobId: 'FrKrUct5mk' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )
    const [photo] = (await source?.([slot('Juniper and Rye Photography', 16 / 9, 'hero', { standIn: true })])) ?? []
    const placed = byId(idOf(photo?.src))
    expect(placed.tags).toEqual(expect.arrayContaining(['wedding']))
    expect(photo?.alt).toBe(aiStockTagsAlt(placed.tags, aiStockProperWords(PHOTOGRAPHER)))
    expect(photo?.alt).not.toMatch(/^[^,]+, [^,]+, [^,]+$/)
    expect(aiStockTagsAlt(byId('1485984').tags)).toBe('A bride in a wedding dress')
  })

  it('describes a placed stand-in by the photo, and no longer hides it as decorative', async () => {
    const page = (): NodesMap =>
      ({
        root: { componentId: 'canvas', nodes: ['sec-0', 'sec-1'] },
        'sec-0': { componentId: 'muiBox', nodes: [] },
        'sec-1': { componentId: 'muiBox', nodes: ['card-0', 'card-1'] },
        'card-0': { componentId: 'muiBox', nodes: ['img-0'] },
        'img-0': { componentId: 'image', props: { alt: 'Film', decorative: true, objectFit: 'cover' }, sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } } },
        'card-1': { componentId: 'muiBox', nodes: ['img-1'] },
        'img-1': { componentId: 'image', props: { alt: 'Digital', decorative: true, objectFit: 'cover' }, sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } } },
      }) as unknown as NodesMap
    const input = { rootId: 'root', sectionIds: ['sec-0', 'sec-1'], sectionNames: ['Hero with call to book', 'Film and digital approach'], seed: 'FrKrUct5mk:bXqMYf8l9n' }
    const props = (nodes: NodesMap, id: string) => (nodes as unknown as Record<string, { props: Record<string, unknown> }>)[id]?.props ?? {}
    // The library down: each card takes a starter, said in its own words.
    const down = fakes()
    down.provider.search = () => Promise.reject(new Error('library down'))
    const started = await aiResolveLayoutPictures(page(), {
      ...input,
      source: aiLayoutStockPhotoSource(
        { hostId: 'nVj_-hl115', uid: 'member-1', seed: input.seed, business: PHOTOGRAPHER, language: 'en', sectionNames: input.sectionNames, jobId: 'FrKrUct5mk' },
        { provider: () => down.provider, ingest: () => down.ingest },
      ),
    })
    for (const id of ['img-0', 'img-1']) {
      const image = props(started, id)
      const starter = Object.values(AI_LAYOUT_STARTER_PHOTOS).find((photo) => photo.src === image['src'])
      expect(starter).toBeDefined()
      expect(image['alt']).toBe(starter?.alt)
      expect(image['decorative']).toBeUndefined()
    }
    // A stock photo for the card: its own words, never "Film", and seen by a screen reader.
    const deps = fakes()
    const [photo] =
      (await aiLayoutStockPhotoSource(
        { hostId: 'nVj_-hl115', uid: 'member-1', seed: input.seed, business: PHOTOGRAPHER, language: 'en', sectionNames: ['Film and digital approach'], jobId: 'FrKrUct5mk' },
        { provider: () => deps.provider, ingest: () => deps.ingest },
      )?.([slot('Film', 4 / 5, 'gallery', { standIn: true, sectionIndex: 0 })])) ?? []
    if (photo?.src) {
      expect(idOf(photo.src)).not.toBe(HORSE)
      expect(photo.alt).toBeTruthy()
      expect(photo.alt).not.toBe('Film')
    } else expect(photo).toEqual(AI_LAYOUT_NO_PHOTO)
  })
})
