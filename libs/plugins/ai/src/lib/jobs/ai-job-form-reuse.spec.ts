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

// The machine needs the Admin SDK; this module only reads its list.
jest.mock('./ai-jobs', () => ({ __esModule: true, listAiJobs: jest.fn() }))

import type { AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import {
  AI_FORM_REUSE_JOBS_READ,
  AI_FORM_REUSE_WINDOW_MS,
  aiSiblingJobForm,
  aiSiblingJobFormIds,
  type AiFormReuseJob,
} from './ai-job-form-reuse'

/**
 * The race AGL-3765 was found on, as production recorded it (org
 * `rbgIvex5O8`, host `iz1LhOuQxy`, 2026-10-13, read-only): three page jobs
 * from one brief within four minutes on a Free site. `Vgqphowx8u` made the
 * site's one form `0Qdgr68Ccq` at 08:05:06Z; `Ky96NOCL2V`, planned while the
 * site had no form, reached its own form unit (`q9QBhySHlz`) at 08:05:16Z.
 */
const ORG = 'rbgIvex5O8'
const HOST = 'iz1LhOuQxy'
const FIRST = 'Vgqphowx8u'
const SECOND = 'Ky96NOCL2V'
const SECOND_FORM_UNIT = 'q9QBhySHlz'
const MADE_FORM = '0Qdgr68Ccq'
const FORM_MADE_AT = new Date('2026-10-13T08:05:06.584Z')
const REFUSED_AT = new Date('2026-10-13T08:05:16.042Z')
const BRIEF = 'A mobile car wash site with packages, prices, photos and a booking page.'

function plan(formId: string, name: string): AiJobPlan {
  return {
    reuse: [],
    create: [{ kind: 'form', name, why: 'The site has no saved form.', duplicateOf: null, fields: [], id: formId }],
    screens: [],
    status: 'confirmed',
    labels: {},
    proposedAt: REFUSED_AT as never,
    confirmedAt: REFUSED_AT as never,
    confirmedBy: 'uid-1',
  }
}

const formOutput = (id: string): AiJobOutput => ({ resource: 'form', id, versionId: null, hostId: HOST, label: 'Booking request' })

/** The site's newest jobs as the list returns them, newest first. */
function siteJobs(patch: { first?: Partial<AiFormReuseJob>; second?: Partial<AiFormReuseJob> } = {}): AiFormReuseJob[] {
  return [
    { $id: SECOND, hostId: HOST, brief: `${BRIEF} Normal wash $10.`, outputs: [], plan: plan(SECOND_FORM_UNIT, 'booking-request-form'), ...patch.second },
    { $id: FIRST, hostId: HOST, brief: `${BRIEF} Wash: $10.`, outputs: [formOutput(MADE_FORM)], plan: plan(MADE_FORM, 'booking form'), ...patch.first },
  ]
}

/** The second job's form unit, as the page step derives it. */
const unit = (inputs: Record<string, unknown> = { pageType: 'contact', originJobId: SECOND }) => ({
  $id: SECOND_FORM_UNIT,
  orgId: ORG,
  hostId: HOST,
  inputs,
})

const docs = new Map<string, Record<string, unknown>>()

function snapshot(path: string) {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, get: (field: string) => data?.[field] }
}

function collection(path: string): Record<string, unknown> {
  return { doc: (id: string) => doc(`${path}/${id}`) }
}

function doc(path: string): Record<string, unknown> {
  return { collection: (name: string) => collection(`${path}/${name}`), get: async () => snapshot(path) }
}

const firestore = { collection: (name: string) => collection(name) } as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  docs.clear()
  docs.set(`hosts/${HOST}`, { subdomain: 'north-shore' })
  docs.set(`hosts/${HOST}/forms/${MADE_FORM}`, { displayName: 'Booking request', createdAt: { toMillis: () => FORM_MADE_AT.getTime() } })
})

describe('the forms other jobs on the site made (AGL-3765)', () => {
  it('reads them off each other job’s outputs and its plan’s minted ids, never off the job the member started', () => {
    expect(aiSiblingJobFormIds(siteJobs(), { hostId: HOST, originJobId: SECOND })).toEqual(
      new Map([[MADE_FORM, { sameBrief: false }]]),
    )
    // A form id minted on the plan, before the write, names the job's form too.
    const planned = siteJobs({ first: { outputs: [] } })
    expect([...aiSiblingJobFormIds(planned, { hostId: HOST, originJobId: SECOND }).keys()]).toEqual([MADE_FORM])
    // Another site's job is not this site's.
    const elsewhere = siteJobs({ first: { hostId: 'other-host' } })
    expect(aiSiblingJobFormIds(elsewhere, { hostId: HOST, originJobId: SECOND }).size).toBe(0)
  })

  it('marks a job of the same brief, spacing and case aside', () => {
    const same = siteJobs({ first: { brief: `  ${BRIEF.toUpperCase()}   Normal   wash $10. ` } })
    expect(aiSiblingJobFormIds(same, { hostId: HOST, originJobId: SECOND }).get(MADE_FORM)).toEqual({ sameBrief: true })
  })
})

describe('the form a refused unit places instead (AGL-3765)', () => {
  const listed = (jobs: AiFormReuseJob[] = siteJobs()) => jest.fn(async () => jobs)

  it('places the form the other build made ten seconds before, as the unit’s draft record', async () => {
    const listJobs = listed()
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: REFUSED_AT }, { listJobs })).toEqual({
      id: MADE_FORM,
      versionId: null,
      name: 'Booking request',
      hostSubdomain: 'north-shore',
    })
    expect(listJobs).toHaveBeenCalledWith(firestore, ORG, { hostId: HOST, limit: AI_FORM_REUSE_JOBS_READ })
  })

  it('borrows nothing for a job the member asked for a form by itself', async () => {
    const listJobs = listed()
    expect(await aiSiblingJobForm(firestore, { job: unit({}), now: REFUSED_AT }, { listJobs })).toBeNull()
    expect(await aiSiblingJobForm(firestore, { job: { ...unit(), inputs: { originJobId: SECOND_FORM_UNIT } }, now: REFUSED_AT }, { listJobs })).toBeNull()
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('never places the started job’s own form, nor one the site no longer holds or has retired', async () => {
    // The form the second job's own plan minted is its own.
    const own = siteJobs({ first: { outputs: [], plan: plan(SECOND_FORM_UNIT, 'booking form') } })
    docs.set(`hosts/${HOST}/forms/${SECOND_FORM_UNIT}`, { displayName: 'Mine', createdAt: FORM_MADE_AT })
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: REFUSED_AT }, { listJobs: listed(own) })).toBeNull()
    docs.set(`hosts/${HOST}/forms/${MADE_FORM}`, { displayName: 'Booking request', createdAt: FORM_MADE_AT, archivedAt: 1 })
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: REFUSED_AT }, { listJobs: listed() })).toBeNull()
    docs.delete(`hosts/${HOST}/forms/${MADE_FORM}`)
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: REFUSED_AT }, { listJobs: listed() })).toBeNull()
  })

  it('places a form made in the last fifteen minutes, or older by a job of the same brief', async () => {
    const later = new Date(FORM_MADE_AT.getTime() + AI_FORM_REUSE_WINDOW_MS + 1)
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: later }, { listJobs: listed() })).toBeNull()
    const same = siteJobs({ first: { brief: `${BRIEF} Normal wash $10.` } })
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: later }, { listJobs: listed(same) })).toMatchObject({
      id: MADE_FORM,
    })
    // A form it cannot date is recent only by the brief.
    docs.set(`hosts/${HOST}/forms/${MADE_FORM}`, { displayName: 'Booking request' })
    expect(await aiSiblingJobForm(firestore, { job: unit(), now: REFUSED_AT }, { listJobs: listed() })).toBeNull()
  })

  it('places the newest when other jobs made several', async () => {
    const third = { $id: 'nCZlAtBqcL', hostId: HOST, brief: BRIEF, outputs: [formOutput('frmNewer')], plan: null }
    docs.set(`hosts/${HOST}/forms/frmNewer`, { displayName: 'Newer', createdAt: new Date(REFUSED_AT.getTime() - 1_000) })
    expect(
      await aiSiblingJobForm(firestore, { job: unit(), now: REFUSED_AT }, { listJobs: listed([third, ...siteJobs()]) }),
    ).toMatchObject({ id: 'frmNewer', name: 'Newer' })
  })
})
