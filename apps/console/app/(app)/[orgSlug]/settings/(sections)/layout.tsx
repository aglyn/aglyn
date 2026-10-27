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

import { canManageOrg, CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import { Box, CircularProgress } from '@mui/material'
import type { ReactNode } from 'react'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { useSlotHasWidgets } from '../../../../../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'
import useTransferHubVisible from '../../../../../hooks/use-transfer-hub-visible'

/**
 * Organization settings, section by section (AGL-2501).
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
  const { loaded: permissionsLoaded, can } = useOrgPermissions()
  const canManage = canManageOrg(currentOrg?.role)
  // The sections whose routes check `org.settings` (AGL-4047) follow that key,
  // so a custom role that grants or takes it moves the rail with the server.
  // API keys, Privacy and Holds stay on the role their routes still ask.
  const managesSettings = permissionsLoaded && can('org.settings')
  const isOwner = currentOrg?.role === 'owner'
  const transferHubVisible = useTransferHubVisible()
  /*
   * The `orgSettings` zone is a section of its own (AGL-3711), offered only
   * while it has a card for this reader. Drawn below the rail, a card ran full
   * width under every section.
   */
  const { hasWidgets: integrations } = useSlotHasWidgets(
    CONSOLE_WIDGET_SLOTS.orgSettings,
  )
  const section = (
    route: Route,
    label: string,
    visible?: boolean,
    group?: string,
  ) => ({
    href: buildRoute(route as never, { orgSlug } as never),
    label,
    visible,
    group,
  })
  // Rail groups (AGL-3713): the workspace's setup, then what it holds about
  // people, then the owner's irreversible steps — a divider and a subheader
  // between each, so twelve sections read as three short lists.
  const DATA = 'Data & compliance'
  const OWNER = 'Danger zone'

  /*
   * One list, read twice — by the rail and by the breadcrumb. Hoisted so
   * `useActiveSection` resolves against the same array the rail highlights: a
   * section added here is named in the trail by construction, rather than by
   * somebody remembering a second copy.
   */
  const sections = [
    section(Route.ORG_SETTINGS_GENERAL, 'General'),
    section(Route.ORG_SETTINGS_PROFILE, 'Profile', managesSettings),
    section(Route.ORG_SETTINGS_PLUGINS, 'Plugins', managesSettings),
    section(Route.ORG_SETTINGS_API_KEYS, 'API keys', canManage),
    section(Route.ORG_SETTINGS_BRANDING, 'Branding', managesSettings),
    // Shown to every admin, not only entitled orgs (AGL-1210): the
    // unentitled state explains that SSO comes with Enterprise and
    // that setup is self-serve once there. Hiding it would leave
    // "can I do SSO?" unanswerable from inside the product.
    section(Route.ORG_SETTINGS_SSO, 'Single sign-on', managesSettings),
    // Other plugins' workspace settings (AGL-3711), with the workspace's
    // own setup above the rail's groups (AGL-3713).
    section(Route.ORG_SETTINGS_INTEGRATIONS, 'Integrations', integrations),
    // The workspace's privacy obligations (AGL-2839): exporting the people
    // it holds and erasing one. Outside the CRM, so every plan has them.
    section(Route.ORG_SETTINGS_PRIVACY, 'Privacy', canManage, DATA),
    // Everything held, flagged or locked on the workspace, and the way to
    // request a review (AGL-3368). Owners and admins: it is who is told.
    section(Route.ORG_SETTINGS_HOLDS, 'Holds & reviews', canManage, DATA),
    // Import & export (AGL-3535): offered to whoever may export something
    // (AGL-3554) — `data.manage`, or a resource that lets the person read
    // its records on a plan that moves them; the page offers each button
    // only where its route takes it.
    section(Route.ORG_SETTINGS_DATA, 'Import & export', transferHubVisible, DATA),
    section(Route.ORG_SETTINGS_OWNERSHIP, 'Ownership', isOwner, OWNER),
    section(Route.ORG_SETTINGS_DELETE, 'Delete', isOwner, OWNER),
  ]
  const active = useActiveSection(sections)

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Settings',
          href: buildRoute(Route.ORG_SETTINGS, { orgSlug }),
        },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are.
        ...(active ? [{ children: active.label, href: active.href }] : []),
      ]}
      help={{
        topic: 'consoleTour',
        anchor: '#organization-settings',
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
          <HubSections sections={sections}>{children}</HubSections>
        )}
      </Container>
    </DashboardLayout>
  )
}
