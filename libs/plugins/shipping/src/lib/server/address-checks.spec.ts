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

import {
  deliverPluginDomainEvent,
  listPluginDomainEventSubscribers,
  resetPluginDomainEventsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { ensureShippingAccount } from './account-store'
import {
  ADDRESS_CHECK_MAX_ATTEMPTS,
  addressFromOrder,
  checkPaidOrderAddress,
  readAddressCheck,
} from './address-checks'
import { readShippingConfig, setShippingFetchForTests } from './config'
import { setShippingDbForTests } from './db'

/**
 * The address check taken when an order is paid: subscribed to `order.paid`
 * by name, asks the carrier platform (mocked HTTP) once per order, keeps the
 * answer for the order dialog, never opens a provider account for a shopper,
 * and retries a provider failure through the outbox only so many times.
 */

let db: MemoryFirestore
const ORG = 'org-candles'
const HOST = 'host-candles'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' ? { orgId: 'org-candles', org: { name: 'Candles', plan: 'pro' } } : null,
  getHostDocAdmin: async (hostId: string) => (hostId === 'host-candles' ? { memberRoles: {} } : null),
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

const validateCalls: string[] = []
let validateStatus = 200
const shippoFetch = (async (url: string) => {
  const path = new URL(String(url)).pathname
  if (path === '/shippo-accounts') return new Response(JSON.stringify({ object_id: 'acct_candles' }))
  if (path === '/v2/addresses/validate') {
    validateCalls.push(String(url))
    if (validateStatus !== 200) return new Response(JSON.stringify({ detail: 'down' }), { status: validateStatus })
    return new Response(
      JSON.stringify({ analysis: { validation_result: { value: 'invalid', reasons: [{ description: 'Unknown street' }] } } }),
    )
  }
  return new Response('{}')
}) as typeof fetch

function config() {
  const configured = readShippingConfig()
  if (!configured.configured) throw new Error('not configured')
  return configured.config
}

const open = () => ensureShippingAccount(ORG, config(), { name: 'Rosa', email: 'r@example.com', company: 'Candles' })

const paid = (overrides: Record<string, unknown> = {}, attempt = 1) => ({
  hostId: HOST,
  attempt,
  payload: {
    order: {
      id: 'order-1',
      shippingAddress: { name: 'Ann', line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
      ...overrides,
    },
  },
})

beforeEach(() => {
  db = createMemoryFirestore()
  setShippingDbForTests(db)
  setShippingFetchForTests(shippoFetch)
  validateCalls.length = 0
  validateStatus = 200
  process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
  process.env['SHIPPING_TOKEN_KEY'] = randomBytes(32).toString('base64')
})

afterAll(() => {
  delete process.env['SHIPPO_API_TOKEN']
  delete process.env['SHIPPING_TOKEN_KEY']
})

describe('the address check taken when an order is paid', () => {
  it('asks the carrier once and keeps the answer for the order', async () => {
    await open()
    expect(await checkPaidOrderAddress(paid())).toBe('checked')
    expect(validateCalls).toHaveLength(1)
    expect(validateCalls[0]).toContain('address_line_1=2+B+St')
    const kept = await readAddressCheck(ORG, HOST, 'order-1')
    expect(kept).toMatchObject({
      recordId: 'order-1',
      source: 'checkout',
      check: { verdict: 'invalid', messages: ['Unknown street'] },
    })

    // A redelivered event finds the check there and asks nothing.
    expect(await checkPaidOrderAddress(paid())).toBe('already')
    expect(validateCalls).toHaveLength(1)
  })

  it('does nothing until the deployment is configured', async () => {
    delete process.env['SHIPPO_API_TOKEN']
    expect(await checkPaidOrderAddress(paid())).toBe('not-available')
    expect(validateCalls).toHaveLength(0)
  })

  it('never opens a provider account for a shopper’s purchase', async () => {
    expect(await checkPaidOrderAddress(paid())).toBe('not-available')
    expect(validateCalls).toHaveLength(0)
  })

  it('skips an order with nothing to ship to, or a site that does not ship', async () => {
    await open()
    expect(await checkPaidOrderAddress(paid({ shippingAddress: null }))).toBe('not-shipped')
    expect(await checkPaidOrderAddress(paid({ shippingAddress: { country: 'US', postalCode: '02108' } }))).toBe(
      'not-shipped',
    )
    expect(await checkPaidOrderAddress({ ...paid(), hostId: 'host-gone' })).toBe('not-available')
    expect(validateCalls).toHaveLength(0)
  })

  it('throws a provider failure for the outbox to retry, then gives up', async () => {
    await open()
    validateStatus = 503
    await expect(checkPaidOrderAddress(paid())).rejects.toBeTruthy()
    expect(await checkPaidOrderAddress(paid({}, ADDRESS_CHECK_MAX_ATTEMPTS))).toBe('gave-up')
    expect(await readAddressCheck(ORG, HOST, 'order-1')).toBeNull()
  })

  it('reads the seller’s address shape and Stripe’s', () => {
    expect(addressFromOrder({ line1: '2 B St', city: 'Boston', postalCode: '02108', country: 'us' })).toMatchObject({
      line1: '2 B St',
      postalCode: '02108',
      country: 'US',
    })
    expect(
      addressFromOrder({ name: 'Ann', address: { line1: '2 B St', city: 'Boston', postal_code: '02108', country: 'US' } }),
    ).toMatchObject({ name: 'Ann', line1: '2 B St', postalCode: '02108' })
    expect(addressFromOrder(null)).toBeUndefined()
  })
})

describe('the subscription', () => {
  beforeEach(() => resetPluginDomainEventsForTests())

  it('takes order.paid by name, from the server declarations', async () => {
    jest.isolateModules(() => {
      require('../declarations.server')
    })
    expect(listPluginDomainEventSubscribers('order.paid')).toContain('shipping:address-check')
    await open()
    const result = await deliverPluginDomainEvent({
      id: 'evt-1',
      event: 'order.paid',
      hostId: HOST,
      orgId: ORG,
      occurredAtMs: Date.now(),
      payload: paid().payload,
    })
    expect(result.delivered).toContain('shipping:address-check')
    expect(validateCalls).toHaveLength(1)
  })
})
