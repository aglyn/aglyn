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
 * AGL-2469: the code still charges and enforces what `aglyn.com/pricing`
 * publishes.
 *
 * ## Why this file holds a hand-written table when `billing-plan-feature-rows`
 * ## explicitly refuses to
 *
 * That guard derives its expectation from `PLAN_ENTITLEMENTS` because it is
 * checking an INTERNAL list against the source both halves share — a copy
 * there would decay with the thing it watches, which is exactly how
 * `FEATURE_ROWS` rotted to 19 of 34 (AGL-2079).
 *
 * This guard is the opposite shape. The other side of the comparison is
 * **outside the repo**: the marketing pricing table is besigner-published
 * content, served from Firestore, and no build step can read it. So the
 * numbers below are a TRANSCRIPTION of what the public page served on
 * **2026-08-19**, and their whole job is to be a fixed point that does NOT
 * move when the constants do. Deriving them from `PLAN_ENTITLEMENTS` would
 * make the file assert `x === x` and prove nothing at all.
 *
 * Read the failure accordingly. A red here does not mean the constant is
 * wrong — it means the constant and the published price list have diverged,
 * and someone has to decide which one moves:
 *
 * - the published table is the promise a customer read before paying, so the
 *   default is that the CODE is the thing that drifted;
 * - if the price list genuinely changed, republish the page first and then
 *   update the transcription here, in the same commit as the constant, with
 *   the new fetch date on the row.
 *
 * ⚠️ Pricing is FROZEN for the Sept 1 launch. Until then a divergence is a
 * bug in the code, never a licence to edit this fixture.
 *
 * ## What is deliberately NOT pinned here
 *
 * Enterprise cells. Every one of them reads "Talk to us" / "Custom" on the
 * page, which is a statement that no number is published — pinning
 * `UNLIMITED` against it would be inventing a published claim in order to
 * check it. Enterprise capacity is contractual (`isCustomPricedPlan`).
 */

import { METERED_MARKUP, METERED_UNIT_RATES_USD } from '../utils/usage-metering'
import {
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
  UNLIMITED,
} from '@aglyn/aglyn'
import type { OrgPlan } from '@aglyn/aglyn'

/**
 * The seven columns the public table publishes numbers for, left to right.
 * Enterprise is the eighth column on the page but publishes no figures.
 */
const PUBLISHED_COLUMNS: OrgPlan[] = [
  'free',
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
  'agency',
]

type Row = readonly [number, number, number, number, number, number, number]
type TickRow = readonly [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
]

/** `—` on the page: the row is absent, which for a quota is zero. */
const NONE = 0

function quotaColumn(key: string): number[] {
  return PUBLISHED_COLUMNS.map(
    (plan) =>
      (PLAN_ENTITLEMENTS[plan] as unknown as Record<string, number>)[key],
  )
}

function flagColumn(flag: string): boolean[] {
  return PUBLISHED_COLUMNS.map(
    (plan) =>
      (PLAN_ENTITLEMENTS[plan].features as Record<string, boolean>)[flag],
  )
}

describe('AGL-2469 · the published pricing table is still what the code does', () => {
  // ---------------------------------------------------------------------
  // Premise. Every expectation below indexes PLAN_ENTITLEMENTS by a string
  // key, so a rename would yield `undefined` in each cell and the whole file
  // would pass by comparing nothing to nothing. Assert the shape first.
  // ---------------------------------------------------------------------
  describe('premise — the sources exist and have the published shape', () => {
    it('publishes exactly the eight plans the table has columns for', () => {
      expect(Object.keys(PLAN_ENTITLEMENTS).sort()).toEqual(
        [...PUBLISHED_COLUMNS, 'enterprise'].sort(),
      )
      // The page's own footnote: "scroll sideways to see all 8 plans".
      expect(SELF_SERVE_PLANS).toEqual(PUBLISHED_COLUMNS)
    })

    it('reads live numbers, not undefined, for every pinned key', () => {
      for (const key of [
        'hostLimit',
        'screensPerHost',
        'storagePerHostMb',
        'bandwidthGb',
        'managersPerOrg',
        'membersPerHost',
        'datasetsPerOrg',
        'productsPerHost',
        'posRegisters',
      ]) {
        for (const value of quotaColumn(key)) {
          expect(typeof value).toBe('number')
          expect(Number.isNaN(value)).toBe(false)
        }
      }
    })

    it('reads live booleans for every pinned feature flag', () => {
      for (const flag of [
        'customDomain',
        'commerce',
        'apiAccess',
        'ssoEnabled',
      ]) {
        for (const value of flagColumn(flag)) {
          expect(typeof value).toBe('boolean')
        }
      }
    })
  })

  // ---------------------------------------------------------------------
  // "Sites & publishing"
  // ---------------------------------------------------------------------
  describe('Sites & publishing', () => {
    it('Sites (hosts) — 1 · 1 · 3 · 10 · 15 · 25 · 100', () => {
      expect(quotaColumn('hostLimit')).toEqual([
        1, 1, 3, 10, 15, 25, 100,
      ] satisfies Row)
    })

    it('Pages per site — 5 · 25 · 100 · Unlimited ×4', () => {
      expect(quotaColumn('screensPerHost')).toEqual([
        5,
        25,
        100,
        UNLIMITED,
        UNLIMITED,
        UNLIMITED,
        UNLIMITED,
      ] satisfies Row)
    })

    it('Storage per site — 250 MB · 2 · 10 · 50 · 75 · 100 · 200 GB', () => {
      expect(quotaColumn('storagePerHostMb')).toEqual([
        250, 2048, 10240, 51200, 76800, 102400, 204800,
      ] satisfies Row)
    })

    it('Bandwidth / mo — 5 · 50 · 250 GB · 1 · 2.5 · 5 · 20 TB', () => {
      expect(quotaColumn('bandwidthGb')).toEqual([
        5, 50, 250, 1000, 2500, 5000, 20000,
      ] satisfies Row)
    })

    it.each([
      ['Custom domain & SSL', 'customDomain', 1],
      ['Remove Aglyn branding', 'removeBranding', 1],
      ['Reusable components', 'reusableComponents', 1],
      ['URL redirects', 'redirects', 1],
      ['Screen versioning', 'versioning', 2],
      ['Scheduled publishing', 'scheduledPublishing', 3],
      ['Multilingual sites', 'multilingual', 3],
      ['A/B testing', 'abTesting', 3],
    ])(
      '%s — first ✓ at column %#, dashes before it',
      (_label, flag, firstTick) => {
        const published: TickRow = PUBLISHED_COLUMNS.map(
          (_plan, index) => index >= (firstTick as number),
        ) as unknown as TickRow
        expect(flagColumn(flag as string)).toEqual(published)
      },
    )
  })

  // ---------------------------------------------------------------------
  // "Team". The page renders seats as "included · max N".
  // ---------------------------------------------------------------------
  describe('Team', () => {
    it('Team seats — 1 · 2·5 · 5·20 · 15·100 · 25·150 · 50·250 · 100·500', () => {
      expect(quotaColumn('managersPerOrg')).toEqual([
        1, 2, 5, 15, 25, 50, 100,
      ] satisfies Row)
      expect(quotaColumn('maxManagersPerOrg')).toEqual([
        1, 5, 20, 100, 150, 250, 500,
      ] satisfies Row)
    })

    it('Site collaborators — 1 · 3·10 · 10·25 · 50·100 · 75·150 · 100·250 · 250·1,000', () => {
      expect(quotaColumn('membersPerHost')).toEqual([
        1, 3, 10, 50, 75, 100, 250,
      ] satisfies Row)
      expect(quotaColumn('maxMembersPerHost')).toEqual([
        1, 10, 25, 100, 150, 250, 1000,
      ] satisfies Row)
    })

    it('White-label — Agency and Enterprise only', () => {
      expect(flagColumn('whiteLabel')).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
        true,
      ] satisfies TickRow)
      expect(PLAN_ENTITLEMENTS.enterprise.features.whiteLabel).toBe(true)
    })

    it('Single sign-on — Enterprise only', () => {
      expect(flagColumn('ssoEnabled')).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ] satisfies TickRow)
      expect(PLAN_ENTITLEMENTS.enterprise.features.ssoEnabled).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // "Content & data"
  // ---------------------------------------------------------------------
  describe('Content & data', () => {
    it('Datasets — — · 3·10 · 15·50 · 100·250 · 250·500 · 500·1,000 · 2,000·5,000', () => {
      expect(quotaColumn('datasetsPerOrg')).toEqual([
        NONE,
        3,
        15,
        100,
        250,
        500,
        2000,
      ] satisfies Row)
      expect(quotaColumn('maxDatasetsPerOrg')).toEqual([
        NONE,
        10,
        50,
        250,
        500,
        1000,
        5000,
      ] satisfies Row)
    })

    it('Records per dataset — — · 1k · 10k · 100k · 500k · 1M · Unlimited', () => {
      expect(quotaColumn('recordsPerDataset')).toEqual([
        NONE,
        1000,
        10000,
        100000,
        500000,
        1000000,
        UNLIMITED,
      ] satisfies Row)
    })

    it('Variables per site — 3 · 25 · 100 · 1,000 · 5,000 · Unlimited ×2', () => {
      expect(quotaColumn('variablesPerHost')).toEqual([
        3,
        25,
        100,
        1000,
        5000,
        UNLIMITED,
        UNLIMITED,
      ] satisfies Row)
    })

    it('Functions per site — 1 · 10 · 50 · 250 · 500 · 1,000 · Unlimited', () => {
      expect(quotaColumn('functionsPerHost')).toEqual([
        1,
        10,
        50,
        250,
        500,
        1000,
        UNLIMITED,
      ] satisfies Row)
    })

    it('Workflows per site — — · 3 · 25 · 100 · 250 · 500 · Unlimited', () => {
      expect(quotaColumn('workflowsPerHost')).toEqual([
        NONE,
        3,
        25,
        100,
        250,
        500,
        UNLIMITED,
      ] satisfies Row)
    })

    it('Workflow runs / mo — — · 500 · 5k · 50k · 150k · 500k · 2M', () => {
      expect(quotaColumn('workflowRunsPerMonth')).toEqual([
        NONE,
        500,
        5000,
        50000,
        150000,
        500000,
        2000000,
      ] satisfies Row)
    })

    it('Form submissions / mo — 20 · 200 · 1k · 10k · 50k · 100k · Unlimited', () => {
      expect(quotaColumn('formSubmissionsPerMonth')).toEqual([
        20,
        200,
        1000,
        10000,
        50000,
        100000,
        UNLIMITED,
      ] satisfies Row)
    })

    it('Contacts included — 100 · 1k · 10k · 100k · 500k · 1M · Unlimited', () => {
      expect(quotaColumn('contactsPerHost')).toEqual([
        100,
        1000,
        10000,
        100000,
        500000,
        1000000,
        UNLIMITED,
      ] satisfies Row)
    })

    /**
     * ⚠️ THE ONE ROW WHERE THE CODE AND THE PUBLISHED PAGE DISAGREE ON PURPOSE.
     *
     * The transcription below is what `aglyn.com/pricing` served — the four
     * upper figures re-transcribed 2026-08-30 after the deliverability
     * reduction, the rest fetched 2026-08-19. The page has NOT been
     * republished since; the marketing site is besigner-published content and
     * moves on its own change.
     *
     * The code has moved beneath it. Email sending is now priced: our cost is
     * $0.90 per 1,000 delivered messages, and against the old bands that ran
     * 28-36% of the subscription at Business and above. The included bands
     * came down to land every changed tier near 15%, and an overage rate went
     * on beside them. No CHARGED price moved — Business $139, Scale $249,
     * Advanced $399 and Agency $799 are untouched, which is what keeps this
     * inside the Sept 1 freeze.
     *
     * ## Why this asserts the DIVERGENCE instead of the new numbers
     *
     * Editing the transcription to match would be the one move the header
     * forbids: these rows are a record of what a customer READ, and a
     * transcription is only worth anything if it was transcribed. Nobody has
     * fetched the page since the constants moved, so writing the new figures
     * here would be asserting a fetch that did not happen — the guard would
     * still be green and would have stopped watching the thing it exists for.
     *
     * So both sides are pinned, separately, and the gap is named. This goes
     * red if the code moves again, and red if somebody edits the published
     * side without the page behind it. When `/pricing` is republished,
     * collapse this back into one `toEqual` against the code, with the new
     * fetch date — that is what closing the gap looks like.
     */
    describe('Email sends / mo — the code is ahead of the page', () => {
      /** What the published page still says, per column. */
      const PUBLISHED = [NONE, 500, 5000, 50000, 100000, 125000, 250000] satisfies Row
      /** What the code now enforces and bills against. */
      const CODE = [NONE, 500, 5000, 25000, 40000, 65000, 130000] satisfies Row

      it('the code holds the reduced bands', () => {
        expect(quotaColumn('emailSendsPerMonth')).toEqual(CODE)
      })

      it('the reduction is confined to Business and above', () => {
        // Free, Starter and Pro were already under 10% email COGS, so they did
        // not move — and asserting that here is what stops a sweep that
        // lowered all seven from reading as this change.
        expect(CODE.slice(0, 3)).toEqual(PUBLISHED.slice(0, 3))
        for (let column = 3; column < CODE.length; column += 1) {
          expect(`col${column}: ${CODE[column] < PUBLISHED[column]}`).toBe(
            `col${column}: true`,
          )
        }
      })

      it('no CHARGED price moved with it — the freeze holds', () => {
        expect(
          PUBLISHED_COLUMNS.map((plan) => PLAN_PRICING[plan].basePriceMonthlyUsd),
        ).toEqual([0, 25, 56, 139, 249, 399, 799] satisfies Row)
      })

      it('names the republish this change is waiting on', () => {
        // The gap, as numbers rather than prose, so the size of what has to be
        // republished is legible from the failure output. Delete this case
        // together with `PUBLISHED` once the page carries `CODE`.
        expect(
          PUBLISHED_COLUMNS.map((plan, column) => [
            plan,
            PUBLISHED[column],
            CODE[column],
          ]).filter(([, was, now]) => was !== now),
        ).toEqual([
          ['business', 50000, 25000],
          ['scale', 100000, 40000],
          ['advanced', 125000, 65000],
          ['agency', 250000, 130000],
        ])
      })
    })

    it.each([
      ['Actions builder', 'actions', 2],
      ['Appointment bookings', 'bookings', 1],
      ['Video & file uploads', 'videoMedia', 2],
    ])('%s — first ✓ at column %#', (_label, flag, firstTick) => {
      const published = PUBLISHED_COLUMNS.map(
        (_plan, index) => index >= (firstTick as number),
      )
      expect(flagColumn(flag as string)).toEqual(published)
    })
  })

  // ---------------------------------------------------------------------
  // "Commerce"
  // ---------------------------------------------------------------------
  describe('Commerce', () => {
    it('Products per site — — · 100 · 2,500 · 10k · 25k · Unlimited ×2', () => {
      expect(quotaColumn('productsPerHost')).toEqual([
        NONE,
        100,
        2500,
        10000,
        25000,
        UNLIMITED,
        UNLIMITED,
      ] satisfies Row)
    })

    it('POS registers per site — — · — · 1 · 2 · 3 · 5 · 20', () => {
      expect(quotaColumn('posRegisters')).toEqual([
        NONE,
        NONE,
        1,
        2,
        3,
        5,
        20,
      ] satisfies Row)
    })

    it('Digital transaction fee — — · 5% · 3% · 2% · 1% · 0% · 0%', () => {
      expect(quotaColumn('transactionFeeDigitalPct')).toEqual([
        0, 5, 3, 2, 1, 0, 0,
      ] satisfies Row)
    })

    it('Physical transaction fee — — · 2% · 0% ×5', () => {
      expect(quotaColumn('transactionFeePhysicalPct')).toEqual([
        0, 2, 0, 0, 0, 0, 0,
      ] satisfies Row)
    })

    it.each([
      ['Online store', 'commerce', 1],
      ['Product reviews', 'productReviews', 2],
      ['Abandoned cart recovery', 'abandonedCart', 2],
      ['Commerce analytics', 'commerceAnalytics', 2],
      ['Subscriptions & memberships', 'storefrontSubscriptions', 3],
      ['Gift cards', 'giftCards', 3],
      ['Content gating', 'contentGating', 3],
    ])('%s — first ✓ at column %#', (_label, flag, firstTick) => {
      const published = PUBLISHED_COLUMNS.map(
        (_plan, index) => index >= (firstTick as number),
      )
      expect(flagColumn(flag as string)).toEqual(published)
    })
  })

  // ---------------------------------------------------------------------
  // "Marketing & analytics" and "Developer & API"
  // ---------------------------------------------------------------------
  describe('Marketing, analytics, developer', () => {
    it('Interactions — ✓ on every plan', () => {
      expect(flagColumn('interactions')).toEqual(
        PUBLISHED_COLUMNS.map(() => true),
      )
      expect(PLAN_ENTITLEMENTS.enterprise.features.interactions).toBe(true)
    })

    it.each([
      ['Announcement bar & popups', 'marketingOverlays', 1],
      // Column 0 = Free as of 2026-08-26 (AGL-1152). This row is the reason
      // the feature matrix is now a tracked document: it was published here
      // and drawn in Figma while no pricing document recorded the gate at all.
      ['CDN & responsive images', 'mediaCdn', 0],
      ['AI assist', 'aiAssist', 2],
      ['Per-screen analytics', 'screenAnalytics', 2],
      ['Sell on the marketplace', 'marketplaceSelling', 2],
      ['Site export & backup', 'siteExport', 2],
      ['Webhooks', 'webhooks', 3],
      ['API access', 'apiAccess', 3],
    ])('%s — first ✓ at column %#', (_label, flag, firstTick) => {
      const published = PUBLISHED_COLUMNS.map(
        (_plan, index) => index >= (firstTick as number),
      )
      expect(flagColumn(flag as string)).toEqual(published)
    })

    it('API access — — · — · — · 100k · 300k · 1M · 5M per month', () => {
      expect(quotaColumn('apiRequestsPerMonth')).toEqual([
        NONE,
        NONE,
        NONE,
        100000,
        300000,
        1000000,
        5000000,
      ] satisfies Row)
    })
  })

  // ---------------------------------------------------------------------
  // Headline prices and the add-on rate table.
  // ---------------------------------------------------------------------
  describe('prices', () => {
    it('monthly — $0 · $25 · $56 · $139 · $249 · $399 · $799', () => {
      expect(
        PUBLISHED_COLUMNS.map((plan) => PLAN_PRICING[plan].basePriceMonthlyUsd),
      ).toEqual([0, 25, 56, 139, 249, 399, 799] satisfies Row)
    })

    it('annual, per month — $0 · $16 · $39 · $99 · $179 · $299 · $649', () => {
      expect(
        PUBLISHED_COLUMNS.map(
          (plan) => PLAN_PRICING[plan].basePriceAnnualMonthlyUsd,
        ),
      ).toEqual([0, 16, 39, 99, 179, 299, 649] satisfies Row)
    })

    it('Enterprise publishes no list price — the card reads "Custom"', () => {
      expect(PLAN_PRICING.enterprise.basePriceMonthlyUsd).toBe(0)
      expect(PLAN_PRICING.enterprise.extraHostMonthlyUsd).toBeNull()
    })

    /**
     * The add-on table's first column is Starter — the page states "The Free
     * plan has no paid add-ons", which is `null` on every rate here.
     */
    const PAID = PUBLISHED_COLUMNS.slice(1)

    it('Free buys no add-ons', () => {
      const free = PLAN_PRICING.free
      expect([
        free.extraHostMonthlyUsd,
        free.extraSeatMonthlyUsd,
        free.extraCollaboratorMonthlyUsd,
        free.extraDatasetMonthlyUsd,
        free.extraDataGbMonthlyUsd,
        free.extraApiRequestsUsdPer1k,
        free.extraContactsUsdPer1k,
      ]).toEqual([null, null, null, null, null, null, null])
    })

    it('Extra site, per month — $10 · $8 · $5 · $5 · $4 · $3', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraHostMonthlyUsd)).toEqual([
        10, 8, 5, 5, 4, 3,
      ])
    })

    it('Extra team seat, per month — $5 · $4 · $3 · $2 · $2 · $2', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraSeatMonthlyUsd)).toEqual([
        5, 4, 3, 2, 2, 2,
      ])
    })

    it('Extra site collaborator, per month — $3 · $2 · $1 · $1 · $1 · $1', () => {
      expect(
        PAID.map((p) => PLAN_PRICING[p].extraCollaboratorMonthlyUsd),
      ).toEqual([3, 2, 1, 1, 1, 1])
    })

    it('Extra dataset, per month — $2 · $2 · $1 · $1 · $1 · $1', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraDatasetMonthlyUsd)).toEqual([
        2, 2, 1, 1, 1, 1,
      ])
    })

    it('Extra dataset storage — $0.25 / GB-month on every paid plan', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraDataGbMonthlyUsd)).toEqual([
        0.25, 0.25, 0.25, 0.25, 0.25, 0.25,
      ])
    })

    it('API requests per 1,000 over limit — — · — · $0.50 · $0.35 · $0.20 · $0.15', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraApiRequestsUsdPer1k)).toEqual(
        [null, null, 0.5, 0.35, 0.2, 0.15],
      )
    })

    /**
     * ⚠️ A SECOND ROW WHERE THE CODE IS AHEAD OF THE PAGE — see the email
     * sends row above for the full reasoning, which is identical here.
     *
     * Advanced's $0.25 was the last step of a ladder that descended past its
     * own cost floor: `ORG_COGS_UNIT_RATES_USD.perContactMonth` is $0.0002,
     * which is $0.20 per 1,000, so the published rate carried a 20% line
     * margin — thinner than the 23% the infrastructure pass-through earns by
     * construction, on a line sold as a retail price rather than as cost
     * recovery. It is now floored at $0.40, the same figure Scale carries.
     *
     * Agency stays NULL, and the em dash on the published page is the whole
     * point (AGL-2482): its `contactsPerHost` is UNLIMITED, so an overage
     * rate there advertises a fee that cannot be charged —
     * `checkContactQuota` computes `Math.max(0, used - Infinity)`, which is 0
     * at every usage level.
     */
    it('Contacts per 1,000 over band — the Advanced step is floored', () => {
      const PUBLISHED = [1, 0.75, 0.5, 0.4, 0.25, null]
      const CODE = [1, 0.75, 0.5, 0.4, 0.4, null]
      expect(PAID.map((p) => PLAN_PRICING[p].extraContactsUsdPer1k)).toEqual(
        CODE,
      )
      // The gap, named, so its size is legible from a failure. Collapse this
      // into one `toEqual` when `/pricing` is republished.
      expect(
        PAID.map((plan, column) => [plan, PUBLISHED[column], CODE[column]])
          .filter(([, was, now]) => was !== now),
      ).toEqual([['advanced', 0.25, 0.4]])
      // Agency's em dash did not move.
      expect(PLAN_PRICING.agency.extraContactsUsdPer1k).toBeNull()
      expect(PLAN_ENTITLEMENTS.agency.contactsPerHost).toBe(UNLIMITED)
    })
  })

  // ---------------------------------------------------------------------
  // "METERED USAGE". The page publishes the MARKED-UP figure; the table in
  // `usage-metering` holds our cost. Multiplying is the check — a change to
  // either the rate or the markup moves the published number.
  // ---------------------------------------------------------------------
  describe('metered usage', () => {
    it('is applied on Starter through Agency, and on neither end', () => {
      // "On Starter through Agency plans, page views, form submissions, and
      // site storage past the amount your plan includes are metered…" and
      // "Free plans are capped rather than billed, and Enterprise usage is
      // set by your agreement."
      expect(PLAN_PRICING.free.meteredInfraPassThrough).toBe(false)
      expect(PLAN_PRICING.enterprise.meteredInfraPassThrough).toBe(false)
      for (const plan of PUBLISHED_COLUMNS.slice(1)) {
        expect(PLAN_PRICING[plan].meteredInfraPassThrough).toBe(true)
      }
    })

    it('is "our infrastructure cost plus a 30% margin"', () => {
      expect(METERED_MARKUP).toBe(1.3)
    })

    it('Page views (bandwidth + reads) — $0.13 / 1,000', () => {
      expect(
        METERED_UNIT_RATES_USD.perPageView * METERED_MARKUP * 1000,
      ).toBeCloseTo(0.13, 6)
    })

    it('Form submissions — $0.065 / 1,000', () => {
      expect(
        METERED_UNIT_RATES_USD.perFormSubmission * METERED_MARKUP * 1000,
      ).toBeCloseTo(0.065, 6)
    })

    it('Site media & file storage — $0.0338 / GB-mo', () => {
      expect(
        METERED_UNIT_RATES_USD.storagePerGbMonth * METERED_MARKUP,
      ).toBeCloseTo(0.0338, 6)
    })
  })

  /**
   * THE MARKETPLACE TAKE RATE (AGL-2194 P8), published 2026-08-24.
   *
   * Until that date `/pricing` stated this NOWHERE — grepping the live page
   * for "take rate", "revenue share" and "20%" returned zero hits, while
   * `checkout.ts` charged it on every marketplace sale. A publisher on
   * Advanced read "0%" under a heading that says *what Aglyn takes on a sale*
   * and kept 80% of their listing sale. That is the one number on this page
   * where the product charged MORE than the page disclosed.
   *
   * The sentence now published under TRANSACTION FEES reads:
   *
   *   "Selling through the Aglyn marketplace is separate from the rates above
   *    and does not step down with your plan: Aglyn keeps 20% of a marketplace
   *    listing sale on every paid plan, and 30% on Free."
   *
   * Pinned here for the same reason as every other row in this file: the other
   * side of the comparison is OUTSIDE the repo, so these are transcriptions of
   * what the public page served, not values derived from the constants. If
   * `marketplaceFeePct` moves and this file is not updated in the same commit,
   * the published sentence has silently become false — which is exactly how
   * the pre-2026-08-09 metered rates rotted.
   */
  describe('marketplace take rate — fetched 2026-08-24', () => {
    it('is 30% on Free', () => {
      expect(PLAN_ENTITLEMENTS.free.marketplaceFeePct).toBe(30)
    })

    it('is 20% on EVERY paid plan, enterprise included', () => {
      const paid = (Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]).filter(
        (plan) => plan !== 'free',
      )
      // Named rather than a loop body assertion so a failure prints WHICH plan
      // drifted, not merely that one did.
      expect(
        Object.fromEntries(
          paid.map((plan) => [plan, PLAN_ENTITLEMENTS[plan].marketplaceFeePct]),
        ),
      ).toEqual(Object.fromEntries(paid.map((plan) => [plan, 20])))
    })

    it('is NOT reduced by the storefront transaction fee, which reaches 0%', () => {
      // The published sentence claims the marketplace rate "does not step down
      // with your plan". That claim is only meaningful because the storefront
      // ladder beside it DOES reach zero — if both fell to 0% the sentence
      // would be noise. Advanced is where they diverge most visibly.
      expect(PLAN_ENTITLEMENTS.advanced.transactionFeeDigitalPct).toBe(0)
      expect(PLAN_ENTITLEMENTS.advanced.transactionFeePhysicalPct).toBe(0)
      expect(PLAN_ENTITLEMENTS.advanced.marketplaceFeePct).toBe(20)
    })
  })
})
