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
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Box,
  Chip,
  Grid,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import { collection, doc, query, where } from 'firebase/firestore'
import { useRouter } from 'next/router'
import { useFirestore } from 'reactfire'
import HostDisplayNameComponent from '../../../../../components/host-display-name.component'
import { useHostId } from '../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import hostNavTabItems from '../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import useFirestoreCollection from '../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../hooks/use-firestore-doc'

/**
 * Publisher profile public page (AGL-95): the community profile block and
 * every listing they publish, each linking to its detail page.
 */
const CommunityPublisher: NextPageWithLayout = () => {
  const hostId = useHostId()
  const router = useRouter()
  const profileId = String(router.query.profileId ?? '')
  const firestore = useFirestore()

  const { data: profile, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'profiles', profileId || '-missing-'),
    [firestore, profileId],
    { idField: '$id' },
  )
  const { data: listings } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityListings'),
        where('profileId', '==', profileId || '-missing-'),
        where('deletedAt', '==', null),
      ),
    [firestore, profileId],
    { idField: '$id' },
  )

  const missing = status === 'success' && !profile?.handle
  const title = profile?.displayName ?? 'Publisher'

  return (
    <>
      <NextPageTitle screen={title} />
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
            children: title,
            href: buildRoute(Route.HOST_COMMUNITY_PUBLISHER, {
              hostId,
              profileId,
            }),
          },
        ]}
        header={{
          children: title,
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {missing ? (
            <Typography variant="body2" color="text.secondary">
              {'This publisher profile does not exist.'}
            </Typography>
          ) : (
            <Stack spacing={3}>
              <CardDisplay header={title} contentGutterX contentGutterY>
                <Stack spacing={0.5}>
                  {profile?.handle ? (
                    <Typography variant="body2" color="text.secondary">
                      {`@${profile.handle}`}
                    </Typography>
                  ) : null}
                  {profile?.bio ? (
                    <Typography variant="body2">{profile.bio}</Typography>
                  ) : null}
                </Stack>
              </CardDisplay>
              <CardDisplay
                header={'Published components'}
                contentGutterX
                contentGutterY
              >
                {(listings ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {'No published components yet.'}
                  </Typography>
                ) : (
                  <Grid container spacing={2}>
                    {(listings ?? []).map((listing: any) => {
                      const priceUsd = Number(listing.priceUsd ?? 0)
                      return (
                        <Grid
                          key={listing.$id}
                          size={{ xs: 12, sm: 6, md: 4 }}
                        >
                          <Stack
                            spacing={1}
                            sx={{
                              border: 1,
                              borderColor: 'divider',
                              borderRadius: 1,
                              p: 2,
                              height: '100%',
                            }}
                          >
                            {listing.previewImageUrl ? (
                              <Box
                                component="img"
                                src={listing.previewImageUrl}
                                alt={`${listing.displayName} preview`}
                                sx={{
                                  width: '100%',
                                  height: 120,
                                  objectFit: 'cover',
                                  borderRadius: 1,
                                }}
                              />
                            ) : null}
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <MuiLink
                                href={buildRoute(
                                  Route.HOST_COMMUNITY_LISTING,
                                  { hostId, listingId: listing.$id },
                                )}
                                color="secondary"
                                underline="hover"
                                variant="subtitle2"
                                sx={{ flex: 1 }}
                                noWrap
                              >
                                {listing.displayName}
                              </MuiLink>
                              <Chip
                                size="small"
                                color={priceUsd > 0 ? 'secondary' : 'default'}
                                label={priceUsd > 0 ? `$${priceUsd}` : 'Free'}
                              />
                            </Stack>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {`v${listing.latestVersion}`}
                              {listing.installCount
                                ? ` · ${listing.installCount} install${
                                    listing.installCount === 1 ? '' : 's'
                                  }`
                                : ''}
                            </Typography>
                          </Stack>
                        </Grid>
                      )
                    })}
                  </Grid>
                )}
              </CardDisplay>
            </Stack>
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
CommunityPublisher.displayName = 'Page:CommunityPublisher'
CommunityPublisher.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Publisher',
    },
  },
]

export default CommunityPublisher
