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
import type { OrgPermissions } from '../app-utils/org-permissions'
import type { AglynOrgBilling, OrgFeatureFlags } from '../foundation'
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
  /** True when the org holds the extension's `featureFlag` entitlement. */
  entitled: boolean
  /**
   * The ORG billing doc (`orgs/{orgId}`) the shell already loaded to
   * compute `entitled` (prop renamed from `tenant` in AGL-444). Passed
   * through so a plugin page can run its own `checkEntitlement`/
   * `checkQuota` (e.g. per-plan service limits) without reaching for the
   * console-app org/session hooks.
   */
  org?: Partial<AglynOrgBilling>
  /**
   * The signed-in user's resolved org permissions (AGL-395), passed through
   * so a plugin page can gate actions (e.g. install/publish) without the
   * console-app session/permission hooks.
   */
  permissions?: Partial<OrgPermissions>
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
  /** Rendered inside the org/host settings surface when present (AGL-419). */
  Component?: ComponentType<ConsolePluginPageProps>
}

/**
 * The injection-zone catalog (AGL-433, Strapi injection-zone parity):
 * every named slot the console shell renders through `PluginWidgetSlot`,
 * with what the slot receives. `slot` stays an open string so apps can
 * add custom zones without a core release; these are the guaranteed ones.
 */
export const CONSOLE_WIDGET_SLOTS = {
  /** Host dashboard + screen view activity column. Props: hostId. */
  hostActivity: 'hostActivity',
  /** Host dashboard commerce summary. Props: hostId, org. */
  commerceGlance: 'commerceGlance',
  /** Org Data page body. Props: orgId, org. */
  orgData: 'orgData',
  /** Besigner functions (ƒx) panel. Props: hostId. */
  besignerFunctions: 'besignerFunctions',
  /** Community listing detail body. Props: hostId, listingId, permissions. */
  communityListing: 'communityListing',
  /** Plugins & add-ons hub installs section. Props: hostId. */
  orgAddons: 'orgAddons',
  /** Bottom of the host dashboard. Props: hostId, org. (AGL-433) */
  dashboardFooter: 'dashboardFooter',
  /** Org settings page, below the tabbed cards. Props: orgId, org. */
  orgSettings: 'orgSettings',
  /** Host setup page, below the built-in cards. Props: hostId, org. */
  hostSettings: 'hostSettings',
  /** Staff admin org detail (staff-only surfaces). Props: orgId. */
  adminOrgDetail: 'adminOrgDetail',
} as const

export type ConsoleWidgetSlot =
  (typeof CONSOLE_WIDGET_SLOTS)[keyof typeof CONSOLE_WIDGET_SLOTS]

/**
 * A component a plugin renders into a NAMED console slot (AGL-419/433) —
 * see {@link CONSOLE_WIDGET_SLOTS} for the guaranteed zones and their
 * props. The shell owns placement; the plugin owns the UI.
 */
export interface ConsoleWidget {
  slot: string
  widgetId: string
  title?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<any>
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
  featureFlag?: keyof OrgFeatureFlags
  navItems?: ConsoleNavItem[]
  dashboardCards?: ConsoleDashboardCard[]
  settingsSections?: ConsoleSettingsSection[]
  /** Slot-addressed components the shell renders in place (AGL-419). */
  widgets?: ConsoleWidget[]
  /**
   * App-level providers the shell mounts around every console page
   * (AGL-419) — e.g. the community plugin's AI-assist provider.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providers?: Array<ComponentType<any>>
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
  featureFlag?: keyof OrgFeatureFlags
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

/** Widgets registered for a slot, across every extension (AGL-419). */
export function listConsoleWidgets(
  slot: string,
): Array<{ extension: ConsoleExtension; widget: ConsoleWidget }> {
  const out: Array<{ extension: ConsoleExtension; widget: ConsoleWidget }> = []
  for (const extension of consoleExtensions.values()) {
    for (const widget of extension.widgets ?? []) {
      if (widget.slot === slot) out.push({ extension, widget })
    }
  }
  return out
}

/** Providers registered by every extension, in registration order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listConsoleProviders(): Array<ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Array<ComponentType<any>> = []
  for (const extension of consoleExtensions.values()) {
    out.push(...(extension.providers ?? []))
  }
  return out
}
