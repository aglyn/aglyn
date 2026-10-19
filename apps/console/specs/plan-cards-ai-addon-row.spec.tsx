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
 * Aglyn AI on the plan cards (AGL-2899, AGL-3965).
 *
 * Since AGL-3965 there is ONE pool for all Aglyn AI: every plan's included
 * credits pay for generation as well as assist, so `aiGenerative` is on for
 * every plan and the row is a plain tick, like any inclusion. What a
 * workspace BUYS is an Aglyn AI tier, sold on its own at the same prices on
 * every paid plan — so each card's quota block names the tiers once, from
 * the cheapest, rather than a price per plan. Enterprise's AI is in its
 * agreement; Free sells no tier.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { AI_TIERS, PLAN_ENTITLEMENTS, SELF_SERVE_PLANS } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  aiTiersLine,
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

describe('Aglyn AI on the plan cards (AGL-2899, AGL-3965)', () => {
  it('is a plain checklist row keyed on the real flag, so the coverage guard sees it', () => {
    const row = FEATURE_ROWS.find((entry) => entry.key === 'aiGenerative')
    expect(row?.label).toBe('Aglyn AI generation')
    // Not priced any more: no per-plan add-on cell.
    expect(row && 'priced' in row).toBe(false)
    // The existing AI assist row stays.
    expect(FEATURE_ROWS.some((entry) => entry.key === 'aiAssist')).toBe(true)
  })

  it('every plan carries generation against its own included credits (one pool)', () => {
    for (const plan of [...SELF_SERVE_PLANS, 'enterprise' as const]) {
      expect(`${plan}: ${PLAN_ENTITLEMENTS[plan].features.aiGenerative}`).toBe(`${plan}: true`)
    }
  })

  it('names the tiers once on every paid card, Enterprise included, Free none', () => {
    // As a list, so a failure prints the whole ladder.
    expect(SELF_SERVE_PLANS.map((plan) => aiTiersLine(plan, PLATFORM_BRAND_NAME))).toEqual([
      'No Aglyn AI tiers',
      ...Array(6).fill('More AI credits: Aglyn AI tiers from +$9/mo'),
    ])
    expect(aiTiersLine('enterprise', PLATFORM_BRAND_NAME)).toBe('Aglyn AI included')
    // The figure is the cheapest tier's.
    expect(AI_TIERS.spark.monthlyUsd).toBe(9)
  })

  it('the comparison grid carries the tiers line in each card and ticks generation', () => {
    render(<BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    // One line per paid card the grid draws (a lower tier may sit behind
    // its disclosure), the same words on each.
    const paidCards = screen.getAllByText('More AI credits: Aglyn AI tiers from +$9/mo').length
    expect(paidCards).toBeGreaterThanOrEqual(5)
    expect(screen.getAllByText('Aglyn AI included')).toHaveLength(1)
    expect(screen.getAllByText('Aglyn AI generation').length).toBeGreaterThanOrEqual(paidCards)
    // No per-plan add-on price is printed anywhere.
    expect(screen.queryByText(/Aglyn AI \(add-on\)/)).toBeNull()
    expect(screen.queryByText(/add-on \(\+\$/)).toBeNull()
  })

  it('Free names no tier', () => {
    render(<BillingPlanCardsComponent plan="free" onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    expect(screen.getAllByText('No Aglyn AI tiers')).toHaveLength(1)
  })

  it('the focused view carries the tiers line on the cards it shows', () => {
    render(<BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />)
    expect(
      screen.getAllByText('More AI credits: Aglyn AI tiers from +$9/mo').length,
    ).toBeGreaterThanOrEqual(1)
  })
})
