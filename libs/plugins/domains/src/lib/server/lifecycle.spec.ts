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

import { MemoryFirestore } from '../testing/memory-firestore'

const mockStore = { current: new MemoryFirestore() }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockStore.current }) },
  readOrgBilling: async () => ({}),
}))

import type { DomainRegistrationDoc } from '../model/registration'
import { readRegistration, registrationRef } from './db'
import type { DomainsActor } from './gates'
import {
  advanceRenewal,
  invalidContactFields,
  normalizePhone,
  purchaseDomain,
  reconcileOrphans,
  runDomainsSweep,
  type DomainAlertKind,
  type DomainEmailKind,
  type LifecycleEffects,
} from './lifecycle'
import type { RegistrarDriver, RegistrarQuote, RegistrarResult } from './registrar'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-11-01T12:00:00Z')

const yes = <T>(value: T): RegistrarResult<T> => ({ ok: 'yes', value })
const no = (code: string, retryable = false): RegistrarResult<never> => ({
  ok: 'no',
  code,
  retryable,
})

const QUOTE: RegistrarQuote = {
  domain: 'testbakery.com',
  available: true,
  premium: false,
  years: 1,
  purchaseUsd: 11.25,
  renewalUsd: 11.25,
}

function fakeDriver(overrides: Partial<RegistrarDriver> = {}): jest.Mocked<RegistrarDriver> {
  const driver: RegistrarDriver = {
    id: 'fake',
    configured: () => true,
    search: async (domains) => yes(domains.map((domain) => ({ ...QUOTE, domain }))),
    standardContact: async () => yes(true),
    buy: async () => yes({ orderId: 'order-1' }),
    order: async (orderId) => yes({ orderId, status: 'completed' }),
    renew: async () => yes({ orderId: 'renew-1' }),
    renewalPrice: async () => yes(11.25),
    setAutoRenew: async () => yes(true as const),
    info: async () =>
      yes({ owned: true, registeredAtMs: T0, expiresAtMs: T0 + 365 * DAY, autoRenew: true }),
    contactVerification: async () => yes({ verified: true, verifyByMs: null, email: null }),
    authCode: async () => yes('AUTH'),
    listOwned: async () => yes([]),
    transferPrice: async () => yes(11.25),
    transferIn: async () => yes({ orderId: 'transfer-1' }),
    transferStatus: async () => yes({ status: 'pending' as const, state: 'pending_transfer' }),
    nameservers: async () =>
      yes({ ours: true, nameservers: ['ns1.vercel-dns.com'], intended: ['ns1.vercel-dns.com'] }),
    listDnsRecords: async () => yes([]),
    createDnsRecord: async () => yes({ id: 'rec-1' }),
    updateDnsRecord: async () => yes(true as const),
    deleteDnsRecord: async () => yes(true as const),
    ...overrides,
  }
  for (const key of Object.keys(driver) as (keyof RegistrarDriver)[]) {
    const value = driver[key]
    if (typeof value === 'function') {
      ;(driver as never as Record<string, unknown>)[key] = jest.fn(value as (...args: never[]) => unknown)
    }
  }
  return driver as jest.Mocked<RegistrarDriver>
}

interface Recorded {
  emails: { kind: DomainEmailKind; merge: Record<string, string> }[]
  alerts: DomainAlertKind[]
  charges: { amountCents: number; kind: string; attemptKey: string }[]
  refunds: string[]
  connects: string[]
  disconnects: string[]
  /** Preclearance ids the purchase spent, in order. */
  consumed: string[]
}

function effectsWith(
  driver: RegistrarDriver,
  options: {
    charge?: LifecycleEffects['charge']
    connect?: LifecycleEffects['connect']
    consumePreclearance?: LifecycleEffects['consumePreclearance']
  } = {},
): { effects: LifecycleEffects; recorded: Recorded } {
  const recorded: Recorded = {
    emails: [],
    alerts: [],
    charges: [],
    refunds: [],
    connects: [],
    disconnects: [],
    consumed: [],
  }
  let invoice = 0
  const effects: LifecycleEffects = {
    driver,
    now: () => Date.now(),
    async charge(request) {
      recorded.charges.push({
        amountCents: request.amountCents,
        kind: request.kind,
        attemptKey: request.attemptKey,
      })
      if (options.charge) return options.charge(request)
      invoice += 1
      return { ok: true, invoiceId: `in_${invoice}`, paidCents: request.amountCents, code: null }
    },
    async refund(invoiceId) {
      recorded.refunds.push(invoiceId)
      return { ok: true, refundedCents: 1599 }
    },
    async connect(request) {
      recorded.connects.push(request.domain)
      return options.connect ? options.connect(request) : { ok: 'connected' }
    },
    async disconnect(request) {
      recorded.disconnects.push(request.domain)
      return true
    },
    async email(kind, _registration, merge) {
      recorded.emails.push({ kind, merge })
    },
    async alert(kind) {
      recorded.alerts.push(kind)
    },
    async consumePreclearance(preclearanceId) {
      recorded.consumed.push(preclearanceId)
      return options.consumePreclearance ? options.consumePreclearance(preclearanceId) : true
    },
    sleep: async () => undefined,
  }
  return { effects, recorded }
}

const ACTOR: DomainsActor = {
  uid: 'user-1',
  email: 'alex@testbakery.com',
  name: 'Alex Test',
  staff: false,
  orgId: 'org-1',
  org: {},
  hostId: 'host-1',
  host: {},
}

const CONTACT = {
  firstName: 'Alex',
  lastName: 'Test',
  email: 'alex@testbakery.com',
  phone: '+1 (512) 555-0123',
  address1: '1 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  country: 'us',
}


beforeEach(() => {
  mockStore.current = new MemoryFirestore()
  jest.useFakeTimers({ now: T0 })
})

afterEach(() => jest.useRealTimers())

function buy(effects: LifecycleEffects, expected = 1599, preclearanceId?: string | null) {
  return purchaseDomain(effects, ACTOR, {
    domain: 'TestBakery.com',
    expectedFirstYearCents: expected,
    contact: CONTACT,
    ...(preclearanceId === undefined ? {} : { preclearanceId }),
  })
}

describe('buying a domain (AGL-3962)', () => {
  it('charges the price shown, registers at our cost, and connects the site', async () => {
    const driver = fakeDriver()
    const { effects, recorded } = effectsWith(driver)

    const outcome = await buy(effects)

    expect(outcome.ok).toBe('active')
    expect(recorded.charges).toEqual([
      expect.objectContaining({ amountCents: 1599, kind: 'domain-purchase' }),
    ])
    expect(driver.buy).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'testbakery.com',
        years: 1,
        expectedPriceUsd: 11.25,
        autoRenew: true,
        contact: expect.objectContaining({ phone: '+1.5125550123', country: 'US' }),
      }),
    )
    expect(recorded.connects).toEqual(['testbakery.com'])
    expect(recorded.emails.map((email) => email.kind)).toEqual(['purchased'])
    const saved = await readRegistration('testbakery.com')
    expect(saved).toMatchObject({
      status: 'active',
      orgId: 'org-1',
      hostId: 'host-1',
      autoRenew: true,
      firstYearCents: 1599,
      renewalCents: 1599,
      purchaseInvoiceId: 'in_1',
      invoiceIds: ['in_1'],
      expiresAtMs: T0 + 365 * DAY,
      registrant: { name: 'Alex Test', email: 'alex@testbakery.com' },
    })
    // The registrant's address and phone are the registrar's to hold.
    expect(JSON.stringify(saved)).not.toContain('Main St')
  })

  it('refuses a price that moved since the search, before holding or charging', async () => {
    const { effects, recorded } = effectsWith(
      fakeDriver({ search: async () => yes([{ ...QUOTE, purchaseUsd: 14 }]) }),
    )
    const outcome = await buy(effects)
    expect(outcome).toMatchObject({ ok: 'refused', code: 'price-changed', firstYearCents: 1999 })
    expect(recorded.charges).toEqual([])
    expect(await readRegistration('testbakery.com')).toBeNull()
  })

  it('refuses an ending that now wants more than the standard contact', async () => {
    const { effects, recorded } = effectsWith(fakeDriver({ standardContact: async () => yes(false) }))
    expect(await buy(effects)).toMatchObject({ ok: 'refused', code: 'needs-extra-contact' })
    expect(recorded.charges).toEqual([])
  })

  it('records a declined card and never orders the name', async () => {
    const driver = fakeDriver()
    const { effects } = effectsWith(driver, {
      charge: async () => ({ ok: false, invoiceId: 'in_x', paidCents: 0, code: 'declined' }),
    })
    expect(await buy(effects)).toMatchObject({ ok: 'refused', code: 'declined', status: 402 })
    expect(driver.buy).not.toHaveBeenCalled()
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'declined' })
  })

  it('refunds when the registrar refuses the order', async () => {
    const { effects, recorded } = effectsWith(
      fakeDriver({ buy: async () => no('domain_not_available') }),
    )
    expect(await buy(effects)).toMatchObject({ ok: 'refused', code: 'registration-failed' })
    expect(recorded.refunds).toEqual(['in_1'])
    expect(recorded.emails[0]).toMatchObject({
      kind: 'refunded',
      merge: expect.objectContaining({
        'domain.failure': expect.stringContaining('Someone else registered it'),
      }),
    })
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'refunded' })
  })

  it('does not refund a name the registrar registered behind a timeout', async () => {
    const { effects, recorded } = effectsWith(
      fakeDriver({ buy: async () => no('timeout', true) }),
    )
    const outcome = await buy(effects)
    expect(outcome.ok).toBe('active')
    expect(recorded.refunds).toEqual([])
  })

  it('refuses a second buyer of the same name while the first holds it', async () => {
    const { effects } = effectsWith(fakeDriver({ order: async (orderId) => yes({ orderId, status: 'pending' }) }))
    expect((await buy(effects)).ok).toBe('registering')
    expect(await buy(effects)).toMatchObject({ ok: 'refused', code: 'taken' })
  })

  it('leaves the site connecting when the attach can be retried, and refused when it cannot', async () => {
    const retry = effectsWith(fakeDriver(), {
      connect: async () => ({ ok: 'refused', code: 'attach-failed', retryable: true }),
    })
    expect((await buy(retry.effects)).ok).toBe('connecting')

    mockStore.current = new MemoryFirestore()
    const taken = effectsWith(fakeDriver(), {
      connect: async () => ({ ok: 'refused', code: 'taken', retryable: false }),
    })
    expect((await buy(taken.effects)).ok).toBe('active')
    expect(await readRegistration('testbakery.com')).toMatchObject({ failure: 'connect-taken' })
  })
})

describe('a purchase a staff preclearance stood in for (AGL-3955)', () => {
  it('spends the preclearance after the hold and before the charge, then buys as usual', async () => {
    const driver = fakeDriver()
    const steps: string[] = []
    const { effects, recorded } = effectsWith(driver, {
      consumePreclearance: async () => {
        // The hold is taken and nothing is charged yet.
        const held = await readRegistration('testbakery.com')
        steps.push(`consume:${held?.status ?? 'no-hold'}:charges=${recorded.charges.length}`)
        return true
      },
      charge: async (request) => {
        steps.push('charge')
        return { ok: true, invoiceId: 'in_1', paidCents: request.amountCents, code: null }
      },
    })

    const outcome = await buy(effects, 1599, 'link-1')

    expect(outcome.ok).toBe('active')
    expect(steps).toEqual(['consume:charging:charges=0', 'charge'])
    expect(recorded.consumed).toEqual(['link-1'])
    expect(driver.buy).toHaveBeenCalledTimes(1)
    const saved = await readRegistration('testbakery.com')
    expect(saved?.history.map((row) => row.event)).toEqual(
      expect.arrayContaining(['purchase-started', 'precleared', 'charged']),
    )
    expect(saved?.history.find((row) => row.event === 'precleared')?.detail).toBe('link-1')
  })

  it('refuses as the payment-history gate would when the preclearance will not spend, and never charges', async () => {
    const driver = fakeDriver()
    const { effects, recorded } = effectsWith(driver, { consumePreclearance: async () => false })

    const outcome = await buy(effects, 1599, 'link-spent')

    expect(outcome).toMatchObject({
      ok: 'refused',
      status: 409,
      code: 'no-payment-history',
      error: expect.stringContaining('three days after your workspace’s first plan payment'),
    })
    expect(recorded.consumed).toEqual(['link-spent'])
    expect(recorded.charges).toEqual([])
    expect(driver.buy).not.toHaveBeenCalled()
    // The hold is let go as a decline lets it go: the name is free again.
    expect(await readRegistration('testbakery.com')).toMatchObject({
      status: 'declined',
      failure: 'no-payment-history',
    })
    const retry = effectsWith(fakeDriver())
    expect((await buy(retry.effects)).ok).toBe('active')
  })

  it('treats a preclearance that throws as one that will not spend', async () => {
    const { effects, recorded } = effectsWith(fakeDriver(), {
      consumePreclearance: async () => {
        throw new Error('bundle links unreachable')
      },
    })
    expect(await buy(effects, 1599, 'link-1')).toMatchObject({ ok: 'refused', code: 'no-payment-history' })
    expect(recorded.charges).toEqual([])
  })

  it('spends nothing when no preclearance stood in, and nothing before the name is held', async () => {
    const plain = effectsWith(fakeDriver())
    expect((await buy(plain.effects)).ok).toBe('active')
    mockStore.current = new MemoryFirestore()
    expect((await buy(plain.effects, 1599, null)).ok).toBe('active')
    expect(plain.recorded.consumed).toEqual([])

    // A name another buyer holds is refused before the preclearance is spent.
    const second = effectsWith(fakeDriver())
    expect(await buy(second.effects, 1599, 'link-1')).toMatchObject({ ok: 'refused', code: 'taken' })
    expect(second.recorded.consumed).toEqual([])

    // So is a price that moved since the search.
    mockStore.current = new MemoryFirestore()
    const moved = effectsWith(fakeDriver({ search: async () => yes([{ ...QUOTE, purchaseUsd: 14 }]) }))
    expect(await buy(moved.effects, 1599, 'link-1')).toMatchObject({ ok: 'refused', code: 'price-changed' })
    expect(moved.recorded.consumed).toEqual([])
  })
})

describe('the sweep finishes what a request left (AGL-3962)', () => {
  it('completes a pending order on a later pass', async () => {
    let status: 'pending' | 'completed' = 'pending'
    const { effects, recorded } = effectsWith(
      fakeDriver({ order: async (orderId) => yes({ orderId, status }) }),
    )
    expect((await buy(effects)).ok).toBe('registering')
    status = 'completed'
    await runDomainsSweep(effects, { nowMs: Date.now(), deadlineMs: Date.now() + 60_000 })
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'active' })
    expect(recorded.connects).toEqual(['testbakery.com'])
  })

  it('refunds an order the registrar failed', async () => {
    let status: 'pending' | 'failed' = 'pending'
    const { effects, recorded } = effectsWith(
      fakeDriver({ order: async (orderId) => yes({ orderId, status }) }),
    )
    await buy(effects)
    status = 'failed'
    await runDomainsSweep(effects, { nowMs: Date.now(), deadlineMs: Date.now() + 60_000 })
    expect(recorded.refunds).toEqual(['in_1'])
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'refunded' })
  })

  it('gives back a charge whose request died before ordering', async () => {
    const { effects, recorded } = effectsWith(fakeDriver())
    await registrationRef('testbakery.com').set(
      registrationDoc({ status: 'charging', purchaseInvoiceId: 'in_9', updatedAtMs: T0 }),
    )
    jest.setSystemTime(T0 + 20 * 60 * 1000)
    await runDomainsSweep(effects, { nowMs: Date.now(), deadlineMs: Date.now() + 60_000 })
    expect(recorded.refunds).toEqual(['in_9'])
  })
})

function registrationDoc(patch: Partial<DomainRegistrationDoc> = {}): DomainRegistrationDoc {
  return {
    domain: 'testbakery.com',
    orgId: 'org-1',
    hostId: 'host-1',
    registrar: 'fake',
    status: 'active',
    autoRenew: true,
    firstYearCents: 1599,
    renewalCents: 1599,
    costUsd: 11.25,
    renewalCostUsd: 11.25,
    purchaseInvoiceId: 'in_1',
    invoiceIds: ['in_1'],
    orderId: 'order-1',
    registeredAtMs: T0,
    expiresAtMs: T0 + 365 * DAY,
    registrant: { name: 'Alex Test', email: 'alex@testbakery.com' },
    contactVerification: { verified: true, checkedAtMs: T0 },
    renewal: null,
    failure: null,
    disputedAtMs: null,
    createdBy: 'user-1',
    createdAtMs: T0,
    updatedAtMs: T0,
    history: [],
    ...patch,
  }
}

async function seed(
  patch: Partial<DomainRegistrationDoc> = {},
  without: (keyof DomainRegistrationDoc)[] = [],
) {
  const doc = registrationDoc(patch) as unknown as Record<string, unknown>
  for (const key of without) delete doc[key]
  await registrationRef('testbakery.com').set(doc)
}

describe('renewals keep their two promises (AGL-3962)', () => {
  const expiry = T0 + 365 * DAY

  it('sends the notice 45 days out, then charges no more than it named', async () => {
    let today = 11.25
    const driver = fakeDriver({ renewalPrice: async () => yes(today) })
    const { effects, recorded } = effectsWith(driver)
    await seed()

    jest.setSystemTime(expiry - 45 * DAY)
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!)
    expect(recorded.emails.map((email) => email.kind)).toEqual(['renewalNotice'])
    expect(recorded.emails[0].merge['domain.renewalPrice']).toBe('$15.99')
    expect(recorded.charges).toEqual([])

    // The registrar's price rose between the notice and the charge.
    today = 15
    jest.setSystemTime(expiry - 30 * DAY)
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!)
    expect(recorded.charges).toEqual([expect.objectContaining({ amountCents: 1599, kind: 'domain-renewal' })])
    expect(driver.renew).toHaveBeenCalledWith(expect.objectContaining({ expectedPriceUsd: 15 }))

    driver.info.mockResolvedValue(yes({ owned: true, registeredAtMs: T0, expiresAtMs: expiry + 365 * DAY, autoRenew: true }))
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!)
    expect(await readRegistration('testbakery.com')).toMatchObject({ expiresAtMs: expiry + 365 * DAY })
    expect(recorded.emails.map((email) => email.kind)).toContain('renewed')
  })

  it('retries a declined renewal, then turns auto-renew off and says when it expires', async () => {
    const driver = fakeDriver()
    const { effects, recorded } = effectsWith(driver, {
      charge: async () => ({ ok: false, invoiceId: null, paidCents: 0, code: 'declined' }),
    })
    await seed({ renewal: { forExpiresAtMs: expiry, noticeSentAtMs: T0, noticedPriceCents: 1599 } })

    // One pass a day from the charge date to the expiry, as the sweep would.
    let at = expiry - 30 * DAY
    for (let pass = 0; pass < 30; pass += 1) {
      jest.setSystemTime(at)
      await advanceRenewal(effects, (await readRegistration('testbakery.com'))!)
      at += DAY
    }
    const kinds = recorded.emails.map((email) => email.kind)
    expect(kinds.filter((kind) => kind === 'renewalFailed').length).toBeGreaterThanOrEqual(1)
    expect(kinds).toContain('expiring')
    expect(driver.setAutoRenew).toHaveBeenCalledWith('testbakery.com', false)
    expect((await readRegistration('testbakery.com'))?.renewal).toMatchObject({
      abandonedReason: 'charge-failed',
    })
    // Every attempt was a distinct charge, never a repeat of one key.
    const keys = recorded.charges.map((charge) => charge.attemptKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('charges nothing when auto-renew is off, and tells the owner the date', async () => {
    const { effects, recorded } = effectsWith(fakeDriver())
    await seed({ autoRenew: false })
    jest.setSystemTime(expiry - 30 * DAY)
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!)
    expect(recorded.charges).toEqual([])
    expect(recorded.emails).toEqual([
      expect.objectContaining({
        kind: 'expiring',
        merge: expect.objectContaining({ 'domain.expiryReason': 'Auto-renew is turned off for it.' }),
      }),
    ])
  })
})

describe('the registrar is reconciled (AGL-3962)', () => {
  const expiry = T0 + 365 * DAY
  const sweep = (effects: LifecycleEffects) =>
    runDomainsSweep(effects, { nowMs: Date.now(), deadlineMs: Date.now() + 60_000 })

  it('charges for a term the registrar’s backstop renewed', async () => {
    const driver = fakeDriver({
      info: async () =>
        yes({ owned: true, registeredAtMs: T0, expiresAtMs: expiry + 365 * DAY, autoRenew: true }),
    })
    const { effects, recorded } = effectsWith(driver)
    await seed()
    jest.setSystemTime(expiry - DAY)
    await sweep(effects)
    expect(recorded.charges).toEqual([expect.objectContaining({ kind: 'domain-renewal', amountCents: 1599 })])
    expect(await readRegistration('testbakery.com')).toMatchObject({ expiresAtMs: expiry + 365 * DAY })
  })

  it('expires a name past its date and gives the site its free address back', async () => {
    const { effects, recorded } = effectsWith(fakeDriver())
    await seed({ autoRenew: false })
    jest.setSystemTime(expiry + 2 * DAY)
    await sweep(effects)
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'expired' })
    expect(recorded.disconnects).toEqual(['testbakery.com'])
    expect(recorded.emails.map((email) => email.kind)).toContain('expired')
  })

  it('records a name that moved to another registrar', async () => {
    const { effects } = effectsWith(
      fakeDriver({
        info: async () => yes({ owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null }),
      }),
    )
    await seed()
    await sweep(effects)
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'transferred-out' })
  })

  it('reminds the registrant to confirm their email on day 1, day 7 and three days before the deadline', async () => {
    const verifyBy = T0 + 15 * DAY
    const { effects, recorded } = effectsWith(
      fakeDriver({
        contactVerification: async () =>
          yes({ verified: false, verifyByMs: verifyBy, email: 'alex@testbakery.com' }),
      }),
    )
    await seed({}, ['contactVerification'])
    for (let day = 0; day <= 14; day += 1) {
      jest.setSystemTime(T0 + day * DAY + 60_000)
      await sweep(effects)
    }
    expect(recorded.emails.filter((email) => email.kind === 'verifyRegistrant')).toHaveLength(3)
  })

  it('turns off auto-renew on a name nobody accounts for, and only one bought since launch', async () => {
    const driver = fakeDriver({
      listOwned: async () =>
        yes([
          { domain: 'orphan.com', boughtAtMs: Date.parse('2026-10-20T00:00:00Z'), autoRenew: true },
          { domain: 'byhand.com', boughtAtMs: Date.parse('2025-01-01T00:00:00Z'), autoRenew: true },
        ]),
    })
    const { effects, recorded } = effectsWith(driver)
    expect(await reconcileOrphans(effects)).toBe(1)
    expect(driver.setAutoRenew).toHaveBeenCalledWith('orphan.com', false)
    expect(driver.setAutoRenew).not.toHaveBeenCalledWith('byhand.com', false)
    expect(recorded.alerts).toEqual(['orphanRegistration'])
  })
})

describe('registrant contact', () => {
  it('names every missing or malformed field', () => {
    expect(invalidContactFields({ ...CONTACT, email: 'nope', zip: '' })).toEqual(['zip', 'email'])
    expect(invalidContactFields(CONTACT)).toEqual([])
  })

  it('writes phone numbers the way registrars take them', () => {
    expect(normalizePhone('(512) 555-0123')).toBe('+1.5125550123')
    expect(normalizePhone('+1 512 555 0123')).toBe('+1.5125550123')
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
  })
})
