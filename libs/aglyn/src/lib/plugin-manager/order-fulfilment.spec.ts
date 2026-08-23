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
 * The order-fulfilment capability registry (AGL-2461) — the seam that lets a
 * console-hosted `/v1` endpoint record a shipment without importing the
 * commerce plugin, which `eslint.config.mjs`'s `scope:app` boundary forbids.
 *
 * Small surface, three real properties:
 *
 * 1. **absent is `null`, not a throw** — a deployment without commerce must
 *    answer "this endpoint does not exist here", and a registry that threw
 *    would make that a 500 instead of a 404;
 * 2. **re-registration by the same plugin is fine** (a process that activates
 *    a surface twice must not crash) while a DIFFERENT plugin claiming the
 *    capability throws — last-registration-wins would silently hand order
 *    writes to whichever module happened to load last;
 * 3. **`pluginId` travels with the service**, which is what lets the app gate
 *    on per-site plugin enablement without ever naming `'commerce'`.
 *
 * Each case's mutation is named on it. The whole file was run against a
 * `registerOrderFulfilmentService` that simply assigned (no owner check) and
 * a `getOrderFulfilmentService` that threw when unset; the cases named for
 * those two behaviours went red and the rest stayed green.
 */

import {
  getOrderFulfilmentService,
  registerOrderFulfilmentService,
  resetOrderFulfilmentServiceForTests,
  type OrderFulfilmentService,
} from './order-fulfilment'

const service = (pluginId: string): OrderFulfilmentService => ({
  pluginId,
  recordShipment: async () => ({ outcome: 'recorded' }),
})

beforeEach(() => {
  resetOrderFulfilmentServiceForTests()
})

afterAll(() => {
  resetOrderFulfilmentServiceForTests()
})

describe('the order-fulfilment capability registry (AGL-2461)', () => {
  it('answers null — never throws — when no plugin provides fulfilment', () => {
    // RED CHECK: make `getOrderFulfilmentService` throw when unset and this
    // fails. It matters because the caller turns `null` into a 404 ("not
    // available on this deployment") — a throw would surface as a 500 on a
    // self-host build that simply does not ship commerce, which is a
    // configuration, not a fault.
    expect(getOrderFulfilmentService()).toBeNull()
  })

  it('hands back the registered service, pluginId and all', () => {
    registerOrderFulfilmentService(service('commerce'))
    expect(getOrderFulfilmentService()?.pluginId).toBe('commerce')
  })

  it('tolerates the same plugin registering twice', () => {
    // The loader guarantees one activation per plugin+surface, but a process
    // that loads a surface through two entry points must not crash on it.
    registerOrderFulfilmentService(service('commerce'))
    expect(() =>
      registerOrderFulfilmentService(service('commerce')),
    ).not.toThrow()
    expect(getOrderFulfilmentService()?.pluginId).toBe('commerce')
  })

  it('refuses a SECOND plugin claiming the capability, and names both', () => {
    // RED CHECK: replace the owner check with a plain assignment and this
    // fails twice over — no throw, and the winner becomes `impostor`. Silent
    // last-write-wins here means order writes are served by whichever module
    // loaded last, decided by manifest order rather than by anyone.
    registerOrderFulfilmentService(service('commerce'))
    expect(() => registerOrderFulfilmentService(service('impostor'))).toThrow(
      /already provided by "commerce".*"impostor"/s,
    )
    expect(getOrderFulfilmentService()?.pluginId).toBe('commerce')
  })

  it('routes the call through to the registered implementation', async () => {
    const recordShipment = jest.fn(async () => ({ outcome: 'already' as const }))
    registerOrderFulfilmentService({ pluginId: 'commerce', recordShipment })
    const outcome = await getOrderFulfilmentService()?.recordShipment({
      hostId: 'host_1',
      orderId: 'ord_1',
      to: 'fulfilled',
    })
    expect(outcome).toEqual({ outcome: 'already' })
    expect(recordShipment).toHaveBeenCalledWith({
      hostId: 'host_1',
      orderId: 'ord_1',
      to: 'fulfilled',
    })
  })
})
