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

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { StockPhoto, StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiBuildPlanCreate } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import type { generateAiDataset } from '../runtime/ai-dataset-generation'
import { aiLayoutPageCheck, aiLayoutPagePrompt } from './ai-job-page-language'
import {
  AI_SITE_DATASET_INPUT,
  aiSiteDatasetCategoryOf,
  aiSiteDatasetInputOf,
  aiSiteDatasetListings,
  aiSiteDatasetRecordPhotos,
  createAiSiteDatasetRunner,
} from './ai-job-site-datasets'
import type { AiJobStepContext } from './ai-job-text-step'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockPeopleRole,
  aiStockRecordScene,
  aiStockRelevance,
  aiStockRoleRefusals,
  aiStockSameShoot,
  aiStockSourceTerms,
  aiStockTagsAlt,
  AI_STOCK_ROLE_TAGS_READ,
} from './ai-layout-stock-photos'
import {
  COACH_BARBELL,
  COUPLE,
  COUPLE_MOUNTAINS,
  FAMILY_MOUNTAINS,
  GRANITE_PEAK_PLACED,
  LAUREL_RIDGE_PLACED,
  NORTHGATE_PLACED,
  TEACHER_CLASSROOM,
} from './fixtures/ai-stock-photo-agl3856-beta265-recordings'
import {
  AI_LAYOUT_LISTING_ELEMENTS,
  aiLayoutRecordsPlacements,
  aiLayoutSectionGroup,
  type AiLayoutListing,
} from '../layout-language/ai-layout-listings'
import type { AiLayoutTargets } from '../layout-language/ai-layout-links'

/*
 * Three fresh production guided starts on beta.265 (2026-10-18 ~07:25Z,
 * workspace jWmGooWE3L), read back from production and replayed here from
 * what Pixabay answered (fixtures/ai-stock-photo-agl3856-beta265-recordings.ts).
 * A search production never sent answers nothing. No network, no model.
 *
 *  - LAUREL RIDGE FILM & PORTRAIT (photography, job NyPDNIaYzN): every
 *    "Gallery collections" cover was searched "photographer <record>" and
 *    held to the craft, so the galleries showed a press photographer, a toy
 *    frog with a camera, a cat; and "Weddings and elopements" and "Family
 *    portraits" on /galleries each listed all ten records.
 *  - NORTHGATE ADULT LEARNING CENTER (LMS, job wais118U3Q): "Meet your
 *    teachers" placed a woman painting at an easel, a model in a traditional
 *    dress and an elderly man's portrait.
 *  - GRANITE PEAK BARBELL (gym, job vr-AuxZcBC): its coaches came out right,
 *    and still do.
 */

const ALL = [
  ...COUPLE_MOUNTAINS,
  ...COUPLE,
  ...FAMILY_MOUNTAINS,
  ...TEACHER_CLASSROOM,
  ...COACH_BARBELL,
  ...LAUREL_RIDGE_PLACED,
  ...NORTHGATE_PLACED,
  ...GRANITE_PEAK_PLACED,
]
const byId = (id: string) => ALL.find((photo) => photo.id === id) as StockPhoto
const tagsOf = (id: string | null | undefined) => (id ? (byId(id)?.tags ?? []) : [])

/** Each search's recorded answer, by its query, orientation, size and category, as the cache keyed it. */
const RECORDED: Record<string, StockPhoto[]> = {
  'couple mountains|horizontal|900|0': COUPLE_MOUNTAINS,
  'couple|horizontal|900|0': COUPLE,
  'family mountains|horizontal|900|0': FAMILY_MOUNTAINS,
  'teacher classroom|vertical|0|900|people': TEACHER_CLASSROOM,
  'coach barbell|vertical|0|900|people': COACH_BARBELL,
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
    stockPhotos: ((input) => aiLayoutStockPhotoSource(input, { provider: () => provider, ingest: () => ingest })) as typeof aiLayoutStockPhotoSource,
  }
}

beforeEach(() => aiStockForgetJobPhotos())

// ── Laurel Ridge Film & Portrait ─────────────────────────────────────────

const LAUREL_RIDGE_INPUTS = {
  businessType: 'A wedding and portrait photographer in Asheville, North Carolina shooting film and digital',
  audience: 'Couples planning mountain weddings and elopements, and families booking portrait sessions in the Blue Ridge',
  starter: 'portfolio',
  siteKind: 'photography',
  pages: 5,
  businessName: 'Laurel Ridge Film & Portrait',
  originJobId: 'NyPDNIaYzN',
}

/** The dataset's own unit job, as the scaffold derived it: named by the plan entry's id. */
const laurelRidge = {
  $id: 'cpFBKD043i',
  hostId: 'UIOlVOWY0r',
  createdBy: 'member-1',
  brief: '',
  plan: { language: 'en' },
  inputs: LAUREL_RIDGE_INPUTS,
} as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

/** The ten records production wrote, in order: title, category, location, description, film or digital. */
const GALLERY_RECORDS = [
  ['Mountain Elopements', 'Weddings and elopements', 'Blue Ridge Mountains', 'Intimate ceremonies for two with room to breathe, set against open mountain views.', 'Film and digital'],
  ['Overlook Ceremonies', 'Weddings and elopements', 'Blue Ridge Parkway', 'Ceremonies held high above the valley, photographed in natural light.', 'Film and digital'],
  ['Small Weddings', 'Weddings and elopements', 'Asheville area', 'Relaxed celebrations with close family and friends, from the vows to the last dance.', 'Film and digital'],
  ['Getting Ready', 'Weddings and elopements', 'Asheville area', 'Quiet moments before the ceremony: details, nerves and last-minute laughs.', 'Film'],
  ['Couple Portraits', 'Weddings and elopements', 'Blue Ridge', 'Portraits of the two of you on the trail, in the woods or at golden hour.', 'Film and digital'],
  ['Receptions and Dancing', 'Weddings and elopements', 'Asheville area', 'Toasts, dancing and candid moments from the evening.', 'Digital'],
  ['Family Sessions', 'Family portraits', 'Blue Ridge', 'Relaxed outdoor sessions that suit kids and grandparents alike.', 'Film and digital'],
  ['Parkway Portraits', 'Family portraits', 'Blue Ridge Parkway', 'Family portraits with layered mountain views behind you.', 'Film and digital'],
  ['Seasonal Mini Sessions', 'Family portraits', 'Asheville area', 'Shorter sessions that follow the colors of the Blue Ridge seasons.', 'Digital'],
  ['Milestone Portraits', 'Family portraits', 'Asheville area', 'Portraits to mark engagements, anniversaries and growing families.', 'Film'],
]
const GALLERY_FIELDS = ['Title', 'Category', 'Location', 'Description', 'Film or digital'].map((name) => ({ name, type: 'text' as const }))
const TITLES = GALLERY_RECORDS.map((record) => record[0] as string)
const CATEGORIES = GALLERY_RECORDS.map((record) => record[1] as string)

/** The covers production placed, by record, with what their alt text said. */
const PRODUCTION_COVERS: ReadonlyArray<[record: string, id: string, alt: string]> = [
  ['Mountain Elopements', '1015988', 'A photographer with a press'],
  ['Overlook Ceremonies', '1777352', 'A photographer with silhouettes'],
  ['Small Weddings', '10119092', 'A bride at a wedding'],
  ['Getting Ready', '8568693', 'A photographer in a library'],
  ['Couple Portraits', '1867098', 'A portrait of a couple'],
  ['Receptions and Dancing', '1347642', 'A photographer with a frog'],
  ['Family Sessions', '3828103', 'A photographer'],
  ['Parkway Portraits', '1045782', 'A domestic cat and an animal'],
  ['Seasonal Mini Sessions', '7286114', 'A photographer with a flower'],
  ['Milestone Portraits', '6589404', 'A portrait of a model'],
]

/** What a cover leads with: its people, never the maker, a camera, an animal or a toy. */
const MAKER_OR_ODD = /\b(?:photographers?|cameras?|lens|journalist|press|cat|dog|pet|animal|frog|duck|toy|lego|figure|figurine)\b/
const WEDDING_PEOPLE = /\b(?:couples?|bride|groom|lovers|newlyweds?|husband|wife)\b/
const FAMILY_PEOPLE = /\b(?:family|families|father|mother|parents?|mom|dad|son|daughter)\b/

describe('a photographer’s gallery covers show the photographed moment (AGL-3856, beta.265)', () => {
  const terms = aiStockSourceTerms({ business: LAUREL_RIDGE_INPUTS.businessType, audience: LAUREL_RIDGE_INPUTS.audience })

  it('reads each record’s moment from its name, then its category, set where the site is', () => {
    expect(terms.scenes).toBe(true)
    expect(terms.setting).toBe('mountains')
    expect(aiStockRecordScene('Mountain Elopements', 'Weddings and elopements', 'mountains')?.queries).toEqual(['couple mountains', 'couple'])
    // "Getting Ready" names nobody: what it is filed under does.
    expect(aiStockRecordScene('Getting Ready', 'Weddings and elopements', 'mountains')?.queries).toEqual([
      'wedding couple mountains',
      'wedding couple',
      'couple',
    ])
    expect(aiStockRecordScene('Milestone Portraits', 'Family portraits', 'mountains')?.queries).toEqual(['family mountains', 'family'])
    // A portrait no category files is a person's portrait, never a cat's.
    expect(aiStockRecordScene('Studio Portraits')?.queries).toEqual(['portrait'])
    expect(aiStockRecordScene('Blue Ridge Sunsets')).toBeNull()
  })

  it('never asks for the photographer, and asks for each moment first', async () => {
    const { stockPhotos: source, asked } = stockPhotos('UIOlVOWY0r')
    await aiSiteDatasetRecordPhotos({ job: laurelRidge, name: 'Gallery collections', names: TITLES, categories: CATEGORIES, pictures: 'things', stockPhotos: source })
    // Production asked "photographer mountain elopements", "photographer camera", …
    expect(asked[0]).toBe('couple mountains')
    expect(asked.filter((query) => /photograph|camera/.test(query))).toEqual([])
    expect(asked).toContain('family mountains')
  })

  it('places a couple for every wedding record and a family for every family one, never a photographer, an animal or a toy', async () => {
    const { stockPhotos: source } = stockPhotos('UIOlVOWY0r')
    const photos = await aiSiteDatasetRecordPhotos({ job: laurelRidge, name: 'Gallery collections', names: TITLES, categories: CATEGORIES, pictures: 'things', stockPhotos: source })
    const ids = photos.map((photo) => photo.placed?.split('/').pop() ?? null)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [index, id] of ids.entries()) {
      const lead = tagsOf(id).slice(0, 3).join(', ')
      expect(lead).not.toMatch(MAKER_OR_ODD)
      expect(lead).toMatch(CATEGORIES[index] === 'Family portraits' ? FAMILY_PEOPLE : WEDDING_PEOPLE)
      expect(photos[index]?.alt ?? '').not.toMatch(MAKER_OR_ODD)
    }
    // None of production's photographers, frog, cat or lego figure again.
    for (const [, id] of PRODUCTION_COVERS.filter(([, , alt]) => MAKER_OR_ODD.test(alt.toLowerCase())))
      expect(ids).not.toContain(id)
  })

  it('turns down each of production’s off-subject covers for its record', () => {
    // The judgement each record's first search holds its hits to.
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
        refuseLead: [...(terms.maker ?? []), 'cat', 'frog', 'lego', 'toy', 'animal'].filter((stem) => !scene.named.includes(stem)),
      })
    }
    for (const [record, id] of [
      ['Mountain Elopements', '1015988'],
      ['Overlook Ceremonies', '1777352'],
      ['Getting Ready', '8568693'],
      ['Receptions and Dancing', '1347642'],
      ['Family Sessions', '3828103'],
      ['Parkway Portraits', '1045782'],
      ['Seasonal Mini Sessions', '7286114'],
      ['Milestone Portraits', '6589404'],
    ] as const)
      expect([record, judged(record, id)]).toEqual([record, 0])
    // The two production got right still fit.
    expect(judged('Small Weddings', '10119092')).toBeGreaterThan(0)
    expect(judged('Couple Portraits', '1867098')).toBeGreaterThan(0)
  })
})

// ── Laurel Ridge's /galleries: one dataset, two sections ─────────────────

const screen = (id: string, title: string, slug: string, sections: Array<{ name: string; uses?: string[]; items: number }>) =>
  ({
    id,
    title,
    slug,
    layout: 'new:Site layout',
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: title,
    seoDescription: title,
    record: null,
    sections: sections.map((section) => ({ uses: [], ...section })),
  }) as unknown as AiJobPlan['screens'][number]

/** Laurel Ridge's confirmed plan, its two pages that list "Gallery collections". */
const LAUREL_RIDGE_SCREENS = [
  screen('ICKQ2UvEUQ', 'Home', '/', [
    { name: 'Hero', items: 0 },
    { name: 'Galleries by subject', uses: ['new:Gallery collections'], items: 6 },
    { name: 'A short personal about', items: 0 },
  ]),
  screen('9fux5rBlej', 'Galleries', '/galleries', [
    { name: 'Galleries intro', items: 0 },
    { name: 'Weddings and elopements gallery', uses: ['new:Gallery collections'], items: 6 },
    { name: 'Family portrait gallery', uses: ['new:Gallery collections'], items: 4 },
    { name: 'Call to action to book', items: 0 },
  ]),
]

const GALLERY_COLLECTIONS: AiBuildPlanCreate = {
  kind: 'dataset',
  name: 'Gallery collections',
  why: 'Galleries by subject need a list of 4+ pieces and no listed dataset fits this photographer’s work.',
  duplicateOf: null,
  fields: ['Title', 'Category', 'Location', 'Description', 'Film or digital', 'Image', 'Image description'],
  id: 'cpFBKD043i',
}

const NOW = new Date('2026-10-18T07:29:00.000Z')

/** The fields production's data plugin wrote, by id. */
const WRITTEN_FIELDS = [
  { id: 'title', name: 'Title', type: 'text' },
  { id: 'category', name: 'Category', type: 'text' },
  { id: 'location', name: 'Location', type: 'text' },
  { id: 'description', name: 'Description', type: 'text' },
  { id: 'film_or_digital', name: 'Film or digital', type: 'text' },
  { id: 'image', name: 'Image', type: 'text' },
  { id: 'image_description', name: 'Image description', type: 'text' },
]

async function writtenGalleryCollections() {
  const writer: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: () => ({ ok: true, facts: {} }),
    read: async () => null,
    write: async (request) => ({
      ok: true,
      replayed: false,
      id: request.id,
      name: request.name,
      versionId: null,
      facts: { fields: WRITTEN_FIELDS, records: 10, addressField: null, imageField: 'image' },
    }),
  }
  const generate = jest.fn(async () => ({
    attempts: 1,
    usage: { inputTokens: 900, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.01,
    model: 'routed-model',
    stopReason: 'tool_use',
    effort: null,
    status: 'ok' as const,
    value: { fields: GALLERY_FIELDS, records: GALLERY_RECORDS },
  })) as unknown as typeof generateAiDataset
  const photos = jest.fn(async ({ names }: { names: readonly string[] }) =>
    names.map((_name, index) => ({ src: `/api/media/cdn/UIOlVOWY0r/m${index}`, placed: `media:UIOlVOWY0r/m${index}`, alt: 'A couple' })),
  )
  const job = {
    $id: 'cpFBKD043i',
    orgId: 'jWmGooWE3L',
    hostId: 'UIOlVOWY0r',
    kind: 'text',
    status: 'running',
    brief: 'A 5-page website for A wedding and portrait photographer in Asheville, North Carolina shooting film and digital.',
    inputs: { ...LAUREL_RIDGE_INPUTS, [AI_SITE_DATASET_INPUT]: aiSiteDatasetInputOf(GALLERY_COLLECTIONS, LAUREL_RIDGE_SCREENS) },
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'member-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: { reuse: [], create: [GALLERY_COLLECTIONS], screens: [], status: 'confirmed', labels: {} } as unknown as AiJobPlan,
  } as unknown as AiJob
  const firestore = {
    collection: () => ({ doc: () => ({ get: async () => ({ get: (field: string) => (field === 'subdomain' ? 'laurel-ridge-film-portrait' : undefined) }) }) }),
  } as unknown as FirebaseFirestore.Firestore
  const context: AiJobStepContext = { job, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' } as never }
  const outcome = await createAiSiteDatasetRunner({ generate, writerFor: () => ({ pluginId: 'data', writer }), photos })(context)
  return { outcome, photos }
}

describe('sections that list one dataset by its categories each list their own records (AGL-3921, beta.265)', () => {
  it('reads what the records are filed under from the real dataset', () => {
    expect(aiSiteDatasetCategoryOf({ fields: GALLERY_FIELDS, records: GALLERY_RECORDS })).toMatchObject({ column: 1, name: 'Category' })
    // Northgate's courses are filed by type; Granite Peak's packages each have a type of their own, so none files them.
    const courses = { fields: ['Name', 'Type'].map((name) => ({ name })), records: [['A', 'Career skills'], ['B', 'Diploma'], ['C', 'Career skills'], ['D', 'Academic'], ['E', 'Academic'], ['F', 'Career skills']] }
    expect(aiSiteDatasetCategoryOf(courses)?.name).toBe('Type')
    const packages = { fields: ['Name', 'Type'].map((name) => ({ name })), records: [['Intro Session', 'Introductory'], ['One-on-One Coaching', 'Personal training'], ['Small Group Training', 'Group'], ['Barbell Technique Session', 'Skill focus'], ['Programme Planning Session', 'Planning']] }
    expect(aiSiteDatasetCategoryOf(packages)).toBeNull()
  })

  it('names the group a section is named for, and none where it names two or none', () => {
    const values = ['Weddings and elopements', 'Family portraits']
    expect(aiLayoutSectionGroup('Weddings and elopements gallery', values)).toBe('Weddings and elopements')
    expect(aiLayoutSectionGroup('Family portrait gallery', values)).toBe('Family portraits')
    expect(aiLayoutSectionGroup('Weddings', values)).toBe('Weddings and elopements')
    expect(aiLayoutSectionGroup('Galleries by subject', values)).toBeNull()
    expect(aiLayoutSectionGroup('Weddings and family portraits', values)).toBeNull()
  })

  it('keeps each record’s category with the dataset, and lists each Galleries section’s group alone', async () => {
    const { outcome, photos } = await writtenGalleryCollections()
    // The covers are searched by what each record is filed under too.
    expect(photos).toHaveBeenCalledWith(expect.objectContaining({ categories: CATEGORIES }))
    const listings = aiSiteDatasetListings({
      outputs: outcome.outputs,
      datasets: [GALLERY_COLLECTIONS],
      screens: LAUREL_RIDGE_SCREENS,
      delivered: new Map([['gallery collections', 'cpFBKD043i']]),
    })
    expect(listings[0]?.placements).toEqual([
      // The home features a few of all of them.
      { screenId: 'ICKQ2UvEUQ', section: 1, role: 'featured' },
      {
        screenId: '9fux5rBlej',
        section: 1,
        role: 'index',
        filter: { field: 'category', value: 'Weddings and elopements', records: TITLES.slice(0, 6) },
      },
      { screenId: '9fux5rBlej', section: 2, role: 'index', filter: { field: 'category', value: 'Family portraits', records: TITLES.slice(6) } },
    ])
  })

  it('never filters a dataset a page lists once: Northgate’s courses, Granite Peak’s services', () => {
    const groups = { field: 'type', values: ['Career skills', 'Diploma', 'Career skills', 'Academic', 'Academic', 'Career skills'] }
    const courses = [
      screen('73vPtzrPNy', 'Home', '/', [{ name: 'Hero with enroll button', items: 0 }, { name: 'Courses you can take', uses: ['new:Courses'], items: 4 }]),
      screen('r739sfTYM1', 'Courses', '/courses', [{ name: 'Courses introduction', items: 0 }, { name: 'All courses', uses: ['new:Courses'], items: 6 }]),
    ]
    const placements = aiLayoutRecordsPlacements({ id: 'Xf5U48gdo-', name: 'Courses', records: ['A', 'B', 'C', 'D', 'E', 'F'], groups }, courses)
    expect(placements.every((placement) => !placement.filter)).toBe(true)
  })

  it('draws each Galleries section’s repeat filtered to its group, and tells its design only that group’s records', async () => {
    const { outcome } = await writtenGalleryCollections()
    const listings = aiSiteDatasetListings({
      outputs: outcome.outputs,
      datasets: [GALLERY_COLLECTIONS],
      screens: LAUREL_RIDGE_SCREENS,
      delivered: new Map([['gallery collections', 'cpFBKD043i']]),
    }) as AiLayoutListing[]
    const galleries = LAUREL_RIDGE_SCREENS[1] as AiJobPlan['screens'][number]
    const targets: AiLayoutTargets = {
      pageId: '9fux5rBlej',
      pages: [{ id: 'ICKQ2UvEUQ', label: 'Home', slug: '/' }],
      homeIds: [],
      forms: [],
      formPageId: null,
      components: [],
      facts: 'Laurel Ridge Film & Portrait: wedding and portrait photography in Asheville.',
      listings,
    }
    const heading = (text: string) => ({ kind: 'heading', col: -1, text, to: '', icon: '', style: 'none', items: [] })
    const sectionIds = ['sec-0', 'sec-1', 'sec-2', 'sec-3']
    const result = aiLayoutPageCheck({
      screen: galleries as never,
      sectionIds,
      targets,
      context: { screenIds: ['ICKQ2UvEUQ'], formIds: [], componentIds: [], datasetIds: ['cpFBKD043i'], codeBuilt: true, scrollTargetIds: sectionIds },
      reusableComponents: false,
    })({
      sections: [
        { band: 'plain', align: 'start', cols: [], blocks: [heading('Galleries from the Blue Ridge')] },
        { band: 'plain', align: 'start', cols: [], blocks: [heading('Weddings and elopements')] },
        { band: 'soft', align: 'start', cols: [], blocks: [heading('Family portraits')] },
        { band: 'plain', align: 'start', cols: [], blocks: [heading('Like what you see?')] },
      ],
    })
    expect(result.violations).toEqual([])
    const repeats = Object.values((result.value?.nodes ?? {}) as Record<string, { componentId: string; props?: Record<string, unknown> }>).filter(
      (node) => node.props?.['repeatDataset'] === 'cpFBKD043i',
    )
    expect(repeats.map((node) => [node.componentId, node.props?.['repeatFilter']])).toEqual([
      [AI_LAYOUT_LISTING_ELEMENTS.records, 'category == Weddings and elopements'],
      [AI_LAYOUT_LISTING_ELEMENTS.records, 'category == Family portraits'],
    ])
    const prompt = aiLayoutPagePrompt({
      job: { brief: 'A wedding and portrait photographer', inputs: {}, $id: '9fux5rBlej' },
      plan: { reuse: [], create: [], screens: [galleries] } as never,
      screen: galleries as never,
      targets,
      reusableComponents: false,
    })
    expect(prompt).toContain('“Gallery collections” (“Family Sessions”, “Parkway Portraits”, “Seasonal Mini Sessions”, “Milestone Portraits”) here itself')
  })
})

// ── Northgate's teachers, Granite Peak's coaches ─────────────────────────

const NORTHGATE_INPUTS = {
  businessType: 'LMS',
  audience: 'Adults finishing a high school diploma or learning job skills for a new career',
  starter: 'business',
  siteKind: 'education',
  pages: 4,
  businessName: 'Northgate Adult Learning Center',
  originJobId: 'wais118U3Q',
}
const northgate = { $id: 'BnjXcQJ6O0', hostId: 'LrfrpHIvw1', createdBy: 'member-1', brief: '', plan: { language: 'en' }, inputs: NORTHGATE_INPUTS } as unknown as Pick<
  AiJob,
  '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'
>
const INSTRUCTORS = [
  'Diploma program instructor',
  'Reading and writing instructor',
  'Math instructor',
  'Career skills instructor',
  'Computer skills instructor',
  'Learner support advisor',
]
/** The six teachers production placed, from "teacher classroom", with their alt text. */
const NORTHGATE_TEACHERS: ReadonlyArray<[id: string, alt: string]> = [
  ['4709759', 'An artist with a teacher of drawing'],
  ['7487482', 'A senior teacher at a university'],
  ['7453645', 'A model'],
  ['4508518', 'A portrait of a teacher'],
  ['6947862', 'A teacher with books in a library'],
  ['7730057', 'A teacher with a calligraphy master at a tet market'],
]

const GRANITE_PEAK_INPUTS = {
  businessType: 'a local service business',
  audience: 'local gym owner',
  starter: 'business',
  siteKind: 'business',
  pages: 4,
  businessName: 'Granite Peak Barbell',
  originJobId: 'vr-AuxZcBC',
}
const granitePeak = { $id: '1nV38d2Wc2', hostId: '7OHPKkDqVc', createdBy: 'member-1', brief: '', plan: { language: 'en' }, inputs: GRANITE_PEAK_INPUTS } as unknown as Pick<
  AiJob,
  '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'
>

describe('a teacher’s cover shows someone teaching (AGL-3856, beta.265)', () => {
  const teacher = aiStockPeopleRole('Math instructor', 'Instructors')

  it('holds a teacher to a class, a lecture or students among the first tags, and never a model or a painting', () => {
    expect(teacher?.scene).toEqual(expect.arrayContaining(['teaching', 'classroom', 'lecture', 'tutor', 'student']))
    expect(teacher?.refuse).toEqual(expect.arrayContaining(['model', 'fashion', 'artist', 'easel', 'painting']))
    expect(AI_STOCK_ROLE_TAGS_READ).toBe(6)
    // A drawing instructor may be drawing.
    expect(aiStockRoleRefusals(teacher ?? {}, 'Drawing instructor')).not.toContain('drawing')
    // A coach's photos are held to nothing more than before: Granite Peak's came out right.
    expect(aiStockPeopleRole('Strength coach', 'Coaches')?.scene).toBeUndefined()
  })

  it('places none of the artist, the model, the portraits or the calligrapher, and fills the six with people at work', async () => {
    const { stockPhotos: source, asked } = stockPhotos('LrfrpHIvw1')
    const photos = await aiSiteDatasetRecordPhotos({ job: northgate, name: 'Instructors', names: INSTRUCTORS, pictures: 'people', stockPhotos: source })
    expect(asked[0]).toBe('teacher classroom')
    const ids = photos.map((photo) => photo.placed?.split('/').pop() ?? null)
    for (const [id] of NORTHGATE_TEACHERS) expect(ids).not.toContain(id)
    // No recorded answer shows a teacher teaching an adult: the people starters fill them, as before.
    for (const photo of photos.filter((found) => !found.placed)) expect(photo.src).toMatch(/\/(?:hero-team|about-owner)\.jpg$/)
    for (const id of ids.filter((found): found is string => Boolean(found))) {
      const first = tagsOf(id).slice(0, AI_STOCK_ROLE_TAGS_READ).join(', ')
      expect(first).toMatch(/\b(?:teaching|classroom|class|lecture|lesson|tutor|students?|board|presentation)\b/)
    }
  })
})

describe('a team’s coaches still show coaches (AGL-3856, beta.265)', () => {
  it('places Granite Peak’s trainers, as production did', async () => {
    const { stockPhotos: source } = stockPhotos('7OHPKkDqVc')
    const coaches = ['Head coach', 'Strength coach', 'Personal trainer', 'Beginner coach']
    const photos = await aiSiteDatasetRecordPhotos({ job: granitePeak, name: 'Coaches', names: coaches, pictures: 'people', stockPhotos: source })
    const ids = photos.map((photo) => photo.placed?.split('/').pop() ?? null)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) expect(tagsOf(id).slice(0, 3).join(', ')).toMatch(/\b(?:trainer|coach)\b/)
    expect(photos.map((photo) => photo.alt)).toEqual(['A trainer', 'A trainer', 'A trainer', 'A trainer'])
  })

  it('reads one contributor’s photos a few uploads apart as one shoot', () => {
    expect(aiStockSameShoot(byId('728223'), byId('728229'))).toBe(true)
    expect(aiStockSameShoot(byId('728223'), byId('1602110'))).toBe(false)
  })
})

// ── Alt text read from each photo's own tags ─────────────────────────────

describe('a placed photo described by a short true phrase (AGL-3856, beta.265)', () => {
  // Every alt text the beta.265 verifier flagged, by Pixabay id, with the words
  // production gave it and the words its own tags say now.
  const SAID: ReadonlyArray<[id: string, before: string, after: string]> = [
    ['702090', 'Students with a multicultural at a language school', 'Students at a language school'],
    ['702088', 'Students with a multicultural at a language school', 'Students at a language school'],
    ['1853907', 'A student with a bed in a room', 'A man with a book on a bed'],
    ['7453645', 'A model', 'A woman'],
    ['3255020', 'People', 'People in a class'],
    ['7730057', 'A teacher with a calligraphy master at a tet market', 'A calligraphy master at a market'],
    ['1015988', 'A photographer with a press', 'A journalist'],
    ['5114199', 'A photographer with a petri', 'A camera'],
    ['5359570', 'A photographer with a cutout', 'A photographer'],
    ['1045782', 'A domestic cat and an animal', 'A cat'],
    ['5243197', 'A girl with a hand', 'A girl'],
    ['2427475', 'A body in a gym', 'A gym'],
    ['1777352', 'A photographer with silhouettes', 'Men with a camera at sunset'],
  ]

  it.each(SAID)('describes %s, once "%s", as "%s"', (id, before, after) => {
    const photo = byId(id)
    expect(photo).toBeDefined()
    const alt = aiStockTagsAlt(photo.tags ?? [])
    expect(alt).toBe(after)
    expect(alt).not.toBe(before)
  })

  it('never says an adjective as a thing, a body part as held, a camera maker, or a kind after its thing', () => {
    for (const [id] of SAID) {
      const alt = aiStockTagsAlt(byId(id).tags ?? []) ?? ''
      expect(alt).not.toMatch(/\b(?:multicultural|domestic|petri|press|cutout|silhouettes?|tet)\b/i)
      expect(alt).not.toMatch(/\bwith (?:an? )?(?:hand|hands|body|bed|cutout|petri|press)\b/i)
      expect(alt).not.toMatch(/\band an? animal\b/i)
    }
  })

  it('still says the roles and portraits it said before', () => {
    for (const [id, said] of NORTHGATE_TEACHERS.filter(([id]) => ['7487482', '4508518'].includes(id)))
      expect(aiStockTagsAlt(byId(id).tags ?? [])).toBe(said)
  })
})
