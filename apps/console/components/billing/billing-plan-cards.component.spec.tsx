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
 * In-console tier visibility (AGL-1864, under AGL-1859 §1 — Zach's
 * twice-given directive: "hide or de-emphasize the lower subscription tiers …
 * upgrade paths prominent and one-click").
 *
 * This shipped with NO test at all. Nothing in `apps/console/specs` touched
 * `showLowerTiers`, the disclosure, or the recommended tier, so the ladder
 * could have been flattened back to seven equal cards — the exact thing the
 * directive asks against — without one red test.
 *
 * The property under test is the ASYMMETRY, and the line it must not cross:
 * lower tiers are HIDDEN BY DEFAULT, never REMOVED. Pretending the cheaper
 * plans do not exist is a dark pattern and it also loses the downgrade the
 * retention funnel wants to offer as a save. So every test here checks both
 * halves — collapsed by default, and reachable in one click.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { BillingPlanCardsComponent } from './billing-plan-cards.component'

function renderCards(
  overrides: Partial<
    React.ComponentProps<typeof BillingPlanCardsComponent>
  > = {},
) {
  const onSelect = jest.fn()
  render(
    <BillingPlanCardsComponent plan="pro" onSelect={onSelect} {...overrides} />,
  )
  return { onSelect }
}

/** The disclosure that reveals the collapsed tiers, if it is rendered. */
function disclosure(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Show \d+ lower plan|Hide lower plans/ })
}

/** Whether a tier's card is in the document, by its heading text. */
function cardShown(label: string): boolean {
  return screen.queryAllByText(label).length > 0
}

describe('lower tiers are collapsed by default (AGL-1864)', () => {
  it('an org on Pro sees neither Free nor Starter until it asks', () => {
    renderCards({ plan: 'pro' })
    expect(cardShown('Free')).toBe(false)
    expect(cardShown('Starter')).toBe(false)
    // The tiers ABOVE are the page's default content — the upgrade path leads.
    expect(cardShown('Business')).toBe(true)
    expect(cardShown('Scale')).toBe(true)
  })

  it('the disclosure counts what it is hiding, and one click reveals them', () => {
    renderCards({ plan: 'pro' })
    const toggle = disclosure()
    // Free and Starter — the two below Pro.
    expect(toggle?.textContent).toMatch(/Show 2 lower plans/)
    fireEvent.click(toggle as HTMLElement)
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Starter')).toBe(true)
    expect(disclosure()?.textContent).toMatch(/Hide lower plans/)
  })

  it('HIDDEN, never REMOVED — a customer looking for a cheaper plan finds one', () => {
    // The line between de-emphasis and a trap. If this ever fails because the
    // lower cards stopped existing rather than stopped showing, the component
    // has crossed it.
    const { onSelect } = renderCards({ plan: 'pro' })
    fireEvent.click(disclosure() as HTMLElement)
    const downgrades = screen.getAllByRole('button', { name: 'Downgrade' })
    expect(downgrades.length).toBeGreaterThan(0)
    fireEvent.click(downgrades[0])
    expect(onSelect).toHaveBeenCalled()
  })

  it('the disclosure explains the asymmetry only once the tiers are on screen', () => {
    renderCards({ plan: 'pro' })
    // The tip carries an href to the docs, so it is a LINK, not a button.
    const tip = /Help: Moving to a lower plan takes effect later/i
    // Collapsed there is nothing yet to explain.
    expect(screen.queryByRole('link', { name: tip })).toBeNull()
    fireEvent.click(disclosure() as HTMLElement)
    // Expanded, the customer is looking at a downgrade — and end-of-cycle is
    // the one thing no card can say in its own corner (AGL-1862).
    expect(screen.getByRole('link', { name: tip })).toBeTruthy()
  })
})

describe('the upgrade path leads (AGL-1864)', () => {
  it('the next tier up is the recommended one', () => {
    renderCards({ plan: 'pro' })
    expect(screen.getAllByText('Recommended').length).toBe(1)
    // Business is the tier directly above Pro.
    expect(cardShown('Business')).toBe(true)
  })

  it('upgrades say Upgrade and downgrades say Downgrade — never the same control', () => {
    renderCards({ plan: 'pro' })
    expect(screen.getAllByRole('button', { name: 'Upgrade' }).length).toBeGreaterThan(0)
    // Nothing offers a downgrade until the disclosure is opened: a downgrade
    // is never a one-click peer of Upgrade on this card grid.
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull()
  })

  it('the TOP self-serve tier recommends nothing — there is nothing above it', () => {
    renderCards({ plan: 'agency' })
    expect(screen.queryByText('Recommended')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})

describe('collapsing only ever applies to an org with a tier to be below (AGL-1864)', () => {
  it('a visitor with NO plan yet sees the whole ladder', () => {
    renderCards({ plan: undefined })
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Agency')).toBe(true)
    // Nothing is a downgrade for them, so there is nothing to disclose.
    expect(disclosure()).toBeNull()
  })

  it('an org on Free has nothing below it and gets no disclosure', () => {
    renderCards({ plan: 'free' })
    expect(cardShown('Starter')).toBe(true)
    expect(disclosure()).toBeNull()
  })

  it('an ENTERPRISE org sits above the ladder — no collapse, no recommendation', () => {
    // Its stored `plan` may still be the base tier it was provisioned on
    // (AGL-1110), which must not collapse the grid or badge a self-serve card.
    renderCards({ plan: 'pro', enterprise: true })
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Starter')).toBe(true)
    expect(disclosure()).toBeNull()
    expect(screen.queryByText('Recommended')).toBeNull()
  })
})

describe('a stated intent overrides the default (AGL-1117 under AGL-1864)', () => {
  it('a ?plan= deep link to a LOWER tier starts expanded, not collapsed', () => {
    // Collapsing the tier the visitor explicitly clicked on the marketing site
    // would make the link look broken. De-emphasis is a default, not an
    // override of something the person already told us.
    renderCards({ plan: 'pro', highlight: 'starter' })
    expect(cardShown('Starter')).toBe(true)
    expect(disclosure()?.textContent).toMatch(/Hide lower plans/)
  })

  it('a deep link EXPANDS a lower tier but never RECOMMENDS one (AGL-2142)', () => {
    // The card used to carry the "Recommended" chip and a primary border while
    // simultaneously being dimmed and labelled Downgrade — recommending and
    // de-emphasizing itself at once. AGL-1859 §2: a downgrade is never the
    // emphasized control.
    renderCards({ plan: 'pro', highlight: 'starter' })
    const chips = screen.getAllByText('Recommended')
    expect(chips.length).toBe(1)
    // The recommendation falls back to the next tier UP, not the deep link.
    expect(chips[0].closest('.MuiCard-root')?.textContent).toMatch(/Business/)
    expect(chips[0].closest('.MuiCard-root')?.textContent).not.toMatch(/Starter/)
  })

  it('a deep link to a HIGHER tier leaves the lower ones collapsed', () => {
    renderCards({ plan: 'pro', highlight: 'scale' })
    expect(cardShown('Free')).toBe(false)
    expect(disclosure()?.textContent).toMatch(/Show 2 lower plans/)
  })

  it('a deep link to the plan the org is ALREADY on recommends nothing new', () => {
    renderCards({ plan: 'pro', highlight: 'pro' })
    // Falls back to the next-tier-up default rather than badging the current
    // card as a recommendation to buy what they have.
    expect(screen.getAllByText('Recommended').length).toBe(1)
    expect(screen.getAllByText('Current plan').length).toBe(1)
  })
})
