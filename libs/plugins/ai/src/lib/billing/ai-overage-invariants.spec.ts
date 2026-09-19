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
 * WHAT MUST NOT CHANGE (AGL-3011).
 *
 * This work ships with its switch off. `AI_OVERAGE_INVOICED_FROM` names no
 * month, and until it does every workspace must behave EXACTLY as it did:
 * overage accrues, the monthly sweep meters it, the renewal invoice bills
 * it, and nothing new refuses anybody.
 *
 * That is not a nice-to-have. The guards refuse a workspace whose accrued
 * overage has not been paid for, and before the cutover nothing charges — so
 * a guard that came on early would refuse every workspace past $50 of
 * overage with no invoice to pay and no way to clear it.
 *
 * So every assertion below is about the SHIPPED configuration, and each one
 * is written to go red if the switch ever defaults to on.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

import {
  AI_OVERAGE_INVOICED_FROM_ENV,
  aiOverageBillsByInvoice,
  aiOverageGuardsApply,
  aiOverageInvoicedFrom,
} from './ai-overage-cutover'
import { maybeChargeAiOverage, closeOutAiOverage } from './ai-overage-charge'
import {
  pluginBillsMeteredLine,
  resetPluginMeteredLinesForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-metered-lines'

const ORIGINAL = process.env[AI_OVERAGE_INVOICED_FROM_ENV]

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
  else process.env[AI_OVERAGE_INVOICED_FROM_ENV] = ORIGINAL
  resetPluginMeteredLinesForTests()
})

/** A Firestore that fails loudly if anything reads or writes through it. */
function forbiddenFirestore(): FirebaseFirestore.Firestore {
  const refuse = () => {
    throw new Error('the charge path touched Firestore before the cutover')
  }
  return {
    collection: refuse,
    runTransaction: refuse,
  } as unknown as FirebaseFirestore.Firestore
}

describe('the cutover ships off', () => {
  it('names no month when the variable is unset', () => {
    delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
    expect(aiOverageInvoicedFrom()).toBeNull()
    expect(aiOverageBillsByInvoice('2026-09')).toBe(false)
    expect(aiOverageGuardsApply('2026-09')).toBe(false)
  })

  it('names no month for a value that is not a month', () => {
    // A typo must leave the platform billing through the channel that
    // works, not stop billing and not half-start.
    for (const value of ['', 'now', '2026-9', '2026-13-01', 'true']) {
      process.env[AI_OVERAGE_INVOICED_FROM_ENV] = value
      expect(aiOverageInvoicedFrom()).toBeNull()
      expect(aiOverageBillsByInvoice('2026-09')).toBe(false)
    }
  })

  it('bills by invoice from the named month and never before it', () => {
    process.env[AI_OVERAGE_INVOICED_FROM_ENV] = '2026-10'
    expect(aiOverageBillsByInvoice('2026-09')).toBe(false)
    expect(aiOverageBillsByInvoice('2026-10')).toBe(true)
    expect(aiOverageBillsByInvoice('2026-11')).toBe(true)
    // The year boundary, where a lexical compare would be wrong if the
    // format were not fixed-width.
    expect(aiOverageBillsByInvoice('2027-01')).toBe(true)
    expect(aiOverageBillsByInvoice('2025-12')).toBe(false)
  })

  it('reads the variable on every call, not once at load', () => {
    // A process that started before the variable was set must not be stuck
    // a month behind; the cutover is a deployment change, not a restart.
    delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
    expect(aiOverageBillsByInvoice('2026-10')).toBe(false)
    process.env[AI_OVERAGE_INVOICED_FROM_ENV] = '2026-10'
    expect(aiOverageBillsByInvoice('2026-10')).toBe(true)
  })

  it('guards exactly when it charges — never one without the other', () => {
    // A guard without a charge is a wall the customer cannot climb: nothing
    // would ever pay down the balance it refuses on.
    for (const month of ['2026-08', '2026-09', '2026-10', '2027-03']) {
      process.env[AI_OVERAGE_INVOICED_FROM_ENV] = '2026-09'
      expect(aiOverageGuardsApply(month)).toBe(aiOverageBillsByInvoice(month))
    }
    delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
    expect(aiOverageGuardsApply('2026-09')).toBe(aiOverageBillsByInvoice('2026-09'))
  })
})

describe('the charge path is inert before the cutover', () => {
  const request = {
    orgId: 'org-1',
    org: { plan: 'pro' } as never,
    month: '2026-09',
    stripeCustomerId: 'cus_1',
  }

  it('charges nothing and reads nothing', async () => {
    delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
    const threshold = await maybeChargeAiOverage(forbiddenFirestore(), request)
    expect(threshold).toMatchObject({ charged: false, skipped: 'before-cutover' })
    const closeout = await closeOutAiOverage(forbiddenFirestore(), request)
    expect(closeout).toMatchObject({ charged: false, skipped: 'before-cutover' })
  })

  it('charges nothing for a month before the cutover once it is set', async () => {
    process.env[AI_OVERAGE_INVOICED_FROM_ENV] = '2026-10'
    const answer = await maybeChargeAiOverage(forbiddenFirestore(), {
      ...request,
      month: '2026-09',
    })
    expect(answer.skipped).toBe('before-cutover')
  })
})

describe('the monthly meter keeps billing until a plugin claims the line', () => {
  it('leaves an unclaimed line to the sweep', () => {
    // No claim registered: the sweep bills AI overage exactly as it does
    // today. This is the state the code ships in — the plugin's claim only
    // takes effect once its own cutover month is set.
    expect(pluginBillsMeteredLine('assist-overage', '2026-09')).toBe(false)
  })
})
