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
 * Aglyn AI on the plan cards (AGL-2899, AGL-4144).
 *
 * Since AGL-3965 there is ONE pool for all Aglyn AI: every plan's included
 * credits pay for generation as well as assist, so `aiGenerative` is on for
 * every plan and the row is a plain tick, like any inclusion. What a
 * workspace BUYS is Aglyn AI credits by the block (AGL-4144), 5,000 for $10
 * a month on every paid plan — so each card's quota block names the block
 * once rather than a price per plan. Enterprise's AI is in its agreement;
 * Free sells no blocks.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import {
  AI_CREDIT_BLOCK_MONTHLY_USD,
  AI_CREDITS_PER_BLOCK,
  PLAN_ENTITLEMENTS,
  SELF_SERVE_PLANS,
} from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  aiCreditsLine,
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

/** The line every paid card prints. */
const BLOCK_LINE = 'More AI credits: 5,000 for +$10/mo a block'

describe('Aglyn AI on the plan cards (AGL-2899, AGL-4144)', () => {
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

  it('names the block once on every paid card, Enterprise included, Free none', () => {
    // As a list, so a failure prints every card's line.
    expect(SELF_SERVE_PLANS.map((plan) => aiCreditsLine(plan, PLATFORM_BRAND_NAME))).toEqual(
      SELF_SERVE_PLANS.map((plan) => (plan === 'free' ? 'No Aglyn AI credit blocks' : BLOCK_LINE)),
    )
    expect(aiCreditsLine('enterprise', PLATFORM_BRAND_NAME)).toBe('Aglyn AI included')
    // The figures are the block's.
    expect(AI_CREDITS_PER_BLOCK).toBe(5000)
    expect(AI_CREDIT_BLOCK_MONTHLY_USD).toBe(10)
    // No retired tier is named.
    expect(SELF_SERVE_PLANS.map((plan) => aiCreditsLine(plan, PLATFORM_BRAND_NAME)).join(' ')).not.toMatch(
      /tier|Spark|Studio|\$9\b/,
    )
  })

  it('the comparison grid carries the block line in each card and ticks generation', () => {
    render(<BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    // One line per paid card the grid draws (a lower plan may sit behind
    // its disclosure), the same words on each. A Pro org's grid draws Pro
    // and Custom since pricing v4 (AGL-4126), Starter folded below.
    const paidCards = screen.getAllByText(BLOCK_LINE).length
    expect(paidCards).toBeGreaterThanOrEqual(
      SELF_SERVE_PLANS.filter((plan) => plan !== 'free').length - 1,
    )
    expect(paidCards).toBe(1)
    expect(screen.getAllByText('Aglyn AI included')).toHaveLength(1)
    expect(screen.getAllByText('Aglyn AI generation').length).toBeGreaterThanOrEqual(paidCards)
    // No per-plan add-on price is printed anywhere.
    expect(screen.queryByText(/Aglyn AI \(add-on\)/)).toBeNull()
    expect(screen.queryByText(/add-on \(\+\$/)).toBeNull()
  })

  it('Free names no block', () => {
    render(<BillingPlanCardsComponent plan="free" onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    expect(screen.getAllByText('No Aglyn AI credit blocks')).toHaveLength(1)
  })

  it('the focused view carries the block line on the cards it shows', () => {
    render(<BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />)
    expect(screen.getAllByText(BLOCK_LINE).length).toBeGreaterThanOrEqual(1)
  })
})
