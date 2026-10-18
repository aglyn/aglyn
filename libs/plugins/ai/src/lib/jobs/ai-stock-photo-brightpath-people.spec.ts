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
import { aiSiteDatasetRecordPhotos } from './ai-job-site-datasets'
import {
  aiLayoutStockPhotoSource,
  aiStockAdultsOnly,
  aiStockForgetJobPhotos,
  aiStockPeopleRole,
  aiStockPhotoWordsOf,
  aiStockSourceTerms,
} from './ai-layout-stock-photos'
import {
  BRIGHTPATH_PLACED,
  CLASSROOM_ENGLISH,
  CLASSROOM_JOB_SKILLS_INSTRUCTOR,
  CLASSROOM_MATH_INSTRUCTOR,
  CLASSROOM_ONLINE_LEARNING_COACH,
  CLASSROOM_SCHOOL_DIPLOMA_INSTRUCTOR,
} from './fixtures/ai-stock-photo-agl3856-people-recordings'

/*
 * The beta.264 Brightpath Adult Learning Center start (AGL-3856, host
 * KUjpA6SQAX, job Ysli21sB6K): a site picked as "education", its business
 * type "LMS", for "Adults finishing a high school diploma or learning job
 * skills, online and in evening classes". Its "Instructors" dataset's covers,
 * on "Meet your teachers", were a teen graduate (Pixabay 6553467), a girl at a
 * window (10377109), a student in an ao dai (6275725) and a schoolgirl
 * (351977): each search named "school", which let children in, and Pixabay
 * tags a schoolgirl "girl", never "child". Replayed from what Pixabay
 * answered (fixtures/ai-stock-photo-agl3856-people-recordings.ts); a search
 * production never sent answers nothing. No network, no model.
 */

const INPUTS = {
  businessType: 'LMS',
  audience: 'Adults finishing a high school diploma or learning job skills, online and in evening classes',
  starter: 'business',
  siteKind: 'education',
  pages: 4,
  businessName: 'Brightpath Adult Learning Center',
}

const job = {
  $id: 'Ysli21sB6K',
  hostId: 'KUjpA6SQAX',
  createdBy: 'member-1',
  brief: '',
  plan: { language: 'en' },
  inputs: INPUTS,
} as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

const INSTRUCTORS = [
  'High school diploma instructor',
  'Math instructor',
  'English and writing instructor',
  'Job skills instructor',
  'Online learning coach',
]

/** Each search's recorded answer, by its query, orientation, size and category, as the cache keyed it. */
const RECORDED: Record<string, StockPhoto[]> = {
  'classroom school diploma instructor|vertical|0|900|people': CLASSROOM_SCHOOL_DIPLOMA_INSTRUCTOR,
  'classroom math instructor|vertical|0|900|people': CLASSROOM_MATH_INSTRUCTOR,
  'classroom english|vertical|0|900|people': CLASSROOM_ENGLISH,
  'classroom job skills instructor|vertical|0|900|people': CLASSROOM_JOB_SKILLS_INSTRUCTOR,
  'classroom online learning coach|vertical|0|900|people': CLASSROOM_ONLINE_LEARNING_COACH,
}

const ALL = [...Object.values(RECORDED).flat(), ...BRIGHTPATH_PLACED]
const byId = (id: string) => ALL.find((photo) => photo.id === id) as StockPhoto

/** The covers production placed. */
const TEEN_GRADUATE = '6553467'
const GIRL_AT_A_WINDOW = '10377109'
const STUDENT_IN_AN_AO_DAI = '6275725'
const SCHOOLGIRL = '351977'
/** A teacher's portrait, in four instructors' answers. */
const TEACHER_PORTRAIT = '4508518'
/** A teacher at a lecture, in every answer, but tagged "monk": a faith the site never named. */
const TEACHER_TAGGED_MONK = '10162440'
/** A woman coaching at a laptop, in the online coach's answer. */
const COACHING_AT_A_LAPTOP = '10249221'

function stockPhotos() {
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
      const src = `media:KUjpA6SQAX/${String(request.stockPhoto?.id)}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: String(request.stockPhoto?.id), src, width: 853, height: 1280 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 853, height: 1280 } : null
    },
  }
  return {
    asked,
    stockPhotos: ((input) => aiLayoutStockPhotoSource(input, { provider: () => provider, ingest: () => ingest })) as typeof aiLayoutStockPhotoSource,
  }
}

const CHILD = /\b(?:child|children|kids?|boys?|girls?|schoolgirl|teen|teenager|teenage|kindergarten)\b/

beforeEach(() => aiStockForgetJobPhotos())

describe('a site for adults alone never shows a child (AGL-3856, beta.264)', () => {
  it('reads Brightpath as a site for adults from its audience and its name', () => {
    expect(aiStockAdultsOnly([INPUTS.audience])).toBe(true)
    expect(aiStockAdultsOnly([INPUTS.businessName])).toBe(true)
    expect(aiStockSourceTerms({ business: INPUTS.businessType, ...aiStockPhotoWordsOf(job) }).adults).toBe(true)
  })

  it('never reads a site for families, kids or teens as one for adults alone', () => {
    expect(aiStockAdultsOnly(['Adults and kids learning to swim'])).toBe(false)
    expect(aiStockAdultsOnly(['Families with young children'])).toBe(false)
    expect(aiStockAdultsOnly(['Teens and adults'])).toBe(false)
    expect(aiStockAdultsOnly(['A tutoring center for high school students'])).toBe(false)
    expect(aiStockAdultsOnly([])).toBe(false)
  })

  it('turns down every photo tagged as a child, a girl or a teen, however its search named "school"', async () => {
    const slot = { imageId: 'img', frameId: null, iconId: null, alt: 'English', aspect: 4 / 5, sectionIndex: 0, role: 'about' as const }
    const placed = async (inputs: Record<string, unknown>) => {
      aiStockForgetJobPhotos()
      const { stockPhotos: source } = stockPhotos()
      const run = source({
        hostId: 'KUjpA6SQAX',
        uid: 'member-1',
        seed: 'Ysli21sB6K:page',
        business: 'LMS',
        ...aiStockPhotoWordsOf({ ...job, inputs }),
        sectionNames: ['Our classes'],
      })
      const [photo] = (await run?.([slot])) ?? []
      return byId(photo?.src.split('/').pop() ?? '')
    }
    const forAdults = await placed(INPUTS)
    expect(forAdults).toBeDefined()
    expect((forAdults.tags ?? []).join(', ')).not.toMatch(CHILD)
    // The same search for a learning center that never says who it is for lets a child in.
    const forAnyone = await placed({ ...INPUTS, audience: '', businessName: 'Brightpath Learning Center' })
    expect((forAnyone.tags ?? []).join(', ')).toMatch(CHILD)
  })
})

describe('a team’s covers show adults in their role (AGL-3856, beta.264)', () => {
  it('reads each record’s role from its words, and the list’s where its words name none', () => {
    expect(aiStockPeopleRole('Math instructor', 'Instructors')?.query).toBe('teacher')
    expect(aiStockPeopleRole('Online learning coach', 'Instructors')?.query).toBe('coach')
    expect(aiStockPeopleRole('Maria Lopez', 'Teachers')?.query).toBe('teacher')
    expect(aiStockPeopleRole('Studio manager')).toMatchObject({ required: false, query: '' })
    expect(aiStockPeopleRole('Studio manager')?.kin).toContain('staff')
    expect(aiStockPeopleRole('Mountain Wedding Day')).toBeNull()
  })

  it('asks for a teacher in the classroom first, then what production asked', async () => {
    const { stockPhotos: source, asked } = stockPhotos()
    await aiSiteDatasetRecordPhotos({ job, name: 'Instructors', names: INSTRUCTORS, pictures: 'people', stockPhotos: source })
    expect(asked[0]).toBe('teacher classroom')
    expect(asked).toContain('classroom school diploma instructor')
  })

  it('never places the teen graduate, the girl at the window, the ao dai student or the schoolgirl', async () => {
    const { stockPhotos: source } = stockPhotos()
    const photos = await aiSiteDatasetRecordPhotos({ job, name: 'Instructors', names: INSTRUCTORS, pictures: 'people', stockPhotos: source })
    const ids = photos.map((photo) => photo.placed?.split('/').pop() ?? null)
    for (const id of [TEEN_GRADUATE, GIRL_AT_A_WINDOW, STUDENT_IN_AN_AO_DAI, SCHOOLGIRL]) expect(ids).not.toContain(id)
    for (const id of ids.filter((found): found is string => Boolean(found))) {
      const tags = (byId(id).tags ?? []).join(', ')
      expect(tags).not.toMatch(CHILD)
      expect(tags).toMatch(/\b(?:teacher|instructor|coach|coaching|trainer|woman|man)\b/)
    }
    // The teacher's portrait goes to the first instructor, the coach at a laptop to the online coach.
    expect(ids[0]).toBe(TEACHER_PORTRAIT)
    expect(ids[4]).toBe(COACHING_AT_A_LAPTOP)
    expect(ids).not.toContain(TEACHER_TAGGED_MONK)
    // A record no recorded photo shows in its role takes a starter of people at
    // work, never a child, and never the workbench or the houseplants.
    for (const photo of photos.filter((found) => !found.placed)) expect(photo.src).toMatch(/\/(?:hero-team|about-owner)\.jpg$/)
  })

  it('describes each cover by what it shows', async () => {
    const { stockPhotos: source } = stockPhotos()
    const photos = await aiSiteDatasetRecordPhotos({ job, name: 'Instructors', names: INSTRUCTORS, pictures: 'people', stockPhotos: source })
    const alts = new Map(photos.map((photo) => [photo.placed?.split('/').pop(), photo.alt]))
    expect(alts.get(TEACHER_PORTRAIT)).toBe('A portrait of a teacher')
    expect(alts.get(COACHING_AT_A_LAPTOP)).toBe('An entrepreneur')
  })
})
