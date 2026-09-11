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
 * A public form submission cannot choose which dataset it writes to
 * (AGL-2773).
 *
 * `/api/forms/submit` is unauthenticated. It used to take `datasetId`, the
 * legacy `dataset` name and `fieldMap` straight from the request body, and the
 * only check on the target was that the site could see it — so a hand-built
 * POST could add rows to ANY dataset shared with the site, within quota, and
 * send any submitted value into any of its fields.
 *
 * The binding now comes from the page: compose signs each form's binding into
 * the form, and the route writes only where a valid signature for THIS site
 * says. Each case below sends a body that names `payroll`, a dataset the site
 * can see and no form writes to, and asserts nothing reaches it.
 *
 * ⚠️ `resolveDatasetDoc` is doubled, so this proves which binding the route
 * ASKS for and where it writes, not that the lookup honors site scope —
 * `resolve-dataset.spec.ts` owns that.
 */

const HOST_ID = 'site-1'

process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'

let mockStore: Record<string, Record<string, any>> = {}
/** Every binding the route asked `resolveDatasetDoc` for. */
let mockResolved: Array<{ datasetId?: string; datasetName?: string }> = []
/** Records appended, by dataset id. */
let mockRecords: Record<string, Record<string, any>[]> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string): any => ({
  get: async () => {
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>) => {
    mockStore[path] = { ...(mockStore[path] ?? {}), ...patch }
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

/** A dataset with `contact_email`, `message` and `salary` fields. */
const mockDataset = (id: string, displayName: string) => ({
  id,
  exists: true,
  get: (field: string) =>
    ({
      displayName,
      model: {
        order: ['contact_email', 'message', 'salary'],
        fields: {
          contact_email: { name: 'Email', type: 'text' },
          message: { name: 'Message', type: 'text' },
          salary: { name: 'Salary', type: 'text' },
        },
      },
    })[field],
  ref: {
    collection: () => ({
      add: async (data: Record<string, any>) => {
        mockRecords[id] = [...(mockRecords[id] ?? []), data]
        return { id: `record-${id}` }
      },
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    }),
  },
})

const mockDatasets: Record<string, ReturnType<typeof mockDataset>> = {
  leads: mockDataset('leads', 'Leads'),
  payroll: mockDataset('payroll', 'Payroll'),
}

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
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'business' } }),
  dataStorageRefusal: async () => null,
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () =>
    mockCollectionHandle('orgs/org-1/datasets'),
  upsertHostContact: async () => undefined,
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  captureHostContact: async () => undefined,
  emitHostEvent: async () => ({ alerts: [] }),
  // Resolves exactly what it is asked for, and records the ask: which binding
  // the route requests is the property under test.
  resolveDatasetDoc: async (
    _ref: unknown,
    binding: { datasetId?: string; datasetName?: string },
  ) => {
    mockResolved.push(binding)
    if (binding.datasetId && mockDatasets[binding.datasetId]) {
      return mockDatasets[binding.datasetId]
    }
    return Object.values(mockDatasets).find(
      (dataset) => dataset.get('displayName') === binding.datasetName,
    )
  },
}))

import { POST } from '../app/api/forms/submit/route'
import { signFormDatasetBinding } from '@aglyn/tenant-data-admin/server/form-dataset-binding-token'

/** The binding the page signed into its contact form. */
const LEADS_BINDING = {
  datasetId: 'leads',
  fieldMap: { email: 'contact_email' },
}

const submit = (body: Record<string, unknown>) =>
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

const askedFor = (datasetId: string) =>
  mockResolved.some((binding) => binding.datasetId === datasetId)

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockResolved = []
  mockRecords = {}
})

describe('a form submission writes where the page signed, not where the body says', () => {
  it('a crafted body cannot add a row to a dataset no form writes to', async () => {
    const response = await submit({
      datasetId: 'payroll',
      dataset: 'Payroll',
      fieldMap: { email: 'salary' },
    })

    // The submission itself still lands — a crafted request is not a reason
    // to lose the Inbox copy of a real one shaped the same way.
    expect(response.status).toBe(200)
    expect(mockRecords['payroll']).toBeUndefined()
    expect(askedFor('payroll')).toBe(false)
  })

  it('a crafted body cannot redirect the binding the page signed', async () => {
    const response = await submit({
      datasetBinding: signFormDatasetBinding(HOST_ID, LEADS_BINDING),
      datasetId: 'payroll',
      dataset: 'Payroll',
    })

    expect(response.status).toBe(200)
    expect(mockRecords['payroll']).toBeUndefined()
    expect(mockRecords['leads']).toHaveLength(1)
  })

  it('takes the field map from the signed binding, not from the body', async () => {
    await submit({
      datasetBinding: signFormDatasetBinding(HOST_ID, LEADS_BINDING),
      fieldMap: { email: 'salary', message: 'salary' },
    })

    expect(mockRecords['leads']).toHaveLength(1)
    expect(mockRecords['leads'][0].values).toEqual({
      contact_email: 'visitor@example.com',
      message: 'hello',
    })
  })

  it('refuses a binding signed for another site', async () => {
    await submit({
      datasetBinding: signFormDatasetBinding('another-site', {
        datasetId: 'payroll',
        fieldMap: {},
      }),
    })

    expect(mockRecords['payroll']).toBeUndefined()
    expect(askedFor('payroll')).toBe(false)
  })

  it('refuses a binding whose payload was edited', async () => {
    const [version, , signed] = signFormDatasetBinding(
      HOST_ID,
      LEADS_BINDING,
    ).split('.')
    const forged = Buffer.from(
      JSON.stringify({ h: HOST_ID, d: 'payroll', m: {} }),
    ).toString('base64url')

    await submit({ datasetBinding: `${version}.${forged}.${signed}` })

    expect(mockRecords['payroll']).toBeUndefined()
    expect(askedFor('payroll')).toBe(false)
  })

  it('THE CONTROL: a signed legacy name binding keeps writing where it wrote', async () => {
    // A form bound by name before ids existed (AGL-141). Moving the decision
    // to the server must not move its records.
    const response = await submit({
      datasetBinding: signFormDatasetBinding(HOST_ID, {
        datasetName: 'Leads',
        fieldMap: {},
      }),
    })

    expect(response.status).toBe(200)
    expect(mockResolved).toContainEqual(
      expect.objectContaining({ datasetName: 'Leads' }),
    )
    expect(mockRecords['leads']).toHaveLength(1)
  })
})
