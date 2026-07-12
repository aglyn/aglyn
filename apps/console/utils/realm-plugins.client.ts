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
 * Console side of the realm-plugin host ABI (AGL-420). The app — not core —
 * composes `__AGLYN_PLUGIN_HOST__` because React/jsxRuntime must be THIS
 * bundle's singletons: a realm bundle rendering with a second React copy is
 * the blank-canvas failure all over again. Remote bundles import nothing;
 * they reach React and every core registry through the host object.
 */
function ensureRealmPluginHost(): void {
  Aglyn.setRealmPluginHost({ React, jsxRuntime, aglyn: Aglyn })
}

/**
 * Fetches the org's trusted-realm installs (server-joined with the
 * staff-only trust grants) and loads them into the app realm. Never
 * throws: a missing artifacts origin, a failed fetch, or a bad bundle
 * leaves the console exactly as it was — realm plugins are additive.
 */
export async function loadOrgRealmPlugins(
  orgId: string,
  idToken?: string,
): Promise<void> {
  const artifactsBase = process.env.NEXT_PUBLIC_PLUGIN_ORIGIN ?? ''
  if (!artifactsBase) return
  try {
    const response = await fetch(
      `/api/orgs/realm-plugins?orgId=${encodeURIComponent(orgId)}`,
      idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : undefined,
    )
    if (!response.ok) return
    const payload = (await response.json()) as {
      installs?: Aglyn.RealmPluginInstall[]
    }
    if (!payload.installs?.length) return
    ensureRealmPluginHost()
    await Aglyn.loadRealmPlugins(payload.installs, {
      artifactsBase,
      publicKeyBase64: process.env.NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY,
    })
  } catch (error) {
    console.error('realm plugins skipped:', error)
  }
}
