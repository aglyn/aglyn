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
 * numbers below are a TRANSCRIPTION of what the public page serves — first
 * fetched **2026-08-19**, and re-transcribed row by row from the republish of
 * **2026-09-07** (screen `v0clP6xQl-`, version `zj-21jtrPG`) — and their
 * whole job is to be a fixed point that does NOT move when the constants do.
 * Deriving them from `PLAN_ENTITLEMENTS` would make the file assert `x === x`
 * and prove nothing at all.
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
 * bug in the code, never a license to edit this fixture.
 *
 * ## What is deliberately NOT pinned here
 *
 * Enterprise cells. Every one of them reads "Talk to us" / "Custom" on the
 * page, which is a statement that no number is published — pinning
 * `UNLIMITED` against it would be inventing a published claim in order to
 * check it. Enterprise capacity is contractual (`isCustomPricedPlan`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
        'formSubmissionsPerMonth',
        'contactsPerHost',
        'crmEmailsPerDay',
        'emailSendsPerMonth',
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
        'crm',
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

    /**
     * THE PAGE CAUGHT UP ON 2026-09-07. Until that republish the code was
     * ahead of the page on both rows, in the same way and for the same reason
     * as the campaign email row below.
     *
     * `storagePerHostMb` and `bandwidthGb` are per-tier bands whose cost was
     * never multiplied against the tier's price. Bandwidth is the largest
     * single line item on every plan above Pro — a GB of it costs $0.167 of
     * measured cost, `ESTIMATED_PAGE_TRANSFER_BYTES` divided into a gigabyte
     * and priced at `perPageView` — so Agency's 20 TB alone was $3,495/month
     * against a $799 subscription at the $0.175 a GB then in force.
     * `tier-margin-floor.spec.ts` carries the model and the resulting figures.
     */
    it('Storage per site — 250 MB · 2 · 10 · 20 · 30 · 40 · 60 GB', () => {
      const PUBLISHED: Row = [250, 2048, 10240, 20480, 30720, 40960, 61440]
      expect(quotaColumn('storagePerHostMb')).toEqual(PUBLISHED)
    })

    /**
     * RE-TRANSCRIBED 2026-09-07 from the republish that carried the resized
     * bands (screen `v0clP6xQl-`, version `5PkGJBlRra`): the cells read
     * "2 GB · 50 GB · 125 GB · 185 GB · 290 GB · 345 GB · 1.54 TB", and the
     * Scale room-to-grow strip reads "290 GB bandwidth". Terabytes are
     * decimal and shown to the gigabyte — 1,540 GB is "1.54 TB", not the
     * "1.5 TB" of a band 40 GB smaller.
     *
     * Free's is the one band on that tier that can never be metered — there
     * is no subscription to bill an overage onto, so it is a pure give at
     * $0.167 a GB. Every paid band was resized on 2026-09-07 to hold the
     * platform's invariant at the ANNUAL price, net of Stripe's fee, with
     * the CRM seat and one-to-one email terms counted: at 225 · 400 · 700 ·
     * 1,000 · 3,000 GB every tier from Pro up runs 21–40% under water at that
     * price with every band at 100% (`tier-margin-floor.spec.ts` carries the
     * model and the mutation that proves it).
     */
    it('Bandwidth / mo — 2 · 50 · 125 · 185 · 290 · 345 GB · 1.54 TB', () => {
      const PUBLISHED: Row = [2, 50, 125, 185, 290, 345, 1540]
      expect(quotaColumn('bandwidthGb')).toEqual(PUBLISHED)
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

    /**
     * Agency's cell changed KIND when the code bounded it — "Unlimited"
     * became a number — and since 2026-09-07 the page carries the number,
     * under a row relabeled "per site".
     *
     * This band is per HOST and `meteredIncludedAllowance` expands it by
     * `hostLimit`, so at Agency's 100 hosts an unbounded figure was not
     * merely large — it made the tier's whole cost model unbounded, and an
     * unbounded term reads as ZERO in any analysis that scores an absent band
     * as nothing. It was the biggest thing nobody was counting.
     *
     * Bounding it is safe because Agency METERS: `meteredInfraPassThrough` is
     * true, so submissions past the band bill at the pass-through rate rather
     * than being refused, and a merchant's lead form does not stop working at
     * 25,000.
     */
    it('Form submissions / mo, per site — 20 · 200 · 1k · 8k · 25k · 40k · 25k', () => {
      const PUBLISHED: Row = [20, 200, 1000, 8000, 25000, 40000, 25000]
      expect(quotaColumn('formSubmissionsPerMonth')).toEqual(PUBLISHED)
      // Every self-serve cell is a finite number, which is the property the
      // cost model needs; only Enterprise's "Talk to us" is unbounded.
      for (const value of PUBLISHED) expect(Number.isFinite(value)).toBe(true)
      // Metered, so the bound bills rather than refuses.
      expect(PLAN_PRICING.agency.meteredInfraPassThrough).toBe(true)
    })

    /**
     * The row the page called "Contacts included" until 2026-09-07 and now
     * calls "CRM records included (contacts, companies & deals)". The band
     * kept its `contactsPerHost` key and its numbers and counts three
     * collections — the 2026-09-05 decision, AGL-2611 — and the republish
     * brought the page onto the code's figures.
     *
     * Contacts are priced at `perContactMonth` of $0.0002, so the included
     * audience alone cost $20 at Business, $100 at Scale and $200 at Advanced
     * — 14%, 40% and 50% of the subscription — from the one term nobody
     * counted, because an audience is not infrastructure. On Agency it was
     * `UNLIMITED`, which made the tier's cost model unbounded on a second
     * axis after form submissions were closed.
     *
     * Bounding Agency's band required moving `extraContactsUsdPer1k` off
     * `null` in the same change, and the two are pinned together in the
     * `prices` block below. That rate is what makes the bound METER rather
     * than wall: without it `checkCrmRecordsQuota` refuses past the band.
     */
    it('CRM records included — 100 · 1k · 10k · 50k · 100k · 150k · 500k', () => {
      const PUBLISHED: Row = [100, 1000, 10000, 50000, 100000, 150000, 500000]
      expect(quotaColumn('contactsPerHost')).toEqual(PUBLISHED)
      // Every self-serve cell is finite, which is the property the cost model
      // needs; only Enterprise's "Talk to us" is unbounded.
      for (const value of PUBLISHED) expect(Number.isFinite(value)).toBe(true)
    })

    /**
     * TWO ROWS THE PAGE GAINED ON 2026-09-07, with the CRM launch.
     *
     * The suite — leads, companies, deals and tasks — is included from
     * Starter rather than Pro: the field prices a CRM seat at $14–25 a month,
     * so Starter with the suite included is the competitive entry, and gating
     * a tier higher hands the small-business buyer to a free CRM elsewhere.
     * Free keeps the Contacts section, which is the capture projection its
     * email audiences read, and sees the rest locked. The Starter card sells
     * this where it used to sell 500 campaign emails.
     *
     * One-to-one email is a hard daily pace per organization with no overage
     * rate on any tier — `checkCrmEmailQuota` refuses the send past it — set
     * at the count where every plan holds an 80% CRM-axis margin at its
     * annual price with the whole day spent (`tier-margin-floor.spec.ts`),
     * not at a usability figure.
     */
    it('CRM suite: leads, companies, deals & tasks — ✓ from Starter', () => {
      expect(flagColumn('crm')).toEqual([
        false,
        true,
        true,
        true,
        true,
        true,
        true,
      ] satisfies TickRow)
      expect(PLAN_ENTITLEMENTS.enterprise.features.crm).toBe(true)
    })

    it('One-to-one emails / day — — · 50 · 150 · 200 · 300 · 500 · 1,000', () => {
      expect(quotaColumn('crmEmailsPerDay')).toEqual([
        NONE,
        50,
        150,
        200,
        300,
        500,
        1000,
      ] satisfies Row)
      // Free's dash is a refusal at zero, not an absent row: a per-org
      // `features.crm` grant does not send until this is raised beside it.
      expect(PLAN_ENTITLEMENTS.free.crmEmailsPerDay).toBe(0)
    })

    /**
     * THE PAGE CAUGHT UP ON 2026-09-07. The row now reads "Campaign emails
     * / mo" and carries the code's bands, and the plan cards and room-to-grow
     * strips quote the same figures — Business "25,000 campaign emails/mo",
     * Scale "40,000", Advanced "65,000", Agency "130,000", Enterprise
     * "campaign email volume by agreement". Until that republish this was the
     * one row where the two sides were pinned apart on purpose, with the gap
     * named, because a transcription is only worth anything if it was
     * transcribed.
     *
     * The code had moved beneath the old page in two separate steps.
     *
     * Email sending is priced: our cost is $0.90 per 1,000 delivered
     * messages, and against the old bands that ran 28-36% of the subscription
     * at Business and above. The included bands came down to land every
     * changed tier near 15%, and an overage rate went on beside them.
     *
     * Then campaign email moved UP to Pro. A site that may send campaigns
     * needs its own verified provider sending domain, and provisioning one is
     * a per-site operational cost; holding the allowance at 0 on Starter
     * keeps that cost attached to the tiers that carry it. Starter's column
     * therefore reads as a dash, exactly like Free's.
     *
     * No CHARGED price moved in either step — Starter $25, Business $139,
     * Scale $249, Advanced $399 and Agency $799 were untouched, which is what
     * kept both inside the Sept 1 freeze.
     */
    describe('Campaign emails / mo — the page carries the code\'s bands', () => {
      /** What the page says, per column, and what the code bills against. */
      const PUBLISHED = [NONE, NONE, 5000, 25000, 40000, 65000, 130000] satisfies Row

      it('— · — · 5,000 · 25,000 · 40,000 · 65,000 · 130,000', () => {
        expect(quotaColumn('emailSendsPerMonth')).toEqual(PUBLISHED)
      })

      it('Starter is a dash, not a smaller number', () => {
        // A reduced band still sells the feature; zero is the feature not
        // being sold, and `reserveCampaignEmailSends` refuses every campaign
        // against it. Pro is where campaign email starts: its email COGS was
        // 8% of its price, which is the band the reduction was aiming at.
        expect(PUBLISHED[1]).toBe(0)
        for (let column = 2; column < PUBLISHED.length; column += 1) {
          expect(`col${column}: ${PUBLISHED[column] > 0}`).toBe(
            `col${column}: true`,
          )
        }
      })

      it('no CHARGED price moved with the email change itself', () => {
        // The allowance reduction is separable from the price move that came
        // after it: the six tiers whose email band this row is about are all
        // still at their published price, and Agency's rise is a different
        // change with its own reasoning, pinned in the `prices` block below.
        expect(
          PUBLISHED_COLUMNS.filter((plan) => plan !== 'agency').map(
            (plan) => PLAN_PRICING[plan].basePriceMonthlyUsd,
          ),
        ).toEqual([0, 25, 56, 139, 249, 399])
      })
    })

    /**
     * A ROW THE PAGE DOES NOT CARRY AT ALL.
     *
     * Sending identity was not a published axis when `/pricing` was drawn, so
     * there is no cell here to be ahead of — the whole row is new. It is
     * pinned anyway, and for the same reason the email bands are: the gap
     * between what the code sells and what the page says has to be visible as
     * data, or the republish it is waiting on is remembered by nobody.
     *
     * Delete this block, and the `EXPECTED_MISSING` entry in
     * `tools/marketing/build-pricing-tables.mts`, once the four responsive
     * frames carry the row.
     */
    describe('Send email from your own domain — a row the page has never had', () => {
      it('starts at Pro, and Free and Starter do not carry it', () => {
        expect(flagColumn('customSendingDomain')).toEqual([
          false,
          false,
          true,
          true,
          true,
          true,
          true,
        ])
      })

      it('is a strictly wider grant than white-label, which has not moved', () => {
        // The point of the carve-out. `whiteLabel` replaces the Aglyn brand
        // everywhere and is still Agency-and-above; if this assertion ever
        // fails, the sending gate was widened by widening the brand gate,
        // which hands Pro a set of unrelated Agency features.
        expect(flagColumn('whiteLabel')).toEqual([
          false,
          false,
          false,
          false,
          false,
          false,
          true,
        ])
      })

      it('no CHARGED price moved with it', () => {
        // Adding an inclusion is not a repricing. Agency's figure is the one
        // that moved, in its own change, and is pinned in the `prices` block.
        expect(
          PUBLISHED_COLUMNS.filter((plan) => plan !== 'agency').map(
            (plan) => PLAN_PRICING[plan].basePriceMonthlyUsd,
          ),
        ).toEqual([0, 25, 56, 139, 249, 399])
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
    /**
     * ONE CHARGED PRICE MOVED, AND THE PAGE HAS CAUGHT UP.
     *
     * This is the row the header's freeze warning is about, so it is worth
     * being exact: Agency $799 -> $1,299 monthly and $649 -> $1,055 annual.
     * Six of the seven columns are untouched.
     *
     * Agency included 100 hosts, 20 TB of bandwidth and an UNBOUNDED
     * form-submission band against $799. It was simultaneously the worst
     * margin on the ladder and the most underpriced against the field: Duda
     * charges ~$1,396-1,493/mo for 100 sites, BigCommerce Enterprise starts
     * at $1,499, Shopify Plus at $2,300. $1,299 still undercuts all three.
     *
     * STRIPE CHARGES THIS. `aglyn_agency_v2` is $1,299/month and
     * `_yearly` is $12,588 — new price objects, since a Stripe price is
     * immutable and the $799 pair is archived. `STRIPE_PRICE_AGENCY` and
     * `STRIPE_PRICE_AGENCY_YEARLY` name the new ids.
     *
     * The page was republished on 2026-08-31 and now quotes $1,299 monthly and
     * $1,049 annual. It trailed the charge for a while, which is the more
     * urgent direction of the two — a page quoting less than checkout takes
     * is a price a customer can point at.
     *
     * Getting it there needed an UNPUBLISH and republish, not a save: an
     * in-place edit to an already-published version never moves the version
     * pointer, and only a pointer move busts the `tenant-data:{hostId}`
     * document cache the render reads through. A saved edit therefore
     * regenerates the page on schedule and re-reads the same cached document
     * forever.
     *
     * The SEO description is a SEVENTH surface and it quoted the price too —
     * `<meta name="description">`, `og:` and `twitter:` all carried "$0 to
     * $799/mo" while the body was already correct. Nothing in CI can see it.
     * `docs/PRICING_SURFACES.md` lists them all.
     */
    it('monthly — the page and the code agree on every column', () => {
      // PUBLISHED is transcribed BY HAND from the live page and is the whole
      // value of this case: nothing in CI can read that page, so a divergence
      // is only ever visible as a difference between these two rows.
      const PUBLISHED: Row = [0, 25, 56, 139, 249, 399, 1299]
      const CODE: Row = [0, 25, 56, 139, 249, 399, 1299]
      expect(
        PUBLISHED_COLUMNS.map((plan) => PLAN_PRICING[plan].basePriceMonthlyUsd),
      ).toEqual(CODE)
      expect(
        PUBLISHED_COLUMNS.map((plan, column) => [plan, PUBLISHED[column], CODE[column]])
          .filter(([, was, now]) => was !== now),
      ).toEqual([])
    })

    it('annual, per month — the page and the code agree there too', () => {
      const PUBLISHED: Row = [0, 16, 39, 99, 179, 299, 1049]
      const CODE: Row = [0, 16, 39, 99, 179, 299, 1049]
      expect(
        PUBLISHED_COLUMNS.map(
          (plan) => PLAN_PRICING[plan].basePriceAnnualMonthlyUsd,
        ),
      ).toEqual(CODE)
      expect(
        PUBLISHED_COLUMNS.map((plan, column) => [plan, PUBLISHED[column], CODE[column]])
          .filter(([, was, now]) => was !== now),
      ).toEqual([])
      // $1,049/mo is $12,588 a year, which is what the live Stripe yearly
      // price charges — the constant every surface quotes has to be the one
      // Stripe bills, and Stripe prices are immutable. It lands within a
      // dollar of holding the previous 18.8% discount across the rise, which
      // is what stops the annual interval becoming the cheap way past a
      // repricing.
      expect(1049 * 12).toBe(12_588)
      expect(1 - 1049 / 1299).toBeCloseTo(1 - 649 / 799, 2)
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

    /**
     * Flat $8 from Scale up, not a ladder that keeps descending. Storage and
     * form submissions are per-HOST bands, so an extra host adds that tier's
     * bands to the org's included allowance — under a descending ladder the
     * tiers granting the most per host charged the least for one. Business
     * stays $5 because it grants the smallest bands of the four; Starter $10
     * and Pro $8 sit above it as they always did.
     */
    it('Extra site, per month — $10 · $8 · $5 · $8 · $8 · $8', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraHostMonthlyUsd)).toEqual([
        10, 8, 5, 8, 8, 8,
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

    /**
     * $0.36 is the 50% retail floor against a `dataStoragePerGbMonth` cost
     * of $0.18 — the rate `checkDataStorageQuota` bills and the figure the
     * page carries. $0.25 was a 28% line margin, close enough to the
     * infrastructure pass-through's 23% that a retail add-on and a cost
     * pass-through looked like the same kind of number while being sold as
     * opposites.
     *
     * ⛔ This is the DATASET add-on line, not the metered storage
     * pass-through: `/pricing` carries two per-GB-month figures and the other
     * one, $0.0338, is correct and must not be touched.
     */
    it('Extra dataset storage, per GB-month — $0.36 on every paid plan', () => {
      const PUBLISHED = [0.36, 0.36, 0.36, 0.36, 0.36, 0.36]
      expect(PAID.map((p) => PLAN_PRICING[p].extraDataGbMonthlyUsd)).toEqual(
        PUBLISHED,
      )
      // Both halves of the reason, so a future editor cannot restore $0.25
      // without seeing what it costs.
      expect((0.25 - 0.18) / 0.25).toBeLessThan(0.5)
      expect((0.36 - 0.18) / 0.36).toBeGreaterThanOrEqual(0.5)
    })

    it('API requests per 1,000 over limit — — · — · $0.50 · $0.35 · $0.20 · $0.15', () => {
      expect(PAID.map((p) => PLAN_PRICING[p].extraApiRequestsUsdPer1k)).toEqual(
        [null, null, 0.5, 0.35, 0.2, 0.15],
      )
    })

    /**
     * THE PAGE CAUGHT UP ON 2026-09-07. The row now reads "CRM records, per
     * 1,000 over the included band", Advanced carries $0.40 and Agency's em
     * dash has become a rate.
     *
     * Advanced's $0.25 was the last step of a ladder that descended past its
     * own cost floor: `ORG_COGS_UNIT_RATES_USD.perContactMonth` is $0.0002,
     * which is $0.20 per 1,000, so the old rate carried a 20% line margin —
     * thinner than the 23% the infrastructure pass-through earns by
     * construction, on a line sold as a retail price rather than as cost
     * recovery. It is floored at $0.40, the same figure Scale carries.
     *
     * Agency's em dash was right while its `contactsPerHost` was UNLIMITED
     * (AGL-2482): an overage rate there advertised a fee that could not be
     * charged — `Math.max(0, used - Infinity)` is 0 at every usage level.
     * The band is finite now, so the rate is real.
     */
    it('CRM records per 1,000 over band — $1 · $0.75 · $0.50 · $0.40 · $0.40 · $0.40', () => {
      const PUBLISHED = [1, 0.75, 0.5, 0.4, 0.4, 0.4]
      expect(PAID.map((p) => PLAN_PRICING[p].extraContactsUsdPer1k)).toEqual(
        PUBLISHED,
      )
      /*
       * Agency's rate is the second half of bounding its band rather than a
       * separate decision.
       *
       * This row has been wrong in both directions. It shipped $0.20 against
       * an `UNLIMITED` band — a fee that could not be charged, since
       * `Math.max(0, used - Infinity)` is 0 at every usage level (AGL-2439) —
       * and was corrected to `null`. A finite band with a null rate is the
       * mirror image: usage past a bound that is silently free, so the bound
       * achieves nothing. The pair is only ever correct together.
       */
      expect(Number.isFinite(PLAN_ENTITLEMENTS.agency.contactsPerHost)).toBe(true)
      expect(PLAN_PRICING.agency.extraContactsUsdPer1k).toBe(0.4)
      // Enterprise publishes no rate and, since 2026-09-07, no unbounded band
      // either: its row is a finite fallback of twice Agency's that a
      // contract raises, and the page still reads "Talk to us" for it.
      expect(PLAN_ENTITLEMENTS.enterprise.contactsPerHost).toBe(1_000_000)
      expect(PLAN_PRICING.enterprise.extraContactsUsdPer1k).toBeNull()
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

    it('Page views (bandwidth + reads) — $0.21 / 1,000', () => {
      expect(
        METERED_UNIT_RATES_USD.perPageView * METERED_MARKUP * 1000,
      ).toBeCloseTo(0.21, 6)
    })

    /**
     * THE PAGE, THE CODE AND THE MEASUREMENT NOW AGREE (AGL-2711).
     *
     * This row spent weeks as the one divergence in this file that was not
     * between `/pricing` and the code. Both said $0.13 per 1,000, and the
     * thing they disagreed with was the physical page a customer's visitor
     * downloads: `perPageView` is a COST, calibrated once against a 627 KB
     * cold load, while the published page measured over a thousand. The meter
     * ran at roughly -19% margin against its own published claim.
     *
     * The standing decision was to reduce the weight rather than reprice the
     * promise. That reduction landed and shipped, the page was re-measured at
     * 976.1 KB on 2026-09-09, and it is still far above 627 KB — so the
     * re-peg the reduction was meant to avoid became the honest move, and the
     * rate went to $0.00016153846, a published $0.21 per 1,000.
     *
     * What this case asserts is the INVERSION, not the arithmetic. The rate is
     * now priced for MORE page than the page weighs, deliberately: charging
     * under cost can only be corrected by charging more, and the headroom is
     * what keeps the next correction pointed downward. A page that grows back
     * past its basis fails here, and that failure is the whole point of the
     * row.
     *
     * `tools/tenant-page-budget.json` holds the measurement and
     * `npm run check:page-view-rate` holds the peg; this asserts the two
     * agree, so the record cannot drift from the rate it describes.
     */
    it('the $0.21 is priced for a 1012.8 KB page that measures 976.1 KB', () => {
      const { wireCalibration } = JSON.parse(
        readFileSync(
          join(__dirname, '..', '..', '..', 'tools', 'tenant-page-budget.json'),
          'utf8',
        ),
      )
      expect(wireCalibration.pricedForKb).toBe(1012.8)
      expect(wireCalibration.measuredKb).toBe(976.1)
      // The rate on the page is the one the recorded basis implies, at the
      // per-KB cost the 2026-08-09 calibration fixed and this re-peg did not
      // move. Six places, because the rate is pinned to a round PRICE rather
      // than to a round cost and the two part company below that.
      expect(METERED_UNIT_RATES_USD.perPageView).toBeCloseTo(
        (0.0001 * wireCalibration.pricedForKb) / 627,
        6,
      )
      // The basis covers the page rather than falling short of it. This is the
      // assertion that inverted: it read `toBeGreaterThan(rate * 1.5)` while
      // the meter was under-priced.
      const impliedByMeasured = (0.0001 * wireCalibration.measuredKb) / 627
      expect(impliedByMeasured).toBeLessThan(
        METERED_UNIT_RATES_USD.perPageView,
      )
      // …and not by so much that we are quietly charging well over cost. The
      // headroom is a rounding of the price, not a margin.
      expect(impliedByMeasured).toBeGreaterThan(
        METERED_UNIT_RATES_USD.perPageView * 0.95,
      )
      // Rounded the way a published figure is: the basis lands on $0.21 per
      // 1,000, which is what the page states.
      expect(
        Math.round(
          ((0.0001 * wireCalibration.pricedForKb) / 627) *
            METERED_MARKUP *
            1000 *
            100,
        ) / 100,
      ).toBe(0.21)
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
