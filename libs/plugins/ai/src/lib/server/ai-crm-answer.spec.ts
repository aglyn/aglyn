/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

/**
 * The CRM answer door (AGL-2917): who is served a kept answer, and that the
 * CRM is asked again, as the member reading, before anything is.
 */

const mockGate = jest.fn()
const mockAccess = jest.fn()

jest.mock('./ai-jobs-gate', () => ({ __esModule: true, aiJobsGate: (...args: unknown[]) => mockGate(...args) }))
jest.mock('../jobs/ai-crm-access', () => ({
  __esModule: true,
  aiCrmAccessRefusal: (...args: unknown[]) => mockAccess(...args),
}))

import { GET } from './ai-crm-answer'

const ORG = 'org-1'
let answers: Record<string, Record<string, unknown>> = {}
const paths: string[] = []

const firestore = {
  collection: (root: string) => ({
    doc: (orgId: string) => ({
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            paths.push(`${root}/${orgId}/${name}/${id}`)
            const data = answers[id]
            return { exists: Boolean(data), data: () => data }
          },
        }),
      }),
    }),
  }),
}

const RECORD = {
  jobId: 'job-1',
  orgId: ORG,
  hostId: 'host-1',
  createdBy: 'asker',
  task: 'record',
  resource: 'crm.contact',
  recordId: 'c-1',
  key: 'k',
  proposal: {
    kind: 'record',
    record: { kind: 'contact', id: 'c-1' },
    summary: 'Dana opened the quote.',
    nextStep: null,
    stage: null,
    standing: null,
    asOf: '2026-09-16',
  },
  createdAt: new Date('2026-09-16T15:00:00.000Z'),
  expiresAt: new Date('2026-10-16T15:00:00.000Z'),
}
const EMAIL = {
  ...RECORD,
  jobId: 'job-2',
  task: 'email',
  key: null,
  proposal: { kind: 'email', record: { kind: 'lead', id: 'l-1' }, subject: 'Hello', body: 'Hi {{lead.firstName}},' },
}
const MAPPING = {
  ...RECORD,
  jobId: 'job-3',
  hostId: null,
  task: 'mapping',
  resource: 'crm.import',
  recordId: 'deals',
  key: null,
  proposal: { kind: 'mapping', collection: 'deals', matches: [], columns: 2 },
}

const caller = (uid: string, staff = false) =>
  mockGate.mockResolvedValue({ uid, staff, orgId: ORG, org: { plan: 'pro' }, firestore, decoded: {} })

const get = async (jobId: string) => {
  const response = await GET(new Request(`https://console.test/api/ai/crm/${jobId}?orgId=${ORG}`), {
    params: Promise.resolve({ jobId }),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers }
}

beforeEach(() => {
  mockGate.mockReset()
  mockAccess.mockReset()
  mockAccess.mockResolvedValue(null)
  answers = { 'job-1': RECORD, 'job-2': EMAIL, 'job-3': MAPPING }
  paths.length = 0
})

describe('a CRM answer is served', () => {
  it('as the job, the site, the asker and the answer, never the key or the clock, and never cached', async () => {
    caller('someone')
    const { status, body, headers } = await get('job-1')
    expect(status).toBe(200)
    expect(body).toEqual({
      answer: { jobId: 'job-1', hostId: 'host-1', createdBy: 'asker', proposal: RECORD.proposal },
    })
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(paths).toEqual([`orgs/${ORG}/aiCrmAnswers/job-1`])
  })

  it('for a record’s summary, to any member the CRM lets read the record, asked as that member', async () => {
    caller('someone')
    expect((await get('job-1')).status).toBe(200)
    expect(mockAccess).toHaveBeenCalledWith({
      firestore,
      orgId: ORG,
      hostId: 'host-1',
      resource: 'crm.contact',
      id: 'c-1',
      org: { plan: 'pro' },
      uid: 'someone',
      staff: false,
    })
    mockAccess.mockResolvedValueOnce({ status: 403, error: 'Reading CRM records requires the data.manage permission on this site' })
    expect(await get('job-1')).toMatchObject({ status: 404, body: { error: 'Not found' } })
  })

  it('for an email draft or an import’s matches, only to the member who asked, or staff', async () => {
    caller('someone')
    expect((await get('job-2')).status).toBe(404)
    expect((await get('job-3')).status).toBe(404)
    expect(mockAccess).not.toHaveBeenCalled()

    caller('asker')
    expect((await get('job-2')).status).toBe(200)
    expect(mockAccess).toHaveBeenLastCalledWith(expect.objectContaining({ resource: 'crm.lead', id: 'l-1', uid: 'asker' }))
    expect((await get('job-3')).status).toBe(200)
    expect(mockAccess).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: null, resource: 'crm.import', id: 'deals' }))

    caller('staff-1', true)
    expect((await get('job-2')).status).toBe(200)
    expect(mockAccess).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'staff-1', staff: true }))
  })

  it('to the asker too only while the CRM still lets them read the record', async () => {
    caller('asker')
    mockAccess.mockResolvedValue({ status: 403, error: 'Turn on the CRM for this site before using AI with it.' })
    expect((await get('job-2')).status).toBe(404)
  })

  it('never for an id that names nothing, an answer that is gone, or one that is not whole', async () => {
    caller('asker')
    expect((await get('job 1')).status).toBe(404)
    expect((await get('job-9')).status).toBe(404)
    answers['job-4'] = { ...RECORD, proposal: { kind: 'record', record: { kind: 'contact', id: 'c-1' } } }
    expect((await get('job-4')).status).toBe(404)
    answers['job-5'] = { ...RECORD, createdBy: undefined }
    expect((await get('job-5')).status).toBe(404)
    expect(mockAccess).not.toHaveBeenCalled()
  })

  it('never past the jobs read gate', async () => {
    mockGate.mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 }))
    expect((await get('job-1')).status).toBe(404)
    expect(mockGate).toHaveBeenCalledWith(expect.any(Request), ORG)
    expect(paths).toEqual([])
  })
})
