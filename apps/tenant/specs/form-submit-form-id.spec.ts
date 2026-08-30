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
 * A submission carries the id of the form it was sent to.
 *
 * The identity a form had before this was `formName` — the caption an author
 * typed into an inspector field. Renaming a form split its submission history
 * in two, and two pages sharing a label had always been one list. Neither is
 * a bug in any single surface: `?form=Contact` filters on exactly what was
 * recorded. The recorded thing was a caption.
 *
 * The two assertions that carry the feature are the rename (history must not
 * split) and the refusal to trust the id a public body sent.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
/** Every document the route added, by collection path. */
let mockAdds: Array<{ path: string; data: Record<string, any> }> = []
/** Every `update` the route issued, by document path. */
let mockUpdates: Array<{ path: string; patch: Record<string, any> }> = []
let mockContactUpserts: Record<string, any>[] = []
/** Every `addHostLead` call the route made. */
let mockLeads: Record<string, any>[] = []

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
    mockStore[path] = {
      ...(options?.merge ? (mockStore[path] ?? {}) : {}),
      ...patch,
    }
  },
  update: async (patch: Record<string, any>) => {
    // Mirrors Firestore: `update` on a missing document REJECTS. The stats
    // write depends on that — it is what stops a stale page resurrecting a
    // deleted form as a stats-only stray doc.
    if (mockStore[path] === undefined) throw new Error('NOT_FOUND')
    mockUpdates.push({ path, patch })
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
  // The attribution seam the route resolves once per submission. Recorded
  // rather than executed — `campaign-conversion-attribution.spec.ts` owns
  // what the write does — and defined here at all because a mocked module
  // answers `undefined` for a name it does not list, which would make the
  // route throw rather than fail an assertion.
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
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () =>
    mockCollectionHandle('orgs/org-1/datasets'),
  dataStorageRefusal: async () => null,
  upsertHostContact: async (options: Record<string, any>) => {
    mockContactUpserts.push(options)
  },
  // Recorded rather than executed. `host-lead-dedupe.spec.ts` owns what the
  // writer does with a capture; what matters HERE is whether this route hands
  // one over at all, which it never did.
  addHostLead: async (options: Record<string, any>) => {
    mockLeads.push(options)
  },
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
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
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...body,
      }),
    }),
  ) as Promise<Response>

/** The one submission the route wrote. */
const written = () =>
  mockAdds.find((add) => add.path === `hosts/${HOST_ID}/formSubmissions`)?.data

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockAdds = []
  mockUpdates = []
  mockContactUpserts = []
  mockLeads = []
})

describe('a submission is stamped with the form it was sent to', () => {
  beforeEach(() => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      slug: 'contact',
      fields: [{ fieldName: 'email', fieldType: 'email' }],
    }
  })

  it('stamps `formId` when the form exists', async () => {
    await submit({ formId: 'form-1' })
    expect(written()?.['formId']).toBe('form-1')
  })

  it('keeps writing `formName` beside it', async () => {
    // The pre-entity `?form=` filter reads this field and nothing in this
    // work removes it — an unadopted form must keep filtering exactly as it
    // did, and a `formId` that replaced the caption would break it.
    await submit({ formId: 'form-1' })
    expect(written()?.['formName']).toBe('Contact')
  })

  it('does NOT split history when the form is renamed', async () => {
    // THE assertion. The same form, submitted to before and after a rename,
    // must file both rows under one id. Under the caption alone these two
    // rows are two different forms, which is the defect.
    await submit({ formId: 'form-1' })
    const beforeRename = written()

    mockAdds = []
    mockStore[`hosts/${HOST_ID}/forms/form-1`]['displayName'] = 'Talk to us'
    await submit({ formId: 'form-1', formName: 'Talk to us' })
    const afterRename = written()

    // Asserted as a VALUE, not as an equality between two reads. `toBe`
    // alone passes when both sides are `undefined`, which is exactly the
    // state a route that stamps nothing produces — the assertion would then
    // be green on the bug it exists to catch.
    expect(beforeRename?.['formId']).toBe('form-1')
    expect(afterRename?.['formId']).toBe('form-1')
    // And the caption really did move underneath it, so the rows are only
    // held together by the id.
    expect(beforeRename?.['formName']).toBe('Contact')
    expect(afterRename?.['formName']).toBe('Talk to us')
  })

  it('follows the form\'s display name rather than the caption the page sent', async () => {
    // A stale cached page keeps sending the old caption. The row is filed
    // under the form's current name so the Inbox label does not go stale.
    await submit({ formId: 'form-1', formName: 'Stale caption' })
    expect(written()?.['formName']).toBe('Contact')
  })

  it('increments the form\'s own counter instead of counting the collection', async () => {
    await submit({ formId: 'form-1' })
    const stats = mockUpdates.find((update) =>
      update.path.endsWith('forms/form-1'),
    )
    expect(stats?.patch['stats.submissions']).toEqual({ __increment: 1 })
    expect(typeof stats?.patch['stats.lastSubmissionAtMs']).toBe('number')
  })
})

describe('the id in a public body is verified, never trusted', () => {
  it('refuses to stamp a form that does not exist on this site', async () => {
    // This endpoint is public and unauthenticated. Stamping an unverified id
    // would let anyone file rows into any form's list — the per-form list is
    // the surface the id exists to make correct, and an unverified id makes
    // it wrong in a way that looks right.
    await submit({ formId: 'not-a-form' })
    expect(written()).toBeDefined()
    expect(written()).not.toHaveProperty('formId')
  })

  it('still stores the submission when the id is bogus', async () => {
    // A lost lead is the worse error. An unrecognized id degrades to an
    // unstamped row, never to a refusal.
    const response = await submit({ formId: 'not-a-form' })
    expect(response.status).toBe(200)
    expect(written()?.['fields']).toEqual({
      email: 'visitor@example.com',
      message: 'hello',
    })
  })

  it('writes no `formId` at all for an unbound form', async () => {
    await submit()
    expect(written()).not.toHaveProperty('formId')
  })

  it('does not resurrect a deleted form as a stats-only document', async () => {
    // The `overlays` stats rule, one collection over: the write is an
    // `update`, so a beacon from a stale cached page finds nothing to update
    // rather than creating a stray.
    await submit({ formId: 'not-a-form' })
    expect(mockStore[`hosts/${HOST_ID}/forms/not-a-form`]).toBeUndefined()
  })
})

describe('consent comes from the field the form declares', () => {
  it('reads the declared field under whatever name the author gave it', async () => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      consentFieldName: 'keepMePosted',
    }
    await submit({
      formId: 'form-1',
      fields: { email: 'visitor@example.com', keepMePosted: 'on' },
    })
    expect(mockContactUpserts[0]?.['marketingConsent']).toBe(true)
  })

  it('records nothing when the declared box was left unticked', async () => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      consentFieldName: 'keepMePosted',
    }
    await submit({
      formId: 'form-1',
      fields: { email: 'visitor@example.com', keepMePosted: '' },
    })
    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
  })

  it('⛔ never treats the fact of submission as an opt-in', async () => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      consentFieldName: 'keepMePosted',
    }
    await submit({
      formId: 'form-1',
      fields: { email: 'visitor@example.com', message: 'do you deliver?' },
    })
    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
  })

  it('keeps capturing consent for a bound form that declares no consent field', async () => {
    // Adoption must not be the moment a form that WAS capturing opt-ins
    // stops. A bound form with no declaration falls through to the closed
    // name list the route already used, so consent is carried forward rather
    // than dropped as a side effect of the migration.
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = { displayName: 'Contact' }
    await submit({
      formId: 'form-1',
      fields: { email: 'visitor@example.com', marketingConsent: 'true' },
    })
    expect(mockContactUpserts[0]?.['marketingConsent']).toBe(true)
  })
})

describe('a lead-capture form finally captures a lead', () => {
  it('creates a lead when the form declares one', async () => {
    // The endpoint has called itself a "lead-capture submissions endpoint"
    // since AGL-76 and had never created a lead: `addHostLead`'s callers were
    // the sign-up handler and the two bookings paths, and this route was not
    // among them.
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      routing: { lead: true },
    }
    await submit({ formId: 'form-1' })
    expect(mockLeads).toHaveLength(1)
    expect(mockLeads[0]?.['lead']).toMatchObject({
      email: 'visitor@example.com',
      source: 'form:form-1',
    })
  })

  it('does NOT create one when the form does not declare it', async () => {
    // An author's declaration, not a heuristic on the payload. A form is
    // submitted to ask a question or claim a refund, and every one of those
    // becoming a lead is the inference this refuses.
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = { displayName: 'Contact' }
    await submit({ formId: 'form-1' })
    expect(mockLeads).toEqual([])
  })

  it('creates none for an unbound form, whatever it collected', async () => {
    await submit()
    expect(mockLeads).toEqual([])
  })

  it('creates none when the submission carries no address', async () => {
    // A lead with no address is unusable. Nothing to key it on, nothing to
    // do with it.
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Survey',
      routing: { lead: true },
    }
    await submit({ formId: 'form-1', fields: { q1: 'blue' } })
    expect(mockLeads).toEqual([])
  })

  it('carries a declared opt-in onto the lead', async () => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      consentFieldName: 'keepMePosted',
      routing: { lead: true },
    }
    await submit({
      formId: 'form-1',
      fields: { email: 'visitor@example.com', keepMePosted: 'on' },
    })
    expect(mockLeads[0]?.['lead']?.['marketingConsent']).toBe(true)
  })

  it('⛔ never treats the submission itself as an opt-in', async () => {
    mockStore[`hosts/${HOST_ID}/forms/form-1`] = {
      displayName: 'Contact',
      consentFieldName: 'keepMePosted',
      routing: { lead: true },
    }
    await submit({ formId: 'form-1' })
    expect(mockLeads[0]?.['lead']).not.toHaveProperty('marketingConsent')
  })
})
