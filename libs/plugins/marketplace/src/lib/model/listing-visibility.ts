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
 * Who is allowed to see a marketplace listing (AGL-432/658/968/1196).
 *
 * One reading of "is this listing public", on purpose. The rule gates browse
 * AND install (AGL-965 added the second call site after the first proved
 * insufficient on its own), and the listing's social card (AGL-876) is
 * emitted to an UNAUTHENTICATED fetcher, so it applies the same rule the
 * browse grid applies — or a rejected, private or taken-down listing gets its
 * name and description unfurled into a chat message by anyone holding the
 * URL. A third reading that drifts would be a disclosure bug, not a cosmetic
 * one.
 *
 * These lived in core while a console route had to ask the question and a
 * `scope:app` project may not depend on an `aglyn:addons` lib. The listing
 * route and its card are the plugin's own now (AGL-3080), so the policy is
 * too. `model/marketplace.ts` re-exports all four, so publishing and install
 * code keeps importing them from one place.
 */

import type { InstallableArtifactType as MarketplaceArtifactType } from '@aglyn/aglyn/app-utils/artifact-provenance'

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
}): MarketplaceArtifactType {
  if (listing.artifactType) return listing.artifactType as MarketplaceArtifactType
  if (listing.kind === 'template') return 'template'
  if (listing.type === 'plugin') return 'plugin'
  return 'component'
}

/**
 * Private plugins (AGL-968): an org builds for its own sites without
 * publishing to anyone. Never browsable — not even for the owner, who
 * reaches it through their own plugins area — and installable only by the
 * owning org (enforced in `install-plugin`, not in the UI). The review bar
 * is identical: private code still runs on our infrastructure.
 */
export function isPrivateListing(listing: { visibility?: string }): boolean {
  return listing.visibility === 'private'
}

/**
 * Whether a listing has been soft-deleted (AGL-1196).
 *
 * Browse used to express this as `where('deletedAt','==',null)` in the query
 * itself. That put a MUTABLE field in a predicate: `deletedAt` flips on every
 * unpublish/republish, and a document that stops matching a live query can
 * leave a `noDocument` tombstone at its own path — which the detail page then
 * reads BY ID and 404s on (AGL-827, AGL-929). Filtering in memory removes the
 * mechanism instead of healing it.
 *
 * FALSY, not `=== null`. Firestore's `== null` matches only an explicit null
 * and cannot express "field is absent", so a listing written without the field
 * was invisible to the old query. Absent means live.
 *
 * Deliberately NOT folded into `isListingBrowsable`: that check carries an
 * owner exemption, so a publisher can watch their own submission move through
 * review. Deletion has no such exemption — a deleted listing is gone for
 * everyone, including the org that owns it.
 */
export function isListingDeleted(listing: { deletedAt?: unknown }): boolean {
  return Boolean(listing.deletedAt)
}

/**
 * The artifact types that wait for review before they are browsable: plugins,
 * which execute code (AGL-432), and site starters, which create a whole site
 * the moment they are picked, with no step between to catch what a publisher
 * got wrong (AGL-4049).
 */
const REVIEWED_ARTIFACT_TYPES: ReadonlySet<MarketplaceArtifactType> = new Set(['plugin', 'siteStarter'])

/** Whether a plugin listing is publicly browsable (AGL-432). */
export function isListingBrowsable(listing: {
  artifactType?: string
  type?: string
  kind?: string
  reviewStatus?: string
  hiddenAt?: unknown
  visibility?: string
  workspaceLockedAt?: unknown
}): boolean {
  // Staff takedown applies to EVERY artifact type (AGL-658). Pre-publication
  // review is for plugins and site starters only (REVIEWED_ARTIFACT_TYPES),
  // which earn the wait — but a component or template that turns out to be
  // abusive must be removable too, and before this it simply was not: the
  // early return below meant anything non-plugin was permanently browsable.
  if (listing.hiddenAt) return false
  // The publishing workspace is locked (AGL-3365), for any reason: its
  // listings leave browse, search and their pages until the lift. Its own
  // field rather than `hiddenAt`, which is staff's takedown and also stops
  // already-installed plugins from loading — a lock over an unpaid bill must
  // not break a buyer's site, and the lift must not undo a takedown.
  if (listing.workspaceLockedAt) return false
  // Private listings never reach the marketplace (AGL-968).
  if (isPrivateListing(listing)) return false
  if (!REVIEWED_ARTIFACT_TYPES.has(listingArtifactType(listing))) return true
  return (
    listing.reviewStatus === undefined ||
    listing.reviewStatus === 'listed' ||
    listing.reviewStatus === 'verified'
  )
}

/**
 * Listing fields a publisher may legitimately write from the client, each
 * with the reason (AGL-1361). Everything else must be denied in the rules'
 * listing key diff.
 *
 * They live here rather than beside `MarketplaceListing` for the same reason
 * the visibility policy does: this module is what READS the fields that decide
 * whether a listing is browsable, and `scope:app` may not depend on
 * `aglyn:addons`. `marketplace.ts` re-exports them so publishing code keeps
 * one import site.
 *
 * EMPTY since AGL-4105. Every publisher save agrees to the Marketplace
 * Publisher Agreement, and only a route can refuse a save that did not and
 * record one that did, so nothing is left for a client to write directly.
 * The last three:
 *
 * - `category` and `categories`, shelf placement, written through
 *   `update-listing` like the rest of the listing (the editor always did);
 * - `pluginId`, the manifest id a plugin listing declares (AGL-45), which
 *   only the publish route ever sets.
 *
 * Nothing in the repo wrote any of them client-side, so denying them cost
 * nothing — which is how AGL-1364 closed too. `displayName`, the copy a buyer
 * reads, and the listing artwork left this list earlier (AGL-3321, AGL-3365,
 * AGL-1701) for their own reasons.
 */
export const LISTING_CLIENT_WRITABLE_FIELDS: Readonly<Record<string, string>> =
  {}

/**
 * Listing keys that never reach Firestore, so the rules have no opinion.
 *
 * Empty today — `MarketplaceListing` declares no `$id`, because listing code
 * carries the id alongside the data rather than folding it in. Kept as the
 * partition's third arm so a future projection field has a home that is not
 * "client-writable".
 */
export const LISTING_UNPERSISTED_FIELDS: Readonly<Record<string, string>> = {}
