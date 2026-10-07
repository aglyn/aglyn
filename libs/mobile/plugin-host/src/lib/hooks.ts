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
 * React bindings for the mobile registry (AGL-3620). Components re-render
 * when a plugin registers, so the shell can draw before every plugin has
 * loaded and fill in as they arrive.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import {
  getMobileDashboardWidgets,
  getMobileDeepLinks,
  getMobileQuickActions,
  getMobileScreens,
  getMobileTabs,
  mobileRegistryVersion,
  subscribeMobileRegistry,
} from './registry'
import type { MobilePluginContext } from './types'

export function useMobileRegistryVersion(): number {
  return useSyncExternalStore(subscribeMobileRegistry, mobileRegistryVersion, mobileRegistryVersion)
}

export function useMobileContributions() {
  const version = useMobileRegistryVersion()
  return useMemo(
    () => ({
      version,
      screens: getMobileScreens(),
      tabs: getMobileTabs(),
      widgets: getMobileDashboardWidgets(),
      quickActions: getMobileQuickActions(),
      deepLinks: getMobileDeepLinks(),
    }),
    [version],
  )
}

export const MobilePluginContextReact = createContext<MobilePluginContext | null>(null)

/** The context a plugin's screen or widget runs in; the shell provides it. */
export function useMobilePluginContext(): MobilePluginContext {
  const context = useContext(MobilePluginContextReact)
  if (!context) throw new Error('useMobilePluginContext needs the app shell around it')
  return context
}
