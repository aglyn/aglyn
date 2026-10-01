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
 * The AI plugin's meter in the monthly usage sweep: the provider spend
 * recorded and never billed, the overage past the band billed through the
 * meter until the cutover month and by invoice from it — one month's overage
 * reaching exactly one invoice either way.
 */

const mockMonths = new Map<string, Record<string, unknown>>()
const mockClose = jest.fn(async () => undefined)

jest.mock('./ai-overage-trigger', () => ({
  aiOverageFirestore: () => ({
    collection: () => ({
      doc: (orgId: string) => ({
        collection: () => ({
          doc: (month: string) => ({
            get: async () => {
              const data = mockMonths.get(`${orgId}/${month}`)
              return { exists: Boolean(data), get: (field: string) => data?.[field] }
            },
          }),
        }),
      }),
    }),
  }),
}))

jest.mock('./ai-overage-close', () => ({
  closeAiOverageMonth: (...args: unknown[]) => mockClose(...(args as [])),
}))

import { assistMonthOverage } from '../usage/assist-credits'
import type { PluginUsageMeterContext } from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { AI_OVERAGE_INVOICED_FROM_ENV } from './ai-overage-cutover'
import { closeAiMonth, measureAiMonth } from './ai-month-meter'

const ORIGINAL = process.env[AI_OVERAGE_INVOICED_FROM_ENV]
const MONTH = '2026-09'
const ORG = { plan: 'pro' }

const context = (): PluginUsageMeterContext => ({
  orgId: 'org-1',
  org: ORG,
  month: MONTH,
  closed: true,
  previous: {},
  releaseFlagOn: () => true,
})

beforeEach(() => {
  mockMonths.clear()
  mockClose.mockClear()
  delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
})

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
  else process.env[AI_OVERAGE_INVOICED_FROM_ENV] = ORIGINAL
})

describe('the AI month meter', () => {
  it('records the provider spend and bills the overage through the meter', async () => {
    // Billed spend far past Pro's band; the provider figure is what it cost us.
    mockMonths.set(`org-1/${MONTH}`, { estCostUsd: 40, providerCostUsd: 12 })
    const expected = assistMonthOverage(ORG as never, 40)
    expect(expected.overageMonthlyUsd).toBeGreaterThan(0)
    const reading = await measureAiMonth(context())
    expect(reading.fields).toMatchObject({
      assistCostUsd: 12,
      assistCredits: expected.usedCredits,
      assistCreditsOverage: expected.overageCredits,
      assistOverageUsd: expected.overageMonthlyUsd,
      assistOverageMeteredUsd: expected.overageMonthlyUsd,
      assistOverageBilledByPlugin: false,
    })
    expect(reading.billedUsd).toBe(expected.overageMonthlyUsd)
  })

  it('leaves the overage out of the meter from the cutover month, and still records it', async () => {
    process.env[AI_OVERAGE_INVOICED_FROM_ENV] = MONTH
    mockMonths.set(`org-1/${MONTH}`, { estCostUsd: 40 })
    const reading = await measureAiMonth(context())
    expect(reading.billedUsd).toBe(0)
    expect(reading.fields['assistOverageBilledByPlugin']).toBe(true)
    expect(reading.fields['assistOverageUsd']).toBeGreaterThan(0)
  })

  it('reads a month with no usage as nothing drawn and nothing billed', async () => {
    const reading = await measureAiMonth(context())
    expect(reading.billedUsd).toBe(0)
    expect(reading.fields).toMatchObject({ assistCostUsd: 0, assistCredits: 0 })
  })

  it('closes a month only once the plugin invoices it, reading the customer only then', async () => {
    const stripeCustomerId = jest.fn(async () => 'cus_1')
    await closeAiMonth({ ...context(), stripeCustomerId })
    expect(mockClose).not.toHaveBeenCalled()
    expect(stripeCustomerId).not.toHaveBeenCalled()

    process.env[AI_OVERAGE_INVOICED_FROM_ENV] = MONTH
    await closeAiMonth({ ...context(), stripeCustomerId })
    expect(mockClose).toHaveBeenCalledWith({
      orgId: 'org-1',
      month: MONTH,
      org: ORG,
      stripeCustomerId: 'cus_1',
    })
  })
})
