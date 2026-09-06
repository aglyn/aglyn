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
/** `orgs/{org}/emailIndex/{personKey}` → `{ email, contactId }` (AGL-2625). */
let emailIndex: Record<string, Record<string, any>> = {}

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

/**
 * The contact as the org's collection holds it. A row the scoped query
 * used to answer was visible to the site by construction; the lookup now
 * checks `visibleTo` itself, so the default here is the org-wide stamp and
 * a case that wants a sibling site's row says so.
 */
const contactRow = () =>
  contact === null ? null : { visibleTo: ['org'], ...contact }

const contactSnapshot = (row: Record<string, any> | null) => ({
  id: 'contact-1',
  exists: row !== null,
  data: () => row ?? undefined,
  get: (f: string) => row?.[f],
})

const emailIndexRef: any = {
  doc: (key: string) => ({
    get: async () => ({
      exists: Boolean(emailIndex[key]),
      get: (f: string) => emailIndex[key]?.[f],
    }),
    set: async (value: Record<string, any>) => {
      emailIndex[key] = { ...(emailIndex[key] ?? {}), ...value }
    },
  }),
}

/** The org's contacts collection: matched on the address, as the real query is. */
const contactsRef: any = {
  parent: {
    collection: (name: string) => (name === 'emailIndex' ? emailIndexRef : contactsRef),
  },
  doc: (id: string) => ({
    get: async () => contactSnapshot(id === 'contact-1' ? contactRow() : null),
  }),
  where: (field: string, _op: string, value: unknown) => ({
    limit: () => ({
      get: async () => {
        silosRead.push('contacts')
        const row = contactRow()
        const hit = row !== null && row[field] === value ? row : null
        return { empty: hit === null, docs: hit === null ? [] : [contactSnapshot(hit)] }
      },
    }),
  }),
}

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
    ref: contactsRef,
    query: singleDocQuery(contact, 'contacts'),
  }),
}))

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
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
  emailIndex = {}
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

  /*==========================================
   * THE IMMEDIATE SCOPE — a reply to the recipient's own act.
   *
   * Two directions, and both have to hold or the change is a defect either
   * way. It must refuse the person who SAID no, because the address in the
   * payload was typed by whoever filled in the form. It must not refuse the
   * person nobody has a record for, because under the default `strict` mode
   * that is every first-time visitor, and refusing them would take out the
   * auto-response on almost every site.
   *=========================================*/
  it('REFUSES an immediate reply to somebody who declined', async () => {
    contact = { email: EMAIL, marketingConsent: false }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
        scope: 'immediate',
      }),
    ).toBe('consent-withheld')
  })

  it('ALLOWS an immediate reply to an address with no record, under the default policy', async () => {
    // ⛔ The control. `strict` is the default, and it withholds an unrecorded
    // address — so a scope that took the full split would refuse the reply to
    // every new visitor. The assertion below is what fails if this is ever
    // widened to the scheduled question.
    contact = null
    lead = null

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
        scope: 'immediate',
      }),
    ).toBeNull()
  })

  it('ALLOWS an immediate reply on a basis given to a different site', async () => {
    // The same control at one remove: `other-host` is a statement about
    // capture history, not the person saying no.
    contact = { email: EMAIL, ...grantedTo('site-2') }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: STRICT,
        firestore,
        scope: 'immediate',
      }),
    ).toBeNull()
  })

  it('still REFUSES a scheduled step for the same unrecorded address', async () => {
    // The scope is the only difference, so the two assertions together are
    // what prove it is doing something rather than nothing.
    contact = null
    lead = null

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
        scope: 'scheduled',
      }),
    ).toBe('consent-withheld')
  })

  it('finds the basis on the survivor when the address is one a merge folded in (AGL-2633)', async () => {
    // The person consented under the personal address, then the two
    // records were merged with the work address kept. The index is what
    // still connects the personal address to the surviving record.
    contact = {
      email: 'buyer@work.example.com',
      alternateEmails: [EMAIL],
      ...grantedTo(HOST),
    }
    emailIndex[personKey(EMAIL)!] = { email: EMAIL, contactId: 'contact-1' }

    expect(
      await flowEmailRefusal({ hostId: HOST, email: EMAIL, org: STRICT, firestore }),
    ).toBeNull()
    // The index answered; neither the contacts query nor the lead silo ran.
    expect(silosRead).toEqual([])
  })

  it('REFUSES when the survivor an alternate names belongs to a sibling site', async () => {
    contact = {
      email: 'buyer@work.example.com',
      alternateEmails: [EMAIL],
      visibleTo: ['host:site-2'],
      ...grantedTo(HOST),
    }
    emailIndex[personKey(EMAIL)!] = { email: EMAIL, contactId: 'contact-1' }

    expect(
      await flowEmailRefusal({ hostId: HOST, email: EMAIL, org: STRICT, firestore }),
    ).toBe('consent-withheld')
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

  it('does not filter an immediate reply on a stream it never named', async () => {
    // The over-correction this scope exists to prevent. Defaulting an
    // unnamed stream to "Promotions and offers" would let a promotions
    // opt-out silence the reply to a contact form, and a form reply is not
    // a promotion.
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicsLeft = { topics: { marketing: { optedOutAt: 1 } } }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        org: {},
        firestore,
        scope: 'immediate',
      }),
    ).toBeNull()
  })

  it('DOES filter an immediate reply on a stream the step named', async () => {
    contact = { email: EMAIL, ...grantedTo(HOST) }
    topicsLeft = { topics: { promotions: { optedOutAt: 1 } } }

    expect(
      await flowEmailRefusal({
        hostId: HOST,
        email: EMAIL,
        topicId: 'promotions',
        org: {},
        firestore,
        scope: 'immediate',
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
