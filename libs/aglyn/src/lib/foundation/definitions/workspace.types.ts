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

import type { HttpStatusCode } from '@aglyn/shared-data-enums'
import type { HostTheme } from '@aglyn/shared-data-types'
import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type { AglynNodeSchema, NodeId } from './components.types'

export interface AglynDocument {
  [field: string]: any
}

export enum HostScreenStatus {
  UNPUBLISHED = 0x1 << 0x1,
  PUBLISHED = 0x1 << 0x2,
  SCHEDULED_TO_PUBLISH_UNPUBLISHED = UNPUBLISHED | (0x1 << 0x3),
  SCHEDULED_TO_UNPUBLISH_PUBLISHED = PUBLISHED | (0x1 << 0x4),
  SCHEDULED_TO_UPDATE_PUBLISHED = PUBLISHED | (0x1 << 0x5),
  SCHEDULED_TO_REVERT_UPDATE_PUBLISHED = PUBLISHED | (0x1 << 0x6),
}

export enum HostScreenVisibility {
  PUBLIC = 0x1 << 0x1,
  UNLISTED = PUBLIC | (0x1 << 0x2),
  PRIVATE = 0x1 << 0x3,
  PASSWORD = PRIVATE | (0x1 << 0x4),
  AUTHENTICATED = PRIVATE | (0x1 << 0x5),
  AUTHORIZED = AUTHENTICATED | (0x1 << 0x6),
}

export enum HostViewType {
  SCREEN = 0x1,
  LAYOUT = 0x2,
}

export enum HostViewFormat {
  NORMALIZED = 0x1,
  DENORMALIZED = 0x2,
}

export enum HostEntityType {
  ORGANIZATION = 0x1,
  PERSON = 0x2,
}

export enum HostRedirectParams {
  IGNORE,
  FORWARD = 0x1,
  MATCH = 0x2,
}

export enum ActivityAccess {
  NONE,
  READ = 0x1 << 0x1,
  WRITE = 0x1 << 0x2,
  READ_WRITE = READ | WRITE,
  SUPER = READ_WRITE | (0x1 << 0x3),
}

export type UserUid = string

export interface AglynUser extends AglynDocument {
  $id: UserUid
  roleId?: RoleUid
  admin?: boolean
  email?: string
  tenants?: Record<TenantUid, true>
}

export type TenantUid = string

/** Hosted in master catalog */
/** SaaS subscription tiers (Tenant Billing & SaaS Plans, AGL-38..41). */
export type TenantPlan = 'free' | 'starter' | 'pro' | 'business'

/** Boolean feature gates per plan; quotas live beside them as numbers. */
export interface TenantFeatureFlags {
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
}

/**
 * Effective limits/gates for a tenant. Plan defaults come from
 * `PLAN_ENTITLEMENTS` (versioned with the app); per-tenant overrides can be
 * stored on the tenant doc and win over the plan defaults.
 */
export interface TenantEntitlements {
  hostLimit?: number
  screensPerHost?: number
  sharedLayoutsPerHost?: number
  storagePerHostMb?: number
  totalSiteSizeMb?: number
  membersPerHost?: number
  /** Seat model (AGL-112): included tenant-manager seats. */
  managersPerTenant?: number
  /** Hard seat caps incl. purchased addons; beyond these, upgrade the plan. */
  maxManagersPerTenant?: number
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
  /** Dynamic data caps (AGL-99/102). */
  datasetsPerHost?: number
  recordsPerDataset?: number
  features?: TenantFeatureFlags
}

/**
 * Paid addon seats (AGL-112) purchased on top of the plan's included seats.
 * The effective seat limit is `included + purchased`, clamped to the plan's
 * hard max — beyond the max the tenant must upgrade.
 */
export interface TenantSeatAddons {
  /** Extra tenant-manager seats. */
  managers?: number
  /** Extra host-member seats (applies per host). */
  members?: number
}

export interface TenantSubscription {
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

export interface AglynTenant extends AglynDocument {
  $id: TenantUid
  ownerId?: UserUid
  displayName?: string
  description?: string
  hosts?: Record<HostUid, true>
  users?: Record<UserUid, true>
  /** Subscription tier; missing/unknown plans resolve as `free`. */
  plan?: TenantPlan
  /** Per-tenant entitlement overrides (admin console); win over plan defaults. */
  entitlements?: TenantEntitlements
  /** Purchased addon seats (AGL-112); billed monthly per seat. */
  seatAddons?: TenantSeatAddons
  stripeCustomerId?: string
  subscription?: TenantSubscription
}

export type ProjectUid = string
export type ProjectNumber = number

export type HostUid = string
export type HostPath = string
export type HostMediaUid = string

/**
 * Persisted MUI theme customization for a host's published site.
 * Canonical shape lives in `@aglyn/shared-data-types` so UI-scope libs can
 * consume it without depending on this framework lib.
 */
export type AglynHostTheme = HostTheme

/** Hosted in tenants' host project */
export interface AglynHost extends AglynDocument {
  $id: HostUid
  tenantId?: TenantUid
  subdomain?: string
  cname?: string
  displayName?: string
  seo?: {
    title?: string
    description?: string
    separator?: string
    favicon?: string
    image?: HostMediaUid
    entity?: {
      type?: HostEntityType
      name?: string
      logo?: string
    }
  }
  screens?: Record<ScreenUid, ScreenSlug>
  /** Screen rendered (noindex) for unmatched paths (AGL-87). */
  notFoundScreenId?: ScreenUid
  /** Directory of shared layouts by display name (mirrors `screens`). */
  layouts?: Record<LayoutUid, string>
  theme?: AglynHostTheme

  // CONCEPT: Redirect screens
  redirects?: Record<RedirectUid, true>

  // CONCEPT: Enterprise - Siloed projects
  projectId?: ProjectUid
  projectNumber?: ProjectNumber
}

export type RoleUid = string
export type PermissionUid = string

export interface AglynAuthRole extends AglynDocument {
  $id: RoleUid
  displayName?: string
  description?: string
  permissions?: Record<PermissionUid, true>
  users?: Record<UserUid, true>
}

export interface AglynRolePermission extends AglynDocument {
  $id: PermissionUid
  displayName?: string
  description?: string
  roles?: Record<RoleUid, true>
}

export interface AglynAccessRule extends AglynDocument {
  roles?: Record<RoleUid, ActivityAccess>
  permissions?: Record<PermissionUid, ActivityAccess>
  users?: Record<UserUid, ActivityAccess>
}

export type ScreenUid = string
export type ScreenSlug = string
export type VersionUid = string
export type LayoutUid = string

/**
 * Uploaded media metadata (AGL-72): the binary lives in Firebase Storage at
 * `hosts/{hostId}/media/{mediaId}`; this doc mirrors it in Firestore at the
 * same logical path so the library can list without Storage list calls.
 */
export interface AglynHostMedia {
  $id: HostMediaUid
  fileName?: string
  contentType?: string
  sizeBytes?: number
  /** Download URL captured at upload time; nodes reference this directly. */
  url?: string
  createdAt?: ITimestamp
  deletedAt?: ITimestamp
}

/**
 * Pending scheduled publication (AGL-61): when `publishAt` passes, the
 * parent doc's `versionId` pointer moves to `versionId`. Applied lazily by
 * the tenant's ISR revalidation (no dedicated cron needed).
 */
export interface PublishSchedule {
  /** Version to make live; unused for `action: 'unpublish'` (AGL-113). */
  versionId?: VersionUid
  /**
   * What happens at `publishAt` (AGL-113): `publish` (default) flips the
   * live version pointer; `unpublish` removes the screen's routing-map
   * entry so its path 404s after the next revalidate.
   */
  action?: 'publish' | 'unpublish'
  publishAt: ITimestamp
  status: 'pending' | 'applied' | 'canceled'
  createdAt?: ITimestamp
}

/** Hosted in tenants' host project */
export interface AglynScreen extends AglynDocument {
  $id: ScreenUid
  tenantId?: TenantUid
  hostId?: HostUid
  parentId?: ScreenUid
  slug?: ScreenSlug
  /** Position among siblings (screens sharing `parentId`) in the screens list. */
  order?: number
  versionId?: VersionUid
  publishSchedule?: PublishSchedule
  /** Password protection (AGL-87): sha256 hex of the visitor password. */
  protection?: { passwordHash?: string }
  status?: HostScreenStatus
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
  displayName?: string
  description?: string
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    image?: HostMediaUid
  }

  // CONCEPT: Scheduling
  schedule?: {
    startAt?: ITimestamp
    endAt?: ITimestamp
    next?: VersionUid
    previous?: VersionUid
  }

  // CONCEPT: Contextual visibility
  visibility?: HostScreenVisibility | AglynAccessRule

  // CONCEPT: Attribute editors
  owner?: UserUid
  contributors?: {
    [P in string & UserUid]: true
  }

  /** Shared layout this screen renders inside (see {@link AglynLayout}). */
  layoutId?: LayoutUid
}

/**
 * Hosted in tenants' host project.
 * `N` lets higher layers narrow the node schema (e.g. the aglyn SDK
 * instantiates it with its richer `NodeSchema`).
 */
export interface AglynScreenVersion<N = AglynNodeSchema>
  extends AglynDocument {
  $id: VersionUid
  tenantId?: TenantUid
  hostId?: HostUid
  screenId?: ScreenUid
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  nodes?: Record<NodeId, N>
}

/** Unique id of a host-level reusable component definition. */
export type ComponentDefUid = string

/**
 * Reusable component definition: a node subtree promoted from a screen,
 * inserted anywhere as an instance node (`componentId: 'reusableInstance'`,
 * `props.refId`) and grafted at render time (see
 * `composeReusableComponentNodes`). Hosted in tenants' host project at
 * `hosts/{hostId}/components/{componentId}`.
 */
export interface AglynHostComponent<N = AglynNodeSchema>
  extends AglynDocument {
  $id: ComponentDefUid
  tenantId?: TenantUid
  hostId?: HostUid
  displayName?: string
  description?: string
  /** Definition tree root id within {@link AglynHostComponent.nodes}. */
  rootId?: NodeId
  nodes?: Record<NodeId, N>
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
}

/**
 * Shared layout: canvas chrome (appbar, footer, nav) designed once and
 * rendered around every bound screen. Hosted in tenants' host project at
 * `hosts/{hostId}/layouts/{layoutId}`.
 */
export interface AglynLayout extends AglynDocument {
  $id: LayoutUid
  tenantId?: TenantUid
  hostId?: HostUid
  /** Published version pointer; bound screens render this version. */
  versionId?: VersionUid
  publishSchedule?: PublishSchedule
  versions?: Array<VersionUid>
  displayName?: string
  description?: string
  contributors?: Array<UserUid>
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
}

/**
 * Shared layout version. Node map has the same shape as a screen version
 * (including compression at rest) plus a LayoutSlot node marking where the
 * bound screen's content is grafted. Hosted at
 * `hosts/{hostId}/layouts/{layoutId}/versions/{versionId}`.
 */
export interface AglynLayoutVersion<N = AglynNodeSchema>
  extends AglynScreenVersion<N> {
  layoutId?: LayoutUid
  hostId?: HostUid
}

export type RedirectUid = string

/** CONCEPT: Host redirects. Hosted in tenants' host project */
export interface AglynRedirect extends AglynDocument {
  $id: RedirectUid
  hostId?: HostUid
  sourcePath?: HostPath
  sourceScreen?: ScreenUid
  destinationPath?: HostPath
  destinationScreen?: ScreenUid
  statusCode?: HttpStatusCode
  params?: HostRedirectParams
  flags?: {
    regex?: true
    ignoreSlash?: true
    ignoreCase?: true
  }
  hits?: number
  lastAccess?: ITimestamp
  description?: string
}
