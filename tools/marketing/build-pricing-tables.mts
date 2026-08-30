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

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
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
       * Two form rows, adjacent on purpose, because they answer the two
       * questions a buyer actually asks and they are not the same question:
       * how many intake forms may I BUILD, and how many replies may they
       * RECEIVE. Split apart they read as one number stated twice.
       *
       * The count is a catalog size. A form left unbound to a saved
       * definition still collects, so the row below never gates the row
       * above — submissions are metered revenue, and a count ceiling that
       * turned into a submissions gate would refuse money as well as data.
       */
      {
        label: 'Saved forms per site',
        value: talk((p) => num(E(p).formsPerHost)),
      },
      {
        label: 'Form submissions / mo',
        value: talk((p) => num(E(p).formSubmissionsPerMonth)),
      },
      { label: 'Contacts included', value: talk((p) => num(E(p).contactsPerHost)) },
      { label: 'Email sends / mo', value: talk((p) => num(E(p).emailSendsPerMonth)) },
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

const USAGE_ROWS: Array<{ label: string; value: (p: Plan) => string }> = [
  {
    label: 'Extra site, per month',
    value: (p) => money(PLAN_PRICING[p].extraHostMonthlyUsd),
  },
  {
    label: 'Extra team seat, per month',
    value: (p) => money(PLAN_PRICING[p].extraSeatMonthlyUsd),
  },
  {
    label: 'Extra site collaborator, per month',
    value: (p) => money(PLAN_PRICING[p].extraCollaboratorMonthlyUsd),
  },
  {
    label: 'Extra dataset, per month',
    value: (p) => money(PLAN_PRICING[p].extraDatasetMonthlyUsd),
  },
  {
    label: 'Extra data storage, per GB-month',
    value: (p) => money(PLAN_PRICING[p].extraDataGbMonthlyUsd),
  },
  {
    label: 'API requests, per 1,000 over limit',
    value: (p) => money(PLAN_PRICING[p].extraApiRequestsUsdPer1k),
  },
  {
    label: 'Contacts, per 1,000 over the included band',
    value: (p) => money(PLAN_PRICING[p].extraContactsUsdPer1k),
  },
]

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
    values: Object.fromEntries(
      USAGE_PLANS.map((p) => [
        p,
        p === 'enterprise' ? CUSTOM_LABEL : r.value(p),
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
for (const rec of frameTable?.records ?? []) {
  const label = rec.cells[0]
  if (rec.cells.length === FRAME_ROW_CELLS) {
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
  'Saved forms per site':
    'the form catalog became a plan dimension after the frame was drawn; the frame publishes only the submissions band beside it, so there is no cell to reconcile until `/pricing` and the Figma table gain the row',
  'Single sign-on (SAML/OIDC)':
    'added beyond the frame when AGL-1210 shipped self-serve SSO; `ssoEnabled` is real and Enterprise-only, and the page said so before the design did',
}

/** Rows the FRAME carries that we deliberately do not emit, each with why. */
const EXPECTED_EXTRA: Record<string, string> = {
  'Total site size':
    'AGL-2133 retired `totalSiteSizeMb`: it was enforced by nothing, and AGL-678 caps a node map at 900 KB, so the measurable org total can only reach a fraction of it. There is no number left to publish',
  // Two records, both named for their Figma layer rather than for a feature:
  // the header row (Free…Enterprise) and the price strip ($0…Custom). They
  // are table furniture with a full complement of cells, which is why they
  // reach this list rather than the group-band branch above.
  Text: 'the table header row and the price strip, whose first cell is the Figma layer name rather than a feature label',
}

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
}

const diffs: string[] = []
/** Declared-stale cells the frame has since caught up on. */
const staleCellsResolved: string[] = []
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
