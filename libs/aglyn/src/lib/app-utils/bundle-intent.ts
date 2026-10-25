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
 * THE ADD-ONS A PLAN SELLS, AND THE BUNDLE A LINK ASKS FOR (AGL-3955).
 *
 * One list of add-on kinds and one parser for the add-ons a link, an upgrade
 * proposal or a staff dialog names, so the Billing card, the bundle checkout
 * link, the hand-off proposal (AGL-3956) and `/api/billing/checkout` agree on
 * what `addons=siteCare,ai,extraHost:2` means.
 *
 * The kinds are `OrgSeatAddons`' keys: what `resolvePurchasedAddons` counts,
 * what the webhook mirrors from Stripe, and what `/api/billing/addons` sells.
 * The prices and ceilings here are the ones `billing-addons.ts` (server)
 * re-exports, so a kind the link can preselect is always a kind the
 * checkout can price.
 *
 * A link is typed by a person and passed through hops nobody controls, so
 * the parser never throws and never guesses: an unknown token is dropped and
 * reported, so the page can say so in one line instead of failing.
 */

import type {
  AiTierId,
  OrgPlan,
  OrgSeatAddons,
} from '../foundation/definitions/org-billing.types'
import {
  AI_TIER_IDS,
  AI_TIERS,
  aiAddonName,
  aiTierAddonKey,
  aiTierName,
  defaultAiTierForPlan,
  EVENT_CALENDAR_ADDON_MONTHLY_USD,
  EXTRA_HOSTS_ADDON_MAX,
  isAiTierId,
  PLAN_LABELS,
  parseAiTierAddonKey,
  PLAN_PRICING,
  planSellsAiTiers,
  planSellsSiteCare,
  POS_REGISTER_ADDON_MONTHLY_USD,
  POS_REGISTERS_ADDON_MAX,
  resolveOrgEntitlements,
  SITE_CARE_ADDON_MONTHLY_USD,
  UNLIMITED,
} from './plan-entitlements'

/** An add-on kind: a key of `org.seatAddons`. */
export type AddonKind = keyof Required<OrgSeatAddons>

/**
 * Every add-on kind Billing sells, in the order the Billing card lists them.
 * `/api/billing/addons`, the webhook's price map and the native add-ons
 * screen all read this list.
 */
export const ADDON_KINDS: readonly AddonKind[] = [
  'managers',
  'members',
  'datasets',
  'hosts',
  'posRegisters',
  'eventCalendar',
  'aiAddon',
  'siteCare',
]

/** The org-wide 0/1 kinds: one purchase covers the workspace. */
export const TOGGLE_ADDON_KIND_LIST: readonly AddonKind[] = [
  'eventCalendar',
  'aiAddon',
  'siteCare',
]

export function isAddonKind(value: unknown): value is AddonKind {
  return typeof value === 'string' && (ADDON_KINDS as readonly string[]).includes(value)
}

/**
 * Monthly USD per unit for an add-on on a plan (yearly prices are ×12 of
 * this); null when the plan doesn't sell the kind. Single pricing source
 * of truth: `PLAN_PRICING`, the three flat add-on constants and `AI_TIERS`
 * (`tier` as `addonPriceId` reads it; absent, the tier a plan-named purchase
 * means, `defaultAiTierForPlan`, AGL-3965).
 */
export function addonUnitUsd(
  kind: AddonKind,
  plan: OrgPlan,
  tier?: AiTierId | null,
): number | null {
  const pricing = PLAN_PRICING[plan]
  switch (kind) {
    case 'managers':
      return pricing.extraSeatMonthlyUsd
    case 'members':
      return pricing.extraCollaboratorMonthlyUsd
    case 'datasets':
      return pricing.extraDatasetMonthlyUsd
    case 'hosts':
      return pricing.extraHostMonthlyUsd
    case 'posRegisters':
      return POS_REGISTER_ADDON_MONTHLY_USD
    case 'eventCalendar':
      return EVENT_CALENDAR_ADDON_MONTHLY_USD
    case 'aiAddon': {
      const chosen = planSellsAiTiers(plan) ? (tier ?? defaultAiTierForPlan(plan)) : null
      return chosen ? AI_TIERS[chosen].monthlyUsd : null
    }
    case 'siteCare':
      return SITE_CARE_ADDON_MONTHLY_USD
  }
}

/**
 * Max purchasable quantity per kind, from a purchases-free entitlement
 * resolution (plan defaults + staff overrides only) so the ceiling does not
 * drift as the org buys: seat/dataset kinds stop at the plan's hard max,
 * hosts/registers use flat ceilings, the Event Calendar, Aglyn AI and Site
 * Care are 0/1 toggles. POS registers additionally require the `pos`
 * feature, and Site Care a plan that sells it (`planSellsSiteCare`), which is
 * why the plan travels with the baseline.
 *
 * One definition for every reader: `/api/billing/addons` asks how many the
 * org may buy on its plan, a plan change asks how many of what it bought the
 * new plan can deliver, and a bundle link asks how many it may preselect.
 */
export function addonMaxForBaseline(
  kind: AddonKind,
  baseline: ReturnType<typeof resolveOrgEntitlements>,
  plan: OrgPlan,
): number {
  const bounded = (included: number, max: number) =>
    Number.isFinite(max) ? Math.max(0, max - included) : EXTRA_HOSTS_ADDON_MAX
  switch (kind) {
    case 'managers':
      return bounded(baseline.managersPerOrg, baseline.maxManagersPerOrg)
    case 'members':
      return bounded(baseline.membersPerHost, baseline.maxMembersPerHost)
    case 'datasets':
      return bounded(baseline.datasetsPerOrg, baseline.maxDatasetsPerOrg)
    case 'hosts':
      return baseline.hostLimit === UNLIMITED ? 0 : EXTRA_HOSTS_ADDON_MAX
    case 'posRegisters':
      return baseline.features.pos ? POS_REGISTERS_ADDON_MAX : 0
    case 'eventCalendar':
      return 1
    case 'aiAddon':
      // Org-wide like the Event Calendar: one purchase, of one tier, on any
      // plan that sells tiers (AGL-3965) — not Free, not Enterprise.
      return planSellsAiTiers(plan) ? 1 : 0
    case 'siteCare':
      // Flat-priced, so the price map cannot say "not sold here" the way it
      // does for Aglyn AI. This ceiling is the rule that keeps Free (no
      // subscription) and Enterprise (quoted per deal) from buying it.
      return planSellsSiteCare(plan) ? 1 : 0
  }
}

/** The ceiling a PLAN would impose on an add-on kind, purchases excluded. */
export function addonMaxForPlan(kind: AddonKind, plan: OrgPlan): number {
  return addonMaxForBaseline(
    kind,
    resolveOrgEntitlements({ plan } as never),
    plan,
  )
}

/** Whether a plan sells an add-on at all: priced, with a ceiling above zero. */
export function planSellsAddon(kind: AddonKind, plan: OrgPlan): boolean {
  return addonUnitUsd(kind, plan) != null && addonMaxForPlan(kind, plan) > 0
}

/**
 * The first of `plans` (listed smallest first) that sells an add-on kind, or
 * null when none does: the plan a picker names beside an add-on the chosen
 * plan does not sell, so it shows as "needs Pro or higher" rather than
 * vanishing (AGL-4025). POS registers need a plan with the point of sale.
 */
export function firstPlanSellingAddon(
  kind: AddonKind,
  plans: readonly OrgPlan[],
): OrgPlan | null {
  return plans.find((plan) => planSellsAddon(kind, plan)) ?? null
}

/** Quantities by kind, absent kinds meaning none. */
export type BundleAddons = Partial<Record<AddonKind, number>>

/**
 * What a link writes for each kind. `ai` and `extraHost` are the words the
 * account owner chose (AGL-3955); the rest follow the same shape.
 */
export const BUNDLE_ADDON_TOKENS: Record<AddonKind, string> = {
  managers: 'extraSeat',
  members: 'extraMember',
  datasets: 'extraDataset',
  hosts: 'extraHost',
  posRegisters: 'posRegister',
  eventCalendar: 'eventCalendar',
  aiAddon: 'ai',
  siteCare: 'siteCare',
}

/**
 * Every spelling the parser accepts, lower-cased: the written token, the
 * stored kind, and the plurals a person types. Exported for the native apps'
 * generated words (AGL-4011), which read a stored proposal the same way.
 */
export const TOKEN_KINDS: Readonly<Record<string, AddonKind>> = (() => {
  const map: Record<string, AddonKind> = {}
  const add = (kind: AddonKind, ...words: string[]) => {
    for (const word of [kind, BUNDLE_ADDON_TOKENS[kind], ...words]) {
      map[word.toLowerCase()] = kind
    }
  }
  add('managers', 'extraSeats', 'seats', 'managerSeats')
  add('members', 'extraMembers', 'collaborators', 'collaboratorSeats')
  add('datasets', 'extraDatasets')
  add('hosts', 'extraHosts', 'extraSite', 'extraSites', 'sites')
  add('posRegisters', 'registers', 'register')
  add('eventCalendar', 'events', 'calendar')
  add('aiAddon', 'aglynAi')
  add('siteCare', 'site-care', 'site_care', 'care')
  return map
})()

/** The most of a quantity kind a link may ask for, before the plan's ceiling. */
const MAX_LINK_QUANTITY = 999

/** One add-on a token names, with the Aglyn AI tier when it names one. */
interface ParsedToken {
  kind: AddonKind
  quantity: number
  tier?: AiTierId
}

/**
 * THE `ai:<tier>` TOKENS (AGL-3965).
 *
 * Aglyn AI is a tier chosen on its own, on any paid plan: `ai:boost` adds
 * Aglyn AI Boost. The words are the tier ids, lower-cased as every token is,
 * and resolve through `parseAiTierAddonKey`, the one spelling of the
 * `ai:<tier>` key. A bare `ai` (or `ai:1`) still means "add it" and sells
 * the plan's default tier (`defaultAiTierForPlan`). An unknown tier is
 * dropped with the notice like any other unknown add-on, never read as
 * "add whichever tier": that would sell a tier nobody chose.
 */
export const AI_ADDON_TIER_TOKENS: Readonly<Record<string, AiTierId>> = Object.freeze(
  Object.fromEntries(AI_TIER_IDS.map((tier) => [tier.toLowerCase(), tier])),
)

export function resolveAiAddonTier(tier: string): ParsedToken | null {
  const word = tier.trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(AI_ADDON_TIER_TOKENS, word)) return null
  const parsed = parseAiTierAddonKey(aiTierAddonKey(AI_ADDON_TIER_TOKENS[word]))
  return parsed ? { kind: 'aiAddon', quantity: 1, tier: parsed } : null
}

export interface ParsedBundleAddons {
  addons: BundleAddons
  /** The tokens nothing understood, as they were written. */
  dropped: string[]
  /** The Aglyn AI tier an `ai:<tier>` token named (AGL-3965), if any. */
  aiTier?: AiTierId
}

/** One token, `kind` or `kind:quantity`, or null when nothing understands it. */
function parseToken(raw: string): ParsedToken | null {
  const token = raw.trim()
  if (!token) return null
  const [name, ...rest] = token.split(':')
  const kind = TOKEN_KINDS[name.trim().toLowerCase()]
  if (!kind) return null
  const value = rest.join(':').trim()
  if (!value) return { kind, quantity: 1 }
  if (/^\d+$/.test(value)) {
    const quantity = Math.min(MAX_LINK_QUANTITY, Number(value))
    if (quantity < 1) return null
    return {
      kind,
      quantity: (TOGGLE_ADDON_KIND_LIST as readonly string[]).includes(kind) ? 1 : quantity,
    }
  }
  return kind === 'aiAddon' ? resolveAiAddonTier(value) : null
}

/**
 * Read the add-ons a link, a proposal or a request names.
 *
 * Accepts the link form (`"siteCare,ai,extraHost:2"`), a list of tokens, or a
 * map of kind → quantity or flag (`{ siteCare: true, hosts: 2 }`, the shape
 * the native staff screens post from their toggles). Never throws: anything
 * it cannot read is reported in `dropped` and left out.
 */
export function parseBundleAddons(input: unknown): ParsedBundleAddons {
  const addons: BundleAddons = {}
  const dropped: string[] = []
  let aiTier: AiTierId | undefined
  const take = (parsed: ParsedToken | null, raw: string) => {
    if (!parsed) {
      if (raw.trim()) dropped.push(raw.trim().slice(0, 40))
      return
    }
    addons[parsed.kind] = Math.max(addons[parsed.kind] ?? 0, parsed.quantity)
    // The first tier named wins: one workspace holds one tier.
    if (parsed.tier && !aiTier) aiTier = parsed.tier
  }
  if (typeof input === 'string') {
    for (const raw of input.split(/[,\s]+/)) take(parseToken(raw), raw)
  } else if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw === 'string') take(parseToken(raw), raw)
    }
  } else if (input && typeof input === 'object') {
    for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
      const off =
        value === false ||
        value === 0 ||
        value === null ||
        value === undefined ||
        value === '' ||
        value === 'false' ||
        value === '0'
      if (off) continue
      const quantity =
        value === true || value === 'true'
          ? ''
          : typeof value === 'number' || typeof value === 'string'
            ? String(value)
            : ''
      take(parseToken(quantity ? `${name}:${quantity}` : name), name)
    }
  }
  return { addons, dropped, ...(aiTier ? { aiTier } : {}) }
}

export interface FittedBundleAddons {
  addons: BundleAddons
  /** Kinds the plan does not sell, dropped. */
  notSold: AddonKind[]
}

/**
 * The add-ons a plan can actually carry: kinds it does not sell are dropped,
 * quantities are held to its ceiling. What a link preselects on one plan is
 * re-fitted when the owner picks another, so the checkout is never asked for
 * something it would refuse.
 */
export function fitBundleAddonsToPlan(
  addons: BundleAddons | null | undefined,
  plan: OrgPlan,
): FittedBundleAddons {
  const fitted: BundleAddons = {}
  const notSold: AddonKind[] = []
  for (const kind of ADDON_KINDS) {
    const wanted = Math.floor(Number(addons?.[kind] ?? 0))
    if (!(wanted > 0)) continue
    if (!planSellsAddon(kind, plan)) {
      notSold.push(kind)
      continue
    }
    fitted[kind] = Math.min(wanted, addonMaxForPlan(kind, plan))
  }
  return { addons: fitted, notSold }
}

/**
 * The add-ons as the link writes them: `siteCare,ai:boost,extraHost:2`.
 * Aglyn AI is written with its tier when one is named (AGL-3965), as bare
 * `ai` otherwise.
 */
export function bundleAddonsParam(
  addons: BundleAddons | null | undefined,
  aiTier?: AiTierId | null,
): string {
  return ADDON_KINDS.filter((kind) => (addons?.[kind] ?? 0) > 0)
    .map((kind) => {
      if (kind === 'aiAddon' && aiTier) return aiTierAddonKey(aiTier)
      const quantity = addons?.[kind] ?? 0
      return quantity > 1 ? `${BUNDLE_ADDON_TOKENS[kind]}:${quantity}` : BUNDLE_ADDON_TOKENS[kind]
    })
    .join(',')
}

/**
 * The Aglyn AI tier a bundle sells (AGL-4025): the tier named, or the plan's
 * default (`defaultAiTierForPlan`) when none is; null when the bundle has no
 * Aglyn AI or the plan sells no tier. A picker shows this tier as chosen, the
 * link writes it as `ai:<tier>`, and checkout charges it, so the three agree.
 */
export function bundleAiTier(
  addons: BundleAddons | null | undefined,
  plan: OrgPlan,
  tier?: AiTierId | null,
): AiTierId | null {
  if (!((addons?.aiAddon ?? 0) > 0) || !planSellsAiTiers(plan)) return null
  return isAiTierId(tier) ? tier : defaultAiTierForPlan(plan)
}

/**
 * What a bundle costs at list price, in cents, before tax and any promotion
 * code (AGL-4026): the plan at its price for the cadence (the annual monthly
 * price × 12 yearly, the monthly price monthly), plus every add-on the plan
 * sells at its unit price × quantity, × 12 yearly as every add-on bills.
 *
 * The figure Billing shows while Stripe cannot price the bundle with tax —
 * no billing address yet, the preview still on its way, or a preview that
 * failed — so the owner always sees what the bundle costs and sees it move
 * as they change it. Never shown in place of Stripe's taxed total.
 */
export function bundleListPriceCents(bundle: {
  plan: OrgPlan
  interval: 'month' | 'year'
  addons?: BundleAddons | null
  aiTier?: AiTierId | null
}): number {
  const pricing = PLAN_PRICING[bundle.plan]
  const yearly = bundle.interval === 'year'
  const base = yearly ? pricing.basePriceAnnualMonthlyUsd * 12 : pricing.basePriceMonthlyUsd
  let cents = Math.round(base * 100)
  const addons = fitBundleAddonsToPlan(bundle.addons, bundle.plan).addons
  for (const kind of ADDON_KINDS) {
    const quantity = addons[kind] ?? 0
    const unit = addonUnitUsd(kind, bundle.plan, kind === 'aiAddon' ? bundle.aiTier : null)
    if (quantity > 0 && unit != null) cents += Math.round(unit * 100) * quantity * (yearly ? 12 : 1)
  }
  return cents
}

/** Whether any add-on is asked for. */
export function hasBundleAddons(addons: BundleAddons | null | undefined): boolean {
  return ADDON_KINDS.some((kind) => (addons?.[kind] ?? 0) > 0)
}

/**
 * How each kind is named to a customer, singular. Aglyn AI carries its tier
 * when one is named: "Aglyn AI Boost" (AGL-3965).
 */
export function bundleAddonLabel(
  kind: AddonKind,
  brand?: string,
  aiTier?: AiTierId | null,
): string {
  switch (kind) {
    case 'managers':
      return 'Extra manager seat'
    case 'members':
      return 'Extra collaborator seat'
    case 'datasets':
      return 'Extra dataset'
    case 'hosts':
      return 'Extra site'
    case 'posRegisters':
      return 'POS register'
    case 'eventCalendar':
      return 'Event Calendar'
    case 'aiAddon':
      return aiTier ? aiTierName(aiTier, brand) : aiAddonName(brand)
    case 'siteCare':
      return 'Site Care'
  }
}

/** "Site Care", "2 × Extra site", "Aglyn AI Boost". */
export function describeBundleAddon(
  kind: AddonKind,
  quantity: number,
  brand?: string,
  aiTier?: AiTierId | null,
): string {
  const label = bundleAddonLabel(kind, brand, aiTier)
  return quantity > 1 ? `${quantity} × ${label}` : label
}

/** The longest coupon code a link carries. Stripe codes are far shorter. */
export const BUNDLE_COUPON_MAX = 64

/**
 * A promotion code as a link carries it, or undefined. Only the characters
 * Stripe allows in a customer-facing code; anything else is not a code
 * somebody was handed, and is dropped rather than sent to Stripe.
 *
 * The code is only APPLIED here. Codes are minted on the staff Coupons page,
 * which audits them; nothing on this path creates one.
 */
export function normalizeBundleCoupon(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const code = raw.trim()
  if (!code || code.length > BUNDLE_COUPON_MAX) return undefined
  return /^[A-Za-z0-9_-]+$/.test(code) ? code : undefined
}

/**
 * A domain name as a bundle carries it — lower-cased, no scheme, no path —
 * or undefined. Whether it is for sale and at what price is the registrar's
 * answer, re-checked at purchase; this only refuses what cannot be a name.
 */
export function normalizeBundleDomain(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
  if (!name || name.length > 253) return undefined
  const labels = name.split('.')
  if (labels.length < 2) return undefined
  const ok = labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  return ok && /^[a-z]{2,63}$/.test(labels[labels.length - 1]) ? name : undefined
}

/** "$15.99". */
export function formatBundleCents(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toFixed(2)}`
}

/**
 * The domain line a bundle shows (AGL-3955): "example.com — $15.99 first
 * year, renews yearly at $15.99". The price is the registrar's at the moment
 * the link was minted; the purchase re-checks it.
 */
export function bundleDomainLine(domain: {
  name: string
  firstYearCents: number
  renewalCents: number
}): string {
  return (
    `${domain.name} — ${formatBundleCents(domain.firstYearCents)} first year, ` +
    `renews yearly at ${formatBundleCents(domain.renewalCents)}`
  )
}

/**
 * The bundle in one line, for an email, a dialog or a snackbar:
 * "Starter with Site Care and Aglyn AI, billed yearly, code BOOTH25".
 */
export function describeBundle(
  bundle: {
    plan: OrgPlan
    addons?: BundleAddons | null
    interval?: 'month' | 'year' | null
    coupon?: string | null
    /** The Aglyn AI tier, named with the AI add-on (AGL-3965). */
    aiTier?: AiTierId | null
  },
  options: { brand?: string } = {},
): string {
  const parts = ADDON_KINDS.filter((kind) => (bundle.addons?.[kind] ?? 0) > 0).map((kind) =>
    describeBundleAddon(kind, bundle.addons?.[kind] ?? 0, options.brand, bundle.aiTier),
  )
  const addons =
    parts.length === 0
      ? ''
      : parts.length === 1
        ? ` with ${parts[0]}`
        : ` with ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const interval =
    bundle.interval === 'year'
      ? ', billed yearly'
      : bundle.interval === 'month'
        ? ', billed monthly'
        : ''
  const coupon = bundle.coupon ? `, code ${bundle.coupon}` : ''
  return `${PLAN_LABELS[bundle.plan] ?? bundle.plan}${addons}${interval}${coupon}`
}
