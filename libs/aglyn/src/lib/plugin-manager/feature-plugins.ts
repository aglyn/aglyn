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
 * Feature-plugin pattern (AGL-277, AGL-395). Each feature ships as one lib
 * under `libs/plugins/{feature}` (moved out of the old `.../ui/` nesting)
 * that owns both halves and never merges into `plugins-mui` (which stays
 * pure component/theme definitions):
 *
 *  - UI half → besigner/host components. Builds its bundle with
 *    `defineUiFeatureBundle` (which depends on the mui bundle so
 *    primitives/theming resolve first) and registers it with
 *    `Aglyn.plugins.addDependency`, exactly like the mui bundle itself.
 *    Registered per-editor via `register{Feature}Plugin()`.
 *  - Console half → a `ConsoleExtension` registered with
 *    `registerConsoleExtension` via a separate `register{Feature}Console()`
 *    entry point (so app-load registration pulls no canvas code). The
 *    console shell renders nav items + their pages, dashboard cards, and
 *    settings sections from the registry, gated by the feature flag.
 *
 * This module is pure (no registry singletons) per app-utils layering;
 * the plugin libs close the loop by passing `Aglyn.components` in.
 * Reference implementation: events-calendar (AGL-313/394); commerce and
 * email follow the same shape (AGL-290/346, relocated in AGL-395).
 */

import { runInAction } from 'mobx'
import type { TenantPermissions } from '../app-utils/org-permissions'
import type { AglynTenant, TenantFeatureFlags } from '../foundation'
import type {
  ComponentSchema,
  MdiIconProps,
  PresetSchema,
} from '../types/nodes'
import type { Plugin, PluginId } from './plugin-manager'
import type { ComponentType } from 'react'

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
      // One mobx transaction per bundle (AGL-371): observers (component
      // drawer, canvas) re-render once instead of once per registration.
      runInAction(() => {
        for (const entry of options.components) {
          registrar.registerComponent(entry.component, entry.schema)
        }
        for (const entry of options.components) {
          if (entry.presets?.length) registrar.registerPreset(entry.presets)
        }
      })
    },
    destroy(): void {
      runInAction(() => {
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
      })
    },
  }
}

/**
 * Props every plugin-contributed console page receives from the shell's
 * generic host route. The shell owns auth + chrome + flag gating and
 * passes the resolved host and entitlement state in, so plugin pages stay
 * free of console-app hooks.
 */
export interface ConsolePluginPageProps {
  hostId: string
  /** True when the tenant holds the extension's `featureFlag` entitlement. */
  entitled: boolean
  /**
   * The resolved entitlement source (org billing doc) the shell already
   * loaded to compute `entitled`. Passed through so a plugin page can run
   * its own `checkEntitlement`/`checkQuota` (e.g. per-plan service limits)
   * without reaching for the console-app org/session hooks.
   */
  tenant?: Partial<AglynTenant>
  /**
   * The signed-in user's resolved org permissions (AGL-395), passed through
   * so a plugin page can gate actions (e.g. install/publish) without the
   * console-app session/permission hooks.
   */
  permissions?: Partial<TenantPermissions>
}

export type ConsolePluginPage = ComponentType<ConsolePluginPageProps>

export interface ConsoleNavItem {
  label: string
  /**
   * Host-relative console route (e.g. '/events'). The shell mounts it
   * under the active host ('/[hostId]/events') via its generic plugin
   * route, so the same string keys both the nav link and the page.
   */
  href: string
  icon?: MdiIconProps
  /**
   * Release-flag nav-tab id (e.g. 'nav-tab-events'). Lets the shell apply
   * the same staff-preview gating hardcoded tabs get; omit for always-on.
   */
  navTabId?: string
  /**
   * Page body rendered by the shell's generic host route. When present,
   * the plugin owns the whole surface — no core page file needed.
   */
  Component?: ConsolePluginPage
  /** Dashboard header for the plugin page (title + icon). */
  header?: { title: string; icon?: MdiIconProps }
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

/** A nav item flattened with its owning extension's id + entitlement flag. */
export interface ConsoleNavEntry extends ConsoleNavItem {
  pluginId: PluginId
  featureFlag?: keyof TenantFeatureFlags
}

/**
 * Every registered nav item, flattened for the shell's nav strip. The
 * shell appends these to its static tabs, so a plugin adds a menu item
 * by registering here — no edit to the console's nav constants.
 */
export function listConsoleNavItems(): ConsoleNavEntry[] {
  return listConsoleExtensions().flatMap((extension) =>
    (extension.navItems ?? []).map((navItem) => ({
      ...navItem,
      pluginId: extension.pluginId,
      featureFlag: extension.featureFlag,
    })),
  )
}

/**
 * Resolves a host-relative href (e.g. '/events') to the extension + nav
 * item that owns a renderable page for it. The shell's generic host route
 * uses this to render plugin pages without a per-plugin page file.
 */
export function resolveConsolePluginPage(
  href: string,
): { extension: ConsoleExtension; navItem: ConsoleNavItem } | undefined {
  for (const extension of consoleExtensions.values()) {
    for (const navItem of extension.navItems ?? []) {
      if (navItem.Component && navItem.href === href) {
        return { extension, navItem }
      }
    }
  }
  return undefined
}
