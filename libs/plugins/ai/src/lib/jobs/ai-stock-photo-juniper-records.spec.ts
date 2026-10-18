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
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiLayoutRecordCardFields } from '../layout-language/ai-layout-compiler'
import { aiLayoutRecordImageAltField } from '../layout-language/ai-layout-listings'
import type { AiJob } from '../model/ai-jobs.types'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockRank,
  aiStockScene,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSubjectWords,
  type AiStockJudgement,
  type AiStockSearch,
} from './ai-layout-stock-photos'
import { AI_SITE_DATASET_IMAGE_ALT_FIELD, aiSiteDatasetContentWithPhotos, aiSiteDatasetRecordPhotos } from './ai-job-site-datasets'
import { MOUNTAIN_WEDDING_DAY_WIDE, WEDDING_SESSION_WIDE, WEDDING_WIDE_CARD } from './fixtures/ai-stock-photo-juniper-records-recordings'

/*
 * The "Selected work" dataset of the beta.259 Juniper and Rye Photography
 * start (AGL-3856, job FrKrUct5mk), shown again on a beta.262 build: its
 * record covers were searched by each record's name qualified by the craft,
 * and took the red roses (3799286) for "Mountain Wedding Day", a bride and
 * groom under a stone arcade (6825609) for "Ridgetop Elopement" and a bride
 * (3909540) for "Family Session in the Fall", each image's alt the record's
 * title. Replayed from what Pixabay answered
 * (fixtures/ai-stock-photo-juniper-records-recordings.ts). No network, no
 * model.
 */

const PHOTOGRAPHER = 'A wedding and portrait photographer in Asheville, North Carolina shooting film and digital'
const ROSES = '3799286'
const SNOWY_MOUNTAIN_COUPLE = '7003291'
/** A bride and groom, tagged so first (AGL-3856, beta.265): a record's cover leads with its people. */
const BRIDE_AND_GROOM = '8028185'
const ARCADE_BRIDE = '3909540'
const BRIDE_AND_DAD = '7983099'

const terms = aiStockSiteTerms(PHOTOGRAPHER)

const card = (alt: string): AiLayoutPictureSlot => ({
  imageId: 'record0',
  frameId: null,
  iconId: null,
  alt,
  aspect: 4 / 3,
  sectionIndex: 0,
  role: 'gallery',
  standIn: true,
})

/** A record's first search, the scene's, and how the source judges its hits. */
function sceneOf(title: string): { search: AiStockSearch; judgement: AiStockJudgement } {
  const [search] = aiStockSearchesFor(card(title), terms, aiStockSubjectWords(title, 'Selected work'))
  const found = search as AiStockSearch
  return {
    search: found,
    judgement: {
      subject: found.subject ?? '',
      domain: terms.domain,
      strict: Boolean(found.strict),
      named: terms.named,
      rivals: terms.rivals,
      ...(found.object ? { object: found.object } : {}),
      ...(found.kin ? { kin: found.kin } : {}),
      ...(found.lead ? { lead: true } : {}),
      ...(found.refuse ? { refuse: found.refuse } : {}),
      ...(found.needs ? { needs: found.needs } : {}),
      ...(found.allow ? { named: [...terms.named, ...found.allow] } : {}),
    },
  }
}

const tagsOf = (photo: StockPhoto | undefined) => (photo?.tags ?? []).join(', ')

/** A family photo of the kind the new search asks for; not recorded, since production never sent it. */
const family = (id: string, tags: string[]): StockPhoto =>
  ({
    provider: 'pixabay',
    id,
    width: 1280,
    height: 853,
    pageUrl: `https://pixabay.com/photos/${tags.slice(0, 3).join('-')}-${id}/`,
    photographer: 'A Pixabay contributor',
    tags,
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto
const AUTUMN_FAMILY = family('9000001', ['family', 'autumn', 'children', 'leaves', 'park', 'mother', 'father'])
const BEACH_FAMILY = family('9000002', ['family', 'beach', 'children', 'sea'])

describe('a photographer’s record covers searched by their scene (AGL-3856)', () => {
  it('reads each title’s people and where they are, from every word', () => {
    expect(terms.scenes).toBe(true)
    expect(aiStockScene('Ridgetop Elopement')).toMatchObject({ queries: ['couple mountains', 'couple'], subject: 'couple mountains' })
    expect(aiStockScene('Mountain Wedding Day')).toMatchObject({ queries: ['wedding couple mountains', 'wedding couple'] })
    expect(aiStockScene('Family Session in the Fall')).toMatchObject({ queries: ['family autumn', 'family'], subject: 'family autumn' })
    expect(aiStockScene('Film')).toBeNull()
    // A gym's family plan is no photographer's family session.
    expect(aiStockSiteTerms('A strength gym').scenes).toBeUndefined()
  })

  it('asks for a couple in the mountains first, never the craft and the title', () => {
    const searches = aiStockSearchesFor(card('Ridgetop Elopement'), terms, aiStockSubjectWords('Ridgetop Elopement', 'Selected work'))
    expect(searches.map((search) => search.query).slice(0, 2)).toEqual(['couple mountains', 'couple'])
    expect(searches.map((search) => search.query)).not.toContain('photographer ridgetop elopement')
  })

  it('"Mountain Wedding Day": a couple in the mountains, never the roses', () => {
    const { judgement } = sceneOf('Mountain Wedding Day')
    const ranked = aiStockRank(MOUNTAIN_WEDDING_DAY_WIDE, new Set(), 'FrKrUct5mk:records:1:wedding couple mountains', judgement)
    expect(ranked.map((photo) => photo.id)).not.toContain(ROSES)
    expect(ranked[0]?.id).toBe(SNOWY_MOUNTAIN_COUPLE)
    for (const photo of ranked) expect(tagsOf(photo)).toMatch(/couple|bride|groom|newlywed|lovers|husband|wife|\bman\b|woman/)
  })

  it('"Ridgetop Elopement": a couple leading the photo', () => {
    const { judgement } = sceneOf('Ridgetop Elopement')
    const ranked = aiStockRank(WEDDING_WIDE_CARD, new Set(), 'FrKrUct5mk:records:0:couple mountains', judgement)
    expect(ranked.length).toBeGreaterThan(0)
    for (const photo of ranked) expect(photo.tags.slice(0, 3).join(', ')).toMatch(/couple|bride|groom|wedding|newlyweds|lovers/)
    // The church aisle is a wedding's, never a couple's photo.
    expect(ranked.map((photo) => photo.id)).not.toContain('7744547')
  })

  it('"Family Session in the Fall": never a bride, and a family in autumn over one at the beach', () => {
    const { judgement } = sceneOf('Family Session in the Fall')
    // The brief names weddings; a family session still never shows a bride.
    expect(aiStockRank(WEDDING_SESSION_WIDE, new Set(), 'x', judgement)).toEqual([])
    for (const id of [ARCADE_BRIDE, BRIDE_AND_DAD]) expect(WEDDING_SESSION_WIDE.some((photo) => photo.id === id)).toBe(true)
    const ranked = aiStockRank([BEACH_FAMILY, AUTUMN_FAMILY, ...WEDDING_SESSION_WIDE], new Set(), 'x', judgement)
    expect(ranked.map((photo) => photo.id)).toEqual([AUTUMN_FAMILY.id, BEACH_FAMILY.id])
  })
})

describe('a record’s cover described by what it shows (AGL-3856)', () => {
  const job = {
    $id: 'FrKrUct5mk',
    hostId: 'nVj_-hl115',
    createdBy: 'member-1',
    brief: PHOTOGRAPHER,
    plan: { language: 'en' },
    inputs: { businessType: PHOTOGRAPHER, businessName: 'Juniper and Rye Photography' },
  } as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

  function stockPhotos(answers: Record<string, StockPhoto[]>) {
    const asked: string[] = []
    const provider: StockPhotoProvider = {
      id: 'pixabay',
      label: 'Pixabay',
      isConfigured: () => true,
      search: async (request) => {
        asked.push(request.query)
        return { photos: request.people ? [] : (answers[request.query] ?? []), cached: true }
      },
      download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
      credit: () => ({ providerLabel: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, text: 'Photo on Pixabay.' }),
    }
    const library = new Map<string, string>()
    const ingest: PluginMediaIngest = {
      ingest: async (request) => {
        const src = `media:nVj_-hl115/${String(request.stockPhoto?.id)}`
        library.set(String(request.stockPhoto?.key), src)
        return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 1280, height: 853 }
      },
      findStockPhoto: async ({ sourceKey }) => {
        const src = library.get(sourceKey)
        return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
      },
    }
    return { asked, stockPhotos: ((input) => aiLayoutStockPhotoSource(input, { provider: () => provider, ingest: () => ingest })) as typeof aiLayoutStockPhotoSource }
  }

  it('places each record’s scene and keeps its photo’s own words, never its title', async () => {
    aiStockForgetJobPhotos()
    // The new searches were never sent in production: the recorded answers to the old ones stand in for them.
    const { stockPhotos: source, asked } = stockPhotos({
      'couple mountains': WEDDING_WIDE_CARD,
      'wedding couple mountains': MOUNTAIN_WEDDING_DAY_WIDE,
      'family autumn': [AUTUMN_FAMILY, ...WEDDING_SESSION_WIDE],
    })
    const titles = ['Ridgetop Elopement', 'Mountain Wedding Day', 'Family Session in the Fall']
    const photos = await aiSiteDatasetRecordPhotos({ job, name: 'Selected work', names: titles, pictures: 'things', stockPhotos: source })
    expect(asked.slice(0, 1)).toEqual(['couple mountains'])
    const ids = photos.map((photo) => photo.placed?.split('/').pop())
    expect(ids).not.toContain(ROSES)
    // A record's cover is led by its people (AGL-3856, beta.265): the snowy
    // couple's first tags are "wedding, snow, prenup shoot", the bride and
    // groom's "bride, groom, wedding".
    expect(ids[1]).toBe(BRIDE_AND_GROOM)
    expect(ids[2]).toBe(AUTUMN_FAMILY.id)
    for (const [index, photo] of photos.entries()) {
      expect(photo.alt).toBeTruthy()
      expect(photo.alt).not.toBe(titles[index])
      expect(photo.alt).not.toContain(',')
    }
    expect(photos[2]?.alt).toBe('A family in a park')
  })

  it('keeps each photo’s words in an "Image description" field the card takes as its alt, never as its words', () => {
    const content = aiSiteDatasetContentWithPhotos(
      { fields: [{ name: 'Title', type: 'text' }, { name: 'Description', type: 'text' }], records: [{ Title: 'Mountain Wedding Day', Description: 'A full day.' }] },
      ['/api/media/cdn/nVj_-hl115/m1'],
      ['A wedding couple in the mountains'],
    )
    expect(content['fields']).toEqual([
      { name: 'Title', type: 'text' },
      { name: 'Description', type: 'text' },
      { name: 'Image', type: 'image' },
      { name: AI_SITE_DATASET_IMAGE_ALT_FIELD, type: 'text' },
    ])
    expect((content['records'] as Array<Record<string, unknown>>)[0]?.[AI_SITE_DATASET_IMAGE_ALT_FIELD]).toBe('A wedding couple in the mountains')
    const fields = [
      { id: 'title', name: 'Title', type: 'text' },
      { id: 'description', name: 'Description', type: 'text' },
      { id: 'image_description', name: AI_SITE_DATASET_IMAGE_ALT_FIELD, type: 'text' },
    ]
    expect(aiLayoutRecordImageAltField(fields)).toBe('image_description')
    expect(aiLayoutRecordCardFields(fields)).toEqual({ title: 'title', kicker: null, body: 'description' })
  })
})
