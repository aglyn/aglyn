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
'use client'

import {
  PageHeaderActions,
  PageHeaderHelp,
  PageHeaderRecord,
} from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import ListingDetailEditor from './listing-detail-editor.component'
import ListingReviewStatus from './listing-review-status.component'
import ListingVerificationRequest from './listing-verification-request.component'
import { MarketplaceListingContent } from './listing-content.component'
import { publishPluginPath } from '../model/marketplace-paths'

/**
 * Org marketplace listing detail (AGL-772), at `{marketplace}/{listingId}`.
 *
 * It was a console route until AGL-3080, which is why it used to reach the
 * body through the `marketplaceListing` zone: an app page could not import
 * this plugin. This page IS the plugin now, so it renders the content
 * directly — the zone stays registered for the surfaces that still need it.
 *
 * Install pins validate against a site, so the detail acts through the org's
 * first site until targeting lands (AGL-773).
 */
export function ListingDetailPage(props: {
  listingId: string
  orgId: string | null
  basePath: string
  /** The site an install acts through, and every site for the target picker. */
  actingHost: string
  hosts: ReadonlyArray<{ id: string; label: string }>
  permissions?: Record<string, boolean | undefined>
  orgSlug: string
}) {
  const { listingId, orgId, basePath, actingHost, hosts, permissions, orgSlug } =
    props
  const firestore = useFirestore()
  const { data: user } = useUser()

  // The listing itself, so the owner can edit the whole page in place
  // (AGL-869) rather than through a cramped sidebar card.
  const { data: listing } = useFirestoreDoc<any>(
    () => doc(firestore, 'marketplaceListings', listingId || '-missing-'),
    [firestore, listingId],
    { idField: '$id' },
  )
  // Listings are org-owned (AGL-652): ownership is an org comparison.
  const isOwner = Boolean(orgId && listing?.profileId === orgId)
  const [editing, setEditing] = useState(false)

  // Name the thing you are looking at (AGL-1000). The page used to announce
  // itself as "Marketplace listing" over a breadcrumb ending in "Listing",
  // which made the largest text on the page the one part identical on every
  // listing. This page already reads the doc for the in-place editor, so the
  // name costs nothing; the surface's declared title stays as the fallback
  // for the beat before it resolves and for a listing that does not exist.
  const listingName = String(listing?.displayName ?? '').trim()
  const isPlugin = (listing?.artifactType ?? listing?.type) === 'plugin'

  /*
   * The hero's owner actions, memoized (AGL-1005). `PageHeaderActions`
   * publishes upward through an effect keyed on what it is handed, so a node
   * rebuilt every render would republish every render. The dependencies are
   * exactly the four facts the buttons read.
   */
  const ownerActions = useMemo(
    () =>
      isOwner && !editing ? (
        <Stack direction="row" spacing={1}>
          {/* Shipping a new version had no door on the listing itself
              (AGL-1008) — Edit changes metadata and View changes nothing,
              so the only reading left was "make a second listing". Same
              publish form, pre-bound to this listing. Plugins only: a
              bundle is the thing a new version ships. */}
          {isPlugin ? (
            <AppLink href={publishPluginPath(basePath, listingId)}>
              <Button variant="contained" color="primary" component="span">
                {'Publish new version'}
              </Button>
            </AppLink>
          ) : null}
          <Button
            variant="outlined"
            color="primary"
            onClick={() => setEditing(true)}
          >
            {'Edit listing'}
          </Button>
        </Stack>
      ) : null,
    [isOwner, editing, isPlugin, basePath, listingId],
  )

  return (
    <>
      <PageHeaderRecord title={listingName} />
      <PageHeaderHelp
        topic="plugins"
        anchor="#what-the-badges-on-a-listing-mean"
      />
      {/* Owner action in the hero (AGL-1005), where the chrome already has a
          slot for it. It used to float in a bare right-aligned box above the
          content — unanchored to anything, and it moved depending on whether
          the org had a site yet. */}
      <PageHeaderActions>{ownerActions}</PageHeaderActions>
      {editing && isOwner && orgId && listing ? (
        <ListingDetailEditor
          orgId={orgId}
          listingId={listingId}
          listing={listing}
          user={user}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          {/* The publisher's own view of the queue (AGL-1079). Owner-only:
              review state, rejection reasons and what was attested are the
              publisher's business, and a buyer is never offered a version
              this card exists to explain. Above the buyer-facing body,
              because "what is happening to my submission" is why an owner
              opened their own listing. */}
          {isOwner ? (
            <>
              <ListingReviewStatus listingId={listingId} isPlugin={isPlugin} />
              {/* The door to the Verified badge (AGL-1217). Below the review
                  card on purpose: "where is my submission" is the more urgent
                  question, and asking for a badge only makes sense once the
                  listing is live. */}
              <ListingVerificationRequest
                listingId={listingId}
                listing={listing}
                viewerOrgId={orgId ?? undefined}
                user={user}
                isPlugin={isPlugin}
              />
            </>
          ) : null}
          {!actingHost ? (
            // Owners can still edit their listing with no site of their own —
            // through the hero's Edit listing action (AGL-1005).
            <Alert severity="info">
              {isOwner
                ? 'Add a site to your organization to install marketplace ' +
                  'items. You can still edit this listing above.'
                : 'Add a site to your organization to view and install ' +
                  'marketplace items.'}
            </Alert>
          ) : (
            <MarketplaceListingContent
              hostId={actingHost}
              listingId={listingId}
              permissions={permissions}
              orgScoped
              orgSlug={orgSlug}
              hosts={hosts}
            />
          )}
        </>
      )}
    </>
  )
}

ListingDetailPage.displayName = 'ListingDetailPage'

export default ListingDetailPage
