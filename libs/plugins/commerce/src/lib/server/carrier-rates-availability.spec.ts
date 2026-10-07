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

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  registerPluginShippingRateQuoter,
  type PluginShippingRateQuoter,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { carrierRatesAvailabilityHandler } from './carrier-rates-availability'

/**
 * Whether the Shipping card offers the Carrier rates kind: only to a
 * collaborator of the site, and only where a plugin quotes carriers for it.
 * With no quoter registered — no shipping plugin, or a deployment naming no
 * provider — the answer is no, which is what keeps the kind hidden.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token === 'tok-editor') return { uid: 'uid-editor' }
          if (token === 'tok-outsider') return { uid: 'uid-outsider' }
          throw new Error('auth/argument-error')
        },
      }),
      firestore: () => ({
        collection: () => ({
          doc: (hostId: string) => ({
            get: async () => ({
              exists: hostId === 'host-1',
              get: (field: string) => (field === 'memberRoles' ? { 'uid-editor': 'editor' } : undefined),
            }),
          }),
        }),
      }),
    }),
  },
}))

function invoke(options: { method?: string; token?: string; hostId?: string }) {
  let statusCode = 0
  let payload: any
  const res = {
    status(code: number) {
      statusCode = code
      return res
    },
    json(body: unknown) {
      payload = body
      return res
    },
  }
  const req = {
    method: options.method ?? 'GET',
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    query: options.hostId === undefined ? {} : { hostId: options.hostId },
  }
  return Promise.resolve(carrierRatesAvailabilityHandler(req as never, res as never, {} as never)).then(() => ({
    status: statusCode,
    body: payload,
  }))
}

const quoter = (available: boolean): PluginShippingRateQuoter => ({
  available: async () => available,
  quote: async () => [],
  listServices: async () => [{ serviceKey: 'usps:priority', carrier: 'USPS', label: 'USPS Priority Mail' }] as never,
})

beforeEach(() => resetPluginServicesForTests())

describe('GET commerce/shipping/carrier-rates', () => {
  it('refuses a wrong method, no token, no site and a non-collaborator', async () => {
    expect((await invoke({ method: 'POST', token: 'tok-editor', hostId: 'host-1' })).status).toBe(405)
    expect((await invoke({ hostId: 'host-1' })).status).toBe(401)
    expect((await invoke({ token: 'tok-editor' })).status).toBe(400)
    expect((await invoke({ token: 'tok-editor', hostId: '__reserved__' })).status).toBe(400)
    expect((await invoke({ token: 'tok-editor', hostId: 'host-404' })).status).toBe(404)
    expect((await invoke({ token: 'tok-outsider', hostId: 'host-1' })).status).toBe(403)
  })

  it('says no when nobody quotes carriers, or the quoter is not available for the site', async () => {
    expect(await invoke({ token: 'tok-editor', hostId: 'host-1' })).toEqual({
      status: 200,
      body: { available: false, services: [] },
    })
    registerPluginShippingRateQuoter(quoter(false), { pluginId: 'courier' })
    expect((await invoke({ token: 'tok-editor', hostId: 'host-1' })).body).toEqual({ available: false, services: [] })
  })

  it('offers the kind with its services where a quoter is available', async () => {
    registerPluginShippingRateQuoter(quoter(true), { pluginId: 'courier' })
    const { status, body } = await invoke({ token: 'tok-editor', hostId: 'host-1' })
    expect(status).toBe(200)
    expect(body.available).toBe(true)
    expect(body.services).toEqual([expect.objectContaining({ serviceKey: 'usps:priority' })])
  })

  it('refuses a token the verifier refuses', async () => {
    expect((await invoke({ token: 'tok-forged', hostId: 'host-1' })).status).toBe(401)
  })
})
