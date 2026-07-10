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

import { mdiAccountMultipleOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import OrgMembersCard from '../../../components/org-members-card.component'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import orgNavTabItems from '../../../constants/org-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

/**
 * Organization team page (AGL-234/238): the org roster with roles,
 * invites and per-site access is the only membership system — the legacy
 * manager-seat and custom-role cards (AGL-108/133) retired with the
 * tenants collection. Per-site collaborators can also be added from a
 * site's own Users card, which grants org membership scoped to that site.
 */
const ManageTeam: NextPageWithLayout = () => {
  return (
    <>
      <NextPageTitle screen={'Team'} />
      <DashboardLayout
        navTabItems={orgNavTabItems()}
        activeTab={buildRoute(Route.MANAGE_TEAM)}
        breadcrumbItems={[
          {
            children: 'Team',
            href: buildRoute(Route.MANAGE_TEAM),
          },
        ]}
        header={{
          children: 'Team',
          icon: { path: mdiAccountMultipleOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <OrgMembersCard />
        </Container>
      </DashboardLayout>
    </>
  )
}
ManageTeam.displayName = 'Page:ManageTeam'
ManageTeam.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Team',
    },
  },
]

export default ManageTeam
