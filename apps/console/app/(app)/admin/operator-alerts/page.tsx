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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import StaffOperatorAlertsCard from '../../../../components/staff-operator-alerts-card.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

/**
 * Staff → Operator alerts (AGL-3377): every alert type in the registry, core's
 * and each installed plugin's, with its switch and its delivery; where the
 * alerts go; and every health check's last recorded state. Reading is any
 * staff role; changing and testing are `super`, enforced and audited by
 * `/api/admin/operator-alerts`.
 */
const AdminOperatorAlerts: NextPageWithLayout<Record<string, never>> = () => {
  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Operator alerts', href: buildRoute(Route.ADMIN_OPERATOR_ALERTS) },
      ]}
      help={{ topic: 'operatorAlerts', anchor: '#settings' }}
      header={{
        children: 'Operator Alerts',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <StaffOperatorAlertsCard />
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

export default AdminOperatorAlerts
