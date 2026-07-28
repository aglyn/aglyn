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

import { canManageOrg } from '@aglyn/aglyn'
import { mdiStorefrontOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import HubTabs from '../../../../components/hub-tabs.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import OrgPluginsCard from '../../../../components/org-plugins-card.component'
import OrgPublishPanel from '../../../../components/org-publish-panel.component'
import OrgSellerPanel from '../../../../components/org-seller-panel.component'
import PluginConfigCards from '../../../../components/plugin-config-card.component'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import useCurrentOrg from '../../../../hooks/use-current-org'
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
  const { org } = useCurrentOrg()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { permissions } = useOrgPermissions()
  const canManage = canManageOrg(currentOrg?.role)

  // First-party switchboard save (AGL-797), ported from the retired Plugins
  // page: the enable/disable set is org-owned, written through the settings
  // API rather than a client SDK write.
  const saveEnabledPlugins = async (enabledPlugins: string[]) => {
    const idToken = await (
      user as { getIdToken?: () => Promise<string> }
    )?.getIdToken?.()
    const response = await fetch('/api/orgs/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        orgId: currentOrg?.$id,
        action: 'set-enabled-plugins',
        enabledPlugins,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error ?? 'Request failed')
    }
    enqueueSnackbar('Plugins updated', { variant: 'success' })
  }

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const typedHosts = (hosts as Array<{
    $id: string
    subdomain?: string
    displayName?: string
  }>) ?? []
  // Key the memo on the hosts' content, not the array's identity: useOrgHosts
  // hands back a fresh array on each snapshot, and passing a new-but-equal
  // `hosts` prop into OrgPublishPanel on every parent render is exactly the
  // churn AGL-785 fingered. A stable string key keeps hostList (and that prop)
  // referentially stable until a host is actually added, removed, or renamed.
  const hostsKey = typedHosts
    .map((host) => `${host.$id}:${host.displayName || host.subdomain || ''}`)
    .join('|')
  const hostList = useMemo(
    () =>
      typedHosts.map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostsKey],
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
                    {'Acting site'}
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
              {/* Browse + manage in one place (AGL-774). Both are the
                  community plugin's widgets (the app stays plugin-free) and
                  render nothing if the community plugin is disabled. */}
              <HubTabs
                // Lazy panels (AGL-785): Browse, Installed and Publish each
                // run their own Firestore subscriptions; mounting all three at
                // once on load made their settling re-renders collide and trip
                // React's update-depth limit. Mount only the active tab, then
                // keep it.
                lazy
                tabs={[
                  {
                    id: 'browse',
                    label: 'Browse',
                    content: (
                      <PluginWidgetSlot
                        slot="orgMarketplace"
                        hostId={actingHost}
                        permissions={permissions}
                        orgScoped
                        // The URL already knows the org (AGL-867): pass it so
                        // listing links resolve synchronously instead of via an
                        // async hostIndex→org lookup that can come back empty
                        // and leave the detail page unreachable from browse.
                        orgSlug={orgSlug}
                      />
                    ),
                  },
                  {
                    id: 'installed',
                    label: 'Installed',
                    content: (
                      <Stack spacing={3}>
                        {/* Marketplace installs first (AGL-1003). This is the
                            Installed tab OF THE MARKETPLACE, and these pins
                            are the only thing on it that varies by workspace
                            — they used to sit below a dozen always-present
                            system toggles and every config card, off the
                            bottom of the screen. Renders nothing when the
                            community plugin is disabled. */}
                        <PluginWidgetSlot
                          slot="orgAddons"
                          hostId={actingHost}
                          // Lets each row link to its installation page
                          // (AGL-1007).
                          orgSlug={orgSlug}
                        />
                        {/* First-party plugins (AGL-423/797): the org
                            switchboard and each loaded plugin's settings,
                            folded in from the retired Plugins page so
                            "everything installed" lives in one tab. */}
                        <OrgPluginsCard
                          org={org}
                          disabled={!canManage}
                          onSave={saveEnabledPlugins}
                        />
                        <PluginConfigCards
                          orgId={currentOrg?.$id ?? ''}
                          disabled={!canManage}
                        />
                      </Stack>
                    ),
                  },
                  // Seller area (AGL-776/798/801): one tab each for the
                  // publish action and the seller sections — profile,
                  // listings, payouts and sales — folded in from the retired
                  // Community page. Gated on the publish permission; the server
                  // enforces it too.
                  ...(permissions.publishToCommunity && currentOrg?.$id
                    ? [
                        {
                          id: 'publish',
                          label: 'Publish',
                          content: (
                            <OrgPublishPanel
                              orgId={currentOrg.$id}
                              hosts={hostList}
                            />
                          ),
                        },
                        {
                          id: 'profile',
                          label: 'Profile',
                          content: (
                            <OrgSellerPanel
                              orgId={currentOrg.$id}
                              section="profile"
                            />
                          ),
                        },
                        {
                          id: 'listings',
                          label: 'Listings',
                          content: (
                            <OrgSellerPanel
                              orgId={currentOrg.$id}
                              section="listings"
                            />
                          ),
                        },
                        {
                          id: 'payouts',
                          label: 'Payouts',
                          content: (
                            <OrgSellerPanel
                              orgId={currentOrg.$id}
                              section="payouts"
                            />
                          ),
                        },
                        {
                          id: 'sales',
                          label: 'Sales',
                          content: (
                            <OrgSellerPanel
                              orgId={currentOrg.$id}
                              section="sales"
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
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
