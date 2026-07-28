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

import { mdiStorefrontOutline } from '@aglyn/shared-data-mdi'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Box, Button, Stack } from '@mui/material'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import ListingDetailEditor from '../../../../../components/marketplace/listing-detail-editor.component'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'

/**
 * Org marketplace listing detail (AGL-772): the org-scope counterpart of the
 * per-site listing page. The app owns the Dashboard chrome; the body is the
 * community plugin's `communityListing` widget, rendered with `orgScoped` so
 * its links resolve to the org marketplace. Install pins validate against a
 * site, so the detail acts through the org's first site until targeting
 * lands (AGL-773).
 */
const OrgMarketplaceListing: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { permissions } = useOrgPermissions()
  const params = useParams<{ listingId: string }>()
  const listingId = String(params.listingId ?? '')

  // The listing itself, so the owner can edit the whole page in place
  // (AGL-869) rather than through a cramped sidebar card.
  const { data: listing } = useFirestoreDoc<any>(
    () => doc(firestore, 'communityListings', listingId || '-missing-'),
    [firestore, listingId],
    { idField: '$id' },
  )
  // Listings are org-owned (AGL-652): ownership is an org comparison.
  const isOwner = Boolean(
    currentOrg?.$id && listing?.profileId === currentOrg.$id,
  )
  const [editing, setEditing] = useState(false)

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const hostList = useMemo(
    () =>
      ((hosts as Array<{ $id: string; subdomain?: string; displayName?: string }>) ??
        []).map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    [hosts],
  )
  // Install pins resolve the org from a site, so org-scope installs still
  // act through the first site; the picker (AGL-773) chooses the real targets.
  const actingHost = hostList[0]?.id ?? ''

  // Name the thing you are looking at (AGL-1000). The page used to announce
  // itself as "Marketplace listing" over a breadcrumb ending in "Listing",
  // which made the largest text on the page the one part identical on every
  // listing. This route already reads the doc for the in-place editor, so the
  // name costs nothing; the generic wording stays as the fallback for the
  // beat before it resolves and for a listing that does not exist.
  const listingName = String(listing?.displayName ?? '').trim()

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Marketplace',
          href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
        },
        {
          children: listingName || 'Listing',
          href: buildRoute(Route.ORG_MARKETPLACE_LISTING, {
            orgSlug,
            listingId,
          }),
        },
      ]}
      header={{
        children: listingName || 'Marketplace listing',
        icon: { path: mdiStorefrontOutline.path },
      }}
      // Owner action in the hero (AGL-1005), where the chrome already has a
      // slot for it. It used to float in a bare right-aligned box above the
      // content — unanchored to anything, and it moved depending on whether
      // the org had a site yet.
      headerRight={
        isOwner && !editing ? (
          <Stack direction="row" spacing={1}>
            {/* Shipping a new version had no door on the listing itself
                (AGL-1008) — Edit changes metadata and View changes nothing,
                so the only reading left was "make a second listing". Same
                publish form, pre-bound to this listing. Plugins only: a
                bundle is the thing a new version ships. */}
            {(listing?.artifactType ?? listing?.type) === 'plugin' ? (
              <AppLink
                href={
                  `${buildRoute(Route.ORG_MARKETPLACE_PUBLISH_PLUGIN, {
                    orgSlug,
                  })}?listing=${encodeURIComponent(listingId)}`
                }
              >
                <Button variant="contained" color="secondary" component="span">
                  {'Publish new version'}
                </Button>
              </AppLink>
            ) : null}
            <Button
              variant="outlined"
              color="secondary"
              onClick={() => setEditing(true)}
            >
              {'Edit listing'}
            </Button>
          </Stack>
        ) : undefined
      }
      help="plugins"
    >
      {editing && isOwner && currentOrg?.$id && listing ? (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <ListingDetailEditor
            orgId={currentOrg.$id}
            listingId={listingId}
            listing={listing}
            user={user}
            onDone={() => setEditing(false)}
          />
        </Container>
      ) : !actingHost ? (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* Owners can still edit their listing with no site of their own —
              through the hero's Edit listing action (AGL-1005). */}
          {isOwner ? (
            <Alert severity="info">
              {'Add a site to your organization to install marketplace ' +
                'items. You can still edit this listing above.'}
            </Alert>
          ) : (
            <Alert severity="info">
              {'Add a site to your organization to view and install ' +
                'marketplace items.'}
            </Alert>
          )}
        </Container>
      ) : (
        <>
          <PluginWidgetSlot
            slot="communityListing"
            hostId={actingHost}
            listingId={listingId}
            permissions={permissions}
            orgScoped
            orgSlug={orgSlug}
            hosts={hostList}
          />
        </>
      )}
    </DashboardLayout>
  )
}
OrgMarketplaceListing.displayName = 'Page:OrgMarketplaceListing'

export default OrgMarketplaceListing
