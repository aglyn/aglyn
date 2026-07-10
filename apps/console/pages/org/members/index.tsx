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

import { ICON_VARIANT_HOST_GROUP } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert } from '@mui/material'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import OrgMembersCard from '../../../components/org-members-card.component'
import orgNavTabItems from '../../../constants/org-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgWorkspace } from '../../../hooks/use-org-workspace'

/**
 * Org members without host context (AGL-236): the same membership card
 * as Manage → Team, scoped to the workspace switcher's current org.
 */
const OrgMembers: NextPageWithLayout = () => {
  const { currentOrg, loading } = useOrgWorkspace()
  return (
    <>
      <NextPageTitle screen={'Members – Organization'} />
      <DashboardLayout
        navTabItems={orgNavTabItems()}
        activeTab={buildRoute(Route.ORG_MEMBERS)}
        breadcrumbItems={[
          {
            children: currentOrg?.orgName ?? 'Organization',
            href: buildRoute(Route.ORG_MEMBERS),
          },
          { children: 'Members', href: buildRoute(Route.ORG_MEMBERS) },
        ]}
        header={{
          children: 'Organization Members',
          icon: { path: ICON_VARIANT_HOST_GROUP },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, or accept ' +
                'a pending invite from your dashboard.'}
            </Alert>
          ) : (
            <OrgMembersCard />
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgMembers.displayName = 'Page:OrgMembers'
OrgMembers.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Members – Organization' } },
]

export default OrgMembers
