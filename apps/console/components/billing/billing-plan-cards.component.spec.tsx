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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * The Free card is two different cards (AGL-2156).
 *
 * For a PROSPECT it is an offer, and "No credit card required" behind a
 * disabled button is the right copy. For a SUBSCRIBER the same card was
 * prospect copy on a dead control: nothing on the grid said that the route to
 * Free is to cancel, and the disabled button was the ONLY thing preventing a
 * `pro → free` switch from reaching a server that answers "Unknown target
 * plan" (`PRICE_ENV` has no `free` entry, while `'free'` IS in
 * `SELF_SERVE_PLANS` and `isLadderDowngrade` classifies the move as a
 * downgrade).
 *
 * It matters to retention specifically: moving to Free is the cheapest save
 * available and the grid offered no route to it.
 */
describe('the Free card is honest to a subscriber (AGL-2156)', () => {
  function expandLowerTiers() {
    fireEvent.click(disclosure() as HTMLElement)
  }

  it('a paying org gets a WORKING route, and it says it is a cancel', () => {
    const { onSelect } = renderCards({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    const button = screen.getByRole('button', { name: 'Cancel & move to Free' })
    // jest-dom is not set up in this project — assert the property directly.
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    // The page routes 'free' at the cancel flow; the grid's job is to ask.
    expect(onSelect).toHaveBeenCalledWith('free')
  })

  it('states what happens and when, beside the control', () => {
    renderCards({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    expect(
      screen.getByText(/runs to the end of the period you have already paid for/i),
    ).toBeTruthy()
    expect(screen.getByText(/Nothing is deleted/i)).toBeTruthy()
  })

  it('never shows a subscriber the prospect copy', () => {
    renderCards({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    expect(screen.queryByText('No credit card required')).toBeNull()
  })

  it('NEGATIVE CONTROL: a PROSPECT still sees the offer, still disabled', () => {
    // There is nothing to cancel, so there is nothing to click — and "No
    // credit card required" is the true sentence for them.
    renderCards({ plan: undefined, subscriptionActive: false })
    const button = screen.getByRole('button', { name: 'No credit card required' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.queryByRole('button', { name: 'Cancel & move to Free' }),
    ).toBeNull()
  })

  it('NEGATIVE CONTROL: an ENTERPRISE org gets no self-serve route to Free', () => {
    // An enterprise agreement is changed by talking to us (AGL-1118), which
    // is true of leaving it as much as of changing tier inside it.
    renderCards({ plan: 'pro', enterprise: true, subscriptionActive: true })
    expect(
      screen.queryByRole('button', { name: 'Cancel & move to Free' }),
    ).toBeNull()
  })

  it('NEGATIVE CONTROL: an org already ON Free is not offered a cancel', () => {
    renderCards({ plan: 'free', subscriptionActive: true })
    expect(
      screen.queryByRole('button', { name: 'Cancel & move to Free' }),
    ).toBeNull()
    expect(screen.getAllByText('Current plan').length).toBe(1)
  })
})

/**
 * A pre-billing workspace has no `plan` field (AGL-2156 §3).
 *
 * The page defaults it — `const plan = (org?.plan ?? 'free') as OrgPlan`, the
 * convention AGL-1422 documents — everywhere except the one prop it hands this
 * grid, which got the raw value. `undefined` means `currentIndex = -1`: no
 * "Current plan" chip, NO tier recommended at all, and every button reading
 * "Upgrade", while the rest of the page told them they were on Free.
 *
 * The component is right to treat `undefined` as "a visitor, show the whole
 * ladder" — this pins the difference the caller must not blur.
 */
describe('an org with no plan field reads as Free, not as nothing (AGL-2156)', () => {
  it("'free' marks the current tier and recommends the next one up", () => {
    renderCards({ plan: 'free' })
    expect(screen.getAllByText('Current plan').length).toBe(1)
    expect(screen.getAllByText('Recommended').length).toBe(1)
  })

  it('undefined recommends NOTHING — which is why the page must default it', () => {
    renderCards({ plan: undefined })
    expect(screen.queryByText('Current plan')).toBeNull()
    expect(screen.queryByText('Recommended')).toBeNull()
  })
})

/**
 * ...and the caller must pass the DEFAULTED value (AGL-2156 §3).
 *
 * The two tests above pin the component's halves, but the defect was in the
 * PROP: `billing/page.tsx` computed `const plan = (org?.plan ?? 'free') as
 * OrgPlan` and used it everywhere on the page while handing this grid the raw
 * `org?.plan`. No component test can see that, so the guard reads the call
 * site — the same posture as `billing-surface-coverage.spec.ts`, where the
 * only way to find a wiring fault is to look at the wiring.
 */
describe('the billing page hands the grid a defaulted plan (AGL-2156)', () => {
  it('never passes the raw org field', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'app',
        '(app)',
        '[orgSlug]',
        'billing',
        'page.tsx',
      ),
      'utf8',
    )
    const element = source.slice(source.indexOf('<BillingPlanCardsComponent'))
    const planProp = /\bplan=\{([^}]*)\}/.exec(element)?.[1]?.trim()
    expect(planProp).toBeTruthy()
    // `org?.plan` is `undefined` for a pre-billing workspace, which the
    // component reads as "a visitor with no tier" — no current chip, nothing
    // recommended — while the rest of the page says Free.
    expect(planProp).not.toMatch(/org\?\.plan/)
    // Either the page's own defaulted local, or a default stated inline.
    expect(
      planProp === 'plan' || /\?\?\s*'free'/.test(planProp ?? ''),
    ).toBe(true)
  })
})
