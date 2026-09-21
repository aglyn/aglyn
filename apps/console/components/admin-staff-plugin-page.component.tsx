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

import { resolveConsoleStaffPage } from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { notFound } from 'next/navigation'
import { useMemo } from 'react'
import { useDeclareDocumentSubject } from './document-subject'
import { useStaffRole } from '../hooks/use-is-staff'
import DashboardLayout from './layouts/dashboard.layout'
import StaffOnly from './staff-only.component'
import { resolveDocsHelpTopic } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../constants/shared'
import { STAFF_PLUGIN_IDS } from '../constants/staff-plugins'

/**
 * The staff area's generic plugin page (AGL-2939), shared by the two routes
 * that mount it: `/admin/{id}` and, for a page that claims its subtree,
 * `/admin/{id}/…` (AGL-3080).
 *
 * The console owns the layout, the header, the breadcrumbs and the staff
 * gate; the plugin owns the body. One component rather than a copy per
 * route, because the copy is where a deep URL would quietly stop being
 * gated — `StaffOnly` is not decoration here, it is the thing that keeps a
 * non-holder out.
 *
 * The staff layout has loaded the staff area's plugins before this renders,
 * so the registry already answers: an id no plugin registered is the
 * ordinary 404, not a notice that something might still be loading.
 */
export function AdminStaffPluginPage({
  id,
  segments,
}: {
  id: string
  /** Path segments beneath `/admin/{id}`, `[]` on the page's own URL. */
  segments: readonly string[]
}) {
  /*
   * The viewer's staff role and the console destinations a plugin page may
   * link across to (AGL-3080). Both are the app's to answer — the claim is
   * in this session, the route table is this app's — and a staff page that
   * rebuilt either would be guessing.
   */
  const staffRole = useStaffRole()
  const staffPaths = useMemo(
    () => ({
      orgDetail: (orgId: string) =>
        orgId ? buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }) : undefined,
    }),
    [],
  )
  const page = useMemo(
    () => (id ? resolveConsoleStaffPage(id, STAFF_PLUGIN_IDS) : undefined),
    [id],
  )
  // The server layout titles the tab with the id, because the staff registry
  // only fills on the client; the page's label takes its place once resolved.
  // The label rather than `header.title`, which may carry the brand the title
  // template already appends.
  useDeclareDocumentSubject(id, page?.label)
  if (!page) notFound()
  /*
   * A path BENEATH a page that never claimed one is a 404, not that page
   * rendered again. Serving the list at `/admin/queue/bogus` reads to
   * whoever typed it as the wrong page opening rather than as a typo — the
   * same rule `matchNavItem` applies one level up.
   */
  if (segments.length && !page.ownsSubtree) notFound()
  const { Component, header, label } = page
  const basePath = buildRoute(Route.ADMIN_STAFF_PAGE, { staffPage: page.id })
  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        // Linked unconditionally, as this route has always drawn it: on the
        // page's own URL that is a self-link, and on a row beneath it the
        // way back to the list. Making the top level plain text would read
        // better and is not this change's business — AGL-3080 is about a
        // page being ABLE to have rows.
        { children: label, href: basePath },
      ]}
      help={resolveDocsHelpTopic(header?.docsTopic, 'staffConsole')}
      header={{
        children: header?.title ?? label,
        icon: { path: header?.icon?.path ?? ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Component
            basePath={basePath}
            segments={segments}
            staffRole={staffRole}
            staffPaths={staffPaths}
          />
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

AdminStaffPluginPage.displayName = 'AdminStaffPluginPage'

export default AdminStaffPluginPage
