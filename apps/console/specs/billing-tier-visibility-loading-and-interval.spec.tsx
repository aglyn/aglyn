/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The two INPUTS to the tier grid, driven on the real page (AGL-1864).
 *
 * `billing-plan-cards.component.spec.tsx` pins what the grid does with a plan
 * and an interval; `billing-downgrade-confirm.spec.tsx` pins what a click on
 * it posts. Neither says anything about where those two props come from, and
 * both hand the page a fully-loaded, annual-blind organization — so the whole
 * of AGL-1859 §1 rested on two values this file is the first to assert.
 *
 * ## 1. The plan must not be GUESSED while the org doc is loading
 *
 * `plan` is `org?.plan ?? 'free'` and `resolveOrgEntitlements(undefined)` is
 * the free row, so every value this page derives answers "Free" before the doc
 * arrives. That is the repo's `loading_default_answers_a_question` shape, and
 * on THIS surface it is a tier-visibility defect specifically: a paying Pro
 * workspace would render, for the length of the load, a grid with the Free
 * card badged **Current plan**, every paid tier counted as an **Upgrade**, and
 * the lower-tier collapse — the whole point of AGL-1864 — disengaged, because
 * a Free org has nothing beneath it to fold away.
 *
 * The page holds on `ready` instead (AGL-1422), and that hold had no test. It
 * is one deleted ternary from being live, and the deletion reddens nothing.
 *
 * ⚠️ The negative control this needs, and the lesson AGL-2233 wrote down: a
 * test asserting only "the grid is absent while loading" ALSO passes when the
 * grid never renders at all. Every hold assertion below is paired with the
 * same page going on to render the right thing once `ready` flips.
 *
 * ## 2. The billing INTERVAL a visitor was quoted must survive the jump
 *
 * The console half of AGL-1989. The marketing half is that the /pricing scale
 * strip drops `interval` from its CTAs; the console half is what this page
 * does with the parameter when it DOES arrive — including when it arrives
 * malformed. `interval` is not decoration: it re-quotes every card and it is
 * the value `handleUpgrade` posts, so getting it wrong moves a customer
 * between two real billing intervals.
 *
 * No price is asserted as a literal anywhere below. Every figure is read back
 * out of `PLAN_PRICING`, so this file pins WHICH published price is shown and
 * can never be the thing that changes one.
 */

import {
  PLAN_LABELS,
  PLAN_PRICING,
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * The org doc the page is handed, whether its read has settled, and the query
 * string the visitor arrived with.
 *
 * `mock`-prefixed because jest's module factories may not close over anything
 * else — the three below are read inside `jest.mock` factories, which hoist
 * above these declarations.
 */
let mockOrg: Record<string, any> | undefined
let mockReady: boolean
let mockSearch: string

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  readGaClientId: async () => null,
  trackEvent: () => undefined,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDocsFromServer: async () => ({ docs: [], size: 0 }),
}))

/**
 * `useBranding`, mocked narrowly for the reason `white-label-tab-title.spec`
 * gives: the real hook drags in the console plugin gate and the Firebase
 * services provider. The value is the platform profile rebuilt from its own
 * constants, and it is a module-level singleton so a memoizing consumer
 * cannot be made to loop (AGL-2365).
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
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

// The REAL `useSearchParams` shape — a URLSearchParams — because the page
// hands it straight to `parseOnboardingPlanIntent`, and this file's whole
// second half is about what that parser makes of it.
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: mockOrg?.$id, ready: mockReady }),
}))
jest.mock('../hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: { editBilling: true },
    can: () => true,
    loaded: true,
  }),
}))
jest.mock('../hooks/use-org-hosts', () => ({ useOrgHosts: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false }),
}))
jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

/**
 * Chrome and sibling cards. The PLAN CARDS stay real — they are the subject —
 * and every sibling stubbed here reads its own endpoint and would render a
 * "couldn't load" Alert against the catch-all fetch below.
 */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/billing/billing-usage.component', () => nullCard)
jest.mock(
  '../components/billing/billing-metered-estimate.component',
  () => nullCard,
)
jest.mock('../components/billing/billing-addons-card.component', () => ({
  __esModule: true,
  default: () => null,
  ADDON_LABELS: {},
}))
jest.mock(
  '../components/billing/billing-storage-overage-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-usage-budget-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-register-allocations-card.component',
  () => nullCard,
)
jest.mock('../components/billing/retention-funnel.dialog', () => ({
  __esModule: true,
  RetentionFunnelDialog: () => null,
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'

/** A paying Pro org on ANNUAL billing — the shape both halves need. */
const ANNUAL_PRO = {
  $id: 'org-1',
  plan: 'pro' as const,
  subscription: { status: 'active', interval: 'year' },
}
/** The same org billed monthly, for the direction-distinguishing controls. */
const MONTHLY_PRO = {
  $id: 'org-1',
  plan: 'pro' as const,
  subscription: { status: 'active', interval: 'month' },
}

beforeEach(() => {
  mockOrg = ANNUAL_PRO
  mockReady = true
  mockSearch = ''
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ invoices: [] }),
  })) as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** The plan grid's own container — absent entirely while the page holds. */
const grid = () => document.querySelector('#plans')

/** The card whose heading is `label`, or null when the grid is not rendered. */
function cardFor(label: string): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll('.MuiCard-root h6'))
  const heading = headings.find((node) => node.textContent === label)
  return (heading?.closest('.MuiCard-root') as HTMLElement) ?? null
}

/** Which tier currently wears the green `Current plan` chip. */
function currentPlanLabel(): string | null {
  const found = Object.values(PLAN_LABELS).find((label) => {
    const card = cardFor(label)
    return Boolean(card && within(card).queryByText('Current plan'))
  })
  return found ?? null
}

describe('the grid holds until the plan is KNOWN (AGL-1864 · AGL-1422)', () => {
  it('renders no tier grid at all while the org read is in flight', () => {
    mockReady = false
    render(<BillingPage />)
    expect(grid()).toBeNull()
  })

  it('never badges a paying workspace as being on Free mid-load', () => {
    mockReady = false
    // The doc is still on the wire — this is exactly the state in which
    // `org?.plan ?? 'free'` answers "Free" for a Pro customer.
    mockOrg = undefined
    render(<BillingPage />)
    expect(currentPlanLabel()).toBeNull()
    expect(screen.queryByText('Current plan')).toBeNull()
  })

  it('offers no upgrade it cannot yet know is an upgrade', () => {
    mockReady = false
    mockOrg = undefined
    render(<BillingPage />)
    expect(screen.queryAllByRole('button', { name: 'Upgrade' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Downgrade' })).toHaveLength(0)
  })

  it('says it is working rather than showing an empty page', () => {
    mockReady = false
    mockOrg = undefined
    render(<BillingPage />)
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('NEGATIVE CONTROL: once ready, the grid is there and Pro is current', () => {
    render(<BillingPage />)
    expect(grid()).not.toBeNull()
    expect(currentPlanLabel()).toBe(PLAN_LABELS.pro)
  })

  it('NEGATIVE CONTROL: once ready, the focused view is engaged', () => {
    render(<BillingPage />)
    // The page opens on the decision, not the catalogue: the current plan and
    // the one step up, with everything else behind a named control. Starter
    // is neither of those, so its absence here means the focused view
    // rendered — not that the hold above is still swallowing the page.
    expect(cardFor(PLAN_LABELS.starter)).toBeNull()
    expect(
      screen.getByRole('button', { name: /Compare all/ }),
    ).toBeTruthy()
  })

  it('NEGATIVE CONTROL: and the collapse is still there behind it', () => {
    render(<BillingPage />)
    // One click further in, the AGL-1864 behaviour the hold protects is
    // unchanged in the direction that matters — the lower tiers are folded,
    // never deleted, and the fold is a state the reader can be in. What
    // `Compare all` does NOT do any more is put them there uninvited, so the
    // control now reads "Hide lower plans" and folding is one press away.
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    const fold = screen.getByRole('button', { name: /Hide lower plans/ })
    expect(cardFor(PLAN_LABELS.free)).not.toBeNull()
    fireEvent.click(fold)
    expect(cardFor(PLAN_LABELS.free)).toBeNull()
    expect(
      screen.getByRole('button', { name: /Show \d+ lower plans?/ }),
    ).toBeTruthy()
  })

  it('counts the plans it draws, and draws every one it counted', () => {
    /*
     * The count has to include Enterprise, which the grid renders outside
     * `PLAN_ORDER`. Counting only that array said seven while the grid drew
     * seven cards — six self-serve tiers plus Enterprise — so the arithmetic
     * came out even and Free, folded behind the lower-tier disclosure, was
     * invisible in it: a reader counted the cards, got the promised number,
     * and had no reason to look for an eighth.
     *
     * Fixing the total exposed the other half. A button that names eight and
     * hands over six is an omission whatever the second control says, and the
     * gap it left was exactly the two cheapest plans — reported twice, from a
     * screenshot with the disclosure plainly in it, as the Free tier being
     * missing. So the promise and the delivery are asserted against each
     * other here rather than reconciled through a fold.
     */
    render(<BillingPage />)
    const compare = screen.getByRole('button', { name: /Compare all/ })
    expect(compare.textContent).toBe('Compare all 8 plans')

    fireEvent.click(compare)
    const drawn = Object.values(PLAN_LABELS).filter((label) =>
      Boolean(cardFor(label)),
    ).length
    // Every plan the button promised is on screen. Nothing is owed to a
    // second control, and nothing is unaccounted for.
    expect(drawn).toBe(8)
    // Named as well as counted, because "eight cards" and "the cheap end is
    // there" are not the same assertion.
    expect(cardFor(PLAN_LABELS.free)).not.toBeNull()
    expect(cardFor(PLAN_LABELS.starter)).not.toBeNull()
    expect(cardFor(PLAN_LABELS.enterprise)).not.toBeNull()
  })

  it('and the ones it just revealed are quiet, not promoted', () => {
    /*
     * The counter-property. "Visible" and "equally weighted" are different
     * things, and a grid that answered the report by giving Free a contained
     * primary button beside the recommended upgrade would satisfy the case
     * above while presenting a downgrade as a peer of an upgrade — the dark
     * pattern pointed the other way, and the thing AGL-1859 §2 forbids.
     */
    render(<BillingPage />)
    fireEvent.click(screen.getByRole('button', { name: /Compare all/ }))
    const free = cardFor(PLAN_LABELS.free) as HTMLElement
    const business = cardFor(PLAN_LABELS.business) as HTMLElement
    expect(
      within(business).getByRole('button').className,
    ).toMatch(/MuiButton-contained/)
    expect(within(free).getByRole('button').className).toMatch(/MuiButton-text/)
    expect(
      within(free).getByRole('button').className,
    ).not.toMatch(/MuiButton-contained/)
    // The recommendation still points UP the ladder, and only there.
    expect(within(free).queryByText('Recommended')).toBeNull()
    expect(within(business).getByText('Recommended')).toBeTruthy()
  })
})

describe('the quoted interval survives the jump (AGL-1864 · AGL-1989)', () => {
  /**
   * The billing-interval switch, found through its own `<label>`.
   *
   * Not `getByRole('checkbox', { name })`: MUI's `FormControlLabel` puts the
   * text in a sibling span of the input inside the label, and the accessible
   * name that comes out of that arrangement is not the label's text — the
   * query finds nothing. The label is what the customer reads, so it is also
   * the right thing to identify the control by.
   */
  function toggleLabel(): HTMLLabelElement {
    const label = Array.from(document.querySelectorAll('label')).find((node) =>
      /billing/i.test(node.textContent ?? ''),
    )
    if (!label) throw new Error('no billing-interval toggle on the page')
    return label as HTMLLabelElement
  }

  /** The annual toggle's own state, read off the real control. */
  const annualToggle = () =>
    toggleLabel().querySelector('input[type="checkbox"]') as HTMLInputElement

  /**
   * The headline dollar figure on a card, as rendered.
   *
   * Read back rather than matched, so a card showing the WRONG one of the two
   * published prices fails with a diff naming both. The card renders it as
   * `<Typography variant="h4" component="span">`, so it carries no heading
   * role to query by.
   */
  const headline = (label: string) =>
    (cardFor(label) as HTMLElement).querySelector('.MuiTypography-h4')
      ?.textContent

  it('a stated annual interval moves the toggle, even on a monthly org', async () => {
    mockOrg = MONTHLY_PRO
    mockSearch = 'plan=scale&interval=year'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(true))
    // What the customer actually reads, not just the input's state.
    expect(toggleLabel().textContent).toContain('Annual billing')
    // The number they were sold on /pricing is the number here — read back
    // out of the price list, never asserted as a literal.
    expect(headline(PLAN_LABELS.scale)).toBe(
      `$${PLAN_PRICING.scale.basePriceAnnualMonthlyUsd}`,
    )
  })

  it('a stated monthly interval outranks the subscription too', async () => {
    mockOrg = ANNUAL_PRO
    mockSearch = 'plan=scale&interval=month'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(false))
  })

  it('a CTA that states no interval leaves an annual org annual', async () => {
    // The /pricing scale strip quotes monthly and annual side by side and
    // commits to neither (AGL-1989). The parser's safe 'month' default is not
    // a statement, and honouring it here would re-quote every card at the
    // monthly price for a customer already billed yearly.
    mockOrg = ANNUAL_PRO
    mockSearch = 'plan=scale'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(true))
    expect(headline(PLAN_LABELS.scale)).toBe(
      `$${PLAN_PRICING.scale.basePriceAnnualMonthlyUsd}`,
    )
  })

  it('a MALFORMED interval is not a stated one — the org keeps its own', async () => {
    // THE BUG THIS FILE WAS WRITTEN FOR. The page re-derived "did the link
    // state an interval" as `Boolean(searchParams.get('interval'))`, which is
    // "the param was present", not "the param said something we understood".
    // `?interval=yearly` is junk the parser refuses: it falls back to the safe
    // 'month' and reports `intervalStated: false` precisely so a reader can
    // tell the two apart. The old expression saw a non-empty string, believed
    // it, and flipped an ANNUAL customer's page to monthly — off a link whose
    // author was trying to say "year".
    mockOrg = ANNUAL_PRO
    mockSearch = 'plan=scale&interval=yearly'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(true))
  })

  it('`monthly` is junk as well — a broken link states nothing either way', async () => {
    mockOrg = ANNUAL_PRO
    mockSearch = 'plan=scale&interval=monthly'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(true))
  })

  it('a custom-priced plan carries no interval to honour', async () => {
    // `?plan=enterprise` parses to `interval: 'month', intervalStated: false`
    // because Enterprise is quoted, not bought — so the word "year" in the
    // URL is not a statement about a self-serve interval, and the old
    // expression flipped an annual org to monthly on the strength of it.
    mockOrg = ANNUAL_PRO
    mockSearch = 'plan=enterprise&interval=year'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(true))
  })

  it('NEGATIVE CONTROL: a monthly org with no stated interval stays monthly', async () => {
    // Without this the assertions above are satisfied by a toggle that is
    // simply stuck on annual.
    mockOrg = MONTHLY_PRO
    mockSearch = 'plan=scale'
    render(<BillingPage />)
    await waitFor(() => expect(annualToggle().checked).toBe(false))
    expect(headline(PLAN_LABELS.scale)).toBe(
      `$${PLAN_PRICING.scale.basePriceMonthlyUsd}`,
    )
  })

  it('NEGATIVE CONTROL: the two headline prices are actually different', () => {
    // And without THIS, every price assertion above would hold even if the
    // interval never reached the cards.
    expect(PLAN_PRICING.scale.basePriceAnnualMonthlyUsd).not.toBe(
      PLAN_PRICING.scale.basePriceMonthlyUsd,
    )
  })
})
