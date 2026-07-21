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

import { ICON_VARIANT_USER_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Stack } from '@mui/material'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import HostMembersCard from '../../../../../../components/host-members-card.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import SiteAccountsCard from '../../../../../../components/site-accounts-card.component'
import hostNavTabItems from '../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'

/**
 * Users section (AGL-350): site visitor accounts (searchable, paged)
 * plus the console collaborator manager — both off the dashboard.
 */
const HostUsers: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()

  return (
    <>
      <NextPageTitle screen={'Users'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        activeTab={buildRoute(Route.HOST_USERS, { orgSlug,  host })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Users',
            href: buildRoute(Route.HOST_USERS, { orgSlug,  host }),
          },
        ]}
        help="members"
        header={{
          children: 'Users',
          icon: { path: ICON_VARIANT_USER_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <Stack spacing={3}>
            <SiteAccountsCard hostId={hostId} />
            <HostMembersCard hostId={hostId} />
          </Stack>
        </Container>
      </DashboardLayout>
    </>
  )
}
HostUsers.displayName = 'Page:HostUsers'

export default HostUsers
