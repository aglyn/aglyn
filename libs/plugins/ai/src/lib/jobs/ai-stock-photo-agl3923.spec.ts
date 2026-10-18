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
import type { StockPhoto, StockPhotoProvider, StockPhotoSearchRequest } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { AI_LAYOUT_NO_PHOTO, aiResolveLayoutPictures, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiLayoutDesignChoices, aiLayoutGroupVariant } from '../layout-language/ai-layout-design'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockPhotoWordsOf,
  aiStockSourceTerms,
  aiStockWiderTerms,
  aiStockWorldIsUnlisted,
} from './ai-layout-stock-photos'
import {
  BUSINESS_MEETING_OTHER,
  CLASSROOM_HERO,
  EXAM_HERO,
  EXAM_TEACHERS,
  FREELENCING_HERO,
  PHOTOGRAPHER_AT_WORK,
  PRACTICE,
  RELATED_EXAM_PRACTICE_HERO,
  START_FA_PRACTICE,
} from './fixtures/ai-stock-photo-agl3923-recordings'

/*
 * Two beta.265 starts of 2026-10-18 whose pages shipped with no picture at all
 * (AGL-3923), replayed from what production's `stockPhotoSearches` cache held,
 * read back by each search's key (fixtures/ai-stock-photo-agl3923-recordings.ts),
 * through core's seams only. No network, no model.
 *
 * - Kasvora Marketing Solutions (job BK3r4I8bF1): business type "Freelencing
 *   site offer services", the Business & services kind. Its world read as the
 *   one word "freelencing", so its cover hero searched it, Pixabay answered
 *   nothing, the slot was taken out (AGL-3856) and the hero shipped as a flat
 *   dark band. Its "Selected work gallery" was drawn as four cards of icons,
 *   so it never had a picture to fill.
 * - ACCA FA2 (job j4EHPke1PN): "ACCA FIA FA2 Official Syllables related Exam
 *   practice", the Courses & education kind. Its world read as "related exam
 *   practice", and its heroes, held to it, took none of the 80 photos Pixabay
 *   answered; both pages' heroes were taken out.
 */

const KASVORA = {
  hostId: 'BVE_NlmSzm',
  jobId: 'BK3r4I8bF1',
  screenId: '3xHuKvL6b2',
  inputs: {
    businessType: 'Freelencing site offer services',
    audience: 'for my client',
    starter: 'business',
    siteKind: 'business',
    pages: 2,
    businessName: 'Kasvora Marketing Solutions',
  },
  sections: ['Hero', 'Selected work gallery', 'Services overview', 'Why choose Kasvora', 'How we work', 'Questions answered'],
}

const ACCA = {
  hostId: 'UHBPVlUZZ9',
  jobId: 'j4EHPke1PN',
  inputs: {
    businessType: 'ACCA FIA FA2 Official Syllables related Exam practice',
    audience: 'Private',
    starter: 'business',
    siteKind: 'education',
    pages: 2,
    businessName: 'ACCA FA2',
  },
  home: { screenId: '21YHVIigTT', sections: ['Hero', 'Courses and subjects offered', 'How it works as steps', 'Teachers and who leads the practice', 'Call to action'] },
  contact: { screenId: 'UN-1w4Dj6l', sections: ['Page intro', 'What working together is like', 'Contact form'] },
}

/** A stand-in slot as the compiler draws it where the model described no picture: its section's heading as its words. */
const standIn = (imageId: string, alt: string, aspect: number, sectionIndex: number, role: AiLayoutPictureSlot['role']): AiLayoutPictureSlot => ({
  imageId,
  frameId: `${imageId}-frame`,
  iconId: null,
  alt,
  aspect,
  sectionIndex,
  role,
  standIn: true,
})

/** A search's shape as the cache keys it: its words, orientation, least size and whether it asks for people. */
const shapeOf = (request: StockPhotoSearchRequest) =>
  [request.query.toLowerCase(), request.orientation ?? 'any', request.minWidth ?? '', request.minHeight ?? '', request.people === true].join('|')

/** What production's cache answered each search the two starts sent, read back by key. */
const RECORDED = new Map<string, StockPhoto[]>([
  ['freelencing|horizontal|1600||false', FREELENCING_HERO],
  ['related exam practice|horizontal|1600||false', RELATED_EXAM_PRACTICE_HERO],
  ['exam|horizontal|1600||false', EXAM_HERO],
  ['exam teachers|vertical||900|false', EXAM_TEACHERS],
  ['start fa practice|horizontal|900||false', START_FA_PRACTICE],
  ['practice|horizontal|900||false', PRACTICE],
  // The education kind's first hero search: production's cache held this
  // answer, written 07:29Z by another site, when ACCA FA2 started at 12:05Z.
  ['classroom|horizontal|1600||false', CLASSROOM_HERO],
])

/** Offices and meetings other sites' searches were answered with that morning, for searches no site sent. */
const STAND_INS = [...PHOTOGRAPHER_AT_WORK, ...BUSINESS_MEETING_OTHER]

const BY_ID = new Map([...RECORDED.values(), STAND_INS].flat().map((hit) => [hit.id, hit] as const))
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** A fake library over the recordings: a search no start sent is answered by `others`, and listed. */
function fakes(hostId: string, others: readonly StockPhoto[], options: { download?: boolean } = {}) {
  const asked: string[] = []
  const unrecorded: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      const shape = shapeOf(request)
      asked.push(shape)
      const recorded = RECORDED.get(shape)
      if (recorded) return { photos: recorded, cached: true }
      unrecorded.push(shape)
      return { photos: [...others], cached: true }
    },
    download: async () => (options.download === false ? null : { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
    credit: () => ({ providerLabel: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, text: 'Photo on Pixabay.' }),
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
  return { asked, unrecorded, provider, ingest }
}

function sourceFor(
  site: { hostId: string; jobId: string; inputs: Record<string, unknown> },
  page: { screenId: string; sections: readonly string[] },
  library: ReturnType<typeof fakes>,
) {
  return aiLayoutStockPhotoSource(
    {
      hostId: site.hostId,
      uid: 'member-1',
      seed: `${site.jobId}:${page.screenId}`,
      business: String(site.inputs['businessType']),
      sectionNames: page.sections,
      jobId: site.jobId,
      ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: site.inputs }),
    },
    { provider: () => library.provider, ingest: () => library.ingest },
  )
}

const KASVORA_HERO = standIn('coverImage', 'Marketing support for businesses that want to be found', 16 / 9, 0, 'hero')

/**
 * The Kasvora home's hero as the compiler wrote it, before its picture was
 * taken out: the stored section and container (version t-jwjC1QqR of screen
 * 3xHuKvL6b2 on host BVE_NlmSzm), with the cover photo's frame and image that
 * `cover()` lays under them.
 */
const kasvoraHero = (): NodesMap =>
  ({
    '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-3xHuKvL6b2-section-1'] },
    'ai-3xHuKvL6b2-section-1': {
      $id: 'ai-3xHuKvL6b2-section-1',
      componentId: 'section',
      props: { element: 'section', ariaLabel: 'Hero', colorScheme: 'dark', underHeader: true },
      sx: { position: 'relative', overflow: 'hidden', display: 'flex', alignItems: { xs: 'flex-end', md: 'center' }, minHeight: { xs: '78vh', md: '86vh' } },
      nodes: ['coverImage-frame', 'apLh8twC8Q'],
    },
    'coverImage-frame': {
      $id: 'coverImage-frame',
      componentId: 'muiBox',
      sx: { position: 'absolute', overflow: 'hidden', bgcolor: 'common.black', top: 0, left: 0, width: '100%', height: '100%' },
      nodes: ['coverImage'],
    },
    coverImage: {
      $id: 'coverImage',
      componentId: 'image',
      props: { alt: KASVORA_HERO.alt, objectFit: 'cover', decorative: true, width: '100%', height: '100%' },
      sx: { opacity: 0.42 },
    },
    apLh8twC8Q: { $id: 'apLh8twC8Q', componentId: 'muiContainer', props: { maxWidth: 'lg' }, sx: { position: 'relative', zIndex: 1, py: { xs: 10, md: 14 } }, nodes: [] },
  }) as unknown as NodesMap

beforeEach(() => aiStockForgetJobPhotos())

describe('why the Kasvora and ACCA FA2 pages had no picture (AGL-3923, beta.265)', () => {
  it('read each business type as a world of its own words alone, which no kind of site widened', () => {
    const kasvora = aiStockSourceTerms({ business: KASVORA.inputs.businessType, ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: KASVORA.inputs }) })
    expect(kasvora).toMatchObject({ business: 'freelencing', craft: 'freelencing', domain: ['freelencing'], broad: ['freelencing'] })
    expect(aiStockWorldIsUnlisted(kasvora)).toBe(true)
    const acca = aiStockSourceTerms({ business: ACCA.inputs.businessType, ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: ACCA.inputs }) })
    expect(acca).toMatchObject({ business: 'related exam practice', craft: 'exam', broad: ['related exam practice', 'exam'] })
    expect(aiStockWorldIsUnlisted(acca)).toBe(true)
    // What Pixabay answered: nothing for "freelencing", and for ACCA's heroes no photo whose first tag names its world.
    expect(FREELENCING_HERO).toEqual([])
    expect(RELATED_EXAM_PRACTICE_HERO).toHaveLength(40)
    expect(EXAM_HERO).toHaveLength(40)
  })

  it('drew a business site’s "Selected work gallery" as cards, with no picture to fill', () => {
    const design = { kind: 'business', seed: 2716692543, home: true }
    const choices = aiLayoutDesignChoices(design)
    expect(aiLayoutGroupVariant(design, choices, 'Selected work gallery Selected work')).toBe('pictures')
    for (const words of ['Our portfolio', 'Project gallery', 'Spring lookbook']) expect(aiLayoutGroupVariant(design, choices, words)).toBe('pictures')
    // A section that only says "work" keeps the site's own group style.
    expect(aiLayoutGroupVariant(design, choices, 'How we work')).toBe(choices.group)
  })
})

describe('a picture whose own world finds nothing widens to the kind, the starter, its own words and the starter’s common photos (AGL-3923)', () => {
  it('lists the wider worlds for a world of its own words, and none for a listed craft or a kind-read world', () => {
    const kasvora = aiStockWiderTerms(aiStockSourceTerms({ business: KASVORA.inputs.businessType, kind: 'business' }), 'business')
    // The business kind is the business starter's own kind, so it is listed once.
    expect(kasvora.map((rung) => rung.rung)).toEqual(['kind', 'generic'])
    expect(kasvora[0]?.terms.broad).toEqual(['small business owner', 'team meeting office'])
    expect(kasvora[1]?.terms.broad).toEqual(['office workspace', 'business meeting', 'workspace desk laptop'])
    const acca = aiStockWiderTerms(aiStockSourceTerms({ business: ACCA.inputs.businessType, kind: 'education' }), 'education')
    expect(acca.map((rung) => rung.rung)).toEqual(['kind', 'starter', 'generic'])
    expect(acca[0]?.terms.broad).toEqual(['adult students classroom', 'online learning', 'adult education'])
    // Kinds that already find their photos keep their own world, and a slot nothing in it fits keeps no photo (AGL-3831).
    for (const [business, kind] of [
      ['a wedding and portrait photographer', 'photography'],
      ['Strength gym', 'fitness'],
      ['Family law firm', 'professional'],
      ['Wood-fired pizza restaurant', 'restaurant'],
      ['A barbecue catering company', 'events'],
    ] as const)
      expect(aiStockWiderTerms(aiStockSourceTerms({ business, kind }), kind)).toEqual([])
    // "LMS" is read by its education kind (#1693): a curated world, no widening.
    expect(aiStockWiderTerms(aiStockSourceTerms({ business: 'LMS', name: 'Adult Hybrid Learning Center', kind: 'education' }), 'education')).toEqual([])
  })

  it('gives the Kasvora cover hero a photo of a workplace, and keeps it', async () => {
    const library = fakes(KASVORA.hostId, STAND_INS)
    const source = sourceFor(KASVORA, KASVORA, library)
    const [photo] = (await source?.([KASVORA_HERO])) ?? []
    expect(library.asked[0]).toBe('freelencing|horizontal|1600||false')
    // Only the recorded search, then the business kind's: production never searched those, so the stand-ins answer.
    expect(library.unrecorded[0]).toBe('small business owner|horizontal|1600||false')
    const placed = BY_ID.get(idOf(photo?.src))
    expect(placed).toBeDefined()
    expect(placed?.tags[0]).toMatch(/business|office|team|meeting|workplace|coworker|entrepreneur/)
    expect(photo?.alt).toBeTruthy()
    const nodes = (await aiResolveLayoutPictures(kasvoraHero(), {
      rootId: '_@_',
      sectionIds: ['ai-3xHuKvL6b2-section-1'],
      sectionNames: KASVORA.sections,
      seed: `${KASVORA.jobId}:${KASVORA.screenId}`,
      source: sourceFor(KASVORA, KASVORA, fakes(KASVORA.hostId, STAND_INS)),
    })) as unknown as Record<string, { nodes?: string[]; props?: Record<string, unknown> }>
    expect(nodes['ai-3xHuKvL6b2-section-1']?.nodes).toEqual(['coverImage-frame', 'apLh8twC8Q'])
    expect(String(nodes['coverImage']?.props?.['src'])).toMatch(/^media:BVE_NlmSzm\//)
    expect(nodes['coverImage']?.props?.['loading']).toBe('eager')
  })

  it('fills the ACCA FA2 heroes from the education kind’s recorded answer, with no search production did not answer', async () => {
    const home = fakes(ACCA.hostId, [])
    const photos = (await sourceFor(ACCA, ACCA.home, home)?.([
      standIn('hero', 'Practise for ACCA FIA FA2 with confidence', 21 / 9, 0, 'hero'),
      standIn('teachers', 'Teachers and who leads the practice', 4 / 5, 3, 'gallery'),
      standIn('close', 'Ready to start your FA2 practice?', 16 / 9, 4, 'gallery'),
    ])) ?? []
    expect(home.unrecorded).toEqual([])
    expect(home.asked).toEqual([
      'related exam practice|horizontal|1600||false',
      'exam|horizontal|1600||false',
      'classroom|horizontal|1600||false',
      'exam teachers|vertical||900|false',
      'start fa practice|horizontal|900||false',
      'practice|horizontal|900||false',
    ])
    for (const photo of photos) expect(photo?.src).toMatch(/^media:UHBPVlUZZ9\//)
    const hero = BY_ID.get(idOf(photos[0]?.src))
    expect(CLASSROOM_HERO).toContain(hero)
    expect(hero?.tags.slice(0, 3).join(' ')).toMatch(/student|classroom|school|education|book|learning/)
    const contact = fakes(ACCA.hostId, [])
    const [intro] = (await sourceFor(ACCA, ACCA.contact, contact)?.([standIn('intro', 'Start your ACCA FA2 exam practice', 3, 0, 'hero')])) ?? []
    expect(contact.unrecorded).toEqual([])
    expect(CLASSROOM_HERO).toContain(BY_ID.get(idOf(intro?.src)))
    // Two pages of one job never show one photo twice.
    expect(intro?.src).not.toBe(photos[0]?.src)
  })

  it('still takes a picture out when nothing anywhere fits, rather than place an office for it', async () => {
    const library = fakes(KASVORA.hostId, [])
    expect(await sourceFor(KASVORA, KASVORA, library)?.([KASVORA_HERO])).toEqual([AI_LAYOUT_NO_PHOTO])
    // Every rung was tried: the kind's, the slot's own words, the starter's common photos.
    expect(library.asked).toEqual(
      expect.arrayContaining([
        'small business owner|horizontal|1600||false',
        'team meeting office|horizontal|1600||false',
        'marketing support|horizontal|1600||false',
        'office workspace|horizontal|1600||false',
        'business meeting|horizontal|1600||false',
        'workspace desk laptop|horizontal|1600||false',
      ]),
    )
  })

  it('gives a slot whose fitting photo could not be copied a starter, not an empty band', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const library = fakes(ACCA.hostId, [], { download: false })
    const [photo] = (await sourceFor(ACCA, ACCA.home, library)?.([standIn('hero', 'Practise for ACCA FIA FA2 with confidence', 21 / 9, 0, 'hero')])) ?? []
    expect(photo).toBeNull()
    expect(warn).toHaveBeenCalledWith('ai layout pictures: a stock photo could not be downloaded', expect.objectContaining({ provider: 'pixabay' }))
    warn.mockRestore()
  })
})
