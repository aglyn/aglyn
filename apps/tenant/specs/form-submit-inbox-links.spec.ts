/**
 * @jest-environment node
 *
 * The pragma must stay in the FIRST block comment: behind the license
 * header jest silently ignores it and this runs on jsdom, where `Request`
 * is not a constructor.
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
 * What a stored submission carries for the Inbox to link to, and what its
 * alert says (AGL-3461).
 *
 *  1. the campaigns its PAGE is filed under, stamped beside the form's and
 *     never merged into them — found through the routing map the route
 *     already holds, so a path naming no page costs no read;
 *  2. the lead or contact the person was filed as, by the id the record
 *     system answered with;
 *  3. an alert that opens this submission and names the campaigns, asked of
 *     the crediting plugin only when there is something to name.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
/** What the route added to `formSubmissions`. */
let mockAdded: Record<string, any>[] = []
/** Every update the route made to the stored submission. */
let mockRowUpdates: Record<string, any>[] = []
/** Every document read, by path. */
let mockReads: string[] = []
let mockNotifications: Record<string, any>[] = []
let mockDescribes: Record<string, any>[] = []
let mockResolved: Record<string, any> | null = null
let mockDescription: Record<string, any> | null = null

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string): any => ({
  get: async () => {
    mockReads.push(path)
    const data = mockStore[path]
    return {
      id: path.split('/').pop(),
      ref: mockDocHandle(path),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = { ...(options?.merge ? (mockStore[path] ?? {}) : {}), ...patch }
  },
  update: async () => undefined,
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    mockAdded.push(data)
    return {
      id: 'submission-1',
      update: async (patch: Record<string, any>) => {
        mockRowUpdates.push(patch)
      },
    }
  },
})

jest.mock('@aglyn/aglyn/plugin-manager/plugin-conversion-credit', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-conversion-credit'),
  resolveConversionTouch: async () => mockResolved,
  creditConversion: async () => false,
  describeConversion: async (request: Record<string, any>) => {
    mockDescribes.push(request)
    return mockDescription
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  readLeadForHost: async () => null,
  findContactByEmail: async () => null,
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
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  notifyHostManagers: async (_hostId: string, payload: Record<string, any>) => {
    mockNotifications.push(payload)
  },
  orgDataCollectionForHost: async () => mockCollectionHandle('orgs/org-1/datasets'),
  dataStorageRefusal: async () => null,
  // The contact the record system files a non-lead submission as.
  upsertHostContact: async () => ({ contactId: 'contact-1', created: true }),
  addHostLeadOutcome: async () => ({ stored: true, created: true, sourceAdded: true }),
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  captureHostContact: (...args: unknown[]) =>
    (
      jest.requireMock('@aglyn/tenant-data-admin') as {
        upsertHostContact: (...a: unknown[]) => unknown
      }
    ).upsertHostContact(...args),
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

jest.mock('@aglyn/tenant-runtime/emit-host-event', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
}))

jest.mock('@aglyn/tenant-runtime/capture-host-contact', () => ({
  captureHostContact: (...args: unknown[]) =>
    (
      jest.requireMock('@aglyn/tenant-runtime') as {
        captureHostContact: (...a: unknown[]) => unknown
      }
    ).captureHostContact(...args),
}))

// The CRM's writer, registered from the app's own boot manifest, is what
// answers which record the person was filed as.
beforeAll(async () => {
  const { registerPluginServerDeclarations } = await import(
    '../utils/plugins.declarations.server.generated'
  )
  await registerPluginServerDeclarations()
})

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
        formName: 'AI website draft',
        path: '/ai-website-draft',
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...body,
      }),
    }),
  ) as Promise<Response>

const SCREEN_PATH = `hosts/${HOST_ID}/screens/scr-landing`

beforeEach(() => {
  mockStore = {
    // The routing map: screen id → path, root `/`, others without a slash.
    [`hosts/${HOST_ID}`]: { name: 'Site', screens: { 'scr-landing': 'ai-website-draft' } },
    [SCREEN_PATH]: { campaignIds: ['camp-ai'] },
    [`hosts/${HOST_ID}/forms/f1`]: {
      displayName: 'AI website draft',
      campaignIds: ['camp-form'],
      routing: { lead: true },
    },
  }
  mockAdded = []
  mockRowUpdates = []
  mockReads = []
  mockNotifications = []
  mockDescribes = []
  mockResolved = null
  mockDescription = null
})

describe('what the page is filed under', () => {
  it('stamps the page’s campaigns BESIDE the form’s, never into them', async () => {
    expect((await submit({ formId: 'f1' })).status).toBe(200)

    expect(mockAdded[0]).toMatchObject({
      campaignIds: ['camp-form'],
      pageCampaignIds: ['camp-ai'],
    })
  })

  it('a path naming no page this site serves stamps nothing and reads nothing', async () => {
    await submit({ formId: 'f1', path: '/not-a-page' })

    expect(mockAdded[0].pageCampaignIds).toBeUndefined()
    expect(mockReads.filter((path) => path.includes('/screens/'))).toEqual([])
  })

  it('a page filed under nothing leaves the field off the row', async () => {
    mockStore[SCREEN_PATH] = {}

    await submit({ formId: 'f1' })

    expect('pageCampaignIds' in mockAdded[0]).toBe(false)
  })
})

describe('the person it filed', () => {
  it('a lead surface stamps the LEAD, by the id its record route answers to', async () => {
    await submit({ formId: 'f1' })

    expect(mockRowUpdates).toEqual([
      { capturedRecord: { kind: 'lead', id: expect.any(String) } },
    ])
    expect(mockRowUpdates[0].capturedRecord.id).not.toBe('')
  })

  it('anything else stamps the CONTACT', async () => {
    mockStore[`hosts/${HOST_ID}/forms/f1`] = { displayName: 'AI website draft' }

    await submit({ formId: 'f1' })

    expect(mockRowUpdates).toEqual([{ capturedRecord: { kind: 'contact', id: 'contact-1' } }])
  })

  it('an anonymous enquiry filed nobody, and the row is not written again', async () => {
    await submit({ formId: 'f1', fields: { message: 'hello' } })

    expect(mockRowUpdates).toEqual([])
  })
})

describe('the alert', () => {
  it('opens THIS submission, not the Inbox list', async () => {
    await submit({ formId: 'f1' })

    expect(mockNotifications).toHaveLength(1)
    expect(mockNotifications[0].link).toBe(
      `/${HOST_ID}/inbox/submissions?submission=submission-1`,
    )
  })

  it('asks the crediting plugin to name the touch and every campaign the row is filed under', async () => {
    const touch = { channel: 'page', campaignId: 'camp-ai', touchedAtMs: 1 }
    mockResolved = touch
    mockDescription = {
      credited: { label: 'One job — AI', how: 'viewed /ai-website-draft, a page filed under it' },
      filedUnder: [
        { id: 'camp-form', label: 'Forms' },
        { id: 'camp-ai', label: 'One job — AI' },
      ],
    }

    await submit({ formId: 'f1' })

    expect(mockDescribes).toEqual([
      { hostId: HOST_ID, touch, containerIds: ['camp-form', 'camp-ai'] },
    ])
    expect(mockNotifications[0].body).toBe(
      'Someone submitted “AI website draft” on {site} (page /ai-website-draft). ' +
        'Credited to “One job — AI”: the visitor viewed /ai-website-draft, a page filed under it. ' +
        'The form and page are filed under “Forms” and “One job — AI”.',
    )
  })

  it('asks nothing when there is no touch and nothing filed', async () => {
    await submit({ path: '/contact' })

    expect(mockDescribes).toEqual([])
    expect(mockNotifications[0].body).toBe(
      'Someone submitted “AI website draft” on {site} (page /contact).',
    )
  })
})
