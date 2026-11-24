/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment.
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
 * "Add redirects for published pages" (AGL-4245): who may press it, which
 * imports it runs on, and that it writes the pass's outcomes onto the import.
 * The gate, the job read and the pass are fakes; nothing reaches Firestore.
 */

const updates: Array<Record<string, unknown>> = []
let job: Record<string, unknown> | null = null
let permitted = true

jest.mock('./ai-jobs-gate', () => ({
  aiJobsGate: jest.fn(async () => ({
    uid: 'uid-presser',
    decoded: {},
    staff: false,
    orgId: 'org-1',
    org: { plan: 'starter' },
    member: { uid: 'uid-presser' },
    firestore: {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              update: async (data: Record<string, unknown>) => {
                updates.push(data)
              },
            }),
          }),
        }),
      }),
    },
  })),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  memberHasPermissionOnHost: jest.fn(async () => permitted),
  permissionRefusal: (key: string) => Response.json({ error: `needs ${key}` }, { status: 403 }),
}))

jest.mock('../jobs/ai-jobs', () => ({
  AI_JOBS_COLLECTION: 'aiJobs',
  getAiJob: jest.fn(async () => job),
  aiJobSummary: (value: Record<string, unknown>) => ({ id: value['$id'], status: value['status'], siteImport: value['siteImport'] }),
}))

jest.mock('../jobs/ai-site-import-redirects', () => ({
  aiSiteImportWriteRedirects: jest.fn(),
}))

import { createAiJobsRedirectsRoute } from './ai-jobs-redirects'

const LEFT_OUT = [
  { from: '/old', to: '/new', outcome: 'left-out', reason: 'unpublished', slot: 'p1' },
  { from: '/x', to: '/y', outcome: 'created', slot: 'p2', ruleId: 'job-1-abc' },
]

function importJob(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { $id: 'job-1', kind: 'import', status: 'succeeded', hostId: 'host-1', createdBy: 'uid-owner', items: [], siteImport: { pages: [], redirects: LEFT_OUT }, ...patch }
}

const post = (route: ReturnType<typeof createAiJobsRedirectsRoute>, body: Record<string, unknown> = { orgId: 'org-1', hostId: 'host-1' }) =>
  route(new Request('https://app.example.com/api/ai/jobs/job-1/redirects', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ jobId: 'job-1' }),
  })

beforeEach(() => {
  updates.length = 0
  permitted = true
  job = importJob()
})

describe('adding the redirects an import is missing', () => {
  it('runs the same pass as the member who asks and keeps its outcomes on the import', async () => {
    const after = [{ from: '/old', to: '/new', outcome: 'created', slot: 'p1', ruleId: 'job-1-def' }, LEFT_OUT[1]]
    const writeRedirects = jest.fn(async () => after as never)
    const response = await post(createAiJobsRedirectsRoute({ writeRedirects }))
    expect(response.status).toBe(200)
    const [, input] = writeRedirects.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(input).toMatchObject({ actorUid: 'uid-presser', org: { plan: 'starter' }, items: [] })
    expect(updates).toEqual([{ 'siteImport.redirects': after }])
    expect(await response.json()).toMatchObject({ changed: true, job: { siteImport: { redirects: after } } })
  })

  it('does nothing when no address is left out for a reason that can clear', async () => {
    job = importJob({ siteImport: { pages: [], redirects: [{ from: '/a', to: '/b', outcome: 'left-out', reason: 'page-there', slot: 'p1' }] } })
    const writeRedirects = jest.fn()
    const response = await post(createAiJobsRedirectsRoute({ writeRedirects: writeRedirects as never }))
    expect(await response.json()).toMatchObject({ changed: false })
    expect(writeRedirects).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('waits while a wave is being brought in', async () => {
    job = importJob({ status: 'running' })
    const response = await post(createAiJobsRedirectsRoute({ writeRedirects: jest.fn() as never }))
    expect(response.status).toBe(409)
    expect(updates).toEqual([])
  })

  it('refuses a member who may not run the import, another site, and a job that is not an import', async () => {
    const route = createAiJobsRedirectsRoute({ writeRedirects: jest.fn() as never })
    permitted = false
    expect((await post(route)).status).toBe(403)
    permitted = true
    expect((await post(route, { orgId: 'org-1', hostId: 'host-2' })).status).toBe(400)
    job = importJob({ kind: 'build' })
    expect((await post(route)).status).toBe(404)
    job = null
    expect((await post(route)).status).toBe(404)
    expect(updates).toEqual([])
  })
})
