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
 * The opt-in a form carries, and the one it does not.
 *
 * `upsertHostContact` has accepted `marketingConsent` since AGL-301 and would
 * stamp `marketingConsentAtMs` from it. This route passed it ZERO times, so a
 * subscribe checkbox a merchant put on their own form was collected, stored
 * as a submission field, and thrown away on the path to the contact — which
 * made it the missing INPUT for the send-time consent join
 * (`docs/specs/email-overhaul.md` §1d).
 *
 * The negative half is the more important one and is asserted as hard as the
 * positive. A form is submitted to ask a question, book a table or claim a
 * refund. Treating the fact of submission as a subscription is the exact
 * inference the consent arc refused to make, and it would be invisible: the
 * contact would simply become mailable.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
/** Every `upsertHostContact` call the route made. */
let mockContactUpserts: Record<string, any>[] = []

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
      ref: mockDocHandle(path),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = { ...(options?.merge ? (mockStore[path] ?? {}) : {}), ...patch }
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
  orgDataCollectionForHost: async () => mockCollectionHandle('orgs/org-1/datasets'),
  dataStorageRefusal: async () => null,
  // Recorded rather than executed: `upsert-contact.spec.ts` owns what the
  // write does with the flag. What matters HERE is whether this route hands
  // it over at all, which it never did.
  upsertHostContact: async (options: Record<string, any>) => {
    mockContactUpserts.push(options)
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

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockContactUpserts = []
})

describe('a declared opt-in on a form reaches the contact', () => {
  it('forwards a ticked checkbox', async () => {
    const response = await submit({
      fields: {
        email: 'visitor@example.com',
        message: 'hello',
        marketingConsent: 'true',
      },
    })
    expect(response.status).toBe(200)
    expect(mockContactUpserts).toHaveLength(1)
    expect(mockContactUpserts[0]).toMatchObject({
      email: 'visitor@example.com',
      marketingConsent: true,
    })
  })

  /** The values a browser actually posts for a checked box vary by markup. */
  it('accepts the shapes a checkbox is really submitted as', async () => {
    for (const [field, value] of [
      ['marketingConsent', 'on'],
      ['emailOptIn', 'yes'],
      ['newsletterOptIn', '1'],
      ['subscribe', 'true'],
      ['subscribe_to_newsletter', 'checked'],
    ] as const) {
      mockContactUpserts = []
      await submit({
        fields: { email: 'visitor@example.com', [field]: value },
      })
      expect(mockContactUpserts[0]?.['marketingConsent']).toBe(true)
    }
  })

  /** A caller that models the checkbox as a body field rather than a form field. */
  it('accepts a first-class body field', async () => {
    await submit({ marketingConsent: true })
    expect(mockContactUpserts[0]).toMatchObject({ marketingConsent: true })
  })
})

describe('a Checkboxes consent field posts the text of the option ticked', () => {
  const OPTION = 'Email me news and offers'
  const declared = (options: string[]) => [
    { fieldName: 'email', fieldType: 'email' },
    { fieldName: 'marketingConsent', fieldType: 'checkbox', options },
  ]
  /**
   * The two ways a bound form reads the box: named as its consent field on
   * the form's page, or, naming none, by the closed name list, where the
   * stored declaration still says what the box is.
   */
  const PATHS: Array<[string, (options: string[]) => Record<string, unknown>]> = [
    [
      'its declared consent field',
      (options) => ({ consentFieldName: 'marketingConsent', fields: declared(options) }),
    ],
    ['the closed name list', (options) => ({ fields: declared(options) })],
  ]

  describe.each(PATHS)('on a bound form, read through %s', (_path, formOf) => {
    /** Submits to form-1 with the box's value, or without the box, and returns what reached the contact. */
    const consentFor = async (value: unknown, options = [OPTION]) => {
      mockStore[`hosts/${HOST_ID}/forms/form-1`] = { displayName: 'Contact', ...formOf(options) }
      mockContactUpserts = []
      const response = await submit({
        formId: 'form-1',
        fields: {
          email: 'visitor@example.com',
          ...(value === undefined ? {} : { marketingConsent: value }),
        },
      })
      expect(response.status).toBe(200)
      expect(mockContactUpserts).toHaveLength(1)
      return mockContactUpserts[0]?.['marketingConsent']
    }

    it('forwards the opt-in when the text of its one option arrives, alone or as a list of one', async () => {
      expect(await consentFor(OPTION)).toBe(true)
      expect(await consentFor([OPTION])).toBe(true)
    })

    it('forwards nothing when that box was left unticked', async () => {
      expect(await consentFor(undefined)).toBeUndefined()
      expect(await consentFor('')).toBeUndefined()
    })

    it('forwards nothing for words that are not its option', async () => {
      expect(await consentFor('Email me news')).toBeUndefined()
    })

    it('forwards nothing for one answer of a field with several options', async () => {
      expect(await consentFor('Email', ['Email', 'Text message'])).toBeUndefined()
    })

    it('still forwards the values a box with no text of its own posts', async () => {
      for (const value of ['true', 'on', 'yes', '1', 'checked']) {
        expect(await consentFor(value)).toBe(true)
      }
    })
  })

  it('forwards nothing when an unbound form posts the option text, which only a stored declaration makes a tick', async () => {
    await submit({ fields: { email: 'visitor@example.com', marketingConsent: OPTION } })
    expect(mockContactUpserts).toHaveLength(1)
    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
  })
})

describe('⛔ submitting a form is not opting in', () => {
  /**
   * THE CONTROL, and the assertion that matters most. A route that forwarded
   * unconditionally would pass every case above and quietly make every person
   * who ever filled in a form mailable.
   */
  it('forwards nothing when the form carries no opt-in field', async () => {
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockContactUpserts).toHaveLength(1)
    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
  })

  it('forwards nothing for an unticked box', async () => {
    await submit({
      fields: {
        email: 'visitor@example.com',
        marketingConsent: 'false',
      },
    })
    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
  })

  /**
   * The name list is closed rather than a substring match on "consent". A
   * clinic intake form's `consentToTreatment` is a different legal instrument
   * entirely, and matching it would manufacture a marketing basis out of a
   * medical one.
   */
  it('does not read an unrelated consent field as marketing consent', async () => {
    await submit({
      fields: {
        email: 'visitor@example.com',
        consentToTreatment: 'true',
        privacyPolicyConsent: 'true',
      },
    })
    expect(mockContactUpserts[0]).not.toHaveProperty('marketingConsent')
  })
})
