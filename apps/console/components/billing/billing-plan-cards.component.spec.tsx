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
 * In-console tier visibility (AGL-1864, under AGL-1859 §1 — the * twice-given directive: "hide or de-emphasize the lower subscription tiers …
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

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BillingPlanCardsComponent } from './billing-plan-cards.component'

/**
 * `useBranding` (AGL-2319 gave this surface its brand-aware copy). Mocked
 * NARROWLY — the module's one default export and one named export — for the
 * reason `white-label-tab-title.spec.tsx` states: the real hook reaches
 * `use-secondary-nav`, which pulls in the console plugin gate, the Firebase
 * services provider and `next/navigation`, a module graph a card's unit test
 * has no business loading. The value is `PLATFORM_BRANDING_PROFILE` rebuilt
 * from its own two constants — literally what `resolveBrandingProfile` returns
 * for an org that is not white-label — and it is a module-level singleton, so
 * a consumer memoizing on the object cannot be made to loop (AGL-2365).
 */
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

jest.mock('../../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))


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

/**
 * Render, then open the full comparison grid.
 *
 * The page opens on the focused view — the current plan and the one step up —
 * so every assertion about the GRID has to ask for the grid first. That click
 * is the subject of its own describe below; everywhere else it is setup.
 *
 * Tolerant of the button's absence on purpose: an org with no plan, an
 * enterprise org and a deep-linked `?plan=` all open on the grid already, and
 * those cases must keep asserting exactly what they asserted before.
 */
function renderGrid(
  overrides: Partial<
    React.ComponentProps<typeof BillingPlanCardsComponent>
  > = {},
) {
  const result = renderCards(overrides)
  const compare = screen.queryByRole('button', {
    name: /Compare all/,
  })
  if (compare) fireEvent.click(compare)
  return result
}

/** The disclosure that reveals the collapsed tiers, if it is rendered. */
function disclosure(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Show \d+ lower plan|Hide lower plans/ })
}

/** Whether a tier's card is in the document, by its heading text. */
function cardShown(label: string): boolean {
  return screen.queryAllByText(label).length > 0
}

describe('the page opens on the decision, not the catalogue', () => {
  it('shows the current plan and the next two rungs, and nothing else', () => {
    renderCards({ plan: 'pro' })
    expect(cardShown('Pro')).toBe(true)
    expect(cardShown('Business')).toBe(true)
    expect(cardShown('Scale')).toBe(true)
    // Nothing below, and nothing further up. Seven cards at once is the
    // reference table; this is the decision being asked.
    expect(cardShown('Free')).toBe(false)
    expect(cardShown('Starter')).toBe(false)
    expect(cardShown('Agency')).toBe(false)
  })

  /**
   * ENTERPRISE IS THE RUNG ABOVE AGENCY, which is what lets one walk express
   * all three rules. Advanced reaches it going up; Agency reaches it with
   * nothing left above, so the walk back-fills one downward and the result is
   * the one-down-one-up the top of the ladder needs.
   */
  it('treats Enterprise as the rung above Agency', () => {
    renderCards({ plan: 'advanced' })
    expect(cardShown('Advanced')).toBe(true)
    expect(cardShown('Agency')).toBe(true)
    expect(cardShown('Enterprise')).toBe(true)
  })

  it('the top self-serve tier shows itself and the one step left', () => {
    renderCards({ plan: 'agency' })
    expect(cardShown('Agency')).toBe(true)
    expect(cardShown('Enterprise')).toBe(true)
    // A shorter row is the honest shape. Padding it with a downgrade would
    // make the cheapest thing on screen the only alternative on offer.
    expect(cardShown('Advanced')).toBe(false)
    expect(cardShown('Scale')).toBe(false)
  })

  it('an upgrade card lists what it ADDS, not what it also has', () => {
    renderCards({ plan: 'free' })
    // Screen versioning is off on Free and on from Pro up, so the Pro card
    // earns it. Starter does not have it, so Starter must not claim it.
    expect(screen.getByText('Everything in Free, plus')).toBeTruthy()
    expect(screen.queryAllByText('Screen versioning').length).toBeGreaterThan(0)
  })

  /**
   * The duplication that made the card unreadable: the quota rows are printed
   * directly above this list, so repeating them here said "25 screens per
   * host" twice in one card, six inches apart.
   */
  it('does not restate a quota the same card already printed', () => {
    renderCards({ plan: 'free' })
    // One occurrence per card that lists it as a limit — never a second copy
    // inside that card's own gains list.
    expect(screen.queryAllByText(/up from/)).toHaveLength(0)
    expect(screen.queryAllByText('25 screens per host')).toHaveLength(1)
  })

  /**
   * Measured against the CURRENT plan, the third card re-listed everything
   * the second had already granted, so the two upgrade cards looked nearly
   * identical and neither said what it alone was worth.
   */
  it('the third card does not repeat what the second already granted', () => {
    renderCards({ plan: 'starter' })
    // Starter already has Custom domain, so neither upgrade card may bill it
    // as its own gain — one occurrence, in Starter's own Included list.
    expect(screen.queryAllByText('Custom domain')).toHaveLength(1)
  })

  it('exactly one contained control, and it is the step up', () => {
    renderCards({ plan: 'pro' })
    const upgrade = screen.getByRole('button', { name: /Upgrade to Business/ })
    expect(upgrade.className).toMatch(/MuiButton-contained/)
    // ONE. Six identical contained Upgrade buttons is what made the previous
    // default read as a price list; the rung beyond the recommended one is
    // reachable but quieter.
    expect(
      screen
        .queryAllByRole('button')
        .filter((button) => /MuiButton-contained/.test(button.className)),
    ).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: /Upgrade to Scale/ }).className,
    ).toMatch(/MuiButton-outlined/)
  })

  it('the upgrade still selects the tier it names', () => {
    const { onSelect } = renderCards({ plan: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: /Upgrade to Business/ }))
    expect(onSelect).toHaveBeenCalledWith('business')
  })

  it('⛔ NOTHING IS REMOVED — one click reaches every tier', () => {
    renderCards({ plan: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    expect(cardShown('Business')).toBe(true)
    expect(cardShown('Scale')).toBe(true)
    expect(cardShown('Agency')).toBe(true)
    // The cheaper plans are one further click away, and the disclosure says
    // so — hiding a downsell outright is a dark pattern and loses it.
    expect(disclosure()).not.toBeNull()
  })

  it('the way to every other plan is a real control, not a hint', () => {
    renderCards({ plan: 'pro' })
    const compare = screen.getByRole('button', { name: /Compare all 7 plans/ })
    // Named, counted, and NOT de-emphasized. A quiet route to the cheaper end
    // is the dark-pattern version of collapsing it.
    expect(compare.className).toMatch(/MuiButton-outlined/)
  })

  it('and the way back is offered once expanded', () => {
    renderCards({ plan: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    fireEvent.click(
      screen.getByRole('button', { name: /Show just my plan and the next step/ }),
    )
    expect(cardShown('Agency')).toBe(false)
  })

  /**
   * The three cases with no focused view to open ON. Each opens on the grid,
   * which is exactly what it did before this existed — so narrowing the
   * default took no view away from anyone.
   */
  it('a prospect with no plan still gets the whole ladder', () => {
    renderCards({ plan: undefined })
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Agency')).toBe(true)
    expect(
      screen.queryByRole('button', { name: /Compare all/ }),
    ).toBeNull()
  })

  it('a deep link lands on the card it named (AGL-1117)', () => {
    renderCards({ plan: 'pro', highlight: 'agency' })
    expect(cardShown('Agency')).toBe(true)
  })

  /**
   * No rung is ever below the current one, so no card here can offer a
   * downgrade. The route down is the compare control, where it is named,
   * counted and collapsed — never a peer of an upgrade on the opening view.
   */
  it('the focused view never offers a downgrade', () => {
    for (const plan of ['free', 'pro', 'agency'] as const) {
      renderCards({ plan })
      expect(screen.queryAllByRole('button', { name: /Downgrade/ })).toHaveLength(
        0,
      )
      cleanup()
    }
  })

  /**
   * The cards are read ACROSS, so a section present on one and absent on
   * another breaks the comparison. Every card carries a heading over its tick
   * list; only the wording differs.
   */
  it('every card labels its tick list, and both upgrades label it alike', () => {
    renderCards({ plan: 'starter' })
    // The current card states what it has; each upgrade card names what it
    // BUILDS ON, so a short delta reads as cumulative rather than as a gap.
    expect(screen.queryAllByText('Included')).toHaveLength(1)
    expect(screen.getByText('Everything in Starter, plus')).toBeTruthy()
    expect(screen.getByText('Everything in Pro, plus')).toBeTruthy()
  })

  it('says what the current tier is MISSING, not only what it has', () => {
    renderCards({ plan: 'free' })
    expect(screen.getByText('Not in your plan')).toBeTruthy()
    // A feature Free lacks and a higher tier sells.
    expect(screen.queryAllByText('Custom domain').length).toBeGreaterThan(0)
  })

  it('never lists a loss nobody sells above you', () => {
    renderCards({ plan: 'agency' })
    // The top self-serve tier has nothing above it to be missing, so the
    // section is absent rather than empty or invented.
    expect(screen.queryByText('Not in your plan')).toBeNull()
  })

  /**
   * The cards are read across, so a card that omits a section its neighbour
   * fills breaks the comparison. Enterprise states the same limits as every
   * other tier; the answer is just "Unlimited" all the way down.
   */
  /**
   * Six of the seven plans meter overage, so most of these numbers are where
   * BILLING starts, not where the product stops. A condensed card that drops
   * the rate turns a meter into a wall, and a customer choosing on that
   * reading is choosing on the wrong fact.
   */
  it('a metered limit carries its rate, not just its number', () => {
    renderCards({ plan: 'starter' })
    expect(screen.queryAllByText(/contacts \(\+\$[\d.]+\/1k over\)/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/hosts? \(\+\$[\d.]+\/extra\)/).length).toBeGreaterThan(0)
  })

  it('and Enterprise, which has no meter, prints no rate', () => {
    renderCards({ plan: 'agency' })
    // Every band UNLIMITED and the price negotiated, so there is no
    // pass-through to quote — the row is the word, with nothing after it.
    expect(screen.queryAllByText('Unlimited contacts').length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/Unlimited contacts \(\+/)).toHaveLength(0)
  })

  it('the Enterprise card states its limits like every other card', () => {
    renderCards({ plan: 'agency' })
    // Agency's own figures — with its per-unit rate, since Agency meters —
    // and Enterprise's answer beside them, which carries no rate.
    expect(screen.queryAllByText(/^100 hosts/)).toHaveLength(1)
    expect(screen.queryAllByText('Unlimited hosts')).toHaveLength(1)
    // Never the raw sentinel (AGL-2482).
    expect(screen.queryAllByText(/∞|Infinity/)).toHaveLength(0)
  })

  it('and does not print its highlights twice', () => {
    renderCards({ plan: 'agency' })
    // The highlights are the tick list. Substituting them into the limits
    // slot as well printed the same five lines twice in one card.
    expect(
      screen.queryAllByText('SAML / OIDC single sign-on for your whole team'),
    ).toHaveLength(1)
  })

  it('an enterprise org sees its own plan and nothing else', () => {
    renderCards({ plan: 'pro', enterprise: true })
    expect(cardShown('Enterprise')).toBe(true)
    // Every rung below is a downgrade it cannot self-serve, and there is no
    // step up to offer, so the page opens on no decision at all.
    expect(cardShown('Pro')).toBe(false)
    expect(cardShown('Agency')).toBe(false)
    expect(
      screen.queryAllByRole('button', { name: /^Upgrade to/ }),
    ).toHaveLength(0)
    // The ladder is still reachable — it just is not what it opens on.
    expect(screen.getByRole('button', { name: /Compare all/ })).toBeTruthy()
  })
})

describe('lower tiers are collapsed by default (AGL-1864)', () => {
  it('an org on Pro sees neither Free nor Starter until it asks', () => {
    renderGrid({ plan: 'pro' })
    expect(cardShown('Free')).toBe(false)
    expect(cardShown('Starter')).toBe(false)
    // The tiers ABOVE are the page's default content — the upgrade path leads.
    expect(cardShown('Business')).toBe(true)
    expect(cardShown('Scale')).toBe(true)
  })

  it('the disclosure counts what it is hiding, and one click reveals them', () => {
    renderGrid({ plan: 'pro' })
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
    const { onSelect } = renderGrid({ plan: 'pro' })
    fireEvent.click(disclosure() as HTMLElement)
    const downgrades = screen.getAllByRole('button', { name: 'Downgrade' })
    expect(downgrades.length).toBeGreaterThan(0)
    fireEvent.click(downgrades[0])
    expect(onSelect).toHaveBeenCalled()
  })

  it('the disclosure explains the asymmetry only once the tiers are on screen', () => {
    renderGrid({ plan: 'pro' })
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
    renderGrid({ plan: 'pro' })
    expect(screen.getAllByText('Recommended').length).toBe(1)
    // Business is the tier directly above Pro.
    expect(cardShown('Business')).toBe(true)
  })

  it('upgrades say Upgrade and downgrades say Downgrade — never the same control', () => {
    renderGrid({ plan: 'pro' })
    expect(screen.getAllByRole('button', { name: 'Upgrade' }).length).toBeGreaterThan(0)
    // Nothing offers a downgrade until the disclosure is opened: a downgrade
    // is never a one-click peer of Upgrade on this card grid.
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull()
  })

  it('the TOP self-serve tier recommends nothing — there is nothing above it', () => {
    renderGrid({ plan: 'agency' })
    expect(screen.queryByText('Recommended')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})

describe('collapsing only ever applies to an org with a tier to be below (AGL-1864)', () => {
  it('a visitor with NO plan yet sees the whole ladder', () => {
    renderGrid({ plan: undefined })
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Agency')).toBe(true)
    // Nothing is a downgrade for them, so there is nothing to disclose.
    expect(disclosure()).toBeNull()
  })

  it('an org on Free has nothing below it and gets no disclosure', () => {
    // `free` renders the entire ladder: an org on Free has no lower tier
    // to collapse, so every card including Agency is on screen.
    renderGrid({ plan: 'free' })
    expect(cardShown('Starter')).toBe(true)
    expect(disclosure()).toBeNull()
  })

  it('an ENTERPRISE org sits above the ladder — no collapse, no recommendation', () => {
    // Its stored `plan` may still be the base tier it was provisioned on
    // (AGL-1110), which must not collapse the grid or badge a self-serve card.
    renderGrid({ plan: 'pro', enterprise: true })
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
    renderGrid({ plan: 'pro', highlight: 'starter' })
    expect(cardShown('Starter')).toBe(true)
    expect(disclosure()?.textContent).toMatch(/Hide lower plans/)
  })

  it('a deep link EXPANDS a lower tier but never RECOMMENDS one (AGL-2142)', () => {
    // The card used to carry the "Recommended" chip and a primary border while
    // simultaneously being dimmed and labelled Downgrade — recommending and
    // de-emphasizing itself at once. AGL-1859 §2: a downgrade is never the
    // emphasized control.
    renderGrid({ plan: 'pro', highlight: 'starter' })
    const chips = screen.getAllByText('Recommended')
    expect(chips.length).toBe(1)
    // The recommendation falls back to the next tier UP, not the deep link.
    expect(chips[0].closest('.MuiCard-root')?.textContent).toMatch(/Business/)
    expect(chips[0].closest('.MuiCard-root')?.textContent).not.toMatch(/Starter/)
  })

  it('a deep link to a HIGHER tier leaves the lower ones collapsed', () => {
    renderGrid({ plan: 'pro', highlight: 'scale' })
    expect(cardShown('Free')).toBe(false)
    expect(disclosure()?.textContent).toMatch(/Show 2 lower plans/)
  })

  it('a deep link to the plan the org is ALREADY on recommends nothing new', () => {
    renderGrid({ plan: 'pro', highlight: 'pro' })
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
    const { onSelect } = renderGrid({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    const button = screen.getByRole('button', { name: 'Cancel & move to Free' })
    // jest-dom is not set up in this project — assert the property directly.
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    // The page routes 'free' at the cancel flow; the grid's job is to ask.
    expect(onSelect).toHaveBeenCalledWith('free')
  })

  it('states what happens and when, beside the control', () => {
    renderGrid({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    expect(
      screen.getByText(/runs to the end of the period you have already paid for/i),
    ).toBeTruthy()
    expect(screen.getByText(/Nothing is deleted/i)).toBeTruthy()
  })

  it('never shows a subscriber the prospect copy', () => {
    renderGrid({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    expect(screen.queryByText('No credit card required')).toBeNull()
  })

  it('NEGATIVE CONTROL: a PROSPECT still sees the offer, still disabled', () => {
    // There is nothing to cancel, so there is nothing to click — and "No
    // credit card required" is the true sentence for them.
    renderGrid({ plan: undefined, subscriptionActive: false })
    const button = screen.getByRole('button', { name: 'No credit card required' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.queryByRole('button', { name: 'Cancel & move to Free' }),
    ).toBeNull()
  })

  it('NEGATIVE CONTROL: an ENTERPRISE org gets no self-serve route to Free', () => {
    // An enterprise agreement is changed by talking to us (AGL-1118), which
    // is true of leaving it as much as of changing tier inside it.
    renderGrid({ plan: 'pro', enterprise: true, subscriptionActive: true })
    expect(
      screen.queryByRole('button', { name: 'Cancel & move to Free' }),
    ).toBeNull()
  })

  it('NEGATIVE CONTROL: an org already ON Free is not offered a cancel', () => {
    renderGrid({ plan: 'free', subscriptionActive: true })
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
    // `free` renders the entire ladder: an org on Free has no lower tier
    // to collapse, so every card including Agency is on screen.
    renderGrid({ plan: 'free' })
    expect(screen.getAllByText('Current plan').length).toBe(1)
    expect(screen.getAllByText('Recommended').length).toBe(1)
  })

  it('undefined recommends NOTHING — which is why the page must default it', () => {
    renderGrid({ plan: undefined })
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
        // The plan grid lives on the Plan section since AGL-2501.
        '(sections)',
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

describe('an uncapped quota never leaks its sentinel (AGL-2482)', () => {
  /**
   * Observed on the live Agency card: ∞ contacts (+$0.2/1k over).
   *
   * `UNLIMITED` is `Number.POSITIVE_INFINITY`, and the card interpolated it
   * raw. `Infinity.toLocaleString()` is `'∞'` and `` `${Infinity}` `` is
   * `'Infinity'` — so a single card could print BOTH spellings while every
   * row that went through `quotaLabel` said "Unlimited".
   *
   * Unlike AGL-2482 proper this is NOT the wire bug: these cards read the
   * `PLAN_ENTITLEMENTS` constant directly, so the sentinel arrives intact and
   * only the formatting was wrong. Same defect one surface over, which is why
   * it survived that sweep.
   */
  it('the Agency card says Unlimited contacts, not the ∞ glyph', () => {
    renderGrid({ plan: 'agency' })
    expect(screen.queryAllByText(/∞/).length).toBe(0)
    expect(screen.queryAllByText(/Unlimited contacts/).length).toBeGreaterThan(0)
  })

  it('no card anywhere prints ∞ or Infinity, on any plan', () => {
    // The class guard. Rendering every tier is the point: a future plan that
    // turns one more quota uncapped fails here rather than on a customer's
    // screen. `Infinity` is matched as a whole word so a legitimate "1 GB"
    // or a component name can never trip it.
    // `free` renders the entire ladder: an org on Free has no lower tier
    // to collapse, so every card including Agency is on screen.
    renderGrid({ plan: 'free' })
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('∞')
    expect(text).not.toMatch(/\bInfinity\b/)
    // The premise: something on screen really is uncapped, so this is not
    // passing merely because every quota happens to be finite.
    expect(text).toContain('Unlimited')
  })

  it('a finite quota still reads exactly as it did, grouped', () => {
    // The counter-case. A "fix" that formatted every quota as Unlimited would
    // be the same defect pointed the other way, and grouping must survive:
    // Scale is 500,000 contacts, never 500000.
    renderGrid({ plan: 'scale' })
    expect(screen.queryAllByText(/500,000 contacts/).length).toBeGreaterThan(0)
  })
})
