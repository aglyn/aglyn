/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * AGL-3303 — a stored submission says which organization and site it
 * belongs to.
 *
 * The organization's Inbox reads every site's submissions with ONE
 * collection-group query filtered on `orgId`, and lists each row under the
 * site its `hostId` names. A row written without them is in no organization's
 * Inbox at all, so the stamp is what the whole org-level list stands on.
 *
 * It rides the write that was already happening, off documents the route had
 * already read: this file pins that as firmly as the fields, because an extra
 * read on every submission is a cost on the one endpoint the public hits.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
let mockAddedSubmissions: Record<string, any>[] = []
/** Every document the route READ through the Admin SDK, by path. */
let mockReads: string[] = []
/** What `getOrgForHost` (the `hostIndex` mirror) answers. */
let mockOwningOrg: { orgId: string; org: Record<string, any> } | null = null

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
    mockReads.push(path)
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    const base = options?.merge ? (mockStore[path] ?? {}) : {}
    const next: Record<string, any> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      next[key] =
        value && typeof value === 'object' && '__increment' in value
          ? Number(next[key] ?? 0) +
            (value as { __increment: number }).__increment
          : value
    }
    mockStore[path] = next
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string) => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (!path.endsWith('formSubmissions')) {
      throw new Error(`unexpected add to ${path}`)
    }
    mockAddedSubmissions.push(data)
    return { id: `submission-${mockAddedSubmissions.length}` }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  resolveCampaignTouch: async () => null,
  attributeCampaignConversion: async () => null,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockCollectionHandle(name),
      }),
    }),
  },
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetMs: Date.now() + 30_000,
    degraded: false,
  }),
  getOrgForHost: async () => mockOwningOrg,
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => {
    throw new Error('no dataset binding in these cases')
  },
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

/*
 * The person the submission names is the record system's to file, through a
 * seam of its own with specs of its own. Stood down here so the reads and
 * writes this file counts are the route's, and nothing else's.
 */
jest.mock('@aglyn/aglyn/plugin-manager/record-captured-contact', () => ({
  __esModule: true,
  default: async () => ({ ok: false, reason: 'none' }),
}))

// Below the mocks by intent: babel hoists `jest.mock` above every import.
import { POST } from '../app/api/forms/submit/route'

const submit = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://site.example/api/forms/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({
        hostId: HOST_ID,
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...body,
      }),
    }),
  ) as Promise<Response>

beforeEach(() => {
  mockStore = {
    [`hosts/${HOST_ID}`]: { displayName: 'Site', orgId: 'org-acme' },
  }
  mockAddedSubmissions = []
  mockReads = []
  mockOwningOrg = { orgId: 'org-acme', org: { plan: 'starter' } }
})

describe('AGL-3303 · a submission is stamped with its organization and site', () => {
  it('writes orgId and hostId onto the row it adds', async () => {
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockAddedSubmissions).toHaveLength(1)
    expect(mockAddedSubmissions[0]).toMatchObject({
      orgId: 'org-acme',
      hostId: HOST_ID,
      // The row is otherwise the one it always was.
      formName: 'Contact',
      read: false,
      createdAt: 'server-timestamp',
    })
  })

  it('takes the org from the host document before the hostIndex mirror', async () => {
    // The two agree in production. The host document is read on every
    // submission for the existence check, so it is the one consulted first.
    mockStore[`hosts/${HOST_ID}`] = {
      displayName: 'Site',
      orgId: 'org-from-host',
    }
    mockOwningOrg = { orgId: 'org-from-index', org: { plan: 'starter' } }
    await submit()
    expect(mockAddedSubmissions[0].orgId).toBe('org-from-host')
  })

  it('falls back to the org the plan gate resolved when the host names none', async () => {
    mockStore[`hosts/${HOST_ID}`] = { displayName: 'Site' }
    await submit()
    expect(mockAddedSubmissions[0].orgId).toBe('org-acme')
    expect(mockAddedSubmissions[0].hostId).toBe(HOST_ID)
  })

  it('leaves orgId off a site that belongs to no organization', async () => {
    // Absent rather than null or empty: such a row is in no org's list, and
    // a query on `orgId == ''` must not be able to gather every orphan.
    mockStore[`hosts/${HOST_ID}`] = { displayName: 'Site' }
    mockOwningOrg = null
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockAddedSubmissions[0]).not.toHaveProperty('orgId')
    expect(mockAddedSubmissions[0].hostId).toBe(HOST_ID)
  })

  it('costs no extra read and no extra write', async () => {
    await submit()
    // The host (existence) and the monthly counter (quota) are the route's
    // own reads; the org came from `getOrgForHost`, which the plan gate
    // already called. Nothing here reads `hostIndex` or `orgs` a second time.
    expect(mockReads).toEqual([
      `hosts/${HOST_ID}`,
      `hosts/${HOST_ID}/counters/formSubmissions`,
    ])
    // The one add, and the counter it bills — nothing written beside them.
    expect(mockAddedSubmissions).toHaveLength(1)
    expect(Object.keys(mockStore).sort()).toEqual([
      `hosts/${HOST_ID}`,
      `hosts/${HOST_ID}/counters/formSubmissions`,
    ])
  })

  it('THE CONTROL: a refused submission writes no row, stamped or not', async () => {
    // Guard the guard: every assertion above reads the added row, and a
    // route that refused everything would add none and fail loudly rather
    // than pass. This proves the refusal path still writes nothing.
    const response = await submit({ fields: {} })
    expect(response.status).toBe(400)
    expect(mockAddedSubmissions).toHaveLength(0)
  })
})
