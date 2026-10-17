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
  aiLayoutDropEmptyPictures,
  aiLayoutPictureSlots,
  aiResolveLayoutPictures,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockListedCraft,
  aiStockPhotoWordsOf,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSourceTerms,
  aiStockSubjectWords,
  type AiLayoutStockPhotoSourceInput,
  type AiStockJudgement,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { GYM_WIDE, READY_TRAIN_WIDE } from './fixtures/ai-stock-photo-synchronicity-recordings'

/*
 * The beta.261 Synchronicity Gym start on 2026-10-16 (AGL-3856, job
 * pB0Jnr3isL): the guided start's chip "a local service business" as its
 * business type, "local gym owner" as its audience, "Synchronicity Gym" as
 * its name. Its home hero was a black block, an empty image in a black
 * scrim; its closing band, whose words read as "ready train", placed a
 * subway train at a station (Pixabay 8517089). Replayed from what Pixabay
 * answered (fixtures/ai-stock-photo-synchronicity-recordings.ts) through
 * core's seams only: a fake provider and a fake library. No network, no
 * model.
 */

const BUSINESS = 'a local service business'
const NAME = 'Synchronicity Gym'
const AUDIENCE = 'local gym owner'
const SUBWAY_TRAIN = '8517089'

/** The model's words for the hero, and the closing band's stand-in words. */
const HERO_ALT = 'Members training together at Synchronicity Gym'
const BAND_ALT = 'Ready to train with a gym that knows your name'
const SECTIONS = [
  'hero with primary call to action',
  'services overview band',
  'about and why us band',
  'member testimonials band',
  'closing call to action band linking to contact',
]

const ALL = [...READY_TRAIN_WIDE, ...GYM_WIDE]
const BY_ID = new Map(ALL.map((hit) => [hit.id, hit] as const))
const byId = (id: string) => BY_ID.get(id) as StockPhoto
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** Words that say a photo is of a railway or a road, never a gym. */
const TRANSPORT = /\b(?:train|trains|railway|railroad|rail|rails|locomotive|subway|metro|tram|station|transport|vehicle|bus|car)\b/

/**
 * A search's recorded answer by its words and orientation. Production sent
 * "gym" at 900 wide; the hero's 1600-wide "gym" was never sent, and is
 * answered with the same hits here. `everyTrain` answers every search
 * naming "train" with the railway's answer, as the worst Pixabay could do.
 */
function fakes(options: { everyTrain?: boolean } = {}) {
  const asked: string[] = []
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      const wide = request.orientation === 'horizontal'
      const photos =
        request.people || !wide
          ? []
          : request.query === 'ready train' || (options.everyTrain && /\btrain\b/.test(request.query))
            ? READY_TRAIN_WIDE
            : request.query === 'gym'
              ? GYM_WIDE
              : []
      return { photos, cached: true }
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
      const src = `media:x2jmFCnY6k/${id}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: id, src, width: 1280, height: 720 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 720 } : null
    },
  }
  return { provider, ingest, asked, stored }
}

const slot = (alt: string, role: AiLayoutPictureSlot['role'], sectionIndex: number, extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: `img-${sectionIndex}`,
  frameId: `frame-${sectionIndex}`,
  iconId: null,
  alt,
  aspect: 16 / 9,
  sectionIndex,
  role,
  ...extra,
})

const HERO = slot(HERO_ALT, 'hero', 0)
const BAND = slot(BAND_ALT, 'gallery', 4, { standIn: true })

/** The job's inputs, as production holds them. */
const JOB = {
  plan: { language: 'en' },
  inputs: { businessType: BUSINESS, audience: AUDIENCE, businessName: NAME, starter: 'business', siteKind: 'business', pages: 2 },
}

const source = (deps: ReturnType<typeof fakes>, words: Partial<AiLayoutStockPhotoSourceInput> = aiStockPhotoWordsOf(JOB)) =>
  aiLayoutStockPhotoSource(
    { hostId: 'x2jmFCnY6k', uid: 'member-1', seed: 'pB0Jnr3isL:home', business: BUSINESS, sectionNames: SECTIONS, jobId: 'pB0Jnr3isL', ...words },
    { provider: () => deps.provider, ingest: () => deps.ingest },
  )

/** How a slot's hits are judged, as the source judges them. */
const judged = (terms: AiStockSiteTerms, extra: AiStockJudgement): AiStockJudgement => ({
  domain: terms.domain,
  named: terms.named,
  rivals: terms.rivals,
  ...(terms.shun.length ? { shun: terms.shun } : {}),
  ...(terms.shunLead.length ? { shunLead: terms.shunLead } : {}),
  ...extra,
})

beforeEach(() => aiStockForgetJobPhotos())

describe('why the Synchronicity Gym hero was black (AGL-3856, beta.261)', () => {
  it('read "a local service business" as no world at all, so its hero sent no search', () => {
    const terms = aiStockSiteTerms(BUSINESS)
    expect(terms.business).toBe('')
    expect(terms.craft).toBe('')
    expect(terms.domain).toEqual([])
    expect(terms.broad).toEqual([])
    expect(aiStockSearchesFor(HERO, terms, aiStockSubjectWords(HERO_ALT, SECTIONS[0] as string))).toEqual([])
  })

  it('replays production without the name: the hero left empty, the band a railway', async () => {
    const deps = fakes()
    const [hero, band] = (await source(deps, {})?.([HERO, BAND])) ?? []
    expect(hero).toEqual(AI_LAYOUT_NO_PHOTO)
    expect(deps.asked).toEqual(['ready train'])
    expect(byId(idOf(band?.src)).tags.join(', ')).toMatch(TRANSPORT)
  })
})

describe('the Synchronicity Gym read by its name (AGL-3856)', () => {
  it('passes the name and the audience on from the job', () => {
    expect(aiStockPhotoWordsOf(JOB)).toEqual({ language: 'en', kindWords: expect.any(String), kind: 'business', name: NAME, audience: AUDIENCE })
  })

  it('takes a listed craft from a name, else an audience, and never a name that names none', () => {
    expect(aiStockListedCraft(NAME)).toBe('gym')
    expect(aiStockListedCraft(AUDIENCE)).toBe('gym')
    expect(aiStockListedCraft('Hillside')).toBe('')
    expect(aiStockSourceTerms({ business: BUSINESS, name: NAME }).craft).toBe('gym')
    expect(aiStockSourceTerms({ business: BUSINESS, name: 'Synchronicity', audience: AUDIENCE }).craft).toBe('gym')
    // A business type that names its world keeps it, whatever the name says.
    expect(aiStockSourceTerms({ business: 'a ceramic artist who makes stoneware bowls', name: 'Iron Gym Pottery' }).craft).toBe('ceramic')
    // Neither names one: the site stays without a world, as before.
    expect(aiStockSourceTerms({ business: BUSINESS, name: 'Hillside', audience: 'neighbors' }).domain).toEqual([])
  })

  it('reads a gym: its world, its broad searches, and the business type still named', () => {
    const terms = aiStockSourceTerms({ business: BUSINESS, name: NAME, audience: AUDIENCE })
    expect(terms.domain).toEqual(expect.arrayContaining(['gym', 'fitness', 'workout', 'barbell']))
    expect(terms.broad).toEqual(['gym', 'weight training'])
    expect(terms.named).toEqual(expect.arrayContaining(['local', 'service', 'business', 'gym']))
    expect(terms.shun).toEqual(expect.arrayContaining(['railway', 'railroad', 'subway', 'locomotive']))
  })

  it('never scores the subway train, nor any railway the band was answered, for a gym', () => {
    const terms = aiStockSourceTerms({ business: BUSINESS, name: NAME })
    const band = judged(terms, { subject: 'ready train', strict: true })
    expect(aiStockRelevance(byId(SUBWAY_TRAIN), band)).toBe(0)
    expect(aiStockRelevance(byId(SUBWAY_TRAIN), judged(terms, { subject: '' }))).toBe(0)
    for (const hit of READY_TRAIN_WIDE)
      if (TRANSPORT.test(hit.tags.slice(0, 5).join(', '))) expect(aiStockRelevance(hit, band)).toBe(0)
  })

  it('fills the hero and the band with photos of a gym, never a railway', async () => {
    const deps = fakes()
    const [hero, band] = (await source(deps)?.([HERO, BAND])) ?? []
    expect(deps.asked[0]).toBe('gym')
    for (const photo of [hero, band]) {
      expect(photo?.src).toMatch(/^media:x2jmFCnY6k\//)
      const placed = byId(idOf(photo?.src))
      expect(placed.tags.join(', ')).toMatch(/gym|fitness|workout|training|dumbbell|weight/)
      expect(placed.tags.join(', ')).not.toMatch(TRANSPORT)
    }
    expect(idOf(hero?.src)).not.toBe(idOf(band?.src))
  })

  it('places no railway even when every search naming "train" is answered with one', async () => {
    const deps = fakes({ everyTrain: true })
    const [, band] = (await source(deps)?.([HERO, BAND])) ?? []
    expect(deps.asked).toEqual(expect.arrayContaining(['gym ready train', 'gym train']))
    expect(idOf(band?.src)).not.toBe(SUBWAY_TRAIN)
    expect(byId(idOf(band?.src)).tags.join(', ')).not.toMatch(TRANSPORT)
  })

  it('leaves a real railway business its trains', () => {
    const terms = aiStockSiteTerms('A model railroad shop selling trains and track')
    expect(terms.shun).not.toContain('railroad')
    expect(aiStockRelevance(byId('797072'), judged(terms, { subject: 'train', strict: true }))).toBeGreaterThan(0)
  })
})

describe('a cover left without a photo (AGL-3856, beta.261)', () => {
  /** The home page's hero and closing band as production stored them, decoded. */
  const page = (): NodesMap =>
    ({
      root: { componentId: 'canvas', nodes: ['sec-0', 'sec-4'] },
      'sec-0': { componentId: 'section', props: { colorScheme: 'dark', underHeader: true }, sx: { position: 'relative', overflow: 'hidden' }, nodes: ['frame-0', 'container-0'] },
      'frame-0': {
        componentId: 'muiBox',
        sx: { position: 'absolute', overflow: 'hidden', bgcolor: 'common.black', top: 0, left: 0, width: '100%', height: '100%' },
        nodes: ['img-0'],
      },
      'img-0': { componentId: 'image', props: { alt: HERO_ALT, objectFit: 'cover', width: '100%', height: '100%' }, sx: { opacity: 0.42 } },
      'container-0': { componentId: 'muiContainer', sx: { position: 'relative', zIndex: 1 }, nodes: [] },
      'sec-4': { componentId: 'section', props: { colorScheme: 'dark' }, sx: { position: 'relative', overflow: 'hidden' }, nodes: ['frame-4', 'container-4'] },
      'frame-4': {
        componentId: 'muiBox',
        sx: { position: 'absolute', overflow: 'hidden', bgcolor: 'common.black', top: 0, left: 0, width: '100%', height: '100%' },
        nodes: ['img-4'],
      },
      'img-4': { componentId: 'image', props: { alt: BAND_ALT, decorative: true, objectFit: 'cover', width: '100%', height: '100%' }, sx: { opacity: 0.42 } },
      'container-4': { componentId: 'muiContainer', sx: { position: 'relative', zIndex: 1 }, nodes: [] },
    }) as unknown as NodesMap
  const input = { rootId: 'root', sectionIds: ['sec-0', 'sec-1', 'sec-2', 'sec-3', 'sec-4'], sectionNames: SECTIONS, seed: 'pB0Jnr3isL:home' }
  const map = (nodes: NodesMap) => nodes as unknown as Record<string, { nodes?: string[]; props?: Record<string, unknown> }>
  const BAND_PHOTO: AiLayoutPicturePhoto = { src: 'media:x2jmFCnY6k/2604149', width: 1280, height: 720, alt: 'A man exercising in a gym' }

  it('takes the black scrim out, so the hero shows its own dark band with its words', async () => {
    const nodes = await aiResolveLayoutPictures(page(), { ...input, source: async () => [AI_LAYOUT_NO_PHOTO, BAND_PHOTO] })
    expect(map(nodes)['frame-0']).toBeUndefined()
    expect(map(nodes)['img-0']).toBeUndefined()
    expect(map(nodes)['sec-0']?.nodes).toEqual(['container-0'])
    // Still pinned dark, which paints the dark scheme's background and text under its words.
    expect(map(nodes)['sec-0']?.props?.['colorScheme']).toBe('dark')
    // The band's photo is placed under its scrim, as before.
    expect(map(nodes)['sec-4']?.nodes).toEqual(['frame-4', 'container-4'])
    expect(map(nodes)['img-4']?.props?.['src']).toBe(BAND_PHOTO.src)
  })

  it('keeps every cover a starter fills, where the library could not be asked', async () => {
    const nodes = await aiResolveLayoutPictures(page(), { ...input, source: async () => [null, null] })
    for (const id of ['img-0', 'img-4']) expect(String(map(nodes)[id]?.props?.['src'])).toMatch(/^\/_static\/starter\//)
    expect(map(nodes)['sec-0']?.nodes).toEqual(['frame-0', 'container-0'])
  })

  it('takes out an empty picture card too, and keeps one a starter fills', async () => {
    const card = {
      ...map(page()),
      'frame-4': { componentId: 'muiBox', sx: { position: 'relative', aspectRatio: '4 / 3', bgcolor: 'action.hover' }, nodes: ['img-4'] },
    } as unknown as NodesMap
    const slots = aiLayoutPictureSlots(card, 'root', { ids: input.sectionIds, names: SECTIONS })
    const dropped = aiLayoutDropEmptyPictures(card, slots, [null, null], input.sectionIds)
    expect(map(dropped)['frame-4']).toBeUndefined()
    expect(map(dropped)['sec-4']?.nodes).toEqual(['container-4'])
    const started = await aiResolveLayoutPictures(card, { ...input, source: async () => [null, null] })
    expect(map(started)['frame-4']?.nodes).toEqual(['img-4'])
  })
})
