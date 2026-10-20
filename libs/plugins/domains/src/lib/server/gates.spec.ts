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
const mockFraudHeld = jest.fn<Promise<boolean>, [unknown, string]>(async () => false)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockStore.current }) },
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
import {
  registerPurchaseGatePreclearance,
  type PurchaseGatePreclearanceInput,
} from '@aglyn/aglyn/plugin-manager/purchase-gate-preclearance'
import type { DomainRegistrationDoc } from '../model/registration'
import { registrationRef } from './db'
import {
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

beforeEach(() => {
  mockStore.current = new MemoryFirestore()
  mockFraudHeld.mockReset()
  mockFraudHeld.mockImplementation(async () => false)
  resetPluginServicesForTests()
  asked = []
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
    ['site-has-domain', async () => ({ actor: { ...ACTOR, host: { cname: 'example.com' } } })],
    [
      'site-has-bought-domain',
      async () => {
        await registration('testbakery.net', { hostId: 'host-1' })
        return {}
      },
    ],
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
