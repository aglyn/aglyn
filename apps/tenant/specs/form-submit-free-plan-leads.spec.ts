/**
 * @jest-environment node
 *
 * The pragma must stay in the FIRST block comment: behind the license
 * header jest silently ignores it and this runs on jsdom, where `Request`
 * is not a constructor and every case fails for the wrong reason.
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
 * WHAT A SITE ON A PLAN WITHOUT THE CRM SUITE CAPTURES LANDS IN LEADS
 * (AGL-2790).
 *
 * Such a plan's CRM opens on Leads, read-only, so every live form is a lead
 * surface there: a form whose author never turned lead routing on, and a
 * `Form` node with no form document — the only kind of form Free can place —
 * each file a lead beside the contact. A plan with the suite keeps per-form
 * routing exactly as it was.
 *
 * The plan is read from the owning org at capture time, so the cases vary
 * only the org document `getOrgForHost` answers and the form they submit to.
 */

const HOST_ID = 'site-1'
const FORM_PATH = `hosts/${HOST_ID}/forms/f1`

let mockStore: Record<string, Record<string, any>> = {}
let mockContactUpserts: Record<string, any>[] = []
let mockLeads: Record<string, any>[] = []
/** The owning org's document, as `getOrgForHost` answers it. */
let mockOrg: Record<string, any> = { plan: 'free' }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string): any => ({
  id: path.split('/').pop(),
  get: async () => {
    const data = mockStore[path]
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
      ref: mockDocHandle(path),
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = {
      ...(options?.merge ? (mockStore[path] ?? {}) : {}),
      ...patch,
    }
  },
  update: async (patch: Record<string, any>) => {
    mockStore[path] = { ...(mockStore[path] ?? {}), ...patch }
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async () => ({ id: 'submission-1', update: async () => undefined }),
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
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => mockCollectionHandle('orgs/org-1/datasets'),
  dataStorageRefusal: async () => null,
  upsertHostContact: async (options: Record<string, any>) => {
    mockContactUpserts.push(options)
  },
  addHostLead: async (options: Record<string, any>) => {
    mockLeads.push(options)
    return true
  },
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  // The door captures through `captureHostContact`; the stub hands the call to
  // the data-admin double above, so the contact assertions read one list.
  captureHostContact: (...args: unknown[]) => {
    const dataAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
      upsertHostContact: (...a: unknown[]) => unknown
    }
    return dataAdmin.upsertHostContact(...args)
  },
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

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
        fields: { email: 'visitor@example.com', name: 'Visitor' },
        ...body,
      }),
    }),
  ) as Promise<Response>

/** A form document on this site, with the routing given. */
const seedForm = (routing: Record<string, unknown>) => {
  mockStore[FORM_PATH] = { displayName: 'Contact us', routing }
}

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockContactUpserts = []
  mockLeads = []
  mockOrg = { plan: 'free' }
})

describe('on a plan without the CRM suite, every live form files a lead', () => {
  it('files a lead from a Form node with no form document', async () => {
    expect((await submit()).status).toBe(200)

    expect(mockContactUpserts).toHaveLength(1)
    expect(mockLeads).toHaveLength(1)
    expect(mockLeads[0]['lead']).toMatchObject({
      email: 'visitor@example.com',
      name: 'Visitor',
      source: 'form',
    })
  })

  it('files a lead from a form whose routing is off, and counts it on the form', async () => {
    seedForm({})
    expect((await submit({ formId: 'f1' })).status).toBe(200)

    expect(mockLeads).toHaveLength(1)
    expect(mockLeads[0]['lead']['source']).toBe('form:f1')
    expect(mockStore[FORM_PATH]['stats.leads']).toEqual({ __increment: 1 })
  })

  it('reads a paid plan whose subscription died as a plan without the suite', async () => {
    mockOrg = { plan: 'pro', billingStatus: 'canceled' }
    seedForm({})
    await submit({ formId: 'f1' })

    expect(mockLeads).toHaveLength(1)
  })

  it('files no lead for a submission that names nobody', async () => {
    await submit({ fields: { message: 'hello' } })

    expect(mockContactUpserts).toHaveLength(0)
    expect(mockLeads).toHaveLength(0)
  })
})

describe('on a plan with the CRM suite, a form files a lead only when routed', () => {
  beforeEach(() => {
    mockOrg = { plan: 'starter', subscription: { status: 'active' } }
  })

  it('files no lead from a form whose routing is off, and counts none', async () => {
    seedForm({})
    expect((await submit({ formId: 'f1' })).status).toBe(200)

    expect(mockContactUpserts).toHaveLength(1)
    expect(mockLeads).toHaveLength(0)
    expect(Object.keys(mockStore[FORM_PATH])).not.toContain('stats.leads')
  })

  it('files no lead from a Form node with no form document', async () => {
    await submit()

    expect(mockContactUpserts).toHaveLength(1)
    expect(mockLeads).toHaveLength(0)
  })

  it('files a lead from a routed form', async () => {
    seedForm({ lead: true })
    await submit({ formId: 'f1' })

    expect(mockLeads).toHaveLength(1)
    expect(mockLeads[0]['lead']['source']).toBe('form:f1')
  })

  it('keeps per-form routing on a Free org granted the suite', async () => {
    mockOrg = { plan: 'free', entitlements: { features: { crm: true } } }
    seedForm({})
    await submit({ formId: 'f1' })

    expect(mockLeads).toHaveLength(0)
  })
})
