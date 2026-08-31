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
  applyDefaultOffOptIn,
  EnabledPluginsContext,
  filterPluginsByReleaseFlags,
  listConsoleProviders,
  resolveEnabledPlugins,
  subtractDisabledPlugins,
} from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'
import type React from 'react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import BootSplash from './boot-splash.component'
import { consolePluginLoader } from '../constants/console-plugin-loader'
import {
  useHostDisabledPlugins,
  useHostEnabledPlugins,
  useHostId,
} from './host-id-provider'
import useCurrentOrg from '../hooks/use-current-org'
import { useReleaseFlags } from '../hooks/use-release-flags'
import { useUrlNamedOrg, useUrlNamesOrg } from '../hooks/use-url-names-org'
import { loadOrgRealmPlugins } from '../utils/realm-plugins.client'

/**
 * The workspace's EFFECTIVE plugin set (AGL-416/422): the org switchboard
 * minus release-flagged-off plugins (staff keep flagged plugins — the
 * usual staff-preview bypass). Returned as a stable comma key; loading
 * waits for Remote Config activation so a kill-switched plugin never
 * flashes in on the registry defaults.
 */
function useEffectiveEnabledPlugins(): { flagsReady: boolean; enabledKey: string } {
  // EXEMPT from `no-unguarded-loading-hook` (AGL-1422), and the one place in
  // this sweep where adding the gate would be the more dangerous change.
  //
  // `resolveEnabledPlugins` fails OPEN: an undefined `org` yields the DEFAULT
  // plugin set, so the loading window can only ever show MORE than the
  // workspace enabled — never the refusal the rule exists to stop. Folding
  // `ready` into `flagsReady` would put the entire plugin surface (nav,
  // pages, providers, and via `useSitePluginsReady` the besigner canvas)
  // behind the billing doc — and `useConfirmedDoc` leaves `ready` false
  // indefinitely when a MISSING doc's server confirm cannot complete, which
  // is a plausible state for a pre-billing workspace. That trades a
  // cosmetic fail-open for a console with no plugins in it at all.
  //
  // The residue is a beat of the default nav on a cold load, which the
  // BootSplash hold below already covers on a session's first load. Revisit
  // only if `resolveEnabledPlugins` ever stops defaulting.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org } = useCurrentOrg()
  const { ready, isStaff, flags } = useReleaseFlags()
  const enabledKey = filterPluginsByReleaseFlags(
    resolveEnabledPlugins(org),
    (flagKey) => flags[flagKey as keyof typeof flags]?.released ?? true,
    { staffBypass: isStaff },
  ).join(',')
  return { flagsReady: ready, enabledKey }
}

/**
 * The current workspace's effective plugin ids, for scoping reads of the
 * ConsoleExtension registry (AGL-758). The registry is a module-global
 * union across every org visited this session, so any surface that lists
 * nav items, widgets, pages or providers must filter by this set — without
 * it, a plugin enabled for one workspace keeps contributing to the next.
 */
export function useEnabledPluginIds(): string[] {
  const { enabledKey } = useEffectiveEnabledPlugins()
  // Per-site enablement (AGL-1014): inside a host route the site's
  // `disabledPlugins` deny-list is subtracted, so nav tabs, plugin pages
  // and widget slots all read the per-site set. [] off host routes.
  const hostDisabled = useHostDisabledPlugins()
  // The per-site OPT-IN half (AGL-2486). Subtracting a deny-list is the
  // whole story for the twelve ordinary bundles and exactly wrong for a
  // `defaultOffPerSite` one: an absent field means OFF for `accounts`, so a
  // resolver that only ever subtracts reported it as available on every site
  // that had never mentioned it — which is how the besigner went on offering
  // Members blocks for a site whose /signin returns 404.
  //
  // Applied only INSIDE a host route. Off one there is no site to have opted
  // in, and an empty opt-in list would subtract rather than no-op — unlike
  // the deny-list above, where [] already means "narrow nothing". Answering
  // a host question on a page that names no host is what AGL-2486 fixed
  // immediately below for the org set; this keeps the same discipline.
  const hostOptIn = useHostEnabledPlugins()
  const hostId = useHostId()
  // There is no "current workspace's" plugin set on a route that names no
  // workspace (AGL-2486). `useEffectiveEnabledPlugins` reads `useCurrentOrg`,
  // which falls back to a remembered org, so this answered with THAT org's
  // plugins off org routes. The gate below already refuses to LOAD plugins
  // there, but the registry is a session-wide union — so a staff user who
  // visited their own workspace first saw their own entitled widgets on
  // `/admin/orgs/{someone-else}`, a page about a different org entirely.
  // Gating here rather than at each consumer is the same reasoning as the
  // analytics mount gate: a filter every lister must remember to apply is a
  // filter that will eventually be forgotten.
  const namedOrg = useUrlNamedOrg()
  return useMemo(
    () =>
      namedOrg
        ? subtractDisabledPlugins(
            hostId
              ? applyDefaultOffOptIn(
                  enabledKey.split(',').filter(Boolean),
                  hostOptIn,
                )
              : enabledKey.split(',').filter(Boolean),
            hostDisabled,
          )
        : [],
    [enabledKey, hostDisabled, hostOptIn, hostId, namedOrg],
  )
}

/**
 * Dynamic console-plugin activation (AGL-417), replacing the static
 * register-console-plugins composition root: once the org workspace
 * resolves, load + register its enabled plugins' ConsoleExtensions, THEN
 * render the shell — nav items and plugin pages come from the registry, so
 * rendering earlier would drop them. Signed-out surfaces (no org) render
 * immediately; a workspace's first paint waits one cached chunk-load.
 */
export default function ConsolePluginsGate({
  children,
}: {
  children?: ReactNode
}) {
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  const { data: user } = useUser()
  // Only the URL can say which workspace the session belongs to (AGL-1937).
  // See the loading effect below for why this gate is here.
  const namesOrg = useUrlNamesOrg()
  const [readyForOrg, setReadyForOrg] = useState<string | null>(null)
  const { flagsReady, enabledKey } = useEffectiveEnabledPlugins()
  const enabledPluginIds = useEnabledPluginIds()
  // Latches on the first completed load; from then on a workspace switch
  // renders through instead of blanking the tree (AGL-758).
  const hasLoadedOnce = useRef(false)
  if (readyForOrg) hasLoadedOnce.current = true

  useEffect(() => {
    // Nothing loads until the URL names a workspace (AGL-1937).
    //
    // This gate is mounted in `app/providers.tsx`, above EVERY console route
    // — the workspace picker included, which every new signup crosses. On an
    // org-less route `useCurrentOrg().orgId` is the ambient fallback (a
    // remembered selection, else the user's FIRST org), so merely landing on
    // the picker used to `ensure` that org's console chunks, mint an ID token
    // and fetch its trusted-realm marketplace bundles — for a workspace
    // nobody had opened, moments before the user picks a different one.
    //
    // That is not a wasted fetch a later navigation corrects: a loaded chunk
    // cannot unload and the ConsoleExtension registry is a module-global
    // union, so the wrong org's code stays resident for the session.
    //
    // "Don't start on an org-less route" rather than "reload per org": the
    // AGL-758 latch below exists precisely so a workspace switch does not
    // blank the tree, and unloading is not on the table.
    //
    // `useUrlNamesOrg` is derived from the URL alone, so it has no loading
    // window of its own — it answers false for "this route names no
    // workspace", never for "not read yet" (AGL-1113).
    //
    // Wait for Remote Config activation (AGL-422) so a release-flagged-off
    // plugin never loads on the registry defaults and then sticks (loaded
    // chunks can't unload).
    if (!namesOrg || !orgId || !flagsReady) return undefined
    let active = true
    void (async () => {
      await consolePluginLoader.ensure(enabledKey.split(','), ['console'])
      // Trusted-realm marketplace plugins (AGL-420): loaded after the
      // first-party set so their registrations land before the shell
      // renders. Failures inside are logged and skipped — a broken remote
      // bundle never blocks the console.
      await loadOrgRealmPlugins(orgId, user)
      if (active) setReadyForOrg(orgId)
    })()
    return () => {
      active = false
    }
    // `user` identity churns with token refreshes; orgId names the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesOrg, orgId, flagsReady, enabledKey])

  // This gate sits ABOVE the whole route tree — the app bar and nav strip
  // included — so holding here blanks the entire window, not just the page
  // body. It used to hold on every `orgId` CHANGE, which meant a workspace
  // switch unmounted and remounted the whole console: an empty frame, then
  // the boot splash, then a fresh tree (AGL-758). The hold spans a network
  // fetch (`loadOrgRealmPlugins`), so on a cold cache that was seconds of it
  // (AGL-903).
  //
  // Only the FIRST load of a session needs the hold, because the registry
  // starts empty and rendering the shell before it is populated would drop
  // every plugin nav item and page. After that the registry is a union that
  // never shrinks, and reads are scoped to the org's own plugin ids
  // (`useEnabledPluginIds`), so a switch can keep the previous tree mounted:
  // the new workspace's plugin tabs simply appear when their chunks land,
  // and the old workspace's never leak in.
  //
  // An org-less route holds for nothing (AGL-1937): the load never starts
  // there, so without `namesOrg` the picker would sit behind this splash
  // waiting on a `readyForOrg` that can never arrive.
  if (namesOrg && orgId && !hasLoadedOnce.current && readyForOrg !== orgId) {
    return <BootSplash />
  }
  // Plugin-registered app providers (AGL-419) wrap every console page —
  // e.g. the marketplace plugin's AI-assist provider. Scoped to this org, so
  // a provider from a previously visited workspace does not linger.
  //
  // `orgReady` rides along with `org` (AGL-1380). This gate sits above the
  // whole route tree, so unlike the plugin-page route it CANNOT hold its
  // render until the billing doc settles — that would blank the console on
  // every load. A provider's entitlement gate therefore has to be told the
  // difference between "not on your plan" and "no answer yet", because an
  // undefined `org` checks as the free tier either way.
  return listConsoleProviders(enabledPluginIds).reduce<ReactNode>(
    (inner, Provider, index) => (
      <Provider key={index} org={org} orgReady={orgReady} orgId={orgId}>
        {inner}
      </Provider>
    ),
    children,
  )
}

/**
 * Editor-surface gate (AGL-417): besigner/preview canvases additionally
 * need the enabled plugins' SITE components (canvas bundles). Returns true
 * once they're registered — callers must not mount the canvas before then
 * (the blank-canvas invariant, AGL-52).
 */
/**
 * HOC form of the editor-surface gate: renders nothing until the enabled
 * plugins' site components are registered, then mounts the wrapped page.
 * Used on the besigner/preview pages so their hook-heavy bodies never run
 * against an empty component registry.
 *
 * It is also where the editor learns the site's plugin set (AGL-1014).
 * `consolePluginLoader` never unloads a bundle and the preset registry is a
 * module-global union, so a plugin loaded while editing one site keeps
 * registering palette entries on the next — narrowing what gets LOADED
 * cannot take back what is already registered. The component drawer
 * therefore FILTERS on this set, and it is published here rather than per
 * route so no editor page can be added that forgets.
 */
export function withSitePlugins<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  function WithSitePlugins(props: P) {
    const ready = useSitePluginsReady()
    const enabledPluginIds = useEnabledPluginIds()
    if (!ready) return null
    return (
      <EnabledPluginsContext.Provider value={enabledPluginIds}>
        <Component {...props} />
      </EnabledPluginsContext.Provider>
    )
  }
  WithSitePlugins.displayName = `WithSitePlugins(${Component.displayName ?? Component.name ?? 'Page'})`
  return WithSitePlugins
}

export function useSitePluginsReady(): boolean {
  const { orgId } = useCurrentOrg()
  // Same fallback-org gate as the console gate above (AGL-1937). Every
  // `withSitePlugins` route lives under `/[orgSlug]/hosts/[host]/…`, so this
  // never withholds the canvas from a page that has one — the org-less
  // system-email editor deliberately calls `ensure` itself (AGL-759) rather
  // than resolving a plugin set from whichever org the scope fell back to.
  const namesOrg = useUrlNamesOrg()
  const [ready, setReady] = useState(false)
  const { flagsReady, enabledKey } = useEffectiveEnabledPlugins()

  useEffect(() => {
    if (!namesOrg || !orgId || !flagsReady) return undefined
    let active = true
    setReady(false)
    void consolePluginLoader.ensure(enabledKey.split(','), ['site']).then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [namesOrg, orgId, flagsReady, enabledKey])

  return ready
}
