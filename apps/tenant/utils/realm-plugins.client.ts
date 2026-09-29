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
import { capturePluginStyles } from '@aglyn/aglyn/plugin-manager/plugin-styles'
import type { RealmBundleModule } from '@aglyn/aglyn/plugin-manager/realm-plugins'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

/**
 * Tenant side of the realm-plugin host ABI (AGL-420). The app composes
 * `__AGLYN_PLUGIN_HOST__` so remote bundles share THIS bundle's React and
 * core-registry singletons (the blank-canvas invariant). The install list
 * arrives in the page props — `load-page-data` joins the workspace's
 * install pins with the staff-only trust grants server-side.
 *
 * Realm site plugins load AFTER hydration (an effect, not the SSR
 * suspension first-party plugins get): they are additive runtimes, and
 * blocking the published site's first paint on a marketplace CDN would
 * invert the reliability contract.
 */
/**
 * Say why realm plugins are OFF, once per session (AGL-1184).
 *
 * Same reasoning as the console copy: the early return is right, but doing it
 * silently is what made this cost an investigation. Never fires in production,
 * where the variable is set.
 *
 * Distinguished from "this page has no realm plugins", which is the far more
 * common reason nothing loads and is NOT worth a message.
 */
let originWarned = false
function warnMissingPluginOrigin(): void {
  if (originWarned || process.env.NODE_ENV === 'production') return
  originWarned = true
  console.info(
    'Realm plugins are OFF locally: NEXT_PUBLIC_PLUGIN_ORIGIN is unset, so a ' +
      'published site never fetches installed plugin bundles (not a failure). ' +
      // A placeholder, not our origin (AGL-2202) — see the console twin.
      'Set NEXT_PUBLIC_PLUGIN_ORIGIN=<your plugin origin> to load them.',
  )
}

/**
 * Whether a page's install renders on the server (AGL-3390): one published
 * with an identity, which the loader holds its registrations to, that
 * declares site components. Anything else loads in the browser only, after
 * hydration, as every realm plugin did before.
 */
export function rendersOnServer(install: Aglyn.RealmPluginInstall): boolean {
  return Boolean(install.identity && install.contributes?.site?.components?.length)
}

/**
 * How long the server waits for a bundle before it renders the page without
 * it. The browser still loads it, and replaces the fallback it finds.
 */
const SERVER_FETCH_TIMEOUT_MS = 5000

/**
 * Imports verified bytes on the server, where a blob URL cannot be imported.
 * Node caches a module by its URL, so the same bytes evaluate once per
 * process however many pages render them.
 */
async function importFromDataUrl(bytes: ArrayBuffer): Promise<RealmBundleModule> {
  const base64 = globalThis.Buffer.from(bytes).toString('base64')
  return (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ `data:text/javascript;base64,${base64}`
  )) as RealmBundleModule
}

/** One load per install list, shared by every caller that asks for it. */
const pendingLoads = new Map<string, Promise<void>>()

/**
 * Loads a page's realm installs, once per list. The page suspends on it on
 * the server, and a namespaced element suspends on it in the browser while
 * its server HTML stays in place (AGL-3390).
 *
 * Never rejects: a bundle that fails to load, verify or keep to its namespace
 * is logged and skipped, and its elements render as unregistered ones do.
 */
export function loadSiteRealmPlugins(
  installs: readonly Aglyn.RealmPluginInstall[] | undefined,
  options: { server?: boolean } = {},
): Promise<void> {
  const key = `${options.server ? 'server' : 'browser'}|${(installs ?? [])
    .map((install) => `${install.listingId}@${install.version}`)
    .join(',')}`
  let pending = pendingLoads.get(key)
  if (!pending) {
    pending = loadNow(installs, options.server === true)
    pendingLoads.set(key, pending)
  }
  return pending
}

async function loadNow(
  installs: readonly Aglyn.RealmPluginInstall[] | undefined,
  server: boolean,
): Promise<void> {
  if (!server) await loadDevRealmBundles()
  const artifactsBase = process.env.NEXT_PUBLIC_PLUGIN_ORIGIN ?? ''
  // Order matters: "no plugins installed" is the ordinary case and stays
  // quiet; a MISSING ORIGIN with plugins to load is the one worth explaining.
  if (!installs?.length) return
  if (!artifactsBase) {
    warnMissingPluginOrigin()
    return
  }
  try {
    const { composeRealmPluginHost, loadRealmPlugins, realmRegistry } =
      await import('./realm-plugin-host.client')
    composeRealmPluginHost({ React, jsxRuntime })
    await loadRealmPlugins(installs, {
      artifactsBase,
      publicKeyBase64: process.env.NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY,
      registry: realmRegistry,
      // `typeof window` folds at build time, so the browser drops the
      // server's importer along with this branch.
      ...(server && typeof window === 'undefined'
        ? { importModule: importFromDataUrl, fetchTimeoutMs: SERVER_FETCH_TIMEOUT_MS }
        : {}),
    })
  } catch (error) {
    console.error('realm plugins skipped:', error)
  }
}

/** Test seam: forget every install list loaded so far. */
export function resetSiteRealmLoadsForTests(): void {
  pendingLoads.clear()
}

/**
 * DEV-ONLY realm loop (AGL-427): unverified bundles from localhost via
 * `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES="id=http://localhost:5173/plugin.bundle.mjs"`.
 * Dead code in production builds (NODE_ENV guard); localhost-only URLs.
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
