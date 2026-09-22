/**
 * @jest-environment node
 */
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

/**
 * `/api/forms/submit` on a site that switched Forms off (AGL-3029).
 *
 * The route is core and the Forms plugin draws the form, so a switch on the
 * bundle alone would leave the endpoint answering behind a page that no longer
 * shows a form. The route asks the site's own plugin set instead, through the
 * catalog, and this pins both halves of the answer: a Forms-off site stores,
 * counts, bills and files nothing, and a site whose document never mentioned
 * the switch collects exactly as before. The resolver and the door helper are
 * REAL; only Firestore and the admin barrel are doubled.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
let mockAdds: Array<{ path: string; data: Record<string, any> }> = []
let mockSets: string[] = []
let mockLeads: Record<string, any>[] = []
let mockOrg: Record<string, any> = { plan: 'business' }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string): any => ({
  id: path.split('/').pop(),
  get ref() {
    return mockDocHandle(path)
  },
  get: async () => {
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      ref: mockDocHandle(path),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    mockSets.push(path)
    mockStore[path] = { ...(options?.merge ? (mockStore[path] ?? {}) : {}), ...patch }
  },
  update: async (patch: Record<string, any>) => {
    if (mockStore[path] === undefined) throw new Error('NOT_FOUND')
    mockStore[path] = { ...mockStore[path], ...patch }
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    mockAdds.push({ path, data })
    return { id: 'submission-1', update: async () => undefined }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  resolveCampaignTouch: async () => null,
  attributeCampaignConversion: async () => null,
  // The CRM's capture writer asks whether the workspace already holds the
  // address as a contact before it files a lead (AGL-3232). Nobody, here.
  findContactByEmail: async () => null,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({ collection: (name: string) => mockCollectionHandle(name) }),
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
  upsertHostContact: async () => undefined,
  addHostLead: async (options: Record<string, any>) => {
    mockLeads.push(options)
    return true
  },
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  captureHostContact: async () => undefined,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

/*
 * The route captures through the platform's contact-capture contract now
 * (AGL-3080), and the plugin that keeps people is what calls
 * `captureHostContact`. The CRM imports the LEAF module, so the barrel double
 * above does not intercept it; this forwards the leaf to that same double.
 *
 * Deliberately not a double of the contract itself. Every assertion below is
 * on the options the writer receives, so routing them through the real CRM
 * adapter is what proves the translation from the contract's vocabulary to
 * this one loses nothing — which is the half of this move that could fail
 * silently.
 */
/*
 * The `lead` host event a NEW lead announces itself with (AGL-3232), by the
 * leaf the CRM's writer imports it from. Recorded as nothing: what a lead
 * sets off is the automation engine's own spec.
 */
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

/*
 * The CRM registers its writer from the app's own boot manifest. Without it
 * `capturePluginContact` answers `null` — "this workspace keeps no records" —
 * and every assertion below would be measuring a capture that never happened.
 */
beforeAll(async () => {
  const { registerPluginServerDeclarations } = await import(
    '../utils/plugins.declarations.server.generated'
  )
  await registerPluginServerDeclarations()
})

import { FORMS_OFF_FOR_SITE_REFUSAL } from '@aglyn/aglyn/server'
import { POST } from '../app/api/forms/submit/route'

const submit = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://site.example/api/forms/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({
        hostId: HOST_ID,
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...body,
      }),
    }),
  ) as Promise<Response>

/** A submission a popup's email capture sends. */
const POPUP = {
  door: 'popup',
  formName: 'Popup',
  path: '/',
  fields: { email: 'reader@example.com' },
}

const submissions = () => mockAdds.filter((add) => add.path === `hosts/${HOST_ID}/formSubmissions`)

/** Nothing stored, counted or filed: the refusal wrote nowhere. */
function expectNothingWritten() {
  expect(submissions()).toEqual([])
  expect(mockSets.filter((path) => path.includes('/counters/'))).toEqual([])
  expect(mockLeads).toEqual([])
}

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockAdds = []
  mockSets = []
  mockLeads = []
  mockOrg = { plan: 'business' }
})

describe('a site that switched Forms off', () => {
  beforeEach(() => {
    mockStore[`hosts/${HOST_ID}`] = { name: 'Site', disabledPlugins: ['forms'] }
  })

  it('refuses a form submission with 404 and a sentence a visitor can read', async () => {
    const response = await submit()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: FORMS_OFF_FOR_SITE_REFUSAL })
    expectNothingWritten()
  })

  it('refuses a submission naming a bound form, and files nothing under it', async () => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = { displayName: 'Contact', routing: { lead: true } }
    const response = await submit({ formId: 'form-1' })
    expect(response.status).toBe(404)
    expectNothingWritten()
    expect(mockStore[`hosts/${HOST_ID}/forms/form-1`]).toEqual({
      displayName: 'Contact',
      routing: { lead: true },
    })
  })

  it('leaves the submissions it already stored exactly where they are', async () => {
    mockStore[`hosts/${HOST_ID}/formSubmissions/old-1`] = { formName: 'Contact' }
    await submit()
    expect(mockStore[`hosts/${HOST_ID}/formSubmissions/old-1`]).toEqual({ formName: 'Contact' })
  })

  it('still collects a Marketing popup’s address — the popup is not a form', async () => {
    const response = await submit(POPUP)
    expect(response.status).toBe(200)
    expect(submissions()).toHaveLength(1)
  })

  it('refuses the popup door too once Marketing is also off for the site', async () => {
    mockStore[`hosts/${HOST_ID}`] = { name: 'Site', disabledPlugins: ['forms', 'marketing'] }
    const response = await submit(POPUP)
    expect(response.status).toBe(404)
    expectNothingWritten()
  })

  it('does not let a body claim the popup door to reach a form or a dataset', async () => {
    for (const claim of [{ formId: 'form-1' }, { datasetBinding: 'signed-token' }]) {
      const response = await submit({ ...POPUP, ...claim })
      expect(response.status).toBe(404)
    }
    expectNothingWritten()
  })
})

describe('a site that never switched Forms off — on by default', () => {
  it.each([
    ['no plugin fields at all', { name: 'Site' }],
    ['a deny-list naming another plugin', { name: 'Site', disabledPlugins: ['commerce'] }],
    ['an opt-in list only', { name: 'Site', enabledPlugins: ['accounts'] }],
  ])('accepts a submission from a site with %s', async (_label, host) => {
    mockStore[`hosts/${HOST_ID}`] = host
    const response = await submit()
    expect(response.status).toBe(200)
    expect(submissions()).toHaveLength(1)
  })

  it('accepts one from a workspace whose switchboard list never named Forms', async () => {
    mockOrg = { plan: 'business', enabledPlugins: ['mui', 'commerce'] }
    const response = await submit()
    expect(response.status).toBe(200)
  })
})
