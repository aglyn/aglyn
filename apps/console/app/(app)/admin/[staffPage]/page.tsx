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
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { notFound, useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useDeclareDocumentSubject } from '../../../../components/document-subject'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { resolveDocsHelpTopic } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { STAFF_PLUGIN_IDS } from '../../../../constants/staff-plugins'

/**
 * The staff area's generic plugin route (AGL-2939): a page a plugin adds to
 * the staff area renders here at `/admin/{id}`, the way a plugin's site page
 * renders through the host route — the console owns the layout, the header,
 * the breadcrumbs and the staff gate, and the plugin owns the body. The
 * console's own staff routes are static segments and win theirs.
 *
 * The staff layout has loaded the staff area's plugins before this renders,
 * so the registry already answers: an id no plugin registered is the
 * ordinary 404, not a notice that something might still be loading.
 */
const AdminStaffPluginPage: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ staffPage: string }>()
  const id = String(params?.staffPage ?? '')
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
  const { Component, header, label } = page
  const basePath = buildRoute(Route.ADMIN_STAFF_PAGE, { staffPage: page.id })
  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
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
          <Component basePath={basePath} />
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminStaffPluginPage.displayName = 'Page:AdminStaffPluginPage'

export default AdminStaffPluginPage
