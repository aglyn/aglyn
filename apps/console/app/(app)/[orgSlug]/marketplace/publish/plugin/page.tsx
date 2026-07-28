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
import { Alert, Stack } from '@mui/material'
import { Container } from '@aglyn/shared-ui-jsx'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import PublishPluginForm from '../../../../../../components/marketplace/publish-plugin-form.component'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgScope, useOrgSlug } from '../../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * Publish a plugin (AGL-1078).
 *
 * This was `UploadPluginDialog`, a modal with no URL, no draft and no room.
 * The route exists so a publish can be linked, reloaded and — once AGL-1008
 * lands — reached from a listing pre-bound to it, because an update is this
 * same form with a listing already chosen.
 */
const PublishPluginPage: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { permissions, loaded } = useOrgPermissions()

  // Gate on the resolved answer, never on the hook's loading default — it
  // defaults to ALL TRUE, so reading it early would render the form for a
  // member who cannot publish and let them get as far as a 403.
  const ready = !loading && loaded
  const allowed = ready && permissions?.publishToCommunity === true

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Marketplace',
          href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
        },
        {
          children: 'Publish a plugin',
          href: buildRoute(Route.ORG_MARKETPLACE_PUBLISH_PLUGIN, { orgSlug }),
        },
      ]}
      header={{
        children: 'Publish a plugin',
        icon: { path: mdiStorefrontOutline.path },
      }}
      help="plugins"
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {!ready ? null : !allowed ? (
          <Stack spacing={2}>
            <Alert severity="info">
              {'Your organization role does not allow publishing to the ' +
                'marketplace.'}
            </Alert>
          </Stack>
        ) : currentOrg?.$id ? (
          <PublishPluginForm orgId={currentOrg.$id} orgSlug={orgSlug} />
        ) : null}
      </Container>
    </DashboardLayout>
  )
}
PublishPluginPage.displayName = 'Page:PublishPlugin'

export default PublishPluginPage
