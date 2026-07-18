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

import * as Aglyn from '@aglyn/aglyn'
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
export async function loadSiteRealmPlugins(
  installs: readonly Aglyn.RealmPluginInstall[] | undefined,
): Promise<void> {
  await loadDevRealmBundles()
  const artifactsBase = process.env.NEXT_PUBLIC_PLUGIN_ORIGIN ?? ''
  if (!installs?.length || !artifactsBase) return
  try {
    Aglyn.setRealmPluginHost({ React, jsxRuntime, aglyn: Aglyn })
    await Aglyn.loadRealmPlugins(installs, {
      artifactsBase,
      publicKeyBase64: process.env.NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY,
    })
  } catch (error) {
    console.error('realm plugins skipped:', error)
  }
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
  Aglyn.setRealmPluginHost({ React, jsxRuntime, aglyn: Aglyn })
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
        const mod = (await import(/* webpackIgnore: true */ blobUrl)) as {
          register?: (host: unknown) => void
          default?: { register?: (host: unknown) => void }
        }
        const register = mod.register ?? mod.default?.register
        if (typeof register !== 'function') {
          throw new Error('bundle exports no register(host)')
        }
        register(host)
        console.info(`dev realm bundle loaded (UNVERIFIED): ${pluginId}`)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    } catch (error) {
      console.error(`dev realm bundle ${pluginId} failed:`, error)
    }
  }
}
