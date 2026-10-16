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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type {
  PluginMediaIngest,
  PluginMediaIngestRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type {
  StockPhoto,
  StockPhotoProvider,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
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
  aiStockRelevance,
  aiStockSiteTerms,
} from './ai-layout-stock-photos'
import {
  CATERER,
  FAMILY_RUN_AUSTIN_CATERER,
} from './fixtures/ai-stock-photo-copper-kettle-recordings'

/*
 * The beta.257 Copper Kettle Catering start (AGL-3831, job mRxC_v18aH),
 * replayed from what Pixabay answered its home hero. The hero was held to
 * the craft "caterer" while catering photos are tagged "catering", "buffet"
 * and "bbq", so none of its eighty hits was accepted, and the page took the
 * starters' pottery workbench under the model's words for a brisket spread.
 * Through core's seams only: a fake provider answering each search with its
 * recorded answer (a search the start never sent answers nothing) and a fake
 * library. No network, no model.
 */

const BUSINESS =
  'Family-run Austin caterer: Texas barbecue and Tex-Mex for weddings, office lunches and parties'

/** What the model wrote for the hero, before any photo was found. */
const HERO_ALT =
  'A spread of smoked brisket, fajitas and sides on a long catering table'

const RECORDED: Record<string, StockPhoto[]> = {
  'family-run austin caterer': FAMILY_RUN_AUSTIN_CATERER,
  caterer: CATERER,
}

const BY_ID = new Map(
  Object.values(RECORDED).flatMap((hits) =>
    hits.map((hit) => [hit.id, hit] as const),
  ),
)

/** The plane at Düsseldorf airport, tagged "catering" first. */
const AIRPORT = '210403'

/** The job's seed for its home page, as the page step builds it. */
const SEED = 'mRxC_v18aH:ugb5MGNC_2'

function fakes(
  answer: (query: string) => StockPhoto[] | Promise<StockPhoto[]>,
) {
  const asked: string[] = []
  const stored: PluginMediaIngestRequest[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: await answer(request.query), cached: true }
    },
    download: async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      contentType: 'image/jpeg',
    }),
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
      const src = `media:amI7YqunEI/${id}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: id, src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src
        ? {
            mediaId: src.split('/').pop() as string,
            src,
            width: 1280,
            height: 853,
          }
        : null
    },
  }
  return { provider, ingest, asked, stored }
}

const sourceOf = (
  deps: ReturnType<typeof fakes>,
  extra: { language?: string } = {},
) =>
  aiLayoutStockPhotoSource(
    {
      hostId: 'amI7YqunEI',
      uid: 'member-1',
      seed: SEED,
      business: BUSINESS,
      sectionNames: ['Hero'],
      jobId: 'mRxC_v18aH',
      ...extra,
    },
    { provider: () => deps.provider, ingest: () => deps.ingest },
  )

/** The hero as the page stored it: a cover laid over its whole section. */
const HERO: AiLayoutPictureSlot = {
  imageId: 'heroImage',
  frameId: 'heroCover',
  iconId: null,
  alt: HERO_ALT,
  aspect: 16 / 9,
  sectionIndex: 0,
  role: 'hero',
}

/** The home page's hero band, in the shape production stored it (version Qmq-l2I6sg). */
function homePage(): NodesMap {
  return {
    [CANVAS_ROOT_ELEMENT_ID]: {
      id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      nodes: ['sec-0'],
    },
    'sec-0': {
      id: 'sec-0',
      componentId: 'muiBox',
      props: { component: 'section' },
      nodes: ['heroCover', 'heroTitle'],
    },
    heroCover: {
      id: 'heroCover',
      componentId: 'muiBox',
      props: {},
      sx: {
        position: 'absolute',
        overflow: 'hidden',
        bgcolor: 'common.black',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
      },
      nodes: ['heroImage'],
    },
    heroImage: {
      id: 'heroImage',
      componentId: 'image',
      props: {
        alt: HERO_ALT,
        objectFit: 'cover',
        width: '100%',
        height: '100%',
      },
      sx: { opacity: 0.42 },
      nodes: [],
    },
    heroTitle: {
      id: 'heroTitle',
      componentId: 'muiTypography',
      props: { children: 'Copper Kettle Catering' },
      nodes: [],
    },
  } as unknown as NodesMap
}

const pageInput = (source: ReturnType<typeof sourceOf>, language?: string) => ({
  rootId: CANVAS_ROOT_ELEMENT_ID,
  sectionIds: ['sec-0'],
  sectionNames: ['Hero'],
  seed: SEED,
  source,
  ...(language ? { language } : {}),
})

const heroOf = (nodes: NodesMap) =>
  (nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[
    'heroImage'
  ]?.props ?? {}

const STARTERS = Object.values(AI_LAYOUT_STARTER_PHOTOS)
const isStarter = (src: unknown) => STARTERS.some((photo) => photo.src === src)

describe('the Copper Kettle Catering hero (AGL-3831, beta.257)', () => {
  beforeEach(() => aiStockForgetJobPhotos())

  it('reads a caterer’s world by how catering photos are tagged, and its barbecue', () => {
    const terms = aiStockSiteTerms(BUSINESS)
    expect(terms.craft).toBe('caterer')
    expect(terms.core).toEqual(
      expect.arrayContaining(['caterer', 'catering', 'barbecue', 'bbq']),
    )
    expect(terms.domain).toEqual(
      expect.arrayContaining(['catering', 'buffet', 'food', 'brisket']),
    )
    expect(terms.broad).toEqual(expect.arrayContaining(['caterer', 'barbecue']))
  })

  it('never takes an airline’s catering, nor an Austin car, for the hero', () => {
    const terms = aiStockSiteTerms(BUSINESS)
    const judgement = {
      subject: '',
      domain: terms.domain,
      category: terms.core,
      first: true,
      named: terms.named,
      rivals: terms.rivals,
    }
    expect(aiStockRelevance(BY_ID.get(AIRPORT) as StockPhoto, judgement)).toBe(
      0,
    )
    for (const hit of FAMILY_RUN_AUSTIN_CATERER.filter((photo) =>
      photo.tags.some((tag) => /austin/.test(tag)),
    ))
      expect(aiStockRelevance(hit, judgement)).toBe(0)
  })

  it('fills the hero from the recorded answers with a photo of catering food, described by its own words', async () => {
    const deps = fakes((query) => RECORDED[query] ?? [])
    const [photo] = (await sourceOf(deps)?.([HERO])) ?? []
    expect(photo?.src).toMatch(/^media:amI7YqunEI\//)
    const id = String(photo?.src.split('/').pop())
    expect(id).not.toBe(AIRPORT)
    const tags = BY_ID.get(id)?.tags ?? []
    // What the photo is OF: catering food, its first tag naming that world.
    expect(tags[0]).toMatch(/^(catering|buffet|food|meal|bbq|barbecue)$/)
    expect(tags).toEqual(expect.arrayContaining(['catering']))
    // The model's brisket spread is not what the library holds; the photo says what it shows.
    expect(photo?.alt).toBeTruthy()
    expect(photo?.alt).not.toBe(HERO_ALT)
    expect(deps.asked.slice(0, 2)).toEqual([
      'family-run austin caterer',
      'caterer',
    ])
    expect(deps.stored).toHaveLength(1)
  })

  it('publishes the home hero with that library photo, never a starter', async () => {
    const deps = fakes((query) => RECORDED[query] ?? [])
    const page = await aiResolveLayoutPictures(
      homePage(),
      pageInput(sourceOf(deps)),
    )
    const hero = heroOf(page)
    expect(hero['src']).toMatch(/^media:amI7YqunEI\//)
    expect(isStarter(hero['src'])).toBe(false)
    expect(hero['alt']).not.toBe(HERO_ALT)
    expect(hero['loading']).toBe('eager')
  })

  it('leaves the hero without a photo, not a starter, when the library answers and nothing fits', async () => {
    // Only the Austin cars, parks and roses: the library is up, and none is a caterer's.
    const offTopic = FAMILY_RUN_AUSTIN_CATERER.filter(
      (photo) => !photo.tags.some((tag) => /cater/.test(tag)),
    )
    const deps = fakes(() => offTopic)
    const source = sourceOf(deps)
    expect(await source?.([HERO])).toEqual([AI_LAYOUT_NO_PHOTO])
    const page = await aiResolveLayoutPictures(
      homePage(),
      pageInput(sourceOf(fakes(() => offTopic))),
    )
    const hero = heroOf(page)
    // The cover keeps its section's own band: no source, nothing drawn on the published page.
    expect(hero['src']).toBeUndefined()
    expect(JSON.stringify(page)).not.toContain('/_static/starter/')
    expect(deps.stored).toHaveLength(0)
  })

  it('takes a starter described by its own words when the library is down (the beta.257 shape, its alt corrected)', async () => {
    const deps = fakes(() => Promise.reject(new Error('library down')))
    const page = await aiResolveLayoutPictures(
      homePage(),
      pageInput(sourceOf(deps)),
    )
    const hero = heroOf(page)
    // The same starter production placed for this job's home page.
    expect(hero['src']).toBe(AI_LAYOUT_STARTER_PHOTOS.craft.src)
    // Its alt is the workbench it shows, never the brisket the model wrote.
    expect(hero['alt']).toBe(AI_LAYOUT_STARTER_PHOTOS.craft.alt)
    expect(hero['alt']).not.toBe(HERO_ALT)
  })

  it('takes a starter described by its own words on a deployment without a stock library', async () => {
    const page = await aiResolveLayoutPictures(homePage(), pageInput(null))
    const hero = heroOf(page)
    expect(isStarter(hero['src'])).toBe(true)
    expect(hero['alt']).toBe(
      STARTERS.find((photo) => photo.src === hero['src'])?.alt,
    )
  })

  it('says a starter is an illustrative photo on a site in another language', async () => {
    const page = await aiResolveLayoutPictures(
      homePage(),
      pageInput(null, 'es'),
    )
    const hero = heroOf(page)
    expect(isStarter(hero['src'])).toBe(true)
    expect(hero['alt']).toBe('Foto ilustrativa')
  })
})
