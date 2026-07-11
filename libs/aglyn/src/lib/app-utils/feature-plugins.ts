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
 * Feature-plugin pattern (AGL-277). Features ship as a PAIR of libs and
 * never merge into `plugins-ui-mui` (which stays pure component/theme
 * definitions):
 *
 *  - `libs/plugins/ui/{feature}`      → besigner/host components. Builds
 *    its bundle with `defineUiFeatureBundle` (which depends on the mui
 *    bundle so primitives/theming resolve first) and registers it with
 *    `Aglyn.plugins.addDependency`, exactly like the mui bundle itself.
 *  - `libs/plugins/console/{feature}` → console surface. Exports a
 *    `ConsoleExtension` registered with `registerConsoleExtension`; the
 *    console shell renders nav items, dashboard cards, and settings
 *    sections from the registry, gated by the extension's feature flag.
 *
 * This module is pure (no registry singletons) per app-utils layering;
 * the plugin libs close the loop by passing `Aglyn.components` in.
 * Reference implementation: events-calendar (AGL-313); commerce follows
 * the same shape (AGL-290).
 */

import type { TenantFeatureFlags } from '../foundation'
import type { Plugin, PluginId } from '../plugin-manager/plugin-manager'
import type { ComponentSchema, MdiIconProps, PresetSchema } from '../types/nodes'

/** The mui bundle id every UI feature bundle depends on. */
export const MUI_BUNDLE_ID: PluginId = 'mui'

export interface FeatureBundleEntry {
  component: any
  schema: ComponentSchema<any>
  presets?: PresetSchema[]
}

/** The slice of ComponentManager a feature bundle needs (structural). */
export interface ComponentRegistrar {
  registerComponent(component: any, schema: ComponentSchema<any>): void
  registerPreset(presets: PresetSchema[]): void
  unregisterComponent(componentId: string): void
  unregisterPreset(presetIds: string[]): void
}

export interface UiFeatureBundleOptions {
  /** Stable bundle id — persisted as `pluginId` in screen docs; never rename. */
  bundleId: PluginId
  displayName: string
  description?: string
  icon?: MdiIconProps
  /** Extra bundle ids this feature needs beyond mui. */
  dependsOn?: PluginId[]
  components: FeatureBundleEntry[]
}

/**
 * UI half of the pattern: a plugin-registry bundle whose load/destroy
 * register the feature's components + presets against the given
 * registrar (`Aglyn.components` in apps), declared as depending on the
 * mui bundle so the registry loads mui first.
 */
export function defineUiFeatureBundle(
  options: UiFeatureBundleOptions,
  registrar: ComponentRegistrar,
): Plugin {
  const dependencies: Record<PluginId, true> = { [MUI_BUNDLE_ID]: true }
  for (const id of options.dependsOn ?? []) dependencies[id] = true
  return {
    $id: options.bundleId,
    displayName: options.displayName,
    title: options.displayName,
    description: options.description,
    icon: options.icon,
    dependencies,
    load(): void {
      for (const entry of options.components) {
        registrar.registerComponent(entry.component, entry.schema)
      }
      for (const entry of options.components) {
        if (entry.presets?.length) registrar.registerPreset(entry.presets)
      }
    },
    destroy(): void {
      for (const entry of options.components) {
        if (entry.presets?.length) {
          registrar.unregisterPreset(
            entry.presets.map((preset) => preset.$id),
          )
        }
      }
      for (const entry of options.components) {
        registrar.unregisterComponent(entry.schema.$id)
      }
    },
  }
}

export interface ConsoleNavItem {
  label: string
  /** Console route, host-relative (e.g. '/manage/events'). */
  href: string
  icon?: MdiIconProps
}

export interface ConsoleDashboardCard {
  /** Card registry key the dashboard resolves to a component. */
  cardId: string
  title: string
}

export interface ConsoleSettingsSection {
  sectionId: string
  title: string
}

/**
 * Console half of the pattern: everything a feature contributes to the
 * console shell. Declarative — the shell owns rendering and applies the
 * feature-flag gate, so extensions cannot bypass entitlements.
 */
export interface ConsoleExtension {
  pluginId: PluginId
  displayName: string
  /** Entitlement flag gating every surface this extension registers. */
  featureFlag?: keyof TenantFeatureFlags
  navItems?: ConsoleNavItem[]
  dashboardCards?: ConsoleDashboardCard[]
  settingsSections?: ConsoleSettingsSection[]
}

const consoleExtensions = new Map<PluginId, ConsoleExtension>()

/** Idempotent by pluginId — re-registration replaces the previous entry. */
export function registerConsoleExtension(extension: ConsoleExtension): void {
  consoleExtensions.set(extension.pluginId, extension)
}

export function unregisterConsoleExtension(pluginId: PluginId): void {
  consoleExtensions.delete(pluginId)
}

/** Registration-ordered extensions; the console shell filters by flag. */
export function listConsoleExtensions(): ConsoleExtension[] {
  return Array.from(consoleExtensions.values())
}
