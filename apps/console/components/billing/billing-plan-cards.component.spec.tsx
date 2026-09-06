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
 *
 * ⚠️ THE COUNT AND THE FOLD ARE ONE STATEMENT. `Compare all N plans` opens a
 * grid that draws N-1 cards, and the disclosure below names the one it is
 * holding — so the arithmetic closes and nothing is unaccounted for. It did
 * not always: the button counted `PLAN_ORDER` alone, said seven, and the grid
 * drew seven cards with Free in neither number, which is how a reader looking
 * at this page with the disclosure plainly in it came away reporting the Free
 * tier missing. Every case below that touches the count asserts the SUM,
 * never one half of it.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * Contacts is RELEASED and SETTLED for every case in this file.
 *
 * The audience rate is the one card row gated on a release flag rather than a
 * plan (AGL-1604/1658), and the unmocked context is `ready: false`, so without
 * this the cards would print no contacts rate at all and the rate assertions
 * below would be measuring the gate instead of the card. This file is about
 * what a card SAYS; the gate itself — billed, not-billed, and not-yet-settled,
 * driven through the real provider rather than a stubbed hook — is
 * `specs/plan-cards-contacts-overage-release-gate.spec.tsx`.
 *
 * ⚠️ Pinned ON deliberately. Pinning it off would make these assertions pass
 * against the unbilled wording and quietly stop guarding the billed one.
 */
jest.mock('../../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlag: () => ({
    released: true,
    visible: true,
    staffPreview: false,
    isStaff: false,
    ready: true,
  }),
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

/** The disclosure that folds the lower tiers away, if it is rendered. */
function disclosure(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Show \d+ lower plan|Hide lower plans/ })
}

/**
 * Reveal the folded lower tiers — the second deliberate act a downgrade costs.
 *
 * Named rather than inlined because it is the friction itself, not setup: the
 * grid arrives with them folded and the control below says how many it holds.
 */
function revealLowerTiers() {
  fireEvent.click(disclosure() as HTMLElement)
}

/** Whether a tier's card is in the document, by its heading text. */
function cardShown(label: string): boolean {
  return screen.queryAllByText(label).length > 0
}

/** Every plan card currently drawn, counted the way a reader counts them. */
function cardCount(): number {
  return document.querySelectorAll('.MuiCard-root').length
}

/** The `Card` element whose heading is `label`. */
function cardFor(label: string): HTMLElement {
  const card = screen
    .queryAllByText(label)
    .map((node) => node.closest('.MuiCard-root'))
    .find(Boolean)
  if (!card) throw new Error(`no card headed "${label}"`)
  return card as HTMLElement
}

/** The plan-selection control on a card, whatever it is labelled. */
function actionOn(label: string): HTMLElement {
  const button = within(cardFor(label)).queryAllByRole('button')[0]
  if (!button) throw new Error(`no control on the "${label}" card`)
  return button
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
    // so IN NUMBERS — hiding a downsell outright is a dark pattern, and a
    // fold that does not say what it holds is that dark pattern with a label.
    expect(disclosure()?.textContent).toMatch(/Show 2 lower plans/)
    revealLowerTiers()
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Starter')).toBe(true)
  })

  it('the way to every other plan is a real control, not a hint', () => {
    renderCards({ plan: 'pro' })
    // EIGHT, not seven: the seven self-serve tiers plus Enterprise, which the
    // grid draws from outside `PLAN_ORDER`. Seven was the count of the array
    // alone, and it happened to equal the number of CARDS an org on Pro saw,
    // so the total agreed with the page while Free was absent from both.
    const compare = screen.getByRole('button', { name: /Compare all 8 plans/ })
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
  /**
   * The allowance was on NO customer-facing pricing surface — not this card,
   * not the comparison grid, not the marketing pricing page. The console
   * showed it only on the current-plan chip, which says what you already have
   * and nothing about the tier you are weighing.
   */
  it('every card states its campaign email allowance', () => {
    renderCards({ plan: 'starter' })
    // Starter's own, and the two rungs above it.
    expect(screen.queryAllByText(/campaign emails\/mo/).length).toBe(3)
  })

  it('and says CAMPAIGN, because transactional mail is not rationed', () => {
    renderCards({ plan: 'starter' })
    // A row reading "emails/mo" would imply a plan caps invites, receipts and
    // password resets. It does not (AGL-1438).
    expect(screen.queryAllByText(/^[\d,]+ emails\/mo$/)).toHaveLength(0)
  })

  it('a metered limit carries its rate, not just its number', () => {
    renderCards({ plan: 'starter' })
    expect(screen.queryAllByText(/CRM records \(\+\$[\d.]+\/1k over\)/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/hosts? \(\+\$[\d.]+\/extra\)/).length).toBeGreaterThan(0)
    // Email past the band bills too, and mostly it is TRANSACTIONAL mail that
    // carries an org there — the cap refuses campaigns, so campaign volume
    // cannot pass it. A row printing only the number reads as a wall.
    expect(
      screen.queryAllByText(
        /campaign emails\/mo \(\+\$\d+\.\d{2}\/1k over\)/,
      ).length,
    ).toBeGreaterThan(0)
    // Cents, always: "$2.5" reads as a typo on a price.
    expect(
      screen.queryAllByText(/campaign emails\/mo \(\+\$\d+\.\d\/1k over\)/),
    ).toHaveLength(0)
  })

  it('and Enterprise, which has no meter, prints no rate', () => {
    renderCards({ plan: 'agency' })
    // Every band UNLIMITED and the price negotiated, so there is no
    // pass-through to quote — the row is the word, with nothing after it.
    expect(screen.queryAllByText('Unlimited CRM records').length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/Unlimited CRM records \(\+/)).toHaveLength(0)
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

/**
 * THE ENTERPRISE CARD IS A RUNG, NOT A DIFFERENT KIND OF OBJECT.
 *
 * In the comparison grid it used to render five highlight lines and nothing
 * else — no allowances, no feature sections — squeezed into a third of a
 * half-width card beside the agreement note, so "Unlimited sites, screens,
 * seats, and storage" wrapped every two or three words against a card that
 * was otherwise empty. The focused view had already been given the shared
 * body; the grid had not.
 *
 * A comparison grid is read ACROSS. A reader travels along one row — team
 * seats, contacts, campaign emails — and compares. The tier a reader most
 * needs to compare against was the one column that had no rows at all, and
 * the figure this change introduces (a contracted email band that is a NUMBER
 * rather than "Unlimited") would have had nowhere to appear.
 */
describe('the Enterprise card in the comparison grid', () => {
  /** The Enterprise `Card` element, scoped so neighbours cannot satisfy a query. */
  function enterpriseCard(): HTMLElement {
    const heading = screen
      .queryAllByText('Enterprise')
      .map((node) => node.closest('.MuiCard-root'))
      .find(Boolean)
    if (!heading) throw new Error('no Enterprise card in the grid')
    return heading as HTMLElement
  }

  function agencyCard(): HTMLElement {
    const heading = screen
      .queryAllByText('Agency')
      .map((node) => node.closest('.MuiCard-root'))
      .find(Boolean)
    if (!heading) throw new Error('no Agency card in the grid')
    return heading as HTMLElement
  }

  it('renders the same allowance rows as the tier beside it', () => {
    renderGrid({ plan: 'agency' })
    const enterprise = within(enterpriseCard())
    // One row per axis, in the order every other card prints them. Asserted
    // by LABEL rather than by value, because the values differ by design and
    // the shared structure is the property.
    expect(enterprise.getAllByText(/hosts?$/).length).toBeGreaterThan(0)
    expect(enterprise.getByText(/screens per host/)).toBeTruthy()
    expect(enterprise.getByText(/shared layouts/)).toBeTruthy()
    expect(enterprise.getByText(/saved templates per host/)).toBeTruthy()
    expect(enterprise.getAllByText(/ storage$/).length).toBeGreaterThan(0)
    expect(enterprise.getByText(/bandwidth$/)).toBeTruthy()
    expect(enterprise.getAllByText(/team seats?$/).length).toBeGreaterThan(0)
    expect(enterprise.getAllByText(/site collaborators?$/).length).toBeGreaterThan(0)
    expect(enterprise.getByText('Unlimited member accounts')).toBeTruthy()
    expect(enterprise.getByText(/CRM records$/)).toBeTruthy()
    expect(enterprise.getByText(/form submissions\/mo/)).toBeTruthy()
    expect(enterprise.getByText(/variables ·/)).toBeTruthy()
    expect(enterprise.getByText(/org datasets ×/)).toBeTruthy()
    expect(enterprise.getByText(/API requests\/mo/)).toBeTruthy()
    // The comparable tier row, and for a prospect the ONLY place the card
    // states the fee: the per-org highlight that used to sit above it said
    // very nearly the same sentence, and a card is not read twice.
    expect(enterprise.getAllByText(/platform fees/)).toHaveLength(1)
  })

  it('renders the sectioned feature checklist too', () => {
    renderGrid({ plan: 'agency' })
    const enterprise = within(enterpriseCard())
    for (const section of [
      'Build & publish',
      'Grow & automate',
      'Commerce',
      'Platform & enterprise',
    ]) {
      expect(enterprise.getByText(section)).toBeTruthy()
    }
    // The two Enterprise-only flags, ticked on the card that sells them.
    expect(enterprise.getByText('SAML / OIDC single sign-on')).toBeTruthy()
    expect(enterprise.getByText('Full white-label')).toBeTruthy()
  })

  it('BOTH WAYS: the two cards carry the SAME row labels', () => {
    // The comparison property itself, rather than a list of rows that happen
    // to be present. If either card grows or loses a row the other does not,
    // the grid stops being readable across and this goes red.
    renderGrid({ plan: 'agency' })
    const rowLabels = (card: HTMLElement) =>
      [...card.querySelectorAll('.MuiTypography-body2')]
        .map((node) => (node.textContent ?? '').trim())
        .filter(Boolean).length
    // Not equality of TEXT — the numbers differ — but of row COUNT, which is
    // what a reader's eye travels along.
    expect(rowLabels(enterpriseCard())).toBeGreaterThan(40)
    expect(rowLabels(enterpriseCard())).toBeGreaterThanOrEqual(
      rowLabels(agencyCard()),
    )
  })

  it('states the contracted campaign-email band as a NUMBER', () => {
    // The figure this whole change introduces, on the surface where a
    // customer meets it. A card that could not render allowances would have
    // hidden the one Enterprise band that is no longer unlimited.
    renderGrid({ plan: 'agency' })
    const enterprise = within(enterpriseCard())
    expect(enterprise.getByText('250,000 campaign emails/mo')).toBeTruthy()
    // …and no overage rate beside it: Enterprise publishes none, and quoting
    // one on a contract-priced tier would advertise a fee nobody agreed to.
    expect(enterprise.queryByText(/campaign emails\/mo \(\+/)).toBeNull()
    // Never the sentinel, in either of the shapes it takes when mishandled.
    expect(enterprise.queryByText(/Unlimited campaign emails/)).toBeNull()
    expect(enterprise.queryByText(/∞|Infinity|null campaign/)).toBeNull()
    // And Agency's own band beside it, so the row can be read across.
    expect(
      within(agencyCard()).getByText(
        '130,000 campaign emails/mo (+$1.80/1k over)',
      ),
    ).toBeTruthy()
  })

  it('keeps the highlights, exactly once, and keeps the agreement note', () => {
    // The highlights are NOT replaced by the allowance rows. They are the one
    // per-ORG answer on the card: `isEnterpriseOrg` is true for a comped
    // marker and a negotiated price as well as for the plan, and those two
    // grant nothing (AGL-2297). The allowance rows read the TIER, like every
    // other card, so they cannot express that distinction.
    renderGrid({ plan: 'pro', enterprise: true })
    const enterprise = within(enterpriseCard())
    expect(
      enterprise.getAllByText('SAML / OIDC single sign-on for your whole team'),
    ).toHaveLength(1)
    expect(enterprise.getByText('YOUR AGREEMENT')).toBeTruthy()
    expect(
      enterprise.getByText(/on an Enterprise agreement/),
    ).toBeTruthy()
    expect(
      enterprise.getByRole('button', { name: 'Contact us to change' }),
    ).toBeTruthy()
  })

  it('a PROSPECT is offered the tier, with a live route to sales', () => {
    renderGrid({ plan: 'agency' })
    const enterprise = within(enterpriseCard())
    const contact = enterprise.getByRole('link', { name: 'Contact sales' })
    expect(contact.getAttribute('href')).toBeTruthy()
    // The whole offer, ticked — in the tier rows and the checklist, which
    // state it in more detail and in the same shape as every card beside it.
    expect(enterprise.getByText('Unlimited hosts')).toBeTruthy()
    expect(enterprise.getByText('SAML / OIDC single sign-on')).toBeTruthy()
    expect(enterprise.getByText('Full white-label')).toBeTruthy()
    // And the one promise no entitlement row can carry, which is why it is
    // said here rather than left to the rows.
    expect(enterprise.getByText(/Priced, invoiced, and contracted/)).toBeTruthy()
    // No agreement, so no note about one.
    expect(enterprise.queryByText(/on an Enterprise agreement/)).toBeNull()
  })

  /**
   * THE CARD READS ONCE.
   *
   * `YOUR AGREEMENT` exists to answer a PER-ORG question — `isEnterpriseOrg`
   * is true for a comped marker and a negotiated price as well as for the
   * plan, and those two are display overlays on a lower base plan that grant
   * nothing (AGL-2297). A prospect has no agreement, so every row of it was
   * forced true, and four of the five then restated rows printed a few inches
   * lower: "Unlimited sites, screens, seats, and storage" over four Unlimited
   * quota rows, SSO and white-label over their own checklist ticks, and the
   * fee line over the fee row.
   *
   * Dropping the block for a prospect removes the repetition, not the offer —
   * the rows below are strictly more complete. The other direction of this
   * property is pinned by the two cases below: an org that HAS an agreement
   * still gets the block, still per-org, still with the caption.
   */
  it('does not say the same thing twice to a prospect', () => {
    renderGrid({ plan: 'agency' })
    const enterprise = within(enterpriseCard())
    // The heading is the tell: a per-org answer that has no org to be about.
    expect(enterprise.queryByText('WHAT AN AGREEMENT INCLUDES')).toBeNull()
    expect(enterprise.queryByText('YOUR AGREEMENT')).toBeNull()
    for (const restated of [
      'Unlimited sites, screens, seats, and storage',
      'SAML / OIDC single sign-on for your whole team',
      'Full white-label — your brand, not ours',
    ]) {
      expect(enterprise.queryByText(restated)).toBeNull()
    }
    // The rows those lines duplicated are each still on the card, exactly
    // once — this must read as de-duplication, never as a card losing rows.
    expect(enterprise.getAllByText(/^Unlimited (hosts|team seats)$/)).toHaveLength(2)
    expect(enterprise.getAllByText('Full white-label')).toHaveLength(1)
  })

  it('NEGATIVE CONTROL: no other tier changed shape', () => {
    // The Enterprise card is the only one that ever carried the highlights,
    // and de-duplicating it must not have reached the ladder beside it.
    renderGrid({ plan: 'agency' })
    const agency = within(agencyCard())
    expect(agency.getByText('Build & publish')).toBeTruthy()
    expect(agency.getByText('Full white-label')).toBeTruthy()
    expect(agency.queryByText('YOUR AGREEMENT')).toBeNull()
    expect(agency.queryByText(/Priced, invoiced, and contracted/)).toBeNull()
  })

  it('a comped org is told what its agreement does NOT include', () => {
    // The AGL-2297 guard, still live through the restructure: a comped org
    // reads as Enterprise and holds none of it.
    renderGrid({
      plan: 'pro',
      enterprise: true,
      org: { $id: 'org-comped', plan: 'pro', enterprise: true } as never,
    })
    const enterprise = within(enterpriseCard())
    expect(
      enterprise.getByText(/does not currently enable everything/),
    ).toBeTruthy()
  })
})

describe('lower tiers are collapsed by default (AGL-1864)', () => {
  it('the page opens with neither Free nor Starter on screen', () => {
    // The default, asserted where the reader meets it: the focused view,
    // before any control has been pressed.
    renderCards({ plan: 'pro' })
    expect(cardShown('Free')).toBe(false)
    expect(cardShown('Starter')).toBe(false)
    // The tiers ABOVE are the page's default content — the upgrade path leads.
    expect(cardShown('Business')).toBe(true)
    expect(cardShown('Scale')).toBe(true)
  })

  it('an org on Pro sees neither Free nor Starter until it asks', () => {
    // And the grid it opens is the same answer: `Compare all` is a request to
    // COMPARE, which the fold does not refuse — it names what it is holding
    // one line below.
    renderGrid({ plan: 'pro' })
    expect(cardShown('Free')).toBe(false)
    expect(cardShown('Starter')).toBe(false)
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
    revealLowerTiers()
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
    revealLowerTiers()
    // Expanded, the customer is looking at a downgrade — and end-of-cycle is
    // the one thing no card can say in its own corner (AGL-1862).
    expect(screen.getByRole('link', { name: tip })).toBeTruthy()
  })
})

/**
 * THE COUNT AND THE FOLD HAVE TO ADD UP (the owner's report, twice: "the
 * billing tiers are missing the free tier").
 *
 * `Compare all N plans` promised the count of `PLAN_ORDER` — seven — while the
 * grid drew seven CARDS: the six self-serve tiers at or above the reader's
 * own, plus Enterprise, which lives outside that array. The arithmetic came
 * out even, so a reader counted the cards, got the promised number, and had no
 * reason to look for an eighth. Free was in neither figure and nothing on the
 * page named it.
 *
 * The fold itself is not the defect and stays: reaching a downgrade costs a
 * second explicit act (AGL-1859 §2). What makes it a DISCLOSURE rather than an
 * omission is that the total is true and the control names the remainder — so
 * these cases assert the SUM, never one half of it.
 */
describe('every plan the grid promises is accounted for (AGL-1864)', () => {
  it('drawn cards plus folded plans equal the number the button named', () => {
    renderCards({ plan: 'pro' })
    const compare = screen.getByRole('button', { name: /Compare all \d+ plans/ })
    const promised = Number(
      /Compare all (\d+) plans/.exec(compare.textContent ?? '')?.[1],
    )
    // Eight: the seven self-serve tiers plus Enterprise, which the grid draws
    // from outside `PLAN_ORDER` (commit d4ec1aead).
    expect(promised).toBe(8)
    fireEvent.click(compare)
    const folded = Number(
      /Show (\d+) lower plans?/.exec(disclosure()?.textContent ?? '')?.[1] ?? 0,
    )
    // Neither half may be zero, or the sum below would hold for a page that
    // simply drew everything or named everything.
    expect(folded).toBeGreaterThan(0)
    expect(cardCount()).toBeGreaterThan(0)
    expect(cardCount() + folded).toBe(promised)
  })

  it('and the fold delivers exactly the plans it counted', () => {
    // Without this the sum above is an accounting of a number in a label. The
    // cheapest plan is NAMED because "Free is missing" is the report.
    renderGrid({ plan: 'pro' })
    const drawn = cardCount()
    const folded = Number(
      /Show (\d+) lower plans?/.exec(disclosure()?.textContent ?? '')?.[1] ?? 0,
    )
    revealLowerTiers()
    expect(cardCount()).toBe(drawn + folded)
    expect(cardShown('Free')).toBe(true)
    expect(cardShown('Starter')).toBe(true)
    expect(cardShown('Enterprise')).toBe(true)
  })

  /**
   * ⚠️ THE CONTROL THAT KEEPS THIS FROM BECOMING THE OPPOSITE DARK PATTERN.
   *
   * "Reachable" and "equally weighted" are different properties, and only the
   * first was ever asked for. A grid that showed Free with a contained primary
   * button beside the recommended upgrade would satisfy every assertion above
   * while presenting a downgrade as a peer of an upgrade — which AGL-1859 §2
   * is explicitly against.
   */
  it('CONTROL: the revealed tiers are de-emphasized, not promoted', () => {
    renderGrid({ plan: 'pro' })
    revealLowerTiers()
    const upgrade = actionOn('Business')
    // The loud controls are the steps UP, and every loud control on the grid
    // is one of them. Counted rather than sampled: this is what would fail if
    // a lower card were ever promoted to a contained button.
    expect(upgrade.className).toMatch(/MuiButton-contained/)
    const loud = screen
      .queryAllByRole('button')
      .filter((button) => /MuiButton-contained/.test(button.className))
    expect(loud.length).toBeGreaterThan(0)
    for (const button of loud) expect(button.textContent).toBe('Upgrade')
    // The quiet ones are text buttons in the inherited color, never primary.
    for (const label of ['Free', 'Starter']) {
      const action = actionOn(label)
      expect(action.className).toMatch(/MuiButton-text/)
      expect(action.className).not.toMatch(/MuiButton-contained/)
      expect(action.className).toMatch(/Inherit/)
      expect(action.className).not.toMatch(/MuiButton-textPrimary/)
    }
    // And nothing below the current plan is badged as a recommendation.
    expect(within(cardFor('Free')).queryByText('Recommended')).toBeNull()
    expect(within(cardFor('Starter')).queryByText('Recommended')).toBeNull()
    expect(screen.getAllByText('Recommended')).toHaveLength(1)
  })

  it('CONTROL: a downgrade never wears the upgrade word', () => {
    // The labelling half of the same asymmetry. Free is the exception and it
    // is not an exception in the permissive direction: for a prospect it is
    // an offer with nothing to click.
    renderGrid({ plan: 'pro' })
    revealLowerTiers()
    expect(within(cardFor('Starter')).getByRole('button').textContent).toBe(
      'Downgrade',
    )
    expect(
      within(cardFor('Starter')).queryByRole('button', { name: /Upgrade/ }),
    ).toBeNull()
    expect(
      within(cardFor('Free')).queryByRole('button', { name: /Upgrade/ }),
    ).toBeNull()
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
    // And once it is opened the words still never blur — the one thing a card
    // must never do is call a move down by the name of a move up.
    revealLowerTiers()
    expect(screen.getAllByRole('button', { name: 'Downgrade' }).length).toBeGreaterThan(0)
  })

  it('EVERY upgrade rung says what the next screen will ask for', () => {
    /*
     * The notice was drawn only under the emphasized rung, so the focused
     * view told a reader pressing "Upgrade to Pro" that a card and an address
     * would be collected, and told a reader pressing "Upgrade to Business"
     * nothing — though both open the same flow. The grid already gets this
     * right for every tier above the current one.
     */
    const notice = 'We will ask for a payment method as you go.'
    renderCards({ plan: 'starter', subscribeCollectsNotice: notice })

    // Starter's focused view is Starter (current), Pro (recommended) and
    // Business (the rung above that) — so both upgrade cards are on screen.
    expect(within(cardFor('Pro')).getByText(notice)).toBeTruthy()
    expect(within(cardFor('Business')).getByText(notice)).toBeTruthy()
  })

  it('CONTROL: the current plan is not an upgrade and says nothing of the sort', () => {
    // Without this, drawing the notice on every card would satisfy the case
    // above while telling somebody already on Starter that a payment method
    // is about to be collected.
    const notice = 'We will ask for a payment method as you go.'
    renderCards({ plan: 'starter', subscribeCollectsNotice: notice })
    expect(within(cardFor('Starter')).queryByText(notice)).toBeNull()
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
    revealLowerTiers()
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

  /**
   * The route to Free is the CANCEL FLOW, not a plan switch, and that is the
   * one thing the grid's new reach must not have changed: `PRICE_ENV` has no
   * `free` entry, so a `pro → free` switch reaches a server that answers
   * "Unknown target plan".
   */
  it('the Free card is a cancel, never a plan switch', () => {
    const { onSelect } = renderGrid({ plan: 'pro', subscriptionActive: true })
    expandLowerTiers()
    const free = within(cardFor('Free'))
    expect(free.queryByRole('button', { name: 'Downgrade' })).toBeNull()
    fireEvent.click(free.getByRole('button', { name: 'Cancel & move to Free' }))
    // The page routes 'free' at the cancel flow; the grid's job is to ask
    // for the right thing.
    expect(onSelect).toHaveBeenCalledWith('free')
    expect(onSelect).toHaveBeenCalledTimes(1)
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
 * A PAID PLAN WITH NOTHING BEHIND IT SAYS SO, AND ITS DEAD CONTROLS SAY WHY.
 *
 * A staff override (`/api/admin/org-override` writes `plan` directly), a
 * comped workspace and a seeded one all land in the same state: `plan` reads
 * Starter and there is no live subscription. Enterprise has had a card that
 * explains itself since AGL-1118; a staff-set LOWER tier had none, so a
 * Starter nobody bought was indistinguishable on screen from one somebody did
 * — and the only evidence a reader got was a Free card whose button was dead
 * and wearing the PROSPECT's "No credit card required".
 *
 * ## The server is why the control is dead, and it is not fixable here
 *
 * Every self-serve route down from such a plan is refused independently:
 * `plan` is Admin-SDK-only in `cloud/firebase-firestore.rules` for every
 * client including staff (AGL-1795); `/api/billing/subscription` answers 409
 * `No billing account yet` without a `stripeCustomerId`, 409 `No active
 * subscription` without one, and 400 `cancel_required` for `plan: 'free'`
 * specifically; and the only writers of a lower `org.plan` are two staff-gated
 * admin routes that require an audit reason code. So the card cannot be wired
 * to anything — wiring it to a 409 would be worse than the dead button. What
 * it can do is stop lying, which is what these cases pin.
 *
 * ⚠️ The copy states the OBSERVABLE fact — no subscription — and never the
 * inferred reason. An `incomplete` checkout has the same shape and is nobody's
 * override.
 */
describe('a plan the org did not buy explains itself', () => {
  const NOTICE = /no subscription behind it/i

  it('the view the page OPENS on carries the explanation', () => {
    // The focused view holds no rung below the current plan, so it holds none
    // of the dead controls — but it is where the reader starts, and they
    // should not have to press Compare to find out why the page behaves the
    // way it does.
    renderCards({ plan: 'starter', planWithoutSubscription: true })
    const said = screen.getByText(NOTICE)
    // Names the plan it is about, and the route that can actually change it.
    expect(said.textContent).toMatch(/Starter/)
    expect(said.textContent).toMatch(/Reach out/i)
    // On the card the sentence is about, not floating over the grid.
    expect(said.closest('.MuiCard-root')?.textContent).toMatch(/Current plan/)
  })

  it('and the grid says it once, on the same card', () => {
    renderGrid({ plan: 'starter', planWithoutSubscription: true })
    expect(screen.getAllByText(NOTICE)).toHaveLength(1)
    expect(
      screen.getByText(NOTICE).closest('.MuiCard-root')?.textContent,
    ).toMatch(/Your plan/)
  })

  it('the dead Free control stops wearing the prospect copy', () => {
    renderGrid({ plan: 'starter', planWithoutSubscription: true })
    revealLowerTiers()
    const free = actionOn('Free')
    // The bug, stated as an assertion: a customer on Starter was being told
    // no credit card was required.
    expect(screen.queryByText('No credit card required')).toBeNull()
    expect(free.textContent).toBe('Contact us to change')
    // Still disabled, because the server has no route to wire it to — and an
    // enabled button that 409s is worse than an honest dead one.
    expect((free as HTMLButtonElement).disabled).toBe(true)
  })

  it('every route DOWN says the same thing, not only Free', () => {
    // A comped Pro has Starter below it too, and `Downgrade` there reaches the
    // same three server refusals. One sentence, every card.
    renderGrid({ plan: 'pro', planWithoutSubscription: true })
    revealLowerTiers()
    for (const label of ['Free', 'Starter']) {
      const action = actionOn(label)
      expect(action.textContent).toBe('Contact us to change')
      expect((action as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull()
  })

  /**
   * ⚠️ THE NEGATIVE CONTROL THIS NEEDS. Every assertion above also passes on
   * a grid that disabled EVERYTHING — which would take away the one route
   * this org really does have. An org with no subscription can still buy one,
   * and `/api/billing/checkout` is the path that works for it.
   */
  it('NEGATIVE CONTROL: the way UP is untouched and still live', () => {
    const { onSelect } = renderGrid({ plan: 'starter', planWithoutSubscription: true })
    const upgrade = actionOn('Pro')
    expect(upgrade.textContent).toBe('Upgrade')
    expect((upgrade as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(upgrade)
    expect(onSelect).toHaveBeenCalledWith('pro')
  })

  it('NEGATIVE CONTROL: a real subscriber keeps the cancel route', () => {
    // The AGL-2156 route must not be replaced by the new copy for the org it
    // was built for.
    renderGrid({ plan: 'pro', subscriptionActive: true })
    revealLowerTiers()
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(actionOn('Free').textContent).toBe('Cancel & move to Free')
    expect(actionOn('Starter').textContent).toBe('Downgrade')
  })

  it('NEGATIVE CONTROL: a prospect is still offered the tier', () => {
    renderGrid({ plan: undefined, planWithoutSubscription: true })
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'No credit card required' }),
    ).toBeTruthy()
  })

  it('NEGATIVE CONTROL: an org on Free is told nothing — it has no plan to leave', () => {
    // `currentIndex > 0` is the guard. Free has nothing below it, so there is
    // no dead control to explain and no sentence to say.
    renderGrid({ plan: 'free', planWithoutSubscription: true })
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('NEGATIVE CONTROL: Enterprise keeps its own sentence and gains no second', () => {
    // An enterprise org has no rung it counts as current, so `currentIndex`
    // is -1 and this state cannot apply to it. Asserted in the FOCUSED view
    // as well as the grid: there the Enterprise card IS the current rung, so
    // a predicate that forgot the ladder position would print a second
    // sentence saying the same thing in different words.
    renderCards({ plan: 'pro', enterprise: true, planWithoutSubscription: true })
    expect(screen.queryByText(NOTICE)).toBeNull()
    cleanup()
    renderGrid({ plan: 'pro', enterprise: true, planWithoutSubscription: true })
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(screen.getByText(/on an Enterprise agreement/)).toBeTruthy()
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
  it('the Agency card says Unlimited CRM records, not the ∞ glyph', () => {
    renderGrid({ plan: 'agency' })
    expect(screen.queryAllByText(/∞/).length).toBe(0)
    expect(screen.queryAllByText(/Unlimited CRM records/).length).toBeGreaterThan(0)
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
    // Scale is 500,000 CRM records, never 500000.
    renderGrid({ plan: 'scale' })
    expect(screen.queryAllByText(/500,000 CRM records/).length).toBeGreaterThan(0)
  })
})
