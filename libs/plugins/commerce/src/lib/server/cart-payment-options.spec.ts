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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  registerPluginPaymentProvider,
  type PluginPaymentProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { cartHandler } from './cart'

/**
 * The cart's answer names the other ways to pay a store offers (AGL-3630) —
 * only for a cart with something in it, only where the store sets its own
 * tax, and not at all when no provider offers: then the answer is exactly
 * what it was.
 */

const docs = new Map<string, Record<string, any>>()
let reads: string[] = []

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => {
      reads.push(path)
      const data = docs.get(path)
      return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
    },
    set: async (value: Record<string, any>) => {
      docs.set(path, value)
    },
    collection: (name: string) => ({ doc: (id: string) => makeDocRef(`${path}/${name}/${id}`) }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => makeDocRef(`${name}/${id}`) }) }) }) },
}))

const wallet: PluginPaymentProvider = {
  available: async () => ({ providerId: 'wallet', label: 'Wallet', methods: [{ id: 'wallet', label: 'Wallet' }, { id: 'later', label: 'Later' }], livemode: false }),
  createCheckout: async () => {
    throw new Error('unused')
  },
  refund: async () => ({ ok: true, refundId: 'r', status: 'completed' }),
}

async function getCart(cookie = 'cart-1') {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    setHeader() {},
  } as unknown as PluginApiResponse
  await cartHandler(
    { method: 'GET', query: { hostId: 'host-1' }, body: {}, headers: {}, cookies: { 'aglyn_cart_host-1': cookie }, socket: {} } as unknown as PluginApiRequest,
    res,
  )
  return result
}

beforeEach(() => {
  resetPluginServicesForTests()
  docs.clear()
  reads = []
  docs.set('hosts/host-1/carts/cart-1', { lines: [{ productId: 'lamp', quantity: 1 }] })
  docs.set('hosts/host-1/products/lamp', { name: 'Lamp', type: 'physical', status: 'active', variants: [{ id: 'default', priceUsd: 100, inventory: null }] })
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'manual' } })
})

describe('the cart’s other ways to pay (AGL-3630)', () => {
  it('answers what it always answered, reading no settings, when no provider is registered', async () => {
    const result = await getCart()
    expect(result.body).toEqual({ lines: [expect.objectContaining({ productId: 'lamp' })], count: 1, subtotalCents: 10_000 })
    expect(reads).not.toContain('hosts/host-1/settings/store')
  })

  it('names the provider and its methods for a store that sets its own tax', async () => {
    registerPluginPaymentProvider('wallet', wallet, { pluginId: 'wallet-plugin' })
    expect((await getCart()).body.paymentOptions).toEqual([{ providerId: 'wallet', label: 'Wallet', methods: ['Wallet', 'Later'] }])
  })

  it('names none where the card processor calculates tax, and none for an empty cart', async () => {
    registerPluginPaymentProvider('wallet', wallet, { pluginId: 'wallet-plugin' })
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'stripe' } })
    expect((await getCart()).body).not.toHaveProperty('paymentOptions')
    docs.set('hosts/host-1/carts/cart-1', { lines: [] })
    expect((await getCart()).body).not.toHaveProperty('paymentOptions')
  })
})
