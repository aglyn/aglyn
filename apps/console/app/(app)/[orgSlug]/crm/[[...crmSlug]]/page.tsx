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
  resolveConsolePluginPage,
  type ConsolePluginOrgMount,
  type ReleaseFlagKey,
} from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Box, CircularProgress } from '@mui/material'
import { notFound, useParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useMemo } from 'react'
import { useEnabledPluginIds } from '../../../../../components/console-plugins-gate.component'
import FeatureGate from '../../../../../components/feature-gate.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { resolveDocsHelpTopic } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import useCurrentOrg from '../../../../../hooks/use-current-org'
import useOrgHosts from '../../../../../hooks/use-org-hosts'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'
import { useOrgReach } from '../../../../../hooks/use-org-reach'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import { useReleaseFlags } from '../../../../../hooks/use-release-flags'
import {
  blockedExtensionNotice,
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
  resolveUpgradeNoticeAnchor,
  upgradeNoticeMessage,
} from '../../../../../utils/extension-entitlement'
import {
  refusedExtensionNotice,
  requiredExtensionPermissions,
  resolveExtensionPermission,
} from '../../../../../utils/extension-permission'
import {
  orgCrmRefusalNotice,
  resolveOrgCrmAccess,
} from '../../../../../utils/org-crm-access'
import {
  hubLandingHref,
  releaseFlagForNavTab,
  resolveHubSections,
} from '../../../../../utils/plugin-hub-sections'

/** `children` behind `flag`, or plain when the surface declares no flag. */
function wrapInGate(
  flag: ReleaseFlagKey | undefined,
  children: JSX.Element,
): JSX.Element {
  return flag ? <FeatureGate flag={flag}>{children}</FeatureGate> : children
}

/** The hub this route serves — the CRM nav item's own href, under the org. */
const CRM_HREF = '/crm'

/**
 * THE ORGANIZATION-LEVEL CRM HUB (AGL-2630).
 *
 * `/[orgSlug]/crm/<section>[/<recordId>]`: the same hub the site route mounts
 * at `/[orgSlug]/hosts/[host]/crm`, resolved through the same registry,
 * gated by the same release flag, the same entitlements and the same
 * permission — and mounted with NO SITE. The plugin page is handed
 * `hostId: null` and an `orgMount` naming the org and its sites, and every
 * CRM surface resolves its scope from that: an org-wide member reads every
 * site's records at once, and a create names the site it is captured by.
 *
 * ## Why this is a page of its own and not the site route
 *
 * The site route is `/hosts/[host]/…`, and everything under it — the host
 * id provider, the site role, the media picker, the site crumb — presumes a
 * site. This route has none, and pretending otherwise (a synthetic host, a
 * first site picked silently) would put one site's name on a page about all
 * of them. What the two routes SHARE is exactly the part that is not about a
 * site: the resolver, the section rail's verdicts, the entitlement and
 * permission gates, and the redirect rule. Those are functions, imported by
 * both; only the hooks that name a site are absent here.
 *
 * ## The gate in front of everything
 *
 * `resolveOrgCrmAccess` — reach first, permission second. A SCOPED
 * collaborator is refused before the plugin chunk downloads and before any
 * listener opens, because this is the one surface whose listeners carry no
 * scope clause: the Firestore rules refuse them the unfiltered list anyway,
 * and this is the layer that can say WHY. The site hub admits the same
 * collaborator to their own site's CRM, deliberately; the reach requirement
 * is what this surface adds on top.
 *
 * ## The old address
 *
 * `/[orgSlug]/contacts` was a read-only, cross-site address book. It now
 * redirects here, and what it showed — which sites know a person, and their
 * consent per site — is the contacts section's "Known by" column and the
 * record's card at this mount.
 */
const OrgCrmPage: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ crmSlug?: string | string[] }>()
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
    errored: permissionsErrored,
  } = useOrgPermissions()

  /*
   * THE GATE. Reach first, permission second — see `resolveOrgCrmAccess` for
   * why the order is load-bearing and why a permission alone (which a SITE
   * COLLABORATOR holds) is not an org-level check. `OrgGuard` in the parent
   * layout already redirects a scoped collaborator off every org route, and
   * the rules refuse them the unfiltered reads this hub runs; this is the
   * third rail, not the only one, and the one that can explain itself.
   */
  const { orgWide, ready: reachReady } = useOrgReach()
  const access = resolveOrgCrmAccess({
    orgWide,
    reachReady,
    can: canOrgPermission,
    permissionsLoaded,
    permissionsErrored,
  })
  const admitted = access === 'granted'

  // `string[]` from the optional catch-all; `useParams` types it either way
  // because a person can type any URL, and a bare `/crm` has no segments.
  const segments = useMemo(() => {
    const raw = params?.crmSlug
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean)
  }, [params?.crmSlug])
  const pluginHref = segments.length
    ? `${CRM_HREF}/${segments.join('/')}`
    : CRM_HREF

  // Scoped to this workspace's plugins, as the site route is: the registry
  // is a session-wide union, and an org that has not enabled the CRM gets
  // the "not available" notice rather than a page from a plugin it has not
  // turned on.
  const enabledPluginIds = useEnabledPluginIds()
  const resolved = useMemo(
    () => resolveConsolePluginPage(pluginHref, enabledPluginIds),
    [pluginHref, enabledPluginIds],
  )
  /*
   * A path under the hub that resolves to nothing is a 404 — a typo'd
   * section, rendered as the default section instead, is how someone reports
   * "it opened the wrong page". The bare hub with no plugin behind it is the
   * live-bookmark case and gets the notice below.
   */
  const unresolvedIsNotFound = !resolved && segments.length > 0

  // The release flag governing the surface, keyed by the nav item's tab id,
  // and the section's own inside it (AGL-2501) — the gates the site route
  // applies, resolved by the shared lookup.
  const releaseFlag = releaseFlagForNavTab(resolved?.navItem.navTabId)
  const sectionReleaseFlag = releaseFlagForNavTab(resolved?.section?.navTabId)
  const { flags, ready: releaseFlagsReady, isStaff } = useReleaseFlags()
  // The verdict handed DOWN (AGL-1662): `released`, deliberately not
  // `visible` — the staff bypass must not move a billing claim.
  const releaseFlagVerdict = useMemo(
    () =>
      releaseFlag
        ? { released: flags[releaseFlag].released, ready: releaseFlagsReady }
        : undefined,
    [releaseFlag, flags, releaseFlagsReady],
  )

  /** The hub's own absolute path under this org, where the rail links from. */
  const basePath = useMemo(
    () => (resolved ? buildRoute(Route.ORG_CRM, { orgSlug }) : undefined),
    [resolved, orgSlug],
  )
  const resolvedSections = useMemo(
    () =>
      resolveHubSections(resolved?.navItem.sections, basePath, {
        flags,
        isStaff,
        org,
        orgReady,
      }),
    [resolved, basePath, flags, isStaff, org, orgReady],
  )
  /*
   * A bare `/crm` goes to the first section this reader may open — the
   * site route's rule, from the shared helper. Held here rather than in the
   * plugin page for the reason the site route holds it: the page is
   * `lazy()`, and a redirect inside it cannot fire until a chunk about to be
   * thrown away has downloaded and mounted.
   */
  const sectionRedirect =
    resolved && !resolved.section ? hubLandingHref(resolvedSections) : undefined
  useEffect(() => {
    if (sectionRedirect) router.replace(sectionRedirect)
  }, [sectionRedirect, router])

  /*
   * THE ORG'S SITES, for the mount. A record holds host document ids; a
   * console URL takes the subdomain; a person reads the name. Read once
   * here — the reader can already see the org's site list — and handed down
   * so no CRM surface pays a lookup per row. Withheld until the gate admits
   * the reader: `undefined` holds the hook off, so a refusal costs no read.
   */
  const orgHosts = useOrgHosts(
    firestore,
    user?.uid,
    admitted && orgId ? orgId : undefined,
  )
  const orgMount = useMemo<ConsolePluginOrgMount | undefined>(
    () =>
      orgId
        ? {
            orgId,
            hosts: orgHosts.hosts.map((host) => ({
              id: host.$id,
              name:
                (host['displayName'] as string) ||
                (host['subdomain'] as string) ||
                host.$id,
              subdomain: (host['subdomain'] as string | undefined) ?? null,
            })),
            hostsReady: orgHosts.ready,
          }
        : undefined,
    [orgId, orgHosts.hosts, orgHosts.ready],
  )

  /*
   * The 404, after every hook and before anything renders: `notFound()`
   * throws, so calling it beside the resolver would put this component's
   * hook order at the mercy of the URL.
   */
  if (unresolvedIsNotFound) notFound()

  const entitled = resolved?.extension.featureFlag
    ? checkEntitlement(org, resolved.extension.featureFlag)
    : true
  // The gate the shell PROMISES to apply (AGL-2484), composed with the
  // section's own flag (AGL-2611), exactly as the site route composes them.
  const extensionEntitlement = resolveExtensionEntitlement(
    resolved?.extension.featureFlag,
    org,
    orgReady,
  )
  const surfaceEntitlement = composeExtensionEntitlements(
    extensionEntitlement,
    resolveExtensionEntitlement(resolved?.section?.featureFlag, org, orgReady),
  )
  // The same promise for WHO is reading — the extension's declared key,
  // resolved from the member's own map. The org gate above already required
  // it; this keeps the shell's own gate in the chain so a surface that
  // declares a narrower key than the org gate checks is still refused here.
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
  /** How deep beneath the hub this URL goes — see the site route's crumbs. */
  const depthBelowSurface = resolved?.segments?.length ?? 0
  const activeSectionPath =
    activeSection && basePath ? `${basePath}/${activeSection.id}` : undefined

  const body = sectionRedirect ? (
    // Deliberately NOT the plugin page: mounting it would open the first
    // section's listens for a URL that is already being replaced.
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : !PluginComponent ? (
    <Alert severity="warning">
      {"This page isn't available. It may have moved or the feature that " +
        'provided it is not installed.'}
    </Alert>
  ) : access === 'pending' || !orgReady || extensionPermission === 'pending' ? (
    // Nothing renders a plan claim until there is a plan to claim from
    // (AGL-1380), and nothing renders off the permissive loading map
    // (AGL-2474): the reach and the member read both have to have answered.
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : access === 'unavailable' ? (
    <Alert severity="warning">
      {"We couldn't confirm your access to this organization. Reload the " +
        'page, and if it keeps happening sign out and back in.'}
    </Alert>
  ) : access === 'refused' ? (
    <Alert severity="info">
      {orgCrmRefusalNotice(reachReady && !orgWide ? 'scoped' : 'permission')}
    </Alert>
  ) : extensionPermission === 'refused' ? (
    // BEFORE the entitlement branch: a reader who may not open the surface
    // is not shown its upgrade path.
    <Alert severity="warning">{refusedExtensionNotice(title)}</Alert>
  ) : surfaceEntitlement === 'blocked' ? (
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
  ) : (
    <Suspense
      fallback={
        <Box sx={{ p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      }
    >
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
    </Suspense>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        // The hub, linked once anything is open beneath it; the section the
        // reader is on, linked in turn once a record is open inside it. The
        // record itself is published by the surface through
        // `PageHeaderRecord`, and the layout appends it after this trail.
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
      help={resolveDocsHelpTopic(header?.docsTopic, 'contacts')}
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
OrgCrmPage.displayName = 'Page:OrgCrmPage'

export default OrgCrmPage
