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
  RELEASE_FLAGS,
  type ReleaseFlagKey,
} from '@aglyn/aglyn'
import { resolveConsolePluginPage } from '@aglyn/aglyn'
import { useEnabledPluginIds } from '../../../../../../components/console-plugins-gate.component'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Box, CircularProgress } from '@mui/material'
import { notFound, useParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useMemo } from 'react'
import ConsoleMediaPickerProvider from '../../../../../../components/console-media-picker-provider.component'
import FeatureGate from '../../../../../../components/feature-gate.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { resolveDocsHelpTopic } from '../../../../../../constants/docs-links'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import {
  resolveExtensionEntitlement,
  resolveUpgradeNoticeAnchor,
  upgradeNoticeMessage,
} from '../../../../../../utils/extension-entitlement'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'
import { useReleaseFlags } from '../../../../../../hooks/use-release-flags'

/** `children` behind `flag`, or plain when the surface declares no flag. */
function wrapInGate(
  flag: ReleaseFlagKey | undefined,
  children: JSX.Element,
): JSX.Element {
  return flag ? <FeatureGate flag={flag}>{children}</FeatureGate> : children
}

/**
 * Generic host route for plugin-contributed pages (AGL-394), section by
 * section (AGL-2501). Any feature plugin that registers a ConsoleExtension nav
 * item with a `Component` renders here — the console shell owns auth, chrome,
 * and gating, so the plugin needs no page file of its own. Named routes
 * (setup, media, …) still win over this dynamic segment; only unclaimed host
 * sub-paths reach it, and an unregistered slug renders a not-found notice.
 *
 * A CATCH-ALL segment since AGL-2501, so a surface can be a hub of real URLs:
 * `/products/orders` is the Products nav item's `orders` section, resolved by
 * the same registry lookup and handed to the page as `section`. A nav item
 * that declares no sections is matched exactly as it always was, so the
 * widened route shape is invisible to every plugin written before it.
 *
 * The Events page is the reference org of this route: it comes entirely
 * from the events-calendar plugin.
 */
const HostPluginPage: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ hostId: string; pluginSlug: string | string[] }>()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
  const hostId = useHostId()
  // `string[]` from the catch-all; `useParams` types it either way because a
  // user can type any URL, and the single-segment form is still the common one.
  const segments = useMemo(() => {
    const raw = params?.pluginSlug
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean)
  }, [params?.pluginSlug])
  const pluginHref = segments.length ? `/${segments.join('/')}` : ''
  const { org, ready: orgReady } = useCurrentOrg()
  const { permissions, loaded: permissionsLoaded } = useOrgPermissions()

  // Scoped to this workspace's plugins (AGL-758): the registry is a
  // session-wide union, so an unscoped lookup would serve a page from a
  // plugin the current org has not enabled.
  const enabledPluginIds = useEnabledPluginIds()
  const resolved = useMemo(
    () =>
      pluginHref
        ? resolveConsolePluginPage(pluginHref, enabledPluginIds)
        : undefined,
    [pluginHref, enabledPluginIds],
  )

  /*
   * How an unresolved URL is refused, and why it depends on the segment count.
   *
   * ONE segment names a surface. `/products` on a workspace without commerce
   * is a live bookmark into a plugin that is disabled or uninstalled, and the
   * notice below says exactly that — the true and useful answer, and the
   * behavior this route has always had.
   *
   * MORE than one is a path, and a path that resolves to nothing is a 404.
   * That covers both cases the catch-all introduced: a typo'd section under a
   * surface that IS installed (rendering its default section instead is how
   * someone reports "it opened the wrong page"), and an unmatched path under a
   * NAMED route — `/setup/bogus` reaches this file now, where it used to be a
   * plain 404, and Setup is a core page that no plugin provides or could.
   */
  const unresolvedIsNotFound = !resolved && segments.length > 1

  // The release flag governing this surface, keyed by the nav item's tab id
  // (same gate the nav strip applies), so deep links leak nothing.
  const releaseFlag = useMemo<ReleaseFlagKey | undefined>(() => {
    const navTabId = resolved?.navItem.navTabId
    if (!navTabId) return undefined
    return RELEASE_FLAGS.find((flag) => flag.navTabId === navTabId)?.key
  }, [resolved])

  /*
   * The flag governing the SECTION, when it declares one of its own (AGL-2501).
   *
   * Applied INSIDE the surface's gate below rather than instead of it, so the
   * two compose: a section of a flagged-off surface stays refused whatever it
   * declares, and a section can only ever be narrower than the page holding
   * it. Sections that declare nothing inherit the surface's gate by simply
   * being inside it — which is the common case and needs no code here.
   *
   * The rail is filtered from the same verdict a few lines down, so a section
   * this refuses is not offered: one answer, drawn and enforced.
   */
  const sectionReleaseFlag = useMemo<ReleaseFlagKey | undefined>(() => {
    const navTabId = resolved?.section?.navTabId
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
  const { flags, ready: releaseFlagsReady, isStaff } = useReleaseFlags()
  const releaseFlagVerdict = useMemo(
    () =>
      releaseFlag
        ? { released: flags[releaseFlag].released, ready: releaseFlagsReady }
        : undefined,
    [releaseFlag, flags, releaseFlagsReady],
  )

  /**
   * The surface's own absolute path — the nav item's href under this org and
   * site, which is where the section rail links from. Built from the NAV
   * ITEM's href rather than from the URL so it is the surface root on a
   * section route too.
   */
  const basePath = useMemo(() => {
    if (!resolved) return undefined
    return buildRoute(Route.HOST_PLUGIN, {
      orgSlug,
      host,
      pluginSlug: resolved.navItem.href.replace(/^\//, ''),
    })
  }, [resolved, orgSlug, host])

  /**
   * The declared sections with the shell's answers filled in: an absolute
   * href, and the release verdict this viewer gets.
   *
   * `visible` is `released || isStaff`, the same reading `FeatureGate` uses,
   * so the rail offers exactly what the gate below admits. A plugin cannot
   * compute this for itself — release flags are `scope:app` — and a rail that
   * guessed would link into the shell's own "coming soon" notice.
   */
  const resolvedSections = useMemo(() => {
    const sections = resolved?.navItem.sections
    if (!sections?.length || !basePath) return undefined
    return sections.map((section) => {
      const flagKey = section.navTabId
        ? RELEASE_FLAGS.find((flag) => flag.navTabId === section.navTabId)?.key
        : undefined
      return {
        id: section.id,
        label: section.label,
        href: `${basePath}/${section.id}`,
        visible: flagKey ? flags[flagKey].released || isStaff : true,
      }
    })
  }, [resolved, basePath, flags, isStaff])

  /**
   * Where a bare hub URL goes, when the nav item has sections and the URL
   * names none (AGL-2501).
   *
   * The FIRST VISIBLE section, which is the rule: a hub's landing section is
   * the first one in its rail that this reader may open. Skipping past a
   * flagged-off first section matters — redirecting to one the gate below
   * would refuse answers the nav tab with a "coming soon" notice.
   *
   * Held HERE rather than in each plugin page, and that is the whole point.
   * Plugin pages are `lazy()`, so a redirect inside one cannot fire until its
   * chunk has downloaded and mounted — the reader watches an empty main area
   * for a bundle that is about to be thrown away. The shell already knows the
   * answer from the registry, before any of that.
   *
   * Still a client redirect, unavoidably: the registry is a client-side
   * module-global, so no server component can resolve which sections exist.
   * The nav strip therefore links straight to the landing section (see
   * `hostNavTabItems`), leaving this for typed and bookmarked bare URLs.
   */
  const sectionRedirect =
    resolved && !resolved.section && resolvedSections?.length
      ? resolvedSections.find((section) => section.visible)?.href
      : undefined

  useEffect(() => {
    if (sectionRedirect) router.replace(sectionRedirect)
  }, [sectionRedirect, router])

  /*
   * The 404, after every hook and before anything renders (AGL-2501).
   *
   * `notFound()` throws, so calling it where the check reads most naturally —
   * beside the resolver, at the top — would skip every hook below it and put
   * this component's hook order at the mercy of the URL. Held here instead:
   * the answer is the same, and the hook list is not a function of the path.
   */
  if (unresolvedIsNotFound) notFound()

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
  // Validated here and used only by the refusal below. A bare fragment id,
  // never a URL: whatever the extension named, the link it decorates is one
  // this file builds from `Route.MANAGE_BILLING`.
  const upgradeAnchor = resolveUpgradeNoticeAnchor(
    resolved?.extension.upgradeNotice,
  )
  const activeSection = resolved?.section

  const body = sectionRedirect ? (
    // Deliberately NOT the plugin page. Mounting it here would download its
    // chunk and open its first section's listens for a URL that is already
    // being replaced — the exact read this hub's meter exists to refuse.
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : !PluginComponent ? (
    <Alert severity="warning">
      {"This page isn't available. It may have moved or the feature that " +
        'provided it is not installed.'}
    </Alert>
  ) : !orgReady || !permissionsLoaded ? (
    // The choke point for every plugin console page (AGL-1380). `org` is
    // undefined both while the billing doc is in flight and while the read is
    // failing, and `checkEntitlement(undefined)` answers NO — so this route
    // handed every plugin page an `entitled={false}` that is a guess, and the
    // raw `org` besides, which each card re-checks the same way. Twelve
    // surfaces then told a paying org the feature it bought is not on its
    // plan. Nothing renders a plan claim until there is a plan to claim from.
    //
    // `permissionsLoaded` joins it for the same reason, in the other
    // direction. The `permissions` prop below is `useOrgPermissions`'
    // fail-open map — an ADMIN's, with every plugin-declared key true — until
    // the member read lands, and a plugin page cannot tell that from a real
    // grant. The commerce POS reads `permissions?.managePos !== false` and so
    // painted the whole register for a member about to be refused it: the
    // site's product catalog with prices, the cart, the tender buttons, and a
    // room-charge dialog listing checked-in GUESTS BY NAME. Held here rather
    // than patched in the POS page, because this is the one place that knows
    // whether the map is an answer, and every plugin page is handed the same
    // map. A guess about who is reading is no more renderable than a guess
    // about what they bought.
    <Box sx={{ p: 2 }}>
      <CircularProgress size={24} />
    </Box>
  ) : extensionEntitlement === 'blocked' ? (
    // Refused by the shell, not by the plugin — and refused with the upgrade
    // path attached, because the surface behind this notice is the only
    // place most workspaces ever go looking for the feature. The nav entry
    // is deliberately left in place for the same reason: hiding the tab
    // would hide the way to buy it.
    //
    // The words may be the extension's (AGL-2484). `blockedExtensionNotice`
    // is derived from the plan tables and so is right about every feature
    // unprompted, but the tables carry no price and no billing card, so an
    // extension that knows its own terms may say them instead. Both are read
    // HERE — after `extensionEntitlement` has already answered, from the org
    // doc and the flag alone. An extension cannot reach the verdict, only
    // the phrasing of one that went against it, and
    // `resolveUpgradeNoticeAnchor` keeps the destination on this route no
    // matter what it names.
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
      {upgradeNoticeMessage(
        resolved?.extension.upgradeNotice,
        title,
        resolved?.extension.featureFlag,
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
      <ConsoleMediaPickerProvider hostId={hostId}>
        <PluginComponent
          hostId={hostId}
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
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        // The surface, linked once a section is open beneath it, so the trail
        // walks back rather than dead-ending on the level the reader is on.
        {
          children: title,
          ...(activeSection && basePath ? { href: basePath } : {}),
        },
        // The section the reader is actually on (AGL-2501), following the hubs
        // that already migrated: without it the trail names every level except
        // theirs — the one that says where they are.
        ...(activeSection ? [{ children: activeSection.label }] : []),
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
        {/*
          Two gates, nested, never swapped (AGL-2501). The section's own flag
          sits INSIDE the surface's, so a section is refused whenever its page
          is — the surface's gate cannot be escaped by a section declaring a
          released flag of its own. A section that declares nothing is gated by
          the surface simply by being inside it.
        */}
        {wrapInGate(releaseFlag, wrapInGate(sectionReleaseFlag, body))}
      </Container>
    </DashboardLayout>
  )
}
HostPluginPage.displayName = 'Page:HostPluginPage'

export default HostPluginPage
