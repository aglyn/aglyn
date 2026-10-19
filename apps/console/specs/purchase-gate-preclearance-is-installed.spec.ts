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
 * THIS APP INSTALLS THE BUNDLE LINK'S PURCHASE-GATE WAIVER AT BOOT (AGL-3955).
 *
 * The domains plugin asks core for `core.purchase-gate-preclearance` before
 * it refuses a purchase on the 72-hour paid-invoice gate. A process that
 * never registered it answers `null`, and every staff-minted bundle link
 * with a domain line is refused at the very step it exists for. So this
 * drives the real `register()` and checks that what the plugin calls
 * reaches this app's implementation. The implementation's own checks are
 * held in `libs/tenant/data/admin/src/lib/server/bundle-links.spec.ts`.
 */

export {}

const mockChecks: unknown[] = []
const mockConsumed: string[] = []

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

jest.mock('../utils/server/bundle-link-preclearance', () => ({
  __esModule: true,
  consoleBundleLinkPreclearance: {
    check: async (input: { orgId: string }) => {
      mockChecks.push(input)
      return input.orgId === 'org-with-link' ? { preclearanceId: 'link-1' } : null
    },
    consume: async (id: string) => {
      mockConsumed.push(id)
      return id === 'link-1'
    },
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))

import {
  checkPurchaseGatePreclearance,
  consumePurchaseGatePreclearance,
} from '@aglyn/aglyn/plugin-manager/purchase-gate-preclearance'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { register } from '../instrumentation'

const NODE_RUNTIME = process.env.NEXT_RUNTIME

beforeEach(() => {
  process.env.NEXT_RUNTIME = 'nodejs'
  resetPluginServicesForTests()
  mockChecks.length = 0
  mockConsumed.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (NODE_RUNTIME === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = NODE_RUNTIME
})

describe('the bundle link waiver is installed by this app', () => {
  it('CONTROL: nothing waives a gate before the boot step runs', async () => {
    expect(
      await checkPurchaseGatePreclearance({ orgId: 'org-with-link', gate: 'domain-payment-history' }),
    ).toBeNull()
    expect(await consumePurchaseGatePreclearance('link-1')).toBe(false)
    expect(mockChecks).toEqual([])
  })

  it('and the plugin’s check and spend reach this app once it has', async () => {
    await register()
    expect(
      await checkPurchaseGatePreclearance({ orgId: 'org-with-link', gate: 'domain-payment-history' }),
    ).toEqual({ preclearanceId: 'link-1' })
    expect(await consumePurchaseGatePreclearance('link-1')).toBe(true)
    expect(mockChecks).toEqual([{ orgId: 'org-with-link', gate: 'domain-payment-history' }])
    expect(mockConsumed).toEqual(['link-1'])
  })

  it('a workspace with no live link is still gated', async () => {
    await register()
    expect(
      await checkPurchaseGatePreclearance({ orgId: 'org-without', gate: 'domain-payment-history' }),
    ).toBeNull()
  })
})
