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
   * The absolute console path this surface is mounted at — the nav item's
   * `href` under the active org and site, e.g. `/acme/hosts/shop/products`
   * (AGL-2501).
   *
   * A plugin page is handed a host DOC ID and nothing else, so building a
   * link to itself meant resolving the org slug and subdomain from Firestore
   * — two `getDoc`s that answer `null` on first paint, which for a section
   * rail means drawing it without hrefs. The shell already knows this string
   * synchronously; the alternative is paying for it again, later, per page.
   */
  basePath?: string
  /**
   * The nav item's declared {@link ConsoleNavItem.sections}, resolved: an
   * absolute `href` per section, and the release-flag verdict already applied
   * to `visible` (AGL-2501).
   *
   * The plugin DECLARES sections; the shell RESOLVES them. Release flags live
   * in `scope:app` and a `scope:lib` plugin may not import the hooks that read
   * them, so a page that filtered its own rail could only do it by guessing —
   * and a rail offering a link into the shell's own "coming soon" notice is
   * the guess going wrong. Feed this straight to `HubSections`.
   */
  sections?: readonly ResolvedConsoleNavSection[]
  /**
   * The id of the section the URL names, or undefined on the nav item's own
   * href (AGL-2501).
   *
   * Always one of the declared `sections` — the shell 404s an id it does not
   * recognize rather than passing it down, so a page may switch on this
   * without a fallback branch for a section it does not have.
   */
  section?: string
  /**
   * Path segments beneath `basePath`, `[]` on the nav item's own href
   * (AGL-2501). `segments[0]` is `section`; anything after it is the section's
   * own, so a section can own deeper routes (`…/orders/ord_123`) without a
   * further registry change.
   */
  segments?: readonly string[]
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
  /**
   * Widened past the legacy six (AGL-2474): plugin-declared keys such as
   * commerce's `managePos` are resolved into the same map, and typing this
   * `Partial<OrgPermissions>` meant a plugin could not read its OWN
   * permission without a cast — the declared key was not assignable.
   */
  permissions?: Partial<OrgPermissions> & Record<string, boolean | undefined>
  /**
   * The verdict for the release flag that governs this surface (AGL-1662),
   * resolved by the shell from the nav item's `navTabId` — the same flag
   * `FeatureGate` applies around the page body.
   *
   * `FeatureGate` admits staff with the flag OFF, so a plugin page can be
   * looking at an org that does not have the feature and is not being
   * billed for it. Anything the page says about MONEY has to follow the
   * flag rather than the viewer, and this is how a plugin page gets that
   * answer without reaching for the console-app release-flag hooks (which
   * live in `scope:app` and are off-limits to a `scope:lib` plugin).
   */
  releaseFlag?: {
    /**
     * The rollout verdict for this ORG — staff bypass deliberately NOT
     * applied. `visible` is what decides who sees a page; this is what
     * decides what the invoice carries, and staff opening a page must not
     * put a line on a customer's bill.
     */
    released: boolean
    /**
     * True once the flag verdict has settled. Release flags are default-off
     * before Remote Config activation, so an ungated claim asserts the
     * withheld case for one paint on an org that may well be billed.
     */
    ready: boolean
  }
}

export type ConsolePluginPage = ComponentType<ConsolePluginPageProps>

/**
 * One routed section of a plugin console page (AGL-2501).
 *
 * A section is a real URL beneath the nav item's `href`, not a panel: it is
 * linkable, the back button walks sections, and the page mounts the one being
 * read. That last part is the reason this exists — a six-panel hub subscribes
 * every panel's queries on load, and the reader is looking at one.
 */
export interface ConsoleNavSection {
  /**
   * URL segment beneath the nav item's `href`, and the id the shell hands the
   * page as `section`. Appears in links people keep — treat it as persisted.
   */
  id: string
  label: string
  /**
   * Release-flag nav-tab id gating THIS section, when it ships on a different
   * schedule than the surface around it. Omit to inherit the nav item's gate,
   * which is the common case.
   *
   * Declaring one NARROWS, never widens: the nav item's own gate is applied
   * outside this one, so a section of a flagged-off surface stays unreachable
   * whatever it declares. A section gated by its own flag is refused on a deep
   * link exactly as it is hidden from the rail — one verdict, both places.
   */
  navTabId?: string
}

/** A {@link ConsoleNavSection} with the shell's answers filled in. */
export interface ResolvedConsoleNavSection {
  id: string
  label: string
  /** Absolute console path — `${basePath}/${id}`. */
  href: string
  /** False when this section's release flag hides it from this viewer. */
  visible: boolean
}

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
  /**
   * Routed sections of this page (AGL-2501). Each becomes a URL at
   * `${href}/${section.id}`, and the shell tells the page which one it is on.
   *
   * Optional, and omitting it is not a lesser option — it means the surface is
   * ONE page, which is what every plugin surface was before this existed and
   * what most should stay. A nav item without sections resolves exactly as it
   * always has: its own href and nothing beneath it, so a path under it is a
   * 404 rather than this page rendered again.
   */
  sections?: readonly ConsoleNavSection[]
  /**
   * Dashboard header for the plugin page (title + icon), and the docs topic
   * its help `?` explains.
   *
   * `docsTopic` is a plain string rather than the console's
   * `DocsHelpTopicKey` because that registry lives in `apps/console` and a
   * lib cannot import from an app. The console validates it and falls back
   * to the marketplace topic when it does not resolve — which is not just
   * defensive: a third-party plugin can name any string, and the alternative
   * to a fallback is a help button that throws on hover (AGL-1074).
   *
   * Every surface mounted by the shell's generic plugin route shares one
   * `help=` prop, so a surface that omits this is not "help-less" — it
   * inherits Plugins & Marketplace, which reads as if it were its own.
   */
  header?: { title: string; icon?: MdiIconProps; docsTopic?: string }
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
  /** Marketplace listing detail body. Props: hostId, listingId, permissions. */
  marketplaceListing: 'marketplaceListing',
  /**
   * Org marketplace browse body (AGL-772). Props: hostId (acting site),
   * permissions, orgScoped. The single org-scope place to browse + install,
   * replacing the per-site marketplace tab.
   */
  orgMarketplace: 'orgMarketplace',
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
 *
 * That sentence describes `apps/console/utils/extension-entitlement.ts`,
 * which the plugin route and `PluginWidgetSlot` both call before they mount
 * anything an extension registered (AGL-2484). It was an aspiration until
 * then: the route resolved the entitlement and handed it to the extension as
 * the `entitled` PROP, and the widget slot did not resolve it at all, so
 * enforcement rested on each extension policing itself — which one
 * first-party page did not do.
 *
 * What the gate covers, exactly: a `featureFlag` refuses to RENDER the
 * extension's page body and its widgets. Nav items stay visible on purpose.
 * Hiding the tab would hide the only route most workspaces have to the page
 * that sells the feature, and a nav entry leading to the shell's own upgrade
 * notice bypasses nothing.
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
   * (AGL-419) — e.g. the marketplace plugin's AI-assist provider.
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

/**
 * Registration-ordered extensions; the console shell filters by flag.
 *
 * AGL-758: the registry is a module-global that only ever grows — nothing
 * outside tests unregisters, and loaded chunks can't unload — so after
 * visiting two workspaces it holds the UNION of both plugin sets. Every
 * read is therefore scoped by the caller's effective enabled set; pass the
 * current org's plugin ids so one workspace never serves another's nav
 * items, widgets, pages or providers. Omitting the argument keeps the
 * unfiltered union (tests, and non-org surfaces that have no such set).
 */
export function listConsoleExtensions(
  enabledPluginIds?: readonly PluginId[],
): ConsoleExtension[] {
  const all = Array.from(consoleExtensions.values())
  if (!enabledPluginIds) return all
  const enabled = new Set(enabledPluginIds)
  return all.filter((extension) => enabled.has(extension.pluginId))
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
export function listConsoleNavItems(
  enabledPluginIds?: readonly PluginId[],
): ConsoleNavEntry[] {
  return listConsoleExtensions(enabledPluginIds).flatMap((extension) =>
    (extension.navItems ?? []).map((navItem) => ({
      ...navItem,
      pluginId: extension.pluginId,
      featureFlag: extension.featureFlag,
    })),
  )
}

/** What {@link resolveConsolePluginPage} answers for a matched href. */
export interface ResolvedConsolePluginPage {
  extension: ConsoleExtension
  navItem: ConsoleNavItem
  /**
   * The section the href names, when the nav item declares sections and the
   * href reaches past its own. Undefined on the nav item's own href.
   */
  section?: ConsoleNavSection
  /** Path segments beneath `navItem.href`; `[]` on the nav item's own href. */
  segments: readonly string[]
}

/**
 * One nav item against one href: exact, or a declared section beneath it.
 *
 * A nav item with NO sections matches its own href and nothing else. That is
 * what keeps every plugin written before AGL-2501 behaving as it did: without
 * it, prefix matching would quietly hand `/products/anything` to the Products
 * page, which is the "it opened the wrong page" report rather than a 404.
 */
function matchNavItem(
  navItem: ConsoleNavItem,
  href: string,
): { section?: ConsoleNavSection; segments: readonly string[] } | undefined {
  if (navItem.href === href) return { segments: [] }
  if (!navItem.sections?.length) return undefined
  // On a separator boundary, so `/products` cannot claim `/products-archive`.
  if (!href.startsWith(`${navItem.href}/`)) return undefined
  const segments = href.slice(navItem.href.length + 1).split('/').filter(Boolean)
  const section = navItem.sections.find((item) => item.id === segments[0])
  // An id the nav item never declared is NOT this page. Returning the nav item
  // anyway would render the surface's default section under a URL naming a
  // different one, which reads to the person who typed it as the wrong page
  // opening rather than as a typo.
  return section ? { section, segments } : undefined
}

/**
 * Resolves a host-relative href (e.g. '/events', '/products/orders') to the
 * extension + nav item that owns a renderable page for it, and the section
 * within it. The shell's generic host route uses this to render plugin pages
 * without a per-plugin page file.
 *
 * ## Which registration wins (AGL-2501)
 *
 * LONGEST declared `href` wins, and an exact match therefore always beats a
 * section match — an exact `href` spans the whole path, so nothing matching a
 * prefix of it can be longer. `/products/orders` goes to a plugin that
 * declares that path over one that declares `/products` with an `orders`
 * section, and a prefix only matches on a SEGMENT boundary, so `/products`
 * never claims `/products-archive`.
 *
 * A TIE REFUSES. Two enabled plugins matching the same path at the same length
 * resolve to nothing, and the console 404s. Registry insertion order is an
 * accident of which chunk loaded first, so picking from it means one
 * workspace serves plugin A's page at a URL where another serves plugin B's —
 * silently, and differently per session. Nobody can debug that from the
 * symptom, so it is refused and logged instead. Two nav items of the SAME
 * extension are not a tie: that order is authored, and the first wins as it
 * always has.
 *
 * This is a rule rather than an accident because the registry is a
 * session-wide UNION across plugins from different authors (AGL-758) — one
 * plugin registering `/products` and another `/products/orders` is two
 * workspaces' code meeting in one module-global, not one author's tidiness
 * problem. Scoping is unchanged and load-bearing: every candidate still comes
 * from `listConsoleExtensions(enabledPluginIds)`, so a plugin the current org
 * has not enabled cannot win a path — or collide with one.
 */
export function resolveConsolePluginPage(
  href: string,
  enabledPluginIds?: readonly PluginId[],
): ResolvedConsolePluginPage | undefined {
  let best: ResolvedConsolePluginPage | undefined
  /** Extensions matching at `best`'s length — more than one is the tie. */
  let contenders: PluginId[] = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    for (const navItem of extension.navItems ?? []) {
      if (!navItem.Component) continue
      const match = matchNavItem(navItem, href)
      if (!match) continue
      const bestLength = best?.navItem.href.length ?? -1
      if (navItem.href.length > bestLength) {
        best = { extension, navItem, ...match }
        contenders = [extension.pluginId]
        continue
      }
      // Same length, different plugin: ambiguous. Same plugin: authored order,
      // and the first nav item keeps the path.
      if (
        navItem.href.length === bestLength &&
        !contenders.includes(extension.pluginId)
      ) {
        contenders.push(extension.pluginId)
      }
    }
  }
  if (contenders.length > 1) {
    // Loud, because the symptom — a 404 on a page that is plainly installed —
    // names neither plugin. This line is the only place the collision is
    // visible, so it carries both ids and the path they are fighting over.
    console.error(
      `[aglyn] console page path "${href}" is claimed by more than one ` +
        `enabled plugin (${contenders.join(', ')}); refusing to guess which ` +
        'one owns it. Change one plugin\'s nav item href.',
    )
    return undefined
  }
  return best
}

/** Widgets registered for a slot, across every extension (AGL-419). */
export function listConsoleWidgets(
  slot: string,
  enabledPluginIds?: readonly PluginId[],
): Array<{ extension: ConsoleExtension; widget: ConsoleWidget }> {
  const out: Array<{ extension: ConsoleExtension; widget: ConsoleWidget }> = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    for (const widget of extension.widgets ?? []) {
      if (widget.slot === slot) out.push({ extension, widget })
    }
  }
  return out
}

/** Providers registered by every extension, in registration order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listConsoleProviders(
  enabledPluginIds?: readonly PluginId[],
): Array<ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Array<ComponentType<any>> = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    out.push(...(extension.providers ?? []))
  }
  return out
}
