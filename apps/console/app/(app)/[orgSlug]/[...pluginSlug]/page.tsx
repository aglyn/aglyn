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

import {
  checkEntitlement,
  resolveConsoleOrgPluginPage,
  type ReleaseFlagKey,
} from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Box, CircularProgress } from '@mui/material'
import { notFound, useParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useMemo } from 'react'
import ConsoleMediaPickerProvider from '../../../../components/console-media-picker-provider.component'
import { useEnabledPluginIds } from '../../../../components/console-plugins-gate.component'
import FeatureGate from '../../../../components/feature-gate.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import PluginHubRail from '../../../../components/plugin-hub-rail.component'
import { resolveDocsHelpTopic } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useConsoleRoutePlugins } from '../../../../hooks/use-console-plugins'
import useCurrentOrg from '../../../../hooks/use-current-org'
import useOrgHosts from '../../../../hooks/use-org-hosts'
import useOrgPermissions from '../../../../hooks/use-org-permissions'
import { useOrgReach } from '../../../../hooks/use-org-reach'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import { useReleaseFlags } from '../../../../hooks/use-release-flags'
import {
  blockedExtensionNotice,
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
  resolveUpgradeNoticeAnchor,
  upgradeNoticeMessage,
} from '../../../../utils/extension-entitlement'
import {
  refusedExtensionNotice,
  requiredExtensionPermissions,
  resolveExtensionPermission,
} from '../../../../utils/extension-permission'
import { resolveOrgMount } from '../../../../utils/org-mount'
import {
  orgPluginScopedNotice,
  resolveOrgPluginReach,
} from '../../../../utils/org-plugin-surfaces'
import {
  hubLandingHref,
  releaseFlagForNavTab,
  resolveHubSections,
} from '../../../../utils/plugin-hub-sections'

/** `children` behind `flag`, or plain when the surface declares no flag. */
function wrapInGate(
  flag: ReleaseFlagKey | undefined,
  children: JSX.Element,
): JSX.Element {
  return flag ? <FeatureGate flag={flag}>{children}</FeatureGate> : children
}

/**
 * THE GENERIC ORGANIZATION-LEVEL PLUGIN ROUTE (AGL-2974).
 *
 * `/[orgSlug]/<href>[/<section>[/…]]`: every surface an extension declares in
 * `orgNavItems`, resolved by `resolveConsoleOrgPluginPage` and mounted with NO
 * SITE — `hostId: null` and an `orgMount` naming the organization and its
 * sites. The org twin of the site route at
 * `/[orgSlug]/hosts/[host]/[...pluginSlug]`, applying the same gates in the
 * same order: the release flag through the nav item's tab id, the
 * extension's permission, and its entitlement, with the section's own flags
 * inside the surface's. Every named org route (`/hosts`, `/team`, `/crm`, …)
 * wins over this dynamic segment, so only an unclaimed org sub-path reaches
 * it.
 *
 * What it adds over the site route is REACH, checked before anything else:
 * a surface with no site has no scope to narrow a site collaborator to, so a
 * scoped member is refused before the plugin chunk downloads — the rule the
 * CRM's own org route (`/[orgSlug]/crm`, AGL-2630) states for itself. That
 * route stays a page of its own; this one is what every other organization
 * surface gets without one.
 *
 * An unresolved URL is refused by segment count, as on the site route: one
 * segment names a surface (a live bookmark into a plugin this workspace does
 * not run), which gets the notice; more than one is a path, which 404s.
 */
const OrgPluginPage: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ pluginSlug?: string | string[] }>()
  const orgSlug = useOrgSlug()
  const router = useRouter()
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const orgId = currentOrg?.$id
  const { org, ready: orgReady } = useCurrentOrg()
  const {
    permissions,
    can: canOrgPermission,
    loaded: permissionsLoaded,
  } = useOrgPermissions()
  const { orgWide, ready: reachReady } = useOrgReach()
  const reach = resolveOrgPluginReach({ orgWide, reachReady })

  const segments = useMemo(() => {
    const raw = params?.pluginSlug
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean)
  }, [params?.pluginSlug])
  const pluginHref = segments.length ? `/${segments.join('/')}` : ''

  // Scoped to this workspace's plugins (AGL-758): the registry is a
  // session-wide union, and an org that has not enabled a plugin must not be
  // served its page.
  const enabledPluginIds = useEnabledPluginIds()
  /*
   * The plugins that declare this organization route, loaded before it is
   * resolved (AGL-3142) — the org twin of the site route's own load, and for
   * the same reason: `resolveConsoleOrgPluginPage` reads a registry
   * `register()` fills, so a plugin whose code has not landed is
   * indistinguishable from one this workspace does not have. Read from the
   * href against each plugin's declared `orgRoutes`, never from a list of
   * plugin ids this page holds.
   */
  const routePluginsLoaded = useConsoleRoutePlugins(pluginHref, 'org')
  const resolved = useMemo(
    () =>
      pluginHref
        ? resolveConsoleOrgPluginPage(pluginHref, enabledPluginIds)
        : undefined,
    [pluginHref, enabledPluginIds],
  )
  const unresolvedIsNotFound =
    routePluginsLoaded && !resolved && segments.length > 1

  const releaseFlag = releaseFlagForNavTab(resolved?.navItem.navTabId)
  const sectionReleaseFlag = releaseFlagForNavTab(resolved?.section?.navTabId)
  const { flags, ready: releaseFlagsReady, isStaff } = useReleaseFlags()
  // `released`, deliberately not `visible` (AGL-1662): the staff bypass must
  // not move a billing claim.
  const releaseFlagVerdict = useMemo(
    () =>
      releaseFlag
        ? { released: flags[releaseFlag].released, ready: releaseFlagsReady }
        : undefined,
    [releaseFlag, flags, releaseFlagsReady],
  )

  /** The surface's own absolute path — the nav item's href under this org. */
  const basePath = useMemo(
    () =>
      resolved
        ? buildRoute(Route.ORG_PLUGIN, {
            orgSlug,
            pluginSlug: resolved.navItem.href.replace(/^\//, ''),
          })
        : undefined,
    [resolved, orgSlug],
  )
  const resolvedSections = useMemo(
    () =>
      resolveHubSections(resolved?.navItem.sections, basePath, {
        flags,
        isStaff,
        org,
        orgReady,
        featureFlag: resolved?.extension.featureFlag,
      }),
    [resolved, basePath, flags, isStaff, org, orgReady],
  )

  /*
   * Replaced rather than served: a LEGACY href (the page moved) and a bare
   * hub URL (it names no section). Both are held until the org settles,
   * because a landing is a claim about the plan (AGL-2851), and both are here
   * rather than in the plugin page, which is `lazy()` and could not redirect
   * before its chunk had downloaded and mounted.
   */
  const legacyRedirect =
    resolved?.legacy && basePath
      ? resolved.segments.length
        ? `${basePath}/${resolved.segments.join('/')}`
        : orgReady
          ? (hubLandingHref(resolvedSections) ?? basePath)
          : undefined
      : undefined
  const sectionRedirect =
    legacyRedirect ??
    (resolved && !resolved.section && resolvedSections?.length && orgReady
      ? hubLandingHref(resolvedSections)
      : undefined)
  useEffect(() => {
    if (sectionRedirect) router.replace(sectionRedirect)
  }, [sectionRedirect, router])

  /*
   * The organization's sites, for the mount. Withheld until reach admits the
   * reader: `undefined` holds the hook off, so a refusal costs no read.
   */
  const orgHosts = useOrgHosts(
    firestore,
    user?.uid,
    reach === 'granted' && resolved && orgId ? orgId : undefined,
  )
  const orgMount = useMemo(
    () =>
      resolveOrgMount({
        orgId,
        orgSlug,
        hosts: orgHosts.hosts,
        hostsReady: orgHosts.ready,
      }),
    [orgId, orgSlug, orgHosts.hosts, orgHosts.ready],
  )

  // After every hook: `notFound()` throws, and the hook order must not
  // depend on the URL.
  if (unresolvedIsNotFound) notFound()

  const entitled = resolved?.extension.featureFlag
    ? checkEntitlement(org, resolved.extension.featureFlag)
    : true
  const extensionEntitlement = resolveExtensionEntitlement(
    resolved?.extension.featureFlag,
    org,
    orgReady,
  )
  const surfaceEntitlement = composeExtensionEntitlements(
    extensionEntitlement,
    resolveExtensionEntitlement(resolved?.section?.featureFlag, org, orgReady),
  )
  const extensionPermission = resolveExtensionPermission(
    requiredExtensionPermissions(resolved?.extension, resolved?.navItem),
    { can: canOrgPermission, permissions, loaded: permissionsLoaded },
  )

  const header = resolved?.navItem.header
  const title = header?.title ?? resolved?.navItem.label ?? 'Not found'
  const PluginComponent = resolved?.navItem.Component
  const upgradeAnchor = resolveUpgradeNoticeAnchor(
    resolved?.extension.upgradeNotice,
  )
  const activeSection = resolved?.section
  const depthBelowSurface = resolved?.segments?.length ?? 0
  const activeSectionPath =
    activeSection && basePath ? `${basePath}/${activeSection.id}` : undefined

  const body = sectionRedirect || !routePluginsLoaded ? (
    // On a redirect, not the plugin page: it would open a section's listens
    // for a URL that is already being replaced. And while the route's own
    // plugins are still loading there is no page to mount yet, where an
    // absent one is exactly what the notice below claims is uninstalled
    // (AGL-3142).
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : !PluginComponent ? (
    <Alert severity="warning">
      {"This page isn't available. It may have moved or the feature that " +
        'provided it is not installed.'}
    </Alert>
  ) : reach === 'pending' ||
    !orgReady ||
    !permissionsLoaded ||
    extensionPermission === 'pending' ? (
    // Nothing renders off a guess: reach fails open and the permission map
    // loads permissive (AGL-2474), and an unsettled org is not a plan
    // (AGL-1380).
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : reach === 'refused' ? (
    <Alert severity="info">{orgPluginScopedNotice(title)}</Alert>
  ) : extensionPermission === 'refused' ? (
    // Before the entitlement branch: a reader who may not open the surface
    // is not shown its upgrade path.
    <Alert severity="warning">{refusedExtensionNotice(title)}</Alert>
  ) : surfaceEntitlement === 'blocked' ? (
    <PluginHubRail sections={resolvedSections}>
      <Alert
        severity="info"
        action={
          orgSlug ? (
            <AppLink
              componentVariant="button"
              size="small"
              color="inherit"
              href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug })}${
                upgradeAnchor ? `#${upgradeAnchor}` : ''
              }`}
            >
              {upgradeAnchor === 'addons' ? 'View add-ons' : 'View plans'}
            </AppLink>
          ) : undefined
        }
      >
        {extensionEntitlement === 'blocked'
          ? upgradeNoticeMessage(
              resolved?.extension.upgradeNotice,
              title,
              resolved?.extension.featureFlag,
            )
          : blockedExtensionNotice(
              resolved?.section?.label ?? title,
              resolved?.section?.featureFlag,
            )}
      </Alert>
    </PluginHubRail>
  ) : (
    <Suspense
      fallback={
        <Box sx={{ p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      }
    >
      {/*
        The organization's shared library, with no site's private one beside
        it, as on the CRM's org route (AGL-2662): a surface about every site
        offers the assets every site can already see.
      */}
      <ConsoleMediaPickerProvider orgId={orgId}>
        <PluginComponent
          hostId={null}
          orgMount={orgMount}
          entitled={entitled}
          org={org}
          permissions={permissions}
          releaseFlag={releaseFlagVerdict}
          basePath={basePath}
          sections={resolvedSections}
          section={resolved?.section?.id}
          segments={resolved?.segments}
        />
      </ConsoleMediaPickerProvider>
    </Suspense>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: title,
          ...(depthBelowSurface > 0 && basePath ? { href: basePath } : {}),
        },
        ...(activeSection
          ? [
              {
                children: activeSection.label,
                ...(depthBelowSurface > 1 && activeSectionPath
                  ? { href: activeSectionPath }
                  : {}),
              },
            ]
          : []),
      ]}
      help={resolveDocsHelpTopic(header?.docsTopic, 'plugins')}
      header={{
        children: title,
        secondary: activeSection?.label,
        icon: { path: header?.icon?.path ?? ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {/* Two gates, nested, never swapped — the section's inside the surface's. */}
        {wrapInGate(releaseFlag, wrapInGate(sectionReleaseFlag, body))}
      </Container>
    </DashboardLayout>
  )
}
OrgPluginPage.displayName = 'Page:OrgPluginPage'

export default OrgPluginPage
