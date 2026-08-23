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
 * This catalog intentionally knows ids and labels only — package names live
 * in `plugins.config.json` (codegen), so core stays free of plugin imports.
 */

export interface FirstPartyPlugin {
  /** Stable plugin id — persisted in `org.enabledPlugins`; never rename. */
  id: string
  /** Console-facing display name. */
  label: string
  /** Always loaded regardless of the org switchboard (base components). */
  alwaysOn?: boolean
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
 * Every catalog id classified. Kept beside the catalog rather than inside it
 * because the `elements` verdict is a fact about `plugins.config.json`
 * (`register.site`), and a spec cross-checks the two so a new
 * site-registering bundle cannot be added without declaring its consequence.
 */
export const PUBLISHED_SITE_IMPACT: Readonly<
  Record<string, PublishedSiteImpact>
> = {
  mui: 'elements',
  accounts: 'routes',
  bookings: 'elements',
  commerce: 'elements',
  marketplace: 'console-only',
  contacts: 'console-only',
  data: 'console-only',
  email: 'elements',
  'events-calendar': 'elements',
  inbox: 'console-only',
  logic: 'console-only',
  marketing: 'elements',
  redirects: 'routes',
  workflows: 'routes',
}

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

export const FIRST_PARTY_PLUGINS: readonly FirstPartyPlugin[] = [
  {
    id: 'mui',
    label: 'Components',
    alwaysOn: true,
    description: 'The base component and theme library every site builds on.',
  },
  {
    id: ACCOUNTS_PLUGIN_ID,
    label: 'User Accounts',
    description:
      'Visitor accounts on the site: the /signin, /signup and /recover ' +
      'pages, and the Members blocks. Off for a site until you turn it on.',
    releaseFlag: 'release_member_accounts',
    defaultOffPerSite: true,
    // The Members blocks and the `membership/*` handlers are registered by
    // the COMMERCE bundle (`plugins.config.json` gives commerce the
    // `membership` api prefix). Commerce off = member pages with no server.
    requires: ['commerce'],
  },
  { id: 'bookings', label: 'Bookings', description: 'Services, open slots, and paid bookings.', releaseFlag: 'release_bookings' },
  { id: 'commerce', label: 'Commerce', description: 'Products, carts, checkout, orders, POS.', releaseFlag: 'release_commerce_v2' },
  { id: 'marketplace', label: 'Marketplace', description: 'Marketplace listings, templates, and installs.', releaseFlag: 'release_marketplace' },
  { id: 'contacts', label: 'Contacts', description: 'People, segments, and interactions.', releaseFlag: 'release_contacts' },
  { id: 'data', label: 'Data', description: 'Datasets, records, and CSV import/export.', releaseFlag: 'release_data_store' },
  { id: 'email', label: 'Email', description: 'Designed emails and campaign sending.', releaseFlag: 'release_email' },
  { id: 'events-calendar', label: 'Events Calendar', description: 'Event lists and calendars.', releaseFlag: 'release_events' },
  { id: 'inbox', label: 'Inbox', description: 'Form submissions and lead inbox.', releaseFlag: 'release_inbox' },
  { id: 'logic', label: 'Logic', description: 'Variables, functions, and reference health.', releaseFlag: 'release_logic' },
  { id: 'marketing', label: 'Marketing', description: 'Overlays, campaigns, and experiments.', releaseFlag: 'release_marketing' },
  { id: 'redirects', label: 'Redirects', description: 'URL redirect rules.', releaseFlag: 'release_redirects' },
  { id: 'workflows', label: 'Workflows', description: 'Automations, webhooks, and run logs.', releaseFlag: 'release_workflows' },
] as const

/** Ids loaded for orgs that have never touched the switchboard. */
export const DEFAULT_ENABLED_PLUGINS: readonly string[] =
  FIRST_PARTY_PLUGINS.map((plugin) => plugin.id)

const ALWAYS_ON: readonly string[] = FIRST_PARTY_PLUGINS.filter(
  (plugin) => plugin.alwaysOn,
).map((plugin) => plugin.id)

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
    Array.isArray(optedIn) ? optedIn.map(String) : [],
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
 * plugin (existing orgs keep working untouched); always-on ids are unioned
 * in so the base component library can't be switched off. Unknown ids are
 * kept — realm-trusted marketplace plugins (AGL-420) ride the same field.
 */
export function resolveEnabledPlugins(
  org?: { enabledPlugins?: string[] } | null,
): string[] {
  const configured = org?.enabledPlugins
  const base = Array.isArray(configured)
    ? configured.map(String)
    : [...DEFAULT_ENABLED_PLUGINS]
  return Array.from(new Set([...ALWAYS_ON, ...base]))
}

/**
 * Subtracts a host's per-site deny-list from an enabled set (AGL-1014).
 * Always-on ids survive — the base component library cannot be switched
 * off per site any more than per org. Order of the surviving ids is kept.
 */
export function subtractDisabledPlugins(
  pluginIds: readonly string[],
  disabledPlugins?: readonly string[] | null,
): string[] {
  if (!Array.isArray(disabledPlugins) || !disabledPlugins.length)
    return [...pluginIds]
  const disabled = new Set(disabledPlugins.map(String))
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
  // Reverse index: required id -> ids that depend on it.
  const dependents = new Map<string, string[]>()
  const addEdge = (dependent: string, required: string) => {
    const list = dependents.get(required)
    if (list) list.push(dependent)
    else dependents.set(required, [dependent])
  }
  for (const plugin of FIRST_PARTY_PLUGINS)
    for (const required of plugin.requires ?? []) addEdge(plugin.id, required)
  for (const [dependent, required] of Object.entries(extraRequirements ?? {}))
    for (const one of required ?? []) addEdge(dependent, String(one))

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
 */
export const PLUGIN_CASCADE_IS_DECLARED_ONLY =
  'This lists plugins that declare a dependency. A marketplace plugin that ' +
  'uses this one without declaring it cannot be detected, so check any ' +
  'third-party plugins you rely on.'

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
