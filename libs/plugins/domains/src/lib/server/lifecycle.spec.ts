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
  advanceTransferIn,
  isContactRefusal,
  connectToSite,
  disconnectFromSite,
  purchaseTarget,
  startTransferIn,
  transferInQuote,
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

describe('buying while a site has a domain (AGL-4040)', () => {
  it('goes to the site with none, and into the workspace otherwise', () => {
    expect(purchaseTarget({ hostId: 'host-1', host: {} }, [])).toBe('site')
    expect(purchaseTarget({ hostId: 'host-1', host: { cname: 'example.com' } }, [])).toBe('workspace')
    expect(purchaseTarget({ hostId: 'host-1', host: {} }, [registrationDoc()])).toBe('workspace')
    expect(purchaseTarget({ hostId: 'host-1', host: {} }, [registrationDoc({ status: 'refunded' })])).toBe('site')
    expect(purchaseTarget({ hostId: null, host: null }, [])).toBe('workspace')
  })

  it('registers a name bought into the workspace without connecting any site', async () => {
    const { effects, recorded } = effectsWith(fakeDriver())
    const outcome = await purchaseDomain(effects, ACTOR, {
      domain: 'testbakery.com',
      expectedFirstYearCents: 1599,
      contact: CONTACT,
      intoWorkspace: true,
    })
    expect(outcome.ok).toBe('active')
    expect(recorded.connects).toEqual([])
    expect(await readRegistration('testbakery.com')).toMatchObject({ hostId: null, status: 'active', origin: 'purchase' })
    const purchased = recorded.emails.find((email) => email.kind === 'purchased')
    expect(purchased?.merge['domain.whereLine']).toMatch(/not connected to a site yet/)
  })
})

/** A driver for a name not yet in our registrar account, as a transfer starts. */
const NOT_HERE = { owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null }
function transferDriver(overrides: Partial<RegistrarDriver> = {}) {
  return fakeDriver({ info: async () => yes(NOT_HERE), ...overrides })
}

describe('transferring a name in (AGL-4040)', () => {
  const start = (effects: LifecycleEffects, expectedPriceCents = 1599) =>
    startTransferIn(effects, { ...ACTOR, hostId: null, host: null }, {
      domain: 'TestBakery.com',
      authCode: ' CODE-1 ',
      contact: CONTACT,
      expectedPriceCents,
    })

  it('prices the transfer with the renewal formula', async () => {
    expect(await transferInQuote(transferDriver({ transferPrice: async () => yes(11.25) }), 'testbakery.com')).toEqual({
      ok: 'yes',
      priceCents: 1599,
      renewalCents: 1599,
      costUsd: 11.25,
      renewalCostUsd: 11.25,
    })
    expect(await transferInQuote(transferDriver(), 'testbakery.us')).toEqual({ ok: 'no', code: 'not-offered' })
  })

  it('charges the quoted price, asks the registrar at our cost, and holds the name into the workspace', async () => {
    const driver = transferDriver()
    const { effects, recorded } = effectsWith(driver)
    const outcome = await start(effects)
    expect(outcome.ok).toBe('transferring')
    expect(recorded.charges).toEqual([expect.objectContaining({ amountCents: 1599, kind: 'domain-transfer' })])
    expect(driver.transferIn).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'testbakery.com', authCode: 'CODE-1', years: 1, expectedPriceUsd: 11.25 }),
    )
    const held = await readRegistration('testbakery.com')
    expect(held).toMatchObject({
      status: 'transferring-in',
      origin: 'transfer-in',
      hostId: null,
      transfer: { orderId: 'transfer-1' },
    })
    // The auth code is passed through, never stored.
    expect(JSON.stringify(held)).not.toContain('CODE-1')
  })

  it('refuses a price that moved, before holding or charging', async () => {
    const { effects, recorded } = effectsWith(transferDriver())
    expect(await start(effects, 999)).toMatchObject({ ok: 'refused', code: 'price-changed', priceCents: 1599 })
    expect(recorded.charges).toEqual([])
    expect(await readRegistration('testbakery.com')).toBeNull()
  })

  it.each([
    ['domain_already_owned', 'already-here'],
    ['dnssec_enabled', 'dnssec'],
    ['expected_price_mismatch', 'price-changed'],
    ['bad_request', 'transfer-refused'],
  ])('refunds when the registrar refuses with %s', async (code, outcomeCode) => {
    const { effects, recorded } = effectsWith(transferDriver({ transferIn: async () => no(code) }))
    expect(await start(effects)).toMatchObject({ ok: 'refused', code: outcomeCode })
    expect(recorded.refunds).toEqual(['in_1'])
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'refunded' })
    expect(recorded.emails.map((email) => email.kind)).toEqual(['transferInFailed'])
  })

  it('follows a transfer behind a lost answer instead of refunding it', async () => {
    const { effects, recorded } = effectsWith(transferDriver({ transferIn: async () => no('timeout', true) }))
    expect((await start(effects)).ok).toBe('transferring')
    expect(recorded.refunds).toEqual([])
  })

  it('records a declined card and never asks the registrar', async () => {
    const driver = transferDriver()
    const { effects } = effectsWith(driver, {
      charge: async () => ({ ok: false, invoiceId: null, paidCents: 0, code: 'declined' }),
    })
    expect(await start(effects)).toMatchObject({ ok: 'refused', code: 'declined' })
    expect(driver.transferIn).not.toHaveBeenCalled()
  })

  it('the sweep finishes an arrived transfer with its new expiry, and tells the owners', async () => {
    const driver = transferDriver()
    const { effects, recorded } = effectsWith(driver)
    await start(effects)
    driver.transferStatus.mockResolvedValue(yes({ status: 'pending', state: 'pending_unlock' }))
    await runDomainsSweep(effects, { nowMs: T0, deadlineMs: Date.now() + 60_000 })
    expect(await readRegistration('testbakery.com')).toMatchObject({
      status: 'transferring-in',
      transfer: { lastStatus: 'pending_unlock' },
    })
    driver.transferStatus.mockResolvedValue(yes({ status: 'completed', state: 'completed' }))
    driver.info.mockResolvedValue(yes({ owned: true, registeredAtMs: T0, expiresAtMs: T0 + 400 * DAY, autoRenew: true }))
    const report = await runDomainsSweep(effects, { nowMs: T0, deadlineMs: Date.now() + 60_000 })
    expect(report.transferringIn).toBe(1)
    expect(await readRegistration('testbakery.com')).toMatchObject({
      status: 'active',
      hostId: null,
      expiresAtMs: T0 + 400 * DAY,
    })
    expect(recorded.emails.map((email) => email.kind)).toEqual(['transferInCompleted'])
    expect(recorded.connects).toEqual([])
  })

  it('the sweep refunds a transfer the losing registrar rejected', async () => {
    const driver = transferDriver()
    const { effects, recorded } = effectsWith(driver)
    await start(effects)
    driver.transferStatus.mockResolvedValue(yes({ status: 'failed', state: 'rejected' }))
    await advanceTransferIn(effects, (await readRegistration('testbakery.com'))!)
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'refunded', failure: 'transfer-rejected' })
    expect(recorded.refunds).toEqual(['in_1'])
    const failed = recorded.emails.find((email) => email.kind === 'transferInFailed')
    expect(failed?.merge['domain.failure']).toMatch(/declined to release it/)
  })

  it('tells staff about a transfer pending two weeks', async () => {
    const driver = transferDriver()
    const { effects, recorded } = effectsWith(driver)
    await start(effects)
    jest.setSystemTime(T0 + 15 * DAY)
    await advanceTransferIn(effects, (await readRegistration('testbakery.com'))!)
    expect(recorded.alerts).toEqual(['transferStuck'])
  })
})

describe('an edited registrant contact rides the next renewal (AGL-4040)', () => {
  const expiry = T0 + 365 * DAY
  const EDITED = { ...CONTACT, firstName: 'Jordan', lastName: 'Lee', country: 'US', phone: '+1.5125550123' }

  it('is sent with the renewal order and marked applied once it completes', async () => {
    const driver = fakeDriver()
    const { effects } = effectsWith(driver)
    await seed({
      registrantContact: EDITED,
      contactChange: { updatedAtMs: T0 + DAY, updatedBy: 'user-1' },
    })
    jest.setSystemTime(expiry - 30 * DAY)
    driver.info.mockResolvedValue(yes({ owned: true, registeredAtMs: T0, expiresAtMs: expiry + 365 * DAY, autoRenew: true }))
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!, { force: true })
    expect(driver.renew).toHaveBeenCalledWith(expect.objectContaining({ contact: EDITED }))
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!, { force: true })
    expect(await readRegistration('testbakery.com')).toMatchObject({
      contactChange: null,
      registrant: { name: 'Jordan Lee' },
    })
  })

  it('sends no contact when none was edited', async () => {
    const driver = fakeDriver()
    const { effects } = effectsWith(driver)
    await seed()
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!, { force: true })
    expect(driver.renew).toHaveBeenCalledWith(expect.not.objectContaining({ contact: expect.anything() }))
  })

  it('sets a refused contact aside, so the name keeps renewing', async () => {
    const driver = fakeDriver({ renew: async () => no('bad_request') })
    const { effects } = effectsWith(driver)
    await seed({ registrantContact: EDITED, contactChange: { updatedAtMs: T0, updatedBy: 'user-1' } })
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!, { force: true })
    const after = await readRegistration('testbakery.com')
    expect(after?.contactChange).toBeNull()
    expect(after?.contactRejectedAtMs).toBeGreaterThan(0)
    expect(after?.registrantContact).toEqual(EDITED)
  })
})

describe('connecting a workspace’s name to a site (AGL-4040)', () => {
  beforeEach(async () => {
    mockStore.current.docs.set('hosts/host-2', { orgId: 'org-1', cname: 'oldname.com' })
    mockStore.current.docs.set('hosts/host-3', { orgId: 'org-2' })
  })

  it('swaps out the site’s current domain, sending a name we sold back to the workspace', async () => {
    await registrationRef('oldname.com').set(registrationDoc({ domain: 'oldname.com', hostId: 'host-2' }) as never)
    await seed({ hostId: null })
    const { effects, recorded } = effectsWith(fakeDriver())
    const outcome = await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', {
      uid: 'user-1',
      email: null,
    })
    expect(outcome).toMatchObject({ ok: 'connected', replaced: 'oldname.com' })
    expect(recorded.disconnects).toEqual(['oldname.com'])
    expect(recorded.connects).toEqual(['testbakery.com'])
    expect(await readRegistration('oldname.com')).toMatchObject({ hostId: null })
    expect(await readRegistration('testbakery.com')).toMatchObject({ hostId: 'host-2', status: 'active' })
  })

  it('moves a name off the site it serves first, and refuses another workspace’s site', async () => {
    await seed({ hostId: 'host-1' })
    const { effects, recorded } = effectsWith(fakeDriver())
    expect(
      await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-3', { uid: 'u', email: null }),
    ).toMatchObject({ ok: 'refused', code: 'unknown-site' })
    mockStore.current.docs.set('hosts/host-2', { orgId: 'org-1' })
    await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', { uid: 'u', email: null })
    expect(recorded.disconnects).toEqual(['testbakery.com'])
  })

  it('changes nothing when the old domain will not release', async () => {
    await seed({ hostId: null })
    const { effects, recorded } = effectsWith(fakeDriver())
    effects.disconnect = async () => false
    expect(
      await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', { uid: 'u', email: null }),
    ).toMatchObject({ ok: 'refused', code: 'release-failed' })
    expect(recorded.connects).toEqual([])
    expect(await readRegistration('testbakery.com')).toMatchObject({ hostId: null })
  })

  it('disconnects a name, which stays the workspace’s', async () => {
    await seed({ hostId: 'host-1' })
    const { effects, recorded } = effectsWith(fakeDriver())
    const next = await disconnectFromSite(effects, (await readRegistration('testbakery.com'))!, { uid: 'u', email: null })
    expect(recorded.disconnects).toEqual(['testbakery.com'])
    expect(next).toMatchObject({ hostId: null, status: 'active' })
  })
})

describe('review fixes (AGL-4040)', () => {
  const ACTOR_WS = { ...ACTOR, hostId: null, host: null }
  const startWith = (effects: LifecycleEffects, expectedPriceCents = 1599) =>
    startTransferIn(effects, ACTOR_WS, {
      domain: 'testbakery.com',
      authCode: 'CODE-1',
      contact: CONTACT,
      expectedPriceCents,
    })
  const transferDriverFor = (overrides: Partial<RegistrarDriver> = {}) =>
    fakeDriver({ info: async () => yes({ owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null }), ...overrides })

  describe('a swap never leaves the target site without a domain', () => {
    type ConnectCall = { hostId: string; domain: string; twin?: string | null }
    function swapEffects(fail: { disconnect?: string[]; connect?: string[] } = {}) {
      const { effects, recorded } = effectsWith(fakeDriver())
      const connects: ConnectCall[] = []
      const disconnects: string[] = []
      effects.disconnect = async ({ hostId, domain }) => {
        disconnects.push(`${domain}@${hostId}`)
        return !(fail.disconnect ?? []).includes(`${domain}@${hostId}`)
      }
      effects.connect = async ({ hostId, domain, twin }) => {
        connects.push({ hostId, domain, ...(twin === undefined ? {} : { twin }) })
        return (fail.connect ?? []).includes(`${domain}@${hostId}`)
          ? { ok: 'refused', code: 'taken', retryable: false }
          : { ok: 'connected' }
      }
      return { effects, recorded, connects, disconnects }
    }

    beforeEach(async () => {
      // host-2 serves old.com (with its twin); testbakery.com serves host-1.
      mockStore.current.docs.set('hosts/host-1', { orgId: 'org-1', cname: 'testbakery.com', cnameTwin: 'www.testbakery.com' })
      mockStore.current.docs.set('hosts/host-2', { orgId: 'org-1', cname: 'old.com', cnameTwin: 'www.old.com' })
      await registrationRef('old.com').set(registrationDoc({ domain: 'old.com', hostId: 'host-2' }) as never)
      await seed({ hostId: 'host-1' })
    })

    it('releases the OTHER site first, and touches the target not at all when that fails', async () => {
      const { effects, disconnects, connects } = swapEffects({ disconnect: ['testbakery.com@host-1'] })
      const outcome = await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', { uid: 'u', email: null })
      expect(outcome).toMatchObject({ ok: 'refused', code: 'release-failed', restored: true })
      expect(disconnects).toEqual(['testbakery.com@host-1'])
      expect(connects).toEqual([])
      expect(await readRegistration('old.com')).toMatchObject({ hostId: 'host-2' })
    })

    it('puts the name back on its site when the target’s domain will not release', async () => {
      const { effects, disconnects, connects } = swapEffects({ disconnect: ['old.com@host-2'] })
      const outcome = await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', { uid: 'u', email: null })
      expect(disconnects).toEqual(['testbakery.com@host-1', 'old.com@host-2'])
      expect(connects).toEqual([{ hostId: 'host-1', domain: 'testbakery.com', twin: 'www.testbakery.com' }])
      expect(outcome).toMatchObject({ ok: 'refused', code: 'release-failed', restored: true })
      expect((outcome as { error: string }).error).toMatch(/nothing changed/)
      expect(await readRegistration('testbakery.com')).toMatchObject({ hostId: 'host-1' })
    })

    it('gives the target its own domain back, with its twin, when the connect is refused for good', async () => {
      const { effects, connects } = swapEffects({ connect: ['testbakery.com@host-2'] })
      const outcome = await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', { uid: 'u', email: null })
      expect(outcome).toMatchObject({ ok: 'refused', code: 'connect-failed', restored: true })
      expect(connects).toEqual([
        { hostId: 'host-2', domain: 'testbakery.com' },
        { hostId: 'host-2', domain: 'old.com', twin: 'www.old.com' },
        { hostId: 'host-1', domain: 'testbakery.com', twin: 'www.testbakery.com' },
      ])
      expect(await readRegistration('old.com')).toMatchObject({ hostId: 'host-2' })
      expect(await readRegistration('testbakery.com')).toMatchObject({ hostId: 'host-1', status: 'active' })
    })

    it('never says nothing changed when the undo itself fails', async () => {
      const { effects } = swapEffects({ connect: ['testbakery.com@host-2', 'old.com@host-2'] })
      const outcome = await connectToSite(effects, (await readRegistration('testbakery.com'))!, 'host-2', { uid: 'u', email: null })
      expect(outcome).toMatchObject({ ok: 'refused', code: 'connect-failed', restored: false })
      expect((outcome as { error: string }).error).not.toMatch(/nothing changed/)
      expect((outcome as { error: string }).error).toMatch(/old.com couldn’t be put back/)
    })
  })

  describe('a transfer never takes over a name held or lapsed here', () => {
    it('refuses an expired registration, even another workspace’s, and leaves it as it was', async () => {
      await registrationRef('testbakery.com').set(
        registrationDoc({ orgId: 'org-2', status: 'expired', history: [{ atMs: 1, event: 'theirs' }] }) as never,
      )
      const { effects, recorded } = effectsWith(transferDriverFor())
      expect(await startWith(effects)).toMatchObject({ ok: 'refused', code: 'already-here' })
      expect(recorded.charges).toEqual([])
      expect(await readRegistration('testbakery.com')).toMatchObject({ orgId: 'org-2', status: 'expired' })
    })

    it('refuses a name already in our registrar account', async () => {
      const { effects, recorded } = effectsWith(fakeDriver())
      expect(await startWith(effects)).toMatchObject({ ok: 'refused', code: 'already-here' })
      expect(recorded.charges).toEqual([])
    })

    it('starts a fresh history when the last registration was another workspace’s', async () => {
      await registrationRef('testbakery.com').set(
        registrationDoc({ orgId: 'org-2', status: 'refunded', history: [{ atMs: 1, event: 'theirs' }] }) as never,
      )
      const { effects } = effectsWith(transferDriverFor())
      expect((await startWith(effects)).ok).toBe('transferring')
      const after = await readRegistration('testbakery.com')
      expect(after?.orgId).toBe('org-1')
      expect(after?.history.map((row) => row.event)).not.toContain('theirs')
    })
  })

  describe('a transfer the registrar will not describe', () => {
    it('is finished when the name is in our account', async () => {
      const driver = transferDriverFor()
      const { effects } = effectsWith(driver)
      await startWith(effects)
      driver.transferStatus.mockResolvedValue(no('not_found'))
      driver.info.mockResolvedValue(yes({ owned: true, registeredAtMs: T0, expiresAtMs: T0 + 400 * DAY, autoRenew: true }))
      await advanceTransferIn(effects, (await readRegistration('testbakery.com'))!)
      expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'active', expiresAtMs: T0 + 400 * DAY })
    })

    it('waits until the deadline, then refunds', async () => {
      const driver = transferDriverFor()
      const { effects, recorded } = effectsWith(driver)
      await startWith(effects)
      driver.transferStatus.mockResolvedValue(no('not_found'))
      await advanceTransferIn(effects, (await readRegistration('testbakery.com'))!)
      expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'transferring-in' })
      jest.setSystemTime(T0 + 15 * DAY)
      await advanceTransferIn(effects, (await readRegistration('testbakery.com'))!)
      expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'refunded' })
      expect(recorded.refunds).toEqual(['in_1'])
    })
  })

  it('keeps a transfer whose start and status both went unanswered, for the sweep to decide', async () => {
    const driver = transferDriverFor({
      transferIn: async () => no('timeout', true),
      transferStatus: async () => no('timeout', true),
    })
    const { effects, recorded } = effectsWith(driver)
    expect((await startWith(effects)).ok).toBe('transferring')
    expect(recorded.refunds).toEqual([])
    expect(await readRegistration('testbakery.com')).toMatchObject({
      status: 'transferring-in',
      transfer: { orderId: 'unknown' },
    })
  })

  it('ties an arrived name to the workspace site already serving it', async () => {
    mockStore.current.docs.set('hosts/host-9', { orgId: 'org-1', cname: 'testbakery.com' })
    mockStore.current.docs.set('hosts/host-x', { orgId: 'org-2', cname: 'testbakery.com' })
    const driver = transferDriverFor()
    const { effects, recorded } = effectsWith(driver)
    await startWith(effects)
    driver.transferStatus.mockResolvedValue(yes({ status: 'completed', state: 'completed' }))
    await advanceTransferIn(effects, (await readRegistration('testbakery.com'))!)
    expect(await readRegistration('testbakery.com')).toMatchObject({ status: 'active', hostId: 'host-9' })
    expect(recorded.connects).toEqual([])
  })

  it('says the refund is in progress, not done, when it could not be made', async () => {
    const { effects } = effectsWith(transferDriverFor({ transferIn: async () => no('dnssec_enabled') }))
    effects.refund = async () => ({ ok: false, refundedCents: 0 })
    const outcome = await startWith(effects)
    expect(outcome).toMatchObject({ ok: 'refused', code: 'dnssec' })
    const error = (outcome as { error: string }).error
    expect(error).not.toMatch(/was refunded/)
    expect(error).toMatch(/being refunded/)
  })

  it('hands back the new price when the registrar’s moved', async () => {
    let price = 11.25
    const driver = transferDriverFor({
      transferPrice: async () => yes(price),
      transferIn: async () => {
        price = 20
        return no('expected_price_mismatch')
      },
    })
    const { effects } = effectsWith(driver)
    const outcome = await startWith(effects)
    expect(outcome).toMatchObject({ ok: 'refused', code: 'price-changed', priceCents: 2799 })
    expect((outcome as { error: string }).error).toMatch(/The charge was refunded/)
  })

  it('keeps an edited contact waiting when the renewal is refused for another reason', async () => {
    const EDITED = { ...CONTACT, firstName: 'Jordan', country: 'US', phone: '+1.5125550123' }
    const { effects } = effectsWith(fakeDriver({ renew: async () => no('expected_price_mismatch') }))
    await seed({ registrantContact: EDITED, contactChange: { updatedAtMs: T0, updatedBy: 'user-1' } })
    await advanceRenewal(effects, (await readRegistration('testbakery.com'))!, { force: true })
    const after = await readRegistration('testbakery.com')
    expect(after?.contactChange).toEqual({ updatedAtMs: T0, updatedBy: 'user-1' })
    expect(after?.contactRejectedAtMs ?? null).toBeNull()
    expect(isContactRefusal('expected_price_mismatch')).toBe(false)
    expect(isContactRefusal('invalid_additional_contact_info')).toBe(true)
    expect(isContactRefusal('bad_request')).toBe(true)
  })
})
