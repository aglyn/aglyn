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
}

const E = (p: Plan) => PLAN_ENTITLEMENTS[p]
const F = (p: Plan) => PLAN_ENTITLEMENTS[p].features

const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: 'Sites & publishing',
    rows: [
      { label: 'Sites (hosts)', value: (p) => num(E(p).hostLimit) },
      { label: 'Pages per site', value: (p) => num(E(p).screensPerHost) },
      { label: 'Storage per site', value: (p) => mb(E(p).storagePerHostMb) },
      { label: 'Total site size', value: (p) => mb(E(p).totalSiteSizeMb) },
      { label: 'Bandwidth / mo', value: (p) => gb(E(p).bandwidthGb) },
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
        value: (p) => band(E(p).managersPerOrg, E(p).maxManagersPerOrg),
      },
      {
        label: 'Site collaborators',
        value: (p) => band(E(p).membersPerHost, E(p).maxMembersPerHost),
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
        value: (p) => band(E(p).datasetsPerOrg, E(p).maxDatasetsPerOrg),
      },
      { label: 'Records per dataset', value: (p) => num(E(p).recordsPerDataset) },
      { label: 'Variables per site', value: (p) => num(E(p).variablesPerHost) },
      { label: 'Functions per site', value: (p) => num(E(p).functionsPerHost) },
      { label: 'Workflows per site', value: (p) => num(E(p).workflowsPerHost) },
      { label: 'Workflow runs / mo', value: (p) => num(E(p).workflowRunsPerMonth) },
      { label: 'Actions builder', value: (p) => bool(F(p).actions) },
      { label: 'Appointment bookings', value: (p) => bool(F(p).bookings) },
      {
        label: 'Form submissions / mo',
        value: (p) => num(E(p).formSubmissionsPerMonth),
      },
      { label: 'Contacts included', value: (p) => num(E(p).contactsPerHost) },
      { label: 'Email sends / mo', value: (p) => num(E(p).emailSendsPerMonth) },
      { label: 'Video & file uploads', value: (p) => bool(F(p).videoMedia) },
    ],
  },
  {
    title: 'Commerce',
    rows: [
      { label: 'Online store', value: (p) => bool(F(p).commerce) },
      { label: 'Products per site', value: (p) => num(E(p).productsPerHost) },
      { label: 'POS registers', value: (p) => num(E(p).posRegisters) },
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
      { label: 'API access', value: (p) => perMonth(E(p).apiRequestsPerMonth) },
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

const usage = {
  columns: PAID.map((p) => ({ plan: p, label: PLAN_LABELS[p] })),
  rows: USAGE_ROWS.map((r) => ({
    label: r.label,
    values: Object.fromEntries(PAID.map((p) => [p, r.value(p)])),
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
      scope: 'per register',
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
      // The frame writes "Talk to us" / "Custom" wherever Enterprise is
      // quoted per deal. That is a copy choice about a contact-sales motion,
      // not a claim about a number, so it is not drift.
      if (p === 'enterprise' && /^(Talk to us|Custom)$/.test(theirs)) return
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
