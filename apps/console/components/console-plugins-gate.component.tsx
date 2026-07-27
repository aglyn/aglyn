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
  filterPluginsByReleaseFlags,
  listConsoleProviders,
  resolveEnabledPlugins,
} from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'
import type React from 'react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import BootSplash from './boot-splash.component'
import { consolePluginLoader } from '../constants/console-plugin-loader'
import useCurrentOrg from '../hooks/use-current-org'
import { useReleaseFlags } from '../hooks/use-release-flags'
import { loadOrgRealmPlugins } from '../utils/realm-plugins.client'

/**
 * The workspace's EFFECTIVE plugin set (AGL-416/422): the org switchboard
 * minus release-flagged-off plugins (staff keep flagged plugins — the
 * usual staff-preview bypass). Returned as a stable comma key; loading
 * waits for Remote Config activation so a kill-switched plugin never
 * flashes in on the registry defaults.
 */
function useEffectiveEnabledPlugins(): { flagsReady: boolean; enabledKey: string } {
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
  return useMemo(
    () => enabledKey.split(',').filter(Boolean),
    [enabledKey],
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
  const { org, orgId } = useCurrentOrg()
  const { data: user } = useUser()
  const [readyForOrg, setReadyForOrg] = useState<string | null>(null)
  const { flagsReady, enabledKey } = useEffectiveEnabledPlugins()
  const enabledPluginIds = useEnabledPluginIds()
  // Latches on the first completed load; from then on a workspace switch
  // renders through instead of blanking the tree (AGL-758).
  const hasLoadedOnce = useRef(false)
  if (readyForOrg) hasLoadedOnce.current = true

  useEffect(() => {
    // Wait for Remote Config activation (AGL-422) so a release-flagged-off
    // plugin never loads on the registry defaults and then sticks (loaded
    // chunks can't unload).
    if (!orgId || !flagsReady) return undefined
    let active = true
    void (async () => {
      await consolePluginLoader.ensure(enabledKey.split(','), ['console'])
      // Trusted-realm marketplace plugins (AGL-420): loaded after the
      // first-party set so their registrations land before the shell
      // renders. Failures inside are logged and skipped — a broken remote
      // bundle never blocks the console.
      const idToken = await (user as { getIdToken?: () => Promise<string> })
        ?.getIdToken?.()
        .catch(() => undefined)
      await loadOrgRealmPlugins(orgId, idToken)
      if (active) setReadyForOrg(orgId)
    })()
    return () => {
      active = false
    }
    // `user` identity churns with token refreshes; orgId names the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, flagsReady, enabledKey])

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
  if (orgId && !hasLoadedOnce.current && readyForOrg !== orgId) {
    return <BootSplash />
  }
  // Plugin-registered app providers (AGL-419) wrap every console page —
  // e.g. the community plugin's AI-assist provider. Scoped to this org, so
  // a provider from a previously visited workspace does not linger.
  return listConsoleProviders(enabledPluginIds).reduce<ReactNode>(
    (inner, Provider, index) => (
      <Provider key={index} org={org}>
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
 */
export function withSitePlugins<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  function WithSitePlugins(props: P) {
    const ready = useSitePluginsReady()
    if (!ready) return null
    return <Component {...props} />
  }
  WithSitePlugins.displayName = `WithSitePlugins(${Component.displayName ?? Component.name ?? 'Page'})`
  return WithSitePlugins
}

export function useSitePluginsReady(): boolean {
  const { orgId } = useCurrentOrg()
  const [ready, setReady] = useState(false)
  const { flagsReady, enabledKey } = useEffectiveEnabledPlugins()

  useEffect(() => {
    if (!orgId || !flagsReady) return undefined
    let active = true
    setReady(false)
    void consolePluginLoader.ensure(enabledKey.split(','), ['site']).then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [orgId, flagsReady, enabledKey])

  return ready
}
