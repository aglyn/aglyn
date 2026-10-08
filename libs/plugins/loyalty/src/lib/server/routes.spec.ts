/**
 * @jest-environment node
 */
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

import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { LOYALTY_PROGRAM_DEFAULTS } from '../model/loyalty-program'
import { memberKeyFor, setLoyaltyDbForTests, setLoyaltyRandomBytesForTests } from './db'
import { setLoyaltyEmailSenderForTests, type LoyaltyEmail } from './emails'
import { forgetLoyaltyProgramCache } from './program-store'
import { setLoyaltyTokenVerifierForTests } from './route-gate'
import { memberRoute, membersRoute, orderRoute, programRoute, setLoyaltyTotalsForTests } from './routes'
import { setLoyaltySiteResolverForTests } from './site-context'

/**
 * Loyalty's console routes (AGL-3640): who may read and change the program,
 * the members list as a paged server query, one member's history, adjusting
 * a balance by hand (once per press), and what an order earned and spent.
 */

const activity: Array<{ action: string }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}), auth: () => ({}) }) },
  getOrgForHost: async () => null,
  getHostDocAdmin: async () => null,
  logHostActivity: async (_host: string, _actor: unknown, action: string) => {
    activity.push({ action })
  },
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/aglyn/server', () => ({ resolveBrandingProfile: () => ({ fromName: 'Candles' }) }))
jest.mock('@aglyn/shared-util-email', () => ({ isEmailConfigured: () => true, sendEmail: async () => undefined }))

const ORG = 'org-candles'
const HOST = 'host-candles'
let db: MemoryFirestore
let sent: LoyaltyEmail[]
let byte = 0

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email: 'ed@example.com', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-admin', email: 'ada@example.com', email_verified: false },
  'tok-outsider': { uid: 'uid-out', email: 'out@example.com', email_verified: true },
}

function call(
  route: (request: Request) => Promise<Response>,
  method: string,
  options: { token?: string; query?: Record<string, string>; body?: unknown; key?: string } = {},
) {
  const query = new URLSearchParams({ hostId: HOST, ...(options.query ?? {}) }).toString()
  return route(
    new Request(`https://console.test/api/loyalty/x?${query}`, {
      method,
      headers: {
        ...(options.token === undefined ? { authorization: 'Bearer tok-admin' } : options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.key ? { 'idempotency-key': options.key } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify({ hostId: HOST, ...(options.body as object) }) } : {}),
    }),
  )
}

async function seedMember(email: string, fields: Record<string, unknown> = {}) {
  const key = memberKeyFor(HOST, email)
  await db
    .collection('orgs')
    .doc(ORG)
    .collection('loyaltyMembers')
    .doc(`${HOST}__${key}`)
    .set({
      orgId: ORG,
      hostId: HOST,
      memberKey: key,
      email,
      name: null,
      points: 0,
      creditCents: 0,
      lifetimePoints: 0,
      ordersCount: 0,
      rewardsCode: `RW-${key.slice(0, 4).toUpperCase()}`,
      referralCode: 'RF-AAAAAA',
      referredBy: null,
      holds: {},
      createdAtMs: 1,
      updatedAtMs: 1,
      lastOrderAtMs: null,
      ...fields,
    })
  return key
}

beforeEach(async () => {
  db = createMemoryFirestore()
  sent = []
  activity.length = 0
  byte = 0
  setLoyaltyDbForTests(db)
  setLoyaltyRandomBytesForTests((size) => Uint8Array.from({ length: size }, () => (byte += 5)))
  setLoyaltyEmailSenderForTests(async (email) => {
    sent.push(email)
    return true
  })
  setLoyaltyTokenVerifierForTests(async (token) => {
    const decoded = TOKENS[token]
    if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
    return decoded
  })
  setLoyaltySiteResolverForTests(async (hostId) =>
    hostId === HOST
      ? {
          orgId: ORG,
          org: { name: 'Candles' },
          host: { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor', 'uid-viewer': 'viewer' } },
        }
      : null,
  )
  setLoyaltyTotalsForTests(async () => ({
    members: 2,
    outstandingPoints: 300,
    outstandingPointsCents: 300,
    outstandingCreditCents: 1_000,
  }))
  forgetLoyaltyProgramCache()
})

afterEach(() => {
  setLoyaltyDbForTests(null)
  setLoyaltyRandomBytesForTests(null)
  setLoyaltyEmailSenderForTests(null)
  setLoyaltyTokenVerifierForTests(null)
  setLoyaltySiteResolverForTests(null)
  setLoyaltyTotalsForTests(null)
})

describe('the gate (AGL-3640)', () => {
  it('refuses no token, an unverified address, an outsider and a site without rewards', async () => {
    expect((await call(programRoute, 'GET', { token: '' })).status).toBe(401)
    expect((await call(programRoute, 'GET', { token: 'tok-bogus' })).status).toBe(401)
    expect((await call(programRoute, 'GET', { token: 'tok-unverified' })).status).toBe(403)
    expect((await call(programRoute, 'GET', { token: 'tok-outsider' })).status).toBe(403)
    setLoyaltySiteResolverForTests(async () => null)
    expect((await call(programRoute, 'GET')).status).toBe(404)
  })
})

describe('the program', () => {
  it('reads as the default, off, with its totals, to anyone on the site', async () => {
    const response = await call(programRoute, 'GET', { token: 'tok-viewer' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      program: LOYALTY_PROGRAM_DEFAULTS,
      totals: { members: 2, outstandingPoints: 300, outstandingPointsCents: 300, outstandingCreditCents: 1_000 },
    })
  })

  it('is changed only by an admin, checked, and the switch is logged', async () => {
    expect((await call(programRoute, 'POST', { token: 'tok-editor', body: { program: { enabled: true } } })).status).toBe(403)
    const refused = await call(programRoute, 'POST', { body: { program: { earnPointsPerDollar: 1_000 } } })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'Points per dollar spent must be between 1 and 100.' })
    const saved = await call(programRoute, 'POST', { body: { program: { enabled: true, welcomePoints: 50 } } })
    expect(saved.status).toBe(200)
    expect((await saved.json()).program).toMatchObject({ enabled: true, welcomePoints: 50 })
    expect(db.docs.get(`orgs/${ORG}/loyaltyPrograms/${HOST}`)).toMatchObject({ enabled: true, updatedBy: 'uid-admin' })
    expect(activity).toEqual([{ action: 'Turned on rewards' }])
  })
})

describe('members', () => {
  beforeEach(async () => {
    await seedMember('amy@example.com', { points: 50, createdAtMs: 1 })
    await seedMember('bob@example.com', { points: 500, createdAtMs: 2 })
    await seedMember('bea@example.com', { points: 10, createdAtMs: 3 })
  })

  it('lists newest first, by points, or by the start of an email — a page at a time', async () => {
    const recent = await (await call(membersRoute, 'GET', { token: 'tok-viewer' })).json()
    expect(recent.members.map((m: { email: string }) => m.email)).toEqual(['bea@example.com', 'bob@example.com', 'amy@example.com'])
    expect(recent.next).toBeNull()
    const top = await (await call(membersRoute, 'GET', { query: { sort: 'points' } })).json()
    expect(top.members[0].email).toBe('bob@example.com')
    const found = await (await call(membersRoute, 'GET', { query: { q: 'B' } })).json()
    expect(found.members.map((m: { email: string }) => m.email)).toEqual(['bea@example.com', 'bob@example.com'])
    const first = await (await call(membersRoute, 'GET', { query: { limit: '2' } })).json()
    expect(first.members).toHaveLength(2)
    expect(first.next).toBe(first.members[1].id)
    const second = await (await call(membersRoute, 'GET', { query: { limit: '2', after: first.next } })).json()
    expect(second.members.map((m: { email: string }) => m.email)).toEqual(['amy@example.com'])
    expect((await call(membersRoute, 'GET', { query: { after: 'not/a/cursor' } })).status).toBe(400)
  })

  it('shows one member with their history', async () => {
    const key = memberKeyFor(HOST, 'bob@example.com')
    const response = await call(memberRoute, 'GET', { token: 'tok-viewer', query: { memberId: key } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ member: { email: 'bob@example.com', points: 500 }, ledger: [] })
    expect((await call(memberRoute, 'GET', { query: { memberId: 'f'.repeat(32) } })).status).toBe(404)
  })
})

describe('adjusting a balance by hand', () => {
  it('gives store credit to a new email, enrolls it, emails it, and a retried press is one change', async () => {
    const press = { body: { email: 'NEW@example.com', creditCents: 1_000, note: 'Sorry about the wait' }, key: 'press-1' }
    const response = await call(memberRoute, 'POST', { token: 'tok-editor', ...press })
    expect(response.status).toBe(200)
    const answer = await response.json()
    expect(answer).toMatchObject({ emailed: true, member: { email: 'new@example.com', creditCents: 1_000 } })
    expect(answer.ledger).toHaveLength(1)
    expect(answer.ledger[0]).toMatchObject({ kind: 'adjust', creditCents: 1_000, note: 'Sorry about the wait' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ key: 'loyalty-store-credit', to: 'new@example.com' })
    expect(sent[0].tokens['loyalty.amount']).toBe('$10.00')

    const again = await call(memberRoute, 'POST', { token: 'tok-editor', ...press })
    expect((await again.json()).member.creditCents).toBe(1_000)
    expect(sent).toHaveLength(1)
    expect(activity).toHaveLength(1)
  })

  it('refuses a viewer, a fraction, an empty change, and taking away more than is there', async () => {
    const key = await seedMember('amy@example.com', { points: 50, creditCents: 200 })
    expect((await call(memberRoute, 'POST', { token: 'tok-viewer', body: { memberId: key, points: 5 } })).status).toBe(403)
    expect((await call(memberRoute, 'POST', { body: { memberId: key, points: 1.5 } })).status).toBe(400)
    expect((await call(memberRoute, 'POST', { body: { memberId: key } })).status).toBe(400)
    const short = await call(memberRoute, 'POST', { body: { memberId: key, creditCents: -500 } })
    expect(short.status).toBe(409)
    expect(await short.json()).toEqual({ error: 'This member has $2.00 of store credit to take away.' })
    expect((await call(memberRoute, 'POST', { body: { memberId: key, points: -60 } })).status).toBe(409)
    const ok = await call(memberRoute, 'POST', { body: { memberId: key, points: -50, creditCents: -200, notify: false } })
    expect((await ok.json()).member).toMatchObject({ points: 0, creditCents: 0 })
    expect(sent).toHaveLength(0)
  })
})

describe('an order', () => {
  it('says what it earned and spent, and nothing for an order rewards never touched', async () => {
    const key = await seedMember('amy@example.com', { points: 100 })
    await db.collection('orgs').doc(ORG).collection('loyaltyLedger').doc(`${HOST}__earn__cs_1`).set({
      hostId: HOST,
      memberKey: key,
      kind: 'earn',
      points: 45,
      reversedPoints: 10,
      creditCents: 0,
      orderId: 'cs_1',
      atMs: 2,
    })
    await db.collection('orgs').doc(ORG).collection('loyaltyRedemptions').doc(`${HOST}__cs_1__${key}`).set({
      hostId: HOST,
      orderId: 'cs_1',
      memberKey: key,
      cents: 500,
      creditCents: 200,
      points: 300,
      restoredCents: 100,
    })
    const answer = await (await call(orderRoute, 'GET', { token: 'tok-viewer', query: { orderId: 'cs_1' } })).json()
    expect(answer.order).toMatchObject({
      email: 'amy@example.com',
      earnedPoints: 45,
      reversedPoints: 10,
      spentCents: 500,
      spentCreditCents: 200,
      spentPoints: 300,
      restoredCents: 100,
    })
    const none = await (await call(orderRoute, 'GET', { query: { orderId: 'cs_2' } })).json()
    expect(none.order).toMatchObject({ earnedPoints: 0, spentCents: 0, entries: [] })
  })
})
