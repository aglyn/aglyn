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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { LOYALTY_PROGRAM_DEFAULTS } from '../model/loyalty-program'
import {
  holdLoyaltyCredit,
  lookupLoyaltyCredit,
  releaseLoyaltyCredit,
  resolveLoyaltyCredit,
  restoreLoyaltyCredit,
  stageLoyaltyCredit,
} from './credit-provider'
import { keyId, memberKeyFor, setLoyaltyDbForTests, setLoyaltyRandomBytesForTests } from './db'
import { setLoyaltyEmailSenderForTests, type LoyaltyEmail } from './emails'
import { earnBasisCents, earnForOrder, reverseForOrder, type LoyaltyEventOrder } from './order-events'
import { eraseLoyaltyPerson } from './person-eraser'
import { forgetLoyaltyProgramCache, loyaltyProgramIsOn } from './program-store'
import { setLoyaltySiteResolverForTests } from './site-context'

/**
 * Loyalty's server half through its doors (AGL-3640): the checkout credit
 * commerce reaches through core's seam — resolve, hold, stage-and-debit in the
 * seller's own transaction, reverse, restore, lookup — and the order events
 * that earn and take back points and give back spent rewards. An in-memory
 * Firestore; nothing leaves the process.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  getOrgForHost: async () => null,
  getHostDocAdmin: async () => null,
  logHostActivity: async () => undefined,
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))
jest.mock('@aglyn/aglyn/server', () => ({ resolveBrandingProfile: () => ({ fromName: 'Candles' }) }))
jest.mock('@aglyn/shared-util-email', () => ({ isEmailConfigured: () => true, sendEmail: async () => undefined }))

const ORG = 'org-candles'
const HOST = 'host-candles'
let db: MemoryFirestore
let sent: LoyaltyEmail[]
let byte = 0

const PROGRAM = { ...LOYALTY_PROGRAM_DEFAULTS, enabled: true }

async function setProgram(overrides: Partial<typeof PROGRAM> = {}) {
  await db.collection('orgs').doc(ORG).collection('loyaltyPrograms').doc(HOST).set({ ...PROGRAM, ...overrides })
  forgetLoyaltyProgramCache()
}

function member(email: string) {
  return db.docs.get(`orgs/${ORG}/loyaltyMembers/${HOST}__${memberKeyFor(HOST, email)}`)
}

function ledger(entryKey: string) {
  return db.docs.get(`orgs/${ORG}/loyaltyLedger/${HOST}__${entryKey}`)
}

async function seedMember(email: string, fields: Record<string, unknown>) {
  const key = memberKeyFor(HOST, email)
  const rewardsCode = String(fields['rewardsCode'] ?? 'RW-AAAA-BBBB-CCCC')
  const referralCode = String(fields['referralCode'] ?? 'RF-AAAAAA')
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
      rewardsCode,
      referralCode,
      referredBy: null,
      holds: {},
      createdAtMs: 1,
      updatedAtMs: 1,
      lastOrderAtMs: null,
      ...fields,
    })
  await db.collection('orgs').doc(ORG).collection('loyaltyCodes').doc(`${HOST}__${rewardsCode}`).set({ kind: 'rewards', memberKey: key, hostId: HOST })
  await db.collection('orgs').doc(ORG).collection('loyaltyCodes').doc(`${HOST}__${referralCode}`).set({ kind: 'referral', memberKey: key, hostId: HOST })
  return key
}

function order(overrides: Partial<LoyaltyEventOrder> = {}): LoyaltyEventOrder {
  return {
    id: 'cs_test_1',
    status: 'paid',
    channel: 'online',
    customerEmail: 'pat@example.com',
    customerName: 'Pat',
    totals: { itemsCents: 10_000, discountCents: 1_000, totalCents: 9_900 },
    refundedCents: 0,
    credits: [],
    ...overrides,
  }
}

function envelope<P>(payload: P, id = 'evt-1'): PluginDomainEventEnvelope<P> {
  return { id, event: 'order.paid', hostId: HOST, orgId: ORG, occurredAtMs: 1, attempt: 1, payload }
}

async function settle(reference: string, orderId: string, cents: number, options: { holdKey?: string; key?: string; channel?: 'online' | 'pos' } = {}) {
  return db.runTransaction(async (transaction) => {
    const stage = await stageLoyaltyCredit({
      transaction,
      hostId: HOST,
      reference,
      orderId,
      nowMs: Date.now(),
      ...(options.holdKey ? { holdKey: options.holdKey } : {}),
    })
    if (!stage) return { taken: -1, available: 0 }
    const available = stage.availableCents
    const taken = stage.debit({ cents, key: options.key ?? options.holdKey ?? 'k', orderId, channel: options.channel ?? 'online' })
    return { taken, available }
  })
}

beforeEach(async () => {
  db = createMemoryFirestore()
  sent = []
  byte = 0
  setLoyaltyDbForTests(db)
  setLoyaltyRandomBytesForTests((size) => Uint8Array.from({ length: size }, () => (byte += 3)))
  setLoyaltyEmailSenderForTests(async (email) => {
    sent.push(email)
    return true
  })
  setLoyaltySiteResolverForTests(async (hostId) =>
    hostId === HOST ? { orgId: ORG, org: { name: 'Candles' }, host: { memberRoles: {} } } : null,
  )
  await setProgram()
})

afterEach(() => {
  setLoyaltyDbForTests(null)
  setLoyaltyRandomBytesForTests(null)
  setLoyaltyEmailSenderForTests(null)
  setLoyaltySiteResolverForTests(null)
})

describe('earning on order.paid (AGL-3640)', () => {
  it('enrolls the buyer, earns on goods after discounts, and emails their code — once per order', async () => {
    await earnForOrder(envelope({ order: order() }))
    const pat = member('pat@example.com')
    expect(pat).toMatchObject({ email: 'pat@example.com', name: 'Pat', points: 450, lifetimePoints: 450, ordersCount: 1 })
    expect(pat?.['rewardsCode']).toMatch(/^RW-/)
    expect(pat?.['referralCode']).toMatch(/^RF-/)
    expect(db.docs.get(`orgs/${ORG}/loyaltyCodes/${HOST}__${pat?.['rewardsCode']}`)).toMatchObject({ kind: 'rewards' })
    expect(ledger('earn__cs_test_1')).toMatchObject({ kind: 'earn', points: 450, basisCents: 9_000, reversedPoints: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ key: 'loyalty-points-earned', to: 'pat@example.com' })
    expect(sent[0].tokens['loyalty.points']).toBe('450')
    expect(sent[0].tokens['loyalty.code']).toBe(pat?.['rewardsCode'])

    await earnForOrder(envelope({ order: order() }, 'evt-1-redelivered'))
    expect(member('pat@example.com')).toMatchObject({ points: 450, ordersCount: 1 })
    expect(sent).toHaveLength(1)
  })

  it('earns nothing while the program is off, and nothing without an email', async () => {
    await setProgram({ enabled: false })
    await earnForOrder(envelope({ order: order() }))
    expect(member('pat@example.com')).toBeUndefined()
    await setProgram()
    await earnForOrder(envelope({ order: order({ customerEmail: null }) }))
    expect(db.docs.size).toBeGreaterThan(0)
    expect([...db.docs.keys()].some((path) => path.includes('loyaltyMembers'))).toBe(false)
  })

  it('never earns on what the member’s own rewards paid at the register', () => {
    const basis = earnBasisCents(
      order({
        channel: 'pos',
        totals: { itemsCents: 5_000, discountCents: 0, totalCents: 5_400 },
        credits: [
          { providerId: 'loyalty.rewards', reference: 'm:x', amountCents: 2_000, appliedAs: 'tender' },
          { providerId: 'other.credit', reference: 'x', amountCents: 500, appliedAs: 'tender' },
        ],
      }),
    )
    expect(basis).toBe(3_000)
  })

  it('gives welcome points with the first order only', async () => {
    await setProgram({ welcomePoints: 100 })
    await earnForOrder(envelope({ order: order() }))
    await earnForOrder(envelope({ order: order({ id: 'cs_test_2' }) }))
    expect(member('pat@example.com')).toMatchObject({ points: 100 + 450 + 450, ordersCount: 2 })
    expect(ledger(`welcome__${memberKeyFor(HOST, 'pat@example.com')}`)).toMatchObject({ kind: 'welcome', points: 100 })
  })
})

describe('refunds and cancellations take earned points back to a target', () => {
  it('reverses in proportion, converges on redelivery, and takes the rest on a cancel', async () => {
    await earnForOrder(envelope({ order: order() }))
    const refunded = order({ refundedCents: 4_950 })
    await reverseForOrder(envelope({ order: refunded, refund: { full: false } }, 'evt-r1'), 'refunded')
    expect(member('pat@example.com')).toMatchObject({ points: 225 })
    await reverseForOrder(envelope({ order: refunded, refund: { full: false } }, 'evt-r1'), 'refunded')
    expect(member('pat@example.com')).toMatchObject({ points: 225 })
    await reverseForOrder(envelope({ order: order({ status: 'cancelled', refundedCents: 4_950 }) }, 'evt-c'), 'cancelled')
    expect(member('pat@example.com')).toMatchObject({ points: 0 })
    expect(ledger('earn__cs_test_1')).toMatchObject({ reversedPoints: 450 })
  })

  it('lets a balance fall below zero when the points were already spent', async () => {
    await earnForOrder(envelope({ order: order() }))
    const key = memberKeyFor(HOST, 'pat@example.com')
    await settle(`m:${key}`, 'cs_spend', 450)
    await reverseForOrder(envelope({ order: order({ refundedCents: 9_900, status: 'refunded' }), refund: { full: true } }), 'refunded')
    expect(member('pat@example.com')).toMatchObject({ points: -450 })
  })
})

describe('the rewards credit, online', () => {
  it('resolves a code to the member’s spendable balance, credit and points together', async () => {
    const key = await seedMember('sam@example.com', { points: 500, creditCents: 300 })
    const account = await resolveLoyaltyCredit({ hostId: HOST, code: 'rw aaaa bbbb cccc', channel: 'online', customerEmail: null, staff: false })
    expect(account).toMatchObject({ ok: true, reference: `m:${key}`, label: 'Rewards', last4: 'CCCC', availableCents: 800 })
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, code: 'RW-ZZZZ-ZZZZ-ZZZZ', channel: 'online', customerEmail: null, staff: false }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
  })

  it('a shopper can never name an account by reference; staff at the register can', async () => {
    const key = await seedMember('sam@example.com', { points: 500 })
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, channel: 'online', customerEmail: null, staff: false }),
    ).resolves.toMatchObject({ ok: false })
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, channel: 'pos', customerEmail: null, staff: true }),
    ).resolves.toMatchObject({ ok: true, availableCents: 500 })
  })

  it('says nothing is offered while the program is off', async () => {
    await setProgram({ enabled: false })
    await seedMember('sam@example.com', { points: 500 })
    await expect(loyaltyProgramIsOn(HOST)).resolves.toBe(false)
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, code: 'RW-AAAA-BBBB-CCCC', channel: 'online', customerEmail: null, staff: false }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
  })

  it('holds against what is left to pay, so two checkouts cannot spend the same balance', async () => {
    const key = await seedMember('sam@example.com', { points: 500, creditCents: 300 })
    const ref = `m:${key}`
    const first = await holdLoyaltyCredit({ hostId: HOST, reference: ref, holdKey: 'a', maxCents: 600, currency: 'usd', customerEmail: null, nowMs: Date.now() })
    expect(first).toEqual({ ok: true, cents: 600 })
    // A retry of the same attempt re-places its own hold rather than adding one.
    await expect(
      holdLoyaltyCredit({ hostId: HOST, reference: ref, holdKey: 'a', maxCents: 600, currency: 'usd', customerEmail: null, nowMs: Date.now() }),
    ).resolves.toEqual({ ok: true, cents: 600 })
    await expect(
      holdLoyaltyCredit({ hostId: HOST, reference: ref, holdKey: 'b', maxCents: 1_000, currency: 'usd', customerEmail: null, nowMs: Date.now() }),
    ).resolves.toEqual({ ok: true, cents: 200 })
    await releaseLoyaltyCredit({ hostId: HOST, reference: ref, holdKey: 'b' })
    expect(Object.keys((member('sam@example.com')?.['holds'] ?? {}) as object)).toHaveLength(1)
  })

  it('refuses points below the minimum, in words', async () => {
    const key = await seedMember('sam@example.com', { points: 60 })
    await expect(
      holdLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, holdKey: 'a', maxCents: 600, currency: 'usd', customerEmail: null, nowMs: Date.now() }),
    ).resolves.toEqual({ ok: false, status: 409, error: 'Rewards can be used from 100 points; this account has 60.' })
  })

  it('takes the hold inside the seller’s transaction: once, with the hold let go and the ledger written', async () => {
    const key = await seedMember('sam@example.com', { points: 500, creditCents: 300 })
    const ref = `m:${key}`
    await holdLoyaltyCredit({ hostId: HOST, reference: ref, holdKey: 'attempt-1', maxCents: 600, currency: 'usd', customerEmail: null, nowMs: Date.now() })
    await expect(settle(ref, 'cs_paid', 600, { holdKey: 'attempt-1' })).resolves.toEqual({ taken: 600, available: 800 })
    expect(member('sam@example.com')).toMatchObject({ creditCents: 0, points: 200, holds: {} })
    const redemption = db.docs.get(`orgs/${ORG}/loyaltyRedemptions/${HOST}__cs_paid__${key}`)
    expect(redemption).toMatchObject({ cents: 600, creditCents: 300, points: 300, orderId: 'cs_paid', hostId: HOST })
    // A second settle of the same attempt takes nothing more.
    await expect(settle(ref, 'cs_paid', 600, { holdKey: 'attempt-1' })).resolves.toMatchObject({ taken: 600 })
    expect(member('sam@example.com')).toMatchObject({ creditCents: 0, points: 200 })
  })

  it('honors a sale’s own hold even after the store raised its minimum', async () => {
    const key = await seedMember('sam@example.com', { points: 150 })
    await holdLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, holdKey: 'h', maxCents: 150, currency: 'usd', customerEmail: null, nowMs: Date.now() })
    await setProgram({ minRedeemPoints: 1_000 })
    await expect(settle(`m:${key}`, 'cs_1', 150, { holdKey: 'h' })).resolves.toMatchObject({ taken: 150 })
    expect(member('sam@example.com')).toMatchObject({ points: 0 })
  })

  it('gives online rewards back in proportion to a refund, and the rest on a cancel', async () => {
    const key = await seedMember('sam@example.com', { points: 1_000, creditCents: 1_000 })
    await settle(`m:${key}`, 'cs_r', 2_000, { holdKey: 'h' })
    const credits = [{ providerId: 'loyalty.rewards', reference: `m:${key}`, amountCents: 2_000, appliedAs: 'discount' as const }]
    const base = order({ id: 'cs_r', customerEmail: 'sam@example.com', totals: { itemsCents: 10_000, discountCents: 2_000, totalCents: 8_000 }, credits })
    await reverseForOrder(envelope({ order: { ...base, refundedCents: 4_000 }, refund: { full: false } }, 'r1'), 'refunded')
    expect(member('sam@example.com')).toMatchObject({ creditCents: 500, points: 500 })
    await reverseForOrder(envelope({ order: { ...base, refundedCents: 4_000 }, refund: { full: false } }, 'r1'), 'refunded')
    expect(member('sam@example.com')).toMatchObject({ creditCents: 500, points: 500 })
    await reverseForOrder(envelope({ order: { ...base, status: 'cancelled', refundedCents: 4_000 } }, 'c1'), 'cancelled')
    expect(member('sam@example.com')).toMatchObject({ creditCents: 1_000, points: 1_000 })
  })
})

describe('the rewards credit, at the register', () => {
  it('a voided payment gives back exactly what it took', async () => {
    const key = await seedMember('sam@example.com', { points: 400, creditCents: 100 })
    await settle(`m:${key}`, 'pos_1', 300, { key: 'pay-1', channel: 'pos' })
    expect(member('sam@example.com')).toMatchObject({ creditCents: 0, points: 200 })
    const reversed = await db.runTransaction(async (transaction) => {
      const stage = await stageLoyaltyCredit({ transaction, hostId: HOST, reference: `m:${key}`, orderId: 'pos_1', nowMs: Date.now() })
      return stage?.reverse({ key: 'pay-1', orderId: 'pos_1' })
    })
    expect(reversed).toBe(300)
    expect(member('sam@example.com')).toMatchObject({ creditCents: 100, points: 400 })
    expect(ledger(`void__pos_1__${keyId('pay-1')}`)).toMatchObject({ kind: 'void', points: 200, creditCents: 100 })
  })

  it('a register refund restores once per key and never past what was spent', async () => {
    const key = await seedMember('sam@example.com', { points: 0, creditCents: 1_000 })
    await settle(`m:${key}`, 'pos_2', 600, { key: 'pay-1', channel: 'pos' })
    await expect(restoreLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, orderId: 'pos_2', cents: 200, key: 'ret-1' })).resolves.toBe(200)
    await expect(restoreLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, orderId: 'pos_2', cents: 200, key: 'ret-1' })).resolves.toBe(0)
    await expect(restoreLoyaltyCredit({ hostId: HOST, reference: `m:${key}`, orderId: 'pos_2', cents: 900, key: 'ret-2' })).resolves.toBe(400)
    expect(member('sam@example.com')).toMatchObject({ creditCents: 1_000 })
  })

  it('finds members for staff by email, by the start of one, and by code', async () => {
    await seedMember('sam@example.com', { points: 300 })
    await seedMember('sandy@example.com', { points: 100, rewardsCode: 'RW-DDDD-EEEE-FFFF', referralCode: 'RF-BBBBBB' })
    await expect(lookupLoyaltyCredit({ hostId: HOST, query: 'sam@example.com' })).resolves.toHaveLength(1)
    const prefix = await lookupLoyaltyCredit({ hostId: HOST, query: 'sa' })
    expect(prefix.map((account) => account.detail?.split(' · ')[0])).toEqual(['sam@example.com', 'sandy@example.com'])
    const byCode = await lookupLoyaltyCredit({ hostId: HOST, query: 'RW-DDDD-EEEE-FFFF' })
    expect(byCode[0]).toMatchObject({ last4: 'FFFF', availableCents: 100 })
  })
})

describe('referrals', () => {
  beforeEach(async () => {
    await setProgram({ referralsEnabled: true, refereeRewardCents: 1_000, referrerRewardCents: 1_500 })
  })

  it('a friend’s first order takes the credit, and the member who shared it is rewarded once', async () => {
    const referrerKey = await seedMember('sam@example.com', { points: 0 })
    const account = await resolveLoyaltyCredit({
      hostId: HOST,
      code: 'RF-AAAAAA',
      channel: 'online',
      customerEmail: 'friend@example.com',
      staff: false,
    })
    expect(account).toMatchObject({ ok: true, label: 'Referral credit', availableCents: 1_000 })
    const reference = (account as { reference: string }).reference
    await expect(
      holdLoyaltyCredit({ hostId: HOST, reference, holdKey: 'f1', maxCents: 5_000, currency: 'usd', customerEmail: 'friend@example.com', nowMs: Date.now() }),
    ).resolves.toEqual({ ok: true, cents: 1_000 })
    await expect(
      holdLoyaltyCredit({ hostId: HOST, reference, holdKey: 'f2', maxCents: 5_000, currency: 'usd', customerEmail: 'friend@example.com', nowMs: Date.now() }),
    ).resolves.toMatchObject({ ok: false, error: 'This referral is already being used in another checkout.' })
    await expect(settle(reference, 'cs_friend', 1_000, { holdKey: 'f1' })).resolves.toMatchObject({ taken: 1_000 })

    const paid = order({
      id: 'cs_friend',
      customerEmail: 'friend@example.com',
      customerName: 'Fran',
      totals: { itemsCents: 5_000, discountCents: 1_000, totalCents: 4_000 },
      credits: [{ providerId: 'loyalty.rewards', reference, amountCents: 1_000, appliedAs: 'discount' }],
    })
    await earnForOrder(envelope({ order: paid }))
    await earnForOrder(envelope({ order: paid }, 'again'))
    expect(db.docs.get(`orgs/${ORG}/loyaltyMembers/${HOST}__${referrerKey}`)).toMatchObject({ creditCents: 1_500 })
    expect(member('friend@example.com')).toMatchObject({ referredBy: referrerKey, points: 200 })
    expect(sent.map((email) => email.key).sort()).toEqual(['loyalty-points-earned', 'loyalty-referral-reward'])

    // A second order from the friend is not a first order.
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, code: 'RF-AAAAAA', channel: 'online', customerEmail: 'friend@example.com', staff: false }),
    ).resolves.toMatchObject({ ok: false, error: 'A referral code is for a first order.' })
  })

  it('refuses the member’s own code, a friend with no email, and a store with referrals off', async () => {
    await seedMember('sam@example.com', {})
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, code: 'RF-AAAAAA', channel: 'online', customerEmail: 'sam@example.com', staff: false }),
    ).resolves.toMatchObject({ ok: false, status: 409 })
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, code: 'RF-AAAAAA', channel: 'pos', customerEmail: null, staff: true }),
    ).resolves.toEqual({ ok: false, status: 400, error: 'Add the customer’s email to the sale to use a referral code.' })
    await setProgram({ referralsEnabled: false })
    await expect(
      resolveLoyaltyCredit({ hostId: HOST, code: 'RF-AAAAAA', channel: 'online', customerEmail: 'friend@example.com', staff: false }),
    ).resolves.toMatchObject({ ok: false, status: 409 })
  })

  it('refuses an order under the friend’s minimum', async () => {
    await setProgram({ referralsEnabled: true, refereeMinimumCents: 5_000 })
    await seedMember('sam@example.com', {})
    const account = await resolveLoyaltyCredit({ hostId: HOST, code: 'RF-AAAAAA', channel: 'online', customerEmail: 'friend@example.com', staff: false })
    await expect(
      holdLoyaltyCredit({ hostId: HOST, reference: (account as { reference: string }).reference, holdKey: 'f', maxCents: 4_000, currency: 'usd', customerEmail: 'friend@example.com', nowMs: Date.now() }),
    ).resolves.toEqual({ ok: false, status: 409, error: 'Referral credit applies to orders of $50.00 or more.' })
  })
})

describe('erasing a person', () => {
  it('removes their membership and the codes that spend for them', async () => {
    const key = await seedMember('sam@example.com', { points: 300 })
    await expect(
      eraseLoyaltyPerson({ orgId: ORG, email: 'sam@example.com', key: 'k', dryRun: true, atMs: 1, contactIds: [] }),
    ).resolves.toEqual({ members: 1 })
    expect(member('sam@example.com')).toBeDefined()
    await expect(
      eraseLoyaltyPerson({ orgId: ORG, email: 'sam@example.com', key: 'k', dryRun: false, atMs: 1, contactIds: [] }),
    ).resolves.toEqual({ members: 1 })
    expect(member('sam@example.com')).toBeUndefined()
    expect(db.docs.get(`orgs/${ORG}/loyaltyCodes/${HOST}__RW-AAAA-BBBB-CCCC`)).toBeUndefined()
    expect(key).toHaveLength(32)
  })
})
