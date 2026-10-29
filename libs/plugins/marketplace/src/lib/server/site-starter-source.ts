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

import {
  matchSiteStarterFacets,
  SITE_STARTER_ARTIFACT_TYPE,
  siteStarterFacetsOf,
  siteStarterRefusal,
  type SiteStarterChoice,
  type SiteStarterFacets,
  type SiteStarterPayload,
} from '@aglyn/aglyn/app-utils/site-starter'
import type {
  PluginSiteStarterSource,
  SiteStarterSummary,
  SiteStarterViewer,
} from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  BROWSE_EVERYONE,
  LISTING_BROWSE_AUDIENCE,
  LISTING_BROWSE_TOKENS,
} from '../model/listing-query'
import {
  isListingBrowsable,
  isListingDeleted,
  isPrivateListing,
  listingArtifactType,
} from '../model/marketplace'
import {
  officialStartersFirst,
  SITE_STARTER_KNOWN_IDS,
  siteStarterSearchLimit,
  siteStarterSearchTokens,
  siteStarterSummaryOf,
} from '../model/site-starter-listing'
import { canActAsPublisher, PUBLISHER_PROFILES } from './publisher-profile'
import { hasLivePurchase, requirePurchase } from './purchase-entitlement'
import { isPublisherSecurityLocked } from './sale-risk'
import { recordVersionMove } from './version-stats'

/**
 * Where the console's "Create site" finds its starters (AGL-4049): the
 * marketplace's `siteStarter` listings, behind core's `core.site-starters`
 * seam (`plugin-manager/plugin-site-starters.ts`), registered from
 * `declarations.server.ts`.
 *
 * `resolve` is a content door like the install routes: it hands over a
 * listing's stored version, so it refuses what they refuse — a taken-down
 * listing, a publisher under a security lock, a private listing to anyone
 * but its own workspace, an unpaid priced one (`install-listing-gates.spec.ts`
 * holds the three). A starter still in review is its own workspace's to try,
 * as a plugin is.
 */

const LISTINGS = 'marketplaceListings'

const firestoreOf = () => firebaseAdmin.app().firestore()

type ListingDoc = Record<string, any>

/** The answer a refused pick gives, in the seam's shape. */
type Refused = { error: string; status: 402 | 403 | 404; priceUsd?: number }

const gone = (error = 'Unknown starter'): Refused => ({ error, status: 404 })

/**
 * Each publisher's name as a search card shows it, read once per publisher
 * in one batch: the profile's display name, else its handle.
 */
async function authorNames(
  firestore: FirebaseFirestore.Firestore,
  profileIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter((id) => typeof id === 'string' && id))]
  const names = new Map<string, string>()
  if (!ids.length) return names
  const refs = ids.map((id) => firestore.collection(PUBLISHER_PROFILES).doc(id))
  const snapshots = await firestore.getAll(...refs)
  snapshots.forEach((snapshot, index) => {
    const displayName = snapshot.get('displayName')
    const handle = snapshot.get('handle')
    const name =
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim()
        : typeof handle === 'string'
          ? handle
          : ''
    names.set(ids[index], name)
  })
  return names
}

/**
 * Whether the viewer acts for the listing's publisher, in the publisher's
 * own workspace: it picks its own starter free, and only into itself — the
 * waiver is about the publisher's OWN sites (AGL-2484), so a person who
 * administers the publisher and creates a site elsewhere is a buyer like
 * anyone else there.
 */
async function viewerPublishes(
  firestore: FirebaseFirestore.Firestore,
  listing: ListingDoc,
  viewer: SiteStarterViewer,
): Promise<boolean> {
  const publisherOrgId = String(listing.profileId ?? '')
  const viewerOrgId = String(viewer?.orgId ?? '')
  return viewerOrgId
    ? publisherOrgId !== '' &&
        viewerOrgId === publisherOrgId &&
        canActAsPublisher(firestore, String(viewer?.uid ?? ''), listing.profileId)
    : false
}

/**
 * A starter listing this viewer may pick, with whether they publish it, or
 * `null` when it is gone as far as they are concerned: deleted, taken down,
 * from a publisher under a security lock, not a starter, or private or not
 * yet listed and not theirs.
 */
async function pickableListing(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
  viewer: SiteStarterViewer,
): Promise<{ listing: ListingDoc; publishes: boolean } | null> {
  const listing = (await firestore.collection(LISTINGS).doc(listingId).get()).data() as ListingDoc | undefined
  if (
    !listing ||
    listing.deletedAt ||
    // A staff takedown hands nothing over, to anyone (AGL-2290).
    listing.hiddenAt ||
    // Nor does a publisher under a security lock (AGL-3365).
    (await isPublisherSecurityLocked(firestore, listing.profileId)) ||
    listingArtifactType(listing) !== SITE_STARTER_ARTIFACT_TYPE
  ) {
    return null
  }
  const ownsListing = await viewerPublishes(firestore, listing, viewer)
  // Private means its own workspace only (AGL-968).
  if (isPrivateListing(listing) && !ownsListing) return null
  // A starter still in review, or rejected, is its publisher's to try.
  if (!isListingBrowsable(listing) && !ownsListing) return null
  return { listing, publishes: ownsListing }
}

/**
 * For a priced starter, whether the asking workspace may create from it
 * without paying (AGL-4049): its own, or bought and not refunded — the same
 * answer `resolve` gives, so a card never says "owned" for a pick the create
 * then asks payment for. `undefined` for a free starter, which needs no
 * purchase, and `false` for a viewer naming nobody.
 */
async function ownedBy(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
  listing: ListingDoc,
  viewer: SiteStarterViewer,
  publishes?: boolean,
): Promise<boolean | undefined> {
  if (!(Number(listing.priceUsd ?? 0) > 0)) return undefined
  const buyerOrgId = String(viewer?.orgId ?? '')
  const buyerUid = String(viewer?.uid ?? '')
  if (!buyerOrgId && !buyerUid) return false
  if (publishes ?? (await viewerPublishes(firestore, listing, viewer))) return true
  return hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId })
}

/** A summary with `owned` set where the listing has a price, and left out where it has none. */
const withOwned = (summary: SiteStarterSummary, owned: boolean | undefined): SiteStarterSummary =>
  owned === undefined ? summary : { ...summary, owned }

/**
 * What anyone may see: the search asks the public audience only, so who is
 * asking changes nothing about WHICH starters it lists. The viewer is read
 * for one thing, on the priced ones: whether their workspace already owns
 * it, so a card can say so rather than offer to sell it again.
 */
async function search(
  input: { word: string; filter: Partial<SiteStarterFacets>; limit: number },
  viewer?: SiteStarterViewer,
): Promise<SiteStarterSummary[]> {
  const limit = siteStarterSearchLimit(input?.limit)
  if (!limit) return []
  const filter: Partial<SiteStarterFacets> = input?.filter ?? {}
  const firestore = firestoreOf()

  let query: FirebaseFirestore.Query = firestore
    .collection(LISTINGS)
    .where('artifactType', '==', SITE_STARTER_ARTIFACT_TYPE)
  if (filter.mode === 'base' || filter.mode === 'ai') {
    query = query.where('starterMode', '==', filter.mode)
  }
  if (typeof filter.kind === 'string' && filter.kind) {
    query = query.where('starterKind', '==', filter.kind)
  }
  if (typeof filter.base === 'string' && filter.base) {
    query = query.where('starterBase', '==', filter.base)
  }
  // One array clause answers who may see it, and the search folds into it:
  // `browseTokens` holds only `scope~word` pairs, never the bare scope.
  const tokens = siteStarterSearchTokens(input?.word)
  query = tokens.length
    ? query.where(LISTING_BROWSE_TOKENS, 'array-contains-any', tokens)
    : query.where(LISTING_BROWSE_AUDIENCE, 'array-contains', BROWSE_EVERYONE)
  // Twice the page, so what the facets the query cannot ask (fonts, pages)
  // filter out in memory still leaves a full one, most of the time.
  const snapshot = await query.orderBy('createdAt', 'desc').limit(limit * 2).get()

  const rows = snapshot.docs
    .map((doc) => ({ id: doc.id, listing: (doc.data() ?? {}) as ListingDoc }))
    // Defense in depth: the audience clause already admits only these.
    .filter(({ listing }) => !isListingDeleted(listing) && isListingBrowsable(listing))
    .filter(({ listing }) => matchSiteStarterFacets(siteStarterFacetsOf(listing), filter))
  const ordered = officialStartersFirst(
    rows.map((row) => ({ ...row, official: row.listing['official'] === true })),
  ).slice(0, limit)
  const names = await authorNames(
    firestore,
    ordered.map(({ listing }) => String(listing['profileId'] ?? '')),
  )
  const owned = await Promise.all(
    ordered.map(({ id, listing }) => ownedBy(firestore, id, listing, viewer ?? { orgId: null, uid: '' })),
  )
  return ordered.map(({ id, listing }, index) =>
    withOwned(siteStarterSummaryOf(id, listing, names.get(String(listing['profileId'] ?? '')) ?? ''), owned[index]),
  )
}

/**
 * One starter as a search would list it for this viewer (AGL-4049), or
 * `null` when it is not one they may pick: the same gates `resolve` holds,
 * answered from the listing, never from its stored pages. The create path
 * records and names a site's starter from this, and "Choose your starter"
 * restores a pick with it.
 */
async function describe(
  choice: SiteStarterChoice,
  viewer: SiteStarterViewer,
): Promise<SiteStarterSummary | null> {
  const listingId = typeof choice?.listingId === 'string' ? choice.listingId : ''
  if (!listingId) return null
  const firestore = firestoreOf()
  const found = await pickableListing(firestore, listingId, viewer)
  if (!found) return null
  const { listing, publishes } = found
  const profileId = String(listing['profileId'] ?? '')
  const names = await authorNames(firestore, [profileId])
  const owned = await ownedBy(firestore, listingId, listing, viewer, publishes)
  return withOwned(siteStarterSummaryOf(listingId, listing, names.get(profileId) ?? ''), owned)
}

async function resolve(
  choice: SiteStarterChoice,
  viewer: SiteStarterViewer,
): Promise<SiteStarterPayload | Refused> {
  const listingId = typeof choice?.listingId === 'string' ? choice.listingId : ''
  if (!listingId) return gone()
  const firestore = firestoreOf()
  const listingRef = firestore.collection(LISTINGS).doc(listingId)
  const found = await pickableListing(firestore, listingId, viewer)
  if (!found) return gone()
  const { listing, publishes: ownsListing } = found
  const viewerOrgId = String(viewer?.orgId ?? '')

  const priceUsd = Number(listing.priceUsd ?? 0)
  const unpaid = await requirePurchase({
    firestore,
    buyerUid: String(viewer?.uid ?? ''),
    buyerOrgId: viewerOrgId,
    listingId,
    priceUsd,
    ownsListing,
  })
  if (unpaid) return { error: unpaid.error, status: 402, priceUsd: unpaid.priceUsd }

  const version = String(choice.version ?? listing.latestVersion ?? '')
  if (!version) return gone()
  const versionSnapshot = await listingRef.collection('versions').doc(version).get()
  const payload = versionSnapshot.get('starter') as SiteStarterPayload | undefined
  if (!payload || typeof payload !== 'object') return gone()
  // A starter that cannot start a site is gone, as far as a buyer is concerned.
  const refusal = siteStarterRefusal(payload, SITE_STARTER_KNOWN_IDS)
  if (refusal) return gone(refusal)
  return payload
}

async function installed(
  choice: SiteStarterChoice,
  _viewer: SiteStarterViewer,
  site: { hostId: string },
): Promise<void> {
  try {
    const listingId = typeof choice?.listingId === 'string' ? choice.listingId : ''
    if (!listingId) return
    const firestore = firestoreOf()
    const listingRef = firestore.collection(LISTINGS).doc(listingId)
    const latest = choice.version ?? (await listingRef.get()).get('latestVersion')
    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: SITE_STARTER_ARTIFACT_TYPE,
      from: null,
      to: latest ?? null,
    })
    await listingRef.update({
      installCount: firebaseAdmin.firestore.FieldValue.increment(1),
    })
  } catch (error) {
    // Counting never fails the site it counts.
    console.error('site starter install count failed', {
      listingId: choice?.listingId,
      hostId: site?.hostId,
      error,
    })
  }
}

/** The marketplace's `core.site-starters` source (AGL-4049). */
export const marketplaceSiteStarterSource: Required<PluginSiteStarterSource> = {
  search,
  resolve,
  installed,
  describe,
}
