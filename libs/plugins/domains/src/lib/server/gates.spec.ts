/**
 * @jest-environment node
 *
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
const mockFraudHeld = jest.fn<Promise<boolean>, [unknown, string]>(async () => false)
const mockVerify = jest.fn(async (_token: string): Promise<Record<string, unknown>> => ({ uid: 'user-1', email: 'alex@testbakery.com' }))
const mockMembership = jest.fn(async (_uid: string, _orgId: string): Promise<unknown> => null)
const mockBilling = jest.fn(async (): Promise<boolean> => true)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockStore.current,
      auth: () => ({ verifyIdToken: (token: string) => mockVerify(token) }),
    }),
  },
  getOrgForHost: async (hostId: string) => {
    const host = mockStore.current.docs.get(`hosts/${hostId}`)
    const orgId = String(host?.['orgId'] ?? '')
    return orgId ? { orgId, org: mockStore.current.docs.get(`orgs/${orgId}`) ?? {} } : null
  },
  resolveOrgMembership: (uid: string, orgId: string) => mockMembership(uid, orgId),
  // "Manage billing" is the case's own answer; every other key, such as
  // "Manage the workspace's domains" (AGL-4047), the catalog's verdict.
  memberHasOrgPermission: (_orgId: string, member: unknown, permission: string) =>
    permission === 'billing.manage'
      ? mockBilling()
      : jest.requireActual('@aglyn/aglyn/app-utils/org-permissions').resolveOrgPermissions(member, null)[permission] ===
        true,
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-fraud-hold', () => ({
  isPaymentFraudHeld: (db: unknown, orgId: string) => mockFraudHeld(db, orgId),
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: () => true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  isRefusedIdToken: () => false,
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerDomainsDeclarations } from '../declarations'
import {
  registerPurchaseGatePreclearance,
  type PurchaseGatePreclearanceInput,
} from '@aglyn/aglyn/plugin-manager/purchase-gate-preclearance'
import type { DomainRegistrationDoc } from '../model/registration'
import { registrationRef } from './db'
import {
  domainsGate,
  MAX_HELD_PER_WORKSPACE,
  PAID_HISTORY_MIN_AGE_MS,
  PURCHASES_PER_30_DAYS,
  purchaseClearance,
  purchaseRefusal,
  type DomainsActor,
} from './gates'

/**
 * Who may buy a domain, and when (AGL-3962), with core's purchase-gate
 * preclearance (AGL-3955): a staff-minted waiver stands in for the 72 h
 * payment history and for nothing else.
 */

const NOW = Date.parse('2026-11-01T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

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

/** What core's preclearance was asked, and the workspaces holding a waiver. */
let asked: PurchaseGatePreclearanceInput[] = []

function waiverFor(orgId: string, preclearanceId: string): void {
  registerPurchaseGatePreclearance(
    {
      async check(input) {
        asked.push(input)
        return input.orgId === orgId ? { preclearanceId } : null
      },
      async consume() {
        throw new Error('the gate only asks; the purchase spends')
      },
    },
    { pluginId: 'console' },
  )
}

/** A paid platform invoice, `ageMs` old. */
function paidInvoice(ageMs: number): void {
  // Written past the double's JSON clone: `recordedAt` is a Timestamp.
  mockStore.current.docs.set('platformRevenue/in_1', {
    orgId: 'org-1',
    grossCents: 2900,
    recordedAt: { toMillis: () => NOW - ageMs },
  })
}

async function registration(domain: string, patch: Partial<DomainRegistrationDoc>): Promise<void> {
  await registrationRef(domain).set({
    domain,
    orgId: 'org-1',
    hostId: 'host-other',
    status: 'active',
    createdAtMs: NOW - 90 * DAY,
    ...patch,
  } as never)
}

// The workspace's domains key in the catalog (AGL-4047), as the declarations register it.
beforeAll(() => registerDomainsDeclarations())

beforeEach(() => {
  mockStore.current = new MemoryFirestore()
  mockFraudHeld.mockReset()
  mockFraudHeld.mockImplementation(async () => false)
  resetPluginServicesForTests()
  asked = []
  mockVerify.mockReset()
  mockVerify.mockImplementation(async () => ({ uid: 'user-1', email: 'alex@testbakery.com' }))
  mockMembership.mockReset()
  mockMembership.mockImplementation(async () => null)
  mockBilling.mockReset()
  mockBilling.mockImplementation(async () => true)
})

describe('the 72 h payment-history gate', () => {
  it('refuses a workspace with no cleared payment and no preclearance', async () => {
    paidInvoice(PAID_HISTORY_MIN_AGE_MS - 60_000)
    expect(await purchaseClearance(ACTOR, 'testbakery.com', NOW)).toEqual({
      refusal: 'no-payment-history',
      preclearanceId: null,
    })
    expect(await purchaseRefusal(ACTOR, 'testbakery.com', NOW)).toBe('no-payment-history')
  })

  it('lets a staff preclearance stand in for it, and hands its id to the purchase unspent', async () => {
    waiverFor('org-1', 'link-1')
    expect(await purchaseClearance(ACTOR, 'testbakery.com', NOW)).toEqual({
      refusal: null,
      preclearanceId: 'link-1',
    })
    expect(asked).toEqual([{ orgId: 'org-1', gate: 'domain-payment-history' }])
    // What the card is told before the click: it may buy.
    expect(await purchaseRefusal(ACTOR, 'testbakery.com', NOW)).toBeNull()
  })

  it('does not take another workspace’s preclearance', async () => {
    waiverFor('org-2', 'link-2')
    expect(await purchaseClearance(ACTOR, 'testbakery.com', NOW)).toEqual({
      refusal: 'no-payment-history',
      preclearanceId: null,
    })
  })

  it('fails closed when the preclearance cannot be read', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPurchaseGatePreclearance(
      {
        check: async () => {
          throw new Error('bundle links unreachable')
        },
        consume: async () => false,
      },
      { pluginId: 'console' },
    )
    expect((await purchaseClearance(ACTOR, 'testbakery.com', NOW)).refusal).toBe('no-payment-history')
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('asks for no preclearance once the payment has cleared, so none is spent', async () => {
    paidInvoice(PAID_HISTORY_MIN_AGE_MS + 60_000)
    waiverFor('org-1', 'link-1')
    expect(await purchaseClearance(ACTOR, 'testbakery.com', NOW)).toEqual({
      refusal: null,
      preclearanceId: null,
    })
    expect(asked).toEqual([])
  })

  it('leaves staff past the gate as before, spending nothing', async () => {
    waiverFor('org-1', 'link-1')
    expect(await purchaseClearance({ ...ACTOR, staff: true }, 'testbakery.com', NOW)).toEqual({
      refusal: null,
      preclearanceId: null,
    })
    expect(asked).toEqual([])
  })
})

describe('every other refusal stands with a preclearance in hand', () => {
  const cases: Array<[string, () => Promise<{ actor?: DomainsActor; domain?: string }>]> = [
    ['lookalike', async () => ({ domain: 'aglyn-billing.com' })],
    [
      'fraud-hold',
      async () => {
        mockFraudHeld.mockImplementation(async () => true)
        return {}
      },
    ],
    [
      'too-many-held',
      async () => {
        for (let index = 0; index < MAX_HELD_PER_WORKSPACE; index += 1) {
          await registration(`held${index}.com`, {})
        }
        return {}
      },
    ],
    [
      'too-many-recently',
      async () => {
        for (let index = 0; index < PURCHASES_PER_30_DAYS; index += 1) {
          await registration(`recent${index}.com`, { status: 'refunded', createdAtMs: NOW - DAY })
        }
        return {}
      },
    ],
  ]

  it.each(cases)('%s', async (refusal, arrange) => {
    waiverFor('org-1', 'link-1')
    const { actor = ACTOR, domain = 'testbakery.com' } = await arrange()
    expect(await purchaseClearance(actor, domain, NOW)).toEqual({ refusal, preclearanceId: null })
    // The waiver is asked about last, so a refused purchase never reads it.
    expect(asked).toEqual([])
  })
})

describe('buying while a site has a domain (AGL-4040)', () => {
  it('is no refusal: a site with a domain, or one bought for it, may buy another', async () => {
    paidInvoice(PAID_HISTORY_MIN_AGE_MS + 60_000)
    await registration('testbakery.net', { hostId: 'host-1' })
    const withDomain = { ...ACTOR, host: { cname: 'example.com' } }
    expect(await purchaseClearance(withDomain, 'testbakery.com', NOW)).toEqual({
      refusal: null,
      preclearanceId: null,
    })
  })

  it('keeps the workspace caps across every site and the workspace itself', async () => {
    paidInvoice(PAID_HISTORY_MIN_AGE_MS + 60_000)
    for (let index = 0; index < MAX_HELD_PER_WORKSPACE; index += 1) {
      await registration(`held${index}.com`, { hostId: index % 2 ? null : 'host-2' })
    }
    expect(await purchaseRefusal({ ...ACTOR, hostId: null, host: null }, 'testbakery.com', NOW)).toBe(
      'too-many-held',
    )
  })
})

describe('the workspace-level gate (AGL-4040)', () => {
  const request = (body: Record<string, unknown> | null, query = '') =>
    new Request(`https://console.test/api/registrar/workspace${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

  beforeEach(() => {
    mockStore.current.docs.set('orgs/org-1', { name: 'Test Org', billing: { planId: 'starter' } })
    mockStore.current.docs.set('hosts/host-1', { orgId: 'org-1', memberRoles: { 'user-1': 'admin' } })
  })

  it('admits a workspace owner or admin by orgId, with no site', async () => {
    mockMembership.mockImplementation(async () => ({ orgId: 'org-1', member: { role: 'admin' } }))
    const gate = await domainsGate(request(null, '?orgId=org-1'), {
      billing: false,
      scope: 'workspace',
      entitlement: false,
    })
    expect(gate).not.toBeInstanceOf(Response)
    if (gate instanceof Response) return
    expect(gate.actor).toMatchObject({ orgId: 'org-1', hostId: null, host: null })
  })

  it('asks "Manage the workspace’s domains", so a role or the member’s own permissions decide (AGL-4047)', async () => {
    mockMembership.mockImplementation(async () => ({
      orgId: 'org-1',
      member: { role: 'editor', allHosts: true, permissions: { 'domains.manage': true } },
    }))
    expect(await domainsGate(request({ orgId: 'org-1' }), { billing: false, scope: 'workspace', entitlement: false })).not.toBeInstanceOf(Response)
    mockMembership.mockImplementation(async () => ({
      orgId: 'org-1',
      member: { role: 'admin', permissions: { 'domains.manage': false } },
    }))
    const refused = await domainsGate(request({ orgId: 'org-1' }), { billing: false, scope: 'workspace', entitlement: false })
    expect((refused as Response).status).toBe(403)
    expect(await (refused as Response).json()).toMatchObject({
      error: 'Your role does not include "Manage the workspace’s domains" — ask an organization admin',
      code: 'workspace-admin',
    })
  })

  it('refuses a member who is not a workspace owner or admin', async () => {
    mockMembership.mockImplementation(async () => ({ orgId: 'org-1', member: { role: 'editor' } }))
    const gate = await domainsGate(request({ orgId: 'org-1' }), { billing: false, scope: 'workspace', entitlement: false })
    expect(gate).toBeInstanceOf(Response)
    expect((gate as Response).status).toBe(403)
    expect(await (gate as Response).json()).toMatchObject({ code: 'workspace-admin' })
  })

  it('still asks billing permission to buy, and names no site', async () => {
    mockMembership.mockImplementation(async () => ({ orgId: 'org-1', member: { role: 'owner' } }))
    mockBilling.mockImplementation(async () => false)
    const gate = await domainsGate(request({ orgId: 'org-1' }), { billing: true, scope: 'workspace', entitlement: false })
    expect((gate as Response).status).toBe(403)
    expect(await (gate as Response).json()).toMatchObject({ code: 'billing-permission' })
  })

  it('refuses a request without a workspace, and keeps the plan gate when asked', async () => {
    mockMembership.mockImplementation(async () => ({ orgId: 'org-1', member: { role: 'owner' } }))
    expect(((await domainsGate(request({}), { billing: false, scope: 'workspace' })) as Response).status).toBe(400)
    const unentitled = await domainsGate(request({ orgId: 'org-1' }), { billing: false, scope: 'workspace' })
    expect((unentitled as Response).status).toBe(402)
  })

  it('treats a request naming a site as the site’s, under either scope', async () => {
    const gate = await domainsGate(request({ hostId: 'host-1' }), {
      billing: false,
      scope: 'either',
      entitlement: false,
    })
    expect(gate).not.toBeInstanceOf(Response)
    if (gate instanceof Response) return
    expect(gate.actor).toMatchObject({ orgId: 'org-1', hostId: 'host-1' })
  })
})
