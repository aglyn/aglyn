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
 * The mobile contribution registry (AGL-3620). Module state, like the web
 * plugin manager's registries: one app process, one registry.
 *
 * A registration is refused (thrown) when its id is taken, so two plugins
 * can never silently shadow each other's screen; the loader catches the
 * throw per plugin, so one bad plugin cannot keep the others from loading.
 */

import type {
  MobileContributionKind,
  MobileDashboardWidget,
  MobileDeepLink,
  MobileQuickAction,
  MobileScreen,
  MobileTab,
} from './types'

interface Registry {
  screens: Map<string, MobileScreen>
  tabs: Map<string, MobileTab>
  widgets: Map<string, MobileDashboardWidget>
  quickActions: Map<string, MobileQuickAction>
  deepLinks: Map<string, MobileDeepLink>
}

function emptyRegistry(): Registry {
  return {
    screens: new Map(),
    tabs: new Map(),
    widgets: new Map(),
    quickActions: new Map(),
    deepLinks: new Map(),
  }
}

let registry = emptyRegistry()
let version = 0
const listeners = new Set<() => void>()

/** The scope a registrar runs in: what its plugin declared it may register. */
let scope: { pluginId: string; allowed: (kind: MobileContributionKind, id: string) => boolean } | null = null

/** @internal The loader's hook; plugins never call it. */
export function runInPluginScope(
  pluginId: string,
  allowed: (kind: MobileContributionKind, id: string) => boolean,
  register: () => void,
): void {
  const previous = scope
  scope = { pluginId, allowed }
  try {
    register()
  } finally {
    scope = previous
  }
}

function add<K extends MobileContributionKind>(
  kind: K,
  item: Registry[K] extends Map<string, infer V> ? V : never,
): void {
  const { id, pluginId } = item as { id: string; pluginId: string }
  if (!id || !pluginId) {
    throw new Error(`a mobile ${kind} registration needs an id and a pluginId`)
  }
  if (scope && scope.pluginId !== pluginId) {
    throw new Error(
      `plugin "${scope.pluginId}" registered ${kind} "${id}" as "${pluginId}" — a plugin registers only its own`,
    )
  }
  if (scope && !scope.allowed(kind, id)) {
    throw new Error(
      `plugin "${pluginId}" registered ${kind} "${id}", which its "mobile.contributes.${kind}" in plugins.config.json does not declare`,
    )
  }
  const map = registry[kind] as Map<string, unknown>
  if (map.has(id)) throw new Error(`mobile ${kind} "${id}" is already registered`)
  map.set(id, item)
  version += 1
  for (const listener of listeners) listener()
}

export function registerMobileScreen(screen: MobileScreen): void {
  add('screens', screen)
}

export function registerMobileTab(tab: MobileTab): void {
  add('tabs', tab)
}

export function registerMobileDashboardWidget(widget: MobileDashboardWidget): void {
  add('widgets', widget)
}

export function registerMobileQuickAction(action: MobileQuickAction): void {
  if (Boolean(action.screen) === Boolean(action.consolePath)) {
    throw new Error(`quick action "${action.id}" opens a screen or a console path — exactly one`)
  }
  add('quickActions', action)
}

export function registerMobileDeepLink(link: MobileDeepLink): void {
  if (!link.path.startsWith('/')) {
    throw new Error(`deep link "${link.id}" path "${link.path}" is a console path and starts with /`)
  }
  add('deepLinks', link)
}

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) =>
  a.order - b.order || a.id.localeCompare(b.id)

export function getMobileScreen(id: string): MobileScreen | undefined {
  return registry.screens.get(id)
}

export function getMobileScreens(): MobileScreen[] {
  return [...registry.screens.values()]
}

export function getMobileTabs(): MobileTab[] {
  return [...registry.tabs.values()].sort(byOrder)
}

export function getMobileDashboardWidgets(): MobileDashboardWidget[] {
  return [...registry.widgets.values()].sort(byOrder)
}

export function getMobileQuickActions(): MobileQuickAction[] {
  return [...registry.quickActions.values()].sort(byOrder)
}

export function getMobileDeepLinks(): MobileDeepLink[] {
  return [...registry.deepLinks.values()]
}

/** Ids registered by one plugin, by kind — what the loader compares to the declaration. */
export function registeredBy(pluginId: string): Record<MobileContributionKind, string[]> {
  const ids = (map: Map<string, { pluginId: string; id: string }>) =>
    [...map.values()].filter((item) => item.pluginId === pluginId).map((item) => item.id).sort()
  return {
    screens: ids(registry.screens),
    tabs: ids(registry.tabs),
    widgets: ids(registry.widgets),
    quickActions: ids(registry.quickActions),
    deepLinks: ids(registry.deepLinks),
  }
}

/**
 * @internal The loader's hook: drops everything one plugin registered, so a
 * plugin that failed halfway leaves no tab or widget behind that cannot work.
 */
export function unregisterMobilePlugin(pluginId: string): void {
  let changed = false
  for (const map of Object.values(registry) as Map<string, { pluginId: string }>[]) {
    for (const [id, item] of map) {
      if (item.pluginId === pluginId) {
        map.delete(id)
        changed = true
      }
    }
  }
  if (!changed) return
  version += 1
  for (const listener of listeners) listener()
}

/** For `useSyncExternalStore`: changes whenever anything registers. */
export function subscribeMobileRegistry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function mobileRegistryVersion(): number {
  return version
}

/** Test seam: forget every registration. */
export function resetMobileRegistry(): void {
  registry = emptyRegistry()
  version += 1
  for (const listener of listeners) listener()
}
