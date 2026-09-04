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
 * The campaign a form submission carries, and where the route takes it.
 *
 * Three claims, and the third is the one that costs money when it is wrong:
 *
 *  1. the wire value the browser sent reaches the resolver, unread by the
 *     route — the route never parses a campaign label itself, so there is one
 *     allowlist and it cannot be bypassed by a door;
 *  2. the resolve happens ONCE and its answer is handed to every writer, so
 *     the submission, the contact and the lead cannot name three different
 *     campaigns, and the email-channel lookup is one keyed read rather than
 *     three; and
 *  3. a submission with NO campaign hands nothing on. Not an empty object,
 *     not a placeholder — a contact upsert carrying `campaignTouch: null`
 *     would be a door reporting a campaign it does not have, and would make
 *     every organic conversion look attributable.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
let mockContactUpserts: Record<string, any>[] = []
let mockLeads: Record<string, any>[] = []
/** Every `resolveCampaignTouch` call the route made, in order. */
let mockResolves: Record<string, any>[] = []
/** Every `attributeCampaignConversion` call the route made. */
let mockConversions: Record<string, any>[] = []
/** What the stubbed resolver answers for this case. */
let mockResolved: Record<string, any> | null = null

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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  resolveCampaignTouch: async (options: Record<string, any>) => {
    mockResolves.push(options)
    return mockResolved
  },
  attributeCampaignConversion: async (options: Record<string, any>) => {
    mockConversions.push(options)
    return null
  },
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
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

import { POST } from '../app/api/forms/submit/route'

const WIRE = 'utm_source=google&utm_campaign=sept-launch&t=1700000000000'

const TOUCH = {
  channel: 'web',
  source: 'google',
  campaign: 'sept-launch',
  touchedAtMs: 1_700_000_000_000,
}

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
})

describe('a submission that carries a campaign', () => {
  beforeEach(() => {
    mockResolved = TOUCH
  })

  it('hands the wire value and the address to the resolver, unparsed', async () => {
    expect((await submit({ campaignTouch: WIRE })).status).toBe(200)

    expect(mockResolves).toHaveLength(1)
    expect(mockResolves[0]).toMatchObject({
      hostId: HOST_ID,
      wire: WIRE,
      email: 'visitor@example.com',
    })
  })

  it('credits the SUBMISSION, naming the submission it credits', async () => {
    await submit({ campaignTouch: WIRE })

    expect(mockConversions).toHaveLength(1)
    expect(mockConversions[0]).toMatchObject({
      hostId: HOST_ID,
      kind: 'form',
      refId: 'submission-1',
      touch: TOUCH,
    })
  })

  it('hands the SAME resolved touch to the contact', async () => {
    await submit({ campaignTouch: WIRE })

    expect(mockContactUpserts[0].campaignTouch).toBe(TOUCH)
  })

  it('hands the SAME resolved touch to the lead', async () => {
    mockStore[`hosts/${HOST_ID}/forms/f1`] = {
      displayName: 'Contact',
      routing: { lead: true },
    }

    await submit({ campaignTouch: WIRE, formId: 'f1' })

    expect(mockLeads).toHaveLength(1)
    expect(mockLeads[0].touch).toBe(TOUCH)
  })

  it('resolves ONCE for the whole submission', async () => {
    mockStore[`hosts/${HOST_ID}/forms/f1`] = {
      displayName: 'Contact',
      routing: { lead: true },
    }

    await submit({ campaignTouch: WIRE, formId: 'f1' })

    // Three records, one lookup. Resolving per writer would put three keyed
    // Firestore reads on every form submission on the platform, and would let
    // the three disagree if a touch aged out between them.
    expect(mockResolves).toHaveLength(1)
  })

  it('credits an ANONYMOUS submission too', async () => {
    // A form that asks for a message and no address is still a form a
    // campaign caused somebody to fill in. Refusing to count it would
    // under-report exactly the forms that ask for the least.
    await submit({ campaignTouch: WIRE, fields: { message: 'hello' } })

    expect(mockConversions[0]).toMatchObject({ kind: 'form' })
    // No address to join the email channel on, so the resolver is handed
    // nothing usable and answers from the web channel alone.
    expect(mockResolves[0].email).toBeFalsy()
  })
})

describe('a submission with no campaign', () => {
  it('still asks, and is credited to nothing', async () => {
    expect((await submit()).status).toBe(200)

    expect(mockResolves[0].wire).toBeUndefined()
    expect(mockConversions[0].touch).toBe(null)
  })

  it('hands NO touch field to the contact', async () => {
    await submit()

    // Not `campaignTouch: null`. A writer that received the key would be
    // being told about a campaign, and the shape a direct conversion takes on
    // the way in has to be the same absence it takes on the way out.
    expect(mockContactUpserts[0]).not.toHaveProperty('campaignTouch')
  })

  it('hands NO touch field to the lead', async () => {
    mockStore[`hosts/${HOST_ID}/forms/f1`] = {
      displayName: 'Contact',
      routing: { lead: true },
    }

    await submit({ formId: 'f1' })

    expect(mockLeads[0]).not.toHaveProperty('touch')
  })
})
