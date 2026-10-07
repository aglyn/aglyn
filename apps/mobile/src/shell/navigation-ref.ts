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
 * The app's routes and the navigation handle the plugin context drives
 * (AGL-3620). Plugins never see these names: they navigate by screen id.
 */

import { createNavigationContainerRef } from '@react-navigation/native'
import type { MobileParams } from '@aglyn/mobile-plugin-host'

export type RootStackParams = {
  Main: undefined
  PluginScreen: { screenId: string; params?: MobileParams }
  Console: { path: string }
  Switcher: undefined
  Settings: undefined
  Notifications: undefined
}

export const navigationRef = createNavigationContainerRef<RootStackParams>()

export function openPluginScreen(screenId: string, params?: MobileParams): void {
  if (navigationRef.isReady()) navigationRef.navigate('PluginScreen', { screenId, params })
}

export function openConsolePath(path: string): void {
  if (navigationRef.isReady()) navigationRef.navigate('Console', { path })
}
