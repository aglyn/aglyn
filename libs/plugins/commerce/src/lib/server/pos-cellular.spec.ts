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
 * 4G for Stripe Reader S710s (AGL-4038): the POS devices card's switch on
 * the card readers route, the per-reader records it keeps, the monthly
 * charge, and the workspace erasure turning it off.
 */
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import type { OrgUsageInvoiceRequest, OrgUsageInvoiceResult } from '@aglyn/tenant-data-admin/server/usage-invoice'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

let mockDevices = true
let mockBilling: Record<string, unknown> = { stripeCustomerId: 'cus_1' }
const mockAlerts: Array<{ type: string; options: Record<string, any> }> = []

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true, posDevices: mockDevices } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token !== 'manager') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'manager-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-1' },
    }),
    readOrgBilling: async () => mockBilling,
    raiseOperatorAlert: async (definition: { type: string }, options: Record<string, any>) => {
      mockAlerts.push({ type: definition.type, options })
      return { outcome: 'sent' }
    },
  }
})

import { POS_CELLULAR_ENV, type PosCellularCharge, type PosCellularReaderRecord } from '../model/pos-cellular'
import { posReadersHandler } from './pos-readers'
import { createPosCellularOrgEraser, runPosCellularBilling } from './pos-cellular-billing'

interface StripeCall {
  method: string
  path: string
  key: string | null
  params: URLSearchParams
}
const stripeCalls: StripeCall[] = []
let refuseConfigurations = false

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const path = target.pathname.replace(/^\/v1\//, '')
  const headers = (init?.headers ?? {}) as Record<string, string>
  stripeCalls.push({
    method: String(init?.method ?? 'GET'),
    path,
    key: headers['Idempotency-Key'] ?? null,
    params: new URLSearchParams(String(init?.body ?? '')),
  })
  if (refuseConfigurations && path.startsWith('terminal/configurations')) {
    return { ok: false, status: 400, json: async () => ({ error: { code: 'parameter_invalid' } }) }
  }
  if (path === 'terminal/configurations' && init?.method === 'POST') {
    return { ok: true, status: 200, json: async () => ({ id: 'tmc_new1' }) }
  }
  if (/^terminal\/(configurations|locations)\//.test(path)) {
    return { ok: true, status: 200, json: async () => ({ id: path.split('/').pop() }) }
  }
  return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }
})

function response() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

async function readers(body: Record<string, unknown>, token = 'manager') {
  const { res, result } = response()
  await posReadersHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-1', ...body },
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

const ENV_KEYS = [POS_CELLULAR_ENV.monthlyCostCents, POS_CELLULAR_ENV.productId, 'STRIPE_SECRET_KEY']
const configWrites = () => stripeCalls.filter((call) => call.path.startsWith('terminal/configurations') && call.method === 'POST')
const record = (readerId: string) => fakeDocs.get(`posCellularReaders/host-1_${readerId}`) as PosCellularReaderRecord | undefined

function seedStore(options: { configured?: boolean } = {}) {
  fakeDocs.set('hosts/host-1', { name: 'Main Street', orgId: 'org-1' })
  fakeDocs.set('orgs/org-1', { name: 'Acme Builders' })
  fakeDocs.set('hosts/host-1/terminal/config', {
    stripeLocationId: 'tml_1',
    ...(options.configured === false ? {} : { stripeConfigurationId: 'tmc_1', stripeConfigurationAssigned: true }),
  })
  fakeDocs.set('hosts/host-1/terminalReaders/tmr_gate710', {
    label: 'Gate',
    stripeLocationId: 'tml_1',
    deviceType: 'stripe_s710',
    serialNumber: 'STRS710-1',
    livemode: false,
    createdAtMs: 1,
  })
  fakeDocs.set('hosts/host-1/terminalReaders/tmr_counter700', {
    label: 'Counter',
    stripeLocationId: 'tml_1',
    deviceType: 'stripe_s700',
    livemode: false,
    createdAtMs: 1,
  })
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  resetFakeFirestore()
  stripeCalls.length = 0
  mockAlerts.length = 0
  refuseConfigurations = false
  mockDevices = true
  mockBilling = { stripeCustomerId: 'cus_1' }
  // Figures for the specs only.
  process.env[POS_CELLULAR_ENV.monthlyCostCents] = '1000'
  process.env[POS_CELLULAR_ENV.productId] = 'prod_cellular'
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_cellular'
  seedStore()
})

afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('the POS devices card’s 4G switch (AGL-4038)', () => {
  it('is hidden, and refused as unknown, until the deployment offers it', async () => {
    delete process.env[POS_CELLULAR_ENV.monthlyCostCents]
    const listed = await readers({ action: 'list' })
    expect(listed.status).toBe(200)
    expect(listed.body).not.toHaveProperty('cellular')
    const refused = await readers({ action: 'cellular', enabled: true, consent: true })
    expect(refused.status).toBe(404)
    expect(configWrites()).toHaveLength(0)
  })

  it('shows the price per reader where the store has an S710, and not where it has none', async () => {
    expect((await readers({ action: 'list' })).body.cellular).toEqual({ readerMonthlyCents: 1_061, enabled: false, readers: 1 })
    fakeDocs.delete('hosts/host-1/terminalReaders/tmr_gate710')
    expect((await readers({ action: 'list' })).body).not.toHaveProperty('cellular')
  })

  it('turns cellular on for the store’s one configuration, records the agreement and opens each S710', async () => {
    const answer = await readers({ action: 'cellular', enabled: true, consent: true })
    expect(answer).toEqual({ status: 200, body: { ok: true, enabled: true } })
    expect(configWrites().map((call) => [call.path, call.params.get('cellular[enabled]')])).toEqual([
      ['terminal/configurations/tmc_1', 'true'],
    ])
    expect(fakeDocs.get('hosts/host-1/terminal/config')).toMatchObject({
      cellularEnabled: true,
      cellularConfigurationId: 'tmc_1',
      cellularChangedBy: 'manager-1',
      cellularConsent: { uid: 'manager-1', readerMonthlyCents: 1_061, atMs: expect.any(Number) },
    })
    // The S710 is counted; the S700 at the same store cannot have 4G.
    expect(record('tmr_gate710')).toMatchObject({
      orgId: 'org-1',
      serialNumber: 'STRS710-1',
      stripeConfigurationId: 'tmc_1',
      enabled: true,
      periods: [{ fromMs: expect.any(Number), toMs: null }],
    })
    expect(record('tmr_counter700')).toBeUndefined()
    expect((await readers({ action: 'list' })).body.cellular).toMatchObject({ enabled: true })
  })

  it('is idempotent: turning it on twice calls Stripe once and opens one period', async () => {
    await readers({ action: 'cellular', enabled: true, consent: true })
    await readers({ action: 'cellular', enabled: true, consent: true })
    expect(configWrites()).toHaveLength(1)
    expect(record('tmr_gate710')?.periods).toHaveLength(1)
  })

  it('makes the configuration on a store that has none, keyed so a retry makes one', async () => {
    seedStore({ configured: false })
    await readers({ action: 'cellular', enabled: true, consent: true })
    const create = configWrites().find((call) => call.path === 'terminal/configurations')
    expect(create).toMatchObject({ key: 'pos-configuration:host-1:cellular-on' })
    expect(create?.params.get('cellular[enabled]')).toBe('true')
    // …and assigns it to the store's Location.
    expect(stripeCalls.some((call) => call.path === 'terminal/locations/tml_1' && call.params.get('configuration_overrides') === 'tmc_new1')).toBe(true)
  })

  it('needs the agreement, an S710, a reader Location and a workspace that can be billed', async () => {
    expect((await readers({ action: 'cellular', enabled: true })).body).toMatchObject({ code: 'consent-required' })
    mockBilling = {}
    expect((await readers({ action: 'cellular', enabled: true, consent: true })).body).toMatchObject({ code: 'no-billing' })
    mockBilling = { stripeCustomerId: 'cus_1' }
    fakeDocs.delete('hosts/host-1/terminalReaders/tmr_gate710')
    expect((await readers({ action: 'cellular', enabled: true, consent: true })).body).toMatchObject({ code: 'no-capable-reader' })
    fakeDocs.set('hosts/host-1/terminal/config', {})
    expect((await readers({ action: 'cellular', enabled: true, consent: true })).body).toMatchObject({ code: 'no-location' })
    expect((await readers({ action: 'cellular', enabled: 'yes' })).status).toBe(400)
    expect(configWrites()).toHaveLength(0)
  })

  it('is set up like the readers: refused without "Registers and devices"', async () => {
    mockDevices = false
    const refused = await readers({ action: 'cellular', enabled: true, consent: true })
    expect(refused.status).toBe(403)
    expect(configWrites()).toHaveLength(0)
  })

  it('records nothing when Stripe refuses', async () => {
    refuseConfigurations = true
    const answer = await readers({ action: 'cellular', enabled: true, consent: true })
    expect(answer.status).toBe(502)
    expect(fakeDocs.get('hosts/host-1/terminal/config')?.['cellularEnabled']).toBeUndefined()
    expect(record('tmr_gate710')).toBeUndefined()
  })

  it('turns it off at Stripe and closes each reader’s period, which stops the charge from the next month', async () => {
    await readers({ action: 'cellular', enabled: true, consent: true })
    const off = await readers({ action: 'cellular', enabled: false })
    expect(off).toEqual({ status: 200, body: { ok: true, enabled: false } })
    expect(configWrites().map((call) => call.params.get('cellular[enabled]'))).toEqual(['true', 'false'])
    expect(record('tmr_gate710')).toMatchObject({ enabled: false, disabledAtMs: expect.any(Number), periods: [{ toMs: expect.any(Number) }] })
  })

  it('counts an S710 added to a store with 4G on, and stops counting one removed', async () => {
    await readers({ action: 'cellular', enabled: true, consent: true })
    fakeDocs.set('hosts/host-1/terminalReaders/tmr_lot710', { label: 'Lot', deviceType: 'stripe_s710', stripeLocationId: 'tml_1' })
    // Removing the first reader re-reads the store, which also finds the new one.
    stripeCalls.length = 0
    expect((await readers({ action: 'remove', readerId: 'tmr_gate710' })).status).toBe(200)
    expect(record('tmr_gate710')).toMatchObject({ enabled: false })
    expect(record('tmr_lot710')).toMatchObject({ enabled: true })
  })
})

describe('the monthly 4G charge (AGL-4038)', () => {
  const NOV_2 = Date.UTC(2026, 10, 2, 9)
  const gate = (locked: string[] = []) => ({ isLocked: async (hostId: string) => locked.includes(hostId) })
  const charges: OrgUsageInvoiceRequest[] = []
  let answer: Partial<OrgUsageInvoiceResult> = { ok: true, invoiceId: 'in_1', amountPaidCents: 2_092 }
  const charge = async (request: OrgUsageInvoiceRequest) => {
    charges.push(request)
    return { ok: false, invoiceId: null, status: null, totalCents: 0, amountPaidCents: 0, requiresAction: false, error: null, ...answer } as OrgUsageInvoiceResult
  }
  const turnedOff: string[] = []
  const deps = () => ({
    now: () => NOV_2,
    charge,
    readBilling: async () => mockBilling,
    turnOff: async (id: string) => {
      turnedOff.push(id)
      return true
    },
  })
  const seedRecord = (id: string, fields: Partial<PosCellularReaderRecord>) =>
    fakeDocs.set(`posCellularReaders/${id}`, {
      orgId: 'org-1',
      hostId: 'host-1',
      readerId: id,
      serialNumber: null,
      stripeConfigurationId: 'tmc_1',
      enabled: true,
      periods: [{ fromMs: Date.UTC(2026, 8, 1), toMs: null }],
      disabledAtMs: null,
      updatedAtMs: 1,
      ...fields,
    })
  const chargeDoc = () => fakeDocs.get('posCellularCharges/org-1_2026-10') as PosCellularCharge | undefined

  beforeEach(() => {
    charges.length = 0
    turnedOff.length = 0
    answer = { ok: true, invoiceId: 'in_1', amountPaidCents: 2_092 }
  })

  it('charges each workspace once for the readers that had 4G last month, at the configured price', async () => {
    seedRecord('r1', {})
    // Turned off in October: still October's.
    seedRecord('r2', { enabled: false, periods: [{ fromMs: Date.UTC(2026, 8, 1), toMs: Date.UTC(2026, 9, 3) }], disabledAtMs: Date.UTC(2026, 9, 3) })
    // Off since September: not October's.
    seedRecord('r3', { enabled: false, periods: [{ fromMs: Date.UTC(2026, 7, 1), toMs: Date.UTC(2026, 8, 3) }], disabledAtMs: Date.UTC(2026, 8, 3) })
    const report = await runPosCellularBilling(gate(), deps())
    expect(report).toMatchObject({ month: '2026-10', workspaces: 1, paid: 1 })
    expect(charges).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        stripeCustomerId: 'cus_1',
        productId: 'prod_cellular',
        // (2 × 1000 + 30) / 0.971, rounded up.
        amountCents: 2_091,
        currency: 'usd',
        description: '4G for 2 Stripe Reader S710 card readers, October 2026',
        idempotencyKey: 'pos-cellular-org-1-2026-10',
        metadata: expect.objectContaining({ kind: 'pos-cellular', month: '2026-10', readers: '2' }),
      }),
    ])
    expect(chargeDoc()).toMatchObject({ state: 'paid', invoiceId: 'in_1', readers: 2, amountCents: 2_091, attempts: 1 })
    // The next run finds it settled.
    await runPosCellularBilling(gate(), deps())
    expect(charges).toHaveLength(1)
  })

  it('leaves a declined charge open on the workspace’s Billing page, alerts staff, and never charges it again', async () => {
    seedRecord('r1', {})
    answer = { ok: false, invoiceId: 'in_2', error: 'Your card was declined.' }
    const report = await runPosCellularBilling(gate(), deps())
    expect(report.open).toBe(1)
    expect(chargeDoc()).toMatchObject({ state: 'open', invoiceId: 'in_2' })
    expect(mockAlerts).toEqual([
      expect.objectContaining({ type: 'commerce.posCellularChargeFailed', options: expect.objectContaining({ dedupeKey: 'org-1_2026-10' }) }),
    ])
    await runPosCellularBilling(gate(), deps())
    expect(charges).toHaveLength(1)
  })

  it('tries a charge that never reached Stripe again, under the same key and figures', async () => {
    seedRecord('r1', {})
    answer = { ok: false, invoiceId: null, error: 'Stripe is not configured' }
    await runPosCellularBilling(gate(), deps())
    expect(chargeDoc()).toMatchObject({ state: 'failed', attempts: 1 })
    answer = { ok: true, invoiceId: 'in_3', amountPaidCents: 1_061 }
    await runPosCellularBilling(gate(), deps())
    expect(charges.map((request) => [request.idempotencyKey, request.amountCents])).toEqual([
      ['pos-cellular-org-1-2026-10', 1_061],
      ['pos-cellular-org-1-2026-10', 1_061],
    ])
    expect(chargeDoc()).toMatchObject({ state: 'paid', attempts: 2 })
  })

  it('charges no one without a customer, and a locked store’s workspace not while it is locked', async () => {
    seedRecord('r1', {})
    const locked = await runPosCellularBilling(gate(['host-1']), deps())
    expect(locked.deferred).toBe(1)
    expect(chargeDoc()).toBeUndefined()
    mockBilling = {}
    await runPosCellularBilling(gate(), deps())
    expect(chargeDoc()).toMatchObject({ state: 'no-customer' })
    expect(charges).toHaveLength(0)
    expect(mockAlerts.map((alert) => alert.type)).toEqual(['commerce.posCellularChargeFailed'])
  })

  it('does nothing where 4G is not offered', async () => {
    seedRecord('r1', {})
    const report = await runPosCellularBilling(gate(), { ...deps(), config: null })
    expect(report.month).toBeNull()
    expect(charges).toHaveLength(0)
  })

  it('turns 4G off at Stripe for a store that was deleted, and stops counting its readers', async () => {
    seedRecord('gone_1', { hostId: 'host-gone', stripeConfigurationId: 'tmc_gone' })
    const report = await runPosCellularBilling(gate(), deps())
    expect(report.storesGone).toBe(1)
    expect(turnedOff).toEqual(['tmc_gone'])
    expect(fakeDocs.get('posCellularReaders/gone_1')).toMatchObject({ enabled: false, disabledAtMs: NOV_2 })
  })
})

describe('a workspace erasure turns 4G off (AGL-4038)', () => {
  it('for every store of the workspace that had it, once, and only counts on a dry run', async () => {
    const seed = (id: string, orgId: string, configurationId: string, enabled = true) =>
      fakeDocs.set(`posCellularReaders/${id}`, {
        orgId,
        hostId: `host-${id}`,
        readerId: id,
        serialNumber: null,
        stripeConfigurationId: configurationId,
        enabled,
        periods: [{ fromMs: 1, toMs: enabled ? null : 2 }],
        disabledAtMs: enabled ? null : 2,
        updatedAtMs: 1,
      })
    seed('a', 'org-1', 'tmc_a')
    seed('b', 'org-1', 'tmc_a')
    seed('c', 'org-1', 'tmc_c', false)
    seed('d', 'org-2', 'tmc_d')
    const turnedOff: string[] = []
    const eraser = createPosCellularOrgEraser({
      turnOff: async (id) => {
        turnedOff.push(id)
        return id !== 'tmc_fail'
      },
      now: () => 50,
    })
    expect(await eraser({ orgId: 'org-1', dryRun: true })).toEqual({ cellularStoresTurnedOff: 1, cellularTurnOffFailed: 0 })
    expect(turnedOff).toEqual([])
    expect(await eraser({ orgId: 'org-1', dryRun: false })).toEqual({ cellularStoresTurnedOff: 1, cellularTurnOffFailed: 0 })
    expect(turnedOff).toEqual(['tmc_a'])
    expect(fakeDocs.get('posCellularReaders/a')).toMatchObject({ enabled: false, disabledAtMs: 50 })
    expect(fakeDocs.get('posCellularReaders/d')).toMatchObject({ enabled: true })
  })

  it('alerts staff when Stripe refuses, and never fails the erasure', async () => {
    fakeDocs.set('posCellularReaders/x', {
      orgId: 'org-1',
      hostId: 'host-x',
      readerId: 'x',
      serialNumber: null,
      stripeConfigurationId: 'tmc_fail',
      enabled: true,
      periods: [{ fromMs: 1, toMs: null }],
      disabledAtMs: null,
      updatedAtMs: 1,
    })
    const eraser = createPosCellularOrgEraser({ turnOff: async () => false, now: () => 50 })
    expect(await eraser({ orgId: 'org-1', dryRun: false })).toEqual({ cellularStoresTurnedOff: 0, cellularTurnOffFailed: 1 })
    expect(mockAlerts).toEqual([
      expect.objectContaining({ type: 'commerce.posCellularTurnOffFailed', options: expect.objectContaining({ dedupeKey: 'tmc_fail' }) }),
    ])
  })
})
