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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ESTIMATED_PAGE_TRANSFER_BYTES,
  ORIGIN_MEDIA_BANDWIDTH_WEIGHT,
  orgSubscriptionState,
  resolvePlanPricing,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { billsOrgLibraryStorage, METERED_BILLED_RATES_USD } from '@aglyn/aglyn/app-utils/console/usage-metering'

/**
 * The native "Past your plan" screen prices a month past the plan's bands from the entitlements route's quotas and
 * these constants. The month's figures are replayed against the console's own functions
 * (`billing-estimate-cases.generated.json`, by both renderers); this holds the constants themselves, and the two
 * rules the screen restates (a staff comp bills nothing; the organization library bills from a named month).
 */
interface Screen {
  id: string
  constants?: { pricing?: Record<string, Record<string, unknown>>; billed?: Record<string, number> }
  derive?: Array<{ name: string; when: string }>
  blocks: Array<{ text?: string; when?: string }>
}

const text = readFileSync(join(__dirname, '../../../libs/native/screens/billing-overage.screens.json'), 'utf8')
const screen = (JSON.parse(text) as { screens: Screen[] }).screens[0] as Screen
const derived = (name: string) => screen.derive?.find((entry) => entry.name === name)?.when ?? ''

describe('native billing overage', () => {
  it('prices a plan as the console does', () => {
    for (const plan of ['free', 'starter', 'pro', 'business', 'advanced', 'enterprise'] as const) {
      const pricing = resolvePlanPricing({ plan } as never)
      expect(screen.constants?.pricing?.[plan]).toEqual({
        extraApiRequestsUsdPer1k: pricing.extraApiRequestsUsdPer1k,
        extraContactsUsdPer1k: pricing.extraContactsUsdPer1k,
        extraEmailSendsUsdPer1k: pricing.extraEmailSendsUsdPer1k,
        meteredInfraPassThrough: pricing.meteredInfraPassThrough,
      })
    }
  })

  it('bills the published rates and converts bandwidth at the page weight the console assumes', () => {
    expect(screen.constants?.billed).toEqual(METERED_BILLED_RATES_USD)
    expect(text).toContain(String(ESTIMATED_PAGE_TRANSFER_BYTES))
    expect(text).toContain(`count ${ORIGIN_MEDIA_BANDWIDTH_WEIGHT}x toward bandwidth`)
  })

  it('treats a subscription the console calls dead as no subscription, for a staff comp', () => {
    const statuses = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']
    const dead = statuses.filter((status) => orgSubscriptionState({ subscription: { status } } as never) === 'dead')
    const named = /subscription\.status == ([a-z_,]+)/.exec(derived('comp'))?.[1]?.split(',') ?? []
    expect(named.sort()).toEqual(dead.sort())
    expect(orgSubscriptionState({} as never)).toBe('none')
  })

  it('bills the organization library from the month the console switch names, and fails closed', () => {
    const cases: Array<[string | null, string, boolean]> = [
      ['2026-10', '2026-10', true],
      ['2026-09', '2026-10', true],
      ['2026-11', '2026-10', false],
      [null, '2026-10', false],
      ['true', '2026-10', false],
      ['1', '2026-10', false],
    ]
    for (const [from, month, billed] of cases) expect(billsOrgLibraryStorage(month, from)).toBe(billed)
    // A route that did not answer includes the library: the estimate fails high.
    expect(derived('libraryBilled').startsWith('!data.config')).toBe(true)
  })

  it('quotes the same sentences as the console', () => {
    expect(text).toContain('over the included band at $')
    expect(text).toContain('if your CRM ends the month at this size.')
    expect(text).toContain('requests over the included band at')
    expect(text).toContain("on this month's invoice.")
    expect(text).toContain('is never refused at the cap, so it is what takes an organization past the band.')
    expect(text).toContain('Metered charges settle on the same invoice as your monthly subscription.')
    expect(text).toContain('Your subscription is annual, so usage accrues across the year and settles on your renewal invoice.')
  })
})
