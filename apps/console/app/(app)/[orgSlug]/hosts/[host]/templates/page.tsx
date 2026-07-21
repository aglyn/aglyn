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

import { mdiBookmarkOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import HostTemplatesCard from '../../../../../../components/templates/host-templates-card.component'
import hostNavTabItems from '../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * Templates page (AGL-667): saved starting points for pages, components and
 * layouts, plus anything installed from the marketplace. Nothing here is
 * live until it is used.
 */
const HostTemplates: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()

  return (
    <>
      <NextPageTitle screen={'Templates'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        activeTab={buildRoute(Route.HOST_TEMPLATES, { orgSlug, host })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
          },
          {
            children: 'Templates',
            href: buildRoute(Route.HOST_TEMPLATES, { orgSlug, host }),
          },
        ]}
        help="templatesLibrary"
        header={{
          children: 'Templates',
          icon: { path: mdiBookmarkOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <HostTemplatesCard hostId={hostId} />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostTemplates.displayName = 'Page:HostTemplates'

export default HostTemplates
