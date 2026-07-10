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
import OrgMediaCard from '../../../components/media/org-media-card.component'
import orgNavTabItems from '../../../constants/org-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgWorkspace } from '../../../hooks/use-org-workspace'

/**
 * Org media library without host context (AGL-236/237): the shared
 * library, scoped to the workspace switcher's current org.
 */
const OrgMedia: NextPageWithLayout = () => {
  const { currentOrg, loading } = useOrgWorkspace()
  return (
    <>
      <NextPageTitle screen={'Media – Organization'} />
      <DashboardLayout
        navTabItems={orgNavTabItems()}
        activeTab={buildRoute(Route.ORG_MEDIA)}
        breadcrumbItems={[
          {
            children: currentOrg?.orgName ?? 'Organization',
            href: buildRoute(Route.MANAGE_TEAM),
          },
          { children: 'Media', href: buildRoute(Route.ORG_MEDIA) },
        ]}
        header={{
          children: 'Organization Media',
          icon: { path: ICON_VARIANT_HOST_GROUP.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, or accept ' +
                'a pending invite from your dashboard.'}
            </Alert>
          ) : (
            <OrgMediaCard orgId={currentOrg?.$id ?? null} />
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgMedia.displayName = 'Page:OrgMedia'
OrgMedia.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Media – Organization' } },
]

export default OrgMedia
