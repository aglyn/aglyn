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
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
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
import { resolveExtensionEntitlement } from '../../../../../../utils/extension-entitlement'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'
import { useReleaseFlags } from '../../../../../../hooks/use-release-flags'

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

  // The same flag's verdict, handed DOWN to the plugin page (AGL-1662).
  //
  // `FeatureGate` below gates on `visible` (`released || isStaff`), so a
  // staff member reaches this page for an org whose flag is off — an org the
  // usage cron is deliberately not billing (AGL-1604). A plugin page that
  // quotes a dollar figure has to follow the flag rather than the viewer, and
  // it cannot ask for itself: the release-flag hooks are `scope:app` and a
  // `scope:lib` plugin may not import them.
  //
  // `released`, deliberately NOT `visible` — the staff bypass must not move a
  // billing claim. Paired with `ready` so a page can withhold the claim
  // entirely until the verdict settles rather than assert the default-off
  // answer for one paint.
  const { flags, ready: releaseFlagsReady } = useReleaseFlags()
  const releaseFlagVerdict = useMemo(
    () =>
      releaseFlag
        ? { released: flags[releaseFlag].released, ready: releaseFlagsReady }
        : undefined,
    [releaseFlag, flags, releaseFlagsReady],
  )

  const entitled = resolved?.extension.featureFlag
    ? checkEntitlement(org, resolved.extension.featureFlag)
    : true

  // The gate the shell PROMISES to apply (AGL-2484). `entitled` above is
  // handed to the extension as a prop, and a prop is advice: an extension
  // that never reads it renders its paid surface in full for an org that
  // has not bought the feature, which is exactly what
  // `workflows-console-page.tsx` did. `ConsoleExtension` is documented as
  // "the shell owns rendering and applies the feature-flag gate, so
  // extensions cannot bypass entitlements" — this line is that sentence.
  //
  // The prop stays. Extensions use it for finer-grained refusals (a save
  // path, one card of several), and the two agree by construction because
  // both resolve from the same flag and the same org doc.
  const extensionEntitlement = resolveExtensionEntitlement(
    resolved?.extension.featureFlag,
    org,
    orgReady,
  )

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
  ) : extensionEntitlement === 'blocked' ? (
    // Refused by the shell, not by the plugin — and refused with the upgrade
    // path attached, because the surface behind this notice is the only
    // place most workspaces ever go looking for the feature. The nav entry
    // is deliberately left in place for the same reason: hiding the tab
    // would hide the way to buy it.
    <Alert
      severity="info"
      action={
        orgSlug ? (
          <AppLink
            componentVariant="button"
            size="small"
            color="inherit"
            href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
          >
            {'View plans'}
          </AppLink>
        ) : undefined
      }
    >
      {`${title} is not included in your current plan. Manage your plan and ` +
        'add-ons from Billing.'}
    </Alert>
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
          releaseFlag={releaseFlagVerdict}
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
