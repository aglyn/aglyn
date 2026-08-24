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
 * SIGN-UP REFUSES AT THE PLATFORM CEILING — END TO END (AGL-1529).
 *
 * `free-tier-caps-refuse.spec.ts` drives the DECISION; this drives the
 * HANDLER an anonymous visitor actually reaches, because a decider nothing
 * consults is the AGL-2163 shape and this repo has been bitten by it.
 *
 * Three ways, and the third is the load-bearing one:
 *
 *  1. **REFUSED** at `SITE_MEMBERS_MAX_PER_HOST` — 429, no member written.
 *  2. **ALLOWED** one below it.
 *  3. **CAUSATION**: the ceiling is what did it. Handled here by driving the
 *     count across the boundary in BOTH directions with everything else held
 *     fixed, and by pinning the discriminating `code` on the body — a handler
 *     that refused for a duplicate email, a missing host or any other reason
 *     answers a different status and a different code.
 *
 * Plus the properties that make it a cap rather than a suggestion: the count
 * is read inside the transaction that creates, and the refusal is opaque to
 * the visitor while being durable for the host.
 */

const mockState: {
  members: Array<Record<string, unknown>>
  leads: Array<Record<string, unknown>>
  trips: Array<Record<string, unknown>>
  existingMembers: number
  duplicateEmail: boolean
  countsInsideTransaction: number
  countsOutsideTransaction: number
} = {
  members: [],
  leads: [],
  trips: [],
  existingMembers: 0,
  duplicateEmail: false,
  countsInsideTransaction: 0,
  countsOutsideTransaction: 0,
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const membersCollection: any = {
    where: () => membersCollection,
    limit: () => membersCollection,
    count: () => ({ __count: true }),
    get: async () => {
      mockState.countsOutsideTransaction += 1
      return { empty: !mockState.duplicateEmail, docs: [] }
    },
    doc: () => ({ id: 'member-1' }),
  }
  const firestore: any = {
    collection: () => ({ doc: () => hostRef }),
    runTransaction: async (body: (tx: any) => Promise<unknown>) =>
      body({
        get: async (target: any) => {
          if (target?.__count) {
            mockState.countsInsideTransaction += 1
            return {
              data: () => ({
                count: mockState.existingMembers + mockState.members.length,
              }),
            }
          }
          return { empty: !mockState.duplicateEmail, docs: [] }
        },
        create: (_ref: unknown, data: Record<string, unknown>) => {
          mockState.members.push(data)
        },
      }),
  }
  const hostRef: any = {
    firestore,
    get: async () => ({
      exists: true,
      // The site publishes a support address, so the refusal can hand a
      // stranger a door that still opens (AGL-1666).
      data: () => ({ business: { supportEmail: 'hello@example.com' } }),
    }),
    collection: () => membersCollection,
  }
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => firestore }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    upsertHostContact: () => undefined,
    addHostLead: async (options: { lead: Record<string, unknown> }) => {
      mockState.leads.push(options.lead)
      return true
    },
    recordVisitorRecordCeilingTrip: async (options: Record<string, unknown>) => {
      mockState.trips.push(options)
    },
  }
})

jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: async () => ({ alerts: [] }),
}))

const mockHash = jest.fn(() => 'scrypt$test')
jest.mock('./membership', () => ({
  hashMemberPassword: (...args: unknown[]) => (mockHash as any)(...args),
  mintMemberSession: () => 'session-token',
  setMemberCookie: () => undefined,
}))

import {
  SITE_MEMBER_CEILING_CODE,
  SITE_MEMBER_UNAVAILABLE_MESSAGE,
  SITE_MEMBERS_MAX_PER_HOST,
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

const register = async (body: Record<string, unknown> = {}) => {
  const res = makeRes()
  await membershipRegisterHandler(
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
    res,
  )
  return res
}

beforeEach(() => {
  mockState.members = []
  mockState.leads = []
  mockState.trips = []
  mockState.existingMembers = 0
  mockState.duplicateEmail = false
  mockState.countsInsideTransaction = 0
  mockState.countsOutsideTransaction = 0
  mockHash.mockClear()
})

describe('the sign-up ceiling (AGL-1529)', () => {
  it('REFUSES at SITE_MEMBERS_MAX_PER_HOST and creates nothing', async () => {
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST
    const res = await register()
    expect(res.statusCode).toBe(429)
    expect(mockState.members).toHaveLength(0)
    // …and the lead the sign-up would have left behind never happens either:
    // there was no sign-up.
    expect(mockState.leads).toHaveLength(0)
  })

  it('ALLOWS one below the ceiling', async () => {
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST - 1
    const res = await register({ displayName: 'Dana Reed' })
    expect(res.statusCode).toBe(200)
    expect(mockState.members).toHaveLength(1)
    expect(mockState.leads).toHaveLength(1)
  })

  it('CAUSATION: only the count moved across the boundary', async () => {
    // Everything about the request is identical in both directions — same
    // host, same address, same password. A handler that refuses for any other
    // reason cannot produce these two answers from these two counts.
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST - 1
    expect((await register()).statusCode).toBe(200)
    mockState.members = []
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST
    expect((await register()).statusCode).toBe(429)
  })

  it('the refusal is DISCRIMINABLE from the rate limiter’s 429', async () => {
    // The dispatcher's per-(host, IP) limiter answers 429 too, so the status
    // identifies nothing. The code is the whole discriminator.
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST
    const res = await register()
    expect(res.body.code).toBe(SITE_MEMBER_CEILING_CODE)
  })

  it('the visitor is told plainly, and told NOTHING about the site', async () => {
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST
    const res = await register()
    expect(res.body.error).toBe(SITE_MEMBER_UNAVAILABLE_MESSAGE)
    // The stranger reading this is an end user of somebody else's site, so
    // the PROSE must not explain: not the ceiling, not the count, not the
    // plan, not that anything was flooded. Checked on the strings a person
    // reads. `code` is excluded deliberately — it is a protocol token for the
    // site's own front-end, exactly as `form-abuse-ceiling` is, and it is the
    // thing that lets a site render its own copy instead of ours.
    const shown = [res.body.error, res.body.contact].join(' ').toLowerCase()
    for (const leak of ['ceiling', 'limit', 'plan', 'abuse', 'quota', 'spam']) {
      expect(`${leak}: ${shown.includes(leak) ? 'LEAKED' : 'withheld'}`).toBe(
        `${leak}: withheld`,
      )
    }
    // The control for that loop: a word the message DOES contain, so a
    // substring check that had silently stopped matching would fail here.
    expect(shown).toContain('not created')
    // Nothing in the WHOLE body names us or the number, code included. The
    // visitor did not come here to learn which platform the site runs on.
    const whole = JSON.stringify(res.body).toLowerCase()
    expect(whole).not.toContain('aglyn')
    expect(whole).not.toContain(String(SITE_MEMBERS_MAX_PER_HOST))
    // The one useful thing it may carry: the site's OWN published address.
    expect(res.body.contact).toBe('hello@example.com')
  })

  it('records the trip where the site’s owner will see it', async () => {
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST
    await register()
    expect(mockState.trips).toHaveLength(1)
    expect(mockState.trips[0]).toMatchObject({
      hostId: 'host-1',
      kind: 'siteMembers',
      ceiling: SITE_MEMBERS_MAX_PER_HOST,
    })
  })

  it('takes the count INSIDE the transaction that creates', async () => {
    // The create-time-quota laundering (AGL-2231/2265/2266): count, decide,
    // then `set()` outside any transaction, and N concurrent sign-ups all
    // find room. What changed is WHEN the count is evaluated, so that is what
    // is asserted — not the counting rule, which was never wrong.
    await register()
    expect(mockState.countsInsideTransaction).toBe(1)
    expect(mockState.countsOutsideTransaction).toBe(0)
  })

  it('a refused sign-up never pays for the scrypt hash', async () => {
    // ~100 ms of CPU is the most expensive thing in this request. Hashing
    // before the ceiling is checked would hand a flood an amplifier on
    // exactly the path the ceiling exists to contain.
    mockState.existingMembers = SITE_MEMBERS_MAX_PER_HOST
    await register()
    expect(mockHash).not.toHaveBeenCalled()
    // The control: it IS called when the sign-up succeeds, so the assertion
    // above is not satisfied by a handler that never hashes at all.
    mockState.existingMembers = 0
    await register()
    expect(mockHash).toHaveBeenCalledTimes(1)
  })

  it('a duplicate email is still a 409, not the ceiling’s 429', async () => {
    // The dedupe read moved inside the transaction with the count. It must
    // still answer its own refusal — a ceiling that swallowed it would tell
    // a returning member their site is full.
    mockState.duplicateEmail = true
    const res = await register()
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBeUndefined()
    expect(mockState.trips).toHaveLength(0)
  })
})
