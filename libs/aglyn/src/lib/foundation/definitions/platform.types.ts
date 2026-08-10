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
    /**
     * Site-wide default social card image (AGL-1337) — used by every page
     * that sets none of its own. A `media:` reference (what the picker
     * writes) or a raw URL; resolved and made absolute by
     * `resolveSocialImage`, never emitted as stored.
     *
     * `''` is a CLEARED field, written directly to Firestore by the picker
     * card rather than through the attributes form stack, which maps `''` to
     * `undefined` and would leave a default nobody could remove (AGL-1191).
     */
    image?: string
    /** Copied from the media record at pick time; see `resolveSocialImage`. */
    imageWidth?: number
    imageHeight?: number
    /**
     * Site-wide "discourage search engines" (AGL-1263): `robots.txt` refuses
     * everything, the sitemap goes empty, and every page carries `noindex`.
     * The staged-launch control — a site that is live but not ready to be
     * found, which until now could only be approximated by setting each
     * screen to {@link HostScreenVisibility.UNLISTED} one at a time.
     *
     * Absent means INDEX, and must keep meaning that. Reading a missing field
     * as "hide" would let a schema slip de-index every customer at once.
     */
    discourageSearchEngines?: boolean
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
  /**
   * Per-site plugin deny-list (AGL-1014): plugin ids the org has enabled
   * but this site switches OFF. Subtracted from the org's resolved set by
   * `resolveHostEnabledPlugins` — the host can only ever narrow, never
   * widen, and an absent field means every org-enabled plugin runs here.
   * Writable by site ADMINS only (rules); always-on ids are ignored.
   */
  disabledPlugins?: string[]
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

/**
 * Host-document fields an editor may legitimately write, each with the reason
 * (AGL-1361). Everything else must be denied in the rules' host key diff.
 *
 * `host-write-deny-coverage.spec.ts` fails the build for any field of this
 * document that is in neither list, so "I forgot" is not a reachable state —
 * the answer that costs nothing is always to deny. The reason strings are the
 * point: they record that somebody decided, rather than that somebody did not
 * notice. AGL-1364 is what this catches, found while writing it.
 *
 * The bar for landing here: could a client rewrite change what the platform
 * DECIDES — an entitlement, a price, where a request routes, who may read? If
 * so it belongs in the rules, whatever the console does today.
 */
export const HOST_CLIENT_WRITABLE_FIELDS: Readonly<Record<string, string>> = {
  displayName:
    'The site name shown in the console. Cosmetic, org-scoped, and decides ' +
    'nothing — the public address is `subdomain`/`cname`, both denied.',
  logoUrl:
    'The site brand mark rendered by the tenant nav (AGL-594). Authored ' +
    'content pointing at already-public media; no gate reads it.',
  seo:
    'Title, description, favicon, social card and the AGL-1263 ' +
    '`discourageSearchEngines` switch. All of it is authoring: the values ' +
    'end up in the page the editor is already free to write.',
  screens:
    'The screen-id → slug directory. The screen DOCS are quota-governed and ' +
    'API-create-only (AGL-473); this map is the routing index maintained ' +
    'alongside them, and an editor who may add a screen may name it.',
  layouts: 'The shared-layout directory. Same reasoning as `screens`.',
  redirects:
    'The redirect directory. The redirect DOCS are API-create-only so the ' +
    '`redirectsPerHost` quota has somewhere to be enforced; this is the index.',
  notFoundScreenId:
    'Which screen renders unmatched paths (AGL-87). Points at a screen the ' +
    'editor already owns, and serves their own visitors only.',
  errorScreens:
    'Designable error screens by status (AGL-131). Same reasoning as ' +
    '`notFoundScreenId` — a binding to screens this editor already controls.',
  maintenance:
    'Maintenance mode (AGL-131): every path renders the 503 screen. A ' +
    'site-wide availability switch, but it only ever takes the editor\'s OWN ' +
    'site down, which they can equally do by deleting its screens.',
  locales:
    'Site languages (AGL-164). The `multilingual` entitlement is re-checked ' +
    'server-side at page load, so writing this buys nothing a plan forbids.',
  defaultLocale: 'Which of `locales` serves an unprefixed path. Authoring.',
  theme:
    'The persisted MUI theme for the published site. Authoring — the theme ' +
    'editor writes it directly, and it renders only on this host.',
  themeOverride:
    'The editor\'s local diff on top of an installed marketplace theme, ' +
    'written wholesale by the setup page. Authoring. Its PROVENANCE ' +
    '(`themeInstalledFrom`) is denied instead, which is the half that has to ' +
    'be true for `isOverrideForCurrentTheme` to mean anything.',
  announcementBar:
    'Site-wide announcement bar (AGL-195). `marketingOverlays`-gated, but ' +
    'the gate is enforced where it counts — `site-page-enricher` re-checks ' +
    'the entitlement at RENDER, so a free plan writing this bar never ships ' +
    'it. The console gate is the affordance, not the boundary.',
  popup: 'Promotional popup (AGL-196). Identical reasoning to `announcementBar`.',
  business:
    'Support email, address and social links behind the AGL-1022 host ' +
    'tokens. Publisher-authored contact detail that renders into their own ' +
    'pages and emails; undeclared on this interface, so the guard sees it ' +
    'through the resolver sweep rather than the type.',
  createdAt:
    'Stamped by /api/hosts/create. Nothing gates on it — the org owns ' +
    'billing dates — and console saves touch it freely.',
  updatedAt:
    'Bumped by console saves to drive "last edited" copy. Decides nothing; ' +
    'a forged value misleads the editor about their own site.',
}

/**
 * Host-document keys that never reach Firestore, so the rules have no opinion.
 */
export const HOST_UNPERSISTED_FIELDS: Readonly<Record<string, string>> = {
  $id: 'The document id, attached on read by the Firestore hooks. Never a field.',
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
 * Who may see an org-owned resource (AGL-1037): `'org'` is every site in
 * the org, `host:{hostId}` names one. Lives here rather than beside its
 * helpers in `app-utils/scope-tokens` because foundation cannot import
 * app-utils; that module re-exports this type along with the helpers.
 */
export type ScopeToken = 'org' | `host:${string}`

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
   * CDN delivery (AGL-175 / AGL-829): the stable, mediaId-keyed path
   * (`/api/media/cdn/{scope}/{mediaId}`) served by both apps — location- and
   * replace-independent (references never break; the route revalidates via
   * the `contentHash` ETag). The same route also serves an immutable
   * `…/{mediaId}/{hash}` form. `variants` are the WebP widths from upload.
   */
  cdnPath?: string
  contentHash?: string
  variants?: number[]
  /**
   * User-defined key/value metadata (AGL-822), mirrored onto the Storage
   * object's `customMetadata` by `/api/media/folders` (action
   * `custom-metadata`); this doc copy is the source of truth for display.
   */
  customMetadata?: Record<string, string>
  /**
   * Which sites may see this asset (AGL-1037); absent = org-wide until the
   * AGL-1040 backfill stamps it. Only meaningful on the org-scoped library
   * (`orgs/{orgId}/media`) — a host's own library is private already.
   */
  visibleTo?: ScopeToken[]
  /**
   * Not fetchable without a signature (AGL-1051). **Orthogonal to
   * `visibleTo`**, and the distinction is the whole point:
   *
   * - `visibleTo` answers *which sites may USE this asset* — a discovery
   *   and authoring control. An asset restricted to one site is still
   *   served to anyone who has its URL, because that site's pages are
   *   public and the CDN that serves them is unauthenticated.
   * - `private` answers *may the public FETCH these bytes at all*.
   *
   * A private asset carries no {@link cdnPath}, is refused by the pickers
   * that place media into page content, and is reachable only through a
   * short-lived signed URL minted for an authorized caller. Use it for
   * things that are not web assets — a signed contract, unreleased
   * artwork, an embargoed release — never for "this image is only on one
   * site", which is what `visibleTo` is for.
   */
  private?: boolean
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
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
  /**
   * Which sites may see this folder (AGL-1037). Assets carry their own
   * scope — a folder's is applied to them by an explicit write-time
   * cascade (AGL-1042), never inherited at read time.
   */
  visibleTo?: ScopeToken[]
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
  /**
   * `skipped-unentitled` is a terminal refusal (AGL-1185): the schedule came
   * due on a plan without `scheduledPublishing`, so the executor declined it
   * and will not reconsider.
   *
   * It exists because leaving it `pending` meant the refusal was not recorded
   * anywhere — the schedule stayed due forever, and the moment the org upgraded
   * to Business the next beat published it. Content someone scheduled and
   * forgot, months later, surfacing during an upgrade. Recording the refusal is
   * what makes it stop being due.
   *
   * Every reader tests `=== 'pending'`, so adding a member here degrades
   * correctly rather than needing each one updated — checked, not assumed.
   */
  status: 'pending' | 'applied' | 'canceled' | 'skipped-unentitled'
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
  /**
   * When the screen's route was last published (AGL: date-published). Stamped
   * by `publishScreenRoute` and cleared on unpublish, so it is present only
   * while the screen is reachable — distinct from `createdAt`.
   */
  publishedAt?: ITimestamp
  deletedAt?: ITimestamp
  displayName?: string
  /**
   * Normalized `displayName` for case-insensitive prefix search (AGL-835);
   * see `nameSearchKey`. Stamped by the screen create/import write paths so
   * the besigner switcher can query screens by name instead of loading the
   * whole collection.
   */
  nameLower?: string
  description?: string
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    /**
     * This screen's social card image (AGL-1337), overriding the host
     * default. Same storage contract as {@link AglynHost.seo.image}: a
     * `media:` reference or URL, `''` meaning cleared — which is how a screen
     * goes back to inheriting the site default.
     */
    image?: string
    /** Copied from the media record at pick time; see `resolveSocialImage`. */
    imageWidth?: number
    imageHeight?: number
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

  // NOTE (AGL-676): `owner` and `contributors` were declared here and NEVER
  // read or written by anything — zero call sites across the whole repo.
  // Removed rather than left dangling: a declared-but-unmaintained field is
  // how the next person builds on something that was never real. Editor
  // attribution lives in `hosts/{hostId}/activity`, which is actually
  // written. If a contributor set is wanted later, add one that is kept up
  // to date.

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
 * Value kind of a declared component prop (AGL-1247), which decides only
 * how the Attributes panel edits it — every kind substitutes as text, so
 * the graft stays a string replacement over the definition's props.
 */
export type ReusableComponentPropType =
  | 'text'
  | 'richText'
  | 'image'
  | 'href'
  | 'number'
  | 'boolean'

/**
 * A prop a reusable component declares (AGL-1247), so one definition can
 * render different content per instance instead of being copied per page.
 *
 * Inside the definition the author binds a node prop to it with the
 * existing token syntax — `{{prop.headline}}`, the same mechanism behind
 * `{{entry.*}}` and `{{host.*}}` — and `composeReusableComponentNodes`
 * substitutes each instance's own values as it grafts.
 */
export interface ReusableComponentProp {
  /**
   * Token name: `{{prop.<name>}}`. This is the STABLE key instances store
   * their overrides under, so renaming one orphans every existing value —
   * the editor must rename in place rather than remove-and-add.
   */
  name: string
  type?: ReusableComponentPropType
  /** Field label in the Attributes panel; falls back to `name`. */
  label?: string
  /**
   * Rendered wherever an instance leaves this prop unset, and shown as the
   * Attributes field's placeholder. One field serving both is deliberate:
   * a component that renders its own sensible copy until overridden is the
   * "shows the placeholder from the component" behaviour, and it means an
   * unset prop can never collapse a section to empty on a live page.
   */
  defaultValue?: string
}

/**
 * A reusable component's chosen icon (AGL-1193), stood in for by the generic
 * package glyph when unset.
 *
 * Both halves are stored, for the reason AGL-1212 exists: the MDI catalog is
 * ~2.9 MB and only picker surfaces load it, so anything that had to resolve
 * `iconId` on a render surface got `DEFAULT_ICON` — a real path, so every
 * icon painted a confident "help" glyph. The id stays the source of truth;
 * `iconPath` is the denormalized copy that travels with the document.
 */
export interface ReusableComponentIcon {
  iconId?: string
  iconPath?: string
}

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
  /**
   * Icon shown wherever an instance of this component is represented in the
   * besigner (AGL-1193) — the hierarchy row, the canvas badge, the element
   * drawer. Absent on every component that predates the picker, which is
   * why it is optional and never defaulted: unset means "the package glyph",
   * not "an icon we failed to read".
   */
  icon?: ReusableComponentIcon
  /**
   * Definition tree root id within {@link AglynHostComponent.nodes}.
   *
   * `rootId` and `nodes` on THIS doc are the published snapshot — the copy
   * the tenant runtime renders. `getComponents` reads every component in a
   * single collection query on each page render, so they deliberately stay
   * here rather than moving into the version docs below: relocating them
   * would turn one query into N+1 on the hot path of every published site
   * (AGL-679).
   */
  rootId?: NodeId
  nodes?: Record<NodeId, N>
  /**
   * Declared props (AGL-1247), published alongside `rootId`/`nodes` and for
   * the same reason: the tenant reads this doc, so a definition whose props
   * stayed on the version doc would graft with every `{{prop.*}}` token
   * unresolved on the live site.
   */
  props?: ReusableComponentProp[]
  /**
   * Working version pointer (AGL-679). Absent on components that predate
   * the standalone editor — those still render from the fields above, and
   * opening one creates version 1 from them.
   */
  versionId?: VersionUid
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
}

/**
 * A reusable component's editing history (AGL-679), at
 * `hosts/{hostId}/components/{componentId}/versions/{versionId}`.
 *
 * Same shape as a screen version, with the component's `rootId` carried so
 * publishing is a copy of both fields onto the parent rather than a
 * reconstruction. Edits here are invisible to live sites until published —
 * the same mental model screens already have.
 */
export interface AglynHostComponentVersion<N = AglynNodeSchema>
  extends AglynDocument {
  $id: VersionUid
  hostId?: HostUid
  componentId?: ComponentDefUid
  displayName?: string
  rootId?: NodeId
  nodes?: Record<NodeId, N>
  /** Declared props being edited; published onto the parent (AGL-1247). */
  props?: ReusableComponentProp[]
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
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
  /**
   * Layout this layout renders inside (AGL-703) — the same relationship
   * `AglynScreen.layoutId` expresses, one level up, so shared chrome can
   * sit outside a more specific frame. Must not be this layout, or any
   * layout already below it; see `canNestLayout`.
   */
  layoutId?: LayoutUid
  // `contributors` removed here too — see the note on AglynScreen (AGL-676).
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

export type TemplateUid = string

/** What a template can be instantiated as. */
export type TemplateKind = 'page' | 'component' | 'layout'

/**
 * A named substitution offered when the template is instantiated. Values are
 * applied with `resolveNamedTokens` — the same `{{name}}` mechanism that
 * renders collection entry templates — so a template author marks copy as
 * `{{productName}}` and is prompted for it on use.
 */
export interface TemplatePlaceholder {
  /** Token name as it appears in the nodes, without the braces. */
  name: string
  /** Prompt label shown when instantiating. */
  label?: string
  defaultValue?: string
}

/**
 * Where a template came from.
 *
 * SERVER-MANAGED. A client that could write this would be able to stamp
 * `marketplace` provenance on something it authored, and the library shows
 * this to the user as a trust signal.
 */
export interface TemplateSource {
  type: 'authored' | 'marketplace' | 'starter'
  /** Marketplace listing this was installed from. */
  listingId?: string
  /** Listing version installed — compared against `latestVersion` to
   *  surface "update available" without storing anything extra. */
  version?: number | string
  /** First-party starter id from `starter-templates.ts`. */
  starterId?: string
  /**
   * Bundle-level identity for a seeded starter (AGL-687). A multi-page
   * starter seeds one page template per screen, exactly as a marketplace
   * install does; these carry the name/description/order of the bundle the
   * screens belong to so the gallery can present them as the single starter
   * they were authored as, without a second, code-side template source.
   */
  starterName?: string
  starterDescription?: string
  /** Position within the starter; fixes the order pages are created in. */
  starterOrder?: number
}

/**
 * Reusable starting point for a page, component or layout (AGL-666).
 * Host-scoped document at `hosts/{hostId}/templates/{templateId}`.
 *
 * Distinct from the things it produces: a template is inert until
 * instantiated, so marketplace downloads land here rather than becoming live
 * pages. `nodes` carries the same node-map shape screens, components and
 * layouts already use, which is what lets one collection serve all three
 * kinds.
 */
export interface AglynTemplate<N = AglynNodeSchema> extends AglynDocument {
  $id: TemplateUid
  hostId?: HostUid
  kind?: TemplateKind
  displayName?: string
  description?: string
  category?: string
  nodes?: Record<NodeId, N>
  /** Definition tree root — `component` kind, mirroring AglynHostComponent. */
  rootId?: NodeId
  /** Suggested slug — `page` kind; de-conflicted against the host on use. */
  slug?: string
  /** Mirrors AglynScreen.seo — carried through to the created page. */
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    image?: string
    imageWidth?: number
    imageHeight?: number
  }
  placeholders?: Array<TemplatePlaceholder>
  /**
   * Theme the template was designed against, carried over from a site
   * template's snapshot. Held rather than applied: applying a theme changes
   * the whole site's appearance, which is exactly the kind of instant,
   * site-wide change installing is not allowed to make (AGL-669).
   */
  theme?: Record<string, unknown>
  source?: TemplateSource
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
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
