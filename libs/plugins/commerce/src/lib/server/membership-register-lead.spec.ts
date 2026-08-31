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
 * A SIGN-UP LEAVES A LEAD SOMEONE CAN WRITE TO BY NAME (AGL-2303).
 *
 * `campaign-send` reads `leads.name` for merge tags. No lead writer wrote one.
 * Here the name was on the request, went onto the member document as
 * `displayName` two lines earlier, and was dropped from the lead — so every
 * campaign to the leads audience resolved `{{name}}` to an empty string in
 * mail that had already been delivered.
 *
 * Asserted against the VALUE from the request. A writer storing a constant, or
 * the email address that is sitting right there, satisfies any "is there a
 * name" check and fails here.
 */

const mockState: {
  members: Array<Record<string, unknown>>
  leads: Array<Record<string, unknown>>
} = { members: [], leads: [] }

jest.mock('@aglyn/tenant-data-admin', () => {
  // The sign-up now COUNTS AND CREATES IN ONE TRANSACTION (AGL-1529), so the
  // double models a transaction rather than a bare `set()`: an aggregate
  // `count()` read through `tx.get`, and `tx.create` for the write. A double
  // that kept answering `set()` would make the handler's real path untested
  // while still going green, which is the failure this file was written
  // against in the first place.
  const membersCollection: any = {
    where: () => membersCollection,
    limit: () => membersCollection,
    // Marks the aggregate so `tx.get` can tell a count from a query.
    count: () => ({ __count: true, collection: membersCollection }),
    get: async () => ({ empty: true, docs: [] }),
    doc: () => ({
      id: 'member-1',
      set: async (data: Record<string, unknown>) => {
        mockState.members.push(data)
      },
    }),
  }
  const firestore: any = {
    collection: () => ({ doc: () => hostRef }),
    runTransaction: async (body: (tx: any) => Promise<unknown>) =>
      body({
        get: async (target: any) =>
          target?.__count
            ? { data: () => ({ count: mockState.members.length }) }
            : { empty: true, docs: [] },
        create: (_ref: unknown, data: Record<string, unknown>) => {
          mockState.members.push(data)
        },
      }),
  }
  const hostRef: any = {
    firestore,
    get: async () => ({ exists: true, data: () => ({}) }),
    collection: (name: string) =>
      name === 'siteMembers'
        ? membersCollection
        : {
            add: async (data: Record<string, unknown>) => {
              if (name === 'leads') mockState.leads.push(data)
              return { id: `${name}-1` }
            },
          },
  }
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => firestore }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    upsertHostContact: () => undefined,
    // The attribution seam the handler resolves once per sign-up. Recorded as
    // nothing — `campaign-conversion-attribution.spec.ts` owns the write — and
    // defined here at all because a mocked module answers `undefined` for a
    // name it does not list, which would make the handler throw rather than
    // fail an assertion.
    resolveCampaignTouch: async () => null,
    recordVisitorRecordCeilingTrip: async () => undefined,
    // Recorded, not discarded. A double whose writer returns success and
    // forgets the payload cannot fail on a wrong payload — which is how a
    // lead with no name on it went unnoticed.
    addHostLead: async (options: { lead: Record<string, unknown> }) => {
      mockState.leads.push({ ...options.lead, createdAt: 'NOW' })
      return true
    },
  }
})

jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: async () => ({ alerts: [] }),
}))

jest.mock('./membership', () => ({
  hashMemberPassword: () => 'scrypt$test',
  mintMemberSession: () => 'session-token',
  setMemberCookie: () => undefined,
}))

import {
  readMarketingBasis,
  soloConsentGroup,
} from '@aglyn/aglyn/server'
import { membershipRegisterHandler } from './membership-register'

function makeRes(): any {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(value: unknown) {
      res.body = value
      return res
    },
    setHeader: () => undefined,
  }
  return res
}

const register = (body: Record<string, unknown>) =>
  membershipRegisterHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        email: 'dana@example.com',
        password: 'correct-horse',
        ...body,
      },
      headers: {},
      query: {},
      cookies: {},
    } as any,
    makeRes(),
  )

beforeEach(() => {
  mockState.members = []
  mockState.leads = []
})

describe('the lead a sign-up leaves behind (AGL-2303)', () => {
  it('carries the name the person just typed', async () => {
    await register({ displayName: 'Dana Reed' })
    expect(mockState.leads).toHaveLength(1)
    expect(mockState.leads[0]).toMatchObject({
      email: 'dana@example.com',
      name: 'Dana Reed',
      source: 'signup',
    })
  })

  it('carries THAT sign-up’s name, not a constant', async () => {
    // Two sign-ups, two names. A writer echoing a fixed string, or the email,
    // survives the test above and dies here.
    await register({ displayName: 'Dana Reed' })
    await register({ displayName: 'Sam Okafor', email: 'sam@example.com' })
    expect(mockState.leads.map((lead) => lead['name'])).toEqual([
      'Dana Reed',
      'Sam Okafor',
    ])
  })

  it('omits the field entirely when no display name was given', async () => {
    // `displayName` is optional at sign-up. An empty string is not a name, and
    // storing one would make `collectName` keep the key and resolve it to
    // nothing — a recipient the sender believes is personalized and is not.
    await register({})
    expect(mockState.leads).toHaveLength(1)
    expect('name' in mockState.leads[0]).toBe(false)
    // …and the member document is written the same way, which is the field
    // the members audience now reads.
    expect('displayName' in mockState.members[0]).toBe(false)
  })
})

/**
 * The consent field `siteMembers` never had.
 *
 * The sign-up checkbox reached the lead and the contact and was dropped for
 * the member document, so `hosts/{hostId}/siteMembers` carried no consent
 * signal of any kind and `audience: 'members'` had nothing for the send-time
 * join to read — the audience could not be filtered even in principle
 * (`docs/specs/email-overhaul.md` §1d).
 *
 * The other two documents are not a substitute for it: a member is deduped in
 * this transaction while leads append every time, and contacts are org-scoped
 * where a member belongs to one site.
 */
describe('the consent a member signs up with', () => {
  it('persists a ticked checkbox on the member document', async () => {
    await register({ displayName: 'Dana Reed', marketingConsent: true })
    expect(mockState.members).toHaveLength(1)
    // Recorded against THIS SITE, through the shipped reader, so a basis
    // this file calls stored is one the send path would also find.
    expect(
      readMarketingBasis(mockState.members[0], soloConsentGroup('host-1')).basis,
    ).toBe('granted')
    expect(
      typeof readMarketingBasis(mockState.members[0], soloConsentGroup('host-1'))
        .basisAtMs,
    ).toBe('number')
    // And nothing at the top of the document, where every brand in the
    // account would read it as its own.
    expect(mockState.members[0]).not.toHaveProperty('marketingConsent')
  })

  /**
   * THE CONTROL. Signing up is not opting in — that is why the checkbox
   * exists and why it defaults unchecked. An absent field reads back as an
   * UNRECORDED basis, which is a third state and not a quiet refusal, so
   * writing `false` here would be a different claim than the one the person
   * made.
   */
  it('writes nothing at all when the box was not ticked', async () => {
    await register({ displayName: 'Dana Reed' })
    expect('marketingConsent' in mockState.members[0]).toBe(false)
    expect('marketingConsentAtMs' in mockState.members[0]).toBe(false)
  })
})
