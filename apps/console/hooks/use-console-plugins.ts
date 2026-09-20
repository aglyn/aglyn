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

import type { ConsoleLoadWhere } from '@aglyn/aglyn'
import { useEffect, useMemo, useState } from 'react'
import {
  useEnabledPluginIds,
  usePluginLoadScope,
} from '../components/console-plugins-gate.component'
import {
  consolePluginsAt,
  consolePluginsKey,
} from '../constants/console-plugin-load-points'
import { consolePluginLoader } from '../constants/console-plugin-loader'
import { loadOrgRealmPlugins } from '../utils/realm-plugins.client'

/**
 * Loads the plugins a place in the console draws, and says when they are
 * there (AGL-3142).
 *
 * The console shell used to load every plugin the workspace had enabled, so
 * every screen carried the code of every installed plugin whether or not it
 * drew any of it. A zone now loads the plugins that declare it and a route the
 * plugins that declare it, first-party and realm alike, resolved from each
 * plugin's own declaration — the surface names what it draws, never which
 * plugin draws it.
 *
 * ## Why it returns a verdict rather than holding
 *
 * A plugin whose console code has not landed does not fail loudly: its widget,
 * its panel or its page is simply ABSENT, and a screen that renders while its
 * plugins are still loading shows a reader the surface it asked for is not
 * there. So every caller is handed `settled` and decides: a zone renders
 * nothing and fills in, a plugin route holds its body, because a route with no
 * page is a "this page isn't available" notice for a page that is.
 *
 * Settled, not succeeded, like the gates above it: a chunk that fails to load
 * is logged and the screen renders without it rather than never.
 *
 * Scoped to the SITE's plugin set (`useEnabledPluginIds`), which answers `[]`
 * on a route that names no workspace — so nothing loads there, the rule the
 * console plugins gate states for itself.
 */
function useConsolePluginsAt(where: ConsoleLoadWhere, key: string): boolean {
  const enabledPluginIds = useEnabledPluginIds()
  // `orgId` is null until this screen may load for a workspace at all: see
  // `usePluginLoadScope` for the conditions it folds together.
  const { orgId, user } = usePluginLoadScope()
  const ids = useMemo(
    () => consolePluginsAt(enabledPluginIds, where),
    // `where` is rebuilt on every render; `key` is what it says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledPluginIds, key],
  )
  const idsKey = consolePluginsKey(ids)
  // With no workspace to load for there is nothing to wait for either, so a
  // staff zone — whose plugins the staff area loads — is settled at once.
  const done = orgId ? `${orgId}|${key}|${idsKey}` : null
  const [settledFor, setSettledFor] = useState<string | null>(null)

  useEffect(() => {
    if (!done || !orgId) return undefined
    let active = true
    void Promise.all([
      consolePluginLoader.ensure(ids, ['console']),
      // Realm installs by the same rules (AGL-3116): the console's realm host
      // follows its bundles instead of preceding them.
      loadOrgRealmPlugins(orgId, user, where),
    ])
      .catch((error) => console.error('console plugins failed to load', error))
      .then(() => {
        if (active) setSettledFor(done)
      })
    return () => {
      active = false
    }
    // `user` identity churns with token refreshes; orgId names the session,
    // and `ids`/`where` are carried by the two keys `done` is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, orgId])

  return done === null || settledFor === done
}

/**
 * The plugins whose widgets fill the zones a screen renders.
 *
 * The zone ids, never plugin ids: a screen that named the plugins it expects
 * would have to be edited every time one was added to the catalog, and the
 * declaration is what decides.
 */
export function useConsoleSlotPlugins(slots: readonly string[]): boolean {
  const key = [...slots].sort().join(',')
  const where = useMemo<ConsoleLoadWhere>(
    () => ({ at: 'slots', slots: [...slots] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return useConsolePluginsAt(where, `slots:${key}`)
}

/**
 * The plugins that serve the plugin route the reader has open.
 *
 * `href` is the surface's own path (`/products`), plugin-relative; a declared
 * route serves the paths beneath it on a segment boundary, so `/products`
 * serves `/products/orders` and never `/products-archive`.
 */
export function useConsoleRoutePlugins(
  href: string,
  level: 'site' | 'org',
): boolean {
  const where = useMemo<ConsoleLoadWhere>(
    () => ({ at: 'route', href, level }),
    [href, level],
  )
  return useConsolePluginsAt(where, `route:${level}:${href}`)
}
