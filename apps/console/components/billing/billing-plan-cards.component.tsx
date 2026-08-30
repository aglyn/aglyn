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
'use client'

import {
  type AglynOrgBilling,
  checkEntitlement,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  PLAN_PRICING,
  PLATFORM_BRAND_NAME,
  resolveOrgEntitlements,
  resolveTransactionFeePct,
  SELF_SERVE_PLANS,
  type OrgPlan,
  UNLIMITED,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
  ICON_VARIANT_SYMBOL_MINUS,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import useBranding from '../../hooks/use-branding'
import { ENTERPRISE_CONTACT_URL } from '../../constants/shared'
import { DocsHelpTip } from '../docs-help-tip.component'

/**
 * The tiers this grid sells, in ladder order. Enterprise is deliberately NOT
 * here (AGL-1118) — it has no list price and is provisioned by staff, so it
 * gets its own contact-sales card below the grid instead of an Upgrade button.
 */
export const PLAN_ORDER: OrgPlan[] = SELF_SERVE_PLANS

export { PLAN_LABELS }

const planTaglines = (brand: string): Record<OrgPlan, string> => ({
  free: `Try ${brand} and publish your first site.`,
  starter: 'Everything a single production site needs.',
  pro: 'For growing teams shipping several sites.',
  business: 'Subscriptions, scheduling, and priority limits.',
  scale: 'Room to grow — 15 sites and a 1% platform fee.',
  advanced: 'High-volume commerce with zero platform fees.',
  agency: 'Run many sites under one org at agency scale.',
  enterprise: 'Unlimited everything, SSO, and a dedicated agreement.',
})

/**
 * What the Enterprise card promises over Agency (the top self-serve tier) —
 * and, for an org already ON an Enterprise arrangement, whether it actually
 * holds each one (AGL-2297).
 *
 * ## Why every row carries a predicate
 *
 * This was a bare `string[]` rendered with a green tick beside each line,
 * unconditionally. That is fine for a PROSPECT, where the card is an offer
 * describing the tier. It was wrong for a customer, because `isEnterpriseOrg`
 * is true in three ways and only one of them grants anything:
 *
 *  - `plan === 'enterprise'` — resolves the Enterprise entitlement row;
 *  - `org.enterprise === true` — a comped marker, read NOWHERE except
 *    `isEnterpriseOrg`;
 *  - `subscription.customMonthlyUsd > 0` — a negotiated price, also read
 *    nowhere else.
 *
 * The last two are display overlays on a LOWER base plan. `ssoEnabled`'s own
 * docblock says so outright: a legacy enterprise org gets SSO through a
 * per-org `entitlements` override, "which is how enterprise orgs provisioned
 * before that plan existed still get it". So an org whose overrides granted
 * SSO but not white-label was shown a green tick against **"Full white-label —
 * your brand, not ours"** above a `Current plan` badge, while the branding card
 * two pages away correctly refused it as not entitled.
 *
 * ## Why derived rather than hand-written
 *
 * The feature grid 500 lines below already carries `FEATURE_ROW_EXCLUSIONS`
 * with the reason spelled out — "a hand-written row list with no derivation is
 * what decayed to 19 of 34 (AGL-2079)". This list was exactly that artifact,
 * sitting above the guard built to prevent it. Each row now ASKS the
 * entitlement model rather than asserting an answer, so a re-cut tier moves
 * the card with it.
 *
 * ⚠️ Two labels here are advertising claims the code cannot make true, and
 * they are deliberately NOT edited to match reality:
 *   - **OIDC.** No OIDC code path exists — `/api/orgs/sso` hardcodes
 *     `protocol: 'saml'` at both write sites, and `enterprise/sso.md` is
 *     titled "Single sign-on (SAML)" and never mentions OIDC. Building it is a
 *     real feature, not a copy fix, so the claim stands until that decision is
 *     made. Tracked on AGL-2297.
 *   - **"every sale"** → corrected to **storefront sales**, because
 *     `marketplaceFeePct` is 20 on Enterprise exactly as on every paid tier,
 *     and the price list is frozen — so "change the product to match the
 *     advertising" is not available here. `billing-and-plans/overview.md`
 *     already scopes the 0% to storefront sales; this makes the card agree
 *     with the price list rather than overstate it.
 */
export const ENTERPRISE_HIGHLIGHTS: Array<{
  label: string
  /** Whether THIS org actually holds the claim. */
  holds: (org: Partial<AglynOrgBilling> | null | undefined) => boolean
}> = [
  {
    label: 'Unlimited sites, screens, seats, and storage',
    holds: (org) => {
      const entitlements = resolveOrgEntitlements(org)
      return (
        entitlements.hostLimit === UNLIMITED &&
        entitlements.screensPerHost === UNLIMITED &&
        entitlements.managersPerOrg === UNLIMITED &&
        entitlements.storagePerHostMb === UNLIMITED
      )
    },
  },
  {
    label: 'SAML / OIDC single sign-on for your whole team',
    holds: (org) => checkEntitlement(org, 'ssoEnabled'),
  },
  {
    label: 'Full white-label — your brand, not ours',
    holds: (org) => checkEntitlement(org, 'whiteLabel'),
  },
  {
    // Bookings ride the digital axis too (AGL-2315), so the predicate below
    // was already right — only the wording scoped it to the storefront. It
    // still has to say WHICH sales, though: `marketplaceFeePct` is 20 on
    // Enterprise exactly as on every paid tier, so a bare "sales" promises a
    // 0% that is not on the price list (AGL-2297, re-broken and re-fixed in
    // AGL-2365).
    //
    // "plus card processing at cost" is AGL-2152. The PLATFORM fee really is
    // 0% and the predicate below still says so; what the old label left out is
    // that a storefront sale is a Stripe destination charge, so Stripe's own
    // fee is debited from the platform's balance on every order. Aglyn used to
    // absorb it silently — an Enterprise card promising a free payment rail
    // that cost Aglyn ~$1,450 a month on a $50k-GMV storefront.
    label:
      '0% platform fees on storefront sales and bookings, plus card ' +
      'processing at cost',
    holds: (org) =>
      resolveTransactionFeePct(org, 'physical') === 0 &&
      resolveTransactionFeePct(org, 'digital') === 0,
  },
  {
    // Not an entitlement — it is what having an agreement at all means, and
    // every org this card marks as current has one by construction.
    label: 'Custom pricing, invoicing, and terms',
    holds: () => true,
  },
]

const quotaLabel = (value: number, unit?: string) =>
  value === UNLIMITED ? 'Unlimited' : unit ? `${value} ${unit}` : String(value)

/**
 * `quotaLabel` for the counts that are grouped by thousands. Kept separate
 * because `quotaLabel` deliberately does NOT localise — "2000 org datasets"
 * reads as a quota, "2,000" reads as money — but contacts and API requests
 * have always been grouped, and dropping that would be a copy regression.
 *
 * The reason this exists at all: `UNLIMITED` is `Number.POSITIVE_INFINITY`,
 * and `Infinity.toLocaleString()` is the glyph `'∞'`. So the Agency card read
 * "∞ contacts" while every neighbouring row said "Unlimited", and an
 * Enterprise card would mix "∞ contacts" with "Infinity GB storage" from the
 * raw interpolations below. Formatting an uncapped quota is never the
 * caller's business — see AGL-2482, same class one surface over.
 */
const quotaCount = (value: number) =>
  value === UNLIMITED ? 'Unlimited' : value.toLocaleString()

const mbLabel = (mb: number) =>
  mb === UNLIMITED ? 'Unlimited' : mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`

type FeatureKey = keyof (typeof PLAN_ENTITLEMENTS)['free']['features']

/**
 * Flags deliberately absent from the checklist, each with the reason. The
 * guard in `billing-plan-feature-rows.spec.ts` derives the expected row set
 * from `PLAN_ENTITLEMENTS.free.features` and allows exactly these — so a new
 * flag fails the build until someone decides which side of this line it is
 * on. A hand-written row list with no derivation is what decayed to 19 of 34
 * (AGL-2079); the exclusion list is the part that keeps it honest.
 */
export const FEATURE_ROW_EXCLUSIONS: Partial<Record<FeatureKey, string>> = {
  // True on all eight tiers (AGL-2082), so a checklist row here would be
  // ticked on every card and answer no purchase question.
  //
  // NOT dead, despite reading like it: `tools/marketing/build-pricing-tables.mts`
  // renders it as an "Interactions ✓ everywhere" row on the PUBLIC pricing
  // compare table, and the Free plan card bullets it. `true` on every tier
  // IS the AGL-577 decision — basic interactions are free, `actions` is the
  // paid tier — not the absence of one. It is excluded from this GRID
  // because a comparison grid and a marketing table have different jobs, and
  // it stays in the flag set because deleting it would silently drop that
  // public row.
  interactions:
    'Included on every plan — presentational interactions are a besigner ' +
    'primitive, not a tier. Sold as universal on the public pricing table.',
  // False on all eight tiers: a paid add-on resolved through the org
  // `entitlements` override, not something a plan carries. A row would read
  // as "no plan includes this", which is true and useless — the add-on is
  // sold on its own line.
  eventCalendar:
    'Sold as a paid add-on, not carried by any tier — priced separately.',
}

/**
 * Feature checklist rows (AGL-69 flags), grouped so a full-coverage list
 * stays readable (AGL-2079).
 *
 * Covers EVERY key of `PLAN_ENTITLEMENTS.free.features` except the
 * documented {@link FEATURE_ROW_EXCLUSIONS}. It previously covered 19 of 34,
 * omitting SSO, white-label, API access and the whole commerce ladder — the
 * most consequential purchase decisions in the product were missing from the
 * one surface whose job is answering "does my plan include this".
 */
const featureGroups = (
  brand: string,
): Array<{
  title: string
  rows: Array<{ key: FeatureKey; label: string }>
}> => [
  {
    title: 'Build & publish',
    rows: [
      { key: 'reusableComponents', label: 'Reusable components' },
      { key: 'versioning', label: 'Screen versioning' },
      { key: 'scheduledPublishing', label: 'Scheduled publishing' },
      { key: 'customDomain', label: 'Custom domain' },
      { key: 'removeBranding', label: `Remove ${brand} branding` },
      { key: 'multilingual', label: 'Multilingual sites' },
      { key: 'redirects', label: 'URL redirects' },
      { key: 'siteExport', label: 'Site backup & restore' },
      { key: 'videoMedia', label: 'Video & file uploads' },
      { key: 'mediaCdn', label: 'CDN delivery & responsive images' },
    ],
  },
  {
    title: 'Grow & automate',
    rows: [
      { key: 'aiAssist', label: 'AI assist' },
      { key: 'workflows', label: 'Workflows & automations' },
      { key: 'actions', label: 'Actions builder' },
      { key: 'dataStore', label: 'Datasets & dynamic data' },
      { key: 'bookings', label: 'Appointment bookings' },
      { key: 'marketingOverlays', label: 'Announcement bar & popups' },
      { key: 'screenAnalytics', label: 'Per-screen traffic analytics' },
      { key: 'abTesting', label: 'A/B testing' },
      { key: 'marketplaceSelling', label: 'Sell on the marketplace' },
    ],
  },
  {
    title: 'Commerce',
    rows: [
      { key: 'commerce', label: 'Storefront: catalog, cart & checkout' },
      { key: 'storefrontSubscriptions', label: 'Subscription products' },
      { key: 'giftCards', label: 'Gift cards & store credit' },
      { key: 'productReviews', label: 'Verified-buyer reviews' },
      { key: 'abandonedCart', label: 'Abandoned checkout recovery' },
      { key: 'dropshipRouting', label: 'Dropship supplier routing' },
      { key: 'contentGating', label: 'Memberships & gated content' },
      { key: 'commerceAnalytics', label: 'Commerce analytics' },
      { key: 'pos', label: 'Point of sale' },
    ],
  },
  {
    title: 'Platform & enterprise',
    rows: [
      { key: 'apiAccess', label: 'REST API & API keys' },
      { key: 'webhooks', label: 'Webhooks' },
      { key: 'whiteLabel', label: 'Full white-label' },
      { key: 'ssoEnabled', label: 'SAML / OIDC single sign-on' },
    ],
  },
]

/**
 * Flat row list, for the guard and for anything that wants the whole set.
 *
 * Built against the DEPLOYMENT brand rather than any org's, because it has no
 * org: its only consumer is `billing-plan-feature-rows.spec.ts`, which asserts
 * key coverage and non-empty labels. The rendered grid calls `featureGroups`
 * with the org's resolved `productName` instead (AGL-2319).
 */
export const FEATURE_ROWS: Array<{ key: FeatureKey; label: string }> =
  featureGroups(PLATFORM_BRAND_NAME).flatMap((group) => group.rows)


export interface BillingPlanCardsProps {
  /** The tenant's current plan; undefined when no plan is assigned yet. */
  plan: OrgPlan | undefined
  /**
   * What the upgrade will ask for on the way through, or null when the
   * workspace already has everything.
   *
   * ⚠️ This DISABLES NOTHING. Subscribing does require a stored payment method
   * and a stored billing address — `/api/billing/checkout` refuses without
   * either, and that refusal is the enforcement — but a customer who arrived
   * wanting to buy is not turned away for missing them. Upgrade opens a flow
   * that collects them, so the sentence here is a heads-up about the next
   * screen rather than a reason the button will not work.
   *
   * A sentence rather than a boolean because "one more step" and "two more
   * steps" are different promises, and the difference is the whole value of
   * saying anything at all.
   */
  subscribeCollectsNotice?: string | null
  /**
   * Billing interval from the page's monthly/annual toggle (AGL-532):
   * 'year' shows the discounted annual headline price on every card.
   */
  interval?: 'month' | 'year'
  /**
   * True when the org reads as Enterprise (`isEnterpriseOrg`) — either on the
   * real `enterprise` plan or on a legacy custom-priced/comped arrangement
   * (AGL-1118). Marks the Enterprise card as the current plan and suppresses
   * every self-serve CTA: an enterprise agreement is changed by talking to
   * us, not by clicking Downgrade.
   */
  enterprise?: boolean
  /**
   * The org's billing doc, for checking what an Enterprise arrangement
   * ACTUALLY grants this org (AGL-2297).
   *
   * `enterprise` above answers "does this org read as Enterprise", which is
   * true for a comped marker and a negotiated price as well as for the real
   * plan — and those two are display overlays on a lower base plan that grant
   * nothing. Without the org doc the card could only tick every highlight
   * unconditionally, which is what it did.
   *
   * Optional, and its absence is handled the safe way round: undefined checks
   * as the free plan, so a card rendered without it ticks nothing rather than
   * claiming everything. Only consulted when `enterprise` is true — a prospect
   * is being shown the tier as an offer, and every line of that offer is
   * accurate about the tier.
   */
  org?: Partial<AglynOrgBilling> | null
  /**
   * True when the org has a LIVE subscription (AGL-2156).
   *
   * It decides what the FREE card is. For a prospect it is an offer, and "No
   * credit card required" behind a disabled button is the right copy. For a
   * SUBSCRIBER that same card was prospect copy on a dead control: the one
   * thing a paying customer needs to know — that the route to Free is to
   * cancel — was nowhere on the grid, and the disabled button was the only
   * thing stopping a `pro → free` switch from 400ing "Unknown target plan"
   * server-side. That matters to retention specifically: moving to Free is the
   * cheapest save available, and the grid offered no route to it.
   */
  subscriptionActive?: boolean
  /**
   * Plan the visitor already chose on the marketing site (AGL-1117), read off
   * `?plan=` by the billing page. It emphasizes that card instead of the
   * next-tier-up default, so the deep link lands on the plan they clicked.
   * Never auto-submits: preselecting a card is a hint, and starting a
   * checkout is a decision the person still has to make here.
   */
  highlight?: OrgPlan
  onSelect: (plan: OrgPlan) => void
}

/**
 * The four quotas the focused view leads with.
 *
 * Four rather than the full checklist, because the checklist is why the grid
 * became unreadable: seven tiers each carrying thirty-odd lines is a
 * reference table, and a reference table is what you open deliberately, not
 * what a billing page opens with. These are the numbers a customer actually
 * hits a ceiling on — the full list is one click away and unchanged.
 */
function headlineLimits(
  entitlements: (typeof PLAN_ENTITLEMENTS)[OrgPlan],
  pricing: (typeof PLAN_PRICING)[OrgPlan],
): string[] {
  /*
   * ⚠️ THE PER-UNIT PRICE IS PART OF THE LIMIT, not decoration on it.
   *
   * Six of the seven plans carry `meteredInfraPassThrough`, so most of these
   * numbers are the point where BILLING starts rather than the point where
   * the product stops. "1,000 contacts" and "1,000 contacts (+$1/1k over)"
   * describe different products: one reads as a wall, the other as a meter,
   * and a customer choosing a tier on the first reading is choosing on the
   * wrong fact. The comparison grid has always shown these; the focused view
   * dropped them, which is exactly the sort of thing a condensed card must
   * not condense away.
   *
   * Enterprise is the one plan with no meter at all — every band is
   * `UNLIMITED` and the price is negotiated, so there is no rate to print and
   * the `!= null` guards below fall through to nothing on their own.
   */
  const per = (rate: number | null | undefined, unit: string) =>
    rate != null ? ` (+$${rate}${unit})` : ''
  return [
    `${quotaLabel(entitlements.hostLimit)} host${
      entitlements.hostLimit === 1 ? '' : 's'
    }${per(pricing.extraHostMonthlyUsd, '/extra')}`,
    `${quotaLabel(entitlements.screensPerHost)} screens per host`,
    `${quotaLabel(entitlements.sharedLayoutsPerHost)} shared layouts`,
    `${mbLabel(entitlements.storagePerHostMb)} storage`,
    `${
      entitlements.bandwidthGb === UNLIMITED
        ? 'Unlimited'
        : `${entitlements.bandwidthGb} GB`
    } bandwidth`,
    `${quotaLabel(entitlements.managersPerOrg)} team seat${
      entitlements.managersPerOrg === 1 ? '' : 's'
    }${per(pricing.extraSeatMonthlyUsd, '/extra')}`,
    `${quotaLabel(entitlements.membersPerHost)} site collaborator${
      entitlements.membersPerHost === 1 ? '' : 's'
    }${per(pricing.extraCollaboratorMonthlyUsd, '/extra')}`,
    `${quotaCount(entitlements.contactsPerHost)} contacts${per(
      pricing.extraContactsUsdPer1k,
      '/1k over',
    )}`,
    /*
     * CAMPAIGN sends, and only those (AGL-1438). The cap does not apply to
     * transactional mail — invites, receipts, password resets — so the row
     * must not read as though a plan rations those.
     *
     * It belongs here because it was on NO pricing surface a customer can
     * see: not this card, not the comparison grid, not the marketing pricing
     * page. The only place the console showed it was the current-plan chip,
     * which tells you what you already have and nothing about what a tier
     * you are considering would give you.
     */
    `${quotaCount(entitlements.emailSendsPerMonth)} campaign emails/mo`,
  ]
}

/**
 * What moving up one tier actually BUYS, as a delta rather than a restatement.
 *
 * A card listing "3 hosts" next to a card listing "1 host" makes the reader do
 * the subtraction; saying "3 hosts, up from 1" does it for them. That is the
 * whole difference between a price list and an upgrade path, and it is the
 * thing the previous grid could not express because every card was rendered
 * in ignorance of the one beside it.
 *
 * Quotas first, then newly-unlocked features, capped — the point is the
 * shape of the step, and a list long enough to need scanning is the
 * reference table again.
 */
/**
 * What one step up ADDS over the tier immediately to its left.
 *
 * ⚠️ FEATURES ONLY, and relative to the NEIGHBOUR — not to the current plan.
 * Two reasons, both of which were visible on screen:
 *
 * 1. Every card already prints its own quotas directly above this list, so
 *    including quota lines here restated "25 screens per host" twice in one
 *    card, six inches apart. The step in capacity is legible by reading the
 *    quota lists across the row, which is what putting them in the same order
 *    on every card is for.
 * 2. Measured against the CURRENT plan, the third card re-listed everything
 *    the second card had already granted — so the two upgrade cards looked
 *    almost identical and neither said what it alone was worth. Measured
 *    against its neighbour, each card answers only "and what does this one
 *    add", which is the question a ladder is read to answer.
 */
function upgradeGains(
  from: (typeof PLAN_ENTITLEMENTS)[OrgPlan],
  to: (typeof PLAN_ENTITLEMENTS)[OrgPlan],
  brand: string,
): string[] {
  return featureGroups(brand)
    .flatMap((group) => group.rows)
    .filter((row) => !from.features[row.key] && to.features[row.key])
    .map((row) => row.label)
}

/**
 * A few things the tier turns ON, under its quotas.
 *
 * Numbers alone do not say what a plan IS — "10 GB storage" and "Scheduled
 * publishing" answer different questions, and a card carrying only the first
 * reads as a capacity meter. Capped, because the point is a sense of the
 * tier: the exhaustive tick-list is the comparison grid, one click away.
 */
function keyFeatures(
  entitlements: (typeof PLAN_ENTITLEMENTS)[OrgPlan],
  brand: string,
): string[] {
  return featureGroups(brand)
    .flatMap((group) => group.rows)
    .filter((row) => entitlements.features[row.key])
    .map((row) => row.label)
}

/**
 * What the current tier does NOT include, and something above it does.
 *
 * A card that lists only what you have cannot tell you what you are missing,
 * and "what am I missing" is the question a billing page exists to answer.
 * Derived by asking what any HIGHER tier turns on that this one does not — so
 * a flag nobody sells above you is correctly absent rather than listed as a
 * loss, and nothing here is a feature that does not exist to be bought.
 */
function missingFromTier(plan: OrgPlan, brand: string): string[] {
  const mine = PLAN_ENTITLEMENTS[plan]
  const above = PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan) + 1)
  return featureGroups(brand)
    .flatMap((group) => group.rows)
    .filter(
      (row) =>
        !mine.features[row.key] &&
        above.some((tier) => PLAN_ENTITLEMENTS[tier].features[row.key]),
    )
    .map((row) => row.label)
}

/**
 * The focused default: what you are on, and the one step up (AGL-1859 §1).
 *
 * The previous default rendered every self-serve tier at once — seven cards,
 * each with its own thirty-line checklist, six identical contained `UPGRADE`
 * buttons, and a single small chip as the only thing distinguishing the
 * recommended step from the other five. Whatever the code intended, what the
 * page DID was present the whole ladder at equal weight, which is a price
 * list. De-emphasis cannot be read when there is nothing beside it to be
 * emphasized against.
 *
 * So the page now opens on the decision a customer is actually being asked to
 * make. The full grid is unchanged and one click away — it is a comparison
 * table, and this is what you see before you ask to compare.
 *
 * ⚠️ NOTHING IS REMOVED, and the button says what it reveals and how many.
 * Every lower tier, every higher tier and the Enterprise card are all still
 * reachable in one click. Hiding the cheaper plans outright would be a dark
 * pattern and would also lose the downsell the retention funnel depends on
 * (AGL-1863) — what changes is which view is the DEFAULT.
 */
/**
 * How many rows a card shows before it says how many it is holding back.
 *
 * ⚠️ A TRUNCATED LIST THAT DOES NOT SAY SO IS A LIE BY OMISSION, and on the
 * "Not in your plan" list specifically it is the expensive direction: a
 * customer reading six things they lack, with no sign there are more, is
 * being under-sold by the page that exists to sell them.
 */
const CARD_ROW_CAP = 6

/** The rows to draw, plus the "and N more" line when the cap bit. */
function capped(rows: string[]): { shown: string[]; more: number } {
  return {
    shown: rows.slice(0, CARD_ROW_CAP),
    more: Math.max(0, rows.length - CARD_ROW_CAP),
  }
}

/** A rung in the focused view: a self-serve tier, or Enterprise above them. */
type FocusedRung = OrgPlan | 'enterprise'

/**
 * The three rungs the page opens on, and why three.
 *
 * ENTERPRISE IS THE RUNG ABOVE AGENCY. Treating it as part of one ladder is
 * what makes the rules fall out of a single walk instead of needing a special
 * case each: `current + the next two up`, clipped at the top and back-filled
 * downward when there is not enough above to reach three.
 *
 *   free      → Free · Starter · Pro
 *   business  → Business · Scale · Advanced
 *   advanced  → Advanced · Agency · Enterprise
 *   agency    → Advanced · Agency · Enterprise   (one down, one up)
 *   enterprise→ nothing
 *
 * An Enterprise org gets NO rungs. There is no self-serve step to offer it —
 * that agreement changes by talking to us — so opening on a tier ladder would
 * be showing a customer a decision they cannot make from this page.
 */
function focusedRungs(plan: OrgPlan, enterprise: boolean): FocusedRung[] {
  // An Enterprise org is shown its own plan and nothing else. Every rung
  // below it is a downgrade it cannot self-serve, and the one thing this page
  // could offer it — a step up — does not exist.
  if (enterprise) return ['enterprise']
  const ladder: FocusedRung[] = [...PLAN_ORDER, 'enterprise']
  const at = ladder.indexOf(plan)
  if (at < 0) return []
  // Current plus the next two, and NOTHING below. A shorter row at the top of
  // the ladder is the honest shape: Agency has one step left, so it shows
  // one. Padding it out with a downgrade would make the cheapest thing on
  // screen the only alternative on offer, which is the opposite of the page's
  // job — the way down is still one click away, named and counted.
  return ladder.slice(at, at + 3)
}

/**
 * What each rung is FOR, which is what decides how loud its control is.
 *
 * The asymmetry AGL-1859 §2 asks for is expressed here rather than in the
 * markup: exactly one contained button on the page, the step up; anything
 * further up is available but quieter; anything below is quiet text, because
 * a downgrade is never a one-click peer of an upgrade.
 */
type RungRole = 'current' | 'recommended' | 'higher' | 'lower' | 'enterprise'

function rungRole(
  rung: FocusedRung,
  plan: OrgPlan,
  enterpriseOrg: boolean,
): RungRole {
  // The Enterprise card is a sales card to everyone except the org that is
  // already on it, for whom it is simply their plan.
  if (rung === 'enterprise') return enterpriseOrg ? 'current' : 'enterprise'
  if (rung === plan) return 'current'
  // Positions on the LADDER, never positions in the rendered array — those
  // two are not the same number, and confusing them made every rung read as
  // `higher`: nothing was ever recommended, and the tier back-filled BELOW
  // Agency offered an Upgrade button for what is actually a downgrade.
  const at = PLAN_ORDER.indexOf(rung)
  const currently = PLAN_ORDER.indexOf(plan)
  if (at < currently) return 'lower'
  return at === currently + 1 ? 'recommended' : 'higher'
}

/**
 * The focused default: the decision, not the catalogue (AGL-1859 §1).
 *
 * The previous default rendered every self-serve tier at once — seven cards,
 * each carrying its own thirty-line checklist, six identical contained
 * `UPGRADE` buttons, and one small chip as the only thing separating the
 * recommended step from the other five. Whatever the code intended, what the
 * page DID was present the whole ladder at equal weight, which is a price
 * list. De-emphasis cannot be read when there is nothing beside it to be
 * emphasized against.
 *
 * ⚠️ NOTHING IS REMOVED, and the control that reveals the rest says so and
 * counts them. Hiding the cheaper plans outright would be a dark pattern and
 * would lose the downsell the retention funnel depends on (AGL-1863). What
 * changes is which view is the DEFAULT.
 */
function FocusedTierView(props: {
  currentTier: OrgPlan
  enterpriseOrg: boolean
  rungs: FocusedRung[]
  interval: 'month' | 'year'
  taglines: Record<OrgPlan, string>
  brand: string
  totalCount: number
  subscribeCollectsNotice: string | null
  onSelect: (plan: OrgPlan) => void
  onCompare: () => void
}) {
  const {
    currentTier,
    enterpriseOrg,
    rungs,
    interval,
    taglines,
    brand,
    totalCount,
    subscribeCollectsNotice,
    onSelect,
    onCompare,
  } = props
  const current = PLAN_ENTITLEMENTS[currentTier]
  const price = (tier: OrgPlan) =>
    interval === 'year'
      ? PLAN_PRICING[tier].basePriceAnnualMonthlyUsd
      : PLAN_PRICING[tier].basePriceMonthlyUsd
  const perMonth = (tier: OrgPlan) =>
    interval === 'year' && tier !== 'free' ? '/month, billed yearly' : '/month'
  const span = rungs.length ? Math.floor(12 / rungs.length) : 12

  return (
    <>
      {rungs.map((rung, index) => {
        const role = rungRole(rung, currentTier, enterpriseOrg)
        const label =
          rung === 'enterprise' ? 'Enterprise' : PLAN_LABELS[rung as OrgPlan]
        /*
         * An upgrade card states its DELTA over the card to its left; every
         * other card states what it simply has. `adds` is that distinction,
         * and it decides the heading, the colour and the list in one place so
         * the three cannot disagree.
         */
        const leftward = rungs[index - 1]
        const adds =
          (role === 'recommended' || role === 'higher') &&
          leftward !== undefined &&
          leftward !== 'enterprise'
        const gained = adds
          ? upgradeGains(
              PLAN_ENTITLEMENTS[leftward as OrgPlan],
              PLAN_ENTITLEMENTS[rung as OrgPlan],
              brand,
            )
          : []
        const tickRows = adds
          ? // A tier can add capacity and no new flags. Saying so beats an
            // empty section, which reads as a rendering fault.
            gained.length
            ? gained
            : // A tier can add capacity and no new flags; the heading has
              // already said what it builds on, so this only has to say what
              // kind of step it is.
              ['Higher limits across the board']
          : rung === 'enterprise'
            ? ENTERPRISE_HIGHLIGHTS.slice(0, 5).map(
                (highlight) => highlight.label,
              )
            : keyFeatures(PLAN_ENTITLEMENTS[rung as OrgPlan], brand)
        return (
          <Grid key={String(rung)} size={{ xs: 12, md: span }}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                borderColor:
                  role === 'recommended'
                    ? 'primary.main'
                    : role === 'current'
                      ? 'success.main'
                      : 'divider',
                borderWidth: role === 'recommended' || role === 'current' ? 2 : 1,
              }}
            >
              <CardContent>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', mb: 0.5 }}
                >
                  <Typography variant="h6">{label}</Typography>
                  {role === 'current' ? (
                    <Chip label="Current plan" color="success" size="small" />
                  ) : role === 'recommended' ? (
                    <Chip label="Recommended" color="primary" size="small" />
                  ) : null}
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'baseline', my: 1 }}
                >
                  {rung === 'enterprise' ? (
                    <Typography variant="h6" component="span">
                      {'Custom pricing'}
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="h4" component="span">
                        {`$${price(rung as OrgPlan)}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {perMonth(rung as OrgPlan)}
                      </Typography>
                    </>
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, minHeight: 40 }}
                >
                  {rung === 'enterprise'
                    ? `Custom limits, invoicing and support, arranged with us.`
                    : taglines[rung as OrgPlan]}
                </Typography>

                {/* Exactly one contained control on the page. */}
                {role === 'recommended' ? (
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={() => onSelect(rung as OrgPlan)}
                  >
                    {`Upgrade to ${label}`}
                  </Button>
                ) : role === 'higher' ? (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => onSelect(rung as OrgPlan)}
                  >
                    {`Upgrade to ${label}`}
                  </Button>
                ) : role === 'lower' ? (
                  <Button
                    fullWidth
                    variant="text"
                    sx={{ color: 'text.secondary', opacity: 0.66 }}
                    onClick={() => onSelect(rung as OrgPlan)}
                  >
                    {`Downgrade to ${label}`}
                  </Button>
                ) : role === 'enterprise' ? (
                  <Button
                    fullWidth
                    variant="outlined"
                    href={ENTERPRISE_CONTACT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {'Contact us'}
                  </Button>
                ) : rung === 'enterprise' ? (
                  // Already on it. Changing this agreement is a conversation,
                  // not a button, so the card says where that happens.
                  <Button
                    fullWidth
                    variant="outlined"
                    href={ENTERPRISE_CONTACT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {'Contact us to change'}
                  </Button>
                ) : (
                  <Button fullWidth disabled>
                    {'Your plan'}
                  </Button>
                )}

                {role === 'recommended' && subscribeCollectsNotice ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1 }}
                  >
                    {subscribeCollectsNotice}
                  </Typography>
                ) : null}

                <Divider sx={{ my: 1.5 }} />

                {/* ONE SKELETON ON EVERY CARD: the quotas, then a tick
                    list. The recommended card differs only in what its tick
                    list SAYS — the gains rather than the inventory — because
                    a card that reorders its own sections cannot be read
                    across from its neighbours, which is the entire job of
                    three cards side by side. */}
                {/* Enterprise fills this slot from its own entitlements like
                    every other card, so the rows line up and the reader can
                    travel across them. It reads "Unlimited" down the column,
                    which is the answer — omitting the block entirely made the
                    card look like it had no limits to state rather than no
                    limits at all, and left nothing beside Agency's eight rows.

                    ⚠️ Its HIGHLIGHTS are not substituted here. They are the
                    tick list below, and using them for both printed the same
                    five lines twice in one card. */}
                <Stack spacing={0.5}>
                  {headlineLimits(
                    PLAN_ENTITLEMENTS[
                      rung === 'enterprise' ? 'enterprise' : (rung as OrgPlan)
                    ],
                    PLAN_PRICING[
                      rung === 'enterprise' ? 'enterprise' : (rung as OrgPlan)
                    ],
                  ).map((line) => (
                    <Typography
                      key={line}
                      variant="body2"
                      color="text.secondary"
                    >
                      {line}
                    </Typography>
                  ))}
                </Stack>

                {/* Every section below is the same three parts in the same
                    order — rule, heading, list — so the eye can travel
                    straight across three cards instead of re-finding the
                    shape on each one. */}
                <Divider sx={{ my: 1.5 }} />
                {/* The heading carries the cumulativeness. Without it, a
                    card listing only its DELTA reads as a short feature list
                    rather than as everything below it plus these — which is
                    the misreading the delta itself invites. */}
                <Typography
                  variant="overline"
                  color={adds ? 'secondary' : 'text.secondary'}
                  sx={{ display: 'block', lineHeight: 1.4 }}
                >
                  {adds
                    ? `Everything in ${PLAN_LABELS[leftward as OrgPlan]}, plus`
                    : 'Included'}
                </Typography>
                <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                  {capped(tickRows).shown.map((line) => (
                    <Stack
                      key={line}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'flex-start' }}
                    >
                      <MdiIcon
                        color="success"
                        fontSize="small"
                        path={ICON_VARIANT_SYMBOL_CONFIRMED.path}
                      />
                      <Typography variant="body2">{line}</Typography>
                    </Stack>
                  ))}
                  {capped(tickRows).more ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ pl: 4 }}
                    >
                      {`and ${capped(tickRows).more} more`}
                    </Typography>
                  ) : null}
                </Stack>

                {role === 'current' &&
                missingFromTier(currentTier, brand).length ? (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Typography
                      variant="overline"
                      color="error"
                      sx={{ display: 'block' }}
                    >
                      {'Not in your plan'}
                    </Typography>
                    <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                      {capped(missingFromTier(currentTier, brand)).shown.map(
                        (line) => (
                          <Stack
                            key={line}
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'flex-start' }}
                          >
                            {/* A cross, not a dash. A dash reads as "not
                                applicable"; the point of this list is that
                                these are things you are going without. */}
                            <MdiIcon
                              color="error"
                              fontSize="small"
                              path={ICON_VARIANT_CLOSE.path}
                            />
                            <Typography variant="body2" color="text.secondary">
                              {line}
                            </Typography>
                          </Stack>
                        ),
                      )}
                      {capped(missingFromTier(currentTier, brand)).more ? (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ pl: 4 }}
                        >
                          {`and ${
                            capped(missingFromTier(currentTier, brand)).more
                          } more`}
                        </Typography>
                      ) : null}
                    </Stack>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </Grid>
        )
      })}

      <Grid size={{ xs: 12 }}>
        {/* Deliberately a real control rather than a quiet hint. Every plan
            the focused view does not show is behind this one button, so a
            customer who wants the cheaper end has to be able to SEE the way
            there — a de-emphasized route to the downsell is the dark-pattern
            version of the same idea. */}
        <Button
          fullWidth
          variant="outlined"
          size="large"
          onClick={onCompare}
          sx={{ textTransform: 'none' }}
        >
          {`Compare all ${totalCount} plans`}
        </Button>
      </Grid>
    </>
  )
}

/**
 * Tiers BELOW the org's current plan, collapsed behind a disclosure (AGL-1859
 * §1: "hide or de-emphasize the lower subscription tiers … upgrade paths
 * prominent and one-click").
 *
 * They are hidden, never removed. A customer looking for a cheaper plan finds
 * it in one click and the copy says exactly where it is — a grid that pretends
 * the lower tiers do not exist is a dark pattern, and it also loses the
 * downsell the retention funnel depends on (AGL-1863). What changes is the
 * DEFAULT: the upgrade path is what the page leads with.
 */
function LowerTierDisclosure(props: {
  count: number
  expanded: boolean
  onToggle: () => void
}) {
  const { count, expanded, onToggle } = props
  if (count < 1) return null
  return (
    <Grid size={{ xs: 12 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          color="inherit"
          onClick={onToggle}
          aria-expanded={expanded}
          sx={{ color: 'text.secondary', textTransform: 'none' }}
        >
          {expanded
            ? 'Hide lower plans'
            : `Looking for something smaller? Show ${count} lower plan${
                count === 1 ? '' : 's'
              }`}
        </Button>
        {/* The tip appears only once the lower plans are actually on screen
            (AGL-1943). Collapsed, this is a disclosure control and there is
            nothing yet to explain; expanded, the customer is looking at a
            downgrade, and the one thing no card can say in its own corner is
            WHEN picking it takes effect — end of the paid period, $0 today,
            unlike every upgrade beside it. That asymmetry is invisible on
            the card and is the whole subject of the section this links to. */}
        {expanded ? (
          <DocsHelpTip
            topic="downgradingAndCanceling"
            anchor="#when-changes-take-effect"
            title="Moving to a lower plan takes effect later"
            excerpt="Upgrades apply immediately and prorate. A downgrade waits for the end of the period you already paid for, and $0 is due today."
          />
        ) : null}
      </Stack>
    </Grid>
  )
}

/**
 * Pricing-page plan picker (AGL-71): quota summary + feature checklist per
 * tier, driven entirely from PLAN_ENTITLEMENTS/PLAN_PRICING. The current
 * plan is outlined and the next tier up is emphasized as the recommended
 * upgrade.
 *
 * Tier visibility is ASYMMETRIC (AGL-1859): tiers above the current plan are
 * shown by default with a contained one-click Upgrade; tiers below it are
 * collapsed behind {@link LowerTierDisclosure} and, once shown, dimmed with a
 * quiet text CTA. Nothing is removed and nothing is disabled — the whole
 * ladder stays one click away, which is the line between de-emphasis and a
 * dark pattern.
 *
 * Only the SELF-SERVE tiers appear in the grid (AGL-1118). Enterprise is
 * custom-priced and staff-provisioned, so it gets a full-width contact-sales
 * card after the grid — never a price and never a checkout button.
 */
export function BillingPlanCardsComponent(props: BillingPlanCardsProps) {
  const {
    plan,
    interval = 'month',
    enterprise = false,
    org,
    subscriptionActive = false,
    subscribeCollectsNotice = null,
    highlight,
    onSelect,
  } = props
  // Copy that names the product reads the org's RESOLVED brand, not a literal
  // and not the deployment default (AGL-2319): a white-label org's admins see
  // their own product name on the grid that sells them the tier.
  const { branding } = useBranding()
  const taglines = planTaglines(branding.productName)
  const groups = featureGroups(branding.productName)
  // An enterprise org sits above the ladder: nothing in the grid is its
  // "current" plan, and nothing there is an upgrade for it either.
  const currentIndex = enterprise || !plan ? -1 : PLAN_ORDER.indexOf(plan)
  // A deep-linked plan wins over the next-tier-up heuristic — the visitor
  // told us which one they want. Still suppressed for an enterprise org,
  // whose grid carries no self-serve CTA to emphasize, and ignored when the
  // highlighted tier is the one they are already on.
  const highlightIndex =
    !enterprise && highlight && highlight !== plan
      ? PLAN_ORDER.indexOf(highlight)
      : -1
  // A deep link EXPANDS a lower tier (below) but never RECOMMENDS one
  // (AGL-2142). `?plan=starter` on a Pro org used to badge the Starter card
  // "Recommended" with a primary border while the same card was dimmed to 0.66
  // and labelled Downgrade — a card recommending and de-emphasizing itself in
  // the same breath, and a recommendation the product does not mean. AGL-1859
  // §2 is explicit that a downgrade is never the emphasized control, so the
  // highlight only wins the recommendation when it points UP the ladder.
  const highlightRecommends =
    highlightIndex >= 0 && (currentIndex < 0 || highlightIndex > currentIndex)
  const recommendedIndex = highlightRecommends
    ? highlightIndex
    : !enterprise && currentIndex >= 0 && currentIndex < PLAN_ORDER.length - 1
      ? currentIndex + 1
      : -1

  // Lower tiers start collapsed (AGL-1859). Only ever collapsed for an org
  // that HAS a plan to be below: a visitor with no plan yet, or an enterprise
  // org, sees the whole ladder, because for them nothing is a downgrade.
  //
  // Except when a deep link asked for one of them. `?plan=starter` arriving
  // from the marketing site while the org is on Pro must still land on the
  // Starter card (AGL-1117) — collapsing the tier the visitor explicitly
  // clicked would make the link look broken, and de-emphasis is a default,
  // not an override of a stated intent.
  const [showLowerTiers, setShowLowerTiers] = useState(
    () => highlightIndex >= 0 && currentIndex >= 0 && highlightIndex < currentIndex,
  )
  const lowerTierCount = currentIndex > 0 ? currentIndex : 0

  /*
   * WHICH VIEW THE PAGE OPENS ON.
   *
   * Focused only for an org that HAS a plan, because the focused view is
   * "you are here, this is the step up" and neither half of that sentence
   * exists otherwise. A prospect with no plan is comparing, which is what the
   * grid is for; an enterprise org has no self-serve step to recommend; and a
   * deep-linked `?plan=` named a specific card, so opening anywhere else
   * would make the link look broken (AGL-1117).
   *
   * Those three cases open on the grid — the behavior every existing case
   * already had — so this narrows what the DEFAULT is without removing a
   * view anyone previously reached.
   */
  const rungs = plan ? focusedRungs(plan, enterprise) : []
  const canFocus =
    (enterprise || currentIndex >= 0) &&
    highlightIndex < 0 &&
    rungs.length > 0
  const [compareAll, setCompareAll] = useState(() => !canFocus)

  if (!compareAll && plan) {
    return (
      <Grid container spacing={2} id="plans">
        <FocusedTierView
          currentTier={plan}
          enterpriseOrg={enterprise}
          rungs={rungs}
          interval={interval}
          taglines={taglines}
          brand={branding.productName}
          totalCount={PLAN_ORDER.length}
          subscribeCollectsNotice={subscribeCollectsNotice}
          onSelect={onSelect}
          onCompare={() => setCompareAll(true)}
        />
      </Grid>
    )
  }
  // A subscriber on a paid tier has a real route to Free, and it is the cancel
  // flow (AGL-2156). Enterprise is excluded for the same reason every other
  // self-serve CTA is: that agreement is changed by talking to us.
  const canCancelToFree = subscriptionActive && !enterprise && currentIndex > 0

  return (
    <Grid container spacing={2} id="plans">
      {PLAN_ORDER.map((tier, index) => {
        const entitlements = PLAN_ENTITLEMENTS[tier]
        const pricing = PLAN_PRICING[tier]
        // Below the current plan: de-emphasized, and behind the disclosure.
        const isLower = currentIndex >= 0 && index < currentIndex
        if (isLower && !showLowerTiers) return null
        // An enterprise org's stored `plan` may still be the base tier it was
        // provisioned on (AGL-1110) — marking that tier "Current plan" put a
        // second green badge in the grid next to the Enterprise card's. The
        // Enterprise card is the only current one for such an org.
        const isCurrent = !enterprise && tier === plan
        const isRecommended = index === recommendedIndex
        return (
          /*
           * THREE per row, not four. Each card carries eight quota rows and a
           * thirty-line checklist, and at `lg: 3` every one of those lines
           * wrapped — "3 site collaborators (+$3/extra, max 10)" became three
           * ragged lines, and the columns stopped being scannable across,
           * which is the only thing a comparison table is for.
           *
           * The top rung takes HALF a row instead, so the Enterprise card can
           * sit beside it: Enterprise is the step above Agency, and leaving
           * Agency alone on a row of three put the two ends of the ladder in
           * different places with a gap between them.
           */
          <Grid
            key={tier}
            size={{ xs: 12, sm: 6, lg: index === PLAN_ORDER.length - 1 ? 6 : 4 }}
          >
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                position: 'relative',
                borderColor: isCurrent
                  ? 'success.main'
                  : isRecommended
                    ? 'primary.main'
                    : 'divider',
                borderWidth: isCurrent || isRecommended ? 2 : 1,
                // De-emphasis is visual only — every figure stays readable and
                // no control is disabled. Dimming a card the customer just
                // asked to see would be a dark pattern, not a nudge.
                ...(isLower ? { opacity: 0.66 } : {}),
              }}
            >
              <CardContent>
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Typography variant="h6">{PLAN_LABELS[tier]}</Typography>
                  {isCurrent ? (
                    <Chip label="Current plan" color="success" size="small" />
                  ) : isRecommended ? (
                    <Chip label="Recommended" color="primary" size="small" />
                  ) : null}
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'baseline', my: 1 }}
                >
                  <Typography variant="h4" component="span">
                    {`$${
                      interval === 'year'
                        ? pricing.basePriceAnnualMonthlyUsd
                        : pricing.basePriceMonthlyUsd
                    }`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {interval === 'year' && tier !== 'free'
                      ? '/month, billed yearly'
                      : '/month'}
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, minHeight: 40 }}
                >
                  {taglines[tier]}
                </Typography>
                {enterprise ? (
                  // An enterprise agreement is not swapped for a list-price
                  // tier from this grid (AGL-1118) — the change goes through
                  // whoever owns the contract.
                  <Button fullWidth size="small" disabled sx={{ mb: 1.5 }}>
                    {'Contact us to change'}
                  </Button>
                ) : !isCurrent ? (
                  <>
                  <Button
                    fullWidth
                    size="small"
                    // Asymmetric by design (AGL-1859 §2). An upgrade is the
                    // page's loudest control; a downgrade is a quiet text
                    // button that opens the deliberate confirm flow the
                    // billing page owns — never a one-click peer of Upgrade
                    // sitting at equal weight beside it.
                    variant={
                      index > currentIndex
                        ? 'contained'
                        : isLower
                          ? 'text'
                          : 'outlined'
                    }
                    color={isLower ? 'inherit' : 'primary'}
                    // Free has no Stripe price to check out. For a PROSPECT
                    // that makes the card an offer with nothing to click; for
                    // a SUBSCRIBER it has a real route, and it is the cancel
                    // flow (AGL-2156) — which the page owns, and which states
                    // what happens and when.
                    //
                    // Every PAID tier is clickable unconditionally. A missing
                    // card or address is collected by the flow Upgrade opens,
                    // so there is nothing left for this control to refuse; the
                    // server still refuses the subscribe itself, which is
                    // where that check belongs.
                    disabled={tier === 'free' ? !canCancelToFree : false}
                    onClick={() => onSelect(tier)}
                    sx={{ mb: 1.5, ...(isLower ? { color: 'text.secondary' } : {}) }}
                  >
                    {/* AGL-1178: while pre-release, the Free card must not
                        promise the price is permanent — no price locks, no
                        grandfathering. Enforced by no-price-commitment.spec. */}
                    {tier === 'free'
                      ? canCancelToFree
                        ? 'Cancel & move to Free'
                        : 'No credit card required'
                      : currentIndex < 0 || index > currentIndex
                        ? 'Upgrade'
                        : 'Downgrade'}
                  </Button>
                  {/* What the next screen will ask for. Not a refusal and not
                      a reason the button is inert — it is not — but pressing
                      Upgrade and meeting an address form unannounced is a
                      small betrayal of a button labelled Upgrade. */}
                  {tier !== 'free' &&
                  subscribeCollectsNotice &&
                  index > currentIndex ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: -1, mb: 1.5 }}
                    >
                      {subscribeCollectsNotice}
                    </Typography>
                  ) : null}
                  {tier === 'free' && canCancelToFree ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: -1, mb: 1.5 }}
                    >
                      {'Your paid plan runs to the end of the period you have ' +
                        'already paid for, then this organization moves to ' +
                        'Free. Nothing is deleted.'}
                    </Typography>
                  ) : null}
                  </>
                ) : (
                  <Button fullWidth size="small" disabled sx={{ mb: 1.5 }}>
                    {'Your plan'}
                  </Button>
                )}
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.hostLimit)} host${
                      entitlements.hostLimit === 1 ? '' : 's'
                    }`}
                    {pricing.extraHostMonthlyUsd != null
                      ? ` (+$${pricing.extraHostMonthlyUsd}/extra)`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.screensPerHost)} screens per host`}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.sharedLayoutsPerHost)} shared layouts`}
                  </Typography>
                  {/* AGL-2246: `templatesPerHost` is enforced by
                      /api/hosts/resources but was the one quota key of 31
                      with no customer-facing surface anywhere — not here,
                      not on the templates card, not in the usage meters. A
                      cap a shopper for a plan cannot see is not a plan
                      differentiator, it is a future refusal. */}
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.templatesPerHost)} saved templates per host`}
                  </Typography>
                  {/* Media storage only. The `totalSiteSizeMb` figure used to
                      sit beside it and was dropped in AGL-1370: it is
                      structurally unreachable (the 900 KB node-map wall of
                      AGL-678 bounds a whole site to a few percent of the
                      advertised cap), so the card was publishing a number we
                      do not back. The entitlement stays as an internal
                      signal. */}
                  <Typography variant="body2">
                    {`${mbLabel(entitlements.storagePerHostMb)} storage`}
                  </Typography>
                  <Typography variant="body2">
                    {`${
                      entitlements.bandwidthGb === UNLIMITED
                        ? 'Unlimited'
                        : `${entitlements.bandwidthGb} GB`
                    } bandwidth`}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.managersPerOrg)} team seat${
                      entitlements.managersPerOrg === 1 ? '' : 's'
                    }`}
                    {pricing.extraSeatMonthlyUsd != null
                      ? ` (+$${pricing.extraSeatMonthlyUsd}/extra, ` +
                        `max ${quotaLabel(entitlements.maxManagersPerOrg)})`
                      : ''}
                  </Typography>
                  {/* Per-site console collaborators (AGL-888) — end-user
                      member accounts are unlimited and listed separately. */}
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.membersPerHost)} site collaborator${
                      entitlements.membersPerHost === 1 ? '' : 's'
                    }`}
                    {pricing.extraCollaboratorMonthlyUsd != null
                      ? ` (+$${pricing.extraCollaboratorMonthlyUsd}/extra, ` +
                        `max ${quotaLabel(entitlements.maxMembersPerHost)})`
                      : ''}
                  </Typography>
                  {/* Visitor signups are never capped (AGL-889). */}
                  <Typography variant="body2">
                    {'Unlimited member accounts'}
                  </Typography>
                  {/* Audience band (AGL-890): paid tiers meter overage. */}
                  <Typography variant="body2">
                    {`${quotaCount(entitlements.contactsPerHost)} contacts`}
                    {pricing.extraContactsUsdPer1k != null
                      ? ` (+$${pricing.extraContactsUsdPer1k}/1k over)`
                      : ''}
                  </Typography>
                  {/* CAMPAIGN sends only (AGL-1438) — transactional mail is
                      not rationed by a plan, and this row must not imply it
                      is. Absent from every customer-facing pricing surface
                      until now. */}
                  <Typography variant="body2">
                    {`${quotaCount(entitlements.emailSendsPerMonth)} campaign emails/mo`}
                  </Typography>
                  {/* Submissions only. These cards exist to be compared, and
                      the saved-form ceiling is the same number on every plan
                      that has forms at all — printed here it would read as a
                      difference and send a buyer looking for one. What a
                      plan actually buys on this axis is the submissions
                      band, which is tiered and metered. The ceiling is shown
                      where it means something: beside the site's own count,
                      on the usage meters. */}
                  <Typography variant="body2">
                    {`${quotaCount(entitlements.formSubmissionsPerMonth)} form submissions/mo`}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.variablesPerHost)} variables · ` +
                      `${quotaLabel(entitlements.functionsPerHost)} functions · ` +
                      `${quotaLabel(entitlements.workflowsPerHost)} workflows`}
                  </Typography>
                  <Typography variant="body2">
                    {entitlements.datasetsPerOrg > 0
                      ? `${quotaLabel(entitlements.datasetsPerOrg)} org datasets × ` +
                        `${quotaLabel(entitlements.recordsPerDataset)} records · ` +
                        `${mbLabel(entitlements.dataStorageMbPerOrg)} data`
                      : 'No datasets'}
                  </Typography>
                  <Typography variant="body2">
                    {entitlements.apiRequestsPerMonth > 0
                      ? `${quotaCount(entitlements.apiRequestsPerMonth)} API requests/mo` +
                        (pricing.extraApiRequestsUsdPer1k != null
                          ? ` (+$${pricing.extraApiRequestsUsdPer1k}/1k over)`
                          : '')
                      : 'No API access'}
                  </Typography>
                  {/* Declining platform-fee ladder (AGL-892): charged at
                      checkout as the Stripe Connect application fee. "Plus
                      card processing at cost" is AGL-2152: a storefront sale
                      is a DESTINATION charge, so Stripe's own fee is debited
                      from the platform's balance, and a card advertising 0%
                      with nothing beside it promised a merchant a free
                      payment rail that Aglyn was paying for out of pocket on
                      every order. The PLATFORM rates below did not move;
                      memberships, gated content and paid BOOKINGS all bill at
                      the digital rate (AGL-2315 — a booking is a service sale
                      and resolves through the same `'service'`/digital axis,
                      not a rate of its own). */}
                  <Typography variant="body2">
                    {entitlements.features.commerce
                      ? entitlements.transactionFeePhysicalPct > 0 ||
                        entitlements.transactionFeeDigitalPct > 0
                        ? `${entitlements.transactionFeePhysicalPct}% physical · ` +
                          `${entitlements.transactionFeeDigitalPct}% digital, ` +
                          'membership & booking fees, plus card processing ' +
                          'at cost'
                        : '0% platform fees, plus card processing at cost'
                      : 'No storefront'}
                  </Typography>
                </Stack>
                <Stack spacing={1.5}>
                  {/* Grouped since AGL-2079: the checklist went from 19 rows
                      to the full flag set, and 32 undifferentiated ticks is a
                      wall nobody reads. The headings are the difference
                      between a longer list and a legible one. */}
                  {groups.map((group) => (
                  <Stack key={group.title} spacing={0.5}>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ lineHeight: 1.6 }}
                  >
                    {group.title}
                  </Typography>
                  {group.rows.map(({ key, label }) => {
                    const enabled = entitlements.features[key]
                    return (
                      <Stack
                        key={key}
                        direction="row"
                        spacing={0.75}
                        sx={{
                          alignItems: 'center',
                          color: enabled ? 'text.primary' : 'text.disabled',
                        }}
                      >
                        <MdiIcon
                          fontSize="inherit"
                          sx={{
                            color: enabled ? 'success.main' : 'text.disabled',
                          }}
                          path={
                            enabled
                              ? ICON_VARIANT_SYMBOL_CONFIRMED.path
                              : ICON_VARIANT_SYMBOL_MINUS.path
                          }
                        />
                        <Typography variant="body2">{label}</Typography>
                      </Stack>
                    )
                  })}
                  </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )
      })}
      {/* Enterprise (AGL-1118): custom-priced, so it shows what it includes
          and how to get it — never a headline price or a checkout button.

          It sits IMMEDIATELY after the ladder, sharing a row with Agency at
          half width each. It is the rung above Agency, so the two belong side
          by side — and the disclosure below is full width, which would push
          them onto separate rows if it came between them. */}
      <Grid size={{ xs: 12, lg: 6 }}>
        <Card
          variant="outlined"
          sx={{
            borderColor: enterprise ? 'success.main' : 'divider',
            borderWidth: enterprise ? 2 : 1,
          }}
        >
          <CardContent>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ justifyContent: 'space-between' }}
            >
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="h6">
                    {PLAN_LABELS.enterprise}
                  </Typography>
                  {enterprise ? (
                    <Chip label="Current plan" color="success" size="small" />
                  ) : null}
                </Stack>
                <Typography variant="h5" component="p">
                  {'Custom pricing'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {taglines.enterprise}
                </Typography>
              </Stack>
              <Stack spacing={0.5} sx={{ flex: 2 }}>
                {ENTERPRISE_HIGHLIGHTS.map(({ label, holds }) => {
                  // A PROSPECT is being shown the tier, and every line is
                  // accurate about the tier — so the offer ticks in full. A
                  // CURRENT org is being told what it has, and that is a
                  // different question with a different answer whenever the
                  // Enterprise reading came from a comped marker or a
                  // negotiated price rather than the plan itself.
                  const held = enterprise ? holds(org) : true
                  return (
                    <Stack
                      key={label}
                      direction="row"
                      spacing={0.75}
                      sx={{ alignItems: 'center' }}
                    >
                      <MdiIcon
                        fontSize="inherit"
                        sx={{ color: held ? 'success.main' : 'text.disabled' }}
                        path={
                          held
                            ? ICON_VARIANT_SYMBOL_CONFIRMED.path
                            : ICON_VARIANT_SYMBOL_MINUS.path
                        }
                      />
                      <Typography
                        variant="body2"
                        color={held ? 'text.primary' : 'text.secondary'}
                      >
                        {label}
                      </Typography>
                    </Stack>
                  )
                })}
                {enterprise &&
                ENTERPRISE_HIGHLIGHTS.some(({ holds }) => !holds(org)) ? (
                  // Actionable, not just honest: the fix for a legacy
                  // arrangement is a per-org entitlements override or a move
                  // onto the real plan, and neither is something the admin can
                  // do from here.
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ pt: 0.5 }}
                  >
                    {'Your agreement does not currently enable everything ' +
                      'Enterprise can include — talk to us to turn the rest on.'}
                  </Typography>
                ) : null}
              </Stack>
              <Stack
                spacing={1}
                sx={{ flex: 1, justifyContent: 'center', minWidth: 200 }}
              >
                {enterprise ? (
                  <Typography variant="body2" color="text.secondary">
                    {'Your organization is on an Enterprise agreement — ' +
                      'reach out for any change to it.'}
                  </Typography>
                ) : (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    href={ENTERPRISE_CONTACT_URL}
                    target="_blank"
                    rel="noopener"
                  >
                    {'Contact sales'}
                  </Button>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
      <LowerTierDisclosure
        count={lowerTierCount}
        expanded={showLowerTiers}
        onToggle={() => setShowLowerTiers((shown) => !shown)}
      />
      {/* The way back, offered only where there is a focused view to go back
          TO. An org with no plan, an enterprise org and a deep link all open
          here and have nothing narrower to return to. */}
      {canFocus ? (
        <Grid size={{ xs: 12 }}>
          <Button
            size="small"
            color="inherit"
            onClick={() => setCompareAll(false)}
            sx={{ color: 'text.secondary', textTransform: 'none' }}
          >
            {'Show just my plan and the next step'}
          </Button>
        </Grid>
      ) : null}
    </Grid>
  )
}
BillingPlanCardsComponent.displayName = 'BillingPlanCardsComponent'

export default BillingPlanCardsComponent
