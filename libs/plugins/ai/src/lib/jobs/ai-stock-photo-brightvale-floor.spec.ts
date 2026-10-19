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

import type { PluginMediaIngest, PluginMediaIngestResult } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider, StockPhotoSearchRequest } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { AI_LAYOUT_STARTER_PHOTOS, aiLayoutPictureRole, aiResolveLayoutPictures } from '../layout-language/ai-layout-pictures'
import { aiLayoutStockPhotoSource, aiStockForgetJobPhotos, aiStockPhotoWordsOf } from './ai-layout-stock-photos'
import {
  FREELENCING_HERO,
  PETS_AND_OWNERS_UNNAMED,
  READY_TALK_MARKETING_PEOPLE,
  SMALL_BUSINESS_OWNER_HERO,
} from './fixtures/ai-stock-photo-brightvale-recordings'

/*
 * The beta.267 Brightvale Freelance Marketing home page (AGL-3923, job
 * dUxJutW8Dp, host QyM-_Ii5Kh) through the whole resolver: its cover hero and
 * its closing band over a photo, replayed from the recorded answers
 * (fixtures/ai-stock-photo-brightvale-recordings.ts). Live, every slot of the
 * site showed a starter, among them the pottery workbench as this page's
 * hero and the coffee shop's owner, after one refused copy stopped the page
 * (fixed in #1770). Here: the page's photos are a small business's, no
 * starter shows another business, and a page every photo of which is refused
 * or judged unfit still opens on a neutral starter. No network, no model.
 */

const INPUTS = {
  businessType: 'Freelencing site offer services',
  audience: 'for my client',
  starter: 'business',
  siteKind: 'business',
  pages: 4,
  businessName: 'Brightvale Freelance Marketing',
}
const HOST = 'QyM-_Ii5Kh'
const JOB = 'dUxJutW8Dp'
const HOME = 'ri05eLYsCn'
const SECTIONS = ['Hero with call to action', 'The story behind Brightvale', 'Call to action to contact page']
const HERO_WORDS = 'Marketing support that helps your business be found and remembered'
const CLOSE_WORDS = 'Ready to talk about your marketing?'

/** The home page's two covers as the compiler wrote them: a black scrim frame under each, holding an empty image. */
const page = (): NodesMap =>
  ({
    '_@_': { componentId: 'div', nodes: ['sec-1', 'sec-7'] },
    'sec-1': { componentId: 'section', props: { element: 'section', colorScheme: 'dark', underHeader: true }, nodes: ['heroFrame', 'heroWords'] },
    heroFrame: { componentId: 'muiBox', sx: { position: 'absolute', overflow: 'hidden', bgcolor: 'common.black', top: 0, left: 0, width: '100%', height: '100%' }, nodes: ['heroImage'] },
    heroImage: { componentId: 'image', props: { alt: HERO_WORDS, objectFit: 'cover', decorative: true, width: '100%', height: '100%' }, sx: { opacity: 0.42 } },
    heroWords: { componentId: 'muiContainer', props: { maxWidth: 'lg' }, nodes: [] },
    'sec-7': { componentId: 'section', props: { element: 'section', colorScheme: 'dark' }, nodes: ['closeFrame', 'closeWords'] },
    closeFrame: { componentId: 'muiBox', sx: { position: 'absolute', overflow: 'hidden', bgcolor: 'common.black', top: 0, left: 0, width: '100%', height: '100%' }, nodes: ['closeImage'] },
    closeImage: { componentId: 'image', props: { alt: CLOSE_WORDS, objectFit: 'cover', decorative: true, width: '100%', height: '100%' }, sx: { opacity: 0.42 } },
    closeWords: { componentId: 'muiContainer', props: { maxWidth: 'lg' }, nodes: [] },
  }) as unknown as NodesMap

const shapeOf = (request: StockPhotoSearchRequest) =>
  [request.query.toLowerCase(), request.orientation ?? 'any', request.minWidth ?? '', request.minHeight ?? '', request.people === true].join('|')

const RECORDED = new Map<string, StockPhoto[]>([
  ['freelencing|horizontal|1600||false', FREELENCING_HERO],
  ['small business owner|horizontal|1600||false', SMALL_BUSINESS_OWNER_HERO],
  ['ready talk marketing|horizontal|900||true', READY_TALK_MARKETING_PEOPLE],
])

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])

/** A library over the recordings (or `answer` for every search), and a media library that refuses every copy where asked. */
function fakes(options: { answer?: StockPhoto[]; refuse?: number } = {}) {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(shapeOf(request))
      return { photos: options.answer ?? RECORDED.get(shapeOf(request)) ?? [], cached: true }
    },
    // The provider names a photo by its bytes since #1770.
    download: async () => ({ bytes: JPEG, contentType: 'image/jpeg' }),
    credit: () => ({ providerLabel: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, text: 'Photo on Pixabay.' }),
  }
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request): Promise<PluginMediaIngestResult> => {
      if (options.refuse) return { ok: false, status: options.refuse, reason: 'refused' }
      const src = `media:${HOST}/${String(request.stockPhoto?.id)}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
    },
  }
  return { asked, provider, ingest }
}

const resolve = (deps: ReturnType<typeof fakes>) =>
  aiResolveLayoutPictures(page(), {
    rootId: '_@_',
    // The story section between them holds no picture here.
    sectionIds: ['sec-1', 'sec-story', 'sec-7'],
    sectionNames: SECTIONS,
    seed: `${JOB}:${HOME}`,
    source: aiLayoutStockPhotoSource(
      {
        hostId: HOST,
        uid: 'member-1',
        seed: `${JOB}:${HOME}`,
        business: INPUTS.businessType,
        sectionNames: SECTIONS,
        jobId: JOB,
        ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: INPUTS }),
      },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    ),
  }) as unknown as Promise<Record<string, { nodes?: string[]; props?: Record<string, unknown> }>>

const NEUTRAL = [AI_LAYOUT_STARTER_PHOTOS.hero.src, AI_LAYOUT_STARTER_PHOTOS.desk.src]
const MISFITS = [AI_LAYOUT_STARTER_PHOTOS.craft.src, AI_LAYOUT_STARTER_PHOTOS.about.src, AI_LAYOUT_STARTER_PHOTOS.plants.src]

let warn: jest.SpyInstance
beforeEach(() => {
  aiStockForgetJobPhotos()
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())

describe('the Brightvale home page, whole (AGL-3923, beta.267)', () => {
  it('reads "Ready to talk about your marketing?" as no picture of people: "about" leads only a section about someone', () => {
    expect(aiLayoutPictureRole({ sectionIndex: 6, sectionName: 'Call to action to contact page', alt: CLOSE_WORDS })).toBe('gallery')
    expect(aiLayoutPictureRole({ sectionIndex: 1, sectionName: 'About us', alt: 'A portrait' })).toBe('about')
    expect(aiLayoutPictureRole({ sectionIndex: 1, sectionName: 'Intro', alt: 'About the studio' })).toBe('about')
    // What the people search those words made was answered with: a tin-can telephone.
    expect(READY_TALK_MARKETING_PEOPLE[0]?.tags.slice(0, 3)).toEqual(['tin can', 'speak', 'talk'])
  })

  it('opens on a stock photo of a small business, never asks the closing band among portraits, and shows no other business’s starter', async () => {
    const deps = fakes()
    const nodes = await resolve(deps)
    expect(String(nodes['heroImage']?.props?.['src'])).toMatch(/^media:QyM-_Ii5Kh\//)
    expect(deps.asked).not.toContain('ready talk marketing|horizontal|900||true')
    expect(deps.asked.some((shape) => shape.endsWith('|true'))).toBe(false)
    const text = JSON.stringify(nodes)
    for (const misfit of MISFITS) expect(text).not.toContain(misfit)
  })

  it('still opens on a neutral starter when the library refuses every copy for its own bytes', async () => {
    const nodes = await resolve(fakes({ refuse: 415 }))
    expect(NEUTRAL).toContain(nodes['heroImage']?.props?.['src'])
    const text = JSON.stringify(nodes)
    for (const misfit of MISFITS) expect(text).not.toContain(misfit)
    // Each neutral starter at most once on the page.
    const srcs = ['heroImage', 'closeImage'].map((id) => nodes[id]?.props?.['src']).filter(Boolean)
    expect(new Set(srcs).size).toBe(srcs.length)
  })

  it('still opens on a neutral starter when every answer is judged unfit: pets and their owners, a tin-can telephone', async () => {
    // Only the recorded hits that name nothing of a business's world: the pets, the telephone, the bride.
    const offTopic = [...PETS_AND_OWNERS_UNNAMED, ...READY_TALK_MARKETING_PEOPLE].filter(
      (hit) => !hit.tags.some((tag) => /business|office|meeting|team|work|desk|laptop|computer|entrepreneur|conference|coworker|shop|customer|service|notebook|coffee|company|corporate|colleague/.test(tag)),
    )
    expect(offTopic.length).toBeGreaterThan(40)
    const deps = fakes({ answer: offTopic })
    const nodes = await resolve(deps)
    expect(NEUTRAL).toContain(nodes['heroImage']?.props?.['src'])
    // The closing band, nothing fitting it, keeps its own dark band: its scrim is taken out.
    expect(nodes['closeImage']).toBeUndefined()
    expect(nodes['closeFrame']).toBeUndefined()
    const text = JSON.stringify(nodes)
    for (const misfit of MISFITS) expect(text).not.toContain(misfit)
    expect(text).not.toContain(`media:${HOST}/`)
  })
})
