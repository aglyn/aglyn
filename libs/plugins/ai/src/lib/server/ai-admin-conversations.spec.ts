/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * `/api/ai/admin/conversations` (AGL-3675) hands staff the words a customer
 * typed to Aglyn AI, so the spec pins the staff gate, that every page served
 * writes an access audit row holding no text, and the composition: an
 * Assist exchange joined with its signal, and a job with the result kept
 * beside it.
 */

const mockVerifyIdToken = jest.fn()
const mockAddAdminAudit = jest.fn(async (...args: unknown[]) => ({ id: 'audit-1', args }))

let mockDocsByPath: Record<string, Record<string, unknown> | undefined> = {}
let mockQueryDocs: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {}

const mockSnapshotOf = (id: string, data: Record<string, unknown> | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
})

function mockMakeCollection(path: string): any {
  let start = 0
  let max = Infinity
  const query = {
    orderBy: () => query,
    limit: (n: number) => ((max = n), query),
    startAfter: (cursor: { id: string }) => {
      start = (mockQueryDocs[path] ?? []).findIndex((doc) => doc.id === cursor.id) + 1
      return query
    },
    get: async () => ({
      docs: (mockQueryDocs[path] ?? []).slice(start, start + max).map((doc) => mockSnapshotOf(doc.id, doc.data)),
    }),
    doc: (id: string) => mockMakeDoc(`${path}/${id}`),
  }
  return query
}

function mockMakeDoc(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => mockSnapshotOf(path.split('/').pop() ?? '', mockDocsByPath[path]),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: (name: string) => mockMakeCollection(name),
        getAll: async (...refs: Array<{ path: string }>) =>
          refs.map((ref) => mockSnapshotOf(ref.path.split('/').pop() ?? '', mockDocsByPath[ref.path])),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAddAdminAudit(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))

import { STAFF_AI_CONVERSATIONS_PAGE } from '../usage/staff-org-ai-conversations'
import { GET } from './ai-admin-conversations'

const QUESTION = 'Is this the number of days until my website is published?'

const get = (query: string, token: string | null = 'token') =>
  GET(
    new Request(`https://app.aglyn.com/api/ai/admin/conversations?${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

const staff = () => mockVerifyIdToken.mockResolvedValueOnce({ uid: 'staff-1', email_verified: true, staff: true })

beforeEach(() => {
  mockVerifyIdToken.mockReset()
  mockAddAdminAudit.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  mockDocsByPath = { 'orgs/org-1': { name: 'Vacation to Pen' } }
  mockQueryDocs = {
    'orgs/org-1/members': [{ id: 'uid-1', data: { email: 'molly@example.com', displayName: 'Molly McBride' } }],
  }
})

afterEach(() => jest.restoreAllMocks())

describe('the staff gate', () => {
  it('refuses without a token, without the staff claim, and without a kind it knows', async () => {
    expect((await get('orgId=org-1&kind=assist', null)).status).toBe(401)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u', email_verified: true })
    expect((await get('orgId=org-1&kind=assist')).status).toBe(403)
    expect((await get('orgId=org-1&kind=everything')).status).toBe(400)
    staff()
    expect((await get('orgId=nope&kind=assist')).status).toBe(404)
    expect(mockAddAdminAudit).not.toHaveBeenCalled()
  })
})

describe('Assist chat', () => {
  it('joins each exchange with its signal and names who asked', async () => {
    mockQueryDocs['orgs/org-1/assistExchanges'] = [
      { id: 'ex-1', data: { uid: 'uid-1', question: QUESTION, answer: 'Your site is live.', hostId: 'h1', createdAt: 1791388000000 } },
    ]
    mockDocsByPath['orgs/org-1/assistSignals/ex-1'] = {
      route: 'analytics',
      model: 'claude-sonnet-5',
      estCostUsd: 0.0235,
      feedback: 'down',
    }
    staff()
    const response = await get('orgId=org-1&kind=assist')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({
      kind: 'assist',
      next: null,
      rows: [
        {
          id: 'ex-1',
          at: new Date(1791388000000).toISOString(),
          by: { uid: 'uid-1', email: 'molly@example.com', name: 'Molly McBride' },
          hostId: 'h1',
          route: 'analytics',
          question: QUESTION,
          answer: 'Your site is live.',
          model: 'claude-sonnet-5',
          estCostUsd: 0.0235,
          feedback: 'down',
        },
      ],
    })
  })

  it('records the read as an access, with no text in the audit row', async () => {
    mockQueryDocs['orgs/org-1/assistExchanges'] = [
      { id: 'ex-1', data: { uid: 'uid-1', question: QUESTION, answer: 'Secret answer', createdAt: 1 } },
    ]
    staff()
    await get('orgId=org-1&kind=assist')
    expect(mockAddAdminAudit).toHaveBeenCalledTimes(1)
    const [, entry] = mockAddAdminAudit.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(entry).toMatchObject({
      actorUid: 'staff-1',
      action: 'org.ai-conversations-viewed',
      target: 'orgs/org-1',
      after: { kind: 'assist', rows: 1, after: null },
    })
    expect(JSON.stringify(entry)).not.toContain(QUESTION)
    expect(JSON.stringify(entry)).not.toContain('Secret answer')
  })

  it('pages newest first, and the next page starts after the last row served', async () => {
    mockQueryDocs['orgs/org-1/assistExchanges'] = Array.from({ length: STAFF_AI_CONVERSATIONS_PAGE + 3 }, (_, i) => ({
      id: `ex-${i}`,
      data: { uid: 'uid-1', question: `q${i}`, answer: '', createdAt: 1000 - i },
    }))
    for (const doc of mockQueryDocs['orgs/org-1/assistExchanges']) {
      mockDocsByPath[`orgs/org-1/assistExchanges/${doc.id}`] = doc.data
    }
    staff()
    const first = await (await get('orgId=org-1&kind=assist')).json()
    expect(first.rows).toHaveLength(STAFF_AI_CONVERSATIONS_PAGE)
    expect(first.next).toBe(`ex-${STAFF_AI_CONVERSATIONS_PAGE - 1}`)
    staff()
    const second = await (await get(`orgId=org-1&kind=assist&after=${first.next}`)).json()
    expect(second.rows.map((row: { id: string }) => row.id)).toEqual([
      `ex-${STAFF_AI_CONVERSATIONS_PAGE}`,
      `ex-${STAFF_AI_CONVERSATIONS_PAGE + 1}`,
      `ex-${STAFF_AI_CONVERSATIONS_PAGE + 2}`,
    ])
    expect(second.next).toBeNull()
  })
})

describe('AI jobs', () => {
  it('shows the brief, and the result kept beside an insight or a CRM job', async () => {
    mockQueryDocs['orgs/org-1/aiJobs'] = [
      {
        id: 'job-insight',
        data: { kind: 'insight', status: 'done', brief: QUESTION, createdBy: 'uid-1', creditsSpent: 24, createdAt: 3, outputs: [{ resource: 'insight', label: 'Answer', note: '2 insights' }] },
      },
      {
        id: 'job-email',
        data: { kind: 'crm', status: 'done', brief: 'Draft a follow-up', createdBy: 'uid-2', creditsSpent: 5, createdAt: 2, error: null },
      },
      { id: 'job-site', data: { kind: 'site', status: 'failed', brief: 'A bakery site', createdBy: 'uid-1', creditsSpent: 0, createdAt: 1, error: 'The plan was refused.' } },
    ]
    mockDocsByPath['orgs/org-1/aiInsights/job-insight'] = {
      insights: [{ text: 'Page views and visitors are both 0.' }],
      gap: 'The tables cannot confirm a publish date.',
    }
    mockDocsByPath['orgs/org-1/aiCrmAnswers/job-email'] = {
      proposal: { kind: 'email', subject: 'Following up', body: 'Hi Sam' },
    }
    staff()
    const body = await (await get('orgId=org-1&kind=jobs')).json()
    expect(body.rows.map((row: { result: unknown }) => row.result)).toEqual([
      { kind: 'insight', insights: ['Page views and visitors are both 0.'], gap: 'The tables cannot confirm a publish date.' },
      { kind: 'crm-email', subject: 'Following up', body: 'Hi Sam' },
      null,
    ])
    expect(body.rows[0]).toMatchObject({
      brief: QUESTION,
      kind: 'insight',
      credits: 24,
      by: { email: 'molly@example.com' },
      outputs: [{ label: 'Answer', note: '2 insights', resource: 'insight', hostSubdomain: null }],
    })
    // A member who has since left is named by uid alone.
    expect(body.rows[1].by).toEqual({ uid: 'uid-2', email: null, name: null })
    expect(body.rows[2]).toMatchObject({ status: 'failed', error: 'The plan was refused.' })
  })
})
