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
import { Tab, Tabs } from '@mui/material'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useTabParam } from '@aglyn/shared-ui-next/hooks/use-tab-param'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import MediaLibraryComponent from '../../../../../../components/media/media-library.component'
import { useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'

/** `?tab=` ids. The first is the default. */
const WITH_ORG_TAB = ['site', 'org'] as const
const SITE_TAB_ONLY = ['site'] as const

const HostMedia: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  // `ready` rather than truthiness (AGL-1061): `useHostOrgId` cannot tell
  // "still looking" from "no owning org". The Organization tab is therefore
  // drawn WHILE the org resolves and dropped only once the site is known to
  // have none — so the rail does not pop in above the library a beat after
  // mount, and a `?tab=org` link is not bounced to This site before the org
  // it names has had a chance to arrive.
  const { orgId: hostOrgId, ready: orgResolved } = useOrgDataScope({ hostId })
  const hasOrgTab = !orgResolved || Boolean(hostOrgId)
  const { tab, onTabChange } = useTabParam({
    ids: hasOrgTab ? WITH_ORG_TAB : SITE_TAB_ONLY,
  })

  return (
    <DashboardLayout
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
              'folders and serve them fast over the CDN. The Organization ' +
              'tab holds the workspace assets this site is allowed to use.',
          })}
          contentGutterX
          contentGutterY
          contentBordered="all"
        >
          {hasOrgTab ? (
            <Tabs
              value={tab}
              onChange={onTabChange}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{ mb: 2 }}
            >
              <Tab value="site" label="This site" />
              <Tab value="org" label="Organization (shared)" />
            </Tabs>
          ) : null}
          {/* One library mounted at a time. The shared one is a second full
              listing — folder rail, file query, thumbnails — and most visits
              to a site's media never look at it, so it costs nothing until
              its tab is opened. */}
          {tab === 'site' ? <MediaLibraryComponent hostId={hostId} /> : null}
          {/* `forHostId` narrows the shared library to what THIS site may
              render (AGL-1045) — the same rule the picker follows. Without
              it this tab would list every workspace asset the VIEWER can
              see, so an agency owner sitting on a client's media page would
              find the agency's internal artwork under a label promising the
              opposite. */}
          {tab === 'org' && hostOrgId ? (
            <MediaLibraryComponent orgId={hostOrgId} forHostId={hostId} />
          ) : null}
        </CardDisplay>
      </Container>
    </DashboardLayout>
  )
}
HostMedia.displayName = 'Page:HostMedia'

export default HostMedia
