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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, where } from 'firebase/firestore'
import { useRouter } from 'next/router'
import { useMemo } from 'react'
import { useFirestore, useUser } from 'reactfire'
import HostDisplayNameComponent from '../../../../components/host-display-name.component'
import { useHostId } from '../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import hostNavTabItems from '../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useCommunityActions from '../../../../hooks/use-community-actions'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'
import useTenantPermissions from '../../../../hooks/use-tenant-permissions'

/**
 * Community listing detail page (AGL-95): full description, preview image,
 * version history, publisher profile block, and the same install/buy CTA
 * as the browse grid.
 */
const CommunityListingDetail: NextPageWithLayout = () => {
  const hostId = useHostId()
  const router = useRouter()
  const listingId = String(router.query.listingId ?? '')
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { permissions } = useTenantPermissions()
  const { install, buy } = useCommunityActions(hostId)

  const { data: listing, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'communityListings', listingId || '-missing-'),
    [firestore, listingId],
    { idField: '$id' },
  )
  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'profiles', listing?.profileId ?? '-anonymous-'),
    [firestore, listing?.profileId],
    { idField: '$id' },
  )
  const { data: installedDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: purchaseDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityPurchases'),
        where('buyerUid', '==', user?.uid ?? '-anonymous-'),
        limit(200),
      ),
    [firestore, user?.uid],
    { idField: '$id' },
  )

  const install_ = useMemo(
    () =>
      (installedDocs ?? []).find(
        (definition: any) =>
          definition?.community?.listingId === listingId &&
          !definition.deletedAt,
      ),
    [installedDocs, listingId],
  )
  const purchased = useMemo(
    () =>
      (purchaseDocs ?? []).some(
        (purchase: any) => purchase.listingId === listingId,
      ),
    [purchaseDocs, listingId],
  )

  const missing =
    status === 'success' && (!listing?.profileId || listing?.deletedAt)
  const installedVersion = install_?.community?.version
  const upToDate = install_ && installedVersion >= listing?.latestVersion
  const priceUsd = Number(listing?.priceUsd ?? 0)
  const mustBuy =
    priceUsd > 0 && !purchased && listing?.profileId !== user?.uid && !install_
  const versionHistory: any[] = Array.isArray(listing?.versionHistory)
    ? [...listing.versionHistory].sort((a, b) => b.version - a.version)
    : []

  return (
    <>
      <NextPageTitle screen={listing?.displayName ?? 'Community listing'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Community',
            href: buildRoute(Route.HOST_COMMUNITY, { hostId }),
          },
          {
            children: listing?.displayName ?? '…',
            href: buildRoute(Route.HOST_COMMUNITY_LISTING, {
              hostId,
              listingId,
            }),
          },
        ]}
        header={{
          children: listing?.displayName ?? 'Community listing',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {missing ? (
            <Typography variant="body2" color="text.secondary">
              {'This listing does not exist or was unpublished.'}
            </Typography>
          ) : (
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 8 },
                  children: (
                    <CardDisplay
                      header={listing?.displayName ?? '…'}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={2}>
                        {listing?.previewImageUrl ? (
                          <Box
                            component="img"
                            src={listing.previewImageUrl}
                            alt={`${listing?.displayName} preview`}
                            sx={{
                              width: '100%',
                              maxHeight: 360,
                              objectFit: 'cover',
                              borderRadius: 1,
                              border: 1,
                              borderColor: 'divider',
                            }}
                          />
                        ) : null}
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          {listing?.category ? (
                            <Chip size="small" label={listing.category} />
                          ) : null}
                          <Chip
                            size="small"
                            color={priceUsd > 0 ? 'secondary' : 'default'}
                            label={priceUsd > 0 ? `$${priceUsd}` : 'Free'}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {`v${listing?.latestVersion ?? '…'}`}
                            {listing?.installCount
                              ? ` · ${listing.installCount} install${
                                  listing.installCount === 1 ? '' : 's'
                                }`
                              : ''}
                          </Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {listing?.description ?? 'No description provided.'}
                        </Typography>
                        <Box>
                          <Button
                            variant={install_ ? 'outlined' : 'contained'}
                            color="secondary"
                            disabled={Boolean(upToDate) || !listing?.profileId}
                            onClick={
                              permissions.installPlugins
                                ? () =>
                                    mustBuy ? buy(listing) : install(listing)
                                : () =>
                                    enqueueSnackbar(
                                      'Your team role does not allow installing from the community',
                                      { variant: 'warning', persist: false },
                                    )
                            }
                          >
                            {upToDate
                              ? `Installed (v${installedVersion})`
                              : install_
                                ? `Update to v${listing?.latestVersion}`
                                : mustBuy
                                  ? `Buy for $${priceUsd}`
                                  : 'Add to this site'}
                          </Button>
                        </Box>
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 4 },
                  children: (
                    <Stack spacing={3}>
                      <CardDisplay
                        header={'Publisher'}
                        contentGutterX
                        contentGutterY
                      >
                        <Stack spacing={0.5}>
                          <MuiLink
                            href={buildRoute(Route.HOST_COMMUNITY_PUBLISHER, {
                              hostId,
                              profileId: listing?.profileId ?? '',
                            })}
                            color="secondary"
                            underline="hover"
                            variant="body2"
                          >
                            {profile?.displayName ??
                              (profile?.handle ? `@${profile.handle}` : '…')}
                          </MuiLink>
                          {profile?.handle ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {`@${profile.handle}`}
                            </Typography>
                          ) : null}
                          {profile?.bio ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {profile.bio}
                            </Typography>
                          ) : null}
                        </Stack>
                      </CardDisplay>
                      <CardDisplay
                        header={'Version history'}
                        contentGutterX
                        contentGutterY
                      >
                        {versionHistory.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            {`Latest version: v${listing?.latestVersion ?? '…'}`}
                          </Typography>
                        ) : (
                          <Stack spacing={0.5}>
                            {versionHistory.map((entry) => (
                              <Typography key={entry.version} variant="body2">
                                {`v${entry.version}`}
                                <Typography
                                  component="span"
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {entry.publishedAt?.toDate
                                    ? ` · ${entry.publishedAt
                                        .toDate()
                                        .toLocaleDateString()}`
                                    : ''}
                                </Typography>
                              </Typography>
                            ))}
                          </Stack>
                        )}
                      </CardDisplay>
                    </Stack>
                  ),
                },
              ]}
            />
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
CommunityListingDetail.displayName = 'Page:CommunityListingDetail'
CommunityListingDetail.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Community listing',
    },
  },
]

export default CommunityListingDetail
