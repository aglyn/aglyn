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
 * Per-org plugin enablement (AGL-416): `org.enabledPlugins` is the
 * switchboard that decides which plugins LOAD for a workspace — the loader
 * (AGL-417) dynamically imports only these. It composes with (not replaces)
 * the existing gates: a surface renders when its plugin is enabled AND its
 * `featureFlag` entitlement resolves; marketplace/marketplace listings keep
 * their per-host/org `installs` docs on top.
 *
 * The catalog's rows are declared by the plugins themselves, in
 * `plugins.config.json`, beside the package names the loader manifests are
 * generated from; this module holds the row's shape and the resolvers.
 */

import {
  FIRST_PARTY_PLUGINS,
  PLUGIN_EDIT_BAR_LINKS,
  PUBLISHED_SITE_IMPACT,
} from './first-party-plugins.generated'

/**
 * One quick link on a live site's admin edit bar, declared by the plugin whose
 * console page it opens (AGL-3080).
 *
 * The bar is drawn by the TENANT server, which never loads a plugin's console
 * code, so this is DATA compiled from `plugins.config.json` rather than a
 * runtime registration — a registry that process had not filled would drop the
 * link silently instead of failing, which is the AGL-3025 shape. It is also
 * why the label is written here rather than taken from the plugin's nav item:
 * the nav item lives in the console bundle, and "Orders" is a section of
 * Commerce rather than the plugin's own name.
 *
 * The link is drawn only where the SITE runs the plugin. The bar asks the same
 * resolved plugin set the rest of the edit context is built from, so a site
 * with Commerce switched off is not offered its Orders page.
 */
export interface PluginEditBarLink {
  /** The plugin that owns the page — also the id the site's set is checked against. */
  pluginId: string
  /** Where it sits in the bar; every declared order is distinct. */
  order: number
  /** What the bar says. A SECTION's name where that is the honest one. */
  label: string
  /**
   * Console path beneath the site, beginning with `/` and carrying no query —
   * `/inbox`, `/products/orders`. Joined onto `/{orgSlug}/hosts/{host}`.
   */
  path: string
}

export interface FirstPartyPlugin {
  /**
   * Stable plugin id — persisted in `org.enabledPlugins`,
   * `host.disabledPlugins` and `host.enabledPlugins`, and the document id
   * under every `pluginSettings` collection.
   *
   * Renaming one is therefore a data change, not a code change, and it is
   * done in two halves that must both ship: the old id is read through
   * {@link canonicalPluginId} so every stored list still resolves, and a
   * backfill rewrites the stored documents so the alias can be retired once
   * it reads nothing.
   */
  id: string
  /** Console-facing display name. */
  label: string
  /**
   * On for every workspace AND every site, with no switch anywhere: the base
   * component library the canvas cannot render without.
   */
  alwaysOn?: boolean
  /**
   * On for every WORKSPACE, and switchable for one SITE (AGL-3028, AGL-3029).
   *
   * The workspace half is what `alwaysOn` gives: the id is unioned into the
   * org's resolved set whatever `org.enabledPlugins` stores, so a list saved
   * before the plugin existed still runs it, and no workspace switch is
   * offered. The site half is ordinary: the id is subtracted by a site's
   * `disabledPlugins` deny-list like any other, so an absent host field means
   * ON and nothing needs migrating.
   *
   * It exists for capabilities whose workspace-level half must never stop.
   * AI carries the add-on, credits, allotments and overage billing, none of
   * which belongs to a site; Forms carries the catalog and the submissions
   * already stored. A workspace switch would take those down with the
   * site-facing half, so the only switch is the site's.
   */
  alwaysOnForWorkspace?: boolean
  /**
   * What switching this plugin off for ONE site stops, and what it leaves
   * running (AGL-3028, AGL-3029) — the copy the site's Admin › Plugins page
   * states beside the switch, so the decision is made knowing both halves.
   *
   * `confirm` makes the site switch ask before it applies, naming what it is
   * about to break on published pages.
   */
  siteOff?: {
    /** What stops on the site, stated as the consequence. */
    stops: string
    /** What keeps running, because it carries no site. */
    keeps: string
    /** Ask before applying. */
    confirm?: boolean
    /**
     * How the confirmation names the site's published pages the switch
     * reaches (AGL-3029): the sentence above the list, and the one that
     * stands in for an empty list when the scan read everything.
     */
    pages?: { heading: string; none: string }
  }
  /** One-line description for the org-settings toggle list. */
  description?: string
  /**
   * Release flag gating this plugin platform-wide (AGL-422). A flagged-off
   * plugin is subtracted from every workspace's effective set — console
   * loader, published sites, and API dispatch — unless the subject is
   * staff. Always-on plugins carry no flag.
   */
  releaseFlag?: string
  /**
   * OFF for a site until that site turns it on (AGL-2486) — the inversion of
   * this switchboard's default, and the only field here that changes what an
   * absent host doc means.
   *
   * The per-host field is a DENY-list: a site records what it switches off,
   * which makes "absent means on" the default for all twelve other bundles.
   * That is right for a capability whose worst case is an unused nav tab, and
   * wrong for one whose worst case is a PAGE — `/signin`, `/signup`,
   * `/recover` were served by every published site on the platform,
   * including marketing sites whose real sign-in is somewhere else entirely.
   * A sign-in-shaped page on a brand's own domain that is not that brand's
   * sign-in is a credential-confusion hazard, so this one defaults closed.
   *
   * A site un-defaults it by listing the id in `host.enabledPlugins`. That
   * list is scoped to default-off ids and cannot widen anything else, so the
   * AGL-1014 invariant survives intact: a site still can never reach past
   * what its org enables.
   */
  defaultOffPerSite?: boolean
  /**
   * Plugin ids this one cannot function without (AGL-2486) — DECLARED, never
   * inferred.
   *
   * The switchboard has always let a workspace turn off a plugin another one
   * is built on, and said nothing. `accounts` is the case that proves it: the
   * Members blocks and every `membership/*` API handler ship inside the
   * COMMERCE bundle, so switching Commerce off leaves a site advertising
   * `/signin` while nothing can answer the login POST.
   *
   * Declared rather than derived on purpose. The couplings that matter are
   * exactly the ones no static read can see — which bundle happens to
   * register whose components — so a graph inferred from imports or from the
   * registry would miss the real edges while looking authoritative. An
   * incomplete warning that presents itself as complete is worse than none,
   * so this list is the contract, and {@link resolveDisableCascade} is honest
   * about covering only what is on it.
   */
  requires?: readonly string[]
}

/**
 * What a DISABLE does to a site that is already published (AGL-2486).
 *
 * The cascade dialog has to state a consequence, and there are two very
 * different ones. "These blocks will no longer be offered" is a different
 * decision from "parts of your live pages go blank", and one generic sentence
 * for both would be a lie in one direction or the other.
 *
 * - `elements` — the plugin registers site components. The tenant loads only
 *   the site's enabled bundles, so elements ALREADY PLACED on published pages
 *   stop rendering. Pre-existing AGL-1014 behaviour.
 * - `routes`   — the plugin registers no components, but a published site
 *   stops serving something: `accounts` gates `/signin`, `/signup`,
 *   `/recover`; `redirects` stops applying its rules; `workflows` stops
 *   answering its hooks.
 * - `console-only` — nothing a visitor can reach changes; the plugin leaves
 *   navigation and the editor.
 */
export type PublishedSiteImpact = 'elements' | 'routes' | 'console-only'

/**
 * Every catalog id classified, from the `publishedSiteImpact` each plugin
 * declares on its own row. The generator refuses a row whose verdict
 * disagrees with its `register.site`, so a site-registering bundle cannot be
 * added without declaring its consequence.
 */
export { PUBLISHED_SITE_IMPACT }

/**
 * The user-accounts capability (AGL-2486): visitor sign-in, sign-up and
 * password recovery on a published site.
 *
 * It carries no loader manifest entry, and that is deliberate rather than an
 * oversight. The member blocks and the `membership/*` API handlers already
 * ship inside the commerce bundle, so there is no separate package to load;
 * what this id contributes is the SWITCH — the thing the tenant route gate,
 * the console card and the sitemap all ask. Several catalog ids already have
 * no tenant bundle (`contacts`, `data`, `logic`), so a manifest-less entry is
 * the existing shape, not a new one.
 */
export const ACCOUNTS_PLUGIN_ID = 'accounts'

/**
 * The Forms capability's id, named in core (AGL-3029).
 *
 * A form's server half is core — `/api/forms/submit`, the publish-time
 * contract check, the published page's render — and core may not import a
 * plugin, so each asks the site's plugin set about this id rather than asking
 * the Forms plugin anything.
 */
export const FORMS_PLUGIN_ID = 'forms'

/**
 * The switchboard catalog. The core holds no row of it: each plugin declares
 * its own in `plugins.config.json` (`catalog`, and one per `capabilities`
 * entry), and the generator compiles them here in their declared order, so
 * adding a plugin edits no core file.
 *
 * Compiled in rather than registered at runtime, because every resolver below
 * is synchronous and runs in each bundle of both apps; a registry that one of
 * those bundles had not filled would read as every plugin switched OFF.
 */
export { FIRST_PARTY_PLUGINS }

/**
 * The admin edit bar's quick links that THIS SITE runs, in the order the bar
 * draws them (AGL-3080).
 *
 * `enabledPluginIds` is the site's resolved plugin set — the same one the rest
 * of the edit context is built from, already narrowed by the org's switchboard,
 * the site's own deny-list and the release flags. A link whose plugin is not
 * in it is not offered, which is what stops the bar linking a site with
 * Commerce switched off to its Orders page.
 *
 * Compiled in rather than registered, for the reason the catalog above is:
 * the tenant server draws this bar and never loads a plugin's console code,
 * so a registry it had not filled would drop every link with nothing red.
 */
export function pluginEditBarLinks(
  enabledPluginIds: readonly string[] | undefined,
): readonly PluginEditBarLink[] {
  const enabled = new Set(enabledPluginIds ?? [])
  return PLUGIN_EDIT_BAR_LINKS.filter((link) => enabled.has(link.pluginId))
}

/** Ids loaded for orgs that have never touched the switchboard. */
export const DEFAULT_ENABLED_PLUGINS: readonly string[] =
  FIRST_PARTY_PLUGINS.map((plugin) => plugin.id)

/**
 * The id a stored plugin id means today — the seam a rename re-arms.
 *
 * A first-party id is written into every org's `enabledPlugins` and every
 * site's `disabledPlugins` the moment somebody touches the switchboard, so a
 * rename in this file alone would silently turn the plugin OFF for every
 * workspace that had listed it under the old name — the stored id would match
 * nothing in the catalog and fall through as a marketplace listing id. Every
 * reader of a stored list runs it through here first, so a document written
 * before a rename keeps meaning what it meant while the backfill runs.
 *
 * Nothing is aliased today. `contacts` read as `crm` from the CRM's rename
 * (AGL-2595) until its backfill reported zero documents carrying the old id,
 * and the alias was retired (AGL-2614) — an alias that outlives its backfill
 * is a second name for the plugin that nothing writes and every reader must
 * keep honoring. The next rename adds its pair here, ships a backfill over
 * `org.enabledPlugins`, `host.disabledPlugins`, `host.enabledPlugins` and the
 * `pluginSettings` document ids, and removes the pair the same way.
 */
export function canonicalPluginId(pluginId: string): string {
  return pluginId
}

/** A stored list, read through the alias seam and de-duplicated. */
function canonicalPluginIds(pluginIds: readonly unknown[]): string[] {
  return Array.from(
    new Set(pluginIds.map((id) => canonicalPluginId(String(id)))),
  )
}

/** On everywhere, a site's deny-list included: the base component library. */
const ALWAYS_ON: readonly string[] = FIRST_PARTY_PLUGINS.filter(
  (plugin) => plugin.alwaysOn,
).map((plugin) => plugin.id)

/**
 * Unioned into every workspace's set whatever the org stored: {@link ALWAYS_ON}
 * plus the ids that are on for every workspace and switchable per site.
 */
const ALWAYS_ON_FOR_WORKSPACE: readonly string[] = FIRST_PARTY_PLUGINS.filter(
  (plugin) => plugin.alwaysOn || plugin.alwaysOnForWorkspace,
).map((plugin) => plugin.id)

/**
 * Whether the WORKSPACE switch for this plugin is locked on (AGL-3028): the
 * base library, and every plugin that is on for every workspace and
 * switchable only per site. The org switchboard renders these on and inert.
 */
export function isLockedOnForWorkspace(pluginId: string): boolean {
  return ALWAYS_ON_FOR_WORKSPACE.includes(pluginId)
}

/**
 * Whether the SITE switch for this plugin is locked on: the base library
 * alone. Every other plugin a workspace runs can be switched off for one site.
 */
export function isLockedOnForSite(pluginId: string): boolean {
  return ALWAYS_ON.includes(pluginId)
}

const FIRST_PARTY_IDS: ReadonlySet<string> = new Set(
  FIRST_PARTY_PLUGINS.map((plugin) => plugin.id),
)

/**
 * Ids a SITE does not get until it asks (AGL-2486). See
 * {@link FirstPartyPlugin.defaultOffPerSite} for why this inversion exists.
 */
export const DEFAULT_OFF_PER_SITE_PLUGIN_IDS: ReadonlySet<string> = new Set(
  FIRST_PARTY_PLUGINS.filter((plugin) => plugin.defaultOffPerSite).map(
    (plugin) => plugin.id,
  ),
)

/** Whether a plugin id is off for a site until that site opts in. */
export function isDefaultOffPerSite(pluginId: string): boolean {
  return DEFAULT_OFF_PER_SITE_PLUGIN_IDS.has(pluginId)
}

/**
 * Applies a host's `enabledPlugins` OPT-IN list (AGL-2486): subtracts every
 * default-off id the host has not explicitly asked for.
 *
 * Narrow-only, like its deny-list sibling. The list can only ever REMOVE the
 * default-off subtraction for an id the org already enables — listing an
 * ordinary id buys nothing, and listing one the org switched off buys
 * nothing either, because this runs against the org's resolved set.
 */
export function applyDefaultOffOptIn(
  pluginIds: readonly string[],
  optedIn?: readonly string[] | null,
): string[] {
  if (!DEFAULT_OFF_PER_SITE_PLUGIN_IDS.size) return [...pluginIds]
  const asked = new Set(
    Array.isArray(optedIn) ? canonicalPluginIds(optedIn) : [],
  )
  return pluginIds.filter(
    (id) => !DEFAULT_OFF_PER_SITE_PLUGIN_IDS.has(id) || asked.has(id),
  )
}

/**
 * Whether an `enabledPlugins` id is a first-party BUNDLE (vs a marketplace
 * listing id) — AGL-777. `enabledPlugins` is a flat mix of the two: bundle
 * ids are the short, stable names in {@link FIRST_PARTY_PLUGINS}; marketplace
 * installs ride the same field under their Firestore listing doc id. This is
 * the single classifier both writers and readers use so the two kinds never
 * get confused — e.g. an install sync must never add/remove a bundle id.
 */
export function isFirstPartyPlugin(pluginId: string): boolean {
  return FIRST_PARTY_IDS.has(pluginId)
}

/**
 * Splits a mixed `enabledPlugins` array into first-party bundle ids and
 * marketplace listing ids (AGL-777). The field stays a single flat list;
 * this just names the two kinds for callers that need to treat them apart.
 */
export function classifyEnabledPlugins(pluginIds: readonly string[]): {
  bundles: string[]
  listings: string[]
} {
  const bundles: string[] = []
  const listings: string[] = []
  for (const id of pluginIds) {
    if (isFirstPartyPlugin(id)) bundles.push(id)
    else listings.push(id)
  }
  return { bundles, listings }
}

/**
 * The org's effective enabled-plugin set. Absent field → every first-party
 * plugin (existing orgs keep working untouched); always-on ids — and the ids
 * that are on for every workspace and switchable only per site — are unioned
 * in, so no stored list can switch them off for a workspace, including one
 * saved before the plugin existed. Unknown ids are kept — realm-trusted
 * marketplace plugins (AGL-420) ride the same field.
 */
export function resolveEnabledPlugins(
  org?: { enabledPlugins?: string[] } | null,
): string[] {
  const configured = org?.enabledPlugins
  const base = Array.isArray(configured)
    ? canonicalPluginIds(configured)
    : [...DEFAULT_ENABLED_PLUGINS]
  return Array.from(new Set([...ALWAYS_ON_FOR_WORKSPACE, ...base]))
}

/**
 * Subtracts a host's per-site deny-list from an enabled set (AGL-1014).
 * Always-on ids survive — the base component library cannot be switched
 * off per site any more than per org. A plugin that is on for every
 * workspace (`alwaysOnForWorkspace`) does NOT survive: its site switch is
 * the one switch it has. Order of the surviving ids is kept.
 */
export function subtractDisabledPlugins(
  pluginIds: readonly string[],
  disabledPlugins?: readonly string[] | null,
): string[] {
  if (!Array.isArray(disabledPlugins) || !disabledPlugins.length)
    return [...pluginIds]
  const disabled = new Set(canonicalPluginIds(disabledPlugins))
  return pluginIds.filter(
    (id) => ALWAYS_ON.includes(id) || !disabled.has(id),
  )
}

/**
 * A HOST's effective enabled-plugin set (AGL-1014): the org's resolved set
 * minus the host's `disabledPlugins` deny-list. This is the single source
 * of truth for per-site enablement — console navigation, the editor,
 * published sites, and API dispatch must all read it, or a "disabled"
 * plugin is merely hidden, not off.
 *
 * Semantics are narrow-only by construction: a host stores what it turns
 * OFF, so it can never widen beyond what the org enables, and an absent
 * field means every org-enabled plugin runs (newly installed plugins
 * default to enabled per site until a host admin disables them).
 *
 * ONE class of id reads the other way (AGL-2486): a `defaultOffPerSite`
 * plugin is subtracted unless the host names it in `enabledPlugins`. That
 * list un-defaults; it does not grant. Both fields are still bounded by the
 * org's set, and an explicit deny still beats an explicit opt-in — the two
 * are applied in that order below, so the safe reading wins whenever a
 * hand-edited or stale doc sets both.
 */
export function resolveHostEnabledPlugins(
  org?: { enabledPlugins?: string[] } | null,
  host?: { disabledPlugins?: string[]; enabledPlugins?: string[] } | null,
): string[] {
  return subtractDisabledPlugins(
    applyDefaultOffOptIn(resolveEnabledPlugins(org), host?.enabledPlugins),
    host?.disabledPlugins,
  )
}

/**
 * Whether ONE plugin runs on this site — the host-aware counterpart of
 * {@link isPluginEnabled}, and the form every route gate wants.
 */
export function isHostPluginEnabled(
  org: { enabledPlugins?: string[] } | null | undefined,
  host: { disabledPlugins?: string[]; enabledPlugins?: string[] } | null | undefined,
  pluginId: string,
): boolean {
  return resolveHostEnabledPlugins(org, host).includes(pluginId)
}

export function isPluginEnabled(
  org: { enabledPlugins?: string[] } | null | undefined,
  pluginId: string,
): boolean {
  return resolveEnabledPlugins(org).includes(pluginId)
}

/**
 * Where one plugin stands ON ONE SITE (AGL-1014, AGL-2486).
 *
 * Three surfaces need this answer and they must not each derive it: the site
 * plugin page's "Where it runs" card, that page's dependency list — where the
 * same question is asked about a NEIGHBOR, and where the answer is the whole
 * point, because a dependency the workspace enables and this site has switched
 * off is a broken plugin behind a healthy-looking workspace page — and the
 * per-site switchboard. A second derivation is a second chance to disagree
 * with `resolveHostEnabledPlugins`, which is what actually runs.
 *
 * - `always-on`         — the base library; it cannot be switched off anywhere.
 *                         A plugin that is on for every workspace but
 *                         switchable per site is NOT this: it reads
 *                         `runs-here` or `off-for-site` like any other.
 * - `off-for-workspace` — the org has it off, so it runs on none of its sites
 *                         and this site cannot turn it on.
 * - `runs-here`         — the effective host set contains it.
 * - `awaiting-opt-in`   — a `defaultOffPerSite` plugin the org enables and
 *                         this site has not asked for. Off, but off by
 *                         DEFAULT rather than by a decision, which is a
 *                         different thing to tell an operator.
 * - `off-for-site`      — the org enables it and this site switched it off.
 */
export type PluginSiteState =
  | 'always-on'
  | 'off-for-workspace'
  | 'runs-here'
  | 'awaiting-opt-in'
  | 'off-for-site'

export function resolvePluginSiteState(
  org: { enabledPlugins?: string[] } | null | undefined,
  host: { disabledPlugins?: string[]; enabledPlugins?: string[] } | null | undefined,
  pluginId: string,
): PluginSiteState {
  if (ALWAYS_ON.includes(pluginId)) return 'always-on'
  if (!resolveEnabledPlugins(org).includes(pluginId)) return 'off-for-workspace'
  if (resolveHostEnabledPlugins(org, host).includes(pluginId)) return 'runs-here'
  // A default-off plugin this site has not named is off because nobody asked
  // for it; naming it in the deny-list is a decision, and an explicit deny
  // beats an opt-in, so the deny-list is checked first.
  const denied = Array.isArray(host?.disabledPlugins)
    ? host.disabledPlugins.map(String).includes(pluginId)
    : false
  return !denied && isDefaultOffPerSite(pluginId)
    ? 'awaiting-opt-in'
    : 'off-for-site'
}

/**
 * The declared dependency graph, both directions, built once (AGL-2486).
 *
 * `requires` on the catalog is the forward edge — what a plugin cannot run
 * without — and every consumer so far wanted the reverse one. Building both
 * here keeps the cascade, the console's dependency card and the server-side
 * refusal reading the SAME edges: a graph assembled a second time is a graph
 * that can disagree with itself about which plugins are coupled, and the
 * disagreement would show up as a warning shown on one surface and not on the
 * one that writes.
 *
 * `extraRequirements` extends the catalog and cannot shrink it, exactly as it
 * does for {@link resolveDisableCascade} — a third-party id can add edges of
 * its own but can never declare away a first-party one.
 */
function dependencyEdges(
  extraRequirements?: Readonly<Record<string, readonly string[]>>,
): {
  /** Keyed by a required id; holds the ids that depend on it. */
  dependents: Map<string, string[]>
  /** Keyed by a dependent id; holds the ids it requires. */
  requires: Map<string, string[]>
} {
  const dependents = new Map<string, string[]>()
  const requires = new Map<string, string[]>()
  const addEdge = (dependent: string, required: string) => {
    const reverse = dependents.get(required)
    if (reverse) reverse.push(dependent)
    else dependents.set(required, [dependent])
    const forward = requires.get(dependent)
    if (forward) forward.push(required)
    else requires.set(dependent, [required])
  }
  for (const plugin of FIRST_PARTY_PLUGINS)
    for (const required of plugin.requires ?? []) addEdge(plugin.id, required)
  for (const [dependent, required] of Object.entries(extraRequirements ?? {}))
    for (const one of required ?? []) addEdge(dependent, String(one))
  return { dependents, requires }
}

/** What `pluginId` declares it cannot run without — DIRECT edges only. */
export function pluginRequirements(
  pluginId: string,
  extraRequirements?: Readonly<Record<string, readonly string[]>>,
): string[] {
  return [...(dependencyEdges(extraRequirements).requires.get(pluginId) ?? [])]
}

/** What declares it cannot run without `pluginId` — DIRECT edges only. */
export function pluginDependents(
  pluginId: string,
  extraRequirements?: Readonly<Record<string, readonly string[]>>,
): string[] {
  return [...(dependencyEdges(extraRequirements).dependents.get(pluginId) ?? [])]
}

/**
 * Which of `enabledIds` would be left running with a requirement switched off
 * (AGL-2486) — the same question the cascade dialog asks, phrased so a WRITER
 * can refuse instead of a reader warning.
 *
 * The dialog is a courtesy: it stands in front of the console's own switches
 * and nothing else. A direct API call, a stale tab that posts an older set, or
 * a second console surface that forgot to ask can still store a set where
 * User Accounts is on and the Commerce bundle that answers its sign-in POST is
 * not. This is what a write path calls to reject that set outright, so the
 * boundary does not live in a dialog anyone can skip.
 *
 * Only DECLARED requirements are checked, with the same limit
 * {@link PLUGIN_CASCADE_IS_DECLARED_ONLY} states: an undeclared coupling is
 * invisible here too. A requirement naming an id outside the catalog is
 * ignored rather than treated as unmet — a stale edge must not lock a
 * workspace out of its own switchboard.
 */
export function strandedDependents(
  enabledIds: readonly string[],
  extraRequirements?: Readonly<Record<string, readonly string[]>>,
): Array<{ pluginId: string; missing: string[] }> {
  const enabled = new Set(enabledIds.map(String))
  const known = new Set<string>([
    ...FIRST_PARTY_PLUGINS.map((plugin) => plugin.id),
    ...enabled,
  ])
  const { requires } = dependencyEdges(extraRequirements)
  const stranded: Array<{ pluginId: string; missing: string[] }> = []
  for (const pluginId of enabled) {
    const missing = (requires.get(pluginId) ?? []).filter(
      (required) => known.has(required) && !enabled.has(required),
    )
    if (missing.length) stranded.push({ pluginId, missing })
  }
  return stranded
}

/**
 * Everything that must ALSO be switched off when `pluginId` is (AGL-2486) —
 * the transitive closure over reverse `requires` edges, restricted to what is
 * currently on.
 *
 * Pure and surface-agnostic: the org switchboard and the per-site card both
 * call it with their own "currently enabled" set, so the same graph answers
 * both, and the org's wider blast radius comes from the set it passes, not
 * from a second implementation.
 *
 * `extraRequirements` is how a marketplace listing joins the graph. Third-party
 * ids ride the same `enabledPlugins` field, so a listing whose manifest
 * declares `requires` is cascaded exactly like a bundle. It EXTENDS the
 * catalog graph and cannot shrink it — a listing cannot declare away a
 * first-party edge.
 *
 * ⚠️ The result is only ever as complete as what has been DECLARED. A
 * marketplace plugin that uses first-party components without saying so in its
 * manifest will not appear here, and callers must not present the list as
 * exhaustive. See `PLUGIN_CASCADE_IS_DECLARED_ONLY`.
 */
export function resolveDisableCascade(
  pluginId: string,
  enabledIds: readonly string[],
  extraRequirements?: Readonly<Record<string, readonly string[]>>,
): string[] {
  const enabled = new Set(enabledIds.map(String))
  const dependents = dependencyEdges(extraRequirements).dependents

  // Breadth-first over reverse edges. `seen` is seeded with the origin so a
  // cycle back to it terminates and the plugin being disabled is never listed
  // among its own dependents.
  const seen = new Set<string>([pluginId])
  const cascade: string[] = []
  const queue: string[] = [pluginId]
  while (queue.length) {
    const current = queue.shift() as string
    for (const dependent of dependents.get(current) ?? []) {
      if (seen.has(dependent)) continue
      seen.add(dependent)
      // Walk THROUGH an already-off dependent — something may depend on it in
      // turn — but do not claim it is being turned off.
      if (enabled.has(dependent)) cascade.push(dependent)
      queue.push(dependent)
    }
  }
  return cascade
}

/**
 * Why the cascade list must never be presented as exhaustive (AGL-2486).
 *
 * Exported as copy rather than left to each caller to paraphrase: the whole
 * value of the warning rests on it being honest about its own limits, and two
 * surfaces wording that differently is how one of them ends up overclaiming.
 *
 * It says built-in ONLY, and that is the current truth rather than a hedge.
 * `PluginManifest` carries no `requires` field, so a publisher cannot declare
 * a dependency even if they want to, and `extraRequirements` above — the seam
 * that would carry them — is supplied by nothing outside tests. An earlier
 * draft said "a plugin that uses this one WITHOUT declaring it cannot be
 * detected", which quietly implied declaring was possible and would have made
 * this the exact overclaiming warning it exists to avoid. Adding the manifest
 * field is a separate change: it needs a publish form, validation and a line
 * on the install screen, or it is a field written by nobody and read by
 * nothing. Update this sentence in the same change, not before.
 */
export const PLUGIN_CASCADE_IS_DECLARED_ONLY =
  'This covers built-in plugins only. A marketplace plugin has no way to ' +
  'declare that it depends on another one yet, so none are listed here — ' +
  'check any third-party plugins you rely on before continuing.'

/** Reverse lookup: which first-party plugin a release flag gates, if any. */
export function pluginForReleaseFlag(
  flagKey: string,
): FirstPartyPlugin | undefined {
  return FIRST_PARTY_PLUGINS.find((plugin) => plugin.releaseFlag === flagKey)
}

/**
 * Subtracts release-flagged-off plugins from an effective set (AGL-422).
 * Pure — the caller supplies the verdict source (client: the activated
 * Remote Config hook state; server: the cached admin-SDK template read),
 * so the same policy runs identically on every surface:
 *
 * - unknown ids (marketplace/realm installs) and always-on ids pass;
 * - a first-party id with a `releaseFlag` passes only when the flag is on
 *   for the subject, or `staffBypass` is set (staff preview keeps working
 *   while a feature is dark).
 */
export function filterPluginsByReleaseFlags(
  pluginIds: readonly string[],
  isFlagOn: (flagKey: string) => boolean,
  options?: { staffBypass?: boolean },
): string[] {
  if (options?.staffBypass) return [...pluginIds]
  const catalog = new Map(
    FIRST_PARTY_PLUGINS.map((plugin) => [plugin.id, plugin]),
  )
  return pluginIds.filter((pluginId) => {
    const plugin = catalog.get(pluginId)
    if (!plugin?.releaseFlag || plugin.alwaysOn) return true
    return isFlagOn(plugin.releaseFlag)
  })
}
