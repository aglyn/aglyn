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

/** `profiles/{tenantId}` — one public publisher profile per tenant. */
export interface CommunityProfile {
  handle: string
  displayName: string
  bio?: string
  avatarUrl?: string
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
  latestVersion: number
  /** One-time price in whole USD; 0/absent = free (AGL-46). */
  priceUsd?: number
  deletedAt?: unknown
}

/** Platform revenue share on paid listings (AGL-46). */
export const COMMUNITY_PLATFORM_FEE_PERCENT = 20
/** Free-plan publishers pay a higher share. */
export const COMMUNITY_PLATFORM_FEE_PERCENT_FREE_PLAN = 30
/** One-time listing price ceiling (whole USD). */
export const COMMUNITY_MAX_PRICE_USD = 1000

/**
 * Platform fee on tenant-site product sales (Commerce Starter, AGL-90) —
 * the tenant sells to their own visitors through their connected account,
 * so the platform takes a processing/management share only.
 */
export const COMMERCE_PLATFORM_FEE_PERCENT = 2
/** Product price ceiling (whole USD). */
export const COMMERCE_MAX_PRICE_USD = 10000

/**
 * Component ids publishable to the community. Mirrors the persisted ids in
 * plugins-ui-mui (legacy-plugin.spec.ts) minus `reusableInstance` — nested
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
export function sanitizeCommunityDefinition(definition: {
  rootId: string
  nodes: Record<string, any>
}):
  | { ok: true; rootId: string; nodes: CommunityDefinitionNodes }
  | { ok: false; error: string } {
  const { rootId, nodes } = definition
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
    if (!COMMUNITY_COMPONENT_ID_ALLOWLIST.includes(node.componentId)) {
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
