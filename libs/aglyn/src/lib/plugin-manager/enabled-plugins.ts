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
 * `featureFlag` entitlement resolves; marketplace/community listings keep
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
}

export const FIRST_PARTY_PLUGINS: readonly FirstPartyPlugin[] = [
  {
    id: 'mui',
    label: 'Components',
    alwaysOn: true,
    description: 'The base component and theme library every site builds on.',
  },
  { id: 'bookings', label: 'Bookings', description: 'Services, open slots, and paid bookings.', releaseFlag: 'release_bookings' },
  { id: 'commerce', label: 'Commerce', description: 'Products, carts, checkout, orders, POS.', releaseFlag: 'release_commerce_v2' },
  { id: 'community', label: 'Community', description: 'Marketplace listings, templates, and installs.', releaseFlag: 'release_community' },
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

export function isPluginEnabled(
  org: { enabledPlugins?: string[] } | null | undefined,
  pluginId: string,
): boolean {
  return resolveEnabledPlugins(org).includes(pluginId)
}

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
