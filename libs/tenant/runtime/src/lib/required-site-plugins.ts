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
 * Which site plugins a page must have registered *before it can render*
 * (AGL-1289).
 *
 * The tenant client suspends on `sitePluginLoader.ensure(enabledPlugins)`, and
 * `enabledPlugins` is the ORG's list — nothing narrows it to the page. On
 * aglyn.com that is twelve enabled plugins, of which the `/pricing` document
 * uses exactly one: 2,816 of its 2,818 nodes are `mui` and the other two carry
 * no `pluginId` at all. The bundles with a site surface that it does not use —
 * bookings, commerce, email, events-calendar — were downloaded and evaluated
 * in front of first render, in a second request wave measured starting ~1.7 s
 * after the first and finishing at ~4.0 s.
 *
 * A plugin belongs in front of the render for exactly two reasons:
 *
 *  1. **Its components are on the page.** Without it registered the canvas has
 *     no component to render for those nodes — the blank-site failure
 *     (AGL-52). Read straight off each node's `pluginId`.
 *  2. **It contributed something to this page.** A site runtime only mounts
 *     once its plugin registers, so a late one shows its announcement bar a
 *     beat after paint and — the case that actually costs something — an
 *     experiment runner can paint the control variant before it swaps.
 *
 * The second is why this takes `contributors` rather than inspecting props: it
 * must distinguish "the marketing plugin returned `announcementBar: null`"
 * from "the marketing plugin returned a live bar". Every marketing enricher
 * returns its whole key set on every page, so presence proves nothing;
 * `runSitePageEnrichers` reports only the plugins whose output had content.
 *
 * `/pricing` is the case that shows why the distinction matters. Its
 * `announcementBar`, `popup`, `experiments` and `automationOverlays` are all
 * empty — but its `clientAutomations` is NOT, so `marketing` genuinely has to
 * register early and only the other four move.
 *
 * Everything here fails toward "no narrowing": an unattributable contribution,
 * a missing enabled list, no nodes to read. The cost of refusing is a slower
 * page; the cost of wrongly dropping a plugin is a site that does not render.
 */

/** Registered regardless of the org's list; the canvas cannot render without it. */
export const ALWAYS_ON_SITE_PLUGINS: readonly string[] = ['mui']

export interface RequiredSitePluginsInput {
  /** The FULL composed document — not one already pruned for deferral. */
  nodes?: Record<string, { pluginId?: string }> | null
  /** Plugins whose enrichers produced non-empty output for this page. */
  contributors?: readonly string[]
  /** True when some contribution could not be traced to a plugin. */
  unattributed?: boolean
  enabledPlugins?: readonly string[] | null
}

/**
 * The plugins that must register before first render, or `null` when the page
 * has to keep waiting for the whole enabled set.
 *
 * Always a subset of `enabledPlugins`, in that list's order, so this can never
 * turn on a plugin the org has not enabled.
 */
export function requiredSitePlugins({
  nodes,
  contributors,
  unattributed,
  enabledPlugins,
}: RequiredSitePluginsInput): string[] | null {
  if (!enabledPlugins?.length || !nodes || unattributed) return null

  const needed = new Set<string>(ALWAYS_ON_SITE_PLUGINS)
  for (const node of Object.values(nodes)) {
    if (node?.pluginId) needed.add(node.pluginId)
  }
  for (const id of contributors ?? []) needed.add(id)

  const required = enabledPlugins.filter((id) => needed.has(id))
  // Nothing gained, and an empty list would be a strictly worse thing to hand
  // the loader than the list it already had.
  if (!required.length || required.length === enabledPlugins.length) return null
  return required
}
