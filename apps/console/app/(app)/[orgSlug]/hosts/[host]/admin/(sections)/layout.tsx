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

import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Typography } from '@mui/material'
import type { ReactNode } from 'react'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import { docsHelp } from '../../../../../../../constants/docs-links'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import {
  useHostId,
  useHostSubdomain,
  useIsHostAdmin,
} from '../../../../../../../components/host-id-provider'

/**
 * Site Admin (AGL-1014), section by section (AGL-2501).
 *
 * Owner/admin-only site controls, kept out of the Setup page a collaborator
 * legitimately visits. The refusal below is a NOTICE, not the boundary — the
 * rules and the delete API enforce that regardless of what renders — but it
 * wraps every section so a non-admin who types a section URL is told, rather
 * than shown a rail into pages that will refuse them one at a time.
 */
export default function HostAdminSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const isAdmin = useIsHostAdmin()
  const section = (route: Route, label: string) => ({
    href: buildRoute(route as never, { orgSlug, host } as never),
    label,
  })
  /*
   * One list, read twice — by the rail and by the breadcrumb below. Built here
   * rather than inline in the JSX so `useActiveSection` can resolve against
   * the same array the rail highlights: a section added here is named in the
   * trail by construction, instead of by somebody remembering a second copy.
   */
  const sections = [
    section(Route.HOST_ADMIN_PLUGINS, 'Plugins'),
    section(Route.HOST_ADMIN_DOMAIN, 'Custom Domain'),
    section(Route.HOST_ADMIN_SECURITY, 'Security'),
    section(Route.HOST_ADMIN_ACTIVITY, 'Activity'),
    section(Route.HOST_ADMIN_DANGER, 'Danger zone'),
  ]
  const active = useActiveSection(sections)

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
        // The section the reader is actually on. Without it the trail names
        // every level except theirs, which is the one they might click to
        // leave and the one that tells them where they are.
        ...(active ? [{ children: active.label, href: active.href }] : []),
      ]}
      help={{ topic: 'plugins', anchor: '#how-plugins-run' }}
      header={{
        children: 'Site Admin',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {isAdmin ? (
          <HubSections sections={sections}>{children}</HubSections>
        ) : (
          <CardDisplay
            header="Admin"
            help={docsHelp('team', {
              excerpt:
                'Site admin actions — per-site plugin choices and deleting ' +
                'the site — are limited to site admins.',
            })}
            contentGutterX
            contentGutterY
          >
            <Typography variant="body2" color="text.secondary">
              {'Only site admins can open this area.'}
            </Typography>
          </CardDisplay>
        )}
      </Container>
    </DashboardLayout>
  )
}
