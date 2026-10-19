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
import type { AiJob } from '../model/ai-jobs.types'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiSiteDatasetRecordPhotos } from './ai-job-site-datasets'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockPhotoAlt,
  aiStockRecordScene,
  aiStockRelevance,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  aiStockTagsAlt,
} from './ai-layout-stock-photos'
import { COUPLE, COUPLE_MOUNTAINS, FAMILY_MOUNTAINS } from './fixtures/ai-stock-photo-agl3856-beta265-recordings'
import {
  FAMILY_AUTUMN,
  PHOTOGRAPHER_AT_WORK,
  PHOTOGRAPHER_AT_WORK_TALL,
  PHOTOGRAPHER_CAMERA,
  WEDDING_COUPLE_MOUNTAINS,
  WEDDING_COUPLE_MOUNTAINS_TALL,
} from './fixtures/ai-stock-photo-agl3942-recordings'

/*
 * The beta.267 Copper Hollow Film & Portrait guided start (2026-10-18 19:44Z,
 * workspace jWmGooWE3L, host UGq7ta7ZKC, job gPcsOz5Djk), read back from
 * production and replayed here from what Pixabay answered
 * (fixtures/ai-stock-photo-agl3942-recordings.ts). A search production never
 * sent answers nothing. No network, no model.
 *
 *  - Its covers' alt texts read "A bride groom with car wallpapers" (Pixabay
 *    621634) and "A family with a together" (6630349).
 *  - Two "Gallery collections" covers of a Blue Ridge photographer were
 *    beaches: "Ridgetop Elopements" (4010627, "beach, couple, nature,
 *    mountain") and "Getting Ready and Details" (1434873, "romantic wedding
 *    couple, the beach"); "Generations Together" was a father and son on a
 *    coast (7488520).
 *  - Every /about picture was a stock photographer, searched "photographer at
 *    work" and "photographer camera": "A television photographer" (4214881),
 *    "A photographer with a laptop in an office" (7136991), and the home's
 *    "A short personal about" a photographer on a street at night (1927265).
 */

const ALL = [
  ...WEDDING_COUPLE_MOUNTAINS,
  ...WEDDING_COUPLE_MOUNTAINS_TALL,
  ...FAMILY_AUTUMN,
  ...PHOTOGRAPHER_AT_WORK,
  ...PHOTOGRAPHER_AT_WORK_TALL,
  ...PHOTOGRAPHER_CAMERA,
  ...COUPLE_MOUNTAINS,
  ...COUPLE,
  ...FAMILY_MOUNTAINS,
]
const byId = (id: string) => ALL.find((photo) => photo.id === id) as StockPhoto
const tagsOf = (id: string | null | undefined) => (id ? (byId(id)?.tags ?? []) : [])

const INPUTS = {
  businessType: 'A wedding and portrait photographer in Asheville, North Carolina shooting film and digital',
  audience: 'Couples planning mountain weddings and elopements, and families booking portrait sessions in the Blue Ridge',
  starter: 'portfolio',
  siteKind: 'photography',
  pages: 5,
  businessName: 'Copper Hollow Film & Portrait',
  originJobId: 'gPcsOz5Djk',
}

/** Each search's recorded answer, by its query, orientation, size and category, as the cache keyed it. */
const RECORDED: Record<string, StockPhoto[]> = {
  'couple mountains|horizontal|900|0': COUPLE_MOUNTAINS,
  'couple|horizontal|900|0': COUPLE,
  'family mountains|horizontal|900|0': FAMILY_MOUNTAINS,
  'family autumn|horizontal|900|0': FAMILY_AUTUMN,
  'wedding couple mountains|horizontal|900|0': WEDDING_COUPLE_MOUNTAINS,
  'wedding couple mountains|vertical|0|900': WEDDING_COUPLE_MOUNTAINS_TALL,
  // What production's about page asked, answered as it was: a photographer at every turn.
  'photographer at work|horizontal|900|0': PHOTOGRAPHER_AT_WORK,
  'photographer at work|vertical|0|900': PHOTOGRAPHER_AT_WORK_TALL,
  'photographer camera|horizontal|900|0': PHOTOGRAPHER_CAMERA,
}

function stockPhotos(hostId: string) {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      const key = [request.query, request.orientation === 'any' ? 'all' : request.orientation, request.minWidth ?? 0, request.minHeight ?? 0]
        .concat(request.people ? ['people'] : [])
        .join('|')
      asked.push(request.query)
      return { photos: RECORDED[key] ?? [], cached: true }
    },
    download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
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
    asked,
    provider,
    ingest,
    stockPhotos: ((input) => aiLayoutStockPhotoSource(input, { provider: () => provider, ingest: () => ingest })) as typeof aiLayoutStockPhotoSource,
  }
}

beforeEach(() => aiStockForgetJobPhotos())

/** The words a description never ends on, and the tag soup production wrote. */
const DANGLING = /\b(?:a|an|the|and|or|with|in|on|at|by|of|for|to)$/i
const TAG_SOUP = /\b(?:wallpapers?|backgrounds?|backdrops?|together|textures?)\b|\b(?:a|an) (?:a|an|the|with|and)\b/i

describe('a stock photo’s alt text reads as a plain sentence (AGL-3942)', () => {
  it('says production’s two covers plainly', () => {
    // "A bride groom with car wallpapers": two people side by side, and a car laid out as a wallpaper.
    expect(aiStockTagsAlt(tagsOf('621634'))).toBe('A bride and groom with a car')
    // "A family with a together": an adverb is no thing a family holds.
    expect(aiStockTagsAlt(tagsOf('6630349'))).toBe('A family')
  })

  it('describes a record’s cover by those words, its name being a search’s', () => {
    const cover = (alt: string) => ({ alt, standIn: true }) as Pick<AiLayoutPictureSlot, 'alt' | 'product' | 'standIn'>
    expect(aiStockPhotoAlt(byId('621634'), cover('Barn and Farm Weddings'))).toBe('A bride and groom with a car')
    expect(aiStockPhotoAlt(byId('6630349'), cover('Fall Color Mini Portraits'))).toBe('A family')
  })

  it('writes the letters of a camera’s kind in capitals, with the article they are said with', () => {
    // Production: "A slr camera".
    expect(aiStockTagsAlt(tagsOf('581126'))).toBe('An SLR camera')
    expect(aiStockTagsAlt(['dslr', 'tripod'])).toBe('A DSLR and a tripod')
  })

  it('never ends on an article or a preposition, nor says a layout word or an adverb as a thing, for any recorded hit', () => {
    for (const photo of ALL) {
      const alt = aiStockTagsAlt(photo.tags ?? [])
      if (alt === null) continue
      expect([photo.id, alt, DANGLING.test(alt)]).toEqual([photo.id, alt, false])
      expect([photo.id, alt, TAG_SOUP.test(alt)]).toEqual([photo.id, alt, false])
    }
  })
})

/** The eleven "Gallery collections" records production wrote, in order: title and category. */
const GALLERY_RECORDS: ReadonlyArray<[title: string, category: string]> = [
  ['Ridgetop Elopements', 'Weddings and elopements'],
  ['Mountain Wedding Days', 'Weddings and elopements'],
  ['Barn and Farm Weddings', 'Weddings and elopements'],
  ['Golden Hour Portraits for Two', 'Weddings and elopements'],
  ['Intimate Micro Weddings', 'Weddings and elopements'],
  ['Getting Ready and Details', 'Weddings and elopements'],
  ['Family Sessions Outdoors', 'Family portraits'],
  ['Generations Together', 'Family portraits'],
  ['Fall Color Mini Portraits', 'Family portraits'],
  ['Newborn and Early Days', 'Family portraits'],
  ['Anniversary and Couples Sessions', 'Family portraits'],
]
const TITLES = GALLERY_RECORDS.map(([title]) => title)
const CATEGORIES = GALLERY_RECORDS.map(([, category]) => category)

/** The dataset's own unit job, as the scaffold derived it. */
const copperHollow = {
  $id: 'H_Nd-meToA',
  hostId: 'UGq7ta7ZKC',
  createdBy: 'member-1',
  brief: '',
  plan: { language: 'en' },
  inputs: INPUTS,
} as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

/** Words a photo by the sea or of a city is tagged with. */
const ELSEWHERE = /\b(?:beach|beaches|sea|seaside|ocean|coast|coastal|shore|surf|waves|caribbean|tropical|island|city|street|urban)\b/

describe('a Blue Ridge photographer’s covers are never set by the sea (AGL-3942)', () => {
  const terms = aiStockSourceTerms({ business: INPUTS.businessType, audience: INPUTS.audience })

  it('turns down production’s beach and coast covers for their records', () => {
    expect(terms.setting).toBe('mountains')
    const judged = (record: string, id: string) => {
      const index = TITLES.indexOf(record)
      const scene = aiStockRecordScene(record, CATEGORIES[index], 'mountains')
      if (!scene) throw new Error(record)
      return aiStockRelevance(byId(id), {
        subject: scene.subject,
        domain: [],
        strict: true,
        object: scene.object,
        kin: scene.lead,
        lead: true,
        needs: scene.people,
        named: [...terms.named, ...scene.named],
        away: scene.away,
      })
    }
    // "beach, couple, nature, mountain": its mountain was what let it in.
    expect(judged('Ridgetop Elopements', '4010627')).toBe(0)
    expect(judged('Getting Ready and Details', '1434873')).toBe(0)
    expect(judged('Generations Together', '7488520')).toBe(0)
    // The mountain couples production also placed still fit.
    expect(judged('Anniversary and Couples Sessions', '7162791')).toBeGreaterThan(0)
    expect(judged('Family Sessions Outdoors', '1576456')).toBeGreaterThan(0)
  })

  it('places every cover from its own scene, none by the sea or in a city', async () => {
    const { stockPhotos: source } = stockPhotos('UGq7ta7ZKC')
    const photos = await aiSiteDatasetRecordPhotos({
      job: copperHollow,
      name: 'Gallery collections',
      names: TITLES,
      categories: CATEGORIES,
      pictures: 'things',
      stockPhotos: source,
    })
    const ids = photos.map((photo) => photo.placed?.split('/').pop() ?? null)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect([id, tagsOf(id).slice(0, 8).join(', ')]).toEqual([id, expect.not.stringMatching(ELSEWHERE)])
    for (const id of ['4010627', '1434873', '7488520']) expect(ids).not.toContain(id)
    for (const photo of photos) {
      expect(photo.alt ?? '').not.toMatch(DANGLING)
      expect(photo.alt ?? '').not.toMatch(TAG_SOUP)
    }
  })
})

/** What a picture of the work never leads with: the photographer, a camera. */
const MAKER = /\b(?:photographers?|photography|cameras?|lens|dslr|slr|journalist)\b/
/** What it leads with instead: the people a photographer photographs, or the place. */
const THE_WORK = /\b(?:couples?|bride|groom|lovers|newlyweds?|husband|wife|wedding|family|families|father|mother|parents?|son|daughter|children|mountains?)\b/

const slot = (
  imageId: string,
  alt: string,
  aspect: number,
  sectionIndex: number,
  role: AiLayoutPictureSlot['role'],
): AiLayoutPictureSlot => ({ imageId, frameId: `${imageId}-frame`, iconId: null, alt, aspect, sectionIndex, role })

describe('a photographer’s about and intro pictures show the work, never a stock photographer (AGL-3942)', () => {
  const terms = aiStockSourceTerms({ business: INPUTS.businessType, audience: INPUTS.audience, kind: 'photography' })

  it('reads the work from the site’s own words: its couples and its families, where it is', () => {
    expect(terms.work?.map((scene) => scene.queries)).toEqual([
      ['wedding couple mountains', 'wedding couple'],
      ['family mountains', 'family'],
    ])
    // A family session is still never a bride, whatever else the site names.
    expect(terms.work?.[1]?.shun).toEqual(expect.arrayContaining(['bride', 'wedding']))
  })

  it('never searches the profession’s noun, its tools or its maker at work for an about, a story or an intro picture', () => {
    const asked = (alt: string, sectionName: string, role: AiLayoutPictureSlot['role'], aspect = 3 / 2) => {
      const one = { alt, role, aspect }
      const subject = aiStockSubjectWords(alt, sectionName)
      return aiStockSearchesFor(one, terms, subject, aiStockSlotPart(one, sectionName), sectionName).map((search) => search.query)
    }
    const pictures = [
      asked('Portrait of the photographer with a film camera on a Blue Ridge overlook', 'Our story in the mountains', 'about'),
      asked('The photographer loading a roll of medium format film', 'How we photograph', 'gallery', 4 / 5),
      asked('Photographer on a mountain overlook at golden hour', 'A short personal about', 'about'),
      asked('Copper Hollow Film & Portrait', 'About intro', 'hero', 16 / 9),
      asked('Copper Hollow Film & Portrait', 'Contact intro', 'hero', 16 / 9),
    ]
    for (const queries of pictures) {
      expect(queries.filter((query) => /photograph|camera/.test(query))).toEqual([])
      expect(queries).toEqual(expect.arrayContaining(['wedding couple mountains', 'family mountains', 'mountains']))
    }
    // A picture's own words keep the thing they name: "A film camera beside a digital camera".
    expect(asked('A film camera beside a digital camera', 'Film and digital approach', 'gallery')[0]).toBe('film camera')
  })

  it('fills production’s about page with its couples, never a photographer, from what the library answered', async () => {
    const { stockPhotos: source, asked } = stockPhotos('UGq7ta7ZKC')
    const sections = ['About intro', 'Our story in the mountains', 'How we photograph']
    const slots = [
      slot('story', 'Portrait of the photographer with a film camera on a Blue Ridge overlook', 3 / 2, 1, 'about'),
      slot('how1', 'The photographer loading a roll of medium format film', 4 / 5, 2, 'gallery'),
      slot('how2', 'Reviewing contact sheets on a light table', 4 / 5, 2, 'gallery'),
      slot('how3', 'Framing a shot from a ridge at golden hour', 4 / 5, 2, 'gallery'),
      slot('how4', 'A session bag packed with film and lenses', 4 / 5, 2, 'gallery'),
    ]
    const photos =
      (await source({
        hostId: 'UGq7ta7ZKC',
        uid: 'member-1',
        seed: 'gPcsOz5Djk:2g962e2z-_',
        business: INPUTS.businessType,
        language: 'en',
        name: INPUTS.businessName,
        audience: INPUTS.audience,
        kind: 'photography',
        sectionNames: sections,
        jobId: 'gPcsOz5Djk',
      })?.(slots)) ?? []
    // Production asked "photographer at work" and "photographer camera" and nothing else.
    expect(asked.filter((query) => /photograph|camera/.test(query))).toEqual([])
    const ids = photos.map((photo) => (photo?.src ?? '').split('/').pop() || null)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      const lead = tagsOf(id).slice(0, 3).join(', ')
      expect([id, lead]).toEqual([id, expect.not.stringMatching(MAKER)])
      expect([id, lead]).toEqual([id, expect.stringMatching(THE_WORK)])
      expect([id, tagsOf(id).slice(0, 8).join(', ')]).toEqual([id, expect.not.stringMatching(ELSEWHERE)])
    }
    // None of production's photographers again.
    for (const id of ['4214881', '7136991', '7115394', '4823479', '4673912', '1927265']) expect(ids).not.toContain(id)
    for (const photo of photos) expect(photo?.alt ?? '').not.toMatch(MAKER)
  })

  it('is the work of a craft whose pictures are its subjects: a potter’s story still shows the potter at work', () => {
    const potter = aiStockSiteTerms('A ceramic studio making stoneware mugs and bowls')
    expect(potter.work).toBeUndefined()
    const story = { alt: 'Throwing a bowl on the wheel', role: 'gallery' as const, aspect: 4 / 5 }
    const queries = aiStockSearchesFor(story, potter, aiStockSubjectWords(story.alt, 'Our story'), 'story', 'Our story').map((search) => search.query)
    expect(queries[0]).toBe('pottery wheel')
    expect(queries).toContain('potter at work')
  })
})
