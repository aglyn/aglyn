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
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Box, CircularProgress } from '@mui/material'
import FeatureGate from '../../../../components/feature-gate.component'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn'
import useCurrentOrg from '../../../../hooks/use-current-org'

/**
 * Organization Data page (AGL-239): datasets are org-owned (AGL-237 §11)
 * and shared by every site, so their home is the org area — the host
 * Data page shows the same collections in host context.
 */
const OrgData: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Data', href: buildRoute(Route.ORG_DATA, { orgSlug }) },
      ]}
      help="datasets"
      header={{
        children: 'Organization Data',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {!loading && !currentOrg ? (
          <Alert severity="info">
            {'Create your first site to start an organization, or accept ' +
              'a pending invite from your dashboard.'}
          </Alert>
        ) : currentOrg?.$id ? (
          <FeatureGate flag="release_data_store">
            {/*
              The org-scope twin of the plugin-page route gate (AGL-1380).
              `org` is undefined both while the billing doc is in flight and
              while the read is failing, and the datasets editor's Add
              buttons run `checkEntitlement`/`checkDatasetQuota` on it —
              where undefined is not "unknown" but the FREE tier, whose
              dataset and record limits are both zero. A paying org clicking
              Add inside that window was told datasets need a Starter plan.
              Hold until there is a plan to check against.
            */}
            {!orgReady ? (
              <Box sx={{ p: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : !checkEntitlement(org, 'dataStore') ? (
              /*
                AN UNENTITLED ORG SAW A COMPLETELY BLANK PAGE (AGL-1152).
                The Data console extension registers its widgets behind
                `featureFlag: 'dataStore'`, and `free` does not carry it — so
                the registry filtered the extension out, the `orgData` slot
                found no widgets, and the page rendered its header over
                nothing at all. No empty state, no explanation, no upgrade
                path: indistinguishable from the console being broken, which
                is how it was reported.

                It is NOT a plan-less-org bug, though that is where it was
                seen. Any org resolving to `free` gets it, and a plan-less org
                resolves to `free` — so the population is every free workspace.

                Ordered AFTER the `orgReady` hold above deliberately, and that
                hold is what makes this safe: `checkEntitlement(undefined)`
                resolves the FREE tier rather than "unknown", so refusing
                before the billing doc settles would show a paying customer an
                upgrade prompt for a render or two. Same three-state reasoning
                the commerce gate spells out at length.
              */
              <Alert
                severity="info"
                action={
                  orgSlug ? (
                    <AppLink
                      componentVariant="button"
                      color="inherit"
                      size="small"
                      href={`/${orgSlug}/billing`}
                    >
                      {'Upgrade'}
                    </AppLink>
                  ) : undefined
                }
              >
                {
                  'Datasets are shared collections of records — product lists, team directories, anything repeatable — that your sites can bind to and render.'
                }
                {planLabelGrantingFeature('dataStore')
                  ? ` Included from ${planLabelGrantingFeature('dataStore')}.`
                  : null}
              </Alert>
            ) : (
              <PluginWidgetSlot
                slot="orgData"
                orgId={currentOrg.$id}
                org={org}
              />
            )}
          </FeatureGate>
        ) : null}
      </Container>
    </DashboardLayout>
  )
}
OrgData.displayName = 'Page:OrgData'

export default OrgData
