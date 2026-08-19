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
 *
 * `enterprise` (AGL-1118) is a REAL plan, not a display label: it tops the
 * ladder with unlimited capacity plus white-label and SSO, and it is the ONE
 * tier with no list price — it is staff-provisioned per deal (AGL-1110), never
 * self-serve. Surfaces that offer plans for sale iterate `SELF_SERVE_PLANS`,
 * which excludes it; surfaces that merely NAME the org's plan read
 * `PLAN_LABELS` and get "Enterprise" for free.
 */
export type OrgPlan =
  | 'free'
  | 'starter'
  | 'pro'
  | 'business'
  | 'scale'
  | 'advanced'
  | 'agency'
  | 'enterprise'

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
  /** Sell listings on the marketplace marketplace (AGL-46). */
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
   *
   * `true` on all eight tiers, and NO code gates on it — which makes it look
   * dead, and it has now been filed as dead once (AGL-2082). It is not.
   * `tools/marketing/build-pricing-tables.mts` reads its value to emit the
   * "Interactions" row on the public /pricing compare table, ticked on every
   * plan, and the Free plan card bullets it. That row is the claim that a
   * hover-to-open menu is not a paid feature — a real competitive statement,
   * and the reason `true` everywhere is a DECISION rather than a default.
   *
   * So: do not delete it as dead weight. Deleting it silently removes a
   * public pricing row while the Figma frames still carry it in all four
   * responsive variants, which is a pricing call and not a cleanup.
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
   * Agency ($799) and Enterprise carry it on the plan (AGL-1118); any other
   * tier needs a per-org `entitlements` override. Strictly broader than
   * `removeBranding`, which only drops the
   * "Made with Aglyn" badge on published sites; white-label REPLACES the
   * brand rather than merely hiding it. Every branded surface resolves the
   * effective brand through `resolveBrandingProfile` so it can never drift.
   */
  whiteLabel?: boolean
  /**
   * Enterprise SSO (AGL-1101): the org's console users sign in through the
   * org's own SAML/OIDC IdP, wired as a per-org GCIP tenant (`org.sso`).
   * Distinct from `whiteLabel` — an Agency org can have one without the other.
   * Carried by the `enterprise` plan (AGL-1118) and false on every other base
   * plan; a lower tier needs a per-org `entitlements` override, which is how
   * enterprise orgs provisioned before that plan existed still get it. Gates
   * the staff SSO-config card and the SSO sign-in path; a non-entitled org can
   * neither configure nor use SSO.
   */
  ssoEnabled?: boolean
}

/**
 * An org's white-label brand identity (White-Label Phase 1). Populated on
 * the org doc (`orgs/{orgId}.brandingProfile`) and applied ONLY when the org
 * carries the `whiteLabel` entitlement (Agency or Enterprise plan, or a
 * per-org override);
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
 * An org's enterprise SSO configuration (AGL-1101, Phase 1). Applied ONLY when
 * the org carries the `ssoEnabled` entitlement. The actual IdP lives in a
 * per-org **GCIP tenant** (`tenantId`) with a SAML/OIDC **provider**
 * (`providerId`); this block is the org-doc mirror the console reads to route
 * sign-in and the staff card edits. A public `ssoDomains/{domain}` doc maps a
 * verified email domain → `{ orgId, tenantId, providerId }` so the
 * pre-auth sign-in page can resolve an SSO org without reading the org doc.
 *
 * Security: a domain reaches `domains[]` ONLY by passing DNS TXT verification
 * (AGL-1210). This is the account-takeover guard, and it is the whole reason
 * self-serve is safe: without it an org could claim a domain it does not own,
 * `ssoDomains/{domain}` would route that domain's sign-ins to its IdP, and it
 * would intercept another company's logins. Claims in flight live in
 * `orgs/{orgId}/ssoDomains/{domain}` (see `OrgSsoDomainClaim`) and are NOT
 * governed until verified.
 *
 * `enforced` blocks password/social login for the governed domains, so it is a
 * lockout risk and is rehearsed (`previewSsoEnforcement`) before it is applied.
 */
export interface OrgSsoConfig {
  /** GCIP tenant id that carries this org's IdP provider. */
  tenantId: string
  /** GCIP provider id, e.g. `saml.aglyn-workspace` or `oidc.acme`. */
  providerId: string
  /** IdP protocol. Phase 1 ships SAML; OIDC is Phase 2. */
  protocol: 'saml' | 'oidc'
  /** Human label for the IdP (shown on the SSO button + staff card). */
  displayName?: string
  /**
   * Email domains routed to this IdP (lowercased, no `@`). A domain is added
   * here only after its claim passes DNS TXT verification, and removed the
   * moment re-verification fails — so membership of this array IS the
   * "ownership proven" statement. Never write to it from anywhere but the
   * verification path.
   */
  domains: string[]
  /**
   * Retained for `sso-jit`, which gates on it. Kept in lockstep with
   * `domains.length > 0` by the verification path; it was a staff-attested
   * boolean before AGL-1210 and is now derived, never asserted by a human.
   */
  domainVerified: boolean
  /**
   * SAML metadata the CUSTOMER supplies about their IdP. Stored so the pool's
   * provider config can be rebuilt or re-applied without asking again. The
   * X.509 certificate is a public signing certificate, not a secret.
   */
  idp?: {
    entityId: string
    ssoUrl: string
    certificates: string[]
  }
  /**
   * Require SSO for the governed domains — disables password/social login for
   * them (Phase 2). Phase 1 keeps this false so users keep a fallback.
   */
  enforced: boolean
  /** Lifecycle: `configuring` (not live), `active`, or `disabled`. */
  status: 'configuring' | 'active' | 'disabled'
  /**
   * Uid + time of the last config change. Since AGL-1210 this is normally an
   * ORG ADMIN, not staff — the flow is self-serve end to end.
   */
  configuredBy?: string
  configuredAt?: ITimestamp
}

/**
 * A pending or proven claim on one email domain (AGL-1210), stored at
 * `orgs/{orgId}/ssoDomains/{domain}`.
 *
 * A subcollection rather than a map on the org doc because domains contain
 * dots, and a dotted key in a Firestore map is read as a nested field path by
 * every update helper — writing `sso.domainClaims["acme.com"]` would silently
 * create `{acme: {com: …}}`. A document id has no such ambiguity.
 *
 * The claim is deliberately worthless on its own: holding one grants nothing.
 * Only `verified` moving to true adds the domain to `sso.domains`, and only
 * that array is consulted at sign-in.
 */
export interface OrgSsoDomainClaim {
  /** The domain being claimed (lowercased, no `@`); mirrors the document id. */
  domain: string
  /**
   * Random value the org must publish as a DNS TXT record at
   * `_aglyn-challenge.<domain>`. Per org+domain, so two orgs claiming the same
   * domain get different tokens and neither can pass on the other's record.
   */
  token: string
  /** True once a DNS lookup has actually seen `token` at the challenge host. */
  verified: boolean
  createdAt: ITimestamp
  verifiedAt?: ITimestamp
  /** Last lookup attempt, successful or not — drives re-verification. */
  lastCheckedAt?: ITimestamp
  /**
   * TXT records seen on the last FAILED lookup. Shown back to the customer,
   * because "no record found" and "found the wrong value" are different
   * mistakes and the fix differs.
   */
  lastRecords?: string[]
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
  /**
   * RETIRED (AGL-2133). Enforced by nothing and unreachable by measurement —
   * see `RETIRED_ENTITLEMENT_KEYS`. It stays on the TYPE because live org
   * documents still carry staff overrides of it and `OrgEntitlements` is the
   * shape those documents are read through; `resolveOrgEntitlements` drops
   * it, and no plan declares it any more, so nothing can resolve a value.
   * @deprecated
   */
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
  /**
   * CAMPAIGN emails sendable per calendar month (AGL-161), and campaign
   * emails only (AGL-1438).
   *
   * Transactional mail — password resets, invites, order confirmations,
   * booking reminders, workflow notifications — is never refused by this cap
   * at any tier. It still COUNTS toward the org's email cost meter; it simply
   * cannot be blocked, because a quota that can drop a password reset locks
   * somebody out of their own account and a dropped order confirmation reads
   * to the buyer as a failed order.
   *
   * The name is the narrow thing on purpose. A cap that means something
   * narrower than it says is how AGL-1438 came to exist, so every surface
   * that shows this number says "campaign".
   */
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
  /**
   * Platform take rate % on the org's MARKETPLACE listing sales (AGL-46,
   * resolved from entitlements per AGL-1543): 20 on paid plans, 30 on
   * free. Distinct from the storefront `transactionFee*Pct` above — this
   * is Aglyn's cut of a marketplace sale, priced off the SELLER org.
   */
  marketplaceFeePct?: number
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
  /**
   * Extra POS registers beyond the plan's `posRegisters` (AGL-329/524).
   *
   * A POOL, not a raise (AGL-1775). `posRegisters` is enforced PER SITE, so
   * folding this quantity into the org-level entitlement handed every site
   * the whole purchase — one $89/mo register bought 20 registers on a
   * 20-site org. Since AGL-1775 the quantity here is the size of an org-level
   * pool and `registerAllocations` says which site each purchased seat is
   * assigned to. Nothing reads this as a per-site number; use
   * `resolveHostRegisterCap`.
   */
  posRegisters?: number
  /** Event Calendar org-wide toggle, 0/1 (AGL-145/524). */
  eventCalendar?: number
}

/**
 * Which SITE each purchased POS register seat is assigned to (AGL-1775):
 * `{ [hostId]: seats }`, drawn from the org-level pool
 * `seatAddons.posRegisters`.
 *
 * WHY IT LIVES ON THE ORG DOC. The pool is org-level and the entitlement it
 * modifies is resolved from this same document, so a caller that can resolve
 * entitlements at all already holds the allocation — there is no second read
 * to fail and no separate loading state in which a host could resolve to
 * something other than its plan cap. That property is the point: the
 * `checkQuota(undefined)` = Free-tier lesson inverted, where an absent
 * allocation must mean the PLAN's cap and never the pooled total.
 *
 * AN ENTITLEMENT INPUT, and therefore Admin-SDK-only — it is denied to every
 * client in `cloud/firebase-firestore.rules` alongside `seatAddons` and
 * `entitlements`. A client that could write this could assign itself the
 * whole pool on every site, which is the defect AGL-1775 exists to close.
 *
 * A host id absent from the map holds ZERO purchased seats and resolves to
 * the plan cap alone. Deleting a site deletes its key, which returns its
 * seats to the pool — the pool is `seatAddons.posRegisters` minus the sum of
 * this map, so a released key is available capacity by arithmetic rather
 * than by a separate counter that could drift.
 */
export type OrgRegisterAllocations = Record<string, number>

/**
 * The monthly storage-overage spend cap an org CHOSE for itself (AGL-1886,
 * corrected 2026-08-18).
 *
 * Zach, 2026-08-18, verbatim: *"don't let it make us lose revenue or cost us
 * money, it should be a control by the end user, to prevent overage or usage
 * alerts rather, we just want to minimize churn"*.
 *
 * So this document is **absent by default and absent is the normal state**.
 * Storage past a metered plan's included band bills without it; the customer
 * is warned by `usage-alerts` on approach and at the band. Writing a cap here
 * is a customer opting IN to being stopped, and it is the only thing that can
 * refuse an upload on a plan that meters.
 *
 * NOT a consent record. It was one before 2026-08-18 — an acknowledgement
 * that had to exist before a paying org could store a byte past its band —
 * and that shape cost revenue and blocked customers without preventing any
 * bill, because `report-usage` never read it.
 *
 * Still an ENTITLEMENT INPUT in the security sense, in the other direction: a
 * member who could raise their own `capUsd` could raise their own spend
 * ceiling, so the rules deny it to every client and only
 * `/api/billing/storage-overage` (Admin SDK, `billing.manage`) writes it.
 *
 * @see apps/console/utils/storage-overage.ts for the model and what still
 * hard-bands.
 */
export interface OrgStorageOverage {
  /**
   * The monthly storage-overage spend the org will not go past. Present means
   * capped; absent means uncapped, which is the default. A present but
   * malformed value resolves to `STORAGE_CAP_FALLBACK_USD` rather than to "no
   * cap" — a customer who asked for a ceiling must not be billed past one
   * because the stored number was corrupt.
   */
  capUsd?: number
  /** When the cap was set, for the audit trail. */
  capSetAt?: ITimestamp | null
  /** The uid that set it. */
  capSetBy?: string | null
  /**
   * LEGACY (pre-2026-08-18): the acknowledged-consent pair. Read only, and
   * honoured as a cap of `monthlyCeilingUsd` so a ceiling somebody typed is
   * not silently raised. Never written again.
   */
  acknowledgedAt?: ITimestamp | null
  /** @deprecated legacy consent field; see `acknowledgedAt`. */
  acknowledgedBy?: string | null
  /** @deprecated legacy bound; read as a cap. See `capUsd`. */
  monthlyCeilingUsd?: number
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
  /**
   * A downgrade scheduled for the current period end (AGL-1862). Set by
   * `/api/billing/subscription` when a switch walks DOWN the self-serve
   * ladder — the Stripe subscription schedule owns the transition, this is
   * the manager-gated mirror the billing page renders. `null` (not absent)
   * once released, so a merge clears it. Rides inside `subscription` because
   * `pickOrgBillingFields` drops any other top-level key.
   */
  pendingDowngrade?: {
    plan: string
    interval: 'month' | 'year'
    /** ISO timestamp of the period end the schedule flips at. */
    effectiveAt: string | null
    scheduleId: string
  } | null
  /**
   * Negotiated custom price as a **monthly-normalized** USD figure (AGL-1110),
   * set when an enterprise org bills at an ad-hoc amount rather than a plan's
   * list price — e.g. `agency` capability at $2,730/mo. An annual custom deal
   * is stored ÷12 here (the yearly total lives on the Stripe price), so every
   * reader treats it as monthly and never re-divides. Webhook-mirrored from the
   * Stripe subscription's recurring price. When present it is the truth for
   * revenue — `orgListPriceMonthlyUsd`/`orgMonthlyRevenueUsd` use it instead of
   * the plan default (fixes the custom-price MRR under-report, AGL-1110).
   */
  customMonthlyUsd?: number
}

/**
 * The org's billing/entitlement doc shape — the view of `orgs/{orgId}`
 * that `useCurrentOrg()`, the plugin-page `org` prop, and the
 * entitlement resolvers carry. (Formerly `AglynTenant`; the alias was
 * removed in AGL-444.)
 */
/**
 * `orgs/{orgId}.bandwidthCap` — the engaged free-plan bandwidth cap
 * (AGL-1967/2070/2155).
 *
 * STAMPED WITH THE MONTH IT IS FOR, and never cleared. A new month simply
 * stops matching, so the cap lifts on its own with no write: a marker whose
 * removal depends on a cron running is a marker that stays engaged when the
 * cron fails, which would take a customer's site down over an infrastructure
 * problem rather than over their traffic.
 *
 * Plain numbers rather than `ITimestamp`, matching `suspendedUntilMs`, so the
 * value survives the tenant's cache serialization unchanged.
 */
export interface OrgBandwidthCap {
  /** UTC `YYYY-MM` this cap was engaged for. Only the current month refuses. */
  month: string
  /** When the sweep engaged it. Diagnostic only; nothing gates on it. */
  engagedAt?: number
  /** The org-wide page views measured at engage time. Diagnostic. */
  pageViews?: number
  /** The band those page views were measured against. Diagnostic. */
  includedPageViews?: number
}

export interface AglynOrgBilling extends AglynDocument {
  /** The document id, injected by the reader — never a stored field. */
  $id: OrgUid
  /**
   * The org's display name, written by `createOrganization` and renamed
   * through /api/orgs/settings (the name is denormalized onto every
   * membership row, so the rename fans out server-side). Client-writable by
   * an org admin on purpose — see `ORG_CLIENT_WRITABLE_FIELDS`.
   *
   * Spelled `displayName` here until AGL-1355; nothing ever read that, and
   * the document has always carried `name`. The coverage guard derives the
   * org's field set from this interface, so a field that does not exist
   * bought nothing but a blind spot.
   */
  name?: string
  /** Free-text workspace description; nothing gates on it. */
  description?: string
  /** The workspace URL segment, reserved through `orgSlugs/{slug}`. */
  slug?: string
  /**
   * The owner's uid. Spelled `ownerId` here until AGL-1355 — every reader
   * has always used `ownerUid` (the key `createOrganization` writes and the
   * rules deny), so the declared name was dead.
   */
  ownerUid?: UserUid
  hosts?: Record<HostUid, true>
  /** Subscription tier; missing/unknown plans resolve as `free`. */
  plan?: OrgPlan
  /** Per-org entitlement overrides (admin console); win over plan defaults. */
  entitlements?: OrgEntitlements
  /**
   * Per-org RELEASE-flag overrides (AGL-1635) — a different axis from
   * `entitlements`, which asks what the org's plan includes. These ask
   * whether an unreleased feature is switched on for this one customer, and
   * win over both the Remote Config value and the rollout bucket.
   *
   * Staff-only, and deliberately narrower than `entitlements`: super staff
   * alone may write it, matching the platform-wide flag editor
   * (`/api/admin/flags` is super-only), because forcing a flag on for an org
   * is the same class of act as flipping it for everyone — just scoped.
   * Read through `parseOrgReleaseFlagOverrides`, never directly.
   *
   * Typed loosely on purpose. The keys ARE `ReleaseFlagKey`, but that union
   * lives in `app-utils/release-flags` and foundation cannot import
   * app-utils (see `platform.types.ts`). Declaring the narrow type here
   * would also overstate what is on disk: this map outlives registry
   * renames, so a retired key is a thing that genuinely exists in Firestore.
   * `parseOrgReleaseFlagOverrides` is what narrows it, dropping unknown keys
   * and non-booleans.
   */
  releaseFlags?: Record<string, boolean>
  /**
   * White-label brand identity (White-Label Phase 1). Applied only when the
   * org carries the `whiteLabel` entitlement; read exclusively through
   * `resolveBrandingProfile`, never directly, so no surface diverges.
   */
  brandingProfile?: OrgBrandingProfile
  /**
   * Enterprise SSO config (AGL-1101). Applied only when the org carries the
   * `ssoEnabled` entitlement; the console routes sign-in through the org's
   * GCIP tenant/provider named here. See `OrgSsoConfig`.
   */
  sso?: OrgSsoConfig
  /** Per-org plugin switchboard (AGL-416); see plugin-manager/enabled-plugins. */
  enabledPlugins?: string[]
  /** Purchased addon seats (AGL-112); billed monthly per seat. */
  seatAddons?: OrgSeatAddons
  /**
   * POS register seats assigned out of the org pool (AGL-1775). An
   * ENTITLEMENT INPUT: it raises a per-site cap, so it is Admin-SDK-only.
   * @see OrgRegisterAllocations
   */
  registerAllocations?: OrgRegisterAllocations
  /**
   * The free plan's engaged BANDWIDTH CAP (AGL-1967/2070/2155), denormalized
   * onto this doc by the `usage-alerts` cron so the serving path can refuse a
   * capped site without a read of its own.
   *
   * An ENTITLEMENT INPUT in the strongest sense: it is the only thing standing
   * between a free site that has blown its band and unmetered egress, so a
   * client-writable value would let an org admin lift their own cap by
   * deleting one field. Admin-SDK only; denied in the rules.
   *
   * Read exclusively through `bandwidthCapEngaged` (`app-utils/bandwidth-cap`),
   * never directly — the marker on its own is not the answer. The resolver
   * re-derives the plan on every read, which is what lets an org that upgrades
   * mid-month start serving again without waiting for a cron to clear it.
   */
  bandwidthCap?: OrgBandwidthCap
  stripeCustomerId?: string
  subscription?: OrgSubscription
  /**
   * Discount on the org's own Aglyn subscription (AGL-1105) — staff-applied
   * enterprise deal or a redeemed coupon. `orgMonthlyRevenueUsd` subtracts it
   * for net-of-discount MRR; `orgListPriceMonthlyUsd` ignores it (list price).
   */
  discount?: OrgDiscount
  /**
   * Explicit **comped enterprise** marker (AGL-1110). Makes the org read as
   * "Enterprise" (via `isEnterpriseOrg`) without a negotiated custom price —
   * for internal/dogfood accounts (e.g. Aglyn's own org) that carry full
   * Enterprise capability + SSO but are 100%-discounted, so they collect $0
   * while infra cost is still metered. Staff-set; distinct from a paying
   * custom-priced enterprise, which qualifies via `subscription.customMonthlyUsd`.
   */
  enterprise?: boolean
  /**
   * The bare `subscription.status` word the Stripe webhook mirrors back onto
   * this doc for the AGL-275 dunning banner and `resolveEffectivePlan`
   * (AGL-1028). An ENTITLEMENT INPUT: a dead subscription downgrades a paid
   * plan to free, so a client-writable value would restore the plan.
   */
  billingStatus?: string
  /** Staff suspension (AGL-202): set = all the org's sites serve 503. */
  suspendedAt?: ITimestamp | null
  suspendedReason?: string
  /**
   * GDPR erasure request (AGL-206): hard deletion happens ONLY via `eraseOrg`
   * after a 7-day hold from this stamp — reached by the
   * `/api/admin/run-erasures` cron, or by hand with
   * tools/scripts/erase-tenant.mjs, which calls the same function (AGL-1481).
   */
  erasureRequestedAt?: ITimestamp | null
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
}

/**
 * WHO OWNS EACH FIELD OF `orgs/{orgId}` (AGL-1355).
 *
 * AGL-1354 found four server-owned keys — `brandingProfile`, `sso`,
 * `discount`, `enterprise` — that the Firestore rules' org-update key diff
 * had drifted past, so an org admin holding nothing but the Firebase client
 * SDK could write them on any plan. The keys are closed. The MECHANISM that
 * opened them was a hand-maintained deny-list with nothing checking it, and
 * that is what these two maps close.
 *
 * The rule is DEFAULT-DENY, and it is enforced from the interface above:
 * `org-write-deny-coverage.spec.ts` reads every field declared on
 * `AglynOrgBilling`, and one that appears in neither the rules' deny-list nor
 * one of these maps FAILS THE BUILD, naming the field. Adding a field to the
 * interface therefore forces the ownership decision here, at the declaration,
 * on the same commit — instead of shipping client-writable and staying that
 * way until the next audit.
 *
 * So: add a field above, and either add it to the `hasAny([...])` list in
 * `cloud/firebase-firestore.rules` under `match /orgs/{orgId}` (server-owned:
 * anything an entitlement, a price, a routing decision or a staff judgement
 * reads) or add it below WITH A REASON. When in doubt, deny it — a field the
 * server writes through an Admin-SDK route loses nothing by being denied to
 * the client, and that is true of every key AGL-1354 closed.
 *
 * The entries are the fields an org admin may set from the client SDK. The
 * reason is mandatory and is the whole value of the map: it records that
 * someone decided, rather than that someone forgot.
 */
export const ORG_CLIENT_WRITABLE_FIELDS: Readonly<Record<string, string>> = {
  name:
    'The workspace name. Deliberately writable by an org admin — the rules ' +
    'admit the rename branch and `firestore-rules.test.mjs` asserts it still ' +
    'succeeds. Cosmetic: no entitlement, price or routing decision reads it. ' +
    '(The console renames through /api/orgs/settings anyway, because the name ' +
    'is denormalized onto every membership row and the fan-out is a server ' +
    'job — but the client write is allowed and must stay allowed.)',
  description:
    'Free-text workspace blurb. Nothing resolves, gates or bills on it, and ' +
    'no server route owns it.',
  createdAt:
    'Creation stamp seeded by `createOrganization`. Nothing gates on it; the ' +
    'staff org list only displays it. Denying it would buy nothing and would ' +
    'break the merge-writes below, which stamp the pair together.',
  updatedAt:
    'Last-write stamp. Every client write that IS allowed sets it in the same ' +
    '`setDoc(..., { merge: true })` — the staff suspension, erasure-request ' +
    'and plan-override cards all do — so denying it would deny those writes.',
}

/**
 * Fields declared on `AglynOrgBilling` that are NOT stored on the document,
 * and so cannot be written by anyone. Separate from the map above because
 * "the client may set this" and "this is not a field" are different
 * statements, and collapsing them would let a genuinely client-writable field
 * hide behind a synthetic one.
 */
export const ORG_UNPERSISTED_FIELDS: Readonly<Record<string, string>> = {
  $id: 'The document id, injected by the reader. Never written as a field.',
}

