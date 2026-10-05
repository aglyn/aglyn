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
 * AGL-2773, option B — a bound form's record is held to the dataset's model.
 *
 * The form leg used to store `String(value)` for every field and check
 * nothing: `abc` landed in a number column and a required field could be
 * skipped. Now each value is coerced to its field's type and a record with a
 * refused value is not written. The submission is kept either way — the
 * visitor sees success, the Inbox copy exists — and the refusal is stamped on
 * it per field.
 *
 * The plugin case runs through the app's REAL boot declarations: the
 * marketplace's `rating` type registers there, which is what makes its
 * validator run in the tenant at all.
 */

const HOST_ID = 'site-1'

type Increment = { __increment: number }
const mockIsIncrement = (value: unknown): value is Increment =>
  typeof value === 'object' && value !== null && '__increment' in (value as any)

let mockStore: Record<string, Record<string, any>> = {}
/** Every `add` to a dataset's `records` subcollection. */
let mockDatasetRecords: Record<string, any>[] = []
/** Patches applied to the submission document after it was created. */
let mockSubmissionUpdates: Record<string, any>[] = []
/** Every submission the route created — the visitor's Inbox copy. */
let mockSubmissions: Record<string, any>[] = []
/** What `resolveDatasetDoc` hands back, swapped per case. */
let mockDataset: any = null
/** Existing records in the dataset, for the quota check. */
let mockRecordCount = 0

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
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
      next[key] = mockIsIncrement(value)
        ? Number(next[key] ?? 0) + value.__increment
        : value
    }
    mockStore[path] = next
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (!path.endsWith('formSubmissions')) {
      throw new Error(`unexpected add to ${path}`)
    }
    mockSubmissions.push(data)
    // The route calls `.update()` on what `add` returns. A fake returning a
    // bare `{ id }` would throw a TypeError inside the route's own
    // try/catch and be indistinguishable from "no stamp was written" —
    // a false GREEN on the assertion this file exists for.
    return {
      id: 'submission-1',
      update: async (patch: Record<string, any>) => {
        mockSubmissionUpdates.push(patch)
      },
    }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
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
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => mockCollectionHandle('orgs/org-1/datasets'),
  upsertHostContact: async () => undefined,
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  // Every server door captures through `captureHostContact` (AGL-2605), which
  // is `upsertHostContact` plus the contactCreated announcement. The stub
  // hands the call to whichever double this spec keeps for the writer — the
  // runtime mock's own, or the data-admin mock's when the spec doubles the
  // data layer instead — so assertions on its options read the same calls.
  captureHostContact: (...args: unknown[]) => {
    const runtime = jest.requireMock('@aglyn/tenant-runtime') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    const dataAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    return (runtime.upsertHostContact ?? dataAdmin.upsertHostContact)?.(...args)
  },
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => mockDataset,
}))

/*
 * The route captures through the platform's contact-capture contract now
 * (AGL-3080), and the plugin that keeps people is what calls
 * `captureHostContact` from its own module, which the barrel double above
 * does not intercept; this forwards that module to the same double.
 *
 * Deliberately not a double of the contract itself. Every assertion below is
 * on the options the writer receives, so routing them through the real CRM
 * adapter is what proves the translation from the contract's vocabulary to
 * this one loses nothing — which is the half of this move that could fail
 * silently.
 */
jest.mock('../../../libs/plugins/crm/src/lib/server/capture-host-contact', () => ({
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

// The door as the tenant serves it: the forms plugin's route, through the
// plugin API dispatcher, with the forms plugin's surface loaded (AGL-3080).
jest.mock('../utils/server-plugin-loader', () => ({
  serverPluginLoader: jest.requireActual('./plugin-door-dispatch').formsOnlyServerPluginLoader(),
}))
import { POST } from './plugin-door-dispatch'
import { stampFormRecordTargets } from '@aglyn/aglyn/plugin-manager/submission-record-target'

/*
 * The data plugin finds the dataset through its own `resolve-dataset` module
 * (AGL-3080), which the runtime double above does not reach; this forwards the
 * lookup to that double.
 */
jest.mock('@aglyn/plugins-data/server/resolve-dataset', () => ({
  resolveDatasetDoc: (...args: unknown[]) =>
    (
      jest.requireMock('@aglyn/tenant-runtime') as {
        resolveDatasetDoc: (...a: unknown[]) => unknown
      }
    ).resolveDatasetDoc(...args),
}))

/**
 * The token a published page carries for a form bound this way — made the
 * way the page makes it: a form and its fields, stamped by the platform's
 * submission-record-target contract, which the app's boot filled with the data
 * plugin's target. An app never imports a plugin, so there is no signer here
 * to call directly, and this is the closer copy of the page anyway.
 */
async function signFormDatasetBinding(
  hostId: string,
  binding: {
    datasetId?: string
    datasetName?: string
    fieldMap: Record<string, string>
  },
): Promise<string> {
  const fieldIds = Object.keys(binding.fieldMap).map((name) => `field-${name}`)
  const nodes: Record<string, unknown> = {
    form: {
      $id: 'form',
      componentId: 'form',
      props: {
        ...(binding.datasetId ? { datasetId: binding.datasetId } : {}),
        ...(binding.datasetName ? { datasetName: binding.datasetName } : {}),
      },
      nodes: fieldIds,
    },
  }
  for (const [name, datasetFieldId] of Object.entries(binding.fieldMap)) {
    nodes[`field-${name}`] = {
      $id: `field-${name}`,
      componentId: 'formField',
      parentId: 'form',
      props: { fieldName: name, datasetFieldId },
    }
  }
  const stamped = (await stampFormRecordTargets(nodes, hostId)) as Record<
    string,
    { props?: Record<string, unknown> }
  >
  const token = stamped['form']?.props?.['datasetBindingToken']
  if (typeof token !== 'string') throw new Error('the page stamped no binding')
  return token
}

/** A dataset document the route will accept and append to. */
const datasetDoc = (overrides: Record<string, any> = {}) => {
  const fields: Record<string, any> = {
    // `displayName` is what the console writes; `fields` is a list of
    // column NAMES (v1 shape), not objects — modelling it as objects
    // yields zero values and a silently skipped append.
    displayName: 'Leads',
    model: null,
    fields: ['email', 'message'],
    ...overrides,
  }
  return {
    id: 'dataset-1',
    exists: true,
    get: (key: string) => fields[key],
    ref: {
      collection: () => ({
        add: async (data: Record<string, any>) => {
          mockDatasetRecords.push(data)
          return { id: 'record-1' }
        },
        count: () => ({
          get: async () => ({ data: () => ({ count: mockRecordCount }) }),
        }),
      }),
    },
  }
}

const submit = async (body: Record<string, unknown> = {}) =>
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
        // The binding the page's compose signed into this form (AGL-2773);
        // the route writes a record nowhere else.
        datasetBinding: await signFormDatasetBinding(HOST_ID, {
          datasetId: 'dataset-1',
          fieldMap: { email: 'email', message: 'message' },
        }),
        ...body,
      }),
    }),
  ) as Promise<Response>

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockDatasetRecords = []
  mockSubmissionUpdates = []
  mockSubmissions = []
  mockRecordCount = 0
  mockDataset = datasetDoc()
})

/** A model with one field of each type a form posts into. */
const TYPED_MODEL = {
  order: ['email', 'seats', 'subscribed', 'startsOn', 'tier', 'stars'],
  fields: {
    email: { name: 'Email', type: 'text', required: true },
    seats: { name: 'Seats', type: 'int32' },
    subscribed: { name: 'Subscribed', type: 'bool' },
    startsOn: { name: 'Starts on', type: 'timestamp' },
    tier: { name: 'Tier', type: 'text', validation: { options: ['Gold', 'Silver'] } },
    // The marketplace plugin's field type (AGL-434), declared at boot.
    stars: { name: 'Stars', type: 'int32', customType: 'rating' },
  },
}

const TYPED_MAP = {
  email: 'email',
  seats: 'seats',
  subscribed: 'subscribed',
  startsOn: 'startsOn',
  tier: 'tier',
  stars: 'stars',
}

const submitTyped = async (fields: Record<string, string>) =>
  submit({
    fields,
    datasetBinding: await signFormDatasetBinding(HOST_ID, {
      datasetId: 'dataset-1',
      fieldMap: TYPED_MAP,
    }),
  })

const VALID = {
  email: 'visitor@example.com',
  seats: '3',
  subscribed: 'on',
  startsOn: '2026-10-01',
  tier: 'Gold',
  stars: '4',
}

describe('AGL-2773 · a bound form writes values its dataset can hold', () => {
  beforeEach(() => {
    mockDataset = datasetDoc({ model: TYPED_MODEL, fields: TYPED_MODEL.order })
  })

  it('stores each value in its field’s type', async () => {
    const response = await submitTyped(VALID)

    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(1)
    expect(mockDatasetRecords[0].values).toEqual({
      email: 'visitor@example.com',
      seats: 3,
      subscribed: true,
      startsOn: Date.parse('2026-10-01'),
      tier: 'Gold',
      stars: 4,
    })
    expect(mockSubmissionUpdates[0].routing.dataset.recordId).toBe('record-1')
  })

  it.each([
    ['a number field', { seats: 'three' }, 'seats', /whole number/],
    ['a boolean field', { subscribed: 'perhaps' }, 'subscribed', /true or false/],
    ['a date field', { startsOn: 'soon' }, 'startsOn', /must be a date/],
    ['a select field', { tier: 'Bronze' }, 'tier', /one of: Gold, Silver/],
    ['a required field', { email: '' }, 'email', /is required/],
    ['a plugin field type', { stars: '9' }, 'stars', /0 to 5/],
  ])(
    'refuses %s, keeps the submission and says why',
    async (_label, override, fieldId, reason) => {
      const response = await submitTyped({ ...VALID, ...override })

      // The visitor is told it went through, and it did: into the Inbox.
      expect(response.status).toBe(200)
      expect(mockSubmissions).toHaveLength(1)
      // No row the dataset cannot hold.
      expect(mockDatasetRecords).toHaveLength(0)
      // The refusal, per field, on the submission — and no chip claiming a row.
      expect(mockSubmissionUpdates).toHaveLength(1)
      const routing = mockSubmissionUpdates[0].routing
      expect(routing.dataset).toBeUndefined()
      expect(routing.datasetRefused).toEqual({
        id: 'dataset-1',
        name: 'Leads',
        errors: { [fieldId]: expect.stringMatching(reason) },
      })
    },
  )

  it('keeps writing a dataset from before models as text, as it always did', async () => {
    // Every field of a v1 dataset is optional text: nothing to refuse.
    mockDataset = datasetDoc()
    const response = await submit({
      fields: { email: 'visitor@example.com', message: '42' },
    })
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(1)
    expect(mockDatasetRecords[0].values).toEqual({
      email: 'visitor@example.com',
      message: '42',
    })
  })
})
