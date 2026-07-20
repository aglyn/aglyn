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

/**
 * Platform-side definitions: documents, hosts, screens, media, users.
 * The ORG BILLING family (`AglynOrgBilling` and the Org* plan/entitlement
 * vocabulary) lives in `org-billing.types.ts` — see the docs-site glossary
 * for the org/workspace/tenant/host naming convention. (This file was
 * `workspace.types.ts`; renamed in AGL-443 because nothing in it is the
 * workspace/org entity.)
 */
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
  /** A besigner-designed email document (screen with kind 'email', AGL-395). */
  EMAIL = 0x4,
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

/** Org document id (`orgs/{orgId}`). Formerly TenantUid (AGL-444). */
export type OrgUid = string

export type UserUid = string

export interface AglynUser extends AglynDocument {
  $id: UserUid
  admin?: boolean
  email?: string
}

/**
 * Site-wide announcement bar config on the host doc (AGL-195). Text may
 * contain binding tokens; the tenant render resolves them server-side.
 */
export interface HostAnnouncementBar {
  enabled?: boolean
  text?: string
  /** Optional link the whole bar navigates to. */
  href?: string
  backgroundColor?: string
  textColor?: string
  /** Visitors may hide the bar; hidden state re-arms when text changes. */
  dismissible?: boolean
}

/**
 * Promotional popup config on the host doc (AGL-196); one per host,
 * marketingOverlays-gated. Body text may contain binding tokens; the
 * tenant render resolves them server-side.
 */
export interface HostPopup {
  enabled?: boolean
  headline?: string
  body?: string
  /** Media-library image URL shown above the copy. */
  imageUrl?: string
  ctaLabel?: string
  ctaHref?: string
  /** Render an email-capture field posting into the forms pipeline. */
  collectEmail?: boolean
  /** How the popup opens. */
  trigger?: 'delay' | 'scroll' | 'exit'
  /** Seconds (delay trigger) or percent 0-100 (scroll trigger). */
  triggerValue?: number
  /** Re-show after this many days once dismissed (localStorage). */
  frequencyDays?: number
  /** Optional showing window (epoch millis; simple to serialize). */
  startAtMs?: number
  endAtMs?: number
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

/** Host-scoped document */
export interface AglynHost extends AglynDocument {
  $id: HostUid
  /** Owning org (AGL-233); mirrored into `hostIndex/{hostId}`. */
  orgId?: OrgUid
  /** Membership projection from the org (AGL-233): uid → role tier. */
  memberRoles?: Record<UserUid, string>
  subdomain?: string
  cname?: string
  /** Site-wide announcement bar (AGL-195); marketingOverlays-gated. */
  announcementBar?: HostAnnouncementBar
  /** Promotional popup (AGL-196); marketingOverlays-gated. */
  popup?: HostPopup
  displayName?: string
  /**
   * Site logo URL (AGL-594): the host's own brand mark, shown by the
   * tenant's navigation loader (and future chrome). Distinct from
   * `seo.entity.logo`, which is publisher-semantic JSON-LD.
   */
  logoUrl?: string
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
  /**
   * Designable error screens by status (AGL-131). `notFound` supersedes
   * `notFoundScreenId` (kept in sync for back-compat).
   */
  errorScreens?: HostErrorScreens
  /** Maintenance mode (AGL-131): every path renders the 503 screen. */
  maintenance?: boolean
  /** Site languages (AGL-164), e.g. ['en', 'es']; first is the default
   * unless `defaultLocale` says otherwise. */
  locales?: string[]
  defaultLocale?: string
  /** Directory of shared layouts by display name (mirrors `screens`). */
  layouts?: Record<LayoutUid, string>
  theme?: AglynHostTheme

  // CONCEPT: Redirect screens
  redirects?: Record<RedirectUid, true>

  // CONCEPT: Enterprise - Siloed projects
  projectId?: ProjectUid
  projectNumber?: ProjectNumber
}

/** Error-screen bindings by HTTP-ish status (AGL-131). */
export interface HostErrorScreens {
  notFound?: ScreenUid
  unauthorized?: ScreenUid
  forbidden?: ScreenUid
  unavailable?: ScreenUid
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
  /**
   * Folder doc id in `hosts/{hostId}/mediaFolders` (AGL-171); null/absent
   * = root. Replaces the legacy free-text `folder` string below.
   */
  folderId?: string | null
  /** Legacy AGL-124 free-text folder; read as fallback until migrated. */
  folder?: string
  tags?: string[]
  alt?: string
  description?: string
  /** Auto-captured at upload (AGL-173); best-effort for images only. */
  width?: number
  height?: number
  uploadedBy?: string
  /**
   * CDN delivery (AGL-175): content-hashed immutable path
   * (`/api/media/cdn/{hostId}/{mediaId}/{hash}`) served by both apps,
   * plus the WebP variant widths generated at upload.
   */
  cdnPath?: string
  contentHash?: string
  variants?: number[]
  createdAt?: ITimestamp
  deletedAt?: ITimestamp
}

/**
 * Media folder doc (AGL-171): `hosts/{hostId}/mediaFolders/{folderId}`.
 * Hierarchy/validation helpers live in `app-utils/media-folders`.
 */
export interface AglynHostMediaFolder {
  $id: string
  name: string
  /** Parent folder id; null = root. Depth capped at 5 (see app-utils). */
  parentId?: string | null
  order?: number
  createdAt?: ITimestamp
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

/** Host-scoped document */
export interface AglynScreen extends AglynDocument {
  $id: ScreenUid
  hostId?: HostUid
  parentId?: ScreenUid
  slug?: ScreenSlug
  /** Position among siblings (screens sharing `parentId`) in the screens list. */
  order?: number
  versionId?: VersionUid
  publishSchedule?: PublishSchedule
  /** Password protection (AGL-87): sha256 hex of the visitor password. */
  protection?: { passwordHash?: string }
  /** Language this screen is written in (AGL-164), e.g. 'en'. */
  locale?: string
  /** Translations of this screen: locale → screen id (AGL-164). */
  localeVariants?: Record<string, ScreenUid>
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
  visibility?: HostScreenVisibility

  // CONCEPT: Attribute editors
  owner?: UserUid
  contributors?: {
    [P in string & UserUid]: true
  }

  /** Shared layout this screen renders inside (see {@link AglynLayout}). */
  layoutId?: LayoutUid
}

/**
 * Host-scoped document.
 * `N` lets higher layers narrow the node schema (e.g. the aglyn SDK
 * instantiates it with its richer `NodeSchema`).
 */
export interface AglynScreenVersion<N = AglynNodeSchema>
  extends AglynDocument {
  $id: VersionUid
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
 * `composeReusableComponentNodes`). Host-scoped document at
 * `hosts/{hostId}/components/{componentId}`.
 */
export interface AglynHostComponent<N = AglynNodeSchema>
  extends AglynDocument {
  $id: ComponentDefUid
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
 * rendered around every bound screen. Host-scoped document at
 * `hosts/{hostId}/layouts/{layoutId}`.
 */
export interface AglynLayout extends AglynDocument {
  $id: LayoutUid
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

/** CONCEPT: Host redirects. Host-scoped document */
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
