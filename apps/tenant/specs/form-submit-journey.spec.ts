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
 * The recorded visit a form submission ends (AGL-3605), and where the route
 * takes it: beside the submitter on the `formSubmission` event's context, so
 * the plugin that keeps visits can tie that visit to the person — and never
 * into the payload an automation reads, and never in a shape the visit
 * recorder does not mint.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
let mockContactUpserts: Record<string, any>[] = []
let mockLeads: Record<string, any>[] = []
/** Every `resolveConversionTouch` call the route made, in order. */
let mockResolves: Record<string, any>[] = []
/** Every `creditConversion` call the route made. */
let mockConversions: Record<string, any>[] = []
/** What the stubbed resolver answers for this case. */
let mockResolved: Record<string, any> | null = null
/** Every host event the route raised, with its context. */
let mockEmitted: Array<{ event: string; payload: Record<string, any>; context: Record<string, any> }> = []

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
      id: path.split('/').pop(),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = { ...(options?.merge ? (mockStore[path] ?? {}) : {}), ...patch }
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async () => ({ id: 'submission-1', update: async () => undefined }),
})

/*
 * The crediting plugin, asked through the platform's contract
 * (`plugin-conversion-credit`): recorded rather than executed, because what a
 * credit writes is that plugin's own spec's claim. The constant the touch
 * rides under in a capture's `detail` is the real one.
 */
jest.mock('@aglyn/aglyn/plugin-manager/plugin-conversion-credit', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-conversion-credit'),
  resolveConversionTouch: async (options: Record<string, any>) => {
    mockResolves.push(options)
    return mockResolved
  },
  creditConversion: async (options: Record<string, any>) => {
    mockConversions.push(options)
    return false
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  /*
   * The lead lookup the CRM's capture door runs (AGL-3275). These files drive
   * a form submission end to end, so the door is real and its seam has to
   * answer; what they assert is the CAMPAIGN and consent bookkeeping, and no
   * case here starts with a lead already on file.
   */
  readLeadForHost: async () => null,
  // The CRM's capture writer asks whether the workspace already holds the
  // address as a contact before it files a lead (AGL-3232). Nobody, here.
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
  // The CRM's form door asks for the outcome, to count the lead (AGL-3330).
  addHostLeadOutcome: async (options: Record<string, any>) => {
    mockLeads.push(options)
    return { stored: true, created: true, sourceAdded: true }
  },
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
  emitHostEvent: async (_hostId: string, event: string, payload: Record<string, any>, context: Record<string, any>) => {
    mockEmitted.push({ event, payload, context })
    return { alerts: [] }
  },
  resolveDatasetDoc: async () => null,
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
/*
 * The `lead` host event a NEW lead announces itself with (AGL-3232), by the
 * leaf the CRM's writer imports it from. Recorded as nothing: what a lead
 * sets off is the automation engine's own spec.
 */
jest.mock('@aglyn/tenant-runtime/emit-host-event', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
}))

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
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockContactUpserts = []
  mockLeads = []
  mockResolves = []
  mockConversions = []
  mockResolved = null
  mockEmitted = []
})

const VISIT = 'abcdefghijklmnopqrstuv'

const submitted = () => mockEmitted.find((one) => one.event === 'formSubmission')

describe('a submission from a recorded visit', () => {
  it('names the visit on the event’s context, beside the submitter, and not in the payload', async () => {
    expect((await submit({ journey: VISIT })).status).toBe(200)
    expect(submitted()?.context).toEqual({
      actor: { kind: 'visitor', email: 'visitor@example.com' },
      journeyId: VISIT,
    })
    expect(submitted()?.payload).not.toHaveProperty('journey')
    expect(submitted()?.payload).not.toHaveProperty('journeyId')
  })

  it.each([
    ['no visit', undefined],
    ['a value the recorder never mints', 'not-a-visit'],
    ['a visit id of the wrong length', 'a'.repeat(23)],
  ])('names no visit for %s', async (_case, journey) => {
    await submit(journey === undefined ? {} : { journey })
    expect(submitted()?.context).toEqual({ actor: { kind: 'visitor', email: 'visitor@example.com' } })
  })
})
