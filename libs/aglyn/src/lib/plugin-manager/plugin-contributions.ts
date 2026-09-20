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
 * What a plugin contributes, and where (AGL-3116).
 *
 * A plugin loads only where something uses it. Installing one loads nothing:
 * a published page fetches a plugin's code when the page places one of its
 * elements or the site runs one of its features, and a console screen
 * fetches it when the screen renders one of its slots or routes, or when the
 * plugin draws something the shell renders on every screen.
 *
 * The loaders cannot learn that by running a plugin, because running it is
 * the cost being avoided. So each plugin DECLARES its contributions:
 * first-party plugins in `plugins.config.json`, marketplace plugins in the
 * manifest they publish (`contributes`). The declaration is the whole of what
 * a loader reads, and it is data: this module is dependency-free so the
 * server, both apps, the verifier and the build tools share one reading.
 *
 * A declared surface only narrows where to look. Presence is the rule: a
 * plugin that declares a component loads on the pages that place it, not on
 * every page of the site that installed it.
 *
 * ## A plugin that declares nothing
 *
 * Every marketplace version published before this contract has no
 * `contributes`. Such a plugin keeps working under one default:
 *
 * - **On a published page it loads only where its element is placed**: a
 *   node whose `pluginId` names the plugin (its manifest id or its listing
 *   id). That is the one presence signal a page carries without running the
 *   bundle, and it is the only way a page can show an element the plugin
 *   registers. A site runtime of an undeclared plugin does not load, and the
 *   publish pipeline refuses a bundle that registers one without declaring
 *   it, so the only plugins this default governs are the ones already
 *   published.
 * - **In the console it loads with the workspace shell**, as it always did,
 *   because a nav tab or a provider is only discoverable by running
 *   `register()`. Nothing on a published page depends on this.
 */

/** What a plugin adds to a published site. */
export interface PluginSiteContributions {
  /**
   * Canvas component ids the plugin registers: the elements a page places. A
   * published page loads the plugin only when its node tree places one.
   */
  components?: string[]
  /**
   * Site features: runtimes the plugin mounts on every page of a site that
   * switched it on (an announcement bar, an experiment runner), named by the
   * `runtimeId` it registers. A plugin with a feature loads on every page of
   * such a site, which is what a feature is.
   */
  features?: string[]
}

/** What a plugin adds to the console. */
export interface PluginConsoleContributions {
  /**
   * The widget slots its widgets fill: the `CONSOLE_WIDGET_SLOTS` zones, the
   * panels the shell draws as slots (the assistant dock `assistPanel`, the
   * besigner's `besignerInspector`), and zones another plugin hosts. A screen
   * that renders one of them loads the plugin.
   */
  slots?: string[]
  /** Site-level console routes it serves (`/forms`), beneath `/hosts/[host]`. */
  routes?: string[]
  /** Organization-level console routes it serves (`/outreach`). */
  orgRoutes?: string[]
  /**
   * The shell draws something of it on every screen of a workspace: a nav
   * tab, an organization tab, a staff tab or a provider. Such a plugin loads
   * with the shell, because every screen renders it.
   */
  shell?: boolean
}

export interface PluginContributions {
  site?: PluginSiteContributions
  console?: PluginConsoleContributions
}

/** Bound on each declared list, so a manifest cannot hand a loader a novel. */
export const PLUGIN_MAX_CONTRIBUTIONS = 128

/**
 * A component, feature or slot id: an identifier with the separators ids in
 * the platform use (`muiTypography`, `marketplacePlugin`, `ai.assist`).
 */
const CONTRIBUTION_ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,79}$/

/**
 * A console route: one or more path segments, as a nav item's `href` names
 * them. Never a URL, never `..`.
 */
const CONTRIBUTION_ROUTE = /^(\/[A-Za-z0-9_-]+){1,8}$/

type Sanitized =
  | { ok: true; contributions: PluginContributions }
  | { ok: false; error: string }

/**
 * Validates a declared `contributes` block.
 *
 * Malformed input is REFUSED rather than trimmed: a loader reads this to
 * decide where a plugin runs, so a declaration that silently lost an entry
 * would stop the plugin loading where it is used, and nobody would see why.
 * Duplicates are collapsed and empty lists dropped, because neither changes
 * what the declaration means.
 *
 * `{}` is valid and means "contributes nothing anywhere", which is a
 * different statement from an absent block (see the module note).
 */
export function sanitizePluginContributions(input: unknown): Sanitized {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'contributes must be an object' }
  }
  const out: PluginContributions = {}
  for (const key of Object.keys(input)) {
    if (key !== 'site' && key !== 'console') {
      return { ok: false, error: `contributes.${key} is not a known surface` }
    }
  }

  if (input['site'] !== undefined) {
    const site = input['site']
    if (!isPlainObject(site)) {
      return { ok: false, error: 'contributes.site must be an object' }
    }
    const next: PluginSiteContributions = {}
    for (const key of Object.keys(site)) {
      if (key !== 'components' && key !== 'features') {
        return { ok: false, error: `contributes.site.${key} is not a known contribution` }
      }
      const list = idList(site[key], `contributes.site.${key}`, CONTRIBUTION_ID)
      if (list.ok === false) return { ok: false, error: list.error }
      if (list.values.length) next[key] = list.values
    }
    if (Object.keys(next).length) out.site = next
  }

  if (input['console'] !== undefined) {
    const consoleInput = input['console']
    if (!isPlainObject(consoleInput)) {
      return { ok: false, error: 'contributes.console must be an object' }
    }
    const next: PluginConsoleContributions = {}
    for (const key of Object.keys(consoleInput)) {
      if (key === 'shell') {
        if (typeof consoleInput['shell'] !== 'boolean') {
          return { ok: false, error: 'contributes.console.shell must be true or false' }
        }
        if (consoleInput['shell']) next.shell = true
        continue
      }
      if (key !== 'slots' && key !== 'routes' && key !== 'orgRoutes') {
        return {
          ok: false,
          error: `contributes.console.${key} is not a known contribution`,
        }
      }
      const list = idList(
        consoleInput[key],
        `contributes.console.${key}`,
        key === 'slots' ? CONTRIBUTION_ID : CONTRIBUTION_ROUTE,
      )
      if (list.ok === false) return { ok: false, error: list.error }
      if (list.values.length) next[key] = list.values
    }
    if (Object.keys(next).length) out.console = next
  }

  return { ok: true, contributions: out }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function idList(
  value: unknown,
  where: string,
  pattern: RegExp,
): { ok: true; values: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: `${where} must be a list` }
  if (value.length > PLUGIN_MAX_CONTRIBUTIONS) {
    return { ok: false, error: `${where} lists more than ${PLUGIN_MAX_CONTRIBUTIONS}` }
  }
  const values: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !pattern.test(entry)) {
      return { ok: false, error: `${where} has an invalid entry "${String(entry)}"` }
    }
    if (!values.includes(entry)) values.push(entry)
  }
  return { ok: true, values }
}

/**
 * A declared `contributes` block as a loader may trust it: the sanitized
 * block, or `undefined` for one that is absent or does not validate.
 *
 * Loaders read this from stored documents (a pinned version's manifest), and
 * a malformed stored block is treated as UNDECLARED — the default applies —
 * never as "contributes nothing", which would stop a plugin that is in use.
 */
export function readPluginContributions(
  input: unknown,
): PluginContributions | undefined {
  if (input === undefined || input === null) return undefined
  const verdict = sanitizePluginContributions(input)
  return verdict.ok ? verdict.contributions : undefined
}

/**
 * What the surface a plugin is being registered into actually uses
 * (AGL-3141).
 *
 * The loaders carry this from the surface that computed it to each plugin's
 * register function, unchanged. A plugin that can register a part of itself
 * reads it; one that cannot ignores it, and the platform's behavior is the
 * same either way.
 *
 * An absent field means "everything of that kind". A surface that cannot say
 * what it uses must be handed all of it, because an element the surface
 * places and the set omits has no registered component and renders NOTHING,
 * silently (the blank-canvas invariant, AGL-52). Narrowing is an optimization
 * and must fail toward the whole.
 */
export interface PluginUse {
  /**
   * Canvas component ids the surface places, read from the FULL composed
   * document the way `pagePresence` reads it — withheld lazy-panel subtrees
   * included, because an element inside a panel the visitor opens later is
   * still this page's element.
   */
  componentIds?: readonly string[]
}

/** A node as presence reads it: the two ids a placed element carries. */
export interface PresenceNode {
  componentId?: string
  pluginId?: string
}

/** What a published page places: its component ids and the plugin ids stamped on its nodes. */
export interface PagePresence {
  componentIds: ReadonlySet<string>
  pluginIds: ReadonlySet<string>
}

/**
 * The component ids and plugin ids a node tree places.
 *
 * Read from the FULL composed document — layouts, grafted reusable
 * components and withheld lazy panels included — because an element inside
 * a panel the visitor opens later is still this page's element.
 */
export function pagePresence(
  nodes: Record<string, PresenceNode | null | undefined> | null | undefined,
): PagePresence {
  const componentIds = new Set<string>()
  const pluginIds = new Set<string>()
  for (const node of Object.values(nodes ?? {})) {
    if (typeof node?.componentId === 'string' && node.componentId) {
      componentIds.add(node.componentId)
    }
    if (typeof node?.pluginId === 'string' && node.pluginId) {
      pluginIds.add(node.pluginId)
    }
  }
  return { componentIds, pluginIds }
}

/** A plugin as the presence rules see it. */
export interface PresenceSubject {
  /** The plugin's own id (a manifest `id`, or a first-party catalog id). */
  pluginId?: string
  /** A marketplace plugin's listing id, which its elements may carry instead. */
  listingId?: string
  /** Its declaration; `undefined` when it declares nothing. */
  contributes?: PluginContributions
}

/**
 * Whether a published page uses a plugin, so the page must load it.
 *
 * - An element of it is placed: a node stamped with the plugin's id, or,
 *   for a declared plugin, a node whose component id it declares.
 * - It declares a site feature. The caller only asks about plugins the site
 *   has switched on, and a feature runs on every page of such a site.
 *
 * A plugin that declares nothing is present only through its stamped
 * elements — the default in the module note.
 */
export function isPluginUsedOnPage(
  subject: PresenceSubject,
  page: PagePresence,
): boolean {
  if (subject.pluginId && page.pluginIds.has(subject.pluginId)) return true
  if (subject.listingId && page.pluginIds.has(subject.listingId)) return true
  const site = subject.contributes?.site
  if (!site) return false
  if (site.features?.length) return true
  return (site.components ?? []).some((id) => page.componentIds.has(id))
}

/**
 * Where a plugin's console code loads, resolved with the default applied: a
 * plugin that declares nothing loads with the shell, as it always did.
 */
export interface ConsoleLoadPoints {
  shell: boolean
  slots: readonly string[]
  routes: readonly string[]
  orgRoutes: readonly string[]
}

export function consoleLoadPoints(
  contributes: PluginContributions | undefined,
): ConsoleLoadPoints {
  if (!contributes) return { shell: true, slots: [], routes: [], orgRoutes: [] }
  const declared = contributes.console ?? {}
  return {
    shell: Boolean(declared.shell),
    slots: declared.slots ?? [],
    routes: declared.routes ?? [],
    orgRoutes: declared.orgRoutes ?? [],
  }
}

/**
 * Whether a declared route serves `href`: the route itself, or a path beneath
 * it on a segment boundary, the way the shell's page resolver matches a nav
 * item that owns its subtree. `/products` serves `/products/orders` and never
 * `/products-archive`.
 */
export function routeServes(route: string, href: string): boolean {
  return href === route || href.startsWith(`${route}/`)
}

/**
 * A place in the console that loads plugins, as the surface drawing it names
 * itself (AGL-3142).
 *
 * - `shell`: the workspace chrome every screen has. It draws whatever a
 *   plugin adds to every screen — a nav tab, an organization tab, a staff
 *   tab, a provider — so a plugin that declares any of those loads here, and
 *   so does one that declares nothing at all.
 * - `slots`: the zones a screen renders. The zones it names, not the plugins
 *   it expects in them: a screen must never hold a plugin id.
 * - `route`: the path the reader has open, plugin-relative (`/products`,
 *   `/products/orders`), on the level its route tree serves — `site` beneath
 *   `/hosts/[host]`, `org` beneath the organization.
 */
export type ConsoleLoadWhere =
  | { at: 'shell' }
  | { at: 'slots'; slots: readonly string[] }
  | { at: 'route'; href: string; level: 'site' | 'org' }

/**
 * Whether a console surface uses a plugin, so it must load it.
 *
 * The console twin of {@link isPluginUsedOnPage}, and the same rule: a
 * declaration says where a plugin's code belongs, and the surface that draws
 * that place is the one that fetches it. A screen asks about the zones it
 * renders and the path it serves; it never asks about a plugin by name.
 *
 * A plugin that declares nothing loads with the shell — the default in the
 * module note, and the reason the shell branch reads
 * {@link consoleLoadPoints} rather than the raw block. Its nav tab or its
 * provider is only discoverable by running `register()`, so narrowing it
 * anywhere else would take a tab away with no way to notice.
 */
export function isPluginUsedInConsole(
  contributes: PluginContributions | undefined,
  where: ConsoleLoadWhere,
): boolean {
  const points = consoleLoadPoints(contributes)
  if (where.at === 'shell') return points.shell
  if (where.at === 'slots') {
    return points.slots.some((slot) => where.slots.includes(slot))
  }
  const routes = where.level === 'org' ? points.orgRoutes : points.routes
  return routes.some((route) => routeServes(route, where.href))
}
