/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import { ICON_VARIANT_HOME } from '@aglyn/shared-data-enums'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import { Box, Stack } from '@mui/material'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useParams } from 'next/navigation'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import HostAnalyticsCard from '../../../../../components/analytics/host-analytics-card.component'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import DashboardCustomizeButton from '../../../../../components/dashboard-customize-button.component'
import DashboardWidgetPrefsProvider, {
  useDashboardWidgetPrefs,
} from '../../../../../components/dashboard-widget-prefs.context'
import HostDisplayNameComponent from '../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import {
  HOST_ANALYTICS_WIDGET_ID,
  isDashboardWidgetHidden,
} from '../../../../../utils/dashboard-widgets'

/**
 * The dashboard body, inside the arrangement provider so the header's
 * customize button and every widget slot read one preference from one read.
 */
function HostDashboard() {
  const params = useParams<{ hostId: string }>()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const hostId = useHostId()
  const { prefs, ready: prefsReady } = useDashboardWidgetPrefs()
  const showAnalytics =
    prefsReady && !isDashboardWidgetHidden(prefs, HOST_ANALYTICS_WIDGET_ID)

  return (
    <DashboardLayout
      help="consoleTour"
      header={{
        children: 'My Dashboard',
        icon: { path: ICON_VARIANT_HOME.path },
      }}
      /*
       * The `Visit site` button the console mockup puts in this header
       * (AGL-2166). The dashboard had no `headerRight` at all, so the only
       * route from a site's own dashboard to the site itself was back out
       * to the Sites list and in through a card action.
       *
       * `?aglyn-edit` arms the admin bar, matching the Sites list's Visit
       * link — an editor arriving from the console is an editor, and on a
       * foreign custom domain no other hint can exist (AGL-1842).
       */
      headerRight={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <DashboardCustomizeButton />
          {host ? (
            <AppLink
              componentVariant="button"
              variant="contained"
              color="primary"
              href={`https://${host}.${TENANT_APEX}/?aglyn-edit`}
              target="_blank"
              rel="nofollow"
            >
              {'Visit site'}
            </AppLink>
          ) : null}
        </Stack>
      }
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
        },
      ]}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={3}>
          {/*
            Glanceable widgets (AGL-352/353): summaries only — the Users and
            Analytics sections own the deep views.

            Traffic spans the container. It is the widest card the console
            has — six figures, a bar per day of the selected range, and four
            ranked breakdowns — and at half a page the figures wrapped into a
            ragged block, ninety bars shared one column's width, and the
            breakdowns stacked into a scroll. It is also the card everything
            below is read against.

            Held until the arrangement arrives, and then drawn only if this
            reader kept it. No plugin owns site analytics and no entitlement
            gates it, so the card is not in the widget registry — but hiding
            is a preference rather than an entitlement, and it reads the same
            stored ids the slots do.
           */}
          {showAnalytics ? (
            <HostAnalyticsCard
              hostId={hostId}
              viewAllHref={buildRoute(Route.HOST_ANALYTICS, { orgSlug,  host })}
            />
          ) : null}
          {/*
            The capability row: one card per thing this site actually does,
            each registered by the plugin that owns it rather than imported
            here (AGL-433).

            A GRID rather than grid ITEMS, because the shell does not know
            how many cards there are — a slot renders every widget the
            workspace has enabled, and a plugin with nothing to say renders
            nothing at all. Items would have had to declare a width per slot,
            which puts every card a slot holds into one column: four
            capability cards stacked beside one commerce card. Grid children
            need no such declaration, and a widget that renders null occupies
            no track.

            `start` keeps a three-line card from being stretched to the
            height of a five-row one beside it.
           */}
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              alignItems: 'start',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(2, minmax(0, 1fr))',
              },
            }}
          >
            <PluginWidgetSlot slot="commerceGlance" hostId={hostId} />
            <PluginWidgetSlot
              slot={CONSOLE_WIDGET_SLOTS.hostDashboard}
              hostId={hostId}
            />
          </Box>
          {/* Announcement bar + popup moved to /marketing (AGL-251);
              components, products, variables and functions to their own
              pages (AGL-250); workflows to /workflows (AGL-128); datasets
              to /data (AGL-132); site users to /users (AGL-350). */}
          <PluginWidgetSlot
            slot="hostActivity"
            hostId={hostId}
            viewAllHref={`${buildRoute(Route.HOST_SETUP, { orgSlug,  host })}?tab=activity`}
          />
          {/* Plugin zone (AGL-433): widgets registered for dashboardFooter. */}
          <PluginWidgetSlot slot="dashboardFooter" hostId={hostId} />
        </Stack>
      </Container>
    </DashboardLayout>
  )
}
HostDashboard.displayName = 'HostDashboard'

const Index: NextPageWithLayout<Record<string, never>> = () => (
  <DashboardWidgetPrefsProvider>
    <HostDashboard />
  </DashboardWidgetPrefsProvider>
)
Index.displayName = 'Page:Index'

export default Index
