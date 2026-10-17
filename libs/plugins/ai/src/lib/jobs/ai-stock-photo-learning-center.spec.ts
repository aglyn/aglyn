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
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { AI_LAYOUT_NO_PHOTO, aiResolveLayoutPictures, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockIsAbbreviation,
  aiStockKindTerms,
  aiStockNamedKind,
  aiStockPhotoWordsOf,
  aiStockSiteTerms,
  aiStockSourceTerms,
} from './ai-layout-stock-photos'
import { EDUCATION_HITS, LMS_HERO, LMS_WIDE } from './fixtures/ai-stock-photo-learning-center-recordings'

/*
 * The beta.262 Adult Hybrid Learning Center start on 2026-10-16 (AGL-3856,
 * job ttzbLqppuu, host 6b5F8a9RUO), a real new customer: business type
 * "LMS", no audience, the "Courses & education" kind, the name "Adult Hybrid
 * Learning Center", two pages. Its home page shipped with no photo at all,
 * and its split hero's right column was an empty rounded gray card. Replayed
 * from what Pixabay answered (fixtures/ai-stock-photo-learning-center-recordings.ts)
 * through core's seams only. No network, no model.
 */

const BUSINESS = 'LMS'
const NAME = 'Adult Hybrid Learning Center'
const JOB = {
  plan: { language: 'en' },
  inputs: { businessType: BUSINESS, audience: '', siteKind: 'education', starter: 'business', businessName: NAME, pages: 2 },
}
const HERO_ALT = 'Adult learners studying together in a bright classroom'
const SECTIONS = ['hero with enrollment call to action', 'programs overview']

const HERO: AiLayoutPictureSlot = {
  imageId: 'ZjpV3W2m5V',
  frameId: 'xvJkqZ8P05',
  iconId: null,
  alt: HERO_ALT,
  aspect: 4 / 5,
  sectionIndex: 0,
  role: 'hero',
}

const BY_ID = new Map([...LMS_HERO, ...LMS_WIDE, ...EDUCATION_HITS].map((hit) => [hit.id, hit] as const))
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** A fake library answering "lms" as production's cache did, and every other search from `others`. */
function fakes(others: StockPhoto[]) {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      if (request.people) return { photos: [], cached: true }
      if (request.query === 'lms') return { photos: request.orientation === 'vertical' ? LMS_HERO : LMS_WIDE, cached: true }
      return { photos: others, cached: true }
    },
    download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
    credit: () => ({ providerLabel: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, text: 'Photo on Pixabay.' }),
  }
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      const src = `media:6b5F8a9RUO/${String(request.stockPhoto?.id)}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 853, height: 1280 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 853, height: 1280 } : null
    },
  }
  const source = aiLayoutStockPhotoSource(
    { hostId: '6b5F8a9RUO', uid: 'member-1', seed: 'ttzbLqppuu:home', business: BUSINESS, sectionNames: SECTIONS, jobId: 'ttzbLqppuu', ...aiStockPhotoWordsOf(JOB) },
    { provider: () => provider, ingest: () => ingest },
  )
  return { asked, source }
}

beforeEach(() => aiStockForgetJobPhotos())

describe('why the Adult Hybrid Learning Center home page had no photo (AGL-3856, beta.262)', () => {
  it('read "LMS" as the world "lms", which no photo Pixabay answered names', () => {
    const terms = aiStockSiteTerms(BUSINESS)
    expect(terms.domain).toEqual(['lms'])
    expect(aiStockIsAbbreviation(BUSINESS)).toBe(true)
    expect(aiStockIsAbbreviation('a local service business')).toBe(false)
    expect(aiStockIsAbbreviation('Bakery')).toBe(false)
    for (const hit of [...LMS_HERO, ...LMS_WIDE]) expect(hit.tags.join(' ')).not.toMatch(/\blms\b/)
  })
})

describe('a business type the libraries do not know, searched by the kind of site (AGL-3856)', () => {
  it('passes the picked kind of site on from the job', () => {
    expect(aiStockPhotoWordsOf(JOB)).toMatchObject({ kind: 'education', name: NAME })
    expect(aiStockPhotoWordsOf(JOB)).not.toHaveProperty('audience')
  })

  it('reads "Learning Center" in the name as education, and the picked kind as the last resort', () => {
    expect(aiStockNamedKind(NAME)).toBe('education')
    for (const name of ['Northside Academy', 'Bright Path Tutoring', 'Hillcrest School']) expect(aiStockNamedKind(name)).toBe('education')
    expect(aiStockNamedKind('Hillside')).toBe('')
    const terms = aiStockSourceTerms({ business: BUSINESS, ...aiStockPhotoWordsOf(JOB) })
    expect(terms.craft).toBe('classroom')
    expect(terms.broad).toEqual(['adult students classroom', 'online learning', 'adult education'])
    expect(terms.domain).toEqual(expect.arrayContaining(['classroom', 'student', 'education', 'learning', 'teacher']))
    // The name says it, whatever kind was picked; with a name of generic words, the kind does.
    expect(aiStockSourceTerms({ business: BUSINESS, name: NAME, kind: 'business' }).craft).toBe('classroom')
    expect(aiStockSourceTerms({ business: BUSINESS, name: 'Adult Hybrid Center', kind: 'education' }).craft).toBe('classroom')
    // A business type that names its world keeps it.
    expect(aiStockSourceTerms({ business: 'a family bakery', name: NAME, kind: 'education' }).craft).toBe('bakery')
  })

  it('has a subject for every kind of site the guided start offers', () => {
    for (const kind of AI_SITE_KINDS) {
      const terms = aiStockKindTerms(kind.id)
      expect(terms).not.toBeNull()
      expect(terms?.broad.length).toBeGreaterThan(0)
      expect(terms?.domain.length).toBeGreaterThan(1)
    }
    expect(aiStockKindTerms('fitness')?.craft).toBe('gym')
    expect(aiStockKindTerms('photography')?.craft).toBe('photographer')
  })

  it('searches the hero for a classroom and places a photo of study, never the sports car', async () => {
    const { asked, source } = fakes(EDUCATION_HITS)
    const [photo] = (await source?.([HERO])) ?? []
    expect(asked[0]).toBe('classroom')
    expect(asked).not.toContain('lms')
    const placed = BY_ID.get(idOf(photo?.src))
    expect(placed).toBeDefined()
    expect(EDUCATION_HITS).toContain(placed)
    expect(placed?.tags[0]).toMatch(/student|teacher|book|training|learning|education|classroom/)
    expect(photo?.alt).toBeTruthy()
  })

  it('takes the empty card out when nothing comes back, and gives the words the row', async () => {
    const { source } = fakes([])
    expect(await source?.([HERO])).toEqual([AI_LAYOUT_NO_PHOTO])
    const page = (): NodesMap =>
      ({
        root: { componentId: 'canvas', nodes: ['sec-0'] },
        'sec-0': { componentId: 'section', props: { element: 'section' }, nodes: ['container'] },
        container: { componentId: 'muiContainer', props: { maxWidth: 'lg' }, nodes: ['row'] },
        row: { componentId: 'muiGrid', props: { container: true, spacing: '8' }, sx: { alignItems: 'center' }, nodes: ['words', 'Xe6vOrnAZy'] },
        words: { componentId: 'muiGrid', props: { size: 'xs:12 md:6' }, nodes: ['flow'] },
        flow: { componentId: 'muiStack', nodes: [] },
        Xe6vOrnAZy: { componentId: 'muiGrid', props: { size: 'xs:12 md:6' }, nodes: ['xvJkqZ8P05'] },
        xvJkqZ8P05: {
          componentId: 'muiBox',
          sx: { position: 'relative', overflow: 'hidden', bgcolor: 'action.hover', aspectRatio: { xs: '4 / 3', md: '4 / 5' }, borderRadius: 2 },
          nodes: ['ZjpV3W2m5V'],
        },
        ZjpV3W2m5V: { componentId: 'image', props: { alt: HERO_ALT, objectFit: 'cover', width: '100%', height: '100%' } },
      }) as unknown as NodesMap
    const nodes = (await aiResolveLayoutPictures(page(), {
      rootId: 'root',
      sectionIds: ['sec-0'],
      sectionNames: SECTIONS,
      seed: 'ttzbLqppuu:home',
      source: async () => [AI_LAYOUT_NO_PHOTO],
    })) as unknown as Record<string, { nodes?: string[]; props?: Record<string, unknown> }>
    for (const id of ['Xe6vOrnAZy', 'xvJkqZ8P05', 'ZjpV3W2m5V']) expect(nodes[id]).toBeUndefined()
    expect(nodes['row']?.nodes).toEqual(['words'])
    expect(nodes['words']?.props?.['size']).toBe('xs:12')
    expect(nodes['sec-0']?.nodes).toEqual(['container'])
    // A starter fills the card where the library could not be asked, and the split stays.
    const started = (await aiResolveLayoutPictures(page(), {
      rootId: 'root',
      sectionIds: ['sec-0'],
      sectionNames: SECTIONS,
      seed: 'ttzbLqppuu:home',
      source: async () => [null],
    })) as unknown as Record<string, { nodes?: string[]; props?: Record<string, unknown> }>
    expect(String(started['ZjpV3W2m5V']?.props?.['src'])).toMatch(/^\/_static\/starter\//)
    expect(started['row']?.nodes).toEqual(['words', 'Xe6vOrnAZy'])
    expect(started['words']?.props?.['size']).toBe('xs:12 md:6')
  })
})
