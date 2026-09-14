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
 * The Aglyn AI add-on on the plan cards (AGL-2899).
 *
 * `aiGenerative` is false on every self-serve tier and true on Enterprise
 * (AGL-2896), so a plain tick row would read "no plan includes this" down
 * the whole ladder — true, and the wrong answer to the purchase question,
 * which is "what does it cost on this plan". The row is PRICED instead:
 * each cell is the plan's add-on price, Free a dash, Enterprise "Custom".
 *
 * The same reason keeps it out of the focused view's tick lists. An add-on
 * is neither a gain of the step up nor something a lower tier lacks; it is
 * a line in the quota block, beside the other rates, on every card.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
} from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  aiAddonCell,
  BillingPlanCardsComponent,
  FEATURE_ROWS,
} from '../components/billing/billing-plan-cards.component'

const mockBranding = {
  branding: {
    productName: PLATFORM_BRAND_NAME,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    supportUrl: PLATFORM_SUPPORT_URL,
    fromName: PLATFORM_BRAND_NAME,
    emailLogoUrl: null,
    customConsoleDomain: null,
  },
  whiteLabel: false,
  ready: true,
}

jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlag: () => ({
    released: true,
    visible: true,
    staffPreview: false,
    isStaff: false,
    ready: true,
  }),
}))

describe('the Aglyn AI (add-on) row (AGL-2899)', () => {
  it('is a checklist row keyed on the real flag, so the coverage guard sees it', () => {
    const row = FEATURE_ROWS.find((entry) => entry.key === 'aiGenerative')
    expect(row?.label).toBe('Aglyn AI (add-on)')
    expect(row?.priced).toBe('aiAddon')
    // The existing AI assist row stays: the add-on is a second line, not a
    // rename of the copy-assist rung Pro and up carry.
    expect(FEATURE_ROWS.some((entry) => entry.key === 'aiAssist')).toBe(true)
  })

  it('prices every cell from PLAN_PRICING: a dash on Free, Custom on Enterprise', () => {
    // As a list, so a failure prints the whole ladder.
    expect(
      SELF_SERVE_PLANS.map((plan) =>
        aiAddonCell(PLAN_ENTITLEMENTS[plan], PLAN_PRICING[plan]),
      ),
    ).toEqual(['—', '+$9/mo', '+$19/mo', '+$39/mo', '+$69/mo', '+$99/mo', '+$299/mo'])
    expect(aiAddonCell(PLAN_ENTITLEMENTS.enterprise, PLAN_PRICING.enterprise)).toBe(
      'Custom',
    )
    // The fixture is a plan that really sells it.
    expect(PLAN_PRICING.pro.aiAddonMonthlyUsd).toBe(19)
    expect(AI_ADDON_CREDITS_PER_MONTH.pro).toBe(9_000)
  })

  it('the comparison grid draws the priced cell on every card', () => {
    render(<BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))

    // Pro and its neighbours, priced; Enterprise, Custom.
    expect(screen.getAllByText('Aglyn AI (add-on) · +$19/mo')).toHaveLength(1)
    expect(screen.getAllByText('Aglyn AI (add-on) · +$39/mo')).toHaveLength(1)
    expect(screen.getAllByText('Aglyn AI (add-on) · +$299/mo')).toHaveLength(1)
    expect(screen.getAllByText('Aglyn AI (add-on) · Custom')).toHaveLength(1)
    // …and the rate line in each card's quota block, beside the other rates.
    expect(screen.getAllByText('Aglyn AI add-on (+$19/mo)')).toHaveLength(1)
    expect(screen.getAllByText('Aglyn AI included')).toHaveLength(1)
  })

  it('Free reads a dash in the grid, never "no plan includes this"', () => {
    render(<BillingPlanCardsComponent plan="free" onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    expect(screen.getAllByText('Aglyn AI (add-on) · —')).toHaveLength(1)
    expect(screen.getAllByText('No Aglyn AI add-on')).toHaveLength(1)
  })

  it('the focused view carries the rate line and keeps the add-on OUT of the tick lists', () => {
    render(<BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />)
    // Pro (current) and Business (recommended) both print their rate.
    expect(screen.getByText('Aglyn AI add-on (+$19/mo)')).toBeTruthy()
    expect(screen.getByText('Aglyn AI add-on (+$39/mo)')).toBeTruthy()
    // Not a gain of the step up, not something Pro lacks: the label appears
    // in no tick list, so it cannot be counted toward the row cap either.
    expect(screen.queryByText('Aglyn AI (add-on)')).toBeNull()
  })
})
