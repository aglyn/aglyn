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

import { resetPluginServicesForTests } from './plugin-services'
import {
  checkPurchaseGatePreclearance,
  consumePurchaseGatePreclearance,
  PURCHASE_GATE_PRECLEARANCE,
  registerPurchaseGatePreclearance,
} from './purchase-gate-preclearance'

/** One waiver per org, spent once: the shape the bundle links implement. */
function fakeWaivers(live: Record<string, string>) {
  const used = new Set<string>()
  return {
    check: jest.fn(async ({ orgId }: { orgId: string }) =>
      live[orgId] && !used.has(live[orgId]) ? { preclearanceId: live[orgId] } : null,
    ),
    consume: jest.fn(async (id: string) => {
      if (!Object.values(live).includes(id) || used.has(id)) return false
      used.add(id)
      return true
    }),
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('core.purchase-gate-preclearance (AGL-3955)', () => {
  it('is the contract the domains plugin agreed: a set, by this id', () => {
    expect(PURCHASE_GATE_PRECLEARANCE).toEqual({ id: 'core.purchase-gate-preclearance', multiple: true })
  })

  it('CONTROL: with nothing registered there is no waiver, and nothing to spend', async () => {
    expect(await checkPurchaseGatePreclearance({ orgId: 'org-1', gate: 'domain-payment-history' })).toBeNull()
    expect(await consumePurchaseGatePreclearance('link-1')).toBe(false)
  })

  it('finds a live waiver for the workspace, and spends it exactly once', async () => {
    registerPurchaseGatePreclearance(fakeWaivers({ 'org-1': 'link-1' }), { pluginId: 'console' })
    expect(await checkPurchaseGatePreclearance({ orgId: 'org-2', gate: 'domain-payment-history' })).toBeNull()
    const found = await checkPurchaseGatePreclearance({ orgId: 'org-1', gate: 'domain-payment-history' })
    expect(found).toEqual({ preclearanceId: 'link-1' })
    expect(await consumePurchaseGatePreclearance('link-1')).toBe(true)
    expect(await consumePurchaseGatePreclearance('link-1')).toBe(false)
    expect(await checkPurchaseGatePreclearance({ orgId: 'org-1', gate: 'domain-payment-history' })).toBeNull()
  })

  it('waives only the gate it names', async () => {
    const waivers = fakeWaivers({ 'org-1': 'link-1' })
    registerPurchaseGatePreclearance(waivers, { pluginId: 'console' })
    expect(
      await checkPurchaseGatePreclearance({ orgId: 'org-1', gate: 'brand-lookalike' as never }),
    ).toBeNull()
    expect(waivers.check).not.toHaveBeenCalled()
  })

  it('fails closed: an implementation that throws grants nothing', async () => {
    registerPurchaseGatePreclearance(
      {
        check: async () => {
          throw new Error('firestore down')
        },
        consume: async () => {
          throw new Error('firestore down')
        },
      },
      { pluginId: 'console' },
    )
    expect(await checkPurchaseGatePreclearance({ orgId: 'org-1', gate: 'domain-payment-history' })).toBeNull()
    expect(await consumePurchaseGatePreclearance('link-1')).toBe(false)
  })

  it('asks every implementation in turn', async () => {
    registerPurchaseGatePreclearance(fakeWaivers({}), { pluginId: 'console', key: 'empty' })
    registerPurchaseGatePreclearance(fakeWaivers({ 'org-1': 'link-9' }), { pluginId: 'console', key: 'links' })
    expect(await checkPurchaseGatePreclearance({ orgId: 'org-1', gate: 'domain-payment-history' })).toEqual({
      preclearanceId: 'link-9',
    })
    expect(await consumePurchaseGatePreclearance('link-9')).toBe(true)
  })

  it('refuses an implementation without both halves', () => {
    expect(() => registerPurchaseGatePreclearance({ check: async () => null } as never, { pluginId: 'x' })).toThrow(
      /check and consume/,
    )
  })
})
