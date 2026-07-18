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
/** SaaS subscription tiers (Tenant Billing & SaaS Plans, AGL-38..41). */
export type OrgPlan =
  | 'free'
  | 'starter'
  | 'pro'
  | 'business'
  | 'advanced'

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
  /** Event → action automation builder (AGL-148). */
  actions?: boolean
  /** Outbound/inbound webhooks (AGL-149). */
  webhooks?: boolean
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
  storagePerHostMb?: number
  totalSiteSizeMb?: number
  membersPerHost?: number
  /** Seat model (AGL-112): included tenant-manager seats. */
  managersPerOrg?: number
  /** Hard seat caps incl. purchased addons; beyond these, upgrade the plan. */
  maxManagersPerOrg?: number
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
  /** Extra host-member seats (applies per host). */
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

export interface OrgSubscription {
  status?:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'incomplete'
    | 'unpaid'
  priceId?: string
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
  /** Per-org plugin switchboard (AGL-416); see plugin-manager/enabled-plugins. */
  enabledPlugins?: string[]
  /** Purchased addon seats (AGL-112); billed monthly per seat. */
  seatAddons?: OrgSeatAddons
  stripeCustomerId?: string
  subscription?: OrgSubscription
  /** Staff suspension (AGL-202): set = all the org's sites serve 503. */
  suspendedAt?: ITimestamp | null
  suspendedReason?: string
  /**
   * GDPR erasure request (AGL-206): hard deletion happens ONLY via
   * tools/scripts/erase-tenant.mjs after a 7-day hold from this stamp.
   */
  erasureRequestedAt?: ITimestamp | null
}

