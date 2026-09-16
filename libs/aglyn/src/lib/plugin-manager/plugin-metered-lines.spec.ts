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
 * A METER LINE A PLUGIN BILLS FOR ITSELF (AGL-3011).
 *
 * The registry that keeps one month's usage on exactly one invoice. Every
 * case below is written so that the FAILURE mode bills through the monthly
 * meter — the channel that already works — rather than through neither.
 */

import {
  pluginBillsMeteredLine,
  pluginMeteredLineOwner,
  registerPluginMeteredLine,
  resetPluginMeteredLinesForTests,
  runPluginMeteredLineClose,
} from './plugin-metered-lines'

const CONTEXT = {
  orgId: 'org-1',
  month: '2026-10',
  org: {},
  stripeCustomerId: 'cus_1',
}

afterEach(() => {
  resetPluginMeteredLinesForTests()
  jest.restoreAllMocks()
})

describe('claiming a line', () => {
  it('needs an owner', () => {
    expect(() =>
      registerPluginMeteredLine({ lineId: 'assist-overage', billsFrom: () => null }),
    ).toThrow(/no owner/)
  })

  it('refuses a second plugin on a line another holds', () => {
    // Two plugins each believing they bill a line is how it reaches no
    // invoice at all — the opposite failure to double billing, and worse,
    // because nothing reports it.
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => '2026-10',
    })
    expect(() =>
      registerPluginMeteredLine({
        lineId: 'assist-overage',
        pluginId: 'commerce',
        billsFrom: () => '2026-10',
      }),
    ).toThrow(/already billed by plugin "ai"/)
    expect(pluginMeteredLineOwner('assist-overage')).toBe('ai')
  })

  it('lets the same plugin re-register without claiming twice', () => {
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => null,
    })
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => '2026-10',
    })
    expect(pluginBillsMeteredLine('assist-overage', '2026-10')).toBe(true)
  })
})

describe('who bills the month', () => {
  it('leaves an unclaimed line to the sweep', () => {
    expect(pluginBillsMeteredLine('assist-overage', '2026-10')).toBe(false)
  })

  it('hands over from the claimed month and never before it', () => {
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => '2026-10',
    })
    expect(pluginBillsMeteredLine('assist-overage', '2026-09')).toBe(false)
    expect(pluginBillsMeteredLine('assist-overage', '2026-10')).toBe(true)
    expect(pluginBillsMeteredLine('assist-overage', '2027-01')).toBe(true)
  })

  it('leaves the line to the sweep while the claim names no month', () => {
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => null,
    })
    expect(pluginBillsMeteredLine('assist-overage', '2026-10')).toBe(false)
  })

  it('leaves the line to the sweep when the claim throws', () => {
    // The sweep is the only thing billing the line while a claim is broken.
    // A throw that propagated would fail a whole month's billing for every
    // workspace on the platform.
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => {
        throw new Error('config read failed')
      },
    })
    expect(pluginBillsMeteredLine('assist-overage', '2026-10')).toBe(false)
    expect(logged).toHaveBeenCalled()
  })
})

describe('closing a month', () => {
  it('runs the claiming plugin’s close-out', async () => {
    const closeMonth = jest.fn().mockResolvedValue(undefined)
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => '2026-10',
      closeMonth,
    })
    expect(await runPluginMeteredLineClose('assist-overage', CONTEXT)).toBe(true)
    expect(closeMonth).toHaveBeenCalledWith(CONTEXT)
  })

  it('does not run it for a month the plugin does not bill', async () => {
    const closeMonth = jest.fn().mockResolvedValue(undefined)
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => '2026-11',
      closeMonth,
    })
    expect(await runPluginMeteredLineClose('assist-overage', CONTEXT)).toBe(false)
    expect(closeMonth).not.toHaveBeenCalled()
  })

  it('isolates a close-out that throws', async () => {
    // This runs inside the platform's own metering sweep. A plugin's Stripe
    // call failing must not cost every workspace behind it its invoice.
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginMeteredLine({
      lineId: 'assist-overage',
      pluginId: 'ai',
      billsFrom: () => '2026-10',
      closeMonth: async () => {
        throw new Error('stripe is down')
      },
    })
    await expect(runPluginMeteredLineClose('assist-overage', CONTEXT)).resolves.toBe(false)
    expect(logged).toHaveBeenCalled()
  })

  it('answers false when nothing claims the line at all', async () => {
    expect(await runPluginMeteredLineClose('assist-overage', CONTEXT)).toBe(false)
  })
})
