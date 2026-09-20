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

// Named imports, and a TYPE-only namespace. A namespace held as a VALUE is
// opaque to a bundler — it cannot know which exports are read, so it keeps
// everything the barrel reaches. The one place this app genuinely needs the
// namespace as a value is the host ABI, which lives behind the relative
// `import()` below; see `realm-plugin-host.client.ts`.
import type * as Aglyn from '@aglyn/aglyn'
import { isPluginUsedInConsole } from '@aglyn/aglyn/plugin-manager/plugin-contributions'
import { capturePluginStyles } from '@aglyn/aglyn/plugin-manager/plugin-styles'
import { loadRealmPlugins } from '@aglyn/aglyn/plugin-manager/realm-plugins'
import {
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

/**
 * DEV-ONLY realm loop (AGL-427, Strapi watch:link parity): load bundles
 * straight from a local dev server WITHOUT sha/signature checks —
 * `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES="my-plugin=http://localhost:5173/plugin.bundle.mjs"`.
 * The NODE_ENV guard makes this entire body dead code in production
 * builds; localhost-only URLs are enforced on top. Pair with
 * `npm run watch` in the plugin template and refresh to iterate.
 */
async function loadDevRealmBundles(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return
  // Explicit opt-in (AGL-516): NODE_ENV alone is a fragile guard for an
  // UNVERIFIED import() path, so also require a deliberate dev flag — a
  // NODE_ENV!=production preview build can't silently enable it.
  if (process.env.NEXT_PUBLIC_PLUGIN_DEV !== 'enabled') return
  const configured = process.env.NEXT_PUBLIC_PLUGIN_DEV_BUNDLES ?? ''
  if (!configured) return
  const { composeRealmPluginHost } = await import('./realm-plugin-host.client')
  composeRealmPluginHost({ React, jsxRuntime })
  const host = (globalThis as Record<string, unknown>).__AGLYN_PLUGIN_HOST__
  for (const entry of configured.split(',')) {
    const [pluginId, url] = entry.split('=').map((part) => part.trim())
    if (!pluginId || !url) continue
    try {
      const { hostname } = new URL(url)
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        console.error(`dev realm bundle ${pluginId}: localhost URLs only`)
        continue
      }
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`fetch ${response.status}`)
      const blobUrl = URL.createObjectURL(
        new Blob([await response.arrayBuffer()], { type: 'text/javascript' }),
      )
      try {
        // AGL-2486: same style capture the verified path uses, so the dev
        // loop shows a plugin author the cascade their published users will
        // get rather than a canvas their CSS silently misses.
        await capturePluginStyles(pluginId, async () => {
          const mod = (await import(/* webpackIgnore: true */ blobUrl)) as {
            register?: (host: unknown) => void
            default?: { register?: (host: unknown) => void }
          }
          const register = mod.register ?? mod.default?.register
          if (typeof register !== 'function') {
            throw new Error('bundle exports no register(host)')
          }
          register(host)
        })
        console.info(`dev realm bundle loaded (UNVERIFIED): ${pluginId}`)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    } catch (error) {
      console.error(`dev realm bundle ${pluginId} failed:`, error)
    }
  }
}

/**
 * Fetches the org's trusted-realm installs (server-joined with the
 * staff-only trust grants) and loads them into the app realm. Never
 * throws: a missing artifacts origin, a failed fetch, or a bad bundle
 * leaves the console exactly as it was — realm plugins are additive.
 */
/**
 * Say why realm plugins are OFF, once per session (AGL-1184).
 *
 * The early return below is correct — without an origin there is nowhere to
 * fetch a bundle from — but doing it SILENTLY is what turned "realm plugins do
 * not work on my machine" into an investigation. There is no error, no failed
 * request, and no call to `/api/orgs/realm-plugins` to notice the absence of.
 *
 * Never in production: the variable is set there, so this cannot fire, and a
 * warning in a user's console would be noise rather than a hint.
 */
let originWarned = false
function warnMissingPluginOrigin(): void {
  if (originWarned || process.env.NODE_ENV === 'production') return
  originWarned = true
  console.info(
    'Realm plugins are OFF locally: NEXT_PUBLIC_PLUGIN_ORIGIN is unset, so ' +
      'installed marketplace plugins are never fetched (this is not a failure).\n' +
      // A placeholder rather than our own origin (AGL-2202): a dev-console
      // hint is a small thing to copy-paste, and naming a host somebody else
      // operates is how a self-hoster ends up loading OUR bundles.
      '  · to load INSTALLED plugins   set NEXT_PUBLIC_PLUGIN_ORIGIN=<your plugin origin>\n' +
      '  · to iterate on YOUR plugin   set NEXT_PUBLIC_PLUGIN_DEV=enabled plus ' +
      'NEXT_PUBLIC_PLUGIN_DEV_BUNDLES=<id>=http://localhost:5173/plugin.bundle.mjs\n' +
      '  see apps/console/.env.development.local.example',
  )
}

/**
 * The org's trusted-realm installs, fetched once per workspace per session.
 *
 * Every place in the console that loads plugins asks for this list — the
 * shell, each zone, each plugin route — and they only need to know WHICH
 * installs belong to them. The list is small, it does not change under a
 * session, and one request for it is the difference between reading a
 * declaration and hammering the endpoint on every navigation.
 *
 * The failures are the ones {@link loadOrgRealmPlugins} used to swallow, and
 * they still resolve to an empty list rather than rejecting: realm plugins are
 * additive, and a console that cannot reach the endpoint is a console without
 * them, never a console that fails to render.
 */
const installsByOrg = new Map<string, Promise<Aglyn.RealmPluginInstall[]>>()

function orgRealmInstalls(
  orgId: string,
  user: MaybeTokenSource,
): Promise<Aglyn.RealmPluginInstall[]> {
  let pending = installsByOrg.get(orgId)
  if (!pending) {
    pending = (async () => {
      const response = await authorizedFetch(
        user,
        `/api/orgs/realm-plugins?orgId=${encodeURIComponent(orgId)}`,
      )
      if (!response.ok) {
        // Was silent, and indistinguishable from "this org has none" (AGL-1184).
        console.warn(
          `realm plugins skipped: /api/orgs/realm-plugins returned ${response.status}`,
        )
        return []
      }
      const payload = (await response.json()) as {
        installs?: Aglyn.RealmPluginInstall[]
      }
      return payload.installs ?? []
    })().catch((error) => {
      console.error('realm plugins skipped:', error)
      return []
    })
    installsByOrg.set(orgId, pending)
  }
  return pending
}

/**
 * Loads the org's realm installs that belong at `where` (AGL-3142), and only
 * those.
 *
 * Installation is not use in the console either. This used to run once, on the
 * shell, with the org's whole install list: a workspace that had installed a
 * marketplace plugin for one zone composed the realm plugin host — which hands
 * a remote bundle the entire core namespace — on the billing page, the
 * besigner and every other screen, and then ran a `register()` whose widget
 * none of them draw. The host import is now inside the "anything to load"
 * branch, so a screen that draws no install pays for neither.
 *
 * An install whose pinned version declares nothing loads with the shell, the
 * default `plugin-contributions.ts` documents: its console contribution is
 * only discoverable by running `register()`, so narrowing it would take a
 * widget away with nothing to show for it.
 *
 * Never throws: a missing artifacts origin, a failed fetch, or a bad bundle
 * leaves the console exactly as it was — realm plugins are additive.
 */
export async function loadOrgRealmPlugins(
  orgId: string,
  user: MaybeTokenSource,
  where: Aglyn.ConsoleLoadWhere,
): Promise<void> {
  // The dev loop's bundles carry no declaration, so they load where an
  // undeclared install loads: with the shell, once.
  if (where.at === 'shell') await loadDevRealmBundles()
  const artifactsBase = process.env.NEXT_PUBLIC_PLUGIN_ORIGIN ?? ''
  if (!artifactsBase) {
    if (where.at === 'shell') warnMissingPluginOrigin()
    return
  }
  try {
    const installs = await orgRealmInstalls(orgId, user)
    const inUse = installs.filter((install) =>
      isPluginUsedInConsole(install.contributes, where),
    )
    if (!inUse.length) return
    const { composeRealmPluginHost } = await import('./realm-plugin-host.client')
    composeRealmPluginHost({ React, jsxRuntime })
    await loadRealmPlugins(inUse, {
      artifactsBase,
      publicKeyBase64: process.env.NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY,
    })
  } catch (error) {
    console.error('realm plugins skipped:', error)
  }
}

/** Test seam: forget the workspaces whose install lists were fetched. */
export function resetOrgRealmInstallsForTests(): void {
  installsByOrg.clear()
}
