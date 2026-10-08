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
  listPluginPaymentOptions,
  pluginPaymentProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPayPalServerDeclarations } from './declarations.server'

/**
 * Registered at boot whether or not the deployment is configured (AGL-3630),
 * and answering "no PayPal" — without a read — until it is, so a seller
 * offers its card checkout alone exactly as before.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => {
      throw new Error('no Firestore read may happen while PayPal is not configured')
    },
  },
  getOrgForHost: async () => {
    throw new Error('no org read may happen while PayPal is not configured')
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  paymentProvider: () => ({ platformMode: () => 'test' }),
}))

beforeEach(() => {
  resetPluginServicesForTests()
  registerPayPalServerDeclarations()
})

describe('PayPal’s server declarations', () => {
  it('register the provider under its id', () => {
    expect(pluginPaymentProvider('paypal')).not.toBeNull()
  })

  it('offer nothing on an unconfigured deployment, reading nothing', async () => {
    expect(
      await listPluginPaymentOptions(
        { orgId: 'org-1', hostId: 'host-1', currency: 'usd', channel: 'online' },
        { timeoutMs: 500 },
      ),
    ).toEqual([])
  })

  it('refuse to open a checkout on an unconfigured deployment', async () => {
    await expect(pluginPaymentProvider('paypal')?.createCheckout({} as never)).rejects.toThrow(/not configured/)
  })
})
