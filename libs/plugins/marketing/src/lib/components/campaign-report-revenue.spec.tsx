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
 *
 * @jest-environment jsdom
 */

/**
 * WHAT THE MONEY LOOKS LIKE ON SCREEN.
 *
 * `campaign-revenue.spec.ts` proves the arithmetic; this file proves the
 * arithmetic is what a reader sees. They are separate failures, and the one
 * this file exists for is specific: a model that returns a per-message figure
 * carrying its denominator, rendered by a card that prints only the money,
 * produces "$0.50 per recipient" over a population nobody named — which is
 * the divide-by-a-stale-population failure the whole reporting surface is
 * built to make impossible.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  CampaignStats,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-report'
import type {
  CampaignRevenueRollup,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-revenue'

/** What each `useFirestoreDoc` call answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => ({
    data: mockDocs.get(build()?.__path ?? ''),
  }),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))

/*
 * The route the sibling-hub link is built from. The message's own page lives
 * on the Emails console, so this card resolves that hub from the URL the
 * console is already on rather than from its own `basePath`.
 */
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const CAMPAIGN_PATH = 'hosts/site1/campaigns/camp_1'
const REVENUE_PATH = 'hosts/site1/campaigns/camp_1/reports/revenue'

/**
 * Every candidate denominator a different number.
 *
 * `audienceSize` 1,200, `recipients` 1,000, `sent` 1,000, `delivered` 900.
 * On a campaign where they coincide, an assertion that reads a denominator
 * off the screen passes against any of them, and the one test worth writing
 * — that the money is divided by the right population — proves nothing.
 */
const STATS: CampaignStats = {
  audienceSize: 1200,
  recipients: 1000,
  sent: 1000,
  delivered: 900,
  opens: 500,
  uniqueOpens: 300,
  clicks: 120,
  uniqueClicks: 90,
  bounced: 100,
  complained: 9,
  unsubscribes: 18,
  clickTracked: true,
}

async function renderReport(options: {
  stats?: CampaignStats
  revenue?: CampaignRevenueRollup
  campaign?: Record<string, unknown>
}): Promise<void> {
  mockDocs.clear()
  mockDocs.set(CAMPAIGN_PATH, {
    subject: 'Spring sale',
    stats: options.stats ?? STATS,
    ...options.campaign,
  })
  if (options.revenue) mockDocs.set(REVENUE_PATH, options.revenue)
  const { CampaignReportCard } = await import('./campaign-report-card')
  render(
    (
      <CampaignReportCard
        hostId="site1"
        campaignId="camp_1"
        basePath="/acme/hosts/site/marketing"
      />
    ) as ReactNode as never,
  )
}

describe('the revenue section names its denominator on screen', () => {
  /*
   * THE ASSERTION THE SECTION IS FOR. "$0.50" alone is not a readable revenue
   * per message — it is readable only beside the population it was divided
   * by, and that has to be in the DOM rather than in a tooltip, because a
   * reader comparing two campaigns cannot hover both at once.
   */
  it('renders revenue per message beside "$450.00 over 900 delivered"', async () => {
    await renderReport({
      revenue: {
        model: 'last-click',
        windowDays: 7,
        byCurrency: { usd: { grossCents: 45_000, orders: 9 } },
      },
    })

    expect(screen.getByText('Net revenue per delivered message')).toBeTruthy()
    expect(screen.getByText('$0.50')).toBeTruthy()
    expect(screen.getByText('$450.00 over 900 delivered')).toBeTruthy()
  })

  /*==========================================
   * THE STALE-POPULATION DIVISION, refused.
   *
   * `audienceSize` is written by the FIRST batch only and is a floor when
   * audience resolution hit its read ceiling, so a campaign delivered over
   * six runs would divide six runs' revenue by one run's measure of the
   * audience. `delivered` is incremented by the delivery webhook keyed on the
   * campaign, so it covers every batch — and it is the only denominator here.
   *=========================================*/
  it('divides by delivered and NEVER by the audience the first batch measured', async () => {
    await renderReport({
      stats: { ...STATS, audienceSizeTruncated: true },
      revenue: { byCurrency: { usd: { grossCents: 45_000, orders: 9 } } },
    })

    // 45,000 / 900 = 50 cents. Over `audienceSize` it would be 37.5, over
    // `recipients` or `sent` 45 — three different, visibly different answers.
    expect(screen.getByText('$450.00 over 900 delivered')).toBeTruthy()
    expect(screen.queryByText('$0.38')).toBeNull()
    expect(screen.queryByText('$0.37')).toBeNull()
    expect(screen.queryByText('$0.45')).toBeNull()
  })

  it('holds every figure additive across a batched send', async () => {
    // Two runs: the first delivered 400 and earned $200, the second brought
    // the totals to 900 delivered and $450. Both counters are cumulative —
    // `stats.delivered` because the webhook increments it per campaign, the
    // rollup because every attribution is an increment — so the figure on
    // screen is the whole campaign and not the latest run.
    await renderReport({
      stats: { ...STATS, delivered: 900, sent: 1000 },
      revenue: { byCurrency: { usd: { grossCents: 45_000, orders: 9 } } },
    })
    expect(screen.getByText('$450.00 over 900 delivered')).toBeTruthy()
    // The numerator can never exceed its own total, and the denominator is
    // the delivered count, not the addressed one.
    expect(screen.queryByText('$450.00 over 1,000 delivered')).toBeNull()
  })

  it('says a running total is running while the send is mid-flight', async () => {
    await renderReport({
      campaign: {
        status: 'scheduled',
        resume: { remaining: 500, batch: 2, nextAtMs: 1_700_000_000_000 },
      },
      revenue: { byCurrency: { usd: { grossCents: 45_000, orders: 9 } } },
    })
    expect(
      screen.getByText(/still going out.*running total/s),
    ).toBeTruthy()
  })

  it('leads with net and shows the refund that produced it', async () => {
    await renderReport({
      revenue: {
        byCurrency: {
          usd: {
            grossCents: 45_000,
            refundedCents: 15_000,
            orders: 9,
            refundedOrders: 3,
          },
        },
      },
    })

    expect(screen.getByText('Net revenue')).toBeTruthy()
    expect(screen.getByText('$300.00')).toBeTruthy()
    expect(screen.getByText('Gross revenue')).toBeTruthy()
    expect(screen.getByText('$450.00')).toBeTruthy()
    expect(screen.getByText('Refunded')).toBeTruthy()
    expect(screen.getByText('$150.00')).toBeTruthy()
    // The per-message figure follows NET, not gross: $300 / 900 = $0.33.
    expect(screen.getByText('$300.00 over 900 delivered')).toBeTruthy()
  })

  it('renders two currencies apart, with no combined total anywhere', async () => {
    await renderReport({
      revenue: {
        byCurrency: {
          usd: { grossCents: 45_000, orders: 9 },
          eur: { grossCents: 20_000, orders: 4 },
        },
      },
    })

    expect(screen.getByText('USD')).toBeTruthy()
    expect(screen.getByText('EUR')).toBeTruthy()
    // `getAllByText` because gross and net coincide when nothing was
    // refunded, and both are drawn — which is the point of showing both.
    expect(screen.getAllByText('$450.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('€200.00').length).toBeGreaterThan(0)
    // €650 or $650 — the number a careless sum would produce — is nowhere.
    expect(screen.queryByText('$650.00')).toBeNull()
    expect(screen.queryByText('€650.00')).toBeNull()
    expect(
      screen.getByText(/more than one currency.*no combined total/s),
    ).toBeTruthy()
  })

  it('withholds the per-message figure when delivery was never recorded', async () => {
    const { delivered, ...withoutDelivered } = STATS
    void delivered
    await renderReport({
      stats: withoutDelivered,
      revenue: { byCurrency: { usd: { grossCents: 45_000, orders: 9 } } },
    })

    // The amounts are real and are still shown; only the division is refused.
    expect(screen.getAllByText('$450.00').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('— not enough recorded to compute').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/over .* delivered/)).toBeNull()
  })

  it('tells a campaign with no store apart from one that sold nothing', async () => {
    await renderReport({})
    // Not "$0.00". A campaign that was never joined to a store and one that
    // earned nothing lead a merchant to opposite conclusions about whether to
    // send another.
    expect(
      screen.getByText(/No revenue has been attributed to this campaign/),
    ).toBeTruthy()
    expect(screen.queryByText('$0.00')).toBeNull()
    // And the rule is still stated, from the default window rather than from
    // a stored one — a campaign with nothing to show is exactly where a
    // merchant asks what would have had to happen for a figure to appear.
    //
    // Matched against the REVENUE sentence rather than against the window on
    // its own: the conversions section states the same window in its own
    // words, and a bare `/within 7 days/` would pass on either.
    expect(
      screen.getByText(
        /Orders are credited to the last campaign whose link the buyer clicked, within 7 days/,
      ),
    ).toBeTruthy()
  })

  it('says a campaign with a rollup and no orders earned nothing', async () => {
    await renderReport({ revenue: { byCurrency: {} } })
    expect(
      screen.getByText('No orders have been credited to this campaign.'),
    ).toBeTruthy()
  })

  it('states the model and the window beside the money', async () => {
    await renderReport({
      revenue: {
        model: 'last-click',
        windowDays: 7,
        byCurrency: { usd: { grossCents: 45_000, orders: 9 } },
      },
    })
    // A merchant has to be able to state the rule to use the number.
    expect(
      screen.getByText(/last campaign whose link the buyer clicked/),
    ).toBeTruthy()
    expect(screen.getByText(/within 7 days of that click/)).toBeTruthy()
    expect(screen.getByText(/Clicks only/)).toBeTruthy()
    expect(screen.getByText(/floor/)).toBeTruthy()
  })

  it('shows the order count as a count, and no conversion percentage', async () => {
    await renderReport({
      revenue: { byCurrency: { usd: { grossCents: 45_000, orders: 9 } } },
    })
    expect(screen.getByText('Orders')).toBeTruthy()
    expect(screen.getByText('credited to this campaign')).toBeTruthy()
    // No conversion RATE anywhere, under any of the names it goes by. Orders
    // over delivered is not a rate — one buyer can place two orders, so the
    // quotient passes 100% without anything being wrong, which is the defect
    // that keeps `opens` out of the open-rate numerator too.
    //
    // The word "conversions" alone is not the thing being refused: the report
    // carries a Conversions section counting what the campaign caused, and
    // those are counts for the same reason these are. What may never appear
    // is a RATE taken over either population.
    expect(screen.queryByText(/[Cc]onversion rate/)).toBeNull()
    expect(screen.queryByText(/[Oo]rder rate/)).toBeNull()
    expect(screen.queryByText(/[Pp]urchase rate/)).toBeNull()
  })
})
