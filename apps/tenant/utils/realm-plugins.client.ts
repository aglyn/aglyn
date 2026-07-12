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
