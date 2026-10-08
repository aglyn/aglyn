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

import { randomBytes } from 'node:crypto'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { createSmileAdapter, SMILE_API_BASE } from '../connectors/smile'
import { LoyaltyVendorError } from '../connectors/types'
import { createYotpoAdapter, YOTPO_API_BASE } from '../connectors/yotpo'
import { loyaltyOrderIsTestMode } from '../model/loyalty-connectors'
import { LOYALTY_PROGRAM_DEFAULTS } from '../model/loyalty-program'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { connectionRoute } from './connection-routes'
import { LOYALTY_CONNECTORS_ENV, setLoyaltyVendorFetchForTests } from './connector-config'
import { LOYALTY_SYNC_CLAIM_STALE_MS, loyaltySyncRef, sendLoyaltySync } from './connector-sync'
import { holdLoyaltyCredit, resolveLoyaltyCredit, restoreLoyaltyCredit, stageLoyaltyCredit } from './credit-provider'
import { memberKeyFor, setLoyaltyDbForTests, setLoyaltyRandomBytesForTests } from './db'
import { setLoyaltyEmailSenderForTests, type LoyaltyEmail } from './emails'
import { earnForOrder, reverseForOrder, type LoyaltyEventOrder } from './order-events'
import { eraseLoyaltyPerson } from './person-eraser'
import { forgetLoyaltyProgramCache } from './program-store'
import { setLoyaltyTokenVerifierForTests } from './route-gate'
import { memberRoute, setLoyaltyTotalsForTests } from './routes'
import { setLoyaltySiteResolverForTests } from './site-context'

/**
 * A merchant's own Smile.io or Yotpo Loyalty account (AGL-3677): each
 * vendor's calls against a mocked HTTP layer, and the whole connected program
 * through its doors — connect, earn once per order, reverse to a target,
 * spend a balance read from the account, give back, send a dead sender's row
 * exactly once, skip test-mode sales, and disconnect. Nothing leaves the
 * process.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}), auth: () => ({}) }) },
  getOrgForHost: async () => null,
  getHostDocAdmin: async () => null,
  logHostActivity: async () => undefined,
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: () => true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/aglyn/server', () => ({ resolveBrandingProfile: () => ({ fromName: 'Candles' }) }))
jest.mock('@aglyn/shared-util-email', () => ({ isEmailConfigured: () => true, sendEmail: async () => undefined }))

const ORG = 'org-candles'
const HOST = 'host-candles'
const TOKEN_KEY = randomBytes(32).toString('base64')
let db: MemoryFirestore
let sent: LoyaltyEmail[]
let byte = 0

// ── A fake vendor: members by email, every call recorded ────────────────────

interface FakeMember {
  id: string
  email: string
  points: number
  history: Array<{ points: number; note: string }>
}

interface FakeCall {
  method: string
  url: string
  headers: Record<string, string>
  body: any
}

let calls: FakeCall[]
let members: Map<string, FakeMember>
let nextStatus: number[]
let authOk: boolean

function vendorFetch(vendor: 'smile' | 'yotpo') {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const method = String(init?.method ?? 'GET')
    calls.push({ method, url: input, headers, body })
    const reply = (status: number, payload: unknown) =>
      new Response(payload === undefined ? '' : JSON.stringify(payload), { status })
    const forced = nextStatus.shift()
    if (forced) return reply(forced, { error: { message: 'forced' } })
    if (!authOk) return reply(401, { error: { message: 'Invalid API key' } })
    const url = new URL(input)
    if (vendor === 'smile') {
      if (url.pathname === '/v1/customers') {
        const email = url.searchParams.get('email')
        const found = email ? members.get(email) : [...members.values()][0]
        return reply(200, { customers: found ? [{ id: Number(found.id), email: found.email, state: 'member', points_balance: found.points }] : [] })
      }
      if (url.pathname === '/v1/points_transactions' && method === 'POST') {
        const tx = body.points_transaction
        const found = [...members.values()].find((member) => member.id === String(tx.customer_id))
        if (!found) return reply(404, { error: { message: 'no customer' } })
        if (found.points + tx.points_change < 0) return reply(422, { error: { message: 'Insufficient points' } })
        found.points += tx.points_change
        found.history.push({ points: tx.points_change, note: tx.internal_note })
        return reply(201, { points_transaction: { id: 9000 + found.history.length } })
      }
      if (url.pathname === '/v1/points_transactions' && method === 'GET') {
        const found = [...members.values()].find((member) => member.id === url.searchParams.get('customer_id'))
        return reply(200, { points_transactions: (found?.history ?? []).map((row) => ({ internal_note: row.note, points_change: row.points })) })
      }
    } else {
      if (url.pathname === '/api/v2/customers' && method === 'GET') {
        const found = members.get(String(url.searchParams.get('customer_email')))
        if (!found) return reply(404, {})
        return reply(200, {
          yotpo_customer_id: Number(found.id),
          email: found.email,
          points_balance: found.points,
          ...(url.searchParams.get('with_history') === 'true'
            ? { history_items: found.history.map((row) => ({ action: row.note, points: row.points })) }
            : {}),
        })
      }
      if (url.pathname === '/api/v2/customers' && method === 'POST') {
        members.set(body.email, { id: String(500 + members.size), email: body.email, points: 0, history: [] })
        return reply(201, {})
      }
      if (url.pathname === '/api/v2/points/adjust') {
        const found = members.get(body.customer_email)
        if (!found) return reply(404, {})
        if (found.points + body.point_adjustment_amount < 0) return reply(422, { message: 'Not enough points' })
        found.points += body.point_adjustment_amount
        found.history.push({ points: body.point_adjustment_amount, note: body.history_title })
        return reply(200, {})
      }
    }
    return reply(404, { error: { message: `unexpected ${method} ${input}` } })
  }
}

const adjustCalls = () =>
  calls.filter((call) => call.method === 'POST' && /points_transactions|points\/adjust/.test(call.url))

// ── Fixtures ────────────────────────────────────────────────────────────────

async function setProgram(overrides: Record<string, unknown> = {}) {
  await db
    .collection('orgs')
    .doc(ORG)
    .collection('loyaltyPrograms')
    .doc(HOST)
    .set({ ...LOYALTY_PROGRAM_DEFAULTS, enabled: true, welcomePoints: 50, referralsEnabled: true, ...overrides })
  forgetLoyaltyProgramCache()
}

function program() {
  return db.docs.get(`orgs/${ORG}/loyaltyPrograms/${HOST}`)
}

function memberDoc(email: string) {
  return db.docs.get(`orgs/${ORG}/loyaltyMembers/${HOST}__${memberKeyFor(HOST, email)}`)
}

function syncRow(entryKey: string) {
  return db.docs.get(`orgs/${ORG}/loyaltySync/${HOST}__${entryKey}`)
}

async function seedMember(email: string, fields: Record<string, unknown> = {}) {
  const key = memberKeyFor(HOST, email)
  const rewardsCode = String(fields['rewardsCode'] ?? 'RW-AAAA-BBBB-CCCC')
  await db.collection('orgs').doc(ORG).collection('loyaltyMembers').doc(`${HOST}__${key}`).set({
    orgId: ORG,
    hostId: HOST,
    memberKey: key,
    email,
    name: null,
    points: 0,
    creditCents: 0,
    lifetimePoints: 0,
    ordersCount: 0,
    rewardsCode,
    referralCode: 'RF-AAAAAA',
    referredBy: null,
    holds: {},
    createdAtMs: 1,
    updatedAtMs: 1,
    lastOrderAtMs: null,
    ...fields,
  })
  await db.collection('orgs').doc(ORG).collection('loyaltyCodes').doc(`${HOST}__${rewardsCode}`).set({ kind: 'rewards', memberKey: key, hostId: HOST })
  await db.collection('orgs').doc(ORG).collection('loyaltyCodes').doc(`${HOST}__RF-AAAAAA`).set({ kind: 'referral', memberKey: key, hostId: HOST })
  return key
}

function order(overrides: Partial<LoyaltyEventOrder> = {}): LoyaltyEventOrder {
  return {
    id: 'cs_live_1',
    status: 'paid',
    channel: 'online',
    customerEmail: 'pat@example.com',
    customerName: 'Pat Doe',
    totals: { itemsCents: 10_000, discountCents: 1_000, totalCents: 9_900 },
    refundedCents: 0,
    credits: [],
    ...overrides,
  }
}

function envelope<P>(payload: P, id = 'evt-1'): PluginDomainEventEnvelope<P> {
  return { id, event: 'order.paid', hostId: HOST, orgId: ORG, occurredAtMs: 1, attempt: 1, payload }
}

function call(body?: Record<string, unknown>) {
  return connectionRoute(
    new Request(`https://console.test/api/loyalty/connection?hostId=${HOST}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer tok-admin', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify({ hostId: HOST, ...body }) } : {}),
    }),
  )
}

async function connect(provider: 'smile' | 'yotpo', extra: Record<string, unknown> = {}) {
  setLoyaltyVendorFetchForTests(vendorFetch(provider))
  const credentials = provider === 'smile' ? { apiKey: 'api_secretkey1234' } : { guid: 'guid-abc', apiKey: 'ykey-secret5678' }
  return call({ action: 'connect', provider, credentials, ...extra })
}

beforeEach(async () => {
  db = createMemoryFirestore()
  sent = []
  byte = 0
  calls = []
  members = new Map()
  nextStatus = []
  authOk = true
  process.env[LOYALTY_CONNECTORS_ENV.tokenKey] = TOKEN_KEY
  setLoyaltyDbForTests(db)
  setLoyaltyRandomBytesForTests((size) => Uint8Array.from({ length: size }, () => (byte += 7)))
  setLoyaltyEmailSenderForTests(async (email) => {
    sent.push(email)
    return true
  })
  setLoyaltySiteResolverForTests(async (hostId) =>
    hostId === HOST ? { orgId: ORG, org: { name: 'Candles' }, host: { memberRoles: { 'uid-admin': 'admin' } } } : null,
  )
  setLoyaltyTokenVerifierForTests(async (token) => {
    if (token !== 'tok-admin') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
    return { uid: 'uid-admin', email: 'ada@example.com', email_verified: true }
  })
  setLoyaltyTotalsForTests(async (orgId, hostId) => {
    const held = [...db.docs.entries()]
      .filter(([path, data]) => path.startsWith(`orgs/${orgId}/loyaltyMembers/`) && data['hostId'] === hostId)
      .reduce((sum, [, data]) => sum + Math.max(0, Number(data['points']) || 0), 0)
    return { members: null, outstandingPoints: held, outstandingPointsCents: null, outstandingCreditCents: null }
  })
  await setProgram()
})

afterEach(() => {
  delete process.env[LOYALTY_CONNECTORS_ENV.tokenKey]
  setLoyaltyVendorFetchForTests(null)
  setLoyaltyDbForTests(null)
  setLoyaltyRandomBytesForTests(null)
  setLoyaltyEmailSenderForTests(null)
  setLoyaltySiteResolverForTests(null)
  setLoyaltyTokenVerifierForTests(null)
  setLoyaltyTotalsForTests(null)
})

// ── The adapters ────────────────────────────────────────────────────────────

describe('the Smile.io adapter (AGL-3677)', () => {
  const credentials = { apiKey: 'api_secret' }

  it('finds a member by email with the merchant’s key as a bearer token', async () => {
    members.set('pat@example.com', { id: '304', email: 'pat@example.com', points: 120, history: [] })
    const adapter = createSmileAdapter(vendorFetch('smile'))
    await expect(adapter.findMember(credentials, 'pat@example.com')).resolves.toEqual({ id: '304', points: 120 })
    expect(calls[0].url).toBe(`${SMILE_API_BASE}/customers?email=pat%40example.com&limit=5`)
    expect(calls[0].headers['Authorization']).toBe('Bearer api_secret')
    await expect(adapter.findMember(credentials, 'nobody@example.com')).resolves.toBeNull()
    await expect(adapter.enrollMember(credentials, { email: 'nobody@example.com', name: null })).resolves.toBeNull()
  })

  it('writes a signed points transaction with its reference, and finds it again', async () => {
    members.set('pat@example.com', { id: '304', email: 'pat@example.com', points: 0, history: [] })
    const adapter = createSmileAdapter(vendorFetch('smile'))
    const member = { id: '304', points: 0 }
    await expect(
      adapter.adjust(credentials, { member, email: 'pat@example.com', points: 45, earned: true, title: 'Points for an order', ref: 'ABC' }),
    ).resolves.toEqual({ id: '9001' })
    expect(calls[0].body).toEqual({
      points_transaction: { customer_id: 304, points_change: 45, description: 'Points for an order', internal_note: 'Rewards ref ABC' },
    })
    await expect(adapter.hasAdjustment(credentials, { member, email: 'pat@example.com', ref: 'ABC' })).resolves.toBe(true)
    await expect(adapter.hasAdjustment(credentials, { member, email: 'pat@example.com', ref: 'XYZ' })).resolves.toBe(false)
  })

  it('sorts refusals: a short balance, refused credentials, and a busy vendor', async () => {
    members.set('pat@example.com', { id: '304', email: 'pat@example.com', points: 10, history: [] })
    const adapter = createSmileAdapter(vendorFetch('smile'))
    const input = { member: { id: '304', points: 10 }, email: 'pat@example.com', points: -50, earned: false, title: 't', ref: 'R' }
    await expect(adapter.adjust(credentials, input)).rejects.toMatchObject({ kind: 'insufficient', status: 422 })
    nextStatus.push(429)
    await expect(adapter.findMember(credentials, 'pat@example.com')).rejects.toMatchObject({ kind: 'transient' })
    authOk = false
    const refused = await adapter.verify(credentials).catch((error) => error)
    expect(refused).toBeInstanceOf(LoyaltyVendorError)
    expect(refused.kind).toBe('auth')
    expect(String(refused.message)).not.toContain('api_secret')
  })
})

describe('the Yotpo Loyalty adapter (AGL-3677)', () => {
  const credentials = { guid: 'guid-1', apiKey: 'key-1' }

  it('reads a member with the GUID and key headers, and a 404 is nobody', async () => {
    members.set('pat@example.com', { id: '77', email: 'pat@example.com', points: 300, history: [] })
    const adapter = createYotpoAdapter(vendorFetch('yotpo'))
    await expect(adapter.findMember(credentials, 'pat@example.com')).resolves.toEqual({ id: '77', points: 300 })
    expect(calls[0].url).toBe(`${YOTPO_API_BASE}/customers?customer_email=pat%40example.com&with_history=false`)
    expect(calls[0].headers).toMatchObject({ 'X-GUID': 'guid-1', 'X-API-KEY': 'key-1' })
    await expect(adapter.findMember(credentials, 'nobody@example.com')).resolves.toBeNull()
  })

  it('enrolls an address it lacks, adjusts with a history title, and finds the reference again', async () => {
    const adapter = createYotpoAdapter(vendorFetch('yotpo'))
    const member = await adapter.enrollMember(credentials, { email: 'new@example.com', name: 'Robin Q Public' })
    expect(member).toEqual({ id: '500', points: 0 })
    expect(calls[0].body).toEqual({ email: 'new@example.com', first_name: 'Robin', last_name: 'Q Public' })
    await adapter.adjust(credentials, { member: member!, email: 'new@example.com', points: 40, earned: true, title: 'Points for an order', ref: 'R1' })
    expect(calls.at(-1)?.body).toEqual({
      customer_email: 'new@example.com',
      point_adjustment_amount: 40,
      apply_adjustment_to_points_earned: true,
      history_title: 'Points for an order · Rewards ref R1',
    })
    await expect(adapter.hasAdjustment(credentials, { member: member!, email: 'new@example.com', ref: 'R1' })).resolves.toBe(true)
  })

  it('a record mid-processing (423) is sent again later, not refused', async () => {
    const adapter = createYotpoAdapter(vendorFetch('yotpo'))
    nextStatus.push(423)
    await expect(
      adapter.adjust(credentials, { member: { id: '1', points: 0 }, email: 'a@example.com', points: 1, earned: true, title: 't', ref: 'r' }),
    ).rejects.toMatchObject({ kind: 'transient' })
  })
})

describe('test mode (AGL-3677)', () => {
  it('reads a recorded livemode first, then a Stripe test session id; anything else is live', () => {
    expect(loyaltyOrderIsTestMode({ id: 'cs_test_1' })).toBe(true)
    expect(loyaltyOrderIsTestMode({ id: 'cs_test_1', livemode: true })).toBe(false)
    expect(loyaltyOrderIsTestMode({ id: 'pos-123', livemode: false })).toBe(true)
    expect(loyaltyOrderIsTestMode('pos-123')).toBe(false)
  })
})

// ── The connection route ────────────────────────────────────────────────────

describe('connecting an account (AGL-3677)', () => {
  it('draws nothing and refuses to connect on a deployment without the sealing key', async () => {
    delete process.env[LOYALTY_CONNECTORS_ENV.tokenKey]
    await expect((await call()).json()).resolves.toEqual({ configured: false, connection: null, attention: [], builtInPoints: null })
    expect((await connect('smile')).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('checks the key with the vendor, seals it, and never serves it back', async () => {
    authOk = false
    const refused = await connect('smile')
    expect(refused.status).toBe(400)
    expect(db.docs.get(`orgs/${ORG}/loyaltyConnections/${HOST}`)).toBeUndefined()

    authOk = true
    const response = await connect('smile')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.connection).toMatchObject({ provider: 'smile', label: 'Smile.io', keyLast4: '1234' })
    expect(JSON.stringify(body)).not.toContain('api_secretkey1234')
    const stored = db.docs.get(`orgs/${ORG}/loyaltyConnections/${HOST}`)!
    expect(stored['sealedApiToken']).toMatch(/^sb1\./)
    expect(JSON.stringify(stored)).not.toContain('api_secretkey1234')
    expect(program()).toMatchObject({ connected: 'smile', enabled: true })
  })

  it('refuses to replace built-in points members hold unless the merchant says so', async () => {
    await seedMember('pat@example.com', { points: 800 })
    const held = await connect('yotpo')
    expect(held.status).toBe(409)
    await expect(held.json()).resolves.toMatchObject({ builtInPoints: 800 })
    expect(program()?.['connected']).toBeNull()

    expect((await connect('yotpo', { replaceBalances: true })).status).toBe(200)
    // Set aside, not spent: the mirror starts at zero, the built-in points are parked.
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 0, parked: true, parkedPoints: 800 })
    expect(program()?.['connected']).toBe('yotpo')
  })

  it('a program change from the Rewards card can never name or clear the account', async () => {
    await connect('yotpo')
    const { programRoute } = await import('./routes')
    await programRoute(
      new Request(`https://console.test/api/loyalty/program`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin', 'content-type': 'application/json' },
        body: JSON.stringify({ hostId: HOST, program: { connected: null, earnPointsPerDollar: 2 } }),
      }),
    )
    expect(program()).toMatchObject({ connected: 'yotpo', earnPointsPerDollar: 2 })
  })
})

// ── The connected program ───────────────────────────────────────────────────

describe('a connected program earns once per order (AGL-3677)', () => {
  it('writes the order’s points to Yotpo once, enrolling the buyer — and no welcome points of its own', async () => {
    await connect('yotpo')
    calls = []
    await earnForOrder(envelope({ order: order() }))
    expect(adjustCalls()).toHaveLength(1)
    expect(adjustCalls()[0].body).toMatchObject({ customer_email: 'pat@example.com', point_adjustment_amount: 450, apply_adjustment_to_points_earned: true })
    expect(members.get('pat@example.com')?.points).toBe(450)
    expect(syncRow('earn__cs_live_1')).toMatchObject({ status: 'synced', points: 450, provider: 'yotpo' })
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 450 })
    // The email states the account's balance.
    expect(sent[0].tokens['loyalty.balance']).toBe('450')

    await earnForOrder(envelope({ order: order() }, 'evt-1-redelivered'))
    await sendLoyaltySync({ orgId: ORG, hostId: HOST, force: true })
    expect(adjustCalls()).toHaveLength(1)
    expect(members.get('pat@example.com')?.points).toBe(450)
  })

  it('moves no real points for a test-mode sale', async () => {
    await connect('yotpo')
    calls = []
    await earnForOrder(envelope({ order: order({ id: 'cs_test_9' }) }))
    expect(adjustCalls()).toHaveLength(0)
    expect(memberDoc('pat@example.com')).toBeUndefined()
  })

  it('holds a Smile.io buyer Smile does not know as unmatched, and sends it once they join', async () => {
    await connect('smile')
    calls = []
    await earnForOrder(envelope({ order: order() }))
    expect(adjustCalls()).toHaveLength(0)
    expect(syncRow('earn__cs_live_1')).toMatchObject({ status: 'unmatched' })
    const listed = await (await call()).json()
    expect(listed.attention).toEqual([expect.objectContaining({ status: 'unmatched', points: 450, email: 'pat@example.com' })])
    // An automatic pass leaves it be: nothing has changed at Smile.io.
    expect(await sendLoyaltySync({ orgId: ORG, hostId: HOST })).toEqual({ sent: 0, failed: 0 })

    members.set('pat@example.com', { id: '42', email: 'pat@example.com', points: 0, history: [] })
    const retried = await (await call({ action: 'retry' })).json()
    expect(retried.result).toEqual({ sent: 1, failed: 0 })
    expect(members.get('pat@example.com')?.points).toBe(450)
    expect(syncRow('earn__cs_live_1')).toMatchObject({ status: 'synced' })
  })

  it('a refund takes points back to a cumulative target, once per delivery', async () => {
    await connect('yotpo')
    await earnForOrder(envelope({ order: order() }))
    calls = []
    const refunded = order({ status: 'partially_refunded', refundedCents: 4_950 })
    await reverseForOrder(envelope({ order: refunded }, 'evt-r1'), 'refunded')
    await reverseForOrder(envelope({ order: refunded }, 'evt-r1-again'), 'refunded')
    expect(adjustCalls().map((call) => call.body.point_adjustment_amount)).toEqual([-225])
    expect(members.get('pat@example.com')?.points).toBe(225)
    await reverseForOrder(envelope({ order: order({ status: 'cancelled' }) }, 'evt-c'), 'cancelled')
    expect(adjustCalls().map((call) => call.body.point_adjustment_amount)).toEqual([-225, -225])
    expect(members.get('pat@example.com')?.points).toBe(0)
  })

  it('takes what is left when a refund outruns a balance already spent, and records the rest', async () => {
    await connect('yotpo')
    await earnForOrder(envelope({ order: order() }))
    members.get('pat@example.com')!.points = 10
    await reverseForOrder(envelope({ order: order({ status: 'refunded', refundedCents: 9_900 }) }, 'evt-full'), 'refunded')
    expect(members.get('pat@example.com')?.points).toBe(0)
    expect(syncRow('reverse__cs_live_1__450')).toMatchObject({ status: 'synced', points: -450, shortfallPoints: 440 })
  })
})

describe('spending a connected balance (AGL-3677)', () => {
  it('reads the balance from the account, holds it, debits with the sale, and sends the spend once', async () => {
    await connect('smile')
    await seedMember('pat@example.com', { points: 0 })
    members.set('pat@example.com', { id: '42', email: 'pat@example.com', points: 1_000, history: [] })

    const account = await resolveLoyaltyCredit({ hostId: HOST, code: 'RW-AAAA-BBBB-CCCC', channel: 'online', customerEmail: null, staff: false })
    expect(account).toMatchObject({ ok: true, availableCents: 1_000 })
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 1_000 })

    const reference = (account as { reference: string }).reference
    const hold = await holdLoyaltyCredit({ hostId: HOST, reference, holdKey: 'attempt-1', maxCents: 600, currency: 'usd', customerEmail: null, nowMs: Date.now() })
    expect(hold).toEqual({ ok: true, cents: 600 })

    const taken = await db.runTransaction(async (transaction) => {
      const stage = await stageLoyaltyCredit({ transaction, hostId: HOST, reference, orderId: 'cs_live_2', nowMs: Date.now(), holdKey: 'attempt-1' })
      return stage!.debit({ cents: 600, key: 'attempt-1', orderId: 'cs_live_2', channel: 'online' })
    })
    expect(taken).toBe(600)
    calls = []
    await earnForOrder(
      envelope({
        order: order({
          id: 'cs_live_2',
          totals: { itemsCents: 10_000, discountCents: 600, totalCents: 9_400 },
          credits: [{ providerId: 'loyalty.rewards', reference, amountCents: 600, appliedAs: 'discount' }],
        }),
      }),
    )
    const sentPoints = adjustCalls().map((call) => call.body.points_transaction.points_change).sort((a, b) => a - b)
    expect(sentPoints).toEqual([-600, 470])
    expect(members.get('pat@example.com')?.points).toBe(870)

    // A refund of the whole order gives the spent points back and takes the earned ones.
    calls = []
    await reverseForOrder(envelope({ order: order({ id: 'cs_live_2', status: 'refunded', refundedCents: 9_400, credits: [{ providerId: 'loyalty.rewards', reference, amountCents: 600, appliedAs: 'discount' }] }) }, 'evt-r'), 'refunded')
    expect(adjustCalls().map((call) => call.body.points_transaction.points_change).sort((a, b) => a - b)).toEqual([-470, 600])
    expect(members.get('pat@example.com')?.points).toBe(1_000)
  })

  it('refuses rather than spend a balance it cannot read, and refuses referral codes', async () => {
    await connect('smile')
    await seedMember('pat@example.com', { points: 5_000 })
    nextStatus.push(503)
    const unreachable = await resolveLoyaltyCredit({ hostId: HOST, code: 'RW-AAAA-BBBB-CCCC', channel: 'online', customerEmail: null, staff: false })
    expect(unreachable).toMatchObject({ ok: false, status: 409 })
    const referral = await resolveLoyaltyCredit({ hostId: HOST, code: 'RF-AAAAAA', channel: 'online', customerEmail: 'friend@example.com', staff: false })
    expect(referral).toMatchObject({ ok: false, status: 409 })
  })

  it('a register give-back reaches the account once per key', async () => {
    await connect('yotpo')
    await seedMember('pat@example.com')
    members.set('pat@example.com', { id: '7', email: 'pat@example.com', points: 500, history: [] })
    const account = await resolveLoyaltyCredit({ hostId: HOST, code: 'RW-AAAA-BBBB-CCCC', channel: 'pos', customerEmail: null, staff: true })
    const reference = (account as { reference: string }).reference
    await db.runTransaction(async (transaction) => {
      const stage = await stageLoyaltyCredit({ transaction, hostId: HOST, reference, orderId: 'pos-1', nowMs: Date.now() })
      return stage!.debit({ cents: 300, key: 'pay-1', orderId: 'pos-1', channel: 'pos' })
    })
    await sendLoyaltySync({ orgId: ORG, hostId: HOST, orderId: 'pos-1' })
    expect(members.get('pat@example.com')?.points).toBe(200)
    await restoreLoyaltyCredit({ hostId: HOST, reference, orderId: 'pos-1', cents: 100, key: 'return-1' })
    await restoreLoyaltyCredit({ hostId: HOST, reference, orderId: 'pos-1', cents: 100, key: 'return-1' })
    expect(members.get('pat@example.com')?.points).toBe(300)
  })

  it('a hand adjustment in the console goes to the account', async () => {
    await connect('yotpo')
    await seedMember('pat@example.com')
    members.set('pat@example.com', { id: '7', email: 'pat@example.com', points: 0, history: [] })
    const response = await memberRoute(
      new Request(`https://console.test/api/loyalty/member`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin', 'content-type': 'application/json', 'idempotency-key': 'press-1' },
        body: JSON.stringify({ hostId: HOST, memberId: memberKeyFor(HOST, 'pat@example.com'), points: 25 }),
      }),
    )
    expect(response.status).toBe(200)
    expect(members.get('pat@example.com')?.points).toBe(25)
    expect(adjustCalls()[0].body).toMatchObject({ point_adjustment_amount: 25, apply_adjustment_to_points_earned: true })
  })
})

describe('sending exactly once (AGL-3677)', () => {
  it('a sender that died mid-call is found in the vendor’s history, not sent twice', async () => {
    await connect('smile')
    members.set('pat@example.com', { id: '42', email: 'pat@example.com', points: 0, history: [] })
    // The first send lands at Smile, then the process dies before marking the row.
    await earnForOrder(envelope({ order: order() }))
    const path = `orgs/${ORG}/loyaltySync/${HOST}__earn__cs_live_1`
    const row = db.docs.get(path)!
    db.docs.set(path, { ...row, status: 'sending', claimId: 'dead', claimedAtMs: Date.now() - LOYALTY_SYNC_CLAIM_STALE_MS - 1 })
    calls = []
    const result = await sendLoyaltySync({ orgId: ORG, hostId: HOST })
    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(adjustCalls()).toHaveLength(0)
    expect(members.get('pat@example.com')?.points).toBe(450)
    expect(members.get('pat@example.com')?.history.map((entry) => entry.note)).toEqual([`Rewards ref ${loyaltySyncRef(`${HOST}__earn__cs_live_1`)}`])
  })

  it('a live claim is left to its sender', async () => {
    await connect('smile')
    members.set('pat@example.com', { id: '42', email: 'pat@example.com', points: 0, history: [] })
    nextStatus.push(503, 503)
    await earnForOrder(envelope({ order: order() }))
    const path = `orgs/${ORG}/loyaltySync/${HOST}__earn__cs_live_1`
    // The order's own pass tried once; the sweep behind it waits out the backoff.
    expect(db.docs.get(path)).toMatchObject({ status: 'retry', attempts: 1 })
    db.docs.set(path, { ...db.docs.get(path)!, status: 'sending', claimId: 'other', claimedAtMs: Date.now() })
    calls = []
    expect(await sendLoyaltySync({ orgId: ORG, hostId: HOST })).toEqual({ sent: 0, failed: 0 })
    expect(calls).toHaveLength(0)
  })

  it('refused credentials stop the pass and show on the card', async () => {
    await connect('yotpo')
    authOk = false
    await earnForOrder(envelope({ order: order() }))
    const answer = await (await call()).json()
    expect(answer.connection.lastError).toMatch(/refused the connection’s credentials/)
    expect(answer.attention).toEqual([expect.objectContaining({ status: 'retry' })])
  })
})

describe('disconnecting and erasure (AGL-3677)', () => {
  it('closes what was waiting, clears the points, turns the program off and drops the key', async () => {
    await connect('yotpo')
    authOk = false
    await earnForOrder(envelope({ order: order() }))
    authOk = true
    const refused = await call({ action: 'disconnect' })
    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ confirmRequired: true })
    expect(program()?.['connected']).toBe('yotpo')
    const answer = await (await call({ action: 'disconnect', confirm: true })).json()
    expect(answer.connection).toBeNull()
    expect(db.docs.get(`orgs/${ORG}/loyaltyConnections/${HOST}`)).toBeUndefined()
    expect(program()).toMatchObject({ connected: null, enabled: false })
    expect(syncRow('earn__cs_live_1')).toMatchObject({ status: 'skipped' })
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 0 })
    calls = []
    expect(await sendLoyaltySync({ orgId: ORG, hostId: HOST, force: true })).toEqual({ sent: 0, failed: 0 })
    expect(calls).toHaveLength(0)
  })

  it('never destroys built-in balances: connect → earn at the vendor → disconnect gives back exactly what members held, and store credit is untouched', async () => {
    await seedMember('pat@example.com', { points: 800, creditCents: 2_500, lifetimePoints: 900 })
    await seedMember('sam@example.com', { points: -20, creditCents: 0, rewardsCode: 'RW-SSSS-SSSS-SSSS' })
    members.set('pat@example.com', { id: '1', email: 'pat@example.com', points: 3_000, history: [] })
    expect((await connect('yotpo', { replaceBalances: true })).status).toBe(200)

    // While connected the balance is the account's, and an order earns there.
    const account = await resolveLoyaltyCredit({ hostId: HOST, code: 'RW-AAAA-BBBB-CCCC', channel: 'online', customerEmail: null, staff: false })
    expect(account).toMatchObject({ ok: true })
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 3_000, parkedPoints: 800, creditCents: 2_500 })
    await earnForOrder(envelope({ order: order() }))
    expect(members.get('pat@example.com')?.points).toBe(3_450)

    // Switching accounts keeps what was parked at the first connect.
    await connect('smile', { replaceBalances: true })
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 0, parkedPoints: 800 })

    await call({ action: 'disconnect', confirm: true })
    const pat = memberDoc('pat@example.com')!
    expect(pat).toMatchObject({ points: 800, creditCents: 2_500 })
    expect(pat).not.toHaveProperty('parked')
    expect(pat).not.toHaveProperty('parkedPoints')
    expect(memberDoc('sam@example.com')).toMatchObject({ points: -20, creditCents: 0 })
    // What was earned at the vendor stays at the vendor.
    expect(members.get('pat@example.com')?.points).toBe(3_450)
  })

  it('a member written whole while parked keeps what was parked', async () => {
    await seedMember('pat@example.com', { points: 800 })
    await connect('yotpo', { replaceBalances: true })
    members.set('pat@example.com', { id: '1', email: 'pat@example.com', points: 0, history: [] })
    await memberRoute(
      new Request(`https://console.test/api/loyalty/member`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin', 'content-type': 'application/json', 'idempotency-key': 'p' },
        body: JSON.stringify({ hostId: HOST, memberId: memberKeyFor(HOST, 'pat@example.com'), points: 10, creditCents: 100 }),
      }),
    )
    expect(memberDoc('pat@example.com')).toMatchObject({ parked: true, parkedPoints: 800, creditCents: 100 })
    await call({ action: 'disconnect', confirm: true })
    expect(memberDoc('pat@example.com')).toMatchObject({ points: 800, creditCents: 100 })
  })

  it('erasing a person erases the movements that name their address', async () => {
    await connect('yotpo')
    authOk = false
    await earnForOrder(envelope({ order: order() }))
    const report = await eraseLoyaltyPerson({ orgId: ORG, email: 'pat@example.com' } as never)
    expect(report).toMatchObject({ members: 1, syncRows: 1 })
    expect(syncRow('earn__cs_live_1')).toBeUndefined()
  })
})
