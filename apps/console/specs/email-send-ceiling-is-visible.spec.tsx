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
 * A WORKSPACE CAN SEE THE PACE IT IS THROTTLED AT.
 *
 * Two independent ceilings govern campaign mail, and the billing page showed
 * one. `claimOrgEmailSendBudget` defers a campaign that would take the org
 * past its share of the platform hour, and that number appeared nowhere except
 * the deferral notice — so a customer paced at 500 an hour had no surface that
 * said 500, or said hour, until they were already stopped.
 *
 * ## The property this file exists to protect is the DENOMINATOR
 *
 * The monthly allowance and the hourly ceiling count the same unit — one
 * message per recipient address — over windows three orders of magnitude
 * apart. Neither divides into the other, and a bar that mixed them would be
 * worse than no bar. Every assertion below therefore pins a number TOGETHER
 * WITH the window it was measured over, and the two rows are checked to have
 * kept their own denominators.
 *
 * ## And the sentinel
 *
 * `UNLIMITED` is `Number.POSITIVE_INFINITY`; `JSON.stringify(Infinity)` is
 * `null` and `Number(null)` is `0`. A ceiling that crossed the wire as a
 * sentinel would arrive as ZERO and render as 100% spent on the most expensive
 * plan — AGL-2482, on the page a customer reads before deciding to stay. Both
 * halves are covered: an unlimited PLAN must render as unlimited, and a
 * ceiling that arrives as the serialized sentinel must render as nothing at
 * all rather than as spent.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { resolveOrgEntitlements, UNLIMITED } from '@aglyn/aglyn'
import {
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
  deliverableMonthlyCeiling,
  orgHourlyCampaignCeiling,
} from '@aglyn/shared-util-email'

/** The org counter the MONTHLY meter reads, so both rows have real numbers. */
let mockMonthlyCampaignSends: number
/**
 * The COST meter beside it — every send, campaigns and transactional alike.
 *
 * Two counters, and the overage caption must read THIS one. The cap refuses
 * campaigns at the band, so campaign volume can never pass it; what carries an
 * org over is receipts, invites, booking reminders and password resets, which
 * are refused nowhere. Priced off the campaign meter the caption would read as
 * permanently absent.
 */
let mockMonthlyTotalSends: number
/** What `/api/billing/email-ceiling` answers, or `'error'` for a failed read. */
let mockCeilingPayload: Record<string, unknown> | 'error'
/** Every URL the component fetched, so per-site fan-out is detectable. */
let mockFetched: string[]

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

/**
 * ONE user object for the whole suite, deliberately.
 *
 * `useUser` subscribes to `onIdTokenChanged` and hands back the same Firebase
 * `User` instance until the token actually refreshes, so in production the
 * value is stable across renders and an effect keyed on it runs once. A mock
 * that minted a fresh object per render would make every effect in the
 * component re-fire on every paint — and the request-count assertion below
 * would then be measuring the double, not the product.
 */
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDoc: async (ref: { path: string }) => {
    const month = new Date().toISOString().slice(0, 7)
    if (ref.path === 'orgs/org-1/counters/campaignEmailSends') {
      return {
        exists: () => true,
        data: () => ({ [month]: mockMonthlyCampaignSends }),
      }
    }
    if (ref.path === 'orgs/org-1/counters/emailSends') {
      return {
        exists: () => true,
        data: () => ({ [month]: mockMonthlyTotalSends }),
      }
    }
    return { exists: () => false, data: () => ({}) }
  },
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'

/** Pro: `hostLimit: 3`, `emailSendsPerMonth: 5,000`. */
const PRO = { $id: 'org-1', plan: 'pro' } as any
/** Enterprise: a finite CONTRACTED default, no longer the sentinel's home. */
const ENTERPRISE = { $id: 'org-1', plan: 'enterprise' } as any
/**
 * An org whose agreement grants an uncapped monthly allowance.
 *
 * No PLAN sells one any more — every row in `PLAN_ENTITLEMENTS` is finite,
 * because `JSON.stringify(Infinity)` is `null` and reads back as a cap of
 * zero. A per-org override can still produce the sentinel, and
 * `resolveOrgEntitlements` applies it ahead of the plan, so this surface has
 * to keep rendering it correctly. The tests below are what say so; without an
 * org in this shape they would be asserting against a state the table can no
 * longer reach.
 */
const UNCAPPED_BY_CONTRACT = {
  $id: 'org-1',
  plan: 'enterprise',
  entitlements: { emailSendsPerMonth: UNLIMITED },
} as any
const HOSTS = [
  { $id: 'host-a', displayName: 'Site A' },
  { $id: 'host-b', displayName: 'Site B' },
  { $id: 'host-c', displayName: 'Site C' },
]

/**
 * The ceilings the SERVER would derive at the shipped platform ramp — 500 an
 * hour and 360,000 a projected month at 2,000/hour and a 25% share.
 *
 * Computed through the shared functions the route calls, never typed out, so
 * an operator ramp or a share change moves the fixture with the product
 * instead of pinning this file to a number the platform no longer uses.
 */
const HOUR_LIMIT = orgHourlyCampaignCeiling(EMAIL_SEND_RATE_DEFAULT_PER_HOUR)
const DELIVERABLE_MONTHLY = deliverableMonthlyCeiling(
  EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
)

/** Top of the next hour, so the reset time is a stable, formattable instant. */
const HOUR_RESET_MS = Date.UTC(2026, 7, 30, 15, 0, 0)

function ceiling(overrides: Record<string, unknown> = {}) {
  return {
    hourUsed: 0,
    hourLimit: HOUR_LIMIT,
    hourResetMs: HOUR_RESET_MS,
    deliverableMonthly: DELIVERABLE_MONTHLY,
    perSend: EMAIL_MAX_RECIPIENTS_PER_SEND,
    paced: true,
    ...overrides,
  }
}

/** The `<Stack>` holding one meter's label and its `used / limit` readout. */
function meterRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement
}

const HOURLY = 'Campaign emails (this hour, organization)'
const MONTHLY = 'Campaign emails (this month, organization)'

beforeEach(() => {
  mockMonthlyCampaignSends = 0
  mockMonthlyTotalSends = 0
  mockCeilingPayload = ceiling()
  mockFetched = []
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    mockFetched.push(url)
    if (url.startsWith('/api/billing/email-ceiling')) {
      if (mockCeilingPayload === 'error') {
        return { ok: false, json: async () => ({}) }
      }
      return { ok: true, json: async () => mockCeilingPayload }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

describe('the fixture really is two different windows', () => {
  /**
   * The anti-vacuity control. If the hourly ceiling happened to equal the
   * monthly allowance, every "kept its own denominator" assertion below would
   * pass for the wrong reason.
   */
  it('the hourly ceiling and the monthly allowance are different numbers', () => {
    const monthly = resolveOrgEntitlements(PRO).emailSendsPerMonth
    expect(monthly).toBe(5000)
    expect(HOUR_LIMIT).toBe(500)
    expect(HOUR_LIMIT).not.toBe(monthly)
    expect(DELIVERABLE_MONTHLY).not.toBe(monthly)
  })
})

describe('the hourly ceiling reaches the customer', () => {
  it('renders the hour spent against the hourly ceiling', async () => {
    mockCeilingPayload = ceiling({ hourUsed: 420 })
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)

    await waitFor(() => {
      expect(meterRow(HOURLY).textContent).toContain(`420 / ${HOUR_LIMIT}`)
    })
    // Past 80% of the hour, so the meter warns and offers the upgrade — the
    // same threshold every other meter on the card uses.
    expect(meterRow(HOURLY).textContent).toContain('Upgrade')
  })

  it('keeps the two windows apart — neither denominator is the other', async () => {
    // 420 of an hour and 420 of a month are different facts. Under the old
    // surface only the second existed, and the merchant deferred at 420/500
    // was reading 420/5,000 and seeing 8%.
    mockMonthlyCampaignSends = 420
    mockCeilingPayload = ceiling({ hourUsed: 420 })
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)

    await waitFor(() => {
      expect(meterRow(HOURLY).textContent).toContain(`420 / ${HOUR_LIMIT}`)
    })
    expect(meterRow(MONTHLY).textContent).toContain('420 / 5000')
    // Each row names its own window in its own label, so neither number can be
    // read as the other.
    expect(meterRow(HOURLY).textContent).toContain('this hour')
    expect(meterRow(MONTHLY).textContent).toContain('this month')
    // The hour is at 84% and the month at 8.4%: the same numerator against two
    // denominators, exactly one of which warns.
    expect(meterRow(HOURLY).textContent).toContain('Upgrade')
    expect(meterRow(MONTHLY).textContent).not.toContain('Upgrade')
  })

  it('says when the window rolls, and what the row is NOT about', async () => {
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    const resetAt = new Date(HOUR_RESET_MS).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(screen.getByText(new RegExp(`Resets ${resetAt}`))).toBeTruthy()
    // The per-send cap explains why the hourly figure is the size it is.
    expect(
      screen.getByText(
        new RegExp(
          `at most ${EMAIL_MAX_RECIPIENTS_PER_SEND.toLocaleString()} addresses`,
        ),
      ),
    ).toBeTruthy()
    // Receipts and password resets are never paced by this (AGL-1438), and a
    // merchant reading a throttle needs to know it.
    expect(screen.getByText(/Transactional mail is not paced/)).toBeTruthy()
  })

  it('says when the pacing control is parked', async () => {
    // The platform governor has an operator kill switch, and
    // `claimOrgEmailSendBudget` grants every claim while it is off. A ceiling
    // drawn as binding while nothing enforces it is a number the customer
    // would plan around for no reason.
    mockCeilingPayload = ceiling({ paced: false })
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        screen.getByText(/Hourly pacing is switched off platform-wide/),
      ).toBeTruthy()
    })
  })

  it('does not say that while the control IS enforcing', async () => {
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    expect(screen.queryByText(/switched off platform-wide/)).toBeNull()
  })
})

describe('one request for the organization, not one per site', () => {
  it('asks once however many sites the org has', async () => {
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    const asked = mockFetched.filter((url) =>
      url.startsWith('/api/billing/email-ceiling'),
    )
    // Three sites. The ceiling is a share of the platform hour granted to the
    // ORGANIZATION and its counter is keyed by org id, so fanning out per host
    // would be the AGL-2113 shape again at three times the cost.
    expect(HOSTS.length).toBe(3)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('orgId=org-1')
    expect(asked[0]).not.toContain('hostId')
  })
})

describe('the UNLIMITED sentinel (AGL-2482)', () => {
  it('an unlimited ALLOWANCE reads as unlimited, never as spent', async () => {
    mockMonthlyCampaignSends = 900_000
    render(<BillingUsageComponent org={UNCAPPED_BY_CONTRACT} hosts={HOSTS} />)

    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    expect(
      resolveOrgEntitlements(UNCAPPED_BY_CONTRACT).emailSendsPerMonth,
    ).toBe(UNLIMITED)
    const monthly = meterRow(MONTHLY)
    expect(monthly.textContent).toContain('900000 / Unlimited')
    // The two shapes the sentinel takes when it is mishandled: a cap of 0, and
    // a bar that reads 100% because everything divided by nothing is full.
    expect(monthly.textContent).not.toContain('/ 0')
    expect(monthly.querySelector('[role="progressbar"]')).toBeNull()
    // And no reset promise: there is no allowance to wait for.
    expect(screen.queryByText(/Unused allowance does not roll over/)).toBeNull()
  })

  it('an unlimited allowance is still told what the pace can deliver', async () => {
    render(<BillingUsageComponent org={UNCAPPED_BY_CONTRACT} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        screen.getByText(/more campaign email a month than this pace/),
      ).toBeTruthy()
    })
    expect(
      screen.getByText(
        new RegExp(`${DELIVERABLE_MONTHLY.toLocaleString()} can`),
      ),
    ).toBeTruthy()
    // …and that reaching it defers rather than refuses, which is the whole
    // difference between a pace and a cap.
    expect(screen.getByText(/deferred to the next hour, not/)).toBeTruthy()
  })

  it('the enterprise PLAN itself now carries a finite, contracted band', async () => {
    // The row that used to be the sentinel. It resolves to a real number, it
    // renders as one, and the reset promise — suppressed for an uncapped
    // allowance because there is nothing to wait for — is back.
    mockMonthlyCampaignSends = 1_000
    const entitled = resolveOrgEntitlements(ENTERPRISE).emailSendsPerMonth
    expect(Number.isFinite(entitled)).toBe(true)
    expect(entitled).toBe(250_000)
    render(<BillingUsageComponent org={ENTERPRISE} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    const monthly = meterRow(MONTHLY)
    expect(monthly.textContent).toContain('1000 / 250000')
    expect(monthly.textContent).not.toContain('Unlimited')
    // The two shapes a flattened sentinel takes, neither of which may appear.
    expect(monthly.textContent).not.toContain('/ 0')
    expect(monthly.textContent).not.toContain('null')
    expect(
      screen.getByText(/Unused allowance does not roll over/),
    ).toBeTruthy()
  })

  it('a plan INSIDE the deliverable ceiling is told nothing of the sort', async () => {
    // Non-vacuous: Pro's 5,000 fits inside 360,000, so the note must be
    // absent — a note that always renders says nothing.
    expect(resolveOrgEntitlements(PRO).emailSendsPerMonth).toBeLessThan(
      DELIVERABLE_MONTHLY,
    )
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    expect(screen.queryByText(/than this pace can deliver/)).toBeNull()
  })

  it('a CEILING that arrives as the serialized sentinel renders nothing', async () => {
    // `JSON.stringify({ hourLimit: Infinity })` is `{"hourLimit":null}`, and
    // `Number(null)` is 0 — so an unguarded surface would draw `0 / 0` and
    // colour it error. The row must be absent instead: a meter with no honest
    // denominator is worse than no meter.
    mockCeilingPayload = ceiling({
      hourLimit: JSON.parse(JSON.stringify({ v: Number.POSITIVE_INFINITY })).v,
    })
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(MONTHLY)).toBeTruthy()
    })
    expect(screen.queryByText(HOURLY)).toBeNull()
    expect(screen.queryByText(/0 \/ 0/)).toBeNull()
  })

  it('a failed read holds the unmetered state rather than inventing one', async () => {
    mockCeilingPayload = 'error'
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(MONTHLY)).toBeTruthy()
    })
    expect(screen.queryByText(HOURLY)).toBeNull()
  })
})

describe('the monthly allowance says when it comes back', () => {
  it('names the reset date and the timezone the counter is keyed in', async () => {
    // The counter is keyed `YYYY-MM` in UTC, so the allowance returns at
    // midnight UTC on the 1st — a different instant from local midnight for
    // most of the planet, and the one a merchant plans a send around.
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(
        screen.getByText(/Unused allowance does not roll over/),
      ).toBeTruthy()
    })
    expect(screen.getByText(/at 00:00 UTC/)).toBeTruthy()
    const firstOfNextMonth = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    ).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
    expect(
      screen.getByText(new RegExp(`Resets ${firstOfNextMonth}`)),
    ).toBeTruthy()
  })
})

/**
 * THE OVERAGE CAPTION — the surface where a customer learns email now costs
 * something, and learns WHY the meter above can read "inside your allowance"
 * while a charge appears anyway.
 *
 * The two counters answer different questions and the caption reads the one
 * the invoice reads. `report-usage` computes the same figure from the same
 * `emailSendsOverage` and prices it with the same `priceEmailSendOverage`, so
 * this page and the invoice cannot disagree by construction rather than by
 * anyone keeping them in step.
 */
describe('the email overage caption', () => {
  const OVERAGE = /emails over your included/

  it('prices the excess on the COST meter, at the plan rate', async () => {
    // Pro includes 5,000. The campaign meter is well inside the band — as it
    // always is, since the cap refuses campaigns — and 6,200 total sends put
    // the org 1,200 over on transactional mail.
    mockMonthlyCampaignSends = 900
    mockMonthlyTotalSends = 6_200
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(OVERAGE)).toBeTruthy()
    })
    const caption = screen.getByText(OVERAGE).textContent ?? ''
    expect(caption).toContain('1,200 emails over your included 5,000')
    // Pro's rate is $2.25/1,000, so 1,200 over is $2.70. Cents on the rate,
    // because "$2.25" is a price and "$2.2" is a typo.
    expect(caption).toContain('$2.25/1,000')
    expect(caption).toContain('$2.70')
    // …and the sentence that stops the meter above looking like a lie.
    expect(caption).toContain('Transactional mail')
  })

  it('MUTATION GUARD: the campaign meter alone would show nothing', async () => {
    // Same org, same 900 campaigns, no transactional overflow. If the caption
    // were computed from the campaign counter it would be absent in the case
    // above too — this is what makes that green mean something.
    mockMonthlyCampaignSends = 900
    mockMonthlyTotalSends = 900
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    expect(screen.queryByText(OVERAGE)).toBeNull()
  })

  it('is absent for a plan that carries no rate', async () => {
    // Enterprise is contract-billed and publishes no overage rate, so a
    // caption quoting one would advertise a fee nobody agreed to.
    mockMonthlyCampaignSends = 1_000
    mockMonthlyTotalSends = 400_000
    render(<BillingUsageComponent org={ENTERPRISE} hosts={HOSTS} />)
    await waitFor(() => {
      expect(screen.getByText(HOURLY)).toBeTruthy()
    })
    expect(screen.queryByText(OVERAGE)).toBeNull()
  })

  it('quotes nothing before the counter has been read', async () => {
    // An unread meter has no honest charge to state. `null` yields an
    // overage of 0, which suppresses the caption rather than printing $0.00 —
    // the loading-default-answers-a-question shape, on a line about money.
    mockMonthlyCampaignSends = 0
    mockMonthlyTotalSends = 0
    render(<BillingUsageComponent org={PRO} hosts={HOSTS} />)
    expect(screen.queryByText(OVERAGE)).toBeNull()
  })
})
