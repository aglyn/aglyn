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
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'

/**
 * Org marketplace (AGL-772): the single org-scope place to browse and
 * install marketplace items, replacing the per-site community tab. The app
 * owns only the chrome — the grid is the community plugin's `orgMarketplace`
 * widget (the app never imports the plugin), rendered with `orgScoped` so
 * listing links resolve to this route.
 *
 * Installs still act through a site (pins are validated against host
 * membership), so an "Installing to" selector names the acting site until
 * All-sites / selected-sites targeting lands (AGL-773).
 */
const OrgMarketplace: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { permissions } = useOrgPermissions()

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const hostList = useMemo(
    () =>
      ((hosts as Array<{ $id: string; subdomain?: string; displayName?: string }>) ??
        []).map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    [hosts],
  )
  const [selectedHost, setSelectedHost] = useState('')
  const actingHost = selectedHost || hostList[0]?.id || ''

  return (
    <>
      <NextPageTitle screen={'Marketplace'} />
      <DashboardLayout
        breadcrumbItems={[
          {
            children: 'Marketplace',
            href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
          },
        ]}
        help="plugins"
        header={{
          children: 'Marketplace',
          icon: { path: mdiStorefrontOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, then browse ' +
                'and install marketplace items here.'}
            </Alert>
          ) : !actingHost ? (
            <Alert severity="info">
              {'Add a site to your organization to install marketplace ' +
                'items — installs apply to a site (or every site).'}
            </Alert>
          ) : (
            <Stack spacing={2}>
              {hostList.length > 1 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {'Installing to'}
                  </Typography>
                  <TextField
                    select
                    size="small"
                    label="Site"
                    value={actingHost}
                    onChange={(event) => setSelectedHost(event.target.value)}
                    sx={{ minWidth: 200 }}
                  >
                    {hostList.map((host) => (
                      <MenuItem key={host.id} value={host.id}>
                        {host.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              ) : null}
              {/* Community plugin's org-scope browse (the app stays
                  plugin-free). Renders nothing if the community plugin is
                  disabled for the workspace. */}
              <PluginWidgetSlot
                slot="orgMarketplace"
                hostId={actingHost}
                permissions={permissions}
                orgScoped
              />
            </Stack>
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgMarketplace.displayName = 'Page:OrgMarketplace'

export default OrgMarketplace
