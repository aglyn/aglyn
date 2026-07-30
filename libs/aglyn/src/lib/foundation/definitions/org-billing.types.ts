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
 * The org's billing/entitlement vocabulary (AGL-443 naming cleanup).
 *
 * HISTORY: these types were spelled `Tenant*` until AGL-444 — they
 * predate the organizations migration (AGL-232..238); the retired
 * `tenants/{uid}` collection's billing shape was mirrored ONTO the org
 * doc and the names came along. The alias is gone: everything here is
 * `Org*` and describes fields of `orgs/{orgId}`. The last persisted
 * tenant spellings (the `users.{uid}.tenants` map, Stripe
 * `metadata[tenantId]`, `host.tenantId`) were retired pre-launch in
 * AGL-445 — billing keys off `metadata[orgId]` now.
 *
 * Convention (see the docs-site glossary): "organization/org" is the
 * entity; "workspace" is the user-facing word for it; "tenant" is
 * reserved for the published-site runtime (`apps/tenant`,
 * `@aglyn/tenant-*` libs).
 */

import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type {
  AglynDocument,
  HostUid,
  OrgUid,
  UserUid,
} from './platform.types'

export type { OrgUid } from './platform.types'


/** Hosted in master catalog */
/**
 * SaaS subscription tiers (Tenant Billing & SaaS Plans, AGL-38..41).
 * Pricing v3 (2026-07) inserted `scale` between business and advanced to
 * fill the $139→$399 gap, and added `agency` above advanced for
 * high-volume multi-site orgs — see the Pricing Decision Log.
 */
export type OrgPlan =
  | 'free'
  | 'starter'
  | 'pro'
  | 'business'
  | 'scale'
  | 'advanced'
  | 'agency'

/** Boolean feature gates per plan; quotas live beside them as numbers. */
export interface OrgFeatureFlags {
  /** A/B experiments (AGL-252); Business tier. */
  abTesting?: boolean
  versioning?: boolean
  reusableComponents?: boolean
  customDomain?: boolean
  removeBranding?: boolean
  /** Schedule a version to publish at a date/time (tier above versioning). */
  scheduledPublishing?: boolean
  /** Sell listings on the community marketplace (AGL-46). */
  marketplaceSelling?: boolean
  /** AI copy assist in the besigner (AGL-89). */
  aiAssist?: boolean
  /** No-code workflow builder (AGL-101). */
  workflows?: boolean
  /** Datasets + repeatable components (AGL-102/103). */
  dataStore?: boolean
  /** Video/file uploads in the media manager (AGL-162). */
  videoMedia?: boolean
  /** Appointment bookings (AGL-159). */
  bookings?: boolean
  /**
   * Basic presentational interactions (AGL-577): menu/drawer open-close,
   * element show/hide, class toggles, sticky nav, navigation, site
   * alerts. Included on ALL plans — pure client-side DOM with no server
   * cost. The `actions` flag below gates the powerful automation steps
   * (server dispatch, runJs, analytics, overlays, raw HTML).
   */
  interactions?: boolean
  /** Event → action automation builder (AGL-148). */
  actions?: boolean
  /** Outbound/inbound webhooks (AGL-149). */
  webhooks?: boolean
  /** Customer REST API v1 + API keys (AGL-615); Business tier. */
  apiAccess?: boolean
  /** Whole-site export/backup + restore (AGL-163). */
  siteExport?: boolean
  /** Multilingual sites (AGL-164): locale variants + switcher. */
  multilingual?: boolean
  /** Event Calendar add-on (AGL-145); paid, not part of any base tier. */
  eventCalendar?: boolean
  /** URL redirects manager (AGL-154). */
  redirects?: boolean
  /** Per-screen traffic analytics (AGL-150). */
  screenAnalytics?: boolean
  /** CDN delivery + responsive image variants for media (AGL-175). */
  mediaCdn?: boolean
  /** Announcement bar + promotional popups (AGL-195/196). */
  marketingOverlays?: boolean
  /** Full storefront commerce: catalog, cart, checkout (AGL-278). */
  commerce?: boolean
  /** Console point-of-sale mode (AGL-312). */
  pos?: boolean
  /** Recurring storefront subscription products (AGL-303). */
  storefrontSubscriptions?: boolean
  /** Entitlement-gated screens/sections/video paywalls (AGL-309). */
  contentGating?: boolean
  /** Gift cards & store credit (AGL-322). */
  giftCards?: boolean
  /** Verified-buyer product reviews (AGL-324). */
  productReviews?: boolean
  /** Abandoned checkout recovery emails (AGL-323). */
  abandonedCart?: boolean
  /** Dropship supplier routing on paid orders (AGL-289). */
  dropshipRouting?: boolean
  /** Commerce analytics dashboard (AGL-327). */
  commerceAnalytics?: boolean
  /**
   * White-label the platform (White-Label Phase 1): replace the Aglyn brand
   * — product name, logo, colors, support URL, transactional email from-name
   * — with the org's own `brandingProfile` across every branded surface.
   * Agency tier only ($799); Enterprise inherits via a per-org `entitlements`
   * override. Strictly broader than `removeBranding`, which only drops the
   * "Made with Aglyn" badge on published sites; white-label REPLACES the
   * brand rather than merely hiding it. Every branded surface resolves the
   * effective brand through `resolveBrandingProfile` so it can never drift.
   */
  whiteLabel?: boolean
}

/**
 * An org's white-label brand identity (White-Label Phase 1). Populated on
 * the org doc (`orgs/{orgId}.brandingProfile`) and applied ONLY when the org
 * carries the `whiteLabel` entitlement (Agency tier / Enterprise override);
 * otherwise every surface falls back to the Aglyn defaults baked into
 * `resolveBrandingProfile`. Every field is optional — a partial profile
 * still resolves, with the Aglyn default filling each gap — so an agency can
 * set just a product name and from-name without supplying logos.
 */
export interface OrgBrandingProfile {
  /** Brand name shown in place of "Aglyn" (console chrome, emails, badges). */
  productName?: string
  /** Primary/full-color logo URL (light backgrounds, console chrome). */
  logoUrl?: string
  /** Favicon URL for branded surfaces. */
  faviconUrl?: string
  /** Brand primary color as a CSS color (hex), e.g. `#1a73e8`. */
  primaryColor?: string
  /** Support/help destination linked from branded surfaces and emails. */
  supportUrl?: string
  /** Transactional email from-name (the display name before the address). */
  fromName?: string
  /** Logo URL specifically for the email header (often a hosted PNG). */
  emailLogoUrl?: string
  /** Custom console domain the agency serves the app on (Phase 4 wiring). */
  customConsoleDomain?: string
}

/**
 * Effective limits/gates for a tenant. Plan defaults come from
 * `PLAN_ENTITLEMENTS` (versioned with the app); per-tenant overrides can be
 * stored on the tenant doc and win over the plan defaults.
 */
export interface OrgEntitlements {
  hostLimit?: number
  screensPerHost?: number
  sharedLayoutsPerHost?: number
  /** Saved templates per host (AGL-666) — includes marketplace downloads. */
  templatesPerHost?: number
  // NOTE (AGL-658): "add-on" means two unrelated things in this codebase.
  // `seatAddons` below are BILLING capacity — extra managers, hosts, seats —
  // surfaced in the UI as "plan add-ons". The marketplace sense (installed
  // plugins, the `orgAddons` slot) is a different concept entirely. The
  // marketplace owns the bare word; billing copy always qualifies it.
  // Firestore and Stripe lookup keys stay as they are — they are persisted.
  storagePerHostMb?: number
  totalSiteSizeMb?: number
  /**
   * Included per-site COLLABORATOR seats (`hosts/{id}/members`,
   * viewer/editor/admin) — console teammates scoped to one site, not
   * end-user member accounts (`siteMembers`), which are unlimited on
   * every plan (AGL-888/889). Legacy key name; persisted, do not rename.
   */
  membersPerHost?: number
  /** Seat model (AGL-112): included tenant-manager seats. */
  managersPerOrg?: number
  /** Hard seat caps incl. purchased addons; beyond these, upgrade the plan. */
  maxManagersPerOrg?: number
  /** Hard per-site collaborator cap incl. addons (see `membersPerHost`). */
  maxMembersPerHost?: number
  bandwidthGb?: number
  /** Form submissions accepted per calendar month (Forms & Lead Capture). */
  formSubmissionsPerMonth?: number
  /** Component-builder caps (AGL-99): host variables. */
  variablesPerHost?: number
  /** Component-builder caps (AGL-99): host functions. */
  functionsPerHost?: number
  /** Workflow builder cap (AGL-99/101). */
  workflowsPerHost?: number
  /** Event-triggered workflow runs per calendar month (AGL-165). */
  workflowRunsPerMonth?: number
  /** Bookable services per host (AGL-159). */
  servicesPerHost?: number
  /** Redirect rules per host (AGL-154). */
  redirectsPerHost?: number
  /** Contacts CRM cap (AGL-197): unified people records per host. */
  contactsPerHost?: number
  /** Campaign emails sendable per calendar month (AGL-161). */
  emailSendsPerMonth?: number
  /** Action runs per calendar month (AGL-148). */
  actionRunsPerMonth?: number
  /** Included customer REST API requests per calendar month (AGL-634);
   * beyond it, metered overage per 1,000 where the plan prices it. Only
   * Business/Advanced carry `apiAccess`, so lower tiers are 0. */
  apiRequestsPerMonth?: number
  /** Dynamic data caps — org-scoped (AGL-239/240): datasets are shared
   * by every host in the org, so counts and size meter per org. */
  datasetsPerOrg?: number
  /** Hard dataset cap incl. addons (AGL-132/240); beyond it, upgrade. */
  maxDatasetsPerOrg?: number
  recordsPerDataset?: number
  /** Included aggregate dataset storage (MB) across the org (AGL-240);
   * beyond it, metered overage per GB where the plan prices it. */
  dataStorageMbPerOrg?: number
  /** @deprecated Legacy host-keyed override (pre-AGL-240); resolved into
   * `datasetsPerOrg` by `resolveOrgEntitlements`. */
  datasetsPerHost?: number
  /** @deprecated Legacy host-keyed override (pre-AGL-240); resolved into
   * `maxDatasetsPerOrg` by `resolveOrgEntitlements`. */
  maxDatasetsPerHost?: number
  /** Catalog products per host (AGL-278). */
  productsPerHost?: number
  /** Inventory locations per host (AGL-286). */
  inventoryLocations?: number
  /** Concurrent POS registers (AGL-312); add-ons raise it (AGL-329). */
  posRegisters?: number
  /** Platform fee % on physical storefront sales (Connect app fee). */
  transactionFeePhysicalPct?: number
  /** Platform fee % on digital storefront sales (Connect app fee). */
  transactionFeeDigitalPct?: number
  features?: OrgFeatureFlags
}

/**
 * Paid addon quantities (AGL-112/524) purchased on top of the plan's
 * included allowances, billed as items on the org's Stripe subscription.
 * Seat/dataset kinds resolve as `included + purchased` clamped to the
 * plan's hard max — beyond the max the org must upgrade. Purchases only
 * count while the subscription is alive (they bill on it); staff grants
 * live on `entitlements` overrides instead, so the two never collide.
 */
export interface OrgSeatAddons {
  /** Extra tenant-manager seats. */
  managers?: number
  /**
   * Extra per-site collaborator seats (applies per host). Legacy key name
   * (AGL-888): the Stripe price env suffix is still `EXTRA_MEMBER` and
   * existing org docs carry this key — persisted, do not rename.
   */
  members?: number
  /** Extra org datasets (AGL-132/240); billed monthly per dataset. */
  datasets?: number
  /** Extra sites beyond the plan's `hostLimit` (AGL-68/524). */
  hosts?: number
  /** Extra POS registers beyond the plan's `posRegisters` (AGL-329/524). */
  posRegisters?: number
  /** Event Calendar org-wide toggle, 0/1 (AGL-145/524). */
  eventCalendar?: number
}

/**
 * A discount applied to the org's OWN Aglyn subscription (AGL-1105) — a
 * comped enterprise deal or a redeemed coupon, mirrored from a Stripe coupon
 * so `orgMonthlyRevenueUsd` can report net-of-discount MRR without a Stripe
 * round-trip. Exactly one of `percentOff` / `amountOffUsd` is set, matching
 * the Stripe coupon it points at (Stripe coupons are one or the other).
 * DISTINCT from a storefront/customer discount — this is Aglyn's own bill.
 */
export interface OrgDiscount {
  /** The Stripe coupon id (`co_…`) applied to the subscription. */
  couponId: string
  /** The Stripe promotion code id (`promo_…`), when the coupon has a code. */
  promotionCodeId?: string
  /** The human redemption code (e.g. `LAUNCH25`), when one exists. */
  code?: string
  /** Percentage off, 0–100 (mutually exclusive with `amountOffUsd`). */
  percentOff?: number
  /** Fixed USD off per invoice (mutually exclusive with `percentOff`). */
  amountOffUsd?: number
  /** The staff uid that applied it (audit trail; self-serve reads `system`). */
  appliedBy: UserUid
  /** Free-text why (the enterprise deal, the promotion) — staff-only. */
  reason?: string
  appliedAt: ITimestamp
}

export interface OrgSubscription {
  status?:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'incomplete'
    | 'unpaid'
  priceId?: string
  /**
   * Billing interval of the plan item (AGL-532), webhook-mirrored: the
   * Billing page initializes its monthly/annual toggle from it and plan
   * switches keep it unless the toggle says otherwise.
   */
  interval?: 'month' | 'year'
  currentPeriodEnd?: ITimestamp
}

/**
 * The org's billing/entitlement doc shape — the view of `orgs/{orgId}`
 * that `useCurrentOrg()`, the plugin-page `org` prop, and the
 * entitlement resolvers carry. (Formerly `AglynTenant`; the alias was
 * removed in AGL-444.)
 */
export interface AglynOrgBilling extends AglynDocument {
  $id: OrgUid
  ownerId?: UserUid
  displayName?: string
  description?: string
  hosts?: Record<HostUid, true>
  users?: Record<UserUid, true>
  /** Subscription tier; missing/unknown plans resolve as `free`. */
  plan?: OrgPlan
  /** Per-org entitlement overrides (admin console); win over plan defaults. */
  entitlements?: OrgEntitlements
  /**
   * White-label brand identity (White-Label Phase 1). Applied only when the
   * org carries the `whiteLabel` entitlement; read exclusively through
   * `resolveBrandingProfile`, never directly, so no surface diverges.
   */
  brandingProfile?: OrgBrandingProfile
  /** Per-org plugin switchboard (AGL-416); see plugin-manager/enabled-plugins. */
  enabledPlugins?: string[]
  /** Purchased addon seats (AGL-112); billed monthly per seat. */
  seatAddons?: OrgSeatAddons
  stripeCustomerId?: string
  subscription?: OrgSubscription
  /**
   * Discount on the org's own Aglyn subscription (AGL-1105) — staff-applied
   * enterprise deal or a redeemed coupon. `orgMonthlyRevenueUsd` subtracts it
   * for net-of-discount MRR; `orgListPriceMonthlyUsd` ignores it (list price).
   */
  discount?: OrgDiscount
  /** Staff suspension (AGL-202): set = all the org's sites serve 503. */
  suspendedAt?: ITimestamp | null
  suspendedReason?: string
  /**
   * GDPR erasure request (AGL-206): hard deletion happens ONLY via
   * tools/scripts/erase-tenant.mjs after a 7-day hold from this stamp.
   */
  erasureRequestedAt?: ITimestamp | null
}

