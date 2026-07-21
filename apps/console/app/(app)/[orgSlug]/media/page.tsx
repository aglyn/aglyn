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
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert } from '@mui/material'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { MediaLibraryComponent } from '../../../../components/media/media-library.component'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'

/**
 * Org media library without host context (AGL-236/237): the shared
 * library, scoped to the workspace switcher's current org.
 */
const OrgMedia: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  return (
    <>
      <NextPageTitle screen={'Media – Organization'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.ORG_MEDIA, { orgSlug })}
        breadcrumbItems={[
          { children: 'Media', href: buildRoute(Route.ORG_MEDIA, { orgSlug }) },
        ]}
        help="media"
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
            currentOrg?.$id ? (
            // Full library (org DAM parity): same card framing, folders,
            // uploads, editing, references and quota meter as a site's
            // media page (AGL-368).
            <CardDisplay
              header={'Library'}
              help={docsHelp('media', {
                excerpt:
                  "The organization's shared media library — folders, " +
                  'uploads, editing, and a quota meter, available to every ' +
                  'site in the workspace.',
              })}
              contentGutterX
              contentGutterY
              contentBordered="all"
            >
              <MediaLibraryComponent orgId={currentOrg.$id} />
            </CardDisplay>
          ) : null
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgMedia.displayName = 'Page:OrgMedia'

export default OrgMedia
