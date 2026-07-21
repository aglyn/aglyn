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
 * Community marketplace v1 (AGL-44): shared types + the server-side
 * sanitization pass that gates publishing a host component definition as a
 * public listing. Pure data module — safe to import from API routes.
 */

/**
 * `profiles/{uid}` — a person's public identity.
 *
 * NOT a publisher identity as of AGL-652: publishing is org-only, and the
 * marketplace presence lives on `publisherProfiles/{orgId}` below. This doc
 * survives because it is also the support forum's author identity, which
 * renders poster names from `displayName`.
 */
export interface CommunityProfile {
  handle: string
  displayName: string
  bio?: string
  avatarUrl?: string
}

/**
 * `publisherProfiles/{orgId}` — an organization's marketplace presence
 * (AGL-652). Publishing is org-only: an org publishes, an org gets paid, and
 * the org is who buyers see. Keyed by org id so authorization is a plain org
 * role check with no ownership indirection.
 *
 * `stripeAccountId` / `stripeChargesEnabled` are written only by the Connect
 * route via the Admin SDK and are frozen from client writes by the rules —
 * they decide who receives money.
 */
export interface CommunityPublisherProfile {
  /** Unique marketplace handle; reserved in `publisherHandles/{handle}`. */
  handle: string
  displayName: string
  bio?: string
  avatarUrl?: string
  website?: string
  /** Server-only. */
  stripeAccountId?: string
  /** Server-only; true once Connect onboarding can accept charges. */
  stripeChargesEnabled?: boolean
}

/**
 * `publisherHandles/{handle}` — uniqueness reservation for publisher handles,
 * mirroring `orgSlugs` (AGL-652). Without it two publishers could claim the
 * same handle, which the marketplace URL space cannot represent. `movedTo`
 * tombstones a renamed handle so old links can still resolve.
 */
export interface PublisherHandleReservation {
  orgId: string
  movedTo?: string
}

/**
 * Publisher handles share the org-slug shape: 3–30 chars, lowercase
 * alphanumeric plus internal hyphens. Single source of truth — the two
 * community pages historically applied two subtly different regexes to the
 * same field (AGL-653).
 */
export const PUBLISHER_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

export function isValidPublisherHandle(handle: string): boolean {
  return PUBLISHER_HANDLE_PATTERN.test(handle)
}

/**
 * `communityListings/{listingId}` — public component listing. Version
 * snapshots live in the `versions/{n}` subcollection; installs copy a pinned
 * version into `hosts/{hostId}/components` so the existing drawer/graft
 * pipeline applies unchanged.
 */
export interface CommunityListing {
  profileId: string
  displayName: string
  description?: string
  category?: string
  /**
   * What this listing publishes (AGL-654). One discriminator for every
   * artifact type — the previous scheme split across two orthogonal fields
   * (`type: 'component'|'plugin'` plus a separate `kind: 'template'`), so a
   * template was "kind template with no type" and each installer branched on
   * whichever field it happened to care about. That does not survive adding
   * layouts, dataset schemas and email templates.
   *
   * Read it through `listingArtifactType()`, never directly — listings
   * written before this field still carry only the legacy pair.
   */
  artifactType?: CommunityArtifactType
  /** @deprecated Legacy discriminator; use `artifactType` (AGL-654). */
  type?: 'component' | 'plugin'
  /** @deprecated Legacy discriminator; use `artifactType` (AGL-654). */
  kind?: 'template'
  latestVersion: number | string
  /** Plugin manifest id, for `type: 'plugin'` listings (AGL-45). */
  pluginId?: string
  /** One-time price in whole USD; 0/absent = free (AGL-46). */
  priceUsd?: number
  deletedAt?: unknown
  // Listing content (AGL-430, Strapi Market parity) — publisher-authored,
  // rendered on the marketplace detail page. All optional; validated by
  // validateListingContent on the API path and SANITIZED at render time
  // (the doc is publisher-writable, so renderers never trust it).
  logoUrl?: string
  screenshots?: string[]
  /** Markdown documentation shown on the listing page (no raw HTML). */
  readme?: string
  homepageUrl?: string
  repositoryUrl?: string
  /** SPDX-ish license label, e.g. "MIT". */
  license?: string
  categories?: string[]
  /**
   * Marketplace review lifecycle (AGL-432). Absent = legacy listing,
   * treated as 'listed'. New plugin listings start 'submitted'; staff move
   * them through the queue. Only 'listed'/'verified' (or legacy) plugin
   * listings appear in browse for non-owners.
   */
  reviewStatus?: ListingReviewStatus
  // Server-managed. These were written by the publish/install/review paths
  // but never declared, so callers reached for `as any` (AGL-654).
  /** Publishing org id — the publisher profile's doc id (AGL-652). */
  publisherOrgId?: string
  /** Source component for a `component` listing. */
  sourceComponentId?: string
  /** Source site for a `template` listing. */
  sourceHostId?: string
  /** Incremented by the install API; frozen from client writes. */
  installCount?: number
  previewImageUrl?: string
  screenCount?: number
  versionHistory?: Array<{ version: number | string; publishedAt?: unknown }>
  createdAt?: unknown
  updatedAt?: unknown
  /** Staff review audit (AGL-432); server-owned (AGL-651). */
  reviewedBy?: string
  reviewedAt?: unknown
  rejectionReason?: string
}

/** Everything an org can publish to the marketplace (AGL-654). */
export type CommunityArtifactType =
  | 'component'
  | 'template'
  | 'plugin'
  | 'layout'
  | 'datasetSchema'
  | 'emailTemplate'

/**
 * The listing's artifact type, tolerating the pre-AGL-654 shape.
 *
 * Legacy listings carry `type`/`kind` instead; a component was the absence
 * of both, which is why this defaults there rather than throwing. Keeping
 * the fallback means old docs keep resolving correctly instead of silently
 * becoming un-installable.
 */
export function listingArtifactType(listing: {
  artifactType?: string
  type?: string
  kind?: string
}): CommunityArtifactType {
  if (listing.artifactType) return listing.artifactType as CommunityArtifactType
  if (listing.kind === 'template') return 'template'
  if (listing.type === 'plugin') return 'plugin'
  return 'component'
}

export type ListingReviewStatus =
  | 'submitted'
  | 'in_review'
  | 'listed'
  | 'verified'
  | 'rejected'

/** Whether a plugin listing is publicly browsable (AGL-432). */
export function isListingBrowsable(listing: {
  artifactType?: string
  type?: string
  kind?: string
  reviewStatus?: string
}): boolean {
  if (listingArtifactType(listing) !== 'plugin') return true
  return (
    listing.reviewStatus === undefined ||
    listing.reviewStatus === 'listed' ||
    listing.reviewStatus === 'verified'
  )
}

/** Fixed category taxonomy for marketplace listings (AGL-430). */
export const LISTING_CATEGORIES: readonly string[] = [
  'analytics',
  'automation',
  'commerce',
  'communication',
  'content',
  'design',
  'forms',
  'integrations',
  'marketing',
  'productivity',
  'seo',
  'security',
] as const

export const LISTING_README_MAX_CHARS = 20_000
export const LISTING_MAX_SCREENSHOTS = 6

const HTTPS_URL = /^https:\/\/[^\s]+$/

/**
 * Validates publisher-editable listing content (AGL-430). Returns the
 * normalized subset to persist, or an error. Shared by publish and the
 * update-listing action so both paths accept exactly the same shapes.
 */
export function validateListingContent(input: Record<string, unknown>): {
  ok: boolean
  error?: string
  content?: Partial<CommunityListing>
} {
  const content: Partial<CommunityListing> = {}
  for (const key of ['logoUrl', 'homepageUrl', 'repositoryUrl'] as const) {
    const value = input[key]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || !HTTPS_URL.test(value) || value.length > 500) {
      return { ok: false, error: `${key} must be an https URL` }
    }
    content[key] = value
  }
  const screenshots = input['screenshots']
  if (screenshots !== undefined) {
    if (
      !Array.isArray(screenshots) ||
      screenshots.length > LISTING_MAX_SCREENSHOTS ||
      screenshots.some(
        (url) =>
          typeof url !== 'string' || !HTTPS_URL.test(url) || url.length > 500,
      )
    ) {
      return {
        ok: false,
        error: `screenshots must be up to ${LISTING_MAX_SCREENSHOTS} https URLs`,
      }
    }
    content.screenshots = screenshots as string[]
  }
  const readme = input['readme']
  if (readme !== undefined) {
    if (typeof readme !== 'string' || readme.length > LISTING_README_MAX_CHARS) {
      return {
        ok: false,
        error: `readme must be markdown up to ${LISTING_README_MAX_CHARS} chars`,
      }
    }
    if (readme.trim()) content.readme = readme
  }
  const license = input['license']
  if (license !== undefined && license !== '') {
    if (typeof license !== 'string' || license.length > 40) {
      return { ok: false, error: 'license must be a short label (max 40)' }
    }
    content.license = license
  }
  const categories = input['categories']
  if (categories !== undefined) {
    if (
      !Array.isArray(categories) ||
      categories.length > 3 ||
      categories.some((entry) => !LISTING_CATEGORIES.includes(String(entry)))
    ) {
      return {
        ok: false,
        error: 'categories must be up to 3 entries from the fixed taxonomy',
      }
    }
    content.categories = categories.map(String)
  }
  return { ok: true, content }
}

/** Platform revenue share on paid listings (AGL-46). */
export const COMMUNITY_PLATFORM_FEE_PERCENT = 20
/** Free-plan publishers pay a higher share. */
export const COMMUNITY_PLATFORM_FEE_PERCENT_FREE_PLAN = 30
/** One-time listing price ceiling (whole USD). */
export const COMMUNITY_MAX_PRICE_USD = 1000

/**
 * Component ids publishable to the community. Mirrors the persisted ids in
 * plugins-mui (plugin.spec.ts) minus `reusableInstance` — nested
 * instances would smuggle references to another tenant's private
 * definitions — and minus `layoutSlot`, which is layout chrome. Keep sorted.
 */
export const COMMUNITY_COMPONENT_ID_ALLOWLIST: readonly string[] = [
  'form',
  'formField',
  'image',
  'muiAppBar',
  'muiButton',
  'muiContainer',
  'muiList',
  'muiListItem',
  'muiListItemText',
  'muiScreenLink',
  'muiStack',
  'muiToolbar',
  'muiTypography',
  'searchBox',
  'socialLinks',
  'videoEmbed',
]

/** Serialized definition size cap (Firestore doc limit is 1 MiB). */
export const COMMUNITY_DEFINITION_MAX_BYTES = 200 * 1024

const KEPT_NODE_KEYS = [
  '$id',
  'componentId',
  'pluginId',
  'parentId',
  'props',
  'nodes',
] as const

export type CommunityDefinitionNodes = Record<
  string,
  {
    $id: string
    componentId: string
    pluginId?: string
    parentId: string | null
    props?: Record<string, unknown>
    nodes?: string[]
  }
>

/**
 * Validates and strips a host component definition for publishing:
 * - only allowlisted component ids (no reusable instances, no layout chrome)
 * - only the persisted node keys (drops runtime fields like resolvedProps)
 * - the subtree reachable from `rootId` only, and a serialized size cap
 *
 * XSS note: rich-text `html` and link `href` props stay as-authored here —
 * both are sanitized at render time (sanitize-rich-text allowlist,
 * SAFE_HREF), which also covers definitions written to Firestore directly
 * (see docs/SECURITY_CONTENT_REVIEW.md).
 */
export function sanitizeCommunityDefinition(
  definition: {
    rootId: string
    nodes: Record<string, any>
  },
  options?: {
    /**
     * Additional component ids permitted for this artifact type.
     *
     * `layoutSlot` is excluded from the shared allowlist because a slot in
     * page content has nowhere to graft — but a published LAYOUT is
     * meaningless without one (AGL-671). Scoped per call rather than added
     * globally so page and component publishing stay unchanged.
     */
    extraComponentIds?: readonly string[]
  },
):
  | { ok: true; rootId: string; nodes: CommunityDefinitionNodes }
  | { ok: false; error: string } {
  const { rootId, nodes } = definition
  const allowed = options?.extraComponentIds?.length
    ? [...COMMUNITY_COMPONENT_ID_ALLOWLIST, ...options.extraComponentIds]
    : COMMUNITY_COMPONENT_ID_ALLOWLIST
  if (!rootId || !nodes?.[rootId]) {
    return { ok: false, error: 'Definition has no root node' }
  }
  const sanitized: CommunityDefinitionNodes = {}
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift() as string
    if (sanitized[id]) continue
    const node = nodes[id]
    if (!node) return { ok: false, error: `Missing node "${id}"` }
    if (!allowed.includes(node.componentId)) {
      return {
        ok: false,
        error: `Component "${node.componentId}" cannot be published`,
      }
    }
    const plain: any = {}
    for (const key of KEPT_NODE_KEYS) {
      if (node[key] !== undefined) plain[key] = node[key]
    }
    plain.$id = id
    plain.parentId = id === rootId ? null : (node.parentId ?? null)
    sanitized[id] = plain
    if (Array.isArray(node.nodes)) queue.push(...node.nodes)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(sanitized)
  } catch {
    return { ok: false, error: 'Definition is not serializable' }
  }
  if (serialized.length > COMMUNITY_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Definition is too large to publish' }
  }
  return { ok: true, rootId, nodes: sanitized }
}

/**
 * Converts a sanitized community/AI definition (normalized map) into the
 * nested node shape `canvas.addNodeFromPreset` grafts — ids regenerate on
 * insert, so collisions with existing canvas nodes are impossible
 * (AGL-169). A seen-set guards malformed self-referencing trees.
 */
export function communityDefinitionToNested(
  rootId: string,
  nodes: CommunityDefinitionNodes,
): Record<string, unknown> | null {
  const seen = new Set<string>()
  const build = (id: string): Record<string, unknown> | null => {
    const node = nodes[id]
    if (!node || seen.has(id)) return null
    seen.add(id)
    return {
      componentId: node.componentId,
      ...(node.pluginId ? { pluginId: node.pluginId } : {}),
      ...(node.props ? { props: node.props } : {}),
      nodes: (node.nodes ?? [])
        .map(build)
        .filter((child): child is Record<string, unknown> => Boolean(child)),
    }
  }
  return build(rootId)
}
