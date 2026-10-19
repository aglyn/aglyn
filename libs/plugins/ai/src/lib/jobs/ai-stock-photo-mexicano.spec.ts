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
import { AI_LAYOUT_NO_PHOTO, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockListedCraft,
  aiStockNamedKind,
  aiStockPhotoWordsOf,
  aiStockSourceTerms,
  aiStockSubjectWords,
  aiStockWiderTerms,
  aiStockWorldIsUnlisted,
} from './ai-layout-stock-photos'
import {
  ARTIST_HERO,
  ARTIST_PORTRAIT_PEOPLE,
  ARTIST_STUDIO_WIDE,
  FOUR,
  PROJECT_FOUR,
  PROJECT_TALL,
  PROJECT_WIDE,
} from './fixtures/ai-stock-photo-mexicano-recordings'

/*
 * The beta.266 Mexicano start of 2026-10-18 (AGL-3923, job C75nFALn3H, host
 * 7R9loxHdfa): the "Personal portfolio" card (business type "a personal
 * portfolio"), the Portfolio kind, the name "ـ Mexicano" (led by an Arabic
 * tatweel), two pages. Both shipped with no picture node at all. Its home page
 * had six picture slots: an editorial hero, a mosaic of four works the model
 * titled "Project one" to "Project four", and an about picture whose recorded
 * search ("artist portrait", people) says the model described a portrait.
 * Replayed from the seven answers production's `stockPhotoSearches` cache
 * holds for it (fixtures/ai-stock-photo-mexicano-recordings.ts), read back by
 * key, through core's seams only. No network, no model.
 */

const INPUTS = {
  businessType: 'a personal portfolio',
  audience: '',
  starter: 'portfolio',
  siteKind: 'portfolio',
  pages: 2,
  businessName: 'ـ Mexicano',
}
const HOST = '7R9loxHdfa'
const JOB = 'C75nFALn3H'
const HOME = 'UAxTxG5MxC'
const SECTIONS = ['hero', 'selected work gallery', 'process steps', 'questions answered', 'about short', 'call to action button']

/** A slot as the compiler drew it: a stand-in where the model described no picture. */
const slot = (imageId: string, alt: string, aspect: number, sectionIndex: number, role: AiLayoutPictureSlot['role'], standIn = true): AiLayoutPictureSlot => ({
  imageId,
  frameId: `${imageId}-frame`,
  iconId: null,
  alt,
  aspect,
  sectionIndex,
  role,
  ...(standIn ? { standIn: true } : {}),
})

/**
 * The home page's slots, from its stored tree (version wsYyoRF0ix): the
 * editorial hero's wide photo, the mosaic's wide and narrow cells, and the
 * about split's picture. The model's own words for the about picture were not
 * stored; its recorded search names a portrait.
 */
const SLOTS: AiLayoutPictureSlot[] = [
  slot('hero', 'Quiet design that makes people look twice.', 21 / 9, 0, 'hero'),
  slot('work1', 'Project one', 4 / 3, 1, 'gallery'),
  slot('work2', 'Project two', 4 / 5, 1, 'gallery'),
  slot('work3', 'Project three', 4 / 5, 1, 'gallery'),
  slot('work4', 'Project four', 4 / 3, 1, 'gallery'),
  slot('about', 'Portrait', 3 / 2, 4, 'about', false),
]

const shapeOf = (request: StockPhotoSearchRequest) =>
  [request.query.toLowerCase(), request.orientation ?? 'any', request.minWidth ?? '', request.minHeight ?? '', request.people === true].join('|')

/** What production's cache answered each search the start sent. */
const RECORDED = new Map<string, StockPhoto[]>([
  ['artist|horizontal|1600||false', ARTIST_HERO],
  ['project|horizontal|900||false', PROJECT_WIDE],
  ['project|vertical||900|false', PROJECT_TALL],
  ['project four|horizontal|900||false', PROJECT_FOUR],
  ['four|horizontal|900||false', FOUR],
  ['artist studio|horizontal|900||false', ARTIST_STUDIO_WIDE],
  ['artist portrait|horizontal|900||true', ARTIST_PORTRAIT_PEOPLE],
])

const ALL = [...RECORDED.values()].flat()
const BY_ID = new Map(ALL.map((hit) => [hit.id, hit] as const))
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

/** A fake library over the recordings; a search the start never sent answers `others`, and is listed. */
function fakes(others: readonly StockPhoto[] = [], options: { download?: boolean } = {}) {
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
      const src = `media:${HOST}/${String(request.stockPhoto?.id)}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
    },
  }
  const source = aiLayoutStockPhotoSource(
    {
      hostId: HOST,
      uid: 'member-1',
      seed: `${JOB}:${HOME}`,
      business: INPUTS.businessType,
      sectionNames: SECTIONS,
      jobId: JOB,
      ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: INPUTS }),
    },
    { provider: () => provider, ingest: () => ingest },
  )
  return { asked, unrecorded, source }
}

beforeEach(() => aiStockForgetJobPhotos())

describe('why the Mexicano portfolio searched students, lavender and a running track (AGL-3923, beta.266)', () => {
  it('read the picked card as the Portfolio kind’s world, and the tatweel-led name as no world at all', () => {
    const terms = aiStockSourceTerms({ business: INPUTS.businessType, ...aiStockPhotoWordsOf({ plan: { language: 'en' }, inputs: INPUTS }) })
    // "personal" and "portfolio" name a kind of site, never its world: the kind's world is the artist's.
    expect(terms).toMatchObject({ business: 'artist', broad: ['artist studio', 'creative workspace'] })
    expect(aiStockWorldIsUnlisted(terms)).toBe(false)
    // The name is no craft and no kind, tatweel or not: it changed nothing.
    expect(aiStockListedCraft(INPUTS.businessName)).toBe('')
    expect(aiStockNamedKind(INPUTS.businessName)).toBe('')
  })

  it('searched the model’s placeholder titles: "Project four" is no subject, and "four" no object', () => {
    expect(aiStockSubjectWords('Project one', 'selected work gallery')).toBe('gallery')
    expect(aiStockSubjectWords('Project four', 'selected work gallery')).toBe('gallery')
    expect(aiStockSubjectWords('Sample piece', 'Recent work')).toBe('')
    // What Pixabay answered those words with: a whiteboard, lavender, a running track's lane numbers.
    expect(PROJECT_WIDE[0]?.tags.slice(0, 4)).toEqual(['people', 'girls', 'women', 'students'])
    expect(PROJECT_FOUR[0]?.tags[0]).toBe('lavender')
    expect(FOUR[0]?.tags[0]).toBe('running track')
  })
})

describe('the Mexicano home page replayed: every slot of its world, and the kind’s common photos last (AGL-3923)', () => {
  it('fills the hero, the wide works and the about picture from the recorded answers, never a bee, a tattoo or a project plan', async () => {
    const { asked, unrecorded, source } = fakes()
    const photos = (await source?.(SLOTS)) ?? []
    // The placeholder titles are never searched.
    for (const shape of asked) expect(shape).not.toMatch(/^(project|project four|four)\|/)
    const placed = photos.map((photo) => BY_ID.get(idOf(photo?.src)))
    // The hero: an artist's world among its first tags, and never the bee whose name is "artist bee".
    expect(ARTIST_HERO.map((hit) => hit.id)).toContain(placed[0]?.id)
    expect(placed[0]?.tags.slice(0, 3).join(' ')).not.toMatch(/\bbee\b|tattoo|makeup/)
    expect(placed[0]?.tags.slice(0, 4).join(' ')).toMatch(/art|artist|paint|brush|studio/)
    // The wide works: the kind's broad search, painting and its tools.
    for (const work of [placed[1], placed[4]]) {
      expect(ARTIST_STUDIO_WIDE.map((hit) => hit.id)).toContain(work?.id)
      expect(work?.tags.slice(0, 4).join(' ')).toMatch(/art|artist|paint|brush|studio|drawing/)
      expect(work?.tags.join(' ')).not.toMatch(/tattoo|pre-project|housebuilding/)
    }
    expect(ARTIST_PORTRAIT_PEOPLE.map((hit) => hit.id)).toContain(placed[5]?.id)
    // Six slots, and at least four photos from what production's cache already holds.
    expect(photos.filter((photo) => photo?.src).length).toBeGreaterThanOrEqual(4)
    // What only a live search could answer: the gallery's own word, and every tall cell's search.
    expect(unrecorded).toEqual([
      'gallery|horizontal|900||false',
      'gallery|vertical||900|false',
      'artist studio|vertical||900|false',
      'creative workspace|vertical||900|false',
      'art supplies|vertical||900|false',
      'art studio|vertical||900|false',
    ])
    expect(photos[2]).toEqual(AI_LAYOUT_NO_PHOTO)
  })

  it('fills a tall work from the Portfolio kind’s common photos, never a child, a face or a whiteboard', async () => {
    // No site sent the tall searches; the start's own tall answer stands in for every one of them.
    const { source } = fakes([...PROJECT_TALL, ...PROJECT_WIDE])
    const photos = (await source?.(SLOTS)) ?? []
    for (const index of [2, 3]) {
      const placed = BY_ID.get(idOf(photos[index]?.src))
      expect(placed).toBeDefined()
      expect(placed?.tags.slice(0, 3).join(' ')).toMatch(/art|paint|brush|pencil|drawing|studio|design|paper|canvas|sketch/)
      expect(placed?.tags.join(' ')).not.toMatch(/\b(child|children|kid|kids|girl|girls|boy|boys|baby|toddler)\b/)
      expect(placed?.tags.slice(0, 2).join(' ')).not.toMatch(/portrait|face|selfie|school board|chalk/)
    }
  })

  it('gives every slot whose chosen photo could not be copied a starter, as production’s empty library suggests', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { source } = fakes([], { download: false })
    const photos = (await source?.(SLOTS)) ?? []
    // A chosen photo that never reached the library is the library's failure, not "nothing fits".
    for (const index of [0, 1, 4, 5]) expect(photos[index]).toBeNull()
    expect(warn).toHaveBeenCalledWith('ai layout pictures: a stock photo could not be downloaded', expect.objectContaining({ provider: 'pixabay' }))
    warn.mockRestore()
  })

  it('lists the Portfolio kind’s common photos as its last rung, held to the kind’s own words', () => {
    const rungs = aiStockWiderTerms(aiStockSourceTerms({ business: INPUTS.businessType, kind: 'portfolio' }), 'portfolio')
    expect(rungs.map((rung) => rung.rung)).toEqual(['generic'])
    expect(rungs[0]?.terms.broad).toEqual(['art supplies', 'creative workspace', 'art studio'])
  })
})
