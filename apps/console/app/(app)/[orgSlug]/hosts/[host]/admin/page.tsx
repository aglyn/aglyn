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
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { Tab, Typography } from '@mui/material'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import DeleteSiteCard from '../../../../../../components/delete-site-card.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import {
  useHostId,
  useHostSubdomain,
  useIsHostAdmin,
} from '../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import SitePluginsCard from '../../../../../../components/site-plugins-card.component'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/** Per-site plugins tab id; `/admin?tab=plugins` deep links land here. */
const PLUGINS_TAB_ID = 'plugins'
/** Danger zone tab id; `/admin?tab=danger` deep links land here. */
const DANGER_TAB_ID = 'danger'

/**
 * Host Admin area (AGL-1014): owner/admin-only site controls, out of the
 * Setup page a collaborator legitimately visits. Holds the per-site plugin
 * switchboard and the Danger zone (delete site, formerly in Setup). The
 * nav tab is hidden for non-admins; navigating here by URL shows a notice —
 * the rules (and the delete API) enforce the boundary regardless of what
 * renders.
 */
const HostAdmin: NextPageWithLayout<Record<string, never>> = () => {
  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get('tab')
  const [tab, setTab] = useState(
    requestedTab === DANGER_TAB_ID ? requestedTab : PLUGINS_TAB_ID,
  )
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const isAdmin = useIsHostAdmin()
  const router = useRouter()
  const pathname = usePathname()

  const onTabChange = useCallback(
    (_event: unknown, value: string) => {
      setTab(value)
      // Mirror the active tab into `?tab=` (shallow replace, no scroll) so
      // the section deep-links and survives back/forward — matching Setup.
      const nextParams = new URLSearchParams(searchParams?.toString())
      nextParams.set('tab', value)
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        {
          children: 'Admin',
          href: buildRoute(Route.HOST_ADMIN, { orgSlug, host }),
        },
      ]}
      help="plugins"
      header={{
        children: 'Site Admin',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {isAdmin ? (
          <TabContext value={tab}>
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, sm: 3 },
                  children: (
                    <CardDisplay header="Navigation">
                      <TabList
                        orientation="vertical"
                        textColor="primary"
                        indicatorColor="primary"
                        sx={{
                          ['.MuiTab-root']: {
                            alignItems: 'start',
                            maxWidth: 'unset',
                          },
                        }}
                        onChange={onTabChange}
                      >
                        <Tab value={PLUGINS_TAB_ID} label={'Plugins'} />
                        <Tab value={DANGER_TAB_ID} label={'Danger zone'} />
                      </TabList>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, sm: 9 },
                  children: (
                    <>
                      <TabPanel
                        value={PLUGINS_TAB_ID}
                        sx={{ padding: 'unset' }}
                      >
                        <SitePluginsCard hostId={hostId} />
                      </TabPanel>
                      <TabPanel value={DANGER_TAB_ID} sx={{ padding: 'unset' }}>
                        {/* Moved out of Setup (AGL-1014): destructive site
                            actions no longer sit in a page collaborators
                            otherwise have reason to visit. The card keeps
                            its own admin gate and the delete API its own. */}
                        <DeleteSiteCard hostId={hostId} />
                      </TabPanel>
                    </>
                  ),
                },
              ]}
            />
          </TabContext>
        ) : (
          <CardDisplay header="Admin" contentGutterX contentGutterY>
            <Typography variant="body2" color="text.secondary">
              {'Only site admins can open this area.'}
            </Typography>
          </CardDisplay>
        )}
      </Container>
    </DashboardLayout>
  )
}
HostAdmin.displayName = 'Page:HostAdmin'

export default HostAdmin
