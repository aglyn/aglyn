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
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { HubSections } from '@aglyn/shared-ui-next/components/hub-tabs'
import { Box, CircularProgress } from '@mui/material'
import type { ReactNode } from 'react'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'

/**
 * Organization settings, section by section (AGL-693).
 *
 * The eight sections were `HubTabs` panels on one route, and `HubTabs` mounts
 * every panel it is given — `keepMounted`, with `lazy` off by default and
 * passed by nobody. So opening General also mounted the API-keys card, the SSO
 * card and the data-export card, and ran every read inside them. As routes,
 * Next mounts one page and code-splits per route: an unopened section costs
 * neither a read nor a byte.
 */
export default function SettingsSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  const orgSlug = useOrgSlug()
  const { currentOrg } = useOrgScope()
  const { loaded: permissionsLoaded } = useOrgPermissions()
  const canManage = canManageOrg(currentOrg?.role)
  const isOwner = currentOrg?.role === 'owner'
  const section = (route: Route, label: string, visible?: boolean) => ({
    href: buildRoute(route as never, { orgSlug } as never),
    label,
    visible,
  })

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Settings',
          href: buildRoute(Route.ORG_SETTINGS, { orgSlug }),
        },
      ]}
      help={{
        topic: 'consoleTour',
        anchor: '#workspace-settings--notifications',
      }}
      header={{
        children: 'Organization Settings',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {!permissionsLoaded ? (
          /*
           * A spinner, not an early refusal, and not the sections (AGL-2474).
           *
           * `useOrgPermissions` fails OPEN while loading — `can()` answers as
           * an owner until `loaded` — so rendering the rail during that window
           * offers every section, including the ones that hold API keys and
           * the SSO configuration. Accusing a legitimate admin on every
           * navigation is the same bug mirrored, so neither: wait.
           */
          <Box sx={{ p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <HubSections
            sections={[
              section(Route.ORG_SETTINGS_GENERAL, 'General'),
              section(Route.ORG_SETTINGS_PROFILE, 'Profile', canManage),
              section(Route.ORG_SETTINGS_PLUGINS, 'Plugins', canManage),
              section(Route.ORG_SETTINGS_API_KEYS, 'API keys', canManage),
              section(Route.ORG_SETTINGS_BRANDING, 'Branding', canManage),
              // Shown to every admin, not only entitled orgs (AGL-1210): the
              // unentitled state explains that SSO comes with Enterprise and
              // that setup is self-serve once there. Hiding it would leave
              // "can I do SSO?" unanswerable from inside the product.
              section(Route.ORG_SETTINGS_SSO, 'Single sign-on', canManage),
              section(Route.ORG_SETTINGS_OWNERSHIP, 'Ownership', isOwner),
              section(Route.ORG_SETTINGS_DELETE, 'Delete', isOwner),
            ]}
          >
            {children}
          </HubSections>
        )}
        <PluginWidgetSlot slot="org.settings" />
      </Container>
    </DashboardLayout>
  )
}
