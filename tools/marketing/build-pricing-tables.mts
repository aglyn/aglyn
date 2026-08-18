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
} from '../../libs/aglyn/src/lib/app-utils/plan-entitlements.ts'

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
      { label: 'Total site size', value: talk((p) => mb(E(p).totalSiteSizeMb)) },
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
      { label: 'Member accounts', value: () => 'Unlimited' },
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
      // "per site" is load-bearing, not decoration (AGL-1775). Since Zach's
      // 2026-08-17 decision `posRegisters` is the PER-SITE cap — the add-on is
      // a pool whose seats are allocated to one site each, so an org running
      // five locations needs five. Every other per-site limit in this table
      // says so explicitly ("Products per site" is the row directly above),
      // and a bare "POS registers" beside them reads as org-wide by contrast.
      // Ground truth: `resolveHostRegisterCap(org, hostId)` = this cap plus
      // that site's allocated seats.
      {
        label: 'POS registers per site',
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

const fees = {
  rows: PLANS.filter((p) => p !== 'enterprise').map((p) => ({
    plan: p,
    label: PLAN_LABELS[p],
    digital: pct(PLAN_ENTITLEMENTS[p].transactionFeeDigitalPct),
    physical: pct(PLAN_ENTITLEMENTS[p].transactionFeePhysicalPct),
  })),
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
      'SLA & dedicated support',
      'custom contracts',
    ],
    cta: 'CONTACT SALES',
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
      maxQuantity: null,
      included: Object.fromEntries(
        PLANS.map((p) => [p, PLAN_ENTITLEMENTS[p].posRegisters]),
      ),
    },
  ],
}

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, 'tables.json'),
  JSON.stringify(
    {
      source: 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
      generatedBy: 'tools/marketing/build-pricing-tables.mts',
      notes:
        'Every value here is READ FROM CODE, never transcribed from Figma. ' +
        'The frame supplies the shape (which rows, in which groups); the code ' +
        'supplies the values. Regenerate rather than hand-edit.',
      compare,
      tiers,
      usage,
      fees,
      addons,
    },
    null,
    2,
  ) + '\n',
)

// ------------------------------------------------------- reconciliation

const frame = JSON.parse(
  readFileSync(join(OUT, 'copy-desktop.json'), 'utf8'),
) as {
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

const frameRows = new Map<string, string[]>()
for (const rec of frameTable?.records ?? []) {
  if (rec.cells.length === 9) frameRows.set(rec.cells[0], rec.cells.slice(1))
}

const diffs: string[] = []
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
      if (ours !== theirs) {
        diffs.push(`  ${r.label} · ${PLAN_LABELS[p]}: code=${ours}  frame=${theirs}`)
      }
    })
  }
}

const ourLabels = new Set(GROUPS.flatMap((g) => g.rows.map((r) => r.label)))
const extra = [...frameRows.keys()].filter(
  (k) => !ourLabels.has(k) && !['Text', 'Site backup & restore'].includes(k),
)

console.log(`compare: ${compare.groups.length} groups, ` +
  `${compare.groups.reduce((a, g) => a + g.rows.length, 0)} rows, ` +
  `${compare.columns.length} plan columns`)
console.log(`usage:   ${usage.rows.length} rows, ${usage.columns.length} columns`)
console.log(`fees:    ${fees.rows.length} rows`)
console.log()
console.log(`rows in our spec but NOT in the frame (${missing.length}):`)
missing.forEach((m) => console.log(`  ${m}`))
console.log(`rows in the frame but NOT in our spec (${extra.length}):`)
extra.forEach((m) => console.log(`  ${m}`))
console.log()
console.log(`CODE-vs-FRAME disagreements (${diffs.length}) — code wins, but here they are:`)
diffs.forEach((d) => console.log(d))
