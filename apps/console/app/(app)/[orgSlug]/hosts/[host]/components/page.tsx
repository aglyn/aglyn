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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import HostComponentsCard from '../../../../../../components/host-components-card.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import hostNavTabItems from '../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'

/**
 * Components page (AGL-250): reusable components moved off the dashboard —
 * named canvas subtrees that render identically on every screen using them.
 */
const HostComponents: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()

  return (
    <>
      <NextPageTitle screen={'Components'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Components',
            href: buildRoute(Route.HOST_COMPONENTS, { orgSlug,  host }),
          },
        ]}
        help="components"
        header={{
          children: 'Reusable Components',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <HostComponentsCard hostId={hostId} />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostComponents.displayName = 'Page:HostComponents'

export default HostComponents
