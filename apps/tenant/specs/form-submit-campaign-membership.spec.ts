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
 * A FORM'S CAMPAIGN REACHES THE PERSON IT CAPTURES.
 *
 * The defect: an owner files three forms under a campaign, and the contacts
 * those forms produce belong to no campaign at all. The console wrote the
 * form's membership and nothing carried it any further, so the assignment was
 * a label on the form rather than a fact about the people who used it.
 *
 * Four claims:
 *
 *  1. the submission carries the form's campaigns, off the VERIFIED form —
 *     a membership taken from the request body would let anyone file people
 *     into any campaign on any site;
 *  2. the CONTACT carries them too, which is what an audience is built from;
 *  3. the campaign a form is FILED UNDER and the campaign a visitor was
 *     ATTRIBUTED to are different facts, and neither writes the other's
 *     field — one says which push this form belongs to, the other says which
 *     ad brought this person; and
 *  4. ⛔ neither one is consent. Filing a form under a campaign is the
 *     merchant's own act and says nothing about what the person agreed to.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
let mockContactUpserts: Record<string, any>[] = []
let mockLeads: Record<string, any>[] = []
/** Every document added to a collection, by collection path. */
let mockAdded: Record<string, Record<string, any>[]> = {}
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
  add: async (value: Record<string, any>) => {
    mockAdded[path] = [...(mockAdded[path] ?? []), value]
    return { id: 'submission-1', update: async () => undefined }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  resolveCampaignTouch: async () => mockResolved,
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
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () =>
    mockCollectionHandle('orgs/org-1/datasets'),
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

const SPRING = 'camp_spring'
const SUMMER = 'camp_summer'

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
        path: '/spring-offer',
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...body,
      }),
    }),
  ) as Promise<Response>

/** The one submission this route stored. */
const submission = () => mockAdded[`hosts/${HOST_ID}/formSubmissions`]?.[0]

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockContactUpserts = []
  mockLeads = []
  mockAdded = {}
  mockResolved = null
})

/** A form on this site, filed under the campaigns given. */
const seedForm = (id: string, campaignIds?: string[]) => {
  mockStore[`hosts/${HOST_ID}/forms/${id}`] = {
    displayName: 'Spring signup',
    ...(campaignIds ? { campaignIds } : {}),
  }
}

describe('a form filed under a campaign files the people it captures', () => {
  it('stamps the form’s campaigns onto the submission', async () => {
    seedForm('f1', [SPRING, SUMMER])
    expect((await submit({ formId: 'f1' })).status).toBe(200)

    expect(submission()).toMatchObject({
      formId: 'f1',
      campaignIds: [SPRING, SUMMER],
    })
  })

  it('files the CONTACT under the same campaigns', async () => {
    seedForm('f1', [SPRING])
    await submit({ formId: 'f1' })

    expect(mockContactUpserts).toHaveLength(1)
    expect(mockContactUpserts[0].campaignIds).toEqual([SPRING])
  })

  /*
   * ⛔ READ AND VERIFIED, never trusted. `campaignIds` arrives from the FORM
   * document, never from the body — a public, unauthenticated endpoint that
   * stamped a caller's list would let anyone file people into any campaign on
   * any site, which is precisely the surface the verified `formId` exists to
   * make correct.
   */
  it('ignores a campaign the request body asked for', async () => {
    seedForm('f1', [SPRING])
    await submit({ formId: 'f1', campaignIds: ['camp_injected'] })

    expect(submission()['campaignIds']).toEqual([SPRING])
    expect(mockContactUpserts[0].campaignIds).toEqual([SPRING])
  })

  it('takes nothing from a form id that names no form on this site', async () => {
    await submit({ formId: 'not-a-form', campaignIds: ['camp_injected'] })

    expect(submission()).not.toHaveProperty('campaignIds')
    expect(mockContactUpserts[0]).not.toHaveProperty('campaignIds')
  })

  /*
   * An absent field rather than an empty array: these rows are unbounded and
   * billed, and a key written on every one of them to say "no campaign" is a
   * field per submission forever for a fact its absence already states.
   */
  it('writes no key at all for a form in no campaign', async () => {
    seedForm('f1')
    await submit({ formId: 'f1' })

    expect(submission()).not.toHaveProperty('campaignIds')
    expect(mockContactUpserts[0]).not.toHaveProperty('campaignIds')
  })
})

describe('the campaign a form is IN, and the campaign a visitor came FROM', () => {
  /*
   * Two different facts about two different acts. The membership is true of
   * everybody who fills the form in, including somebody who arrived by typing
   * the address; the touch is true of one visitor's browser. Folding them
   * together would answer neither question, and letting one write the other's
   * field would make an organic capture look attributed — or an attributed
   * one look filed.
   */
  it('carries both, in their own fields, without either overwriting the other', async () => {
    seedForm('f1', [SPRING])
    mockResolved = TOUCH
    await submit({ formId: 'f1', campaignTouch: 'utm_campaign=sept-launch' })

    expect(mockContactUpserts[0].campaignIds).toEqual([SPRING])
    expect(mockContactUpserts[0].campaignTouch).toBe(TOUCH)
  })

  it('files a person a campaign never touched', async () => {
    seedForm('f1', [SPRING])
    // Direct traffic: no touch resolves, and the form's own membership is
    // unaffected by that.
    await submit({ formId: 'f1' })

    expect(mockContactUpserts[0].campaignIds).toEqual([SPRING])
    expect(mockContactUpserts[0]).not.toHaveProperty('campaignTouch')
  })

  /**
   * ⛔ NEITHER IS AN OPT-IN. A form is filled in to ask a question or claim an
   * offer, and a merchant filing that form under a campaign is the merchant's
   * own act. A route that inferred a basis from either would manufacture
   * consent out of its own bookkeeping.
   */
  it('records no marketing consent from a campaign', async () => {
    seedForm('f1', [SPRING])
    mockResolved = TOUCH
    await submit({ formId: 'f1', campaignTouch: 'utm_campaign=sept-launch' })

    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
    expect(mockLeads).toHaveLength(0)
  })
})

describe('the entry point reaches the contact’s own timeline', () => {
  /*
   * `sources` records that SOME form produced this contact — every form on
   * the site sets the same flag — so the interaction is where "which form,
   * which page" can be answered without reading the submission back once per
   * row of a rendered timeline.
   */
  it('names the form and the page on the interaction', async () => {
    seedForm('f1', [SPRING])
    await submit({ formId: 'f1' })

    expect(mockContactUpserts[0].interaction).toMatchObject({
      refId: 'submission-1',
      formId: 'f1',
      path: '/spring-offer',
    })
  })

  it('names no form when the id matched none on this site', async () => {
    // The same rule the submission's own `formId` follows: an unverified id
    // never reaches a stored row.
    await submit({ formId: 'not-a-form' })

    expect(mockContactUpserts[0].interaction).not.toHaveProperty('formId')
    expect(mockContactUpserts[0].interaction.path).toBe('/spring-offer')
  })

  it('leaves the page out when the submission carried none', async () => {
    await submit({ path: '' })

    expect(mockContactUpserts[0].interaction).not.toHaveProperty('path')
  })
})
