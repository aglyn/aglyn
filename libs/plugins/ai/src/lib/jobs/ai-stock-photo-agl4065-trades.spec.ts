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
import { AI_LAYOUT_NO_PHOTO, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiLayoutStockPhotoSource, aiStockForgetJobPhotos, aiStockRelevance, aiStockSourceTerms } from './ai-layout-stock-photos'
import { SMALL_BUSINESS_OWNER_HERO } from './fixtures/ai-stock-photo-brightvale-recordings'
import { aiAgl4065Searches } from './fixtures/ai-stock-photo-agl4065-judge'
import {
  AGL4065_HITS,
  DOORS,
  DRYWALL,
  HANDYMAN,
  HANDYMAN_DESCRIBE_JOB,
  LANDSCAPING,
  RENTAL_UNIT_REPAIRS,
  TEAM_MEETING_OFFICE,
} from './fixtures/ai-stock-photo-agl4065-recordings'

/*
 * The two trades of the 2026-10-25 booth kit (AGL-4065), replayed from the
 * photos Pixabay gave them (fixtures/ai-stock-photo-agl4065-recordings.ts):
 *
 * - Bluebonnet Yard & Landscape, a landscaper whose owner picked Business &
 *   services: "landscaping" was a world the module did not list, so every
 *   hero its own search could not fill widened to the business kind's "small
 *   business owner" and "team meeting office": a man at a desk opened the
 *   home page, a businessman on a couch the services page, office teams the
 *   contact and about pages. Its irrigation section took a zen garden of sand.
 * - Two Oaks Handyman: a services record named "drywall" took a family in
 *   front of a house's metal studs (3294517), and "Describe your job" a job
 *   application form (2904780).
 *
 * "small business owner" replays its 2026-10-18 recording, the same search
 * the Brightvale start sent (fixtures/ai-stock-photo-brightvale-recordings.ts):
 * Bluebonnet placed three of its photos. Through core's seams only, no
 * network, no model.
 */

const BLUEBONNET = {
  business: 'Landscaping company: lawn care, native plant beds, xeriscape, sod, irrigation repair, seasonal cleanups; free estimates',
  audience: 'Busy homeowners and HOAs around New Braunfels who want a tidy, water-wise yard without the weekend work',
  kind: 'business',
  name: 'Bluebonnet Yard & Landscape',
  language: 'en',
}
const TWO_OAKS = {
  business: 'Handyman business: home repairs, drywall, fences and decks, doors and trim, small remodels; takes quote requests',
  audience: 'Homeowners and landlords around Seguin who need repairs done right without hiring three different trades',
  kind: 'trades',
  name: 'Two Oaks Handyman',
  language: 'en',
}

/** The office photos Bluebonnet's heroes and intros took: a desk, a couch, an online shop, two office teams. */
const OFFICES = ['10157445', '3047316', '10207329', '10213524', '10503569']
const ZEN_GARDEN = '7079355'
const FAMILY_AND_STUDS = '3294517'
const JOB_APPLICATION = '2904780'

const RECORDED: Record<string, StockPhoto[]> = {
  landscaping: LANDSCAPING,
  'small business owner': SMALL_BUSINESS_OWNER_HERO,
  'team meeting office': TEAM_MEETING_OFFICE,
  handyman: HANDYMAN,
  drywall: DRYWALL,
  'handyman describe job': HANDYMAN_DESCRIBE_JOB,
  doors: DOORS,
  'rental unit repairs': RENTAL_UNIT_REPAIRS,
}

const ALL = new Map([...AGL4065_HITS, ...SMALL_BUSINESS_OWNER_HERO.map((hit) => [hit.id, hit] as const)])
const byId = (id: string) => ALL.get(id) as StockPhoto
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: request.people ? [] : (RECORDED[request.query] ?? []), cached: true }
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

const slot = (alt: string, aspect: number, role: AiLayoutPictureSlot['role'], extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex: role === 'hero' ? 0 : 1,
  role,
  ...extra,
})

beforeEach(() => aiStockForgetJobPhotos())

describe('Bluebonnet Yard & Landscape (AGL-4065, 2026-10-25)', () => {
  const terms = aiStockSourceTerms(BLUEBONNET)
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[]) =>
    aiLayoutStockPhotoSource(
      { hostId: 'bluebonnet', uid: 'member-1', seed: 'Blk_kFvVgT:home', ...BLUEBONNET, sectionNames, jobId: 'Blk_kFvVgT' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )
  const takes = (id: string, picture: AiLayoutPictureSlot, sectionName: string) =>
    aiAgl4065Searches(terms, picture, sectionName).some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)

  it('never opens a page on an office, a desk or a businessman', async () => {
    const deps = fakes()
    const heroes = await source(deps, ['Hero: yards that thrive in Texas heat'])?.([slot('Yards that thrive in Texas heat', 16 / 9, 'hero', { standIn: true })])
    const [hero] = heroes ?? []
    expect(OFFICES).not.toContain(idOf(hero?.src))
    expect(idOf(hero?.src)).not.toBe(ZEN_GARDEN)
    // The library knew the landscaper's world, so the page never widened to an office.
    expect(deps.asked).toContain('landscaping')
    for (const office of ['small business owner', 'team meeting office', 'office workspace', 'business meeting']) expect(deps.asked).not.toContain(office)
    // Nothing recorded fits, so the hero has no photo rather than another business's.
    expect(hero).toEqual(AI_LAYOUT_NO_PHOTO)
  })

  it('never fills its irrigation section with a zen garden of sand', () => {
    const irrigation = slot('Irrigation repair and tune-ups', 4 / 3, 'gallery', { standIn: true })
    expect(takes(ZEN_GARDEN, irrigation, 'Irrigation repair and tune-ups')).toBe(false)
    for (const id of OFFICES) expect([id, takes(id, irrigation, 'Irrigation repair and tune-ups')]).toEqual([id, false])
  })
})

describe('Two Oaks Handyman (AGL-4065, 2026-10-25)', () => {
  const terms = aiStockSourceTerms(TWO_OAKS)
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[]) =>
    aiLayoutStockPhotoSource(
      { hostId: 'two-oaks', uid: 'member-1', seed: 'u62vk4OxeD:home', ...TWO_OAKS, sectionNames, jobId: 'u62vk4OxeD' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )
  const takes = (id: string, picture: AiLayoutPictureSlot, sectionName: string) =>
    aiAgl4065Searches(terms, picture, sectionName).some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)

  it('never covers its drywall service with a family in front of a house', () => {
    expect(takes(FAMILY_AND_STUDS, slot('Drywall', 4 / 3, 'gallery', { record: {} }), 'What we fix')).toBe(false)
  })

  it('searches the drywall cover by the handyman’s world first, the thing among its photo’s first tags', async () => {
    const deps = fakes()
    const [cover] = (await source(deps, ['Hero', 'What we fix'])?.([slot('Drywall', 4 / 3, 'gallery', { record: {} })])) ?? []
    expect(deps.asked[0]).toBe('handyman drywall')
    expect(idOf(cover?.src)).not.toBe(FAMILY_AND_STUDS)
  })

  it('never closes "Describe your job" on a job application', async () => {
    const band = slot('Describe the job', 16 / 9, 'gallery', { standIn: true })
    expect(takes(JOB_APPLICATION, band, 'Call to action: describe your job')).toBe(false)
    const deps = fakes()
    const [photo] = (await source(deps, ['Hero', 'Call to action: describe your job'])?.([band])) ?? []
    expect(deps.asked).not.toContain('handyman describe job')
    expect(idOf(photo?.src)).not.toBe(JOB_APPLICATION)
  })

  it('opens on a handyman at work', async () => {
    const deps = fakes()
    const [hero] = (await source(deps, ['Hero: fixed right the first time'])?.([slot('Fixed right the first time, on time', 16 / 9, 'hero', { standIn: true })])) ?? []
    expect(byId(idOf(hero?.src))?.tags.slice(0, 3).join(', ')).toMatch(/\b(?:handyman|carpenter|woodworking|tools?|drill)\b/)
  })
})
