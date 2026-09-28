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
 * The fields a marketplace listing's lists query by, for plain Node scripts
 * (AGL-3321).
 *
 * `listingQueryFields` in
 * `libs/plugins/marketplace/src/lib/model/listing-query.ts` derives them for
 * every server writer; the seeds and the backfill cannot import it, so this
 * restates it — and the three visibility predicates it reads, from
 * `libs/aglyn/src/lib/app-utils/marketplace-listing-visibility.ts`. The name
 * keys are NOT restated here: they come from `name-search-tokens.mjs`, the
 * one script-side copy of those.
 *
 * Both sides are held to `listing-query-fields.fixtures.json`:
 * the library's `listing-query.spec.ts` asserts it against the TypeScript,
 * and `backfill-marketplace-listing-search.mjs --self-test` against this.
 */
import { displayNameSearchFields, scopedSearchTokens } from './name-search-tokens.mjs'

/** `BROWSE_EVERYONE`. */
export const BROWSE_EVERYONE = '*'
/** `BROWSE_PUBLISHER_JOIN`. */
export const BROWSE_PUBLISHER_JOIN = '|'

/** `listingArtifactType`: the discriminator, tolerating the pre-AGL-654 shape. */
function listingArtifactType(listing) {
  if (listing.artifactType) return listing.artifactType
  if (listing.kind === 'template') return 'template'
  if (listing.type === 'plugin') return 'plugin'
  return 'component'
}

/** `isListingBrowsable`: not taken down, not private, and reviewed if a plugin. */
function isListingBrowsable(listing) {
  if (listing.hiddenAt) return false
  if (listing.workspaceLockedAt) return false
  if (listing.visibility === 'private') return false
  if (listingArtifactType(listing) !== 'plugin') return true
  return (
    listing.reviewStatus === undefined ||
    listing.reviewStatus === 'listed' ||
    listing.reviewStatus === 'verified'
  )
}

/** `listingBrowseAudience`. */
export function listingBrowseAudience(listing) {
  if (listing.deletedAt || listing.visibility === 'private') return []
  const publisher = typeof listing.profileId === 'string' ? listing.profileId : ''
  const scope = isListingBrowsable(listing) ? BROWSE_EVERYONE : publisher
  if (!scope) return []
  return publisher ? [scope, `${scope}${BROWSE_PUBLISHER_JOIN}${publisher}`] : [scope]
}

/** `listingQueryFields`. */
export function listingQueryFields(listing) {
  const name = displayNameSearchFields(listing.displayName)
  const browseAudience = listingBrowseAudience(listing)
  return {
    ...name,
    browseAudience,
    browseTokens: scopedSearchTokens(browseAudience, name.nameTokens),
    takenDown: Boolean(listing.hiddenAt),
  }
}

const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

/** `LISTING_SORT_DEFAULTS`: stamped only where the field is absent. */
export const LISTING_SORT_DEFAULTS = { installCount: 0, ratingAverage: null }

/** `listingQueryFieldsPatch`: what is missing or stale, or null. */
export function listingQueryFieldsPatch(listing) {
  const computed = listingQueryFields(listing)
  const patch = {}
  for (const [key, value] of Object.entries(computed)) {
    if (!same(listing[key], value)) patch[key] = value
  }
  for (const [key, value] of Object.entries(LISTING_SORT_DEFAULTS)) {
    if (listing[key] === undefined) patch[key] = value
  }
  return Object.keys(patch).length ? patch : null
}
