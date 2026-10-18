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
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { AI_STOCK_PHOTO_OWN_REFUSALS, aiLayoutStockPhotoSource, aiStockForgetJobPhotos, aiStockPhotoWordsOf } from './ai-layout-stock-photos'
import {
  FREELENCING_HERO,
  FREELENCING_STORY_PEOPLE,
  FREELENCING_TALL,
  FREELENCING_TALL_PEOPLE,
  SMALL_BUSINESS_OWNER_HERO,
  SMALL_BUSINESS_OWNER_TALL,
  STORY_PEOPLE,
} from './fixtures/ai-stock-photo-brightvale-recordings'

/*
 * The beta.267 Brightvale Freelance Marketing start of 2026-10-18 (AGL-3923,
 * job dUxJutW8Dp, host QyM-_Ii5Kh), the live check of #1758: business type
 * "Freelencing site offer services", the Business & services kind, four
 * pages. #1758's widening worked: every cover hero searched "freelencing"
 * (nothing), then the business kind's "small business owner", and chose
 * Pixabay 10157445, a small-business owner at a wooden desk. Its download came
 * labeled image/png and its bytes were not PNG, so the console's media
 * library refused it with a 415, logged four times (19:44:22Z, 19:46:16Z,
 * 19:46:34Z, 19:49:16Z). That one refusal stopped every copy on its page,
 * each of the four pages tried the same photo first, and every slot of the
 * site took a starter: a pottery bench as the home hero, a coffee shop's
 * owner, houseplants. Replayed from the recorded answers
 * (fixtures/ai-stock-photo-brightvale-recordings.ts) through core's seams
 * only: the download carries the label its address names, as the beta.267
 * provider passed it on, and the library holds a label to the bytes as the
 * console's upload check does. No network, no model.
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

/** Each page's sections and its cover hero, its words as the compiler took them from the hero's heading. */
const PAGES = [
  { id: 'ri05eLYsCn', label: 'Home', sections: ['Hero with call to action', 'The story behind Brightvale'], hero: 'Marketing support that helps your business be found and remembered' },
  { id: 'fOQxskkv0C', label: 'Services', sections: ['Services introduction'], hero: 'Marketing help for businesses that want steady growth' },
  { id: 'Xkx-AAuN2b', label: 'About', sections: ['About introduction', 'Our story'], hero: 'About Brightvale Freelance Marketing' },
  { id: 'req9fzSELq', label: 'Contact', sections: ['Contact introduction'], hero: 'Contact Brightvale Freelance Marketing' },
] as const

const heroOf = (alt: string): AiLayoutPictureSlot => ({ imageId: 'hero', frameId: 'cover', iconId: null, alt, aspect: 16 / 9, sectionIndex: 0, role: 'hero', standIn: true })

/** The About page's "Our story" feature picture, beside its words (4 / 5), as its recorded searches show it. */
const STORY: AiLayoutPictureSlot = { imageId: 'story', frameId: 'storyFrame', iconId: null, alt: 'Our story', aspect: 4 / 5, sectionIndex: 1, role: 'about', standIn: true }

const shapeOf = (request: StockPhotoSearchRequest) =>
  [request.query.toLowerCase(), request.orientation ?? 'any', request.minWidth ?? '', request.minHeight ?? '', request.people === true].join('|')

const RECORDED = new Map<string, StockPhoto[]>([
  ['freelencing|horizontal|1600||false', FREELENCING_HERO],
  ['small business owner|horizontal|1600||false', SMALL_BUSINESS_OWNER_HERO],
  ['freelencing story|vertical||900|true', FREELENCING_STORY_PEOPLE],
  ['freelencing|vertical||900|true', FREELENCING_TALL_PEOPLE],
  ['freelencing|vertical||900|false', FREELENCING_TALL],
  ['story|vertical||900|true', STORY_PEOPLE],
  ['small business owner|vertical||900|false', SMALL_BUSINESS_OWNER_TALL],
])

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * A library over the recordings, and a media library that holds a photo's
 * label to its bytes as the console's upload check does (415), or refuses
 * every copy for the storage band (403) where asked.
 */
function fakes(options: { band?: boolean } = {}) {
  const unrecorded: string[] = []
  const tried: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      const recorded = RECORDED.get(shapeOf(request))
      if (!recorded) unrecorded.push(shapeOf(request))
      return { photos: recorded ?? [], cached: true }
    },
    // Every recorded photo is a JPEG; its label is what its address names, as beta.267 passed it on.
    download: async (photo) => ({
      bytes: JPEG,
      contentType: String((photo as StockPhoto & { downloadUrl?: string }).downloadUrl).endsWith('.png') ? 'image/png' : 'image/jpeg',
    }),
    credit: () => ({ providerLabel: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, text: 'Photo on Pixabay.' }),
  }
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request): Promise<PluginMediaIngestResult> => {
      tried.push(String(request.stockPhoto?.id))
      if (options.band) return { ok: false, status: 403, reason: 'Storage limit reached (500 MB)' }
      if (request.contentType === 'image/png' && !PNG.every((byte, index) => request.bytes[index] === byte)) {
        return {
          ok: false,
          status: 415,
          reason: `"${request.fileName}" is labeled image/png but its contents are not PNG. Re-save it in the format it claims to be, or upload it under its real type.`,
        }
      }
      const src = `media:${HOST}/${String(request.stockPhoto?.id)}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
    },
  }
  return { provider, ingest, unrecorded, tried }
}

const sourceFor = (page: (typeof PAGES)[number], deps: ReturnType<typeof fakes>) =>
  aiLayoutStockPhotoSource(
    {
      hostId: HOST,
      uid: 'member-1',
      seed: `${JOB}:${page.id}`,
      business: INPUTS.businessType,
      sectionNames: page.sections,
      jobId: JOB,
      ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: INPUTS }),
    },
    { provider: () => deps.provider, ingest: () => deps.ingest },
  )

const BY_ID = new Map([...RECORDED.values()].flat().map((hit) => [hit.id, hit] as const))
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

let warn: jest.SpyInstance
beforeEach(() => {
  aiStockForgetJobPhotos()
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())

describe('why the Brightvale pages showed only starters (AGL-3923, beta.267)', () => {
  it('chose Pixabay 10157445 first for every page, a .png address whose bytes are not PNG', () => {
    expect(SMALL_BUSINESS_OWNER_HERO.find((hit) => hit.id === '10157445')?.tags.slice(0, 2)).toEqual(['small business', 'entrepreneur'])
    expect((SMALL_BUSINESS_OWNER_HERO.find((hit) => hit.id === '10157445') as StockPhoto & { downloadUrl: string }).downloadUrl).toMatch(/\.png$/)
    // The refusals that are one photo's own, as the console's ingestMedia returns them.
    expect([...AI_STOCK_PHOTO_OWN_REFUSALS].sort()).toEqual([413, 415, 451])
  })
})

describe('a refusal of one photo is that photo’s, never the page’s (AGL-3923)', () => {
  it('gives every Brightvale page’s hero a stock photo of a small business, after the refused one', async () => {
    const deps = fakes()
    const srcs: string[] = []
    for (const page of PAGES) {
      const [photo] = (await sourceFor(page, deps)?.([heroOf(page.hero)])) ?? []
      expect(photo?.src).toMatch(/^media:QyM-_Ii5Kh\//)
      expect(idOf(photo?.src)).not.toBe('10157445')
      const placed = BY_ID.get(idOf(photo?.src))
      expect(placed?.tags.slice(0, 3).join(' ')).toMatch(/business|entrepreneur|office|owner|manager|workspace|shop/)
      srcs.push(String(photo?.src))
    }
    // The refused photo was tried once in the whole job, never again by a later page.
    expect(deps.tried.filter((id) => id === '10157445')).toHaveLength(1)
    // Home and Services take new photos; About and Contact, once the recorded
    // answer has no new one that fits, repeat a hero photo the job already shows.
    expect(new Set(srcs.slice(0, 2)).size).toBe(2)
    for (const src of srcs.slice(2)) expect(srcs.slice(0, 2)).toContain(src)
    // On the way they ask the business kind's other searches, which no site sent that day (answered with nothing here).
    expect(new Set(deps.unrecorded)).toEqual(
      new Set([
        'team meeting office|horizontal|1600||false',
        'brightvale freelance marketing|horizontal|1600||false',
        'marketing|horizontal|1600||false',
        'office workspace|horizontal|1600||false',
        'business meeting|horizontal|1600||false',
        'workspace desk laptop|horizontal|1600||false',
      ]),
    )
    expect(warn).toHaveBeenCalledWith(
      'ai layout pictures: the media library refused a stock photo',
      expect.objectContaining({ status: 415, id: '10157445', holds: 'this photo' }),
    )
  })

  it('keeps storing the About page’s other picture after its hero’s first pick is refused', async () => {
    const deps = fakes()
    const photos = (await sourceFor(PAGES[2], deps)?.([heroOf(PAGES[2].hero), STORY])) ?? []
    expect(photos).toHaveLength(2)
    for (const photo of photos) expect(photo?.src).toMatch(/^media:QyM-_Ii5Kh\//)
    expect(new Set(photos.map((photo) => photo?.src)).size).toBe(2)
  })

  it('still stops the page when the library refuses for the storage band, so every slot takes a starter', async () => {
    const deps = fakes({ band: true })
    const photos = (await sourceFor(PAGES[2], deps)?.([heroOf(PAGES[2].hero), STORY])) ?? []
    expect(photos).toEqual([null, null])
    // The band holds for the page: no slot tries a second hit after it.
    expect(deps.tried.length).toBeLessThanOrEqual(2)
    expect(new Set(deps.tried).size).toBe(deps.tried.length)
    expect(warn).toHaveBeenCalledWith(
      'ai layout pictures: the media library refused a stock photo',
      expect.objectContaining({ status: 403, holds: 'the page' }),
    )
  })
})
