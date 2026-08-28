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

import { mdiAccountMultipleOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'
import type { ReactNode } from 'react'

/**
 * The Team page's sections, as routes (AGL-693).
 *
 * A ROUTE GROUP, so this shell wraps the sections and NOT `team/[uid]` — the
 * member detail page is a destination in its own right and a section nav
 * beside it would claim it is one of three peers.
 *
 * The three cards used to stack on one route. Splitting them means a reader
 * opening Members does not download the roles editor or the activity feed, and
 * that the section they are on is in the URL — linkable, back-buttonable, and
 * the source of its own active state.
 */
export default function TeamSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  const orgSlug = useOrgSlug()
  const { can, loaded: permissionsLoaded } = useOrgPermissions()
  /*
   * One list, read twice — by the rail and by the breadcrumb. Hoisted so
   * `useActiveSection` resolves against the same array the rail highlights: a
   * section added here is named in the trail by construction, rather than by
   * somebody remembering a second copy.
   */
  const sections = [
    {
      href: buildRoute(Route.MANAGE_TEAM_MEMBERS, { orgSlug }),
      label: 'Members',
    },
    {
      href: buildRoute(Route.MANAGE_TEAM_ROLES, { orgSlug }),
      label: 'Custom roles',
    },
    {
      href: buildRoute(Route.MANAGE_TEAM_ACTIVITY, { orgSlug }),
      /*
       * Permission-gated (AGL-243, `org.auditLog`).
       *
       * `permissionsLoaded &&`, never `!permissionsLoaded ||`. The
       * second spelling offers the section BECAUSE the permission read
       * has not landed — an opt-in to failing open on the one section
       * carrying other people's data. Hiding the item is not the gate
       * either; the route gates itself.
       */
      visible: permissionsLoaded && can('org.auditLog'),
      label: 'Recent activity',
    },
  ]
  const active = useActiveSection(sections)

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Team', href: buildRoute(Route.MANAGE_TEAM, { orgSlug }) },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are.
        ...(active ? [{ children: active.label, href: active.href }] : []),
      ]}
      help="team"
      header={{
        children: 'Team',
        icon: { path: mdiAccountMultipleOutline.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <HubSections sections={sections}>{children}</HubSections>
      </Container>
    </DashboardLayout>
  )
}
