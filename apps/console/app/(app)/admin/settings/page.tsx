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
import { Stack, Typography } from '@mui/material'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import StaffFreeWorkspaceCapCard from '../../../../components/staff-free-workspace-cap-card.component'
import StaffTaxFilingCard from '../../../../components/staff-tax-filing-card.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

/**
 * Platform-wide staff settings (AGL-2486).
 *
 * The free-workspace ceiling (AGL-2265) shipped at the top of the
 * Organizations LIST, above the table, because that is the screen that raises
 * the question it answers. It is still a setting over the whole platform, and
 * a global lever on a browse screen reads as though it applied to whatever
 * the list is showing. This tab is the coherent home for it, and for the
 * platform-wide settings that follow.
 *
 * The control itself is unchanged and so is its authority: reading is open to
 * any staff role, SETTING is `super`, both enforced by
 * `/api/admin/free-workspace-cap` — which is also what writes the audit
 * entry. Moving the card moved no gate and no audit.
 *
 * The sales-tax filing configuration (AGL-2021) follows the same shape one
 * card down, and for the same reason the ceiling does: a business registering
 * in a new state is an operator action, and it used to require an environment
 * edit and a redeploy.
 */
const AdminSettings: NextPageWithLayout<Record<string, never>> = () => {
  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Platform settings', href: buildRoute(Route.ADMIN_SETTINGS) },
      ]}
      help={{ topic: 'staffConsole', anchor: '#free-workspace-limit' }}
      header={{
        children: 'Platform Settings',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <Typography variant="body2" color="text.secondary">
              {'Settings that describe the platform rather than one ' +
                'organization. Every change here is audited to adminAudit ' +
                'with the reason given for it.'}
            </Typography>
            <StaffFreeWorkspaceCapCard />
            <StaffTaxFilingCard />
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminSettings.displayName = 'Page:AdminSettings'

export default AdminSettings
