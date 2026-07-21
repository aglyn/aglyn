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

import { mdiImageMultipleOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { Box } from '@mui/material'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import MediaLibraryComponent from '../../../../../../components/media/media-library.component'
import OrgMediaCard from '../../../../../../components/media/org-media-card.component'
import useHostOrgId from '../../../../../../hooks/use-host-org-id'
import { docsHelp } from '../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import hostNavTabItems from '../../../../../../constants/host-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'

const HostMedia: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const hostOrgId = useHostOrgId(hostId)

  return (
    <>
      <NextPageTitle screen={'Media'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Media',
            href: buildRoute(Route.HOST_MEDIA, { orgSlug,  host }),
          },
        ]}
        help="media"
        header={{
          children: 'Media',
          icon: { path: mdiImageMultipleOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Library'}
            help={docsHelp('media', {
              excerpt:
                "This site's private library — organize uploads into " +
                'folders and serve them fast over the CDN.',
            })}
            contentGutterX
            contentGutterY
            contentBordered="all"
          >
            <MediaLibraryComponent hostId={hostId} />
          </CardDisplay>
          {/* Shared org library (AGL-237) below the host-private one. */}
          <Box sx={{ mt: 3 }}>
            <OrgMediaCard orgId={hostOrgId} />
          </Box>
        </Container>
      </DashboardLayout>
    </>
  )
}
HostMedia.displayName = 'Page:HostMedia'

export default HostMedia
