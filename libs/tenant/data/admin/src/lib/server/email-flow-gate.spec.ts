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
 * The two gates a flow email owes that an immediate reply does not.
 *
 * The answers have to be the SAME ones a campaign to the same person would
 * get, which is why the real consent resolver and the real topic filter are
 * exercised here rather than described a second time.
 */

/** The person's record in `contacts`, or null for an address with none. */
let contact: Record<string, any> | null = null
/** The person's record in `leads`, consulted only when `contacts` misses. */
let lead: Record<string, any> | null = null
/** Which silos were queried, so the fallback order is an assertion. */
let silosRead: string[] = []
/** Topics this address has left, by topic id. */
let topicsLeft: Record<string, any> = {}
/** Make the topic lookup throw, for the fail-open case. */
let topicLookupThrows = false

const singleDocQuery = (
  row: Record<string, any> | null,
  silo: string,
): any => ({
  where: () => singleDocQuery(row, silo),
  limit: () => singleDocQuery(row, silo),
  get: async () => {
    silosRead.push(silo)
    return {
      empty: row === null,
      docs:
        row === null ? [] : [{ data: () => row, get: (f: string) => row[f] }],
    }
  },
})

const firestore: any = {
  collection: (name: string) => ({
    doc: () => ({
      collection: (sub: string) =>
        sub === 'leads'
          ? singleDocQuery(lead, 'leads')
          : { doc: (id: string) => ({ path: `${name}/${sub}/${id}` }) },
    }),
  }),
  getAll: async (...refs: any[]) => {
    if (topicLookupThrows) throw new Error('topic lookup unavailable')
    return refs.map(() =>
      Object.keys(topicsLeft).length
        ? { exists: true, get: (field: string) => topicsLeft[field] }
        : { exists: false, get: () => undefined },
    )
  },
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => firestore }) },
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))

jest.mock('./organizations', () => ({
  __esModule: true,
  orgDataQueryForHost: async () => ({
    ref: {},
    query: singleDocQuery(contact, 'contacts'),
  }),
}))

import { marketingConsentFieldsForHost } from '@aglyn/aglyn/server'
import { flowEmailRefusal } from './email-flow-gate'

const HOST = 'site-1'
const EMAIL = 'buyer@example.com'
/**
 * The org's stored policy. `strict` is the DEFAULT, so an org that has never
 * touched the setting gets it — which is why the cases below name `forward`
 * explicitly when they want the grandfathering half.
 */
const STRICT = { marketingConsentPolicy: { mode: 'strict' } }
const FORWARD = { marketingConsentPolicy: { mode: 'forward' } }

/**
 * A person record whose basis is recorded against ONE site.
 *
 * Written through the shipped writer rather than by hand, so a spec that
 * calls somebody consented is asserting the shape the capture doors actually
 * produce.
 */
const grantedTo = (hostId: string) =>
  marketingConsentFieldsForHost(hostId, Date.now())

beforeEach(() => {
  contact = null
  lead = null
  silosRead = []
  topicsLeft = {}
  topicLookupThrows = false
})

describe('the consent split, applied to one person', () => {
  it('lets a granted basis through', async () => {
    contact = { email: EMAIL, ...grantedTo(HOST) }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: STRICT,
        firestore,
      }),
    ).toBeNull()
  })

  /**
   * The leak, at the automation gate. A workflow step running on one site
   * must not mail somebody on a basis they gave to a sister brand — the same
   * rule the campaign path applies, asserted here because this gate is a
   * second door into the same audience.
   */
  it('REFUSES a basis given to a DIFFERENT site in the same account', async () => {
    contact = { email: EMAIL, ...grantedTo('site-2') }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: STRICT,
        firestore,
      }),
    ).toBe('consent-withheld')
  })

  it('REFUSES a recorded opt-out, under any policy', async () => {
    // A refusal is the one thing no policy may mail. Not a mode, not a date —
    // the person said no.
    contact = { email: EMAIL, marketingConsent: false }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
      }),
    ).toBe('consent-withheld')
  })

  it('REFUSES an address with no record at all, which is the default', async () => {
    // `strict` is what an org that has never touched the setting has, so an
    // address nothing recorded a basis for is not mailable by a flow — the
    // same answer a campaign to that address gets.
    contact = null
    lead = null

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
      }),
    ).toBe('consent-withheld')
  })

  it('grandfathers an unrecorded address for an org on the forward policy', async () => {
    // The policy is the ORG's and a flow must not be the one path that
    // decides otherwise on its own — in either direction.
    contact = null
    lead = null

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: FORWARD,
        firestore,
      }),
    ).toBeNull()
  })

  it('falls back to the lead silo when there is no contact', async () => {
    // A welcome series fires on a sign-up that may not have produced a
    // contact yet, so reading contacts alone would refuse the very audience
    // the feature exists for.
    contact = null
    lead = { email: EMAIL, ...grantedTo(HOST) }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: STRICT,
        firestore,
      }),
    ).toBeNull()
    expect(silosRead).toEqual(['contacts', 'leads'])
  })

  it('does not pay for the lead read when the contact answered', async () => {
    contact = { email: EMAIL, ...grantedTo(HOST) }

    await flowEmailRefusal({
      hostId: HOST,
      email: EMAIL,
      org: STRICT,
      firestore,
    })

    expect(silosRead).toEqual(['contacts'])
  })

  it('refuses an empty address without reading anything', async () => {
    expect(
      await flowEmailRefusal({ hostId: HOST, email: '  ', org: {}, firestore }),
    ).toBe('consent-withheld')
    expect(silosRead).toEqual([])
  })
})

describe('the topic filter, after the consent split', () => {
  it('REFUSES somebody who has left the stream', async () => {
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicsLeft = { topics: { promotions: { optedOutAt: 1 } } }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        topicId: 'promotions',
        org: {},
        firestore,
      }),
    ).toBe('topic-unsubscribed')
  })

  it('lets them back in once they resubscribe', async () => {
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicsLeft = {
      topics: { promotions: { optedOutAt: 1, resubscribedAt: 2 } },
    }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        topicId: 'promotions',
        org: {},
        firestore,
      }),
    ).toBeNull()
  })

  it('does not refuse for a DIFFERENT stream they left', async () => {
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicsLeft = { topics: { productNews: { optedOutAt: 1 } } }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        topicId: 'promotions',
        org: {},
        firestore,
      }),
    ).toBeNull()
  })

  it('resolves a step with no topic to the default stream', async () => {
    // A step authored before topics reached the editor still belongs to some
    // stream — the same one a campaign with no topic mints its links for.
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicsLeft = { topics: { marketing: { optedOutAt: 1 } } }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
      }),
    ).toBe('topic-unsubscribed')
  })

  it('is never reached for somebody the consent rule already refused', async () => {
    // The weaker fact must never be the one that decides, and asking about a
    // topic preference is a read taken on a question already answered.
    contact = { email: EMAIL, marketingConsent: false }
    topicsLeft = { topics: { promotions: { optedOutAt: 1 } } }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        topicId: 'promotions',
        org: {},
        firestore,
      }),
    ).toBe('consent-withheld')
  })

  it('fails OPEN when the topic lookup itself breaks', async () => {
    // The asymmetry with consent above: refusing a newsletter somebody asked
    // for, over a read that failed for an unrelated reason, is the worse
    // error — and both suppression lists have already run one layer down.
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicLookupThrows = true

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        topicId: 'promotions',
        org: {},
        firestore,
      }),
    ).toBeNull()
  })
})
