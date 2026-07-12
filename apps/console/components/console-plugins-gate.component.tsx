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

import { listConsoleProviders, resolveEnabledPlugins } from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'
import type React from 'react'
import { type ReactNode, useEffect, useState } from 'react'
import { consolePluginLoader } from '../constants/console-plugin-loader'
import useCurrentTenant from '../hooks/use-current-tenant'
import { loadOrgRealmPlugins } from '../utils/realm-plugins.client'

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
  const { tenant, orgId } = useCurrentTenant()
  const { data: user } = useUser()
  const [readyForOrg, setReadyForOrg] = useState<string | null>(null)
  const enabledKey = resolveEnabledPlugins(tenant).join(',')

  useEffect(() => {
    if (!orgId) return undefined
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
  }, [orgId, enabledKey])

  if (orgId && readyForOrg !== orgId) return null
  // Plugin-registered app providers (AGL-419) wrap every console page —
  // e.g. the community plugin's AI-assist provider. Mounted only once the
  // registry is populated; each receives the org billing doc.
  return listConsoleProviders().reduce<ReactNode>(
    (inner, Provider, index) => (
      <Provider key={index} tenant={tenant}>
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
  const { tenant, orgId } = useCurrentTenant()
  const [ready, setReady] = useState(false)
  const enabledKey = resolveEnabledPlugins(tenant).join(',')

  useEffect(() => {
    if (!orgId) return undefined
    let active = true
    setReady(false)
    void consolePluginLoader.ensure(enabledKey.split(','), ['site']).then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [orgId, enabledKey])

  return ready
}
