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
  aiLayoutStockPhotoSource,
  aiStockBusinessWords,
  aiStockOrientation,
  aiStockPick,
  aiStockSearchesFor,
  aiStockSubjectWords,
} from './ai-layout-stock-photos'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from '../layout-language/ai-layout-compiler'
import { aiLayoutDesignChoices } from '../layout-language/ai-layout-design'
import type { AiLayoutSection } from '../layout-language/ai-layout-language'
import { aiLayoutStoredTree } from '../layout-language/ai-layout-store'

/**
 * A language page's pictures from a stock photo library (AGL-3660), through
 * core's seams only: the provider is a fake answering recorded-shape hits,
 * and the media door a fake library. No network.
 */

const block = (kind: string, text: string, col = -1) => ({ kind, col, text, to: '', icon: '', style: 'none', items: [] })

const SECTIONS = [
  { name: 'Hero', uses: [], items: 0 },
  { name: 'Meet your teacher', uses: [], items: 0 },
  { name: 'Classes', uses: [], items: 0 },
]
const SECTION_IDS = ['sec-0', 'sec-1', 'sec-2']

/** A stored three-section yoga studio page with a picture in each section. */
function yogaPage(): NodesMap {
  const result = aiLayoutPageCheck({
    screen: { title: 'Home', slug: '/', template: null, sections: SECTIONS } as never,
    sectionIds: SECTION_IDS,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A yoga studio.' } as never,
    context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: SECTION_IDS },
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
        blocks: [block('heading', 'Meet your teacher'), block('text', 'Teaching since 2010.'), block('image', 'The teacher smiling on a mat')],
      },
      {
        band: 'plain',
        align: 'start',
        cols: [],
        blocks: [block('heading', 'Classes'), block('text', 'Vinyasa and restorative.'), block('image', 'Students stretching at sunrise')],
      },
    ],
  })
  if (!result.value) throw new Error(JSON.stringify(result.violations))
  return result.value.nodes
}

const photo = (id: number, width = 1280, height = 853): StockPhoto & { downloadUrl: string } => ({
  provider: 'pixabay',
  id: String(id),
  width,
  height,
  pageUrl: `https://pixabay.com/photos/yoga-${id}/`,
  photographer: `user${id}`,
  photographerUrl: `https://pixabay.com/users/user${id}-${id}/`,
  tags: ['yoga'],
  downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
})

/** Recorded-shape hits per query; anything else finds nothing. */
const HITS: Record<string, StockPhoto[]> = {
  'yoga studio': [photo(1), photo(2), photo(3), photo(4)],
  'yoga studio teacher smiling mat': [photo(11, 853, 1280), photo(12, 853, 1280)],
  'yoga studio students stretching sunrise': [],
  'students stretching sunrise': [photo(21), photo(1)],
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
      return { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }
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
      if (refuse) return { ok: false, status: 403, reason: 'Storage limit reached (250 MB)' }
      stored.push(request)
      return { ok: true, mediaId: `m${stored.length}`, src: `media:host-1/m${stored.length}`, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) =>
      held[sourceKey] ? { mediaId: held[sourceKey], src: `media:host-1/${held[sourceKey]}`, width: 1280, height: 853 } : null,
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
    (id) => (nodes as unknown as Record<string, { props?: { src?: string } }>)[id]?.props?.src,
  )

const STARTER_SRCS = new Set<string>(Object.values(AI_LAYOUT_STARTER_PHOTOS).map((starter) => starter.src))

describe('the stock photo searches (AGL-3660)', () => {
  it('reads the kind of business from the head of the business type', () => {
    expect(aiStockBusinessWords('A family-owned yoga studio in Austin for busy parents')).toBe('yoga studio')
    expect(aiStockBusinessWords('Ceramic pottery classes and a shop')).toBe('ceramic pottery classes')
    expect(aiStockBusinessWords('24/7 towing — call 555-123-4567 or tow@example.com')).toBe('towing')
    expect(aiStockBusinessWords('')).toBe('')
  })

  it("reads a picture's subject from its alt text, else its section", () => {
    expect(aiStockSubjectWords('A potter shaping a clay bowl on a wheel', 'Gallery')).toBe('potter shaping clay')
    expect(aiStockSubjectWords('', 'Our gallery')).toBe('gallery')
  })

  it('asks for the shape of the frame and, for an about picture, people', () => {
    expect(aiStockOrientation(16 / 9)).toBe('horizontal')
    expect(aiStockOrientation(3 / 4)).toBe('vertical')
    expect(aiStockOrientation(1)).toBe('any')
    expect(
      aiStockSearchesFor({ role: 'hero', alt: 'x', aspect: 16 / 9 }, { business: 'yoga studio', subject: 'calm class' }),
    ).toEqual([
      { query: 'yoga studio', orientation: 'horizontal', minWidth: 1600 },
      { query: 'yoga studio calm class', orientation: 'horizontal', minWidth: 1600 },
    ])
    expect(
      aiStockSearchesFor({ role: 'about', alt: 'x', aspect: 3 / 4 }, { business: 'yoga studio', subject: 'teacher' }),
    ).toEqual([
      { query: 'yoga studio teacher', orientation: 'vertical', minHeight: 900, people: true },
      { query: 'yoga studio', orientation: 'vertical', minHeight: 900, people: true },
    ])
    // No business words: the subject alone, asked once.
    expect(aiStockSearchesFor({ role: 'gallery', alt: 'x', aspect: 1 }, { business: '', subject: 'bowls' })).toEqual([
      { query: 'bowls', orientation: 'any', minWidth: 900 },
    ])
  })

  it('picks by the seed among hits not on the page, so sites differ and a job repeats itself', () => {
    const hits = [photo(1), photo(2), photo(3), photo(4), photo(5), photo(6)]
    const picks = new Set(
      Array.from({ length: 40 }, (_unused, index) => aiStockPick(hits, new Set(), `job-${index}:home:0:yoga`)?.id),
    )
    expect(picks.size).toBeGreaterThan(3)
    expect(aiStockPick(hits, new Set(), 'job-1')?.id).toBe(aiStockPick(hits, new Set(), 'job-1')?.id)
    expect(aiStockPick(hits, new Set(hits.slice(1).map((hit) => `pixabay:${hit.id}`)), 'any')?.id).toBe('1')
    expect(aiStockPick(hits, new Set(hits.map((hit) => `pixabay:${hit.id}`)), 'any')).toBeNull()
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
    const source = aiLayoutStockPhotoSource(INPUT, { provider: () => provider, ingest: () => ingest })
    const nodes = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source,
    })
    expect(srcs(nodes)).toEqual(['media:host-1/m1', 'media:host-1/m2', 'media:host-1/m3'])
    expect(searches.map((search) => search.query)).toEqual([
      'yoga studio',
      'yoga studio teacher smiling mat',
      'yoga studio students stretching sunrise',
      'students stretching sunrise',
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
    const held = Object.fromEntries([1, 2, 3, 4].map((id) => [`pixabay:${id}`, `held${id}`]))
    const { ingest, stored } = fakeLibrary(held)
    const source = aiLayoutStockPhotoSource(INPUT, { provider: () => provider, ingest: () => ingest })
    const nodes = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source,
    })
    expect(srcs(nodes)[0]).toMatch(/^media:host-1\/held[1-4]$/)
    expect(stored.every((request) => !['pixabay:1', 'pixabay:2', 'pixabay:3', 'pixabay:4'].includes(String(request.stockPhoto?.key)))).toBe(true)
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
      source: aiLayoutStockPhotoSource(INPUT, { provider: () => provider, ingest: () => refusing.ingest }),
    })
    expect(srcs(nodes).every((src) => STARTER_SRCS.has(String(src)))).toBe(true)
    // A refusal to store holds for the page: one download, then no more.
    expect(downloads).toHaveLength(1)

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
      source: aiLayoutStockPhotoSource(INPUT, { provider: () => failing.provider, ingest: () => fakeLibrary().ingest }),
    })
    expect(srcs(fallback).every((src) => STARTER_SRCS.has(String(src)))).toBe(true)

    const nothing = fakeProvider({ search: async () => null })
    const empty = await aiResolveLayoutPictures(PAGE, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: SECTION_IDS,
      sectionNames: INPUT.sectionNames,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(INPUT, { provider: () => nothing.provider, ingest: () => fakeLibrary().ingest }),
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
    expect(aiLayoutStockPhotoSource(INPUT, { provider: () => null, ingest: () => fakeLibrary().ingest })).toBeNull()
    expect(aiLayoutStockPhotoSource(INPUT, { provider: () => provider, ingest: () => null })).toBeNull()
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
  function designedHome(): { nodes: NodesMap; sectionIds: string[]; names: string[] } {
    let seed = 1
    while (aiLayoutDesignChoices({ kind: 'yoga', seed, home: true }).hero !== 'cover') seed += 1
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
      { band: 'soft', blocks: [{ kind: 'heading', text: 'Classes' }, { kind: 'text', text: 'Vinyasa and restorative, every morning.' }] },
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
    const stored = aiLayoutStoredTree(compiled.tree, 'screen', context, sectionIds)
    if (stored.ok === false) throw new Error(stored.error)
    return { nodes: stored.nodes, sectionIds, names: plan.sections.map((section) => section.name) }
  }

  it('fills the designer’s decorative hero with the provider’s photo, searched wide, and the rest from it or the starters', async () => {
    const home = designedHome()
    const slots = aiLayoutPictureSlots(home.nodes, CANVAS_ROOT_ELEMENT_ID, { ids: home.sectionIds, names: home.names })
    const hero = slots.find((slot) => slot.sectionIndex === 0)
    expect(hero).toMatchObject({ role: 'hero' })
    const props = (id: string) => (home.nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[id]?.props
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
    const filled = (nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[hero?.imageId as string]?.props
    expect(filled?.['src']).toBe('media:host-1/m1')
    expect(filled?.['loading']).toBe('eager')
    expect(searches[0]).toMatchObject({ query: 'yoga studio', orientation: 'horizontal', minWidth: 1600 })
    expect(stored[0]?.stockPhoto?.query).toBe('yoga studio')
    // Every other slot is filled too: by the library, or a starter where it found nothing.
    for (const slot of slots) {
      const src = String((nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[slot.imageId]?.props?.['src'])
      expect(src.startsWith('media:host-1/') || STARTER_SRCS.has(src)).toBe(true)
    }
  })

  it('falls back to a starter photo for the designer’s hero when the library returns nothing', async () => {
    const home = designedHome()
    const slots = aiLayoutPictureSlots(home.nodes, CANVAS_ROOT_ELEMENT_ID, { ids: home.sectionIds, names: home.names })
    const heroId = slots.find((slot) => slot.sectionIndex === 0)?.imageId as string
    const nothing = fakeProvider({ search: async () => null })
    const nodes = await aiResolveLayoutPictures(home.nodes, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: home.sectionIds,
      sectionNames: home.names,
      seed: INPUT.seed,
      source: aiLayoutStockPhotoSource(INPUT, { provider: () => nothing.provider, ingest: () => fakeLibrary().ingest }),
    })
    const src = String((nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[heroId]?.props?.['src'])
    expect(STARTER_SRCS.has(src)).toBe(true)
  })
})
