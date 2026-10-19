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
import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import {
  AI_LAYOUT_NO_PHOTO,
  AI_LAYOUT_STARTER_PHOTOS,
  aiResolveLayoutPictures,
  type AiLayoutPicturePhoto,
} from '../layout-language/ai-layout-pictures'
import type { AiJob } from '../model/ai-jobs.types'
import { aiLayoutPageCheck } from './ai-job-page-language'
import { aiSiteDatasetRecordPhotos, aiSiteDatasetRecordsFromOwn } from './ai-job-site-datasets'
import { aiLayoutStockPhotoSource, aiStockForgetJobPhotos, aiStockTagsAlt, aiStockPlacedPhotos } from './ai-layout-stock-photos'
import { WEDDING_COUPLE_MOUNTAINS } from './fixtures/ai-stock-photo-agl3942-recordings'
import {
  COUPLE_MOUNTAINS_0919,
  FAMILY_MOUNTAINS_0919,
  SUGAR_HOLLOW_PLACED,
  WEDDING_HERO,
} from './fixtures/ai-stock-photo-agl3988-recordings'

/*
 * The beta.270 Sugar Hollow Photography guided start (2026-10-19 19:01Z,
 * workspace jWmGooWE3L, host MBuUDI70oE, job DQ9pZupq6M), read back from
 * production and replayed here from what Pixabay answered
 * (fixtures/ai-stock-photo-agl3988-recordings.ts). No network, no model.
 *
 * Why its pictures were starters: the console's request logs show
 * pixabay.com's Cloudflare answering 429 to eleven downloads of the "Gallery
 * collections" covers inside 150 ms (19:03:23.79Z), to every pick of the
 * home page (19:04:24.52Z) and of the contact page (19:09:28.26Z). Each slot
 * ran through its three picks in the same burst, was left unanswered, and
 * took a starter: five "Weddings and elopements" covers a windowsill, a
 * workbench, a desk and an office team, the home hero the desk and its
 * about split the office team, the contact hero the office team. The
 * library had by then given the job three photos of its own. The client now
 * waits a 429 out (`providers/pixabay.ts`); these specs hold what a slot
 * takes when the library fails it anyway.
 */

const INPUTS = {
  businessType: 'a wedding and family photographer in the Blue Ridge Mountains who books sessions and elopements',
  audience: 'couples planning a Blue Ridge wedding or elopement, and families who want relaxed outdoor portraits',
  starter: 'portfolio',
  siteKind: 'photography',
  pages: 6,
  businessName: 'Sugar Hollow Photography',
  city: '',
  brand: '',
  originJobId: 'DQ9pZupq6M',
}

/** Each search's recorded answer, by its query, orientation and size, as the cache keyed it. */
const RECORDED: Record<string, StockPhoto[]> = {
  'couple mountains|horizontal|900|0': COUPLE_MOUNTAINS_0919,
  'family mountains|horizontal|900|0': FAMILY_MOUNTAINS_0919,
  'wedding couple mountains|horizontal|900|0': WEDDING_COUPLE_MOUNTAINS,
  'wedding|horizontal|1600|0': WEDDING_HERO,
  'wedding couple mountains|horizontal|1600|0': WEDDING_COUPLE_MOUNTAINS,
}

/** The covers' downloads production's log shows refused with 429 at 19:03:23Z, by Pixabay id. */
const REFUSED_COVERS = new Set(['6230410', '621634', '7612157', '2179256', '8028185', '5401602', '7162791', '6935359', '5693164', '5404826', '4855390'])

function stockPhotos(hostId: string, refused: (photo: StockPhoto) => boolean) {
  const downloads: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      const key = [request.query, request.orientation, request.minWidth ?? 0, request.minHeight ?? 0].join('|')
      return { photos: RECORDED[key] ?? [], cached: true }
    },
    download: async (photo) => {
      downloads.push(photo.id)
      return refused(photo) ? null : { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }
    },
    credit: () => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: 'Photo on Pixabay.',
    }),
  }
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      const src = `media:${hostId}/${String(request.stockPhoto?.id)}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
    },
  }
  return {
    downloads,
    stockPhotos: ((input) => aiLayoutStockPhotoSource(input, { provider: () => provider, ingest: () => ingest })) as typeof aiLayoutStockPhotoSource,
  }
}

/** The "Gallery collections" records production wrote, in order: title and category. */
const RECORDS: ReadonlyArray<[title: string, category: string]> = [
  ['Mountain Elopements', 'Weddings and elopements'],
  ['Wedding Days', 'Weddings and elopements'],
  ['Getting Ready', 'Weddings and elopements'],
  ['Ceremony Moments', 'Weddings and elopements'],
  ['Couple Portraits', 'Weddings and elopements'],
  ['Overlook Elopements', 'Weddings and elopements'],
  ['Family Portraits', 'Family sessions'],
  ['Engagement Sessions', 'Couples'],
]

/** The dataset's own unit job, as the scaffold derived it. */
const sugarHollow = {
  $id: 'sDJy2ElCui',
  hostId: 'MBuUDI70oE',
  createdBy: 'member-1',
  brief: '',
  plan: null,
  inputs: INPUTS,
} as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

const STARTER = /^\/_static\/starter\//
const STARTER_SRCS = new Set<string>(Object.values(AI_LAYOUT_STARTER_PHOTOS).map((photo) => photo.src))

beforeEach(() => aiStockForgetJobPhotos())

async function covers(refused: (photo: StockPhoto) => boolean) {
  const { stockPhotos: source, downloads } = stockPhotos('MBuUDI70oE', refused)
  const photos = await aiSiteDatasetRecordPhotos({
    job: sugarHollow,
    name: 'Gallery collections',
    names: RECORDS.map(([title]) => title),
    categories: RECORDS.map(([, category]) => category),
    pictures: 'things',
    stockPhotos: source,
  })
  return { photos, downloads }
}

describe('the Sugar Hollow covers the rate limit refused (AGL-3988, beta.270)', () => {
  it('replays production: the same eleven picks refused, and the same three photos copied', async () => {
    const { photos, downloads } = await covers((photo) => REFUSED_COVERS.has(photo.id))
    expect(new Set(downloads.filter((id) => REFUSED_COVERS.has(id)))).toEqual(REFUSED_COVERS)
    // Overlook Elopements, Family Portraits and Engagement Sessions, as production's records hold them.
    expect(photos.map((photo) => photo.placed)).toEqual([
      null,
      null,
      null,
      null,
      null,
      'media:MBuUDI70oE/4897535',
      'media:MBuUDI70oE/1576456',
      'media:MBuUDI70oE/7126126',
    ])
  })

  it('gives every cover left without a photo one of the list’s own, on its subject, never a starter', async () => {
    const { photos } = await covers((photo) => REFUSED_COVERS.has(photo.id))
    // Production: windowsill, workbench, desk, office team, windowsill.
    for (const photo of photos) expect(photo.src).not.toMatch(STARTER)
    const shown = photos.map((photo) => photo.src?.split('/').pop())
    // A wedding gallery shows a couple, never the father and son of the family sessions.
    expect(shown.slice(0, 6).every((id) => id === '4897535' || id === '7126126')).toBe(true)
    // Never the photo of the record beside it.
    for (const [index, id] of shown.entries()) if (index > 0) expect(id).not.toBe(shown[index - 1])
    // Each described by what it shows, and none counted as a new copy no page may place.
    expect(photos[0]?.alt).toBe('A couple in the mountains at sunset')
    expect(photos.slice(0, 5).every((photo) => photo.placed === null)).toBe(true)
  })

  it('copies every cover once the downloads are let through', async () => {
    const { photos } = await covers(() => false)
    expect(new Set(photos.map((photo) => photo.placed)).size).toBe(RECORDS.length)
    for (const photo of photos) expect(photo.src).not.toMatch(STARTER)
  })

  it('takes neutral starters only where the job has no photo of its own, never the workbench or the houseplants', async () => {
    const { photos } = await covers(() => true)
    const neutral = new Set<string>([AI_LAYOUT_STARTER_PHOTOS.hero.src, AI_LAYOUT_STARTER_PHOTOS.desk.src])
    for (const photo of photos) expect(neutral.has(String(photo.src))).toBe(true)
    for (const [index, photo] of photos.entries()) if (index > 0) expect(photo.src).not.toBe(photos[index - 1]?.src)
  })

  it('serves a record beside a copied one first, so no photo stands beside itself', () => {
    const snow: AiLayoutPicturePhoto = { src: 'media:h/4897535', width: 1280, height: 853, alt: 'A couple in the snow in the mountains' }
    const family: AiLayoutPicturePhoto = { src: 'media:h/1576456', width: 1280, height: 853, alt: 'A father with a son in the mountains' }
    const sunset: AiLayoutPicturePhoto = { src: 'media:h/7126126', width: 1280, height: 853, alt: 'A couple in the mountains at sunset' }
    const filled = aiSiteDatasetRecordsFromOwn(
      RECORDS.map(([name, category]) => ({ name, category })),
      [null, null, null, null, null, snow, family, sunset],
      'seed',
    )
    expect(filled.map((photo) => photo?.src.split('/').pop())).toEqual([
      '7126126',
      '4897535',
      '7126126',
      '4897535',
      '7126126',
      '4897535',
      '1576456',
      '7126126',
    ])
  })
})

const block = (kind: string, text: string, col = -1) => ({ kind, col, text, to: '', icon: '', style: 'none', items: [] })

/** A stored page of the plan's sections, each block as given. */
function page(sections: ReadonlyArray<{ name: string; cols: number[]; blocks: ReturnType<typeof block>[] }>): { nodes: NodesMap; ids: string[]; names: string[] } {
  const ids = sections.map((_section, index) => `sec-${index}`)
  const result = aiLayoutPageCheck({
    screen: { title: 'Home', slug: '/', template: null, sections: sections.map((section) => ({ name: section.name, uses: [], items: 0 })) } as never,
    sectionIds: ids,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A wedding photographer.' } as never,
    context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: ids },
    reusableComponents: false,
  })({
    sections: sections.map((section) => ({ band: 'plain', align: 'start', cols: section.cols, blocks: section.blocks })),
  })
  if (!result.value) throw new Error(JSON.stringify(result.violations))
  return { nodes: result.value.nodes, ids, names: sections.map((section) => section.name) }
}

/** The home page's two pictures: its hero, and the split "A little about your photographer". */
const home = () =>
  page([
    {
      name: 'Hero with book-a-session button',
      cols: [6, 6],
      blocks: [block('heading', 'Sugar Hollow Photography', 0), block('image', 'A couple on a Blue Ridge overlook at golden hour', 1)],
    },
    {
      name: 'A little about your photographer',
      cols: [6, 6],
      blocks: [block('heading', 'A little about your photographer', 0), block('image', 'The photographer laughing with a couple on a trail', 1)],
    },
  ])

/** The contact page's one picture, its intro's. */
const contact = () =>
  page([
    {
      name: 'Contact intro',
      cols: [6, 6],
      blocks: [block('heading', 'Let’s plan your Blue Ridge day', 0), block('image', 'A couple walking a mountain meadow', 1)],
    },
    { name: 'What happens after you reach out', cols: [], blocks: [block('heading', 'What happens next'), block('text', 'We write back within a day.')] },
  ])

/** What the covers' unit gave the pages: the photos its records copied, with their size and words. */
const COVER_PHOTOS: AiLayoutPicturePhoto[] = [
  { src: 'media:MBuUDI70oE/4897535', width: 1280, height: 853, alt: 'A couple in the snow in the mountains' },
  { src: 'media:MBuUDI70oE/1576456', width: 1280, height: 820, alt: 'A father with a son in the mountains' },
  { src: 'media:MBuUDI70oE/7126126', width: 1280, height: 853, alt: 'A couple in the mountains at sunset' },
]

describe('the Sugar Hollow home and contact pages the rate limit refused (AGL-3988, beta.270)', () => {
  const pictured = async (built: ReturnType<typeof page>, seed: string, jobPhotos: AiLayoutPicturePhoto[]) => {
    // Every pick of the page refused, as production's log shows.
    const { stockPhotos: source } = stockPhotos('MBuUDI70oE', () => true)
    const after = await aiResolveLayoutPictures(built.nodes, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: built.ids,
      sectionNames: built.names,
      seed,
      source: source({
        hostId: 'MBuUDI70oE',
        uid: 'member-1',
        seed,
        business: INPUTS.businessType,
        audience: INPUTS.audience,
        name: INPUTS.businessName,
        kind: 'photography',
        sectionNames: built.names,
        jobId: 'DQ9pZupq6M',
      }),
      jobPhotos,
    })
    return after
  }
  const images = (nodes: NodesMap) =>
    Object.values(nodes as unknown as Record<string, { componentId?: string; props?: Record<string, unknown> }>)
      .filter((node) => node.componentId === 'image')
      .map((node) => ({ src: String(node.props?.['src'] ?? ''), alt: String(node.props?.['alt'] ?? '') }))

  it('opens the home page on the job’s own photos, never the starters’ desk and office team', async () => {
    const after = await pictured(home(), 'DQ9pZupq6M:kFAxzYXFY3', COVER_PHOTOS)
    const shown = images(after)
    expect(shown).toHaveLength(2)
    for (const photo of shown) expect(STARTER_SRCS.has(photo.src)).toBe(false)
    expect(shown.every((photo) => COVER_PHOTOS.some((own) => own.src === photo.src))).toBe(true)
    // Never the hero's photo again beside it; each described by its own words.
    expect(shown[0]?.src).not.toBe(shown[1]?.src)
    for (const photo of shown) expect(photo.alt).toBe(COVER_PHOTOS.find((own) => own.src === photo.src)?.alt)
  })

  it('hands the next page what this one placed, by its size and words', async () => {
    const after = await pictured(home(), 'DQ9pZupq6M:kFAxzYXFY3', COVER_PHOTOS)
    const placed = aiStockPlacedPhotos(after)
    expect(placed).toHaveLength(2)
    for (const photo of placed) expect(photo).toEqual(COVER_PHOTOS.find((own) => own.src === photo.src))
  })

  it('opens the contact page on one of them too', async () => {
    const after = await pictured(contact(), 'DQ9pZupq6M:-nO0mXV-HP', COVER_PHOTOS)
    const [hero] = images(after)
    expect(COVER_PHOTOS.map((photo) => photo.src)).toContain(hero?.src)
  })

  it('keeps a neutral starter for a job with no photo of its own (AGL-3923)', async () => {
    const after = await pictured(contact(), 'DQ9pZupq6M:-nO0mXV-HP', [])
    const [hero] = images(after)
    expect([AI_LAYOUT_STARTER_PHOTOS.hero.src, AI_LAYOUT_STARTER_PHOTOS.desk.src]).toContain(hero?.src)
  })

  it('never fills a slot the library answered with nothing fitting, and keeps the page floor on the job’s own photo (AGL-3831)', async () => {
    const built = home()
    const after = await aiResolveLayoutPictures(built.nodes, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: built.ids,
      sectionNames: built.names,
      seed: 'DQ9pZupq6M:kFAxzYXFY3',
      source: async (slots) => slots.map(() => AI_LAYOUT_NO_PHOTO),
      jobPhotos: COVER_PHOTOS,
    })
    const shown = images(after)
    // The floor: the hero keeps one picture, the job's own; the other is taken out.
    expect(shown).toHaveLength(1)
    expect(COVER_PHOTOS.map((photo) => photo.src)).toContain(shown[0]?.src)
  })
})

describe('a Sugar Hollow photo’s alt text reads as a plain sentence (AGL-3988)', () => {
  const tagsOf = (id: string) => SUGAR_HOLLOW_PLACED.find((photo) => photo.id === id)?.tags ?? []

  it.each([
    ['9140142', 'A father with a care', 'A father with a girl'],
    ['10140688', 'A lakeside on a couple on bench', 'A couple on a bench by the lake'],
    ['6071186', 'A family with tourists in the mountains', 'A family in the mountains'],
    ['7065652', 'A couple with a fog at a wedding', 'A couple in the fog at a wedding'],
    ['4897535', 'A snow in the mountains', 'A couple in the snow in the mountains'],
    ['7126126', 'A couple with a sky at sunset', 'A couple in the mountains at sunset'],
    ['2191390', 'A couple with a sky at sunset', 'A couple at sunset'],
    ['1837263', 'A child with clouds by a lake', 'A father with a child by a lake'],
  ])('Pixabay %s: production said “%s”', (id, _production, plain) => {
    expect(aiStockTagsAlt(tagsOf(id))).toBe(plain)
  })

  it('says weather as where, and alone as what the photo shows, without an article', () => {
    expect(aiStockTagsAlt(['mountain', 'snow', 'winter'])).toBe('Snow in the mountains')
    expect(aiStockTagsAlt(['fog', 'forest'])).toBe('Fog in a forest')
    expect(aiStockTagsAlt(['snow'])).toBe('Snow')
  })

  it('never says the sky, a feeling or whoever else is about as a thing a person is with', () => {
    expect(aiStockTagsAlt(['couple', 'sky', 'clouds'])).toBe('A couple')
    expect(aiStockTagsAlt(['woman', 'worry', 'trust'])).toBe('A woman')
    expect(aiStockTagsAlt(['couple', 'tourists', 'beach'])).toBe('A couple on a beach')
  })

  it('reads a tag that is a phrase of its own as its parts', () => {
    expect(aiStockTagsAlt(['bride in dress', 'garden'])).toBe('A bride in a dress in a garden')
    expect(aiStockTagsAlt(['man with camera'])).toBe('A man with a camera')
  })
})
