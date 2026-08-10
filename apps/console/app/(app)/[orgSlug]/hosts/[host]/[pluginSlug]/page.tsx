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

import { checkEntitlement, RELEASE_FLAGS, type ReleaseFlagKey } from '@aglyn/aglyn'
import { resolveConsolePluginPage } from '@aglyn/aglyn'
import { useEnabledPluginIds } from '../../../../../../components/console-plugins-gate.component'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Box, CircularProgress } from '@mui/material'
import { useParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import ConsoleMediaPickerProvider from '../../../../../../components/console-media-picker-provider.component'
import FeatureGate from '../../../../../../components/feature-gate.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { resolveDocsHelpTopic } from '../../../../../../constants/docs-links'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * Generic host route for plugin-contributed pages (AGL-394). Any feature
 * plugin that registers a ConsoleExtension nav item with a `Component`
 * renders here — the console shell owns auth, chrome, and gating, so the
 * plugin needs no page file of its own. Named routes (setup, media, …)
 * still win over this dynamic segment; only unclaimed host sub-paths reach
 * it, and an unregistered slug renders a not-found notice.
 *
 * The Events page is the reference org of this route: it comes entirely
 * from the events-calendar plugin.
 */
const HostPluginPage: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ hostId: string; pluginSlug: string }>()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const hostId = useHostId()
  const pluginSlug = params?.pluginSlug ?? ''
  const { org, ready: orgReady } = useCurrentOrg()
  const { permissions } = useOrgPermissions()

  // Scoped to this workspace's plugins (AGL-758): the registry is a
  // session-wide union, so an unscoped lookup would serve a page from a
  // plugin the current org has not enabled.
  const enabledPluginIds = useEnabledPluginIds()
  const resolved = useMemo(
    () =>
      pluginSlug
        ? resolveConsolePluginPage(`/${pluginSlug}`, enabledPluginIds)
        : undefined,
    [pluginSlug, enabledPluginIds],
  )

  // The release flag governing this surface, keyed by the nav item's tab id
  // (same gate the nav strip applies), so deep links leak nothing.
  const releaseFlag = useMemo<ReleaseFlagKey | undefined>(() => {
    const navTabId = resolved?.navItem.navTabId
    if (!navTabId) return undefined
    return RELEASE_FLAGS.find((flag) => flag.navTabId === navTabId)?.key
  }, [resolved])

  const entitled = resolved?.extension.featureFlag
    ? checkEntitlement(org, resolved.extension.featureFlag)
    : true

  const header = resolved?.navItem.header
  const title = header?.title ?? resolved?.navItem.label ?? 'Not found'
  const PluginComponent = resolved?.navItem.Component

  const body = !PluginComponent ? (
    <Alert severity="warning">
      {"This page isn't available. It may have moved or the feature that " +
        'provided it is not installed.'}
    </Alert>
  ) : !orgReady ? (
    // The choke point for every plugin console page (AGL-1380). `org` is
    // undefined both while the billing doc is in flight and while the read is
    // failing, and `checkEntitlement(undefined)` answers NO — so this route
    // handed every plugin page an `entitled={false}` that is a guess, and the
    // raw `org` besides, which each card re-checks the same way. Twelve
    // surfaces then told a paying org the feature it bought is not on its
    // plan. Nothing renders a plan claim until there is a plan to claim from.
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : (
    <Suspense
      fallback={
        <Box sx={{ p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      }
    >
      <ConsoleMediaPickerProvider hostId={hostId}>
        <PluginComponent
          hostId={hostId}
          entitled={entitled}
          org={org}
          permissions={permissions}
        />
      </ConsoleMediaPickerProvider>
    </Suspense>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
        },
        { children: title },
      ]}
      // The surface's own docs page, not the marketplace's (AGL-1074). One
      // route renders every plugin page, so a hardcoded topic here told
      // twelve different surfaces they were about Plugins & Marketplace.
      help={resolveDocsHelpTopic(header?.docsTopic, 'plugins')}
      header={{
        children: title,
        icon: { path: header?.icon?.path ?? ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {releaseFlag ? <FeatureGate flag={releaseFlag}>{body}</FeatureGate> : body}
      </Container>
    </DashboardLayout>
  )
}
HostPluginPage.displayName = 'Page:HostPluginPage'

export default HostPluginPage
