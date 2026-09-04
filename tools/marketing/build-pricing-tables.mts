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
 * Builds the `/pricing` compare + usage tables FROM THE CODE (AGL-1278), and
 * reconciles them against the Figma extraction so any disagreement is a
 * reported fact rather than a silent choice.
 *
 * Why generate rather than transcribe: the compare table is 8 plans wide and
 * ~50 rows deep — 400 cells. Hand-copying 400 numbers off a frame onto a
 * public pricing page is a guaranteed-defect process, and Figma has already
 * been caught drifting from `plan-entitlements.ts` twice. So the frame
 * supplies the SHAPE (which rows, in which groups, in which order) and the
 * code supplies every VALUE.
 *
 * The reconciliation is the point. Where the frame and the code disagree the
 * code wins, but the disagreement is printed — a silent overwrite would hide
 * exactly the drift this is meant to catch, in either direction.
 *
 *   SWC_NODE_PROJECT=tools/marketing/tsconfig.tables.json \
 *     node --import @swc-node/register/esm-register \
 *     tools/marketing/build-pricing-tables.mts
 */

import { writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  PLAN_LABELS,
  UNLIMITED,
  EVENT_CALENDAR_ADDON_MONTHLY_USD,
  POS_REGISTER_ADDON_MONTHLY_USD,
  POS_REGISTERS_ADDON_MAX,
  ORG_COGS_UNIT_RATES_USD,
  METERED_MARKUP,
} from '../../libs/aglyn/src/lib/app-utils/plan-entitlements.ts'
import {
  onboardingSignupHref,
  type OnboardingInterval,
} from '../../libs/aglyn/src/lib/app-utils/onboarding-deep-link.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'pricing-copy')

type Plan = keyof typeof PLAN_ENTITLEMENTS
const PLANS = Object.keys(PLAN_ENTITLEMENTS) as Plan[]
const PAID: Plan[] = ['starter', 'pro', 'business', 'scale', 'advanced', 'agency']

// ---------------------------------------------------------------- format

const YES = '✓'
const NO = '—'

const num = (v: number): string =>
  v === UNLIMITED ? 'Unlimited' : v === 0 ? NO : v.toLocaleString('en-US')

const bool = (v: boolean): string => (v ? YES : NO)

/**
 * Storage in megabytes. BINARY promotion (1 GB = 1024 MB): the code's values
 * are chosen to land on round binary figures — 2048 → "2 GB", 38400 → "37.5
 * GB" — and the frame agrees. Deliberately does NOT promote to TB; nothing
 * here exceeds 200 GB, so a TB branch would be untested code that could only
 * ever be wrong.
 */
const mb = (v: number): string => {
  if (v === UNLIMITED) return 'Unlimited'
  if (v === 0) return NO
  if (v < 1024) return `${v} MB`
  const asGb = v / 1024
  return `${Number.isInteger(asGb) ? asGb : asGb.toFixed(1)} GB`
}

/**
 * Bandwidth in gigabytes. DECIMAL promotion (1 TB = 1000 GB) — note this
 * differs from `mb` above, and the difference is real, not an oversight. The
 * code's bandwidth values are 1000 / 2500 / 5000 / 20000, which are round
 * only in decimal; dividing by 1024 renders them "1000 GB", "2.4 TB", "4.9
 * TB", "19.5 TB". The reconciliation against the frame is what caught this —
 * all four rows disagreed, and the frame was right.
 */
const gb = (v: number): string => {
  if (v === UNLIMITED) return 'Unlimited'
  if (v === 0) return NO
  if (v < 1000) return `${v} GB`
  const tb = v / 1000
  return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`
}

const pct = (v: number): string => `${v}%`

/**
 * "5 · max 20" — an included allowance with a hard ceiling above it. When the
 * two are equal there is no headroom to describe, so the ceiling is dropped:
 * Free's "1 · max 1" says nothing "1" does not.
 */
const band = (included: number, max: number): string => {
  if (included === UNLIMITED) return 'Unlimited'
  if (included === 0 && max === 0) return NO
  if (max === UNLIMITED) return `${num(included)} · unlimited`
  if (included === max) return included.toLocaleString('en-US')
  return `${included.toLocaleString('en-US')} · max ${max.toLocaleString('en-US')}`
}

/** Requests per month, rendered the way the frame does: "100k / mo". */
const perMonth = (v: number): string => {
  if (v === UNLIMITED) return 'Unlimited'
  if (v === 0) return NO
  if (v >= 1_000_000) return `${v / 1_000_000}M / mo`
  if (v >= 1_000) return `${v / 1_000}k / mo`
  return `${v} / mo`
}

// ---------------------------------------------------------------- rows

interface Row {
  label: string
  /** The frame's label for this row, when it differs from ours. */
  frameLabel?: string
  value: (p: Plan) => string
  /** Set when the frame carries this row twice; see the duplicate note. */
  duplicateOf?: string
  /**
   * Why this row's value is written here rather than read from
   * `plan-entitlements.ts`. Every row without it MUST derive from the code;
   * the emitted `notes` says so, and `literals` in the output names the
   * exceptions so the claim can be checked rather than believed.
   */
  literal?: string
  /**
   * What Enterprise shows. The code resolves every Enterprise limit to
   * UNLIMITED, but that is the *default* — a real Enterprise contract sets
   * specific numbers through `org.entitlements` overrides. So publishing
   * "Unlimited" on 30 rows would advertise a commitment no contract actually
   * makes, and the frame's "Talk to us" / "Custom" is the more accurate copy
   * as well as the designed one. Booleans and fee percentages are genuinely
   * fixed, so those print their real value.
   */
  enterprise?: 'talk' | 'custom' | null
}

const TALK = 'Talk to us'
const CUSTOM_LABEL = 'Custom'

const E = (p: Plan) => PLAN_ENTITLEMENTS[p]
const F = (p: Plan) => PLAN_ENTITLEMENTS[p].features

/** Enterprise shows "Talk to us" instead of the resolved number. */
const talk =
  (fn: (p: Plan) => string) =>
  (p: Plan): string =>
    p === 'enterprise' ? TALK : fn(p)

/** Enterprise shows "Custom" instead of the resolved allowance band. */
const custom =
  (fn: (p: Plan) => string) =>
  (p: Plan): string =>
    p === 'enterprise' ? CUSTOM_LABEL : fn(p)

const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: 'Sites & publishing',
    rows: [
      { label: 'Sites (hosts)', value: talk((p) => num(E(p).hostLimit)) },
      { label: 'Pages per site', value: talk((p) => num(E(p).screensPerHost)) },
      { label: 'Storage per site', value: talk((p) => mb(E(p).storagePerHostMb)) },
      // 'Total site size' was emitted here from `totalSiteSizeMb` until
      // AGL-2133 retired that entitlement: it was enforced by nothing, and
      // the measurable org total can only reach 2.3-20.9% of it because
      // AGL-678 caps a node map at 900 KB. There is no number left to emit.
      // NOTE: the LIVE /pricing compare table still carries the row — it is
      // click-built, not generated from this file, so removing it there is a
      // separate act and a pricing-surface decision, not a codegen change.
      { label: 'Bandwidth / mo', value: talk((p) => gb(E(p).bandwidthGb)) },
      { label: 'Custom domain & SSL', value: (p) => bool(F(p).customDomain) },
      { label: 'Remove Aglyn branding', value: (p) => bool(F(p).removeBranding) },
      { label: 'Reusable components', value: (p) => bool(F(p).reusableComponents) },
      { label: 'Screen versioning', value: (p) => bool(F(p).versioning) },
      { label: 'Scheduled publishing', value: (p) => bool(F(p).scheduledPublishing) },
      { label: 'URL redirects', value: (p) => bool(F(p).redirects) },
      { label: 'Multilingual sites', value: (p) => bool(F(p).multilingual) },
      { label: 'A/B testing', value: (p) => bool(F(p).abTesting) },
    ],
  },
  {
    title: 'Team',
    rows: [
      {
        label: 'Team seats',
        value: custom((p) => band(E(p).managersPerOrg, E(p).maxManagersPerOrg)),
      },
      {
        label: 'Site collaborators',
        value: custom((p) => band(E(p).membersPerHost, E(p).maxMembersPerHost)),
      },
      {
        label: 'Member accounts',
        // The one LITERAL in this file, and it is declared as one. There is
        // no `memberAccounts` entitlement to read: a site's end users are not
        // metered on any plan, so there is no number in the code to derive
        // this from. The emitted `notes` used to claim every value here is
        // read from `plan-entitlements.ts`, which this quietly made false;
        // `literal` is what keeps that claim checkable instead of aspirational.
        literal: 'no `memberAccounts` entitlement exists — end users are not metered on any plan',
        value: () => 'Unlimited',
      },
      { label: 'White-label', value: (p) => bool(F(p).whiteLabel) },
      { label: 'Single sign-on (SAML/OIDC)', value: (p) => bool(F(p).ssoEnabled) },
    ],
  },
  {
    title: 'Content & data',
    rows: [
      {
        label: 'Datasets',
        value: custom((p) => band(E(p).datasetsPerOrg, E(p).maxDatasetsPerOrg)),
      },
      { label: 'Records per dataset', value: talk((p) => num(E(p).recordsPerDataset)) },
      { label: 'Variables per site', value: talk((p) => num(E(p).variablesPerHost)) },
      { label: 'Functions per site', value: talk((p) => num(E(p).functionsPerHost)) },
      { label: 'Workflows per site', value: talk((p) => num(E(p).workflowsPerHost)) },
      { label: 'Workflow runs / mo', value: talk((p) => num(E(p).workflowRunsPerMonth)) },
      { label: 'Actions builder', value: (p) => bool(F(p).actions) },
      { label: 'Appointment bookings', value: (p) => bool(F(p).bookings) },
      /*
       * One form row, not two. `formsPerHost` is an abuse ceiling identical
       * on every plan that has forms at all, so a row for it would be eight
       * matching cells inviting a reader to hunt for a difference that is
       * not there. What a plan buys on this axis is the submissions band
       * below, which is tiered and metered.
       */
      {
        label: 'Form submissions / mo',
        value: talk((p) => num(E(p).formSubmissionsPerMonth)),
      },
      { label: 'Contacts included', value: talk((p) => num(E(p).contactsPerHost)) },
      { label: 'Email sends / mo', value: talk((p) => num(E(p).emailSendsPerMonth)) },
      // Beside the send band rather than beside "Custom domain & SSL", which
      // is the site's public web address and authorizes nothing about mail.
      // What this row answers is where a campaign's reputation lives, so it
      // belongs to the email axis and reads with the allowance above it.
      {
        label: 'Send email from your own domain',
        value: (p) => bool(F(p).customSendingDomain),
      },
      { label: 'Video & file uploads', value: (p) => bool(F(p).videoMedia) },
    ],
  },
  {
    title: 'Commerce',
    rows: [
      { label: 'Online store', value: (p) => bool(F(p).commerce) },
      { label: 'Products per site', value: talk((p) => num(E(p).productsPerHost)) },
      // "per site" is load-bearing, not decoration (AGL-1775). Since the // 2026-08-17 decision `posRegisters` is the PER-SITE cap — the add-on is
      // a pool whose seats are allocated to one site each, so an org running
      // five locations needs five. Every other per-site limit in this table
      // says so explicitly ("Products per site" is the row directly above),
      // and a bare "POS registers" beside them reads as org-wide by contrast.
      // Ground truth: `resolveHostRegisterCap(org, hostId)` = this cap plus
      // that site's allocated seats.
      {
        label: 'POS registers per site',
        // The frame still says the pre-AGL-1775 "POS registers"; the rename is
        // ours and deliberate. Declared rather than left to surface as a
        // missing row plus an extra row, which is what a rename looks like to
        // the reconciler and is indistinguishable from a genuinely dropped
        // row.
        frameLabel: 'POS registers',
        value: talk((p) => num(E(p).posRegisters)),
      },
      // A fee only means something if you can sell. Free carries
      // `transactionFeeDigitalPct: 0` but `commerce: false`, so printing "0%"
      // would read as "sell for free on the Free plan" — the opposite of
      // true. The frame renders "—" here and the frame is right.
      {
        label: 'Digital transaction fee',
        value: (p) => (F(p).commerce ? pct(E(p).transactionFeeDigitalPct) : NO),
      },
      {
        label: 'Physical transaction fee',
        value: (p) => (F(p).commerce ? pct(E(p).transactionFeePhysicalPct) : NO),
      },
      {
        label: 'Subscriptions & memberships',
        value: (p) => bool(F(p).storefrontSubscriptions),
      },
      { label: 'Gift cards', value: (p) => bool(F(p).giftCards) },
      { label: 'Product reviews', value: (p) => bool(F(p).productReviews) },
      { label: 'Abandoned cart recovery', value: (p) => bool(F(p).abandonedCart) },
      { label: 'Content gating', value: (p) => bool(F(p).contentGating) },
      { label: 'Commerce analytics', value: (p) => bool(F(p).commerceAnalytics) },
    ],
  },
  {
    title: 'Marketing & analytics',
    rows: [
      { label: 'Interactions', value: (p) => bool(F(p).interactions) },
      {
        label: 'Announcement bar & popups',
        value: (p) => bool(F(p).marketingOverlays),
      },
      { label: 'CDN & responsive images', value: (p) => bool(F(p).mediaCdn) },
      { label: 'AI assist', value: (p) => bool(F(p).aiAssist) },
      { label: 'Per-screen analytics', value: (p) => bool(F(p).screenAnalytics) },
      { label: 'Sell on the marketplace', value: (p) => bool(F(p).marketplaceSelling) },
    ],
  },
  {
    title: 'Developer & API',
    rows: [
      { label: 'API access', value: talk((p) => perMonth(E(p).apiRequestsPerMonth)) },
      { label: 'Webhooks', value: (p) => bool(F(p).webhooks) },
      // The frame lists this capability TWICE — as "Site backup & restore"
      // under Sites & publishing and again here as "Site export & backup".
      // Both resolve to the single `siteExport` feature flag and both render
      // identically, so it is one capability printed twice, not two.
      {
        label: 'Site export & backup',
        value: (p) => bool(F(p).siteExport),
        duplicateOf: 'Site backup & restore',
      },
    ],
  },
]

// ---------------------------------------------------------------- usage

const money = (v: number | null): string =>
  v == null ? NO : v < 1 ? `$${v.toFixed(2)}` : `$${v}`

/*
 * The same rate wearing the frame's decoration.
 *
 * The number is the code's; the leading `+`, the unit and the spacing are the
 * design's, and they are not uniform — the storage row is written flat where
 * the four monthly rows carry a `+`. Rendering our value the frame's way is
 * what lets the two be compared as whole strings. A comparison that stripped
 * the decoration and matched digits would pass a row that had silently
 * changed unit, which on a per-1,000 rate is a 1000x error.
 */
const perMo = (v: number | null): string => (v == null ? NO : `+${money(v)}/mo`)
const perThousand = (v: number | null): string =>
  v == null ? NO : `+${money(v)} / 1k`
const perGbMonth = (v: number | null): string =>
  v == null ? NO : `${money(v)} / GB-mo`

/**
 * A `PLAN_PRICING` field that states an add-on or overage rate.
 *
 * Every one of them is a price a customer is billed, and the `extra` prefix
 * is what the completeness check below enumerates — see `UNPUBLISHED_RATES`.
 */
type RateKey = {
  [K in keyof (typeof PLAN_PRICING)['pro']]: K extends `extra${string}`
    ? K
    : never
}[keyof (typeof PLAN_PRICING)['pro']]

interface UsageRow {
  label: string
  /** The frame's label for this row; it is the shorter one throughout. */
  frameLabel: string
  /**
   * The `PLAN_PRICING` field this row publishes.
   *
   * Structural, not an annotation. Both renderings below are derived from it,
   * so a row cannot claim to publish one rate while printing another — and
   * `UNPUBLISHED_RATES` enumerates the same keys off `PLAN_PRICING` itself to
   * find the ones NO row publishes, which is how the email-send and assist
   * rates came to be billed against a page that stated neither.
   */
  rate: RateKey
  /** The unit decoration the frame writes this rate with. */
  decorate: (v: number | null) => string
}

const USAGE_ROWS: UsageRow[] = [
  {
    label: 'Extra site, per month',
    frameLabel: 'Extra site / host',
    rate: 'extraHostMonthlyUsd',
    decorate: perMo,
  },
  {
    label: 'Extra team seat, per month',
    frameLabel: 'Extra team seat',
    rate: 'extraSeatMonthlyUsd',
    decorate: perMo,
  },
  {
    label: 'Extra site collaborator, per month',
    frameLabel: 'Extra site collaborator',
    rate: 'extraCollaboratorMonthlyUsd',
    decorate: perMo,
  },
  {
    label: 'Extra dataset, per month',
    frameLabel: 'Extra dataset',
    rate: 'extraDatasetMonthlyUsd',
    decorate: perMo,
  },
  {
    label: 'Extra data storage, per GB-month',
    frameLabel: 'Extra data storage',
    rate: 'extraDataGbMonthlyUsd',
    decorate: perGbMonth,
  },
  {
    label: 'API requests, per 1,000 over limit',
    frameLabel: 'API requests over limit',
    rate: 'extraApiRequestsUsdPer1k',
    decorate: perThousand,
  },
  {
    label: 'Contacts, per 1,000 over the included band',
    frameLabel: 'Contacts over included band',
    rate: 'extraContactsUsdPer1k',
    decorate: perThousand,
  },
  /*
   * EMAIL SENDS AND ASSIST — billed everywhere, published nowhere until now.
   *
   * Both rates were already charged. `priceEmailSendOverage` reads
   * `extraEmailSendsUsdPer1k` and `report-usage` puts the result on the
   * invoice; `priceAssistCreditOverage` reads `extraAssistCreditsUsdPer1k` the
   * same way. Neither had a row on this table, so `/pricing` stated an email
   * ALLOWANCE ("Email sends / mo") and an assist CAPABILITY ("AI assist ✓")
   * while stating the price of exceeding either nowhere at all.
   *
   * The rates are published exactly as the code carries them. No price moves
   * here, which matters under the launch freeze: a charged figure that has
   * never been disclosed is fixed by disclosing it, not by repricing it.
   *
   * Both are RETAIL rates set beside the two rows above, NOT the
   * infrastructure pass-through, and neither is derived from `METERED_MARKUP`.
   * Our own costs — `ORG_COGS_UNIT_RATES_USD.perEmailSend` and
   * `ASSIST_CREDIT_COST_USD` — are cost-model inputs and stay off this table;
   * the pass-through strip is the only place a cost column is published, and
   * only because its heading claims one.
   */
  {
    label: 'Email sends, per 1,000 over the included band',
    frameLabel: 'Email sends over included band',
    rate: 'extraEmailSendsUsdPer1k',
    decorate: perThousand,
  },
  {
    /*
     * Credits, not messages, and the label has to say so: a credit is a fixed
     * quantity of provider spend, so one question and one generated screen
     * draw wildly different amounts. "Per 1,000 assists" would price them the
     * same and be wrong by two orders of magnitude.
     *
     * Starter's dash is CORRECT rather than a gap, and for the opposite
     * reason to the email row above. Assist is refused at the band on every
     * tier, so a plan with no rate simply stops; email cannot be refused —
     * transactional mail goes out at every tier — so a null there would be
     * unbounded absorbed spend. Same-looking cell, different fact.
     */
    label: 'AI assist, per 1,000 credits over the included band',
    frameLabel: 'Assist credits over included band',
    rate: 'extraAssistCreditsUsdPer1k',
    decorate: perThousand,
  },
]

/** The bare rate, as the compare-style tables print it. */
const rowValue = (r: UsageRow, p: Plan): string => money(PLAN_PRICING[p][r.rate])
/** The same rate wearing the frame's unit decoration. */
const rowFrameValue = (r: UsageRow, p: Plan): string =>
  r.decorate(PLAN_PRICING[p][r.rate])

/**
 * Rates `PLAN_PRICING` carries that NO row above publishes.
 *
 * The enumeration is the guard. Read off the pricing table itself rather than
 * from a list somebody maintains beside it, so a rate added to the code with
 * no row here is reported the day it lands — which is the failure that had to
 * be found by hand this time: `extraEmailSendsUsdPer1k` and
 * `extraAssistCreditsUsdPer1k` were both billed, and the only artifact that
 * could have noticed was this table, which did not read them.
 */
const RATE_KEYS = Object.keys(PLAN_PRICING.pro).filter((k) =>
  k.startsWith('extra'),
) as RateKey[]
const PUBLISHED_RATES = new Set<RateKey>(USAGE_ROWS.map((r) => r.rate))
const UNPUBLISHED_RATES = RATE_KEYS.filter((k) => !PUBLISHED_RATES.has(k))

// ---------------------------------------------------------------- emit

const compare = {
  /** The frame tints the Pro column full-height; the page mirrors that. */
  highlightPlan: 'pro' as const,
  columns: PLANS.map((p) => ({
    plan: p,
    label: PLAN_LABELS[p],
    monthlyUsd: PLAN_PRICING[p].basePriceMonthlyUsd,
    annualMonthlyUsd: PLAN_PRICING[p].basePriceAnnualMonthlyUsd,
    priceLabel:
      p === 'enterprise' ? 'Custom' : `$${PLAN_PRICING[p].basePriceMonthlyUsd}`,
  })),
  groups: GROUPS.map((g) => ({
    title: g.title,
    rows: g.rows.map((r) => ({
      label: r.label,
      duplicateOf: r.duplicateOf ?? null,
      values: Object.fromEntries(PLANS.map((p) => [p, r.value(p)])),
    })),
  })),
}

/**
 * The usage table runs Starter→Enterprise. Free is absent by design — it has
 * no paid add-ons at all (`PLAN_PRICING.free.*` is null throughout), so a
 * column of dashes would only invite the reader to look for a rate that does
 * not exist. Enterprise carries "Custom" for every row, matching the frame.
 */
const USAGE_PLANS: Plan[] = [...PAID, 'enterprise']

const usage = {
  columns: USAGE_PLANS.map((p) => ({ plan: p, label: PLAN_LABELS[p] })),
  rowLabel: 'Add-on capacity',
  highlightPlan: 'pro' as const,
  rows: USAGE_ROWS.map((r) => ({
    label: r.label,
    rate: r.rate,
    values: Object.fromEntries(
      USAGE_PLANS.map((p) => [
        p,
        p === 'enterprise' ? CUSTOM_LABEL : rowValue(r, p),
      ]),
    ),
  })),
  note:
    'The Free plan has no paid add-ons. Annual billing does not change these ' +
    'rates.',
}

// ------------------------------------------------- metered pass-through

/**
 * The metered INFRASTRUCTURE table — `/pricing`'s "passed through at cost +
 * 30%" strip (AGL-2194).
 *
 * It was generated by nothing. `usage` above covers the "Add-on capacity"
 * table and `check:pricing-tables` guards every cell of it; the three
 * pass-through rows beside it were hand-authored on the page and appeared in
 * no generated artifact, so no check in this repo could read them, and none
 * could fail on them. That is how the page came to advertise **$0.65 / 1k**
 * form submissions against a charged **$0.065 / 1k** — a 10x overstatement
 * that survived because the number had no source of truth to disagree with.
 * The page has since been corrected by hand (AGL-2469 transcribes it), which
 * is precisely the state this section exists to stop recurring: correct today,
 * guarded by nothing tomorrow.
 *
 * Both columns are generated, not just the customer-facing one: the heading
 * makes a claim about OUR COST too ("at cost + 30%"), so a stale cost column
 * is a false statement about our margin even when the rate beside it is right.
 *
 * Rates come from `ORG_COGS_UNIT_RATES_USD`, which
 * `apps/console/utils/usage-metering.spec.ts` pins equal to
 * `METERED_UNIT_RATES_USD` — the table a customer is actually billed against.
 * Read from there rather than from `usage-metering.ts` because this generator
 * resolves no `@aglyn/*` path alias and so cannot import anything under
 * `apps/console`; the drift guard is what makes the indirection safe rather
 * than a second source of truth.
 */

/**
 * The fewest decimals that state the figure EXACTLY, minimum two.
 *
 * Fixed 2dp would publish `$0.03 / GB-mo` for a $0.026 rate and `$0.03` again
 * for the $0.0338 one — rounding the two columns of a "+30%" table into
 * agreement, which is the precise defect this section exists to prevent.
 */
const rate = (v: number): string => {
  const exact = Math.round(v * 1e6) / 1e6
  for (let dp = 2; dp < 6; dp += 1) {
    if (Number(exact.toFixed(dp)) === exact) return `$${exact.toFixed(dp)}`
  }
  return `$${exact.toFixed(6)}`
}

const per1k = (v: number): number => Math.round(v * 1000 * 1e6) / 1e6
const withMarkup = (v: number): number => Math.round(v * METERED_MARKUP * 1e6) / 1e6

const METERED_ROWS: Array<{ label: string; costUsd: number; unit: string }> = [
  {
    label: 'Media & file storage',
    costUsd: ORG_COGS_UNIT_RATES_USD.storagePerGbMonth,
    unit: '/ GB-mo',
  },
  {
    label: 'Page views (bandwidth + reads)',
    costUsd: per1k(ORG_COGS_UNIT_RATES_USD.perPageView),
    unit: '/ 1k views',
  },
  {
    label: 'Form submissions',
    costUsd: per1k(ORG_COGS_UNIT_RATES_USD.perFormSubmission),
    unit: '/ 1k',
  },
]

const metered = {
  heading: 'Metered infrastructure — passed through at cost + 30%',
  markupPct: Math.round((METERED_MARKUP - 1) * 100),
  columns: ['Metered item', 'Our cost', `You pay (+${Math.round((METERED_MARKUP - 1) * 100)}%)`],
  rows: METERED_ROWS.map((r) => ({
    label: r.label,
    unit: r.unit,
    ourCost: `${rate(r.costUsd)} ${r.unit}`,
    youPay: `${rate(withMarkup(r.costUsd))} ${r.unit}`,
  })),
  note:
    'Applies only to plans with `meteredInfraPassThrough`. Dataset storage ' +
    'over the included amount is a separate retail rate ' +
    `(${rate(PLAN_PRICING.pro.extraDataGbMonthlyUsd ?? 0)} / GB-mo), not this ` +
    'pass-through.',
}

const fees = {
  rows: PLANS.filter((p) => p !== 'enterprise').map((p) => ({
    plan: p,
    label: PLAN_LABELS[p],
    digital: pct(PLAN_ENTITLEMENTS[p].transactionFeeDigitalPct),
    physical: pct(PLAN_ENTITLEMENTS[p].transactionFeePhysicalPct),
  })),

  /*==========================================
   * THE MARKETPLACE TAKE RATE (AGL-2194 P8).
   *
   * `/pricing` carries a section headed "TRANSACTION FEES — What Aglyn takes
   * on a sale" and answers it with the digital/physical ladder above, which
   * reaches 0% from Advanced up. The same page ticks "Sell on the
   * marketplace" from Pro up. It states the take rate on a marketplace sale
   * NOWHERE: grepping the live page (2026-08-20) for "20%", "take rate" and
   * "revenue share" returns zero hits, and `/product/plugins` is silent too.
   *
   * `marketplaceFeePct` is 20 on every paid plan and 30 on free, charged at
   * `libs/plugins/marketplace/src/lib/server/checkout.ts` through
   * `resolveMarketplaceFeePct`. So a publisher on Advanced reads "0%
   * transaction fees" and "Sell on the marketplace ✓" on one screen and keeps
   * 80% of their sale. That is the one number on this page where the product
   * charges MORE than the page discloses, and it is money a seller has not
   * been told about.
   *
   * The rate is LOCKED and is not changed here. What is fixed here is that
   * the figure now exists in the generated source of truth, so the besigner
   * edit that discloses it is a transcription of a checked number rather than
   * someone's recollection — and so a later change to `marketplaceFeePct`
   * fails `check:pricing-tables` instead of silently making the disclosure
   * false the way the 10x form-submission rate went unguarded.
   *=========================================*/
  marketplace: {
    heading: 'Marketplace sales — what Aglyn keeps on a listing sale',
    rows: PLANS.map((p) => ({
      plan: p,
      label: PLAN_LABELS[p],
      takeRate: pct(PLAN_ENTITLEMENTS[p].marketplaceFeePct),
    })),
    note:
      'Separate from the storefront transaction fee above and NOT reduced by ' +
      'plan: a publisher on a 0% storefront plan still pays the marketplace ' +
      'take rate on marketplace listing sales. Charged in ' +
      '`libs/plugins/marketplace/src/lib/server/checkout.ts`.',
  },
}

/**
 * The "Need more scale?" strip under the four plan cards (frame `570:1218`).
 *
 * `blurb` is design copy — a positioning sentence with no numbers in it, so
 * there is nothing to drift. `specs` is assembled from code, because the
 * frame's own spec lines are dense with figures ("15 sites · 75 collaborators
 * · 1% commerce fees · 300k API requests/mo …") and every one of them is a
 * claim. The frame's numbers were checked against these and all matched; the
 * point of generating them is that they stay matched.
 *
 * A few trailing items are genuinely prose ("priority scale & limits") and are
 * carried verbatim in `extras`, kept separate so it is obvious which half of
 * each line is derived and which is written.
 */
/** Each token is a fact the frame chose to show, rendered from code. */
const SPEC: Record<string, (e: (typeof PLAN_ENTITLEMENTS)[Plan]) => string> = {
  sites: (e) => `${num(e.hostLimit)} sites`,
  collaborators: (e) => `${num(e.membersPerHost)} collaborators`,
  fees: (e) => `${pct(e.transactionFeeDigitalPct)} commerce fees`,
  api: (e) =>
    `${perMonth(e.apiRequestsPerMonth).replace(' / mo', '')} API requests/mo`,
  products: (e) =>
    e.productsPerHost === UNLIMITED
      ? 'unlimited products'
      : `${num(e.productsPerHost)} products per site`,
  bandwidth: (e) => `${gb(e.bandwidthGb)} bandwidth`,
  // Per site, for the same AGL-1775 reason as the compare-table row: this is
  // the cap each site gets, not a total the org shares out.
  registers: (e) => `${num(e.posRegisters)} POS registers per site`,
  whiteLabel: (e) =>
    e.features.whiteLabel
      ? 'full white-label incl. custom console domain'
      : 'no white-label',
  recordsAndVars: (e) =>
    e.recordsPerDataset === UNLIMITED && e.variablesPerHost === UNLIMITED
      ? 'unlimited records & variables'
      : `${num(e.recordsPerDataset)} records · ${num(e.variablesPerHost)} variables`,
}

/**
 * Which facts each tier leads with, in the frame's order. Kept to six items
 * per row like the design — a longer line is not more informative, it just
 * wraps. `lit` entries are prose the frame wrote that has no code equivalent.
 */
const TIER_SPEC: Partial<
  Record<Plan, { blurb: string; specs: Array<keyof typeof SPEC | { lit: string }> }>
> = {
  scale: {
    blurb:
      'For high-growth stores and multi-site teams that have outgrown Business.',
    specs: ['sites', 'collaborators', 'fees', 'api', 'products', 'bandwidth'],
  },
  advanced: {
    blurb: 'For high-volume organizations that need headroom on every limit.',
    specs: [
      'sites',
      'collaborators',
      'fees',
      'api',
      'products',
      { lit: 'priority scale & limits' },
    ],
  },
  agency: {
    blurb:
      'For agencies and resellers running whole client portfolios under one roof.',
    specs: [
      'sites',
      'collaborators',
      'whiteLabel',
      'api',
      'recordsAndVars',
      'registers',
    ],
  },
}

/**
 * Where the CTAs point. The published strip says `https://app.aglyn.com/signup`
 * and so does every plan card above it; this is that same destination, stated
 * once so the two halves of the page cannot drift apart.
 */
const SIGNUP_URL = 'https://app.aglyn.com/signup'

/**
 * The strip's copy at one billing cadence (AGL-1989).
 *
 * The four plan cards above the strip live inside a Monthly/Annual Tabs, so
 * each cadence has its own authored copy and its own CTA — the annual Starter
 * card reads "$16 /mo · $192 billed yearly" and links to
 * `?plan=starter&interval=year`. The strip is authored ONCE, OUTSIDE the tabs,
 * so it quoted the monthly headline on both tabs and its CHOOSE links carried
 * no `interval` at all: a visitor who picked Annual and then picked Scale
 * arrived pre-selected for a MONTHLY plan and lost the discount they were
 * just shown.
 *
 * The page is authored content and this file publishes nothing, so this does
 * not fix the page. What it fixes is that the string that SHOULD be published
 * now exists somewhere a check can read it: the `ctaHref` comes from the
 * deep-link contract's own writer rather than being typed, and
 * `onboardingSignupHref` is the function whose output
 * `parseOnboardingPlanIntent` is tested to read back as a STATED interval.
 *
 * The sub-line follows the CARDS' convention rather than inventing one: on the
 * monthly tab it quotes the annual per-month price ("$179/mo billed
 * annually"), on the annual tab it quotes the yearly total ("$2,148 billed
 * yearly"), which is what the annual Starter/Pro/Business cards do.
 */
const tierAtInterval = (p: Plan, interval: OnboardingInterval) => {
  const monthly = PLAN_PRICING[p].basePriceMonthlyUsd
  const annualMonthly = PLAN_PRICING[p].basePriceAnnualMonthlyUsd
  return interval === 'year'
    ? {
        priceLabel: `$${annualMonthly} /mo`,
        subLabel: `$${(annualMonthly * 12).toLocaleString('en-US')} billed yearly`,
        ctaHref: onboardingSignupHref(SIGNUP_URL, p, 'year'),
      }
    : {
        priceLabel: `$${monthly} /mo`,
        subLabel: `$${annualMonthly}/mo billed annually`,
        ctaHref: onboardingSignupHref(SIGNUP_URL, p, 'month'),
      }
}

const tiers = {
  heading: 'Need more scale?',
  lede: 'Higher-volume plans for stores, orgs, and agencies.',
  rows: (['scale', 'advanced', 'agency'] as Plan[]).map((p) => {
    const e = PLAN_ENTITLEMENTS[p]
    const spec = TIER_SPEC[p]!
    return {
      plan: p,
      label: PLAN_LABELS[p],
      priceLabel: `$${PLAN_PRICING[p].basePriceMonthlyUsd} /mo`,
      annualLabel: `$${PLAN_PRICING[p].basePriceAnnualMonthlyUsd}/mo billed annually`,
      blurb: spec.blurb,
      specs: spec.specs.map((s) =>
        typeof s === 'string' ? SPEC[s](e) : s.lit,
      ),
      cta: 'CHOOSE',
      byInterval: {
        month: tierAtInterval(p, 'month'),
        year: tierAtInterval(p, 'year'),
      },
    }
  }),
  enterprise: {
    plan: 'enterprise',
    label: PLAN_LABELS.enterprise,
    priceLabel: CUSTOM_LABEL,
    annualLabel: 'Quoted per agreement',
    blurb:
      'For large organizations with bespoke requirements — volume pricing available.',
    specs: [
      'Unlimited scale',
      `${pct(PLAN_ENTITLEMENTS.enterprise.transactionFeeDigitalPct)} platform fees`,
      'white-label',
      'SSO',
      // Was `'SLA & dedicated support'` (AGL-2194 P4). Dedicated support is
      // real — a named manager and a 24–48h first response, which the FAQ
      // states and the support tier implements. A CONTRACTUAL UPTIME SLA is
      // not: no entitlement key, no credit calculation, no route, nothing.
      // AGL-2411 took the claim off the live page, and the same page's FAQ now
      // says out loud "we do not offer a contractual uptime SLA during public
      // beta" — so this artifact was the last place still selling it, and
      // selling it in direct contradiction of the FAQ two screens below.
      // Whoever next pours this card from the generated tables would have put
      // it back.
      'dedicated support',
      'custom contracts',
    ],
    cta: 'CONTACT SALES',
    // Deliberately no signup href and no cadence: Enterprise is quoted, not
    // bought, and the published CTA goes to the contact screen rather than to
    // signup. The deep-link parser reports `intervalStated: false` for a
    // custom-priced plan however the link is written, so an `interval` here
    // could only mislead.
    byInterval: null,
  },
}

const addons = {
  rows: [
    {
      label: 'Event Calendar',
      priceUsd: EVENT_CALENDAR_ADDON_MONTHLY_USD,
      scope: 'organization',
      maxQuantity: 1,
    },
    {
      label: 'Extra POS register',
      priceUsd: POS_REGISTER_ADDON_MONTHLY_USD,
      // 'per register' described the pre-AGL-1775 behaviour, where one
      // purchase raised the cap on every site the org ran. It is now a pool
      // (`seatAddons.posRegisters`) whose seats are assigned to individual
      // sites via `org.registerAllocations`, reassignable, and returned to the
      // pool when a site is deleted. The scope that matters to a buyer pricing
      // a multi-location rollout is the SITE, which is why this is not
      // 'organization' the way Event Calendar deliberately is.
      scope: 'per site',
      // `null` read as "buy as many as you like" (AGL-2194). It is capped:
      // `POST /api/billing/addons` refuses a quantity above
      // `POS_REGISTERS_ADDON_MAX` on any plan that carries `features.pos`
      // (`apps/console/app/api/billing/addons/route.ts:228`). Publishing "no
      // maximum" beside an $89/mo line item is a claim about what a buyer can
      // purchase, and it was one the checkout would decline — so it is read
      // from the constant that declines it, not hand-written beside it.
      maxQuantity: POS_REGISTERS_ADDON_MAX,
      included: Object.fromEntries(
        PLANS.map((p) => [p, PLAN_ENTITLEMENTS[p].posRegisters]),
      ),
    },
  ],
}

// ------------------------------------------------------------------ cli

/**
 * `--check` reconciles and compares against the committed output WITHOUT
 * writing, and is what CI runs. Anything else regenerates.
 *
 * `--frame` / `--out` exist so the self-test can drive this against fixtures
 * it is allowed to corrupt. A guard that has never been made to fail is not
 * evidence, and the only honest way to make this one fail is to hand it a
 * broken frame — which must never mean editing the committed one.
 */
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const checkOnly = argv.includes('--check')
const outDir = flag('out') ?? OUT
const framePath = flag('frame') ?? join(OUT, 'copy-desktop.json')

// ------------------------------------------------------- reconciliation
//
// Runs BEFORE anything is written (AGL-1278). It used to run after, which
// made the headline invariant — "where frame and code disagree the code wins,
// but the disagreement is printed" — true of the console and false of the
// artifact: the file was already on disk by the time a disagreement was
// discovered, and nothing ever exited non-zero, so no check could fail on it.
// A reconciler that cannot fail is a printout.

const frame = JSON.parse(readFileSync(framePath, 'utf8')) as {
  sections: Array<{
    name: string
    groups: Array<{ name: string; records: Array<{ cells: string[] }> }>
  }>
}

const frameTable = frame.sections
  .find((s) => s.name === 'Compare features')
  ?.groups.find((g) => g.name === 'Feature table')

const framePlanOrder: Plan[] = [
  'free',
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
  'agency',
  'enterprise',
]

/** One label cell plus one cell per plan. */
const FRAME_ROW_CELLS = framePlanOrder.length + 1

const problems: string[] = []
const fail = (headline: string, lines: string[]) => {
  if (lines.length) problems.push(`${headline}\n${lines.map((l) => `  ${l}`).join('\n')}`)
}

/**
 * Frame records that are not a full plan row.
 *
 * Skipped silently before, which is the quiet half of the same defect: a row
 * the extractor emitted with eight cells instead of nine simply vanished from
 * the comparison, and vanishing is exactly what a dropped pricing row does.
 */
const malformed: string[] = []
const frameRows = new Map<string, string[]>()
/**
 * The frame carries a single-cell record for each group band — "Team",
 * "Commerce" — which is table STRUCTURE, not a plan row. Recognised by name
 * against our own group titles rather than by cell count alone, so a one-cell
 * record that is not a band we know about is still reported.
 */
const groupBands = new Set(GROUPS.map((g) => g.title))
/**
 * The two records the extractor names for their Figma layer rather than for a
 * feature: the plan header (Free…Enterprise) and the price strip ($0…Custom).
 * They carry a full complement of cells, so they are plan ROWS as far as the
 * loop below is concerned, and they are skipped here because they are
 * reconciled as `compare.columns` further down — against `PLAN_LABELS` and
 * against the eight `priceLabel`s — rather than against a feature spec.
 */
const FRAME_FURNITURE_LABEL = 'Text'
for (const rec of frameTable?.records ?? []) {
  const label = rec.cells[0]
  if (label === FRAME_FURNITURE_LABEL) {
    continue
  } else if (rec.cells.length === FRAME_ROW_CELLS) {
    frameRows.set(label, rec.cells.slice(1))
  } else if (rec.cells.length === 1 && groupBands.has(label)) {
    continue
  } else {
    malformed.push(`${label ?? '(no label)'}: ${rec.cells.length} cells, expected ${FRAME_ROW_CELLS}`)
  }
}

if (!frameTable) {
  problems.push(`the frame at ${framePath} has no "Compare features / Feature table" group`)
}

/**
 * Rows OUR spec carries that the frame does not, each with the reason.
 *
 * The frame is a record of the design, not of the truth — but "the frame is
 * stale" has to be an argument someone made once, not a shrug the reconciler
 * repeats forever. An entry here that stops diverging fails too.
 */
const EXPECTED_MISSING: Record<string, string> = {
  'Single sign-on (SAML/OIDC)':
    'added beyond the frame when AGL-1210 shipped self-serve SSO; `ssoEnabled` is real and Enterprise-only, and the page said so before the design did',
  'Send email from your own domain':
    '`customSendingDomain` is a capability the frame predates entirely — sending identity was not a published axis when it was drawn. It is real from Pro up, and it is the row that says a campaign leaves on a name whose reputation is the merchant’s. Resolves when the four responsive /pricing frames are hand-edited',
}

/** Rows the FRAME carries that we deliberately do not emit, each with why. */
const EXPECTED_EXTRA: Record<string, string> = {
  'Total site size':
    'AGL-2133 retired `totalSiteSizeMb`: it was enforced by nothing, and AGL-678 caps a node map at 900 KB, so the measurable org total can only reach a fraction of it. There is no number left to publish',
}

// The plan header and the price strip are deliberately absent from this list.
// Both are named for their Figma layer rather than for a feature, and it is
// tempting to excuse them together as furniture — but the header is furniture
// and the strip beside it is EIGHT PRICES. They are reconciled as
// `compare.columns` below instead of being declared away here.

// `'Site backup & restore'` was exempted here until AGL-1278's reopening. It
// is not a label the frame has ever carried — the row is `Site export &
// backup`, and we emit it — so the entry excused nothing while reading as a
// considered decision. It was found by the both-directions check below on the
// first run after that check existed.


/**
 * Cells where the CODE has moved and the published frame has not.
 *
 * The reconciler's own message asks for these to be said "deliberately", and
 * until now there was nowhere to say it: any disagreement failed, so a
 * deliberate product change could not land without the Figma frame moving in
 * the same commit — which is not how the frame gets updated, and is why this
 * guard sat red rather than being answered.
 *
 * Keyed `row label · plan`, valued with the frame's stale cell and the reason.
 * Declaring the FRAME's value rather than a bare "ignore this" is what keeps
 * the exemption honest: the moment the page catches up the declaration stops
 * matching and is reported as resolved, so it cannot outlive its reason. An
 * exemption that outlives its reason is just an untested cell.
 */
const FRAME_STALE_CELLS: Record<string, { frame: string; why: string }> = {
  'CDN & responsive images · Free': {
    frame: '—',
    why: 'AGL-1152 moved the CDN to every plan, Free included; the frame still shows the pre-AGL-1152 split',
  },
  'Email sends / mo · Starter': {
    frame: '500',
    why: 'campaign email begins at Pro — a site that may send needs its own verified provider sending domain, so the allowance attaches to the tiers that carry that cost. Starter is banded at 0 like Free; the frame still draws the allowance. Resolves when the four responsive /pricing frames are hand-edited',
  },
}

const diffs: string[] = []
/** Declared-stale cells the frame has since caught up on. */
const staleCellsResolved: string[] = []
/**
 * Every cell key the loop below actually reached. A declaration keyed at a
 * cell nothing carries excuses nothing while reading as a considered
 * decision, and a reconciler that compared no cells at all would report just
 * as clean as one that compared them and found them right.
 */
const comparedCells = new Set<string>()
const missing: string[] = []
for (const g of GROUPS) {
  for (const r of g.rows) {
    const key = frameRows.has(r.label) ? r.label : (r.frameLabel ?? r.label)
    const got = frameRows.get(key)
    if (!got) {
      missing.push(r.label)
      continue
    }
    framePlanOrder.forEach((p, i) => {
      const ours = r.value(p)
      const theirs = got[i]
      comparedCells.add(`${r.label} · ${PLAN_LABELS[p]}`)
      // Enterprise used to be excused here, on the grounds that "Talk to us"
      // is a copy choice rather than a claim. It is now generated to match
      // (see the `enterprise` note on Row), so the excuse is gone and all 50
      // Enterprise cells are checked like every other column. An exemption
      // that outlives its reason is just an untested column.
      const cellKey = `${r.label} · ${PLAN_LABELS[p]}`
      const staleCell = FRAME_STALE_CELLS[cellKey]
      if (ours === theirs) {
        // The page caught up. The declaration has to go with it, or the next
        // regression is silently pre-excused.
        if (staleCell) staleCellsResolved.push(cellKey)
      } else if (staleCell && theirs === staleCell.frame) {
        // Known stale, and stale in exactly the way we recorded. A frame that
        // has drifted to some THIRD value is not this exemption.
      } else if (ours !== theirs) {
        diffs.push(`  ${cellKey}: code=${ours}  frame=${theirs}`)
      }
    })
  }
}

const ourLabels = new Set(GROUPS.flatMap((g) => g.rows.map((r) => r.label)))
const ourFrameLabels = new Set(
  GROUPS.flatMap((g) => g.rows.map((r) => r.frameLabel ?? r.label)),
)
const extra = [...frameRows.keys()].filter(
  (k) => !ourLabels.has(k) && !ourFrameLabels.has(k),
)

/**
 * The pass-through strip, reconciled the same way the compare table is
 * (AGL-2194) — it never was, which is how a 10x price stayed published.
 *
 * The frame here is a record of the LIVE PAGE's numbers as extracted by
 * `extract-pricing-copy.mjs`, so a disagreement is a real published defect,
 * not a design opinion. The code still wins; the point is that the
 * disagreement can no longer be invisible.
 */
const frameMetered = frame.sections
  .find((s) => s.name === 'Usage pricing')
  ?.groups.find((g) => g.name === 'pass-through')

/**
 * Cells the FIGMA FRAME is known to have stale, with the exact stale value.
 *
 * This is a divergence between the code and the DESIGN RECORD, not a live
 * defect. `copy-*.json` is an extraction of the Figma frame — the file says so
 * itself: "a record of the design, not of the truth" — and both cells here
 * still carry the pre-AGL-1280 rates the frame was drawn with. AGL-1280
 * measured the real costs on 2026-08-09 (GCS Standard US multi-region list for
 * storage; the actual ~12 reads / ~9 writes / one ~0.4s invocation of
 * `/api/forms/submit` for submissions) and the corrected set was locked for
 * the public beta. The published page was corrected too — the 2026-08-19
 * transcription in `apps/console/specs/published-pricing-table-parity.spec.ts`
 * records `aglyn.com/pricing` serving $0.0338 / GB-mo and $0.065 / 1k. The
 * frame is the one artifact left behind.
 *
 * Declared rather than left to red, because re-exporting the frame is a Figma
 * round-trip nobody should be forced into mid-freeze. Declared, NOT excused:
 * the recorded value is compared exactly, so the frame drifting to a THIRD
 * number fails, and the frame being re-exported correctly fails too and forces
 * the entry out. An entry that matches nothing is the one thing this cannot
 * become.
 */
const FRAME_STALE_METERED: Record<
  string,
  { ourCost: string; youPay: string; why: string }
> = {
  'Media & file storage': {
    ourCost: '$0.03 / GB-mo',
    youPay: '$0.039 / GB-mo',
    why: 'pre-AGL-1280 rate; storage was corrected 0.03 → 0.026 (GCS Standard US multi-region list, the SKU on our invoice), so the page overstates the customer\'s rate by ~15%',
  },
  'Form submissions': {
    ourCost: '$0.50 / 1k',
    youPay: '$0.65 / 1k',
    why: 'pre-AGL-1280 rate; submissions were corrected 0.0005 → 0.00005 against a measured ~12 reads / ~9 writes / one ~0.4s invocation, so the page overstates the customer\'s rate 10x',
  },
}

const meteredDiffs: string[] = []
const meteredMissing: string[] = []
const staleResolved: string[] = []
if (!frameMetered) {
  problems.push(
    `the frame at ${framePath} has no "Usage pricing / pass-through" group`,
  )
}
for (const row of metered.rows) {
  const rec = frameMetered?.records.find((r) => r.cells[0] === row.label)
  if (!rec) {
    meteredMissing.push(row.label)
    continue
  }
  const declared = FRAME_STALE_METERED[row.label]
  const agrees = rec.cells[1] === row.ourCost && rec.cells[2] === row.youPay
  if (agrees) {
    // The page caught up. The declaration has to go with it, or the next
    // regression is silently pre-excused.
    if (declared) staleResolved.push(row.label)
    continue
  }
  if (
    declared &&
    rec.cells[1] === declared.ourCost &&
    rec.cells[2] === declared.youPay
  ) {
    continue
  }
  meteredDiffs.push(
    `${row.label}: code=${row.ourCost} / ${row.youPay}  ` +
      `frame=${rec.cells[1]} / ${rec.cells[2]}` +
      (declared ? `  (declared stale value was ${declared.ourCost} / ${declared.youPay})` : ''),
  )
}

fail('pass-through rows the frame does not carry', meteredMissing)
fail(
  'PASS-THROUGH disagreements not declared in FRAME_STALE_METERED (the code wins — the published page is wrong)',
  meteredDiffs,
)
fail(
  'declared in FRAME_STALE_METERED but the frame now AGREES — delete the entry',
  staleResolved,
)
fail(
  'declared in FRAME_STALE_METERED but there is no such pass-through row',
  Object.keys(FRAME_STALE_METERED).filter(
    (label) => !metered.rows.some((r) => r.label === label),
  ),
)

// --------------------------------------------- the four remaining tables
//
// `tables.json` carries six tables, and all six are reconciled: the compare
// grid and the metered pass-through strip above, and the plan columns, the
// "Need more scale?" strip, the add-on capacity table and the optional add-on
// cards here. A generated table with no reconciler is the shape of gap that
// published a 10x form-submission rate — correct on the day somebody typed
// it, and unfalsifiable afterwards — so the one thing this section must never
// become is a reader that finds nothing and reports agreement. Every table
// below counts the cells it compared, and a count of zero is a failure.
//
// These read EVERY breakpoint export rather than only the primary frame,
// because the exports drift from each other as well as from the code: the
// mobile export renders one selected plan as two-cell records instead of a
// full row, so it can carry a rate none of the wide frames do.
//
// Declaration keys are NOT qualified by breakpoint. The four exports are one
// design at four sizes, so a Figma cell that has gone stale is stale in all of
// them; a per-breakpoint key would let three rot quietly behind a declaration
// written for the fourth. A declared cell therefore resolves only when EVERY
// breakpoint that carries it has caught up.

type FrameFile = {
  sections: Array<{
    name: string
    groups: Array<{ name: string; records: Array<{ cells: string[] }> }>
  }>
}

interface FrameView {
  /** The breakpoint's name, so a reported disagreement says where it is. */
  name: string
  data: FrameFile
}

const COPY_FILE = /^copy-(.+)\.json$/
const frameDir = dirname(framePath)
/**
 * Every breakpoint export sitting beside the primary frame. Discovered rather
 * than listed so a fifth breakpoint is covered the day it is exported, and so
 * the self-test — which drives this against a scratch directory holding
 * whichever fixtures a case needs — reconciles exactly what it put there.
 */
const frames: FrameView[] = readdirSync(frameDir)
  .filter((f: string) => COPY_FILE.test(f))
  .sort()
  .map((f: string) => ({
    name: COPY_FILE.exec(f)![1],
    data:
      f === basename(framePath)
        ? (frame as FrameFile)
        : (JSON.parse(readFileSync(join(frameDir, f), 'utf8')) as FrameFile),
  }))

if (!frames.length) {
  problems.push(`no copy-*.json breakpoint export found in ${frameDir}`)
}

/** One group's records, or null when this breakpoint does not carry it. */
const records = (v: FrameView, section: string, group: string) =>
  v.data.sections.find((s) => s.name === section)?.groups.find((g) => g.name === group)
    ?.records ?? null

/** A cell where the code has moved and the published frame has not. */
interface Divergence {
  frame: string
  why: string
}

/**
 * One table's comparison against every breakpoint that carries it.
 *
 * Every table below reports the same five ways, because each of them is a
 * distinct failure and reporting only the first is how a guard becomes a
 * printout: a cell that disagrees, a row the frame has dropped, a declaration
 * the frame has caught up on, a declaration keyed at a cell that does not
 * exist, and — the one that would otherwise be invisible — a table whose
 * frame group was not found at all, so that nothing was compared and the
 * silence read as agreement.
 */
const reconciler = (
  table: string,
  declared: Record<string, Divergence>,
  /**
   * Rows we PUBLISH that the frame carries nowhere, each with the reason.
   *
   * The compare grid has had `EXPECTED_MISSING` for this since AGL-1278; the
   * five tables below had nothing, so a row added to the code with no surface
   * on the page could only ever be reported as a flat failure. That is not a
   * theoretical shape: the email-send and assist rates are billed today and
   * appear on no breakpoint, so publishing them here has to be sayable.
   *
   * Checked in BOTH directions, like every other declaration in this file. A
   * key resolves — and fails until the entry is deleted — the moment every
   * breakpoint carries the row, because at that point the cells can be
   * compared for real and an exemption would only hide them again.
   */
  expectedAbsent: Record<string, string> = {},
) => {
  const diffs: string[] = []
  const absent: string[] = []
  /** Keys where at least one breakpoint still shows the declared value. */
  const stillStale = new Set<string>()
  /** Declared-absent keys at least one breakpoint really did not carry. */
  const stillAbsent = new Set<string>()
  const seen = new Set<string>()
  let compared = 0
  return {
    /** Compares one cell, naming the breakpoint it was read from. */
    cell(key: string, ours: string, theirs: string, where: string) {
      compared += 1
      seen.add(key)
      const d = declared[key]
      if (ours === theirs) return
      if (d && theirs === d.frame) {
        stillStale.add(key)
        return
      }
      diffs.push(
        `${key} [${where}]: code=${ours}  frame=${theirs}` +
          (d ? `  (declared stale value was ${d.frame})` : ''),
      )
    },
    /** Records that a breakpoint does not carry something it should. */
    absent(what: string, where: string) {
      absent.push(`${what} [${where}]`)
    },
    /**
     * Records a NAMED row a breakpoint does not carry, honoring a declaration.
     *
     * Separate from `absent` above because only a named row can be declared:
     * the structural complaints that go through `absent` ("no plan header",
     * "an unrecognized column header") describe a frame we cannot read at all,
     * and excusing one of those would excuse the reader silently finding
     * nothing — which is the failure this whole section exists to make loud.
     */
    absentRow(key: string, where: string) {
      if (key in expectedAbsent) {
        stillAbsent.add(key)
        return
      }
      absent.push(`${key} [${where}]`)
    },
    /** How many cells this table actually compared, for the summary line. */
    get compared() {
      return compared
    },
    finish() {
      fail(`${table}: rows the frame does not carry`, absent)
      fail(
        `${table}: CODE-vs-FRAME disagreements not declared (the code wins — the frame is stale)`,
        diffs,
      )
      fail(
        `${table}: declared stale but every breakpoint has CAUGHT UP — delete the declaration`,
        Object.keys(declared).filter((k) => seen.has(k) && !stillStale.has(k)),
      )
      fail(
        `${table}: declared stale but no breakpoint carries that cell — delete the declaration`,
        Object.keys(declared).filter((k) => !seen.has(k)),
      )
      // The absence declaration, checked the way every other one here is: an
      // entry that has stopped diverging fails. Nothing reported the row
      // missing, so either every breakpoint now carries it — in which case the
      // cells can be compared for real and the entry would go on excusing
      // them — or the row is no longer emitted and the entry excuses a row
      // that does not exist. Both readings end in deleting it, which is why
      // one message can name both.
      fail(
        `${table}: declared absent from the frame but no breakpoint reported it ` +
          `missing — either the page has caught up (delete the declaration and ` +
          `let the cells compare) or the row is gone (delete it with the row)`,
        frames.length
          ? Object.keys(expectedAbsent).filter((k) => !stillAbsent.has(k))
          : [],
      )
      if (frames.length && compared === 0) {
        problems.push(
          `${table}: reconciled ZERO cells — no breakpoint carried the group this ` +
            `reads, so the table is guarded by nothing and reports clean either way`,
        )
      }
    },
  }
}

const planByLabel = new Map<string, Plan>(
  PLANS.map((p) => [PLAN_LABELS[p], p] as const),
)

/**
 * Which plan a mobile export is showing. The mobile compare grid and the
 * mobile add-on table each render ONE selected plan rather than all eight, so
 * every mobile cell has to be attributed to the plan the frame chose before it
 * can be compared — reading it off the frame rather than assuming Pro, since
 * the selected plan is a design choice that can change without telling us.
 */
const mobileSelectedPlan = (v: FrameView): Plan | null => {
  const sel = records(v, 'Compare features', 'Selected plan')
  const label = sel?.[0]?.cells[0]
  return label ? planByLabel.get(label) ?? null : null
}

/*==========================================
 * THE PLAN COLUMNS — header and price strip.
 *
 * `compare.columns` is the one place on the page where a plan's own monthly
 * price is stated, which makes its eight cells the highest-consequence cells
 * in the file: a wrong number here is a wrong number in the largest type on
 * the page. The two records are found by their Figma layer name because that
 * is all the extractor gives them — the header carries plan LABELS and the
 * strip carries `priceLabel`s, neither of which is a feature spec, so they
 * cannot be compared by the row loop above and have to be compared here.
 *=========================================*/
const COLUMNS_STALE: Record<string, Divergence> = {
  'price · Agency': {
    frame: '$799',
    why: 'the repricing is decided in the code and NOT chargeable yet: Stripe prices are immutable, the live SKUs are `aglyn_agency_v2` at $799 and `_yearly` at $7,788, and $1,299 needs new price objects plus new `STRIPE_PRICE_AGENCY` / `STRIPE_PRICE_AGENCY_YEARLY` values (`apps/console/specs/published-pricing-table-parity.spec.ts`). Publishing it first would quote a price the checkout cannot take — which is the one direction of drift the frame must NOT be dragged in',
  },
}

const columns = reconciler('plan columns', COLUMNS_STALE)
const columnByPlan = new Map(compare.columns.map((c) => [c.plan, c] as const))

for (const v of frames) {
  const wide = records(v, 'Compare features', 'Feature table')
  if (wide) {
    const furniture = wide.filter(
      (r) =>
        r.cells[0] === FRAME_FURNITURE_LABEL && r.cells.length === FRAME_ROW_CELLS,
    )
    if (furniture.length !== 2) {
      columns.absent(
        `${furniture.length} header/price records named "${FRAME_FURNITURE_LABEL}", expected 2`,
        v.name,
      )
      continue
    }
    // Order, not name: both records are called after the same Figma layer, and
    // the header is drawn above the strip.
    const [header, prices] = furniture
    framePlanOrder.forEach((p, i) => {
      const col = columnByPlan.get(p)!
      columns.cell(`plan name · ${col.label}`, col.label, header.cells[i + 1], v.name)
      columns.cell(`price · ${col.label}`, col.priceLabel, prices.cells[i + 1], v.name)
    })
    continue
  }

  const selector = records(v, 'Compare features', 'Plan selector')
  if (selector?.[0]) {
    framePlanOrder.forEach((p, i) => {
      const col = columnByPlan.get(p)!
      columns.cell(
        `plan name · ${col.label}`,
        col.label,
        selector[0].cells[i],
        v.name,
      )
    })
  } else {
    columns.absent('no plan header — neither a "Feature table" nor a "Plan selector"', v.name)
  }
  const selected = mobileSelectedPlan(v)
  const price = records(v, 'Compare features', 'Selected plan')?.[1]?.cells[0]
  if (selected && price !== undefined) {
    const col = columnByPlan.get(selected)!
    columns.cell(`price · ${col.label}`, col.priceLabel, price, v.name)
  } else {
    columns.absent('no selected-plan price', v.name)
  }
}

columns.finish()

/*==========================================
 * THE "NEED MORE SCALE?" STRIP.
 *
 * Four cards of almost pure claim — a price, a positioning line and six spec
 * tokens apiece, every token a figure read from `PLAN_ENTITLEMENTS`.
 *
 * The tokens are compared one at a time rather than as one joined line so a
 * disagreement names the fact that moved, instead of reprinting sixty
 * characters twice and leaving the reader to find the difference. The frame
 * writes them as a single ` · `-joined string, which is why the count can
 * disagree as well as the contents.
 *=========================================*/
const TIERS_STALE: Record<string, Divergence> = {
  'Agency · price': {
    frame: '$799 /mo',
    why: 'the same unshipped repricing as `price · Agency` in the plan columns above, and stale for the same reason: the strip and the compare grid state one price twice, so they resolve together or the page contradicts itself',
  },
  'Agency · spec 6': {
    frame: '20 POS registers',
    why: 'AGL-1775 made `posRegisters` the PER-SITE cap, so an org running five locations needs five; the rename is ours and the frame still carries the org-wide phrasing, exactly as the compare table\'s `frameLabel` records for the same row',
  },
  'Enterprise · spec 5': {
    frame: 'SLA & dedicated support',
    why: 'AGL-2411 took the uptime-SLA claim off the live page and the page\'s own FAQ now denies one during public beta; dedicated support is real and stays, the SLA half is not and the frame is the last artifact still selling it',
  },
}

const tierStrip = reconciler('scale strip', TIERS_STALE)
const TIER_CARDS = [...tiers.rows, tiers.enterprise]
const tierLabels = new Set(TIER_CARDS.map((t) => t.label))

for (const v of frames) {
  const strip = records(v, 'Plans', 'scale-strip')
  if (!strip) {
    tierStrip.absent('no "Plans / scale-strip" group', v.name)
    continue
  }
  // The frame writes the heading and the lede into one text node.
  if (strip[0]) {
    tierStrip.cell('heading', `${tiers.heading} ${tiers.lede}`, strip[0].cells[0], v.name)
  } else {
    tierStrip.absent('no heading record', v.name)
  }

  /** label → the three records the frame draws for that card, in order. */
  const cards = new Map<string, { price: string; blurb: string; specs: string; cta: string }>()
  strip.forEach((rec, i) => {
    if (rec.cells.length !== 2 || !tierLabels.has(rec.cells[0])) return
    cards.set(rec.cells[0], {
      price: rec.cells[1],
      blurb: strip[i + 1]?.cells[0] ?? '',
      specs: strip[i + 1]?.cells[1] ?? '',
      cta: strip[i + 2]?.cells[0] ?? '',
    })
  })

  for (const tier of TIER_CARDS) {
    const card = cards.get(tier.label)
    if (!card) {
      tierStrip.absent(`the ${tier.label} card`, v.name)
      continue
    }
    tierStrip.cell(`${tier.label} · price`, tier.priceLabel, card.price, v.name)
    tierStrip.cell(`${tier.label} · blurb`, tier.blurb, card.blurb, v.name)
    tierStrip.cell(`${tier.label} · CTA`, tier.cta, card.cta, v.name)
    const theirs = card.specs.split(' · ')
    tier.specs.forEach((spec, i) => {
      tierStrip.cell(
        `${tier.label} · spec ${i + 1}`,
        spec,
        theirs[i] ?? '(nothing)',
        v.name,
      )
    })
    if (theirs.length > tier.specs.length) {
      tierStrip.absent(
        `the ${tier.label} card carries ${theirs.length} spec tokens, we emit ${tier.specs.length}: ` +
          theirs.slice(tier.specs.length).join(' · '),
        v.name,
      )
    }
  }
}

tierStrip.finish()

/*==========================================
 * THE ADD-ON CAPACITY TABLE.
 *
 * Seven rates across six paid plans, every one of them a price a customer is
 * billed on their next invoice.
 *
 * The contacts row is why a rate and its band have to be checked together. An
 * uncapped plan cannot have an "over", so a dash is the CORRECT cell beside an
 * UNLIMITED band — `checkContactQuota` computes `Math.max(0, used - Infinity)`,
 * which is 0 at every usage level, and a rate there advertises a fee that
 * cannot be charged. Bound the band and the same rule runs in reverse: a
 * finite band with no rate beside it is silently free past the band, so the
 * bound achieves nothing. The pair is only ever right together, and this is
 * what reads the half of it that lives on the page.
 *=========================================*/
const USAGE_STALE: Record<string, Divergence> = {}

/**
 * The two rates the product BILLS and the page has never stated.
 *
 * Not a design opinion and not a stale cell — there is no cell. Every
 * breakpoint's add-on table runs Extra site → Contacts and stops, so both rows
 * below are compared against nothing until the page carries them. Declared so
 * the gap is a recorded fact with an owner rather than a red the next person
 * silences, and so it fails the moment the page catches up, at which point the
 * cells become comparable and this stops being the right way to describe them.
 *
 * What guards the rates MEANWHILE is `--check` diffing the committed
 * `tables.json` against this generator: the figures now exist in a generated
 * artifact, so moving `extraEmailSendsUsdPer1k` or
 * `extraAssistCreditsUsdPer1k` without regenerating fails CI. That is strictly
 * more than they had, which was nothing — but it is NOT a comparison against
 * the page, and the distinction is the whole reason this map states its
 * reasons instead of listing two labels.
 */
const USAGE_EXPECTED_ABSENT: Record<string, string> = {
  'Email sends over included band':
    'the page states an email ALLOWANCE ("Email sends / mo" in the compare grid) and no overage rate, while `priceEmailSendOverage` bills `extraEmailSendsUsdPer1k` on every paid tier — and the cap refuses campaigns only, so transactional mail carries an org past its band with nothing able to stop it. Resolves when `/pricing` carries the row',
  'Assist credits over included band':
    'the page states an assist CAPABILITY ("AI assist ✓" in the compare grid) and no overage rate, while `priceAssistCreditOverage` bills `extraAssistCreditsUsdPer1k` from Pro up. Resolves when `/pricing` carries the row',
}

const addOnRates = reconciler(
  'add-on capacity',
  USAGE_STALE,
  USAGE_EXPECTED_ABSENT,
)
const usageByFrameLabel = new Map(USAGE_ROWS.map((r) => [r.frameLabel, r] as const))

// A declaration keyed at a row we do not emit excuses nothing while reading as
// a considered decision — the same both-directions rule `EXPECTED_MISSING` is
// held to. Checked here rather than inside `finish()` because only this scope
// knows which rows exist.
fail(
  'add-on capacity: declared absent but there is no such add-on row — delete the declaration',
  Object.keys(USAGE_EXPECTED_ABSENT).filter(
    (label) => !usageByFrameLabel.has(label),
  ),
)

/*
 * THE COMPLETENESS CHECK — a rate the code charges must have a row.
 *
 * Every guard above compares a row we emit against the page. None of them
 * could see a rate with NO row, which is exactly what email sends and assist
 * credits were: billed on real invoices, absent from all six tables, and
 * therefore agreed with by every check in the repo. A reader that only
 * validates what it was pointed at cannot report what it was never pointed at.
 *
 * So the keys are enumerated off `PLAN_PRICING` itself. A rate added to the
 * code with no row here fails on the commit that adds it, rather than after
 * somebody notices an invoice line with no published price.
 */
if (RATE_KEYS.length === 0) {
  // The naming rule stopped matching — a rename would leave this checking an
  // empty set against an empty set and reporting clean.
  problems.push(
    'the add-on rate completeness check enumerated ZERO `extra*` keys from ' +
      'PLAN_PRICING — the naming rule no longer matches, so it is guarding nothing',
  )
}
fail(
  'rates PLAN_PRICING carries that the add-on capacity table does not publish ' +
    '(the product charges them; the page would state them nowhere)',
  UNPUBLISHED_RATES,
)

/** What a plan's cell should say, Enterprise's "Custom" included. */
const usageCell = (row: UsageRow, p: Plan) =>
  p === 'enterprise' ? CUSTOM_LABEL : rowFrameValue(row, p)

for (const v of frames) {
  const wide = records(v, 'Usage pricing', 'Metered table')
  if (wide) {
    // The header names the columns; read the plan order off it rather than
    // assuming ours, so a frame that reordered its columns fails loudly
    // instead of comparing Scale's rate against Advanced's.
    const header = wide.find((r) => r.cells[0] === usage.rowLabel)
    if (!header) {
      addOnRates.absent(`no "${usage.rowLabel}" header row`, v.name)
      continue
    }
    const order = header.cells.slice(1).map((l) => planByLabel.get(l) ?? null)
    for (const row of USAGE_ROWS) {
      const rec = wide.find((r) => r.cells[0] === row.frameLabel)
      if (!rec) {
        addOnRates.absentRow(row.frameLabel, v.name)
        continue
      }
      order.forEach((p, i) => {
        if (!p) {
          addOnRates.absent(`an unrecognized column header "${header.cells[i + 1]}"`, v.name)
          return
        }
        addOnRates.cell(
          `${row.frameLabel} · ${PLAN_LABELS[p]}`,
          usageCell(row, p),
          rec.cells[i + 1],
          v.name,
        )
      })
    }
    continue
  }

  // The mobile shape: one selected plan rendered as two-cell records rather
  // than a full row. A reader written for the wide table finds nothing here
  // and reports clean, which is why the zero-cells guard exists.
  const narrow = records(v, 'Usage pricing', 'Add-on rates · selected plan')
  if (!narrow) {
    addOnRates.absent('no add-on rate table in either shape', v.name)
    continue
  }
  const selected = planByLabel.get(narrow[0]?.cells[0] ?? '')
  if (!selected) {
    addOnRates.absent(`an unrecognized selected plan "${narrow[0]?.cells[0]}"`, v.name)
    continue
  }
  const carried = new Set<string>()
  for (const rec of narrow.slice(1)) {
    const row = usageByFrameLabel.get(rec.cells[0])
    if (!row) {
      addOnRates.absent(`an add-on row we do not emit: "${rec.cells[0]}"`, v.name)
      continue
    }
    carried.add(row.frameLabel)
    addOnRates.cell(
      `${row.frameLabel} · ${PLAN_LABELS[selected]}`,
      usageCell(row, selected),
      rec.cells[1],
      v.name,
    )
  }
  /*
   * The other direction, which this branch never checked.
   *
   * It walks the FRAME's records and looks each one up, so it reported rows
   * the frame carries and we do not — and was structurally blind to rows we
   * publish and the frame does not, the exact half the wide branch above has
   * always reported. A rate could therefore be missing from the mobile page
   * and from this reconciler at the same time, and mobile is the breakpoint
   * whose shape differs most, so it is the likeliest one to fall behind.
   */
  for (const row of USAGE_ROWS) {
    if (!carried.has(row.frameLabel)) addOnRates.absentRow(row.frameLabel, v.name)
  }
}

/**
 * The pass-through strip closes with a sentence naming the dataset-storage
 * retail rate — the same `extraDataGbMonthlyUsd` the row above publishes, and
 * the same number `metered.note` generates. It is prose, which is precisely
 * why it needs reading: a rate written inside a sentence looks like copy and
 * gets edited like copy, while being every bit as much a published price as
 * the cell above it. The rate is extracted and matched exactly; the sentence
 * around it is design copy and may be rewritten freely.
 */
const datasetRate = `${money(PLAN_PRICING.pro.extraDataGbMonthlyUsd)} / GB-mo`
for (const v of frames) {
  const note = records(v, 'Usage pricing', 'pass-through')
    ?.map((r) => r.cells[0])
    .find((c) => c.includes('Dataset storage over your included amount'))
  if (note === undefined) continue
  const stated = /billed separately at (.+)\.\s*$/.exec(note)?.[1] ?? '(no rate stated)'
  addOnRates.cell(
    'Extra data storage · pass-through note',
    datasetRate,
    stated,
    v.name,
  )
}

addOnRates.finish()

/*==========================================
 * THE TRANSACTION-FEE LADDER.
 *
 * `fees` has no surface of its own on the page: the ladder it publishes IS
 * the compare grid's two fee rows, which is where it is reconciled. Thin, but
 * not vacuous — the compare rows apply the `commerce` gate and `fees` does
 * not, so this is the only thing checking that the two agree on the six plans
 * where both state a number, and the only thing that would notice `fees`
 * being wired to the wrong entitlement.
 *
 * NOT reconciled, and deliberately: `fees.marketplace`. The take rate is 20%
 * on every paid plan and 30% on Free, charged in `resolveMarketplaceFeePct`,
 * and the page states it NOWHERE — grepping the frame for "20%", "take rate"
 * and "revenue share" returns nothing. A comparison against a surface that
 * does not exist is the one thing this file must not pretend to make, so it
 * is named here as a gap instead. It closes the day the disclosure ships.
 *=========================================*/
const FEES_STALE: Record<string, Divergence> = {
  'Digital transaction fee · Free': {
    frame: NO,
    why: 'the compare row gates the fee behind `features.commerce`, and Free cannot sell, so the frame publishes a dash where `fees` publishes the 0% the entitlement carries — a fee ladder with a hole in it reads as unknown rather than unavailable',
  },
  'Physical transaction fee · Free': {
    frame: NO,
    why: 'the same commerce gate as the digital row above',
  },
}

const feeLadder = reconciler('transaction fees', FEES_STALE)
const FEE_ROWS = [
  { label: 'Digital transaction fee', value: (r: (typeof fees.rows)[number]) => r.digital },
  { label: 'Physical transaction fee', value: (r: (typeof fees.rows)[number]) => r.physical },
]

for (const v of frames) {
  const wide = records(v, 'Compare features', 'Feature table')
  const narrow = records(v, 'Compare features', 'list')
  const selected = wide ? null : mobileSelectedPlan(v)
  // A selected-plan list whose selected plan cannot be read would otherwise
  // compare all seven plans against the one column it renders, and agree on
  // whichever plan happened to be showing.
  if (!wide && !selected) {
    feeLadder.absent('a fee ladder with no readable plan', v.name)
    continue
  }
  for (const feeRow of FEE_ROWS) {
    const rec = (wide ?? narrow)?.find((r) => r.cells[0] === feeRow.label)
    if (!rec) {
      feeLadder.absent(feeRow.label, v.name)
      continue
    }
    for (const row of fees.rows) {
      // The mobile list renders the selected plan only; every other column is
      // simply not on that breakpoint's page to be compared.
      if (selected && row.plan !== selected) continue
      const i = framePlanOrder.indexOf(row.plan)
      const theirs = wide ? rec.cells[i + 1] : rec.cells[1]
      feeLadder.cell(
        `${feeRow.label} · ${row.label}`,
        feeRow.value(row),
        theirs,
        v.name,
      )
    }
  }
}

feeLadder.finish()

/*==========================================
 * THE OPTIONAL ADD-ON CARDS.
 *
 * Two prices, and the frame writes each of them two ways: bare on the wide
 * breakpoints, with the scope appended on mobile. Both renderings are
 * assembled from the same two code values, so either is matched EXACTLY and
 * neither can carry a stale figure — where a "starts with the price" rule
 * would pass `$89 / mo · per organization` on a per-site add-on.
 *
 * NOT reconciled: `maxQuantity`, `scope` and the per-plan `included` counts.
 * The frame states none of them. `POS_REGISTERS_ADDON_MAX` in particular is
 * the ceiling `POST /api/billing/addons` enforces, and publishing it beside
 * an $89/mo line is what would give it a surface to be checked against.
 *=========================================*/
const ADDONS_STALE: Record<string, Divergence> = {}

const addonCards = reconciler('add-on cards', ADDONS_STALE)
/**
 * What each card is called on the frame. Two names for the register card
 * because the breakpoints disagree with each other — "POS Pro register" on the
 * wide frames, "Extra POS register" on mobile.
 */
const ADDON_FRAME_LABELS: Record<string, string[]> = {
  'Event Calendar': ['Event Calendar (add-on)'],
  'Extra POS register': ['POS Pro register', 'Extra POS register'],
}

for (const v of frames) {
  const cards =
    records(v, 'Usage pricing', 'cards') ??
    records(v, 'Usage pricing', 'Optional add-ons')
  if (!cards) {
    addonCards.absent('no add-on cards in either shape', v.name)
    continue
  }
  for (const row of addons.rows) {
    const names = ADDON_FRAME_LABELS[row.label] ?? [row.label]
    const rec = cards.find((r) => names.includes(r.cells[0]) && r.cells.length > 1)
    if (!rec) {
      addonCards.absent(`the ${row.label} card`, v.name)
      continue
    }
    const bare = `$${row.priceUsd} / mo`
    const scoped = `${bare} · per ${row.scope}`
    addonCards.cell(
      `${row.label} · price`,
      rec.cells[1] === scoped ? scoped : bare,
      rec.cells[1],
      v.name,
    )
  }
}

addonCards.finish()

/*==========================================
 * WHAT IS STILL NOT RECONCILED, AND WHY.
 *
 * Stated here rather than left to be inferred from what the code happens to
 * read: an uncovered surface should be a decision somebody made, not a gap
 * nobody noticed. Each of these is uncheckable for a reason that would stop
 * being true if the page changed, and the entry comes out when it does.
 *
 *   `fees.marketplace` — the take rate is stated NOWHERE on the page.
 *     Grepping the extractions for "20%", "take rate" and "revenue share"
 *     returns nothing, and `/product/plugins` is silent too. Comparing
 *     against a surface that does not exist is the one thing this file must
 *     not pretend to do; it is reconciled the day the disclosure ships.
 *
 *   The EMAIL-SEND and ASSIST overage rates, declared in
 *     `USAGE_EXPECTED_ABSENT`. Both are emitted into the add-on capacity
 *     table and both are billed today, and no breakpoint states either, so
 *     there is no cell to compare against — the same "no surface exists"
 *     shape as the marketplace take rate above, differing only in that these
 *     two now HAVE a generated figure for the besigner edit to transcribe.
 *     `--check` guards them against code drift meanwhile; it does not
 *     compare them against the page, and will not until the rows ship.
 *
 *   `addons.rows[].maxQuantity`, `.scope`, `.included` — the cards publish a
 *     price and a sentence. `POS_REGISTERS_ADDON_MAX` in particular is a
 *     ceiling the checkout enforces and the page never mentions, so there is
 *     nothing to disagree with.
 *
 *   `tiers.rows[].annualLabel` and `byInterval` — the strip is authored
 *     OUTSIDE the Monthly/Annual tabs, so the frame carries one headline
 *     price per card and no `interval` on the CTA. The generated cadence copy
 *     is what the strip SHOULD publish, not a transcription of what it does.
 *
 *   The compare grid and the pass-through strip on breakpoints OTHER than the
 *     one `--frame` names. Both read the primary export only. The tablet and
 *     widescreen exports carry those two groups cell-identical to the desktop
 *     one, so the practical exposure is the mobile export, whose compare grid
 *     is a selected-plan list rendering booleans as "✓ Included" and whose
 *     metered strip is three records per row. Its transaction-fee rows ARE
 *     read, by the fee ladder above, which is how the shape is known to
 *     differ.
 *
 *   The four plan CARDS in `Plans / row`. Their headline prices and feature
 *     bullets are claims, but this file emits no table for them — the cards
 *     are authored copy, and generating them is a larger change than giving
 *     an existing generated table a reader.
 *=========================================*/

const literals = GROUPS.flatMap((g) =>
  g.rows.filter((r) => r.literal).map((r) => ({ label: r.label, why: r.literal })),
)

fail('frame records that are not a full plan row', malformed)
fail(
  'CODE-vs-FRAME disagreements (the code wins — but say so deliberately)',
  diffs,
)
fail(
  'cells declared stale in FRAME_STALE_CELLS that the frame has CAUGHT UP on — delete the declaration',
  staleCellsResolved,
)
fail(
  'declared in FRAME_STALE_CELLS but there is no such cell — delete the declaration',
  Object.keys(FRAME_STALE_CELLS).filter((k) => !comparedCells.has(k)),
)
fail(
  'rows in our spec but NOT in the frame, and not declared in EXPECTED_MISSING',
  missing.filter((m) => !(m in EXPECTED_MISSING)),
)
fail(
  'rows in the frame but NOT in our spec, and not declared in EXPECTED_EXTRA',
  extra.filter((m) => !(m in EXPECTED_EXTRA)),
)
// Both directions, so a declaration cannot outlive the divergence it excuses.
fail(
  'declared in EXPECTED_MISSING but the frame now carries it — delete the entry',
  Object.keys(EXPECTED_MISSING).filter((m) => !missing.includes(m)),
)
fail(
  'declared in EXPECTED_EXTRA but the frame no longer carries it — delete the entry',
  Object.keys(EXPECTED_EXTRA).filter((m) => !extra.includes(m)),
)

// ------------------------------------------------------------- output

const payload =
  JSON.stringify(
    {
      source: 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
      generatedBy: 'tools/marketing/build-pricing-tables.mts',
      notes:
        'Every value here is READ FROM CODE, never transcribed from Figma, ' +
        'except the rows named in `literals` below. The frame supplies the ' +
        'shape (which rows, in which groups); the code supplies the values. ' +
        'Regenerate rather than hand-edit: `npm run check:pricing-tables` ' +
        'fails when this file and the code disagree.',
      literals,
      compare,
      tiers,
      usage,
      metered,
      fees,
      addons,
    },
    null,
    2,
  ) + '\n'

const outFile = join(outDir, 'tables.json')

console.log(`compare: ${compare.groups.length} groups, ` +
  `${compare.groups.reduce((a, g) => a + g.rows.length, 0)} rows, ` +
  `${compare.columns.length} plan columns`)
console.log(`usage:   ${usage.rows.length} rows, ${usage.columns.length} columns`)
console.log(`metered: ${metered.rows.length} pass-through rows`)
metered.rows.forEach((r) =>
  console.log(`  ${r.label}: cost ${r.ourCost} → you pay ${r.youPay}`),
)
console.log(`fees:    ${fees.rows.length} storefront rows`)
console.log(
  `marketplace take rate: ` +
    fees.marketplace.rows.map((r) => `${r.label} ${r.takeRate}`).join(' · '),
)
console.log(`literal (not read from code) rows: ${literals.length}`)
literals.forEach((l) => console.log(`  ${l.label} — ${l.why}`))
console.log()
console.log(`declared divergences from the frame: ` +
  `${Object.keys(EXPECTED_MISSING).length} ours-only, ` +
  `${Object.keys(EXPECTED_EXTRA).length} frame-only`)
// Printed because a reconciler that silently matched NOTHING would report
// exactly as clean as one that matched everything. A zero here is a failure
// (`reconciled ZERO cells`), and a number that collapses is visible in a diff.
console.log(
  `breakpoints reconciled: ${frames.map((f) => f.name).join(', ') || '(none)'}`,
)
console.log(
  `cells compared: ${comparedCells.size} compare · ${columns.compared} plan columns · ` +
    `${tierStrip.compared} scale strip · ${addOnRates.compared} add-on capacity · ` +
    `${feeLadder.compared} transaction fees · ${addonCards.compared} add-on cards`,
)

if (checkOnly) {
  let committed: string | null = null
  try {
    committed = readFileSync(outFile, 'utf8')
  } catch {
    problems.push(`${outFile} does not exist — run the generator`)
  }
  if (committed !== null && committed !== payload) {
    // The failure this mode exists for: AGL-2133 removed a row from the
    // generator and left the generated file publishing a cap for an
    // entitlement that no longer exists, because nothing regenerated or
    // diffed it.
    problems.push(
      `${outFile} is STALE — regenerate it:\n` +
        `  SWC_NODE_PROJECT=tools/marketing/tsconfig.tables.json \\\n` +
        `    node --import @swc-node/register/esm-register \\\n` +
        `    tools/marketing/build-pricing-tables.mts`,
    )
  }
} else {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outFile, payload)
  console.log(`wrote ${outFile}`)
}

if (problems.length) {
  console.error('\nRECONCILIATION FAILED')
  problems.forEach((p) => console.error(`\n${p}`))
  process.exit(1)
}
console.log('\nreconciliation clean')
