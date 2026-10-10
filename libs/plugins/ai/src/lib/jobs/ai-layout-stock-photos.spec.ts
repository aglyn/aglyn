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
  StockPhotoSearchRequest,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiLayoutPageCheck } from './ai-job-page-language'
import {
  AI_LAYOUT_STARTER_PHOTOS,
  aiLayoutPictureSlots,
  aiResolveLayoutPictures,
} from '../layout-language/ai-layout-pictures'
import {
  AI_STOCK_PHOTO_AVOID_INPUT,
  AI_STOCK_PHOTO_PAGES_INPUT,
  aiLayoutStockPhotoSource,
  aiStockBusinessWords,
  aiStockCraftWords,
  aiStockForgetJobPhotos,
  aiStockOrientation,
  aiStockPick,
  aiStockPlacedSrcs,
  aiStockRank,
  aiStockRelevance,
  aiStockObjectWord,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockStem,
  aiStockSubjectWords,
} from './ai-layout-stock-photos'
import { aiJobPagesPlacedPhotos } from './ai-job-page-step'
import {
  CANDLE_GIFT_SET_ONLINE,
  NESTING_BOWL_SET_PORTFOLIO,
  PORTFOLIO,
  SERVING_BOWL_PORTFOLIO,
  TALL_BUD_VASE_PORTFOLIO,
} from './fixtures/ai-stock-photo-pixabay-recordings'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiCompileLayoutPage,
  type AiLayoutPagePlan,
} from '../layout-language/ai-layout-compiler'
import { aiLayoutDesignChoices } from '../layout-language/ai-layout-design'
import type { AiLayoutSection } from '../layout-language/ai-layout-language'
import { aiLayoutStoredTree } from '../layout-language/ai-layout-store'

/**
 * A language page's pictures from a stock photo library (AGL-3660), through
 * core's seams only: the provider is a fake answering recorded-shape hits,
 * and the media door a fake library. No network.
 */

const block = (kind: string, text: string, col = -1) => ({
  kind,
  col,
  text,
  to: '',
  icon: '',
  style: 'none',
  items: [],
})

const SECTIONS = [
  { name: 'Hero', uses: [], items: 0 },
  { name: 'Meet your teacher', uses: [], items: 0 },
  { name: 'Classes', uses: [], items: 0 },
]
const SECTION_IDS = ['sec-0', 'sec-1', 'sec-2']

/** A stored three-section yoga studio page with a picture in each section. */
function yogaPage(): NodesMap {
  const result = aiLayoutPageCheck({
    screen: {
      title: 'Home',
      slug: '/',
      template: null,
      sections: SECTIONS,
    } as never,
    sectionIds: SECTION_IDS,
    targets: {
      pageId: 'p0',
      pages: [],
      homeIds: [],
      forms: [],
      formPageId: null,
      components: [],
      facts: 'A yoga studio.',
    } as never,
    context: {
      screenIds: [],
      formIds: [],
      componentIds: [],
      codeBuilt: true,
      scrollTargetIds: SECTION_IDS,
    },
    reusableComponents: false,
  })({
    sections: [
      {
        band: 'plain',
        align: 'start',
        cols: [6, 6],
        blocks: [
          block('heading', 'Breathe, move, rest', 0),
          block('lede', 'Small classes in a sunlit room.', 0),
          block('image', 'A calm yoga class in a bright studio', 1),
        ],
      },
      {
        band: 'soft',
        align: 'start',
        cols: [],
        blocks: [
          block('heading', 'Meet your teacher'),
          block('text', 'Teaching since 2010.'),
          block('image', 'The teacher smiling on a mat'),
        ],
      },
      {
        band: 'plain',
        align: 'start',
        cols: [],
        blocks: [
          block('heading', 'Classes'),
          block('text', 'Vinyasa and restorative.'),
          block('image', 'Students stretching at sunrise'),
        ],
      },
    ],
  })
  if (!result.value) throw new Error(JSON.stringify(result.violations))
  return result.value.nodes
}

const photo = (
  id: number,
  width = 1280,
  height = 853,
  tags = ['yoga'],
): StockPhoto & { downloadUrl: string } => ({
  provider: 'pixabay',
  id: String(id),
  width,
  height,
  pageUrl: `https://pixabay.com/photos/yoga-${id}/`,
  photographer: `user${id}`,
  photographerUrl: `https://pixabay.com/users/user${id}-${id}/`,
  tags,
  downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
})

/** Recorded-shape hits per query; anything else finds nothing. */
const HITS: Record<string, StockPhoto[]> = {
  'yoga studio': [photo(1), photo(2), photo(3), photo(4)],
  'yoga studio teacher': [photo(11, 853, 1280), photo(12, 853, 1280)],
  'yoga students stretching': [],
  'yoga stretching': [
    photo(21, 1280, 853, ['yoga', 'stretch', 'stretching']),
    photo(1),
  ],
}

function fakeProvider(overrides: Partial<StockPhotoProvider> = {}) {
  const searches: StockPhotoSearchRequest[] = []
  const downloads: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      searches.push(request)
      return { photos: HITS[request.query] ?? [], cached: false }
    },
    download: async (found) => {
      downloads.push(found.id)
      return {
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        contentType: 'image/jpeg',
      }
    },
    credit: (found) => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: `Photo by ${found.photographer} on Pixabay.`,
    }),
    ...overrides,
  }
  return { provider, searches, downloads }
}

function fakeLibrary(held: Record<string, string> = {}, refuse = false) {
  const stored: PluginMediaIngestRequest[] = []
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      if (refuse)
        return {
          ok: false,
          status: 403,
          reason: 'Storage limit reached (250 MB)',
        }
      stored.push(request)
      return {
        ok: true,
        mediaId: `m${stored.length}`,
        src: `media:host-1/m${stored.length}`,
        width: 1280,
        height: 853,
      }
    },
    findStockPhoto: async ({ sourceKey }) =>
      held[sourceKey]
        ? {
            mediaId: held[sourceKey],
            src: `media:host-1/${held[sourceKey]}`,
            width: 1280,
            height: 853,
          }
        : null,
  }
  return { ingest, stored }
}

const INPUT = {
  hostId: 'host-1',
  uid: 'member-1',
  seed: 'job-1:home',
  business: 'A family-owned yoga studio in Austin for busy parents',
  sectionNames: SECTIONS.map((section) => section.name),
}

/** The page's image ids in document order: the slots of the page as compiled. */
const PAGE = yogaPage()
const IMAGE_IDS = aiLayoutPictureSlots(PAGE, CANVAS_ROOT_ELEMENT_ID, {
  ids: SECTION_IDS,
  names: SECTIONS.map((section) => section.name),
}).map((slot) => slot.imageId)

/** Each picture's source, hero first. */
const srcs = (nodes: NodesMap) =>
  IMAGE_IDS.map(
    (id) =>
      (nodes as unknown as Record<string, { props?: { src?: string } }>)[id]
        ?.props?.src,
  )

const STARTER_SRCS = new Set<string>(
  Object.values(AI_LAYOUT_STARTER_PHOTOS).map((starter) => starter.src),
)

describe('the stock photo searches (AGL-3660)', () => {
  it('reads the kind of business from the head of the business type', () => {
    expect(
      aiStockBusinessWords(
        'A family-owned yoga studio in Austin for busy parents',
      ),
    ).toBe('yoga studio')
    // The kind of SITE is never the business (the Juniper Clay and Willow Wick starts of 2026-10-10).
    expect(
      aiStockBusinessWords(
        'a portfolio for a ceramic artist who makes stoneware bowls, mugs and vases',
      ),
    ).toBe('ceramic artist')
    expect(
      aiStockBusinessWords(
        'a small-batch candle shop selling hand-poured soy candles online',
      ),
    ).toBe('candle shop')
    expect(aiStockBusinessWords('Ceramic pottery classes and a shop')).toBe(
      'ceramic pottery classes',
    )
    expect(
      aiStockBusinessWords(
        '24/7 towing — call 555-123-4567 or tow@example.com',
      ),
    ).toBe('towing')
    expect(aiStockBusinessWords('')).toBe('')
  })

  it("reads a picture's subject from its alt text, else its section", () => {
    expect(
      aiStockSubjectWords('A potter shaping a clay bowl on a wheel', 'Gallery'),
    ).toBe('shaping clay bowl')
    expect(aiStockSubjectWords('', 'Our gallery')).toBe('gallery')
  })

  it('asks for the shape of the frame and, for an about picture, people', () => {
    expect(aiStockOrientation(16 / 9)).toBe('horizontal')
    expect(aiStockOrientation(3 / 4)).toBe('vertical')
    expect(aiStockOrientation(1)).toBe('any')
    const yoga = aiStockSiteTerms(
      'A family-owned yoga studio in Austin for busy parents',
    )
    expect(yoga).toMatchObject({
      business: 'yoga studio',
      craft: 'yoga',
      domain: ['yoga'],
      broad: ['yoga studio', 'yoga'],
      // No craft kin, so no maker at work; its words let in what they name ("parents").
      making: [],
    })
    expect(yoga.named).toEqual(expect.arrayContaining(['yoga', 'parent']))
    expect(
      aiStockSearchesFor(
        { role: 'hero', alt: 'x', aspect: 16 / 9 },
        yoga,
        'calm class',
      ),
    ).toEqual([
      {
        query: 'yoga studio',
        orientation: 'horizontal',
        minWidth: 1600,
        broad: true,
      },
      { query: 'yoga', orientation: 'horizontal', minWidth: 1600, broad: true },
    ])
    expect(
      aiStockSearchesFor(
        { role: 'about', alt: 'x', aspect: 3 / 4 },
        yoga,
        'teacher',
      ),
    ).toEqual([
      {
        query: 'yoga studio teacher',
        orientation: 'vertical',
        minHeight: 900,
        people: true,
        broad: true,
      },
      {
        query: 'yoga studio',
        orientation: 'vertical',
        minHeight: 900,
        people: true,
        broad: true,
      },
      {
        query: 'yoga studio',
        orientation: 'vertical',
        minHeight: 900,
        broad: true,
      },
      { query: 'yoga', orientation: 'vertical', minHeight: 900, broad: true },
    ])
    // No business words: the subject, then its object, each asked once.
    expect(
      aiStockSearchesFor(
        { role: 'gallery', alt: 'x', aspect: 1 },
        aiStockSiteTerms(''),
        'bowls',
      ),
    ).toEqual([
      { query: 'bowls', orientation: 'any', minWidth: 900 },
      { query: 'bowl', orientation: 'any', minWidth: 900 },
    ])
  })

  it('picks by the seed among hits not on the page, so sites differ and a job repeats itself', () => {
    const hits = [photo(1), photo(2), photo(3), photo(4), photo(5), photo(6)]
    const picks = new Set(
      Array.from(
        { length: 40 },
        (_unused, index) =>
          aiStockPick(hits, new Set(), `job-${index}:home:0:yoga`)?.id,
      ),
    )
    expect(picks.size).toBeGreaterThan(3)
    expect(aiStockPick(hits, new Set(), 'job-1')?.id).toBe(
      aiStockPick(hits, new Set(), 'job-1')?.id,
    )
    expect(
      aiStockPick(
        hits,
        new Set(hits.slice(1).map((hit) => `pixabay:${hit.id}`)),
        'any',
      )?.id,
    ).toBe('1')
    expect(
      aiStockPick(hits, new Set(hits.map((hit) => `pixabay:${hit.id}`)), 'any'),
    ).toBeNull()
  })
})

describe('a language page filled from a stock photo library (AGL-3660)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('copies a fitting photo into the site library for every slot, credited, and names the asset', async () => {
    const { provider, searches, downloads } = fakeProvider()
    const { ingest, stored } = fakeLibrary()
    const source = aiLayoutStockPhotoSource(INPUT, {
      provider: () => provider,
      ingest: () => ingest,
    })
    const nodes = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source,
    })
    expect(srcs(nodes)).toEqual([
      'media:host-1/m1',
      'media:host-1/m2',
      'media:host-1/m3',
    ])
    expect(searches.map((search) => search.query)).toEqual([
      'yoga studio',
      'yoga studio teacher',
      'yoga students stretching',
      'yoga stretching',
    ])
    expect(searches[1]).toMatchObject({ people: true })
    // Three different photos, each downloaded once.
    expect(new Set(downloads).size).toBe(3)
    expect(stored[0]).toMatchObject({
      hostId: 'host-1',
      uid: 'member-1',
      contentType: 'image/jpeg',
      alt: 'A calm yoga class in a bright studio',
      fileName: expect.stringMatching(/^pixabay-\d+\.jpg$/),
      description: expect.stringMatching(/^Photo by user\d+ on Pixabay\.$/),
      stockPhoto: {
        key: expect.stringMatching(/^pixabay:\d+$/),
        provider: 'pixabay',
        providerLabel: 'Pixabay',
        pageUrl: expect.stringMatching(/^https:\/\/pixabay\.com\/photos\//),
        photographer: expect.stringMatching(/^user\d+$/),
        license: 'Pixabay Content License',
        attributionRequired: false,
        query: 'yoga studio',
      },
    })
    // The hero's photo is never repeated below it.
    const keys = stored.map((request) => request.stockPhoto?.key)
    expect(new Set(keys).size).toBe(3)
  })

  it('reuses a photo the site already holds instead of storing a second copy', async () => {
    const { provider, downloads } = fakeProvider()
    // Every hit the hero could pick is already in the library.
    const held = Object.fromEntries(
      [1, 2, 3, 4].map((id) => [`pixabay:${id}`, `held${id}`]),
    )
    const { ingest, stored } = fakeLibrary(held)
    const source = aiLayoutStockPhotoSource(INPUT, {
      provider: () => provider,
      ingest: () => ingest,
    })
    const nodes = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source,
    })
    expect(srcs(nodes)[0]).toMatch(/^media:host-1\/held[1-4]$/)
    expect(
      stored.every(
        (request) =>
          !['pixabay:1', 'pixabay:2', 'pixabay:3', 'pixabay:4'].includes(
            String(request.stockPhoto?.key),
          ),
      ),
    ).toBe(true)
    expect(downloads).not.toContain('1')
  })

  it('falls back to the starter photos where the library refuses, finds nothing or fails', async () => {
    const refusing = fakeLibrary({}, true)
    const { provider, downloads } = fakeProvider()
    const nodes = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(INPUT, {
        provider: () => provider,
        ingest: () => refusing.ingest,
      }),
    })
    expect(srcs(nodes).every((src) => STARTER_SRCS.has(String(src)))).toBe(true)
    // A refusal to store holds for the page: the copies already under way
    // end there, and no slot tries another hit after it.
    expect(downloads.length).toBeLessThanOrEqual(3)
    expect(new Set(downloads).size).toBe(downloads.length)

    const failing = fakeProvider({
      search: async () => {
        throw new Error('library down')
      },
    })
    const fallback = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(INPUT, {
        provider: () => failing.provider,
        ingest: () => fakeLibrary().ingest,
      }),
    })
    expect(srcs(fallback).every((src) => STARTER_SRCS.has(String(src)))).toBe(
      true,
    )

    const nothing = fakeProvider({ search: async () => null })
    const empty = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(INPUT, {
        provider: () => nothing.provider,
        ingest: () => fakeLibrary().ingest,
      }),
    })
    expect(srcs(empty).every((src) => STARTER_SRCS.has(String(src)))).toBe(true)
  })

  it('stops asking once the step is out of time, and the rest take starters', async () => {
    const { provider, searches } = fakeProvider()
    const controller = new AbortController()
    controller.abort()
    const nodes = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(
        { ...INPUT, signal: controller.signal },
        { provider: () => provider, ingest: () => fakeLibrary().ingest },
      ),
    })
    expect(searches).toHaveLength(0)
    expect(srcs(nodes).every((src) => STARTER_SRCS.has(String(src)))).toBe(true)
  })

  it('builds no source without a library or a media door, which leaves the starters', () => {
    const { provider } = fakeProvider()
    expect(
      aiLayoutStockPhotoSource(INPUT, {
        provider: () => null,
        ingest: () => fakeLibrary().ingest,
      }),
    ).toBeNull()
    expect(
      aiLayoutStockPhotoSource(INPUT, {
        provider: () => provider,
        ingest: () => null,
      }),
    ).toBeNull()
    // And core's own, in a process where nothing registered either.
    expect(aiLayoutStockPhotoSource(INPUT)).toBeNull()
  })
})

describe('a designed page’s pictures ask the stock photo library too (AGL-3660)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  /** A yoga home the designer opens on a full-bleed photo cover the model never described. */
  function designedHome(): {
    nodes: NodesMap
    sectionIds: string[]
    names: string[]
  } {
    let seed = 1
    while (
      aiLayoutDesignChoices({ kind: 'yoga', seed, home: true }).hero !== 'cover'
    )
      seed += 1
    const sections: AiLayoutSection[] = [
      {
        band: 'plain',
        align: 'center',
        blocks: [
          { kind: 'heading', text: 'Breathe, move, rest', style: 'large' },
          { kind: 'lede', text: 'Small classes in a sunlit room.' },
          { kind: 'button', text: 'Book a class', to: 'page:pg-contact' },
        ],
      },
      {
        band: 'soft',
        blocks: [
          { kind: 'heading', text: 'Classes' },
          { kind: 'text', text: 'Vinyasa and restorative, every morning.' },
        ],
      },
    ]
    const plan: AiLayoutPagePlan = {
      title: 'Home',
      sections: [
        { name: 'Hero', uses: [], items: 0 },
        { name: 'Classes', uses: [], items: 0 },
      ],
    }
    const sectionIds = ['sec-1', 'sec-2']
    const targets = {
      pageId: 'pg-home',
      pages: [
        { id: 'pg-home', label: 'Home', slug: '/' },
        { id: 'pg-contact', label: 'Contact', slug: '/contact' },
      ],
      homeIds: ['pg-home'],
      forms: [],
      formPageId: null,
      components: [],
      facts: 'A yoga studio.',
    }
    const compiled = aiCompileLayoutPage(sections, plan, targets as never, {
      reusableComponents: false,
      sectionIds,
      design: { kind: 'yoga', seed, home: true },
    })
    const context = {
      screenIds: ['pg-home', 'pg-contact'],
      homeScreenIds: ['pg-home'],
      scrollTargetIds: sectionIds,
      reusableComponents: false,
      repeatsCompiled: true,
      codeBuilt: true,
    }
    const stored = aiLayoutStoredTree(
      compiled.tree,
      'screen',
      context,
      sectionIds,
    )
    if (stored.ok === false) throw new Error(stored.error)
    return {
      nodes: stored.nodes,
      sectionIds,
      names: plan.sections.map((section) => section.name),
    }
  }

  it('fills the designer’s decorative hero with the provider’s photo, searched wide, and the rest from it or the starters', async () => {
    const home = designedHome()
    const slots = aiLayoutPictureSlots(home.nodes, CANVAS_ROOT_ELEMENT_ID, {
      ids: home.sectionIds,
      names: home.names,
    })
    const hero = slots.find((slot) => slot.sectionIndex === 0)
    expect(hero).toMatchObject({ role: 'hero' })
    const props = (id: string) =>
      (
        home.nodes as unknown as Record<
          string,
          { props?: Record<string, unknown> }
        >
      )[id]?.props
    // A stand-in no one described: decorative, and no source until it is filled.
    expect(props(hero?.imageId as string)?.['decorative']).toBe(true)
    expect(props(hero?.imageId as string)?.['src']).toBeUndefined()
    // A cover fills a wide band, so its photo is searched for landscape.
    expect(hero?.aspect).toBeGreaterThan(1.15)

    const { provider, searches } = fakeProvider()
    const { ingest, stored } = fakeLibrary()
    const nodes = await aiResolveLayoutPictures(home.nodes, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: home.sectionIds,
      sectionNames: home.names,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(
        { ...INPUT, sectionNames: home.names },
        { provider: () => provider, ingest: () => ingest },
      ),
    })
    const filled = (
      nodes as unknown as Record<string, { props?: Record<string, unknown> }>
    )[hero?.imageId as string]?.props
    expect(filled?.['src']).toBe('media:host-1/m1')
    expect(filled?.['loading']).toBe('eager')
    expect(searches[0]).toMatchObject({
      query: 'yoga studio',
      orientation: 'horizontal',
      minWidth: 1600,
    })
    expect(stored[0]?.stockPhoto?.query).toBe('yoga studio')
    // Every other slot is filled too: by the library, or a starter where it found nothing.
    for (const slot of slots) {
      const src = String(
        (
          nodes as unknown as Record<
            string,
            { props?: Record<string, unknown> }
          >
        )[slot.imageId]?.props?.['src'],
      )
      expect(src.startsWith('media:host-1/') || STARTER_SRCS.has(src)).toBe(
        true,
      )
    }
  })

  it('falls back to a starter photo for the designer’s hero when the library returns nothing', async () => {
    const home = designedHome()
    const slots = aiLayoutPictureSlots(home.nodes, CANVAS_ROOT_ELEMENT_ID, {
      ids: home.sectionIds,
      names: home.names,
    })
    const heroId = slots.find((slot) => slot.sectionIndex === 0)
      ?.imageId as string
    const nothing = fakeProvider({ search: async () => null })
    const nodes = await aiResolveLayoutPictures(home.nodes, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: home.sectionIds,
      sectionNames: home.names,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(INPUT, {
        provider: () => nothing.provider,
        ingest: () => fakeLibrary().ingest,
      }),
    })
    const src = String(
      (nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[
        heroId
      ]?.props?.['src'],
    )
    expect(STARTER_SRCS.has(src)).toBe(true)
  })
})

describe('a picture of a thing shows the thing (AGL-3660, the Juniper Clay start)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    aiStockForgetJobPhotos()
  })
  afterEach(() => warn.mockRestore())

  const BUSINESS = 'A small-batch ceramics studio in Asheville making tableware'

  /** A ceramics hit: its id, its tags, and the page address the library gives it. */
  const hit = (
    id: number,
    tags: string[],
    slug = tags.join('-'),
  ): StockPhoto => ({
    provider: 'pexels',
    id: String(id),
    width: 1200,
    height: 1500,
    pageUrl: `https://www.pexels.com/photo/${slug}-${id}/`,
    photographer: `maker${id}`,
    tags,
  })

  const slot = (
    index: number,
    alt: string,
    role: AiLayoutPictureSlot['role'] = 'gallery',
  ): AiLayoutPictureSlot => ({
    imageId: `img${index}`,
    frameId: null,
    iconId: null,
    alt,
    aspect: 4 / 5,
    sectionIndex: role === 'about' ? 2 : 1,
    role,
  })

  /** A provider answering by query from a table, recording what it was asked. */
  function tableProvider(table: Record<string, StockPhoto[]>) {
    const asked: string[] = []
    const provider: StockPhotoProvider = {
      id: 'pexels',
      label: 'Pexels',
      isConfigured: () => true,
      search: async (request) => {
        asked.push(request.query)
        return { photos: table[request.query] ?? [], cached: false }
      },
      download: async () => ({
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        contentType: 'image/jpeg',
      }),
      credit: (found) => ({
        providerLabel: 'Pexels',
        license: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
        attributionRequired: false,
        text: `Photo by ${found.photographer} on Pexels.`,
      }),
    }
    return { provider, asked }
  }

  /** A library storing each photo as `media:host-1/{provider}-{id}`, so a page's src names its photo. */
  function namedLibrary() {
    const held = new Map<string, string>()
    const ingest: PluginMediaIngest = {
      ingest: async (request) => {
        const key = String(request.stockPhoto?.key)
        const src = `media:host-1/${key.replace(':', '-')}`
        held.set(key, src)
        return { ok: true, mediaId: key, src, width: 1200, height: 1500 }
      },
      findStockPhoto: async ({ sourceKey }) => {
        const src = held.get(sourceKey)
        return src
          ? { mediaId: sourceKey, src, width: 1200, height: 1500 }
          : null
      },
    }
    return { ingest, held }
  }

  it('asks for the subject noun of the caption, filler dropped, qualified by the craft', () => {
    expect(
      aiStockSubjectWords(
        'A beautiful hand-thrown stoneware serving bowl on a linen cloth',
        'Selected work',
      ),
    ).toBe('stoneware serving bowl')
    expect(
      aiStockSubjectWords(
        'Espresso cup in a speckled white glaze',
        'Selected work',
      ),
    ).toBe('espresso cup')
    expect(
      aiStockSubjectWords('Close-up of a round stem vase', 'Selected work'),
    ).toBe('round stem vase')
    expect(aiStockSubjectWords('The maker smiling at her wheel', 'About')).toBe(
      'maker',
    )
    expect(aiStockBusinessWords(BUSINESS)).toBe('ceramics studio')
    expect(aiStockCraftWords('ceramics studio')).toBe('ceramic')
    expect(aiStockCraftWords('ceramic artist')).toBe('ceramic')
    expect(aiStockCraftWords('yoga studio')).toBe('yoga')
    expect(aiStockCraftWords('shop')).toBe('')
    expect(
      ['bowls', 'vases', 'berries', 'dishes', 'glass'].map(aiStockStem),
    ).toEqual(['bowl', 'vase', 'berry', 'dish', 'glass'])
    expect(aiStockObjectWord('nesting bowl set')).toBe('bowl')
    expect(aiStockObjectWord('candle gift set')).toBe('candle')
    expect(aiStockObjectWord('bud vase')).toBe('vase')
    expect(aiStockObjectWord('gift set')).toBe('set')

    const studio = aiStockSiteTerms(BUSINESS)
    const searches = aiStockSearchesFor(
      { role: 'gallery', alt: 'x', aspect: 4 / 5 },
      studio,
      'espresso cup',
    )
    expect(
      searches.map((search) => [search.query, search.broad === true]),
    ).toEqual([
      ['ceramic espresso cup', false],
      ['ceramic cup', false],
      ['handmade ceramics', true],
      ['pottery', true],
    ])
    // A subject that already names the site's world is not qualified twice.
    expect(
      aiStockSearchesFor(
        { role: 'gallery', alt: 'x', aspect: 1 },
        studio,
        'stoneware mug',
      )[0]?.query,
    ).toBe('stoneware mug')
  })

  it('takes a hit of a thing only when it names the thing and its world, so the bowl wins over the crackers', () => {
    const domain = aiStockSiteTerms(BUSINESS).domain
    const crackers = hit(1, ['crackers', 'snack', 'food', 'cheese'])
    const bowl = hit(2, ['bowls', 'ceramics', 'pottery'])
    const fruitBowl = hit(3, ['fruit', 'bowl', 'breakfast'])
    const described: StockPhoto = {
      ...hit(4, []),
      alt: 'Two stoneware serving bowls on a table',
    }
    const mockup = hit(5, ['mockup', 'blank', 'pottery', 'bowl'])
    const judge = { subject: 'serving bowl', domain, strict: true }
    expect(aiStockRelevance(crackers, judge)).toBe(0)
    // A bowl of anything is not a bowl of the potter's: it names no clay.
    expect(aiStockRelevance(fruitBowl, judge)).toBe(0)
    expect(aiStockRelevance(mockup, judge)).toBe(0)
    expect(aiStockRelevance(bowl, judge)).toBeGreaterThan(0)
    // The library's own description counts as its tags do, and a phrase most.
    expect(aiStockRelevance(described, judge)).toBeGreaterThan(
      aiStockRelevance(bowl, judge),
    )
    // Without a world to hold it to, the subject's own phrase lets a hit in.
    expect(
      aiStockRelevance(
        hit(6, ['white', 'ceramic', 'stem', 'vase'], 'stem-vase'),
        { subject: 'stem vase', strict: true },
      ),
    ).toBeGreaterThan(0)

    // The crackers come first from the library, and lose under every seed.
    for (let job = 0; job < 20; job += 1) {
      expect(
        aiStockPick([crackers, fruitBowl, bowl], new Set(), `job-${job}`, judge)
          ?.id,
      ).toBe('2')
    }
    expect(aiStockRank([crackers, fruitBowl], new Set(), 'any', judge)).toEqual(
      [],
    )
    // A broad search takes any photo of the world, and still never a mockup.
    expect(
      aiStockRank([crackers, bowl, mockup], new Set(), 'any', { domain }),
    ).toEqual([bowl])
  })

  it('fills each work card with a photo of its own object, and never a photo naming none of it', async () => {
    const { provider } = tableProvider({
      'stoneware serving bowl': [
        hit(1, ['crackers', 'snack']),
        hit(2, ['serving', 'bowl', 'ceramic']),
      ],
      // Named by its phrase in its page address: an espresso cup, if not a potter's.
      'ceramic espresso cup': [
        hit(3, ['plants', 'leaves', 'green']),
        hit(4, ['espresso', 'cup', 'coffee']),
      ],
      'ceramic round stem vase': [
        hit(9, ['vase', 'stems', 'flowers']),
        hit(5, ['vase', 'stems', 'ceramic']),
      ],
    })
    const { ingest } = namedLibrary()
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'host-1',
        uid: 'member-1',
        seed: 'job-j:work',
        business: BUSINESS,
        sectionNames: ['Hero', 'Selected work'],
        jobId: 'job-j',
      },
      { provider: () => provider, ingest: () => ingest },
    )
    const photos = await source?.([
      slot(0, 'A hand-thrown stoneware serving bowl on linen'),
      slot(1, 'Espresso cup in a speckled glaze'),
      slot(2, 'Round stem vase with dried flowers'),
    ])
    expect(photos?.map((found) => found?.src)).toEqual([
      'media:host-1/pexels-2',
      'media:host-1/pexels-4',
      'media:host-1/pexels-5',
    ])
  })

  it('places no photo twice on a page', async () => {
    const shared = [hit(1, ['ceramic', 'bowl']), hit(2, ['ceramic', 'bowl'])]
    const { provider } = tableProvider({ 'ceramic bowl': shared })
    const { ingest } = namedLibrary()
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'host-1',
        uid: 'member-1',
        seed: 'job-d:work',
        business: BUSINESS,
        sectionNames: ['Hero', 'Work'],
      },
      { provider: () => provider, ingest: () => ingest },
    )
    const photos = await source?.([
      slot(0, 'A bowl'),
      slot(1, 'A small bowl'),
      slot(2, 'A bowl'),
    ])
    const srcs = (photos ?? []).map((found) => found?.src).filter(Boolean)
    // Two photos for three bowls: the third is left to its fallback rather than repeat one.
    expect(srcs).toHaveLength(2)
    expect(new Set(srcs).size).toBe(2)
    expect(photos?.[2]).toBeNull()
  })

  it('never places the About portrait on another page of the same job, in this process or read from its drafts', async () => {
    const portrait = hit(7, ['potter', 'woman', 'portrait', 'vase', 'ceramic'])
    const { provider } = tableProvider({
      'ceramics studio maker': [portrait],
      'ceramic round stem vase': [
        portrait,
        hit(8, ['vase', 'stem', 'ceramic']),
      ],
    })
    const { ingest } = namedLibrary()
    const sourceFor = (
      seed: string,
      extra: { jobId?: string; avoid?: string[] } = {},
    ) =>
      aiLayoutStockPhotoSource(
        {
          hostId: 'host-1',
          uid: 'member-1',
          seed,
          business: BUSINESS,
          sectionNames: ['Hero', 'Work', 'About'],
          ...extra,
        },
        { provider: () => provider, ingest: () => ingest },
      )
    const about = await sourceFor('job-x:about', { jobId: 'job-x' })?.([
      slot(0, 'The maker at her wheel', 'about'),
    ])
    expect(about?.[0]?.src).toBe('media:host-1/pexels-7')

    // The work page, built later in the same process: the portrait is the about page's.
    const work = await sourceFor('job-x:work', { jobId: 'job-x' })?.([
      slot(0, 'Round stem vase'),
    ])
    expect(work?.[0]?.src).toBe('media:host-1/pexels-8')

    // A repeated pass over the about page keeps its own portrait.
    const again = await sourceFor('job-x:about', { jobId: 'job-x' })?.([
      slot(0, 'The maker at her wheel', 'about'),
    ])
    expect(again?.[0]?.src).toBe('media:host-1/pexels-7')

    // In another process nothing is remembered: what the job's other pages show is handed in.
    aiStockForgetJobPhotos()
    const elsewhere = await sourceFor('job-x:work', {
      jobId: 'job-x',
      avoid: ['media:host-1/pexels-7'],
    })?.([slot(0, 'Round stem vase')])
    expect(elsewhere?.[0]?.src).toBe('media:host-1/pexels-8')
  })

  it('reads what the job’s other pages show from their drafts, never this page’s own', async () => {
    const pages: Record<string, NodesMap> = {
      about: {
        a: { componentId: 'image', props: { src: 'media:host-1/m-portrait' } },
        b: {
          componentId: 'image',
          props: { src: '/_static/starter/hero-team.jpg' },
        },
        c: { componentId: 'text', props: { src: 'media:host-1/not-an-image' } },
      } as unknown as NodesMap,
      work: {
        d: { componentId: 'image', props: { src: 'media:host-1/m-vase' } },
      } as unknown as NodesMap,
    }
    expect(aiStockPlacedSrcs(pages['about'])).toEqual([
      'media:host-1/m-portrait',
    ])
    const read: string[] = []
    const readNodes = (async (_firestore: unknown, input: { id: string }) => {
      read.push(input.id)
      if (input.id === 'broken') throw new Error('gone')
      return pages[input.id]
        ? { versionId: 'v1', nodes: pages[input.id] }
        : null
    }) as never
    const avoid = await aiJobPagesPlacedPhotos(
      {} as never,
      {
        hostId: 'host-1',
        job: {
          inputs: {
            [AI_STOCK_PHOTO_PAGES_INPUT]: ['about', 'work', 'broken', 'work'],
          },
        },
        draftId: 'work',
      },
      readNodes,
    )
    expect(avoid).toEqual(['media:host-1/m-portrait'])
    expect(read.sort()).toEqual(['about', 'broken'])
    // What the site's datasets' records show is never placed again either (AGL-3616).
    expect(
      await aiJobPagesPlacedPhotos(
        {} as never,
        {
          hostId: 'host-1',
          job: { inputs: { [AI_STOCK_PHOTO_PAGES_INPUT]: ['about'], [AI_STOCK_PHOTO_AVOID_INPUT]: ['media:host-1/m-bowl', 'not-a-photo'] } },
          draftId: 'work',
        },
        readNodes,
      ),
    ).toEqual(['media:host-1/m-bowl', 'media:host-1/m-portrait'])
    expect(
      await aiJobPagesPlacedPhotos({} as never, { hostId: 'host-1', job: { inputs: { [AI_STOCK_PHOTO_AVOID_INPUT]: ['media:host-1/m-bowl'] } }, draftId: 'w' }, readNodes),
    ).toEqual(['media:host-1/m-bowl'])
    expect(
      await aiJobPagesPlacedPhotos(
        {} as never,
        { hostId: 'host-1', job: { inputs: {} }, draftId: 'w' },
        readNodes,
      ),
    ).toEqual([])
  })

  it('falls back to a photo of the site’s world when nothing names the object, and asks each query once', async () => {
    const { provider, asked } = tableProvider({
      'ceramic espresso cup': [hit(1, ['plants', 'leaves'])],
      'ceramic cup': [hit(2, ['crackers', 'snack'])],
      'handmade ceramics': [
        hit(3, ['studio', 'pottery', 'shelves', 'ceramic']),
        hit(10, ['laptop', 'desk', 'roses']),
      ],
    })
    const { ingest } = namedLibrary()
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'host-1',
        uid: 'member-1',
        seed: 'job-f:work',
        business: BUSINESS,
        sectionNames: ['Hero', 'Work'],
      },
      { provider: () => provider, ingest: () => ingest },
    )
    const photos = await source?.([
      slot(0, 'Espresso cup'),
      slot(1, 'Espresso cup'),
    ])
    // The plants and the crackers never fill it; the studio does, once.
    expect(photos?.[0]?.src).toBe('media:host-1/pexels-3')
    expect(photos?.[1]).toBeNull()
    expect(asked).toEqual([
      'ceramic espresso cup',
      'ceramic cup',
      'handmade ceramics',
      'pottery',
    ])
  })
})

describe('Pixabay’s recorded answers to the live starts of 2026-10-10 (AGL-3660)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    aiStockForgetJobPhotos()
  })
  afterEach(() => warn.mockRestore())

  const JUNIPER =
    'a portfolio for a ceramic artist who makes stoneware bowls, mugs and vases'
  const WILLOW =
    'a small-batch candle shop selling hand-poured soy candles online'
  const ids = (photos: readonly StockPhoto[]) => photos.map((found) => found.id)

  /** Photos of the potter's world, as a "handmade ceramics" search answers (shape only; not recorded). */
  const CERAMICS: StockPhoto[] = [61, 62, 63, 64, 65, 66].map((id) => ({
    provider: 'pixabay',
    id: String(id),
    width: 1280,
    height: 853,
    pageUrl: `https://pixabay.com/photos/pottery-ceramics-clay-${id}/`,
    photographer: 'A Pixabay contributor',
    tags: ['pottery', 'ceramics', 'clay', 'handmade'],
  }))

  /** A provider answering Pixabay's recorded hits, as loosely as Pixabay does, and a slow copy. */
  function recordedProvider(table: Record<string, StockPhoto[]>, delayMs = 0) {
    const asked: string[] = []
    const provider: StockPhotoProvider = {
      id: 'pixabay',
      label: 'Pixabay',
      isConfigured: () => true,
      search: async (request) => {
        asked.push(request.query)
        return { photos: table[request.query] ?? [], cached: true }
      },
      download: async () => {
        if (delayMs)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        return {
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          contentType: 'image/jpeg',
        }
      },
      credit: (found) => ({
        providerLabel: 'Pixabay',
        license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        attributionRequired: false,
        text: `Photo by ${found.photographer} on Pixabay.`,
      }),
    }
    return { provider, asked }
  }

  /** A library storing each photo as `media:h/{id}`, so a slot's src names its photo. */
  function library(): PluginMediaIngest {
    const held = new Map<string, string>()
    return {
      ingest: async (request) => {
        const key = String(request.stockPhoto?.key)
        const src = `media:h/${key.split(':')[1]}`
        held.set(key, src)
        return { ok: true, mediaId: key, src, width: 1280, height: 853 }
      },
      findStockPhoto: async ({ sourceKey }) => {
        const src = held.get(sourceKey)
        return src
          ? { mediaId: sourceKey, src, width: 1280, height: 853 }
          : null
      },
    }
  }

  const card = (
    index: number,
    alt: string,
    role: AiLayoutPictureSlot['role'] = 'gallery',
    aspect = 4 / 5,
  ): AiLayoutPictureSlot => ({
    imageId: `img${index}`,
    frameId: null,
    iconId: null,
    alt,
    aspect,
    sectionIndex: role === 'hero' ? 0 : 1,
    role,
  })

  it('reads the craft, never the kind of site, from both starts', () => {
    const juniper = aiStockSiteTerms(JUNIPER)
    expect(juniper).toMatchObject({
      business: 'ceramic artist',
      craft: 'ceramic',
      broad: ['handmade ceramics', 'pottery'],
    })
    expect(juniper.domain).toEqual(
      expect.arrayContaining(['ceramic', 'stoneware', 'pottery', 'clay']),
    )
    // What it makes is not its world: a bowl of fruit is not pottery.
    expect(juniper.domain).not.toContain('bowl')
    expect(juniper.domain).not.toContain('portfolio')
    const willow = aiStockSiteTerms(WILLOW)
    expect(willow).toMatchObject({
      business: 'candle shop',
      craft: 'candle',
      broad: ['handmade candles', 'scented candles'],
    })
    expect(willow.domain).toEqual(
      expect.arrayContaining(['candle', 'soy', 'wax']),
    )
    expect(willow.domain).not.toContain('online')
    // The searches now say what the photo shows, in the site's own world.
    expect(
      aiStockSearchesFor(card(0, 'x'), juniper, 'serving bowl').map(
        (search) => search.query,
      ),
    ).toEqual([
      'ceramic serving bowl',
      'ceramic bowl',
      'handmade ceramics',
      'pottery',
    ])
    expect(
      aiStockSearchesFor(
        card(0, 'x'),
        juniper,
        aiStockSubjectWords('Tall bud vase', ''),
      )[0]?.query,
    ).toBe('ceramic bud vase')
    expect(
      aiStockSearchesFor(card(0, 'x', 'hero', 16 / 9), juniper, 'stoneware')[0]
        ?.query,
    ).toBe('ceramic artist')
  })

  it('rejects every photo the starts placed: the robin, the lilac, the letterpress, the mockup and the tea set', () => {
    const juniper = aiStockSiteTerms(JUNIPER).domain
    const willow = aiStockSiteTerms(WILLOW).domain
    const bowl = aiStockRank(SERVING_BOWL_PORTFOLIO, new Set(), 'any', {
      subject: aiStockSubjectWords('Speckled serving bowl', ''),
      domain: juniper,
      strict: true,
    })
    expect(ids(bowl)).not.toContain('634413') // the robin ("food bowl")
    expect(ids(bowl)).not.toContain('1844894') // a breakfast bowl
    const vase = aiStockRank(TALL_BUD_VASE_PORTFOLIO, new Set(), 'any', {
      subject: aiStockSubjectWords('Tall bud vase', ''),
      domain: juniper,
      strict: true,
    })
    expect(ids(vase)).not.toContain('5348922') // the lilac branch
    expect(ids(vase)[0]).toMatch(/^(10211596|687147)$/) // a ceramic vase
    const nesting = aiStockRank(NESTING_BOWL_SET_PORTFOLIO, new Set(), 'any', {
      subject: aiStockSubjectWords('Nesting bowl set', ''),
      domain: juniper,
      strict: true,
    })
    expect(ids(nesting)).not.toContain('705667') // letterpress type
    expect(ids(nesting)).not.toContain('8664063') // a tea set
    // The hero asked "portfolio": wallets, models, a blank mockup. None is pottery.
    expect(
      aiStockRank(PORTFOLIO, new Set(), 'any', { domain: juniper }),
    ).toEqual([])
    const gift = aiStockRank(CANDLE_GIFT_SET_ONLINE, new Set(), 'any', {
      subject: aiStockSubjectWords('Candle Gift Set', ''),
      domain: willow,
      strict: true,
    })
    expect(ids(gift)).not.toContain('2735387') // the antique tea set
    expect(ids(gift)[0]).toBe('4943215') // candles, gift, scented
  })

  it('fills the Juniper home from its world, never a starter, never twice, inside the time even with slow copies', async () => {
    // Pixabay answers loosely: the new searches meet the same kind of hits the old ones did.
    const { provider, asked } = recordedProvider(
      {
        'ceramic artist': PORTFOLIO,
        'ceramic serving bowl': SERVING_BOWL_PORTFOLIO,
        'ceramic bowl': SERVING_BOWL_PORTFOLIO,
        'ceramic mug': [],
        'ceramic bud vase': TALL_BUD_VASE_PORTFOLIO,
        'ceramic vase': TALL_BUD_VASE_PORTFOLIO,
        'ceramic nesting bowl set': NESTING_BOWL_SET_PORTFOLIO,
        'handmade ceramics': CERAMICS,
      },
      60,
    )
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'h',
        uid: 'u',
        seed: 'rZk7bW00Rh:/',
        business: JUNIPER,
        sectionNames: ['Hero', 'Selected work'],
      },
      { provider: () => provider, ingest: library, budgetMs: 250 },
    )
    const photos = await source?.([
      card(0, 'Stoneware for the table, made by hand.', 'hero', 16 / 9),
      card(1, 'Speckled serving bowl'),
      card(2, 'Everyday mug'),
      card(3, 'Tall bud vase'),
      card(4, 'Nesting bowl set'),
      card(5, 'Small dish'),
      card(6, 'Everyday bowl'),
    ])
    const placed = (photos ?? []).map(
      (found) => found?.src?.replace('media:h/', '') ?? null,
    )
    // Seven slots, seven photos: one copy after another, at 60ms each (420ms), would not have fit in 250ms.
    expect(placed.every(Boolean)).toBe(true)
    expect(new Set(placed).size).toBe(placed.length)
    for (const bad of [
      '634413',
      '5348922',
      '705667',
      '3684376',
      '5062263',
      '908569',
      '7046626',
      '1844894',
    ]) {
      expect(placed).not.toContain(bad)
    }
    // The hero is a photo of pottery, found by the broad search once "ceramic artist" offered none.
    expect(CERAMICS.map((found) => found.id)).toContain(placed[0])
    expect(asked.every((query) => !/portfolio|online/.test(query))).toBe(true)
  })

  it('gives the Willow Wick products candles: the gift set its own, the wick trimmer one of the world, never the laptop desk', async () => {
    const { provider } = recordedProvider({
      'candle gift set': CANDLE_GIFT_SET_ONLINE,
      'handmade candles': CANDLE_GIFT_SET_ONLINE,
    })
    const source = aiLayoutStockPhotoSource(
      {
        hostId: 'h',
        uid: 'u',
        seed: 'MtlXWjvt9P:products',
        business: WILLOW,
        sectionNames: ['Products'],
      },
      { provider: () => provider, ingest: library },
    )
    const photos = await source?.([
      card(0, 'Candle Gift Set'),
      card(1, 'Candle Wick Trimmer'),
    ])
    const [gift, trimmer] = (photos ?? []).map((found) =>
      found?.src?.replace('media:h/', ''),
    )
    expect(gift).toBe('4943215')
    expect(trimmer).toBeTruthy()
    expect(trimmer).not.toBe(gift)
    expect(trimmer).not.toBe('2735387')
    expect(
      CANDLE_GIFT_SET_ONLINE.find((found) => found.id === trimmer)?.tags.join(
        ' ',
      ),
    ).toMatch(/candle/)
  })
})
