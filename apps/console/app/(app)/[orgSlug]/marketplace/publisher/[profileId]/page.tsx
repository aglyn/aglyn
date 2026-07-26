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
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { Alert, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgHosts } from '../../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * Org-scope publisher storefront (AGL-869): every marketplace listing from one
 * publisher, reached from a listing's Publisher card or a browse card's
 * "by @handle" link. The body is the community plugin's browse widget filtered
 * to this publisher — the app stays plugin-free and reuses one grid.
 */
const OrgMarketplacePublisher: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { permissions } = useOrgPermissions()
  const params = useParams<{ profileId: string }>()
  const profileId = String(params.profileId ?? '')

  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'publisherProfiles', profileId || '-missing-'),
    [firestore, profileId],
    { idField: '$id' },
  )

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const actingHost = useMemo(
    () =>
      ((hosts as Array<{ $id: string }>) ?? [])[0]?.$id ?? '',
    [hosts],
  )

  const title = profile?.displayName ?? (profile?.handle ? `@${profile.handle}` : 'Publisher')

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Marketplace',
          href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
        },
        {
          children: 'Publisher',
          href: buildRoute(Route.ORG_MARKETPLACE_PUBLISHER, {
            orgSlug,
            profileId,
          }),
        },
      ]}
      header={{
        children: title,
        icon: { path: mdiStorefrontOutline.path },
      }}
      help="plugins"
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={2}>
          <CardDisplay header={title} contentGutterX contentGutterY>
            <Stack spacing={0.5}>
              {profile?.handle ? (
                <Typography variant="body2" color="text.secondary">
                  {`@${profile.handle}`}
                </Typography>
              ) : null}
              {profile?.bio ? (
                <Typography variant="body2">{profile.bio}</Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'Everything this publisher has shared to the marketplace.'}
                </Typography>
              )}
            </Stack>
          </CardDisplay>
          {actingHost ? (
            <PluginWidgetSlot
              slot="orgMarketplace"
              hostId={actingHost}
              permissions={permissions}
              orgScoped
              orgSlug={orgSlug}
              publisherId={profileId}
            />
          ) : (
            <Alert severity="info">
              {'Add a site to your organization to browse and install ' +
                'marketplace items.'}
            </Alert>
          )}
        </Stack>
      </Container>
    </DashboardLayout>
  )
}
OrgMarketplacePublisher.displayName = 'Page:OrgMarketplacePublisher'

export default OrgMarketplacePublisher
