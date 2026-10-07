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

/**
 * Builds the context every plugin contribution runs in, from the signed-in
 * person, the switcher's pick and the console API client (AGL-3620).
 */

import {
  createConsoleApiClient,
  getMobileConfig,
  getMobileFirebase,
  useMobileAuth,
  useWorkspace,
} from '@aglyn/mobile-core'
import { MobilePluginContextReact, type MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { useMemo, type ReactNode } from 'react'
import { openConsolePath, openPluginScreen } from './navigation-ref'

/**
 * A plugin's page path under the console's prefix for the pick. Without a
 * pick to put in front, the workspace (or the console's home) opens instead
 * of a page that would 404.
 */
export function scopedConsolePath(
  path: string,
  scope: 'site' | 'org' | 'absolute',
  orgSlug: string | null,
  hostSlug: string | null,
): string {
  const rest = path.startsWith('/') ? path : `/${path}`
  if (scope === 'absolute') return rest
  if (!orgSlug) return '/'
  if (scope === 'org') return `/${orgSlug}${rest === '/' ? '' : rest}`
  if (!hostSlug) return `/${orgSlug}/hosts`
  return `/${orgSlug}/hosts/${hostSlug}${rest === '/' ? '' : rest}`
}

export function PluginContextProvider({ children }: { children: ReactNode }) {
  const { user } = useMobileAuth()
  const { org, site } = useWorkspace()
  const { firestore, auth } = getMobileFirebase()

  const api = useMemo(
    () =>
      createConsoleApiClient({
        origin: getMobileConfig().consoleOrigin,
        getIdToken: async (forceRefresh) => (auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null),
      }),
    [auth],
  )

  const value = useMemo<MobilePluginContext | null>(
    () =>
      user
        ? {
            uid: user.uid,
            orgId: org?.id ?? null,
            hostId: site?.id ?? null,
            orgSlug: org?.slug ?? null,
            hostSlug: site?.subdomain || null,
            firestore,
            api,
            navigate: openPluginScreen,
            openConsolePath: (path, scope = 'absolute') =>
              openConsolePath(scopedConsolePath(path, scope, org?.slug ?? null, site?.subdomain || null)),
          }
        : null,
    [user, org?.id, org?.slug, site?.id, site?.subdomain, firestore, api],
  )

  return <MobilePluginContextReact.Provider value={value}>{children}</MobilePluginContextReact.Provider>
}
