/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * THE ASSIST BAND HAS AN ODOMETER, NOT JUST A CEILING.
 *
 * Assist is REFUSED at its band — it is discretionary spend, so the plan is
 * allowed to say no — which makes this meter the only thing standing between
 * a customer and learning their limit by being turned down mid-build. That is
 * the state `quota-surface-coverage.spec.ts` exists to refuse, one level up.
 *
 * That guard reads the component's text for the entitlement key and cannot
 * strip comments, so a meter reduced to `limit={0}` still satisfies it as long
 * as the key survives in prose nearby. This file closes that gap for this one
 * key by rendering the component and reading the row.
 *
 * ## Credits, and no dollars anywhere near the page
 *
 * The stored figure is `estCostUsd` — our provider bill at the serving model's
 * list rates. It reaches the browser only as credits, through
 * `/api/billing/assist-credits`, and the component asks that route rather than
 * Firestore because `orgs/{id}/assistUsage` is default-deny to every client.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
}))

// The AI add-on as its plugin declares it (AGL-2939): the fold the meter
// reads is what the declaration says.
import '../declarations'
import AiCreditsCard from './ai-credits-card.component'

/** Business: 7,500 credits included. */
const BUSINESS = { $id: 'org-1', plan: 'business' } as any
/** Starter: 750 credits included since AGL-3203, sold past at $3.00/1k. */
const STARTER = { $id: 'org-1', plan: 'starter' } as any
/**
 * An org that sells NO band. Since AGL-3203 no plan row bands at zero, so
 * the only way here is a per-org `assistCreditsPerMonth` override — which
 * resolves exactly as bare Starter used to, and is what the "no meter"
 * cases below are about.
 */
const NO_BAND = {
  $id: 'org-1',
  plan: 'starter',
  entitlements: { assistCreditsPerMonth: 0 },
} as any

/** Named for the ONE pool (AGL-2899): the add-on widens it, never a second meter. */
const METER = 'AI credits (this month)'
/** Pro without the add-on: 2,750 credits, and the add-on on offer. */
const PRO = { $id: 'org-1', plan: 'pro' } as any
/** Pro with the add-on: 2,750 + 9,000 in one band. */
const PRO_WITH_AI = {
  $id: 'org-1',
  plan: 'pro',
  seatAddons: { aiAddon: 1 },
} as any
/** Starter with the add-on: its own 750, plus 4,000 from the add-on. */
const STARTER_WITH_AI = {
  $id: 'org-1',
  plan: 'starter',
  seatAddons: { aiAddon: 1 },
} as any

/** What `/api/ai/billing/credits` answers, or `null` for no band. */
let mockCredits: { used: number; limit: number | null; remaining: number | null } | null

beforeEach(() => {
  mockCredits = { used: 4_500, limit: 7_500, remaining: 3_000 }
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (url.startsWith('/api/ai/billing/credits')) {
      return { ok: true, json: async () => ({ credits: mockCredits }) }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

describe('the fixture is a plan that really sells a band', () => {
  it('Business includes 7,500, Starter 750, and Free carries the taste', () => {
    expect(PLAN_ENTITLEMENTS.business.assistCreditsPerMonth).toBe(7_500)
    // Starter includes 750 since AGL-3203, and sells past them.
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBe(750)
    // The Free taste (AGL-2925): a real band, so the meter renders for it.
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(300)
  })

  it('NO plan row bands at zero, so the "no meter" fixture is an override', () => {
    // The premise every "renders nothing" case below rests on. Were a plan
    // row to band at zero again, those cases would silently start testing a
    // plan rather than the override they name (AGL-3203).
    for (const [plan, row] of Object.entries(PLAN_ENTITLEMENTS)) {
      expect(`${plan}: ${String(row.assistCreditsPerMonth > 0)}`).toBe(`${plan}: true`)
    }
    expect(NO_BAND.entitlements.assistCreditsPerMonth).toBe(0)
  })
})

describe('a workspace with a band can see how much of it is left', () => {
  it('renders the drawn credits against the PLAN band', async () => {
    render(<AiCreditsCard orgId="org-1" org={BUSINESS} />)
    await waitFor(() => {
      const row = screen.getByText(METER).parentElement?.parentElement
      // `UsageMeter` prints both figures ungrouped, as every meter on the
      // page does — `100000` for API requests included.
      expect(row?.textContent).toContain('4500')
    })
    // The denominator is the band the plan sells, read from the entitlement
    // rather than from whatever the route happened to answer — a meter that
    // took its own limit from the server would render any number the server
    // sent, including one no plan includes.
    const row = screen.getByText(METER).parentElement?.parentElement
    expect(row?.textContent).toContain(
      String(PLAN_ENTITLEMENTS.business.assistCreditsPerMonth),
    )
    // And nothing on the page quotes our provider bill. 4,500 credits is
    // $4.50 of model spend; that figure must appear nowhere.
    expect(document.body.textContent).not.toContain('$4.50')
  })

  it('keeps the UNMETERED state when the read fails, never a zero', async () => {
    // A failed read rendering "0 used" would tell a workspace it has its whole
    // band in hand at the moment we cannot tell whether it does.
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as any
    render(<AiCreditsCard orgId="org-1" org={BUSINESS} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('not yet metered'))
    expect(row?.textContent).not.toContain('0 / 18000')
  })

  it('stays UNMETERED when the answer carries no standing either', async () => {
    // The second failure shape, and the one an `?? { used: 0 }` fallback
    // would swallow: the request SUCCEEDS and answers `credits: null`. On a
    // plan that sells a band that is an answer we cannot use, and defaulting
    // it to zero would tell the workspace its whole band is in hand.
    mockCredits = null
    render(<AiCreditsCard orgId="org-1" org={BUSINESS} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('not yet metered'))
    expect(row?.textContent).not.toContain('0 / 18000')
  })

  it('renders NO meter for an org that sells no band', async () => {
    // "0 of 0" is not a readout of anything, and such a workspace's
    // assistant is bounded by a message cap the panel already states. Since
    // AGL-3203 the zero is a per-org override rather than a plan row.
    mockCredits = null
    render(<AiCreditsCard orgId="org-1" org={NO_BAND} />)
    await waitFor(() => expect(screen.queryAllByText(METER)).toHaveLength(0))
  })

  it('THE CONTROL: bare Starter DOES render one, against its 750 (AGL-3203)', async () => {
    // Without this the test above would pass on a component that rendered
    // nothing for Starter at all — which is what it used to do.
    mockCredits = { used: 200, limit: 750, remaining: 550 }
    render(<AiCreditsCard orgId="org-1" org={STARTER} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('200 / 750'))
  })
})

/**
 * ONE meter, ONE pool (AGL-2899). The Aglyn AI add-on adds
 * `AI_ADDON_CREDITS_PER_MONTH[plan]` to `assistCreditsPerMonth`, so the
 * denominator here is plan plus add-on, the caption names the add-on's share,
 * and a plan that sells the add-on but has not bought it is pointed at the
 * add-ons card — on the Billing overview, because these meters render on the
 * Usage section where a bare hash resolves to nothing.
 */
describe('an uncapped staff comp has a meter and no band (AGL-3049)', () => {
  const INTERNAL = {
    $id: 'org-1',
    plan: 'enterprise',
    enterprise: true,
    entitlements: {
      planComp: {
        plan: 'enterprise',
        uncapped: true,
        reason: 'other',
        note: 'Internal workspace',
        grantedBy: 'staff-1',
      },
    },
  } as any

  it('reads the credits drawn against Unlimited, with no bar and no Infinity', async () => {
    // The route's answer for this workspace, as JSON carries it: the band's
    // absence is `null`, never the `Infinity` the entitlement resolves to.
    mockCredits = JSON.parse(
      JSON.stringify({ used: 250_000, limit: null, remaining: null }),
    )
    render(<AiCreditsCard orgId="org-1" org={INTERNAL} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('250000 / Unlimited'))
    expect(row?.textContent).not.toMatch(/Infinity|null|NaN/)
    expect(row?.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('the control: the same workspace with the comp capped meters against Enterprise’s band', async () => {
    mockCredits = { used: 1_000, limit: 116_000, remaining: 115_000 }
    const capped = {
      ...INTERNAL,
      entitlements: {
        planComp: { ...INTERNAL.entitlements.planComp, uncapped: false },
      },
    }
    render(<AiCreditsCard orgId="org-1" org={capped} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() =>
      expect(row?.textContent).toContain(
        `1000 / ${PLAN_ENTITLEMENTS.enterprise.assistCreditsPerMonth}`,
      ),
    )
    expect(row?.querySelector('[role="progressbar"]')).not.toBeNull()
  })
})

describe('the Aglyn AI add-on widens the one meter (AGL-2899)', () => {
  it('without the add-on: the plan band, and the Add Aglyn AI link', async () => {
    mockCredits = { used: 1_000, limit: 2_750, remaining: 1_750 }
    render(
      <AiCreditsCard orgId="org-1" org={PRO} billingHref="/acme/billing" />,
    )
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('1000 / 2750'))
    const link = screen.getByRole('link', { name: 'Add Aglyn AI' })
    expect(link.getAttribute('href')).toBe('/acme/billing#addons')
    // The band it would add is the add-on's own figure for the plan.
    expect(screen.getByText(/add 9,000 credits a month to this pool/)).toBeTruthy()
    expect(screen.queryByText(/from the Aglyn AI add-on/)).toBeNull()
  })

  it('with the add-on: plan plus add-on as the included figure, and no link', async () => {
    // FORCED RED by a meter that read the plan band alone: 2,750 is not the
    // figure the assistant is refused at once the add-on is on.
    mockCredits = { used: 4_500, limit: 11_750, remaining: 7_250 }
    render(<AiCreditsCard orgId="org-1" org={PRO_WITH_AI} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('4500 / 11750'))
    expect(
      screen.getByText('Includes 9,000 credits a month from the Aglyn AI add-on.'),
    ).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Add Aglyn AI' })).toBeNull()
    // Still one meter: the add-on is not a second row.
    expect(screen.getAllByText(METER)).toHaveLength(1)
    expect(screen.queryAllByText(/credits \(this month\)/)).toHaveLength(1)
  })

  it('Starter with the add-on widens its band to 750 + 4,000 (AGL-3203)', async () => {
    // The add-on ADDS to the plan's own 750; it is not the band itself, and
    // a meter reading 4,000 would be short by the credits the plan includes.
    // The caption names the add-on's SHARE, which is still 4,000.
    mockCredits = { used: 500, limit: 4_750, remaining: 4_250 }
    render(<AiCreditsCard orgId="org-1" org={STARTER_WITH_AI} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('500 / 4750'))
    expect(
      screen.getByText('Includes 4,000 credits a month from the Aglyn AI add-on.'),
    ).toBeTruthy()
    // Still one meter: the add-on widened the pool, it did not open a second.
    expect(screen.getAllByText(METER)).toHaveLength(1)
  })

  it('an org that sells no band keeps today\'s wording: no meter, no link', async () => {
    // A band of zero renders nothing at all — no meter, and no upsell caption
    // against a band that does not exist. Since AGL-3203 that org is one an
    // override zeroed, never a plan row.
    mockCredits = null
    render(<AiCreditsCard orgId="org-1" org={NO_BAND} billingHref="/acme/billing" />)
    await waitFor(() => expect(screen.queryAllByText(METER)).toHaveLength(0))
    expect(screen.queryByRole('link', { name: 'Add Aglyn AI' })).toBeNull()
  })

  it('THE CONTROL: bare Starter has a band, so it gets the meter AND the link', async () => {
    // The counter-case to the silence above: Starter sells the add-on and
    // has not bought it, so it is exactly the org the upsell caption is for.
    mockCredits = { used: 200, limit: 750, remaining: 550 }
    render(<AiCreditsCard orgId="org-1" org={STARTER} billingHref="/acme/billing" />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    await waitFor(() => expect(row?.textContent).toContain('200 / 750'))
    const link = screen.getByRole('link', { name: 'Add Aglyn AI' })
    expect(link.getAttribute('href')).toBe('/acme/billing#addons')
    expect(screen.getByText(/add 4,000 credits a month to this pool/)).toBeTruthy()
  })

  it('Free shows the taste as a meter and never the add-on link (AGL-2925)', async () => {
    // Free carries a real band of 300 since the taste, so the meter renders
    // — and Free sells no add-on, so there is nothing to link to.
    mockCredits = { used: 120, limit: 300, remaining: 180 }
    render(
      <AiCreditsCard orgId="org-1"
        org={{ $id: 'org-1', plan: 'free' } as any}
        billingHref="/acme/billing"
      />,
    )
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Add Aglyn AI' })).toBeNull()
  })
})
