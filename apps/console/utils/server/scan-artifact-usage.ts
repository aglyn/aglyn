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

import {
  FORM_COMPONENT_ID,
  FORMS_PLUGIN_ID,
  formatCollectionLinkValue,
  nodesPlaceForm,
  nodesReferenceScreen,
} from '@aglyn/aglyn/server'
import {
  isLiveUsageCandidate as isLive,
  scanComponentUsage,
  scanLayoutUsage,
  screenIdsUsingCollectionDeep,
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
  usageCandidateLabel as labelFor,
  type UsageCandidate,
  type UsageDependent,
  type UsageSources,
} from '@aglyn/tenant-data-admin/server/live-page-usage'

/**
 * The corpus read and the two closures over it moved to
 * `@aglyn/tenant-data-admin/server/live-page-usage` (AGL-3113).
 *
 * The console stopped being the only side that needs them: a dataset record is
 * written from the tenant too, and the pages a form submission or an
 * automation makes stale are found by the same walk. Re-exported rather than
 * re-pointed at every call site, because what lives here is one module's worth
 * of scanning and splitting its importers would be the churn without the
 * benefit.
 *
 * The collection walk followed them (AGL-3340): a scheduled entry is published
 * on the tenant's beat, which has to drop the same pages a console save does.
 */
export {
  scanComponentUsage,
  scanLayoutUsage,
  screenIdsUsingCollectionDeep,
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
}
export type { UsageCandidate, UsageDependent, UsageSources }

/**
 * Whether a document links to `target` — a screen id, or a collection
 * listing's `collection:<id>` key — anywhere a link value is stored.
 *
 * Two places, and the second is one a tree walk cannot reach: the node tree,
 * and a component's Link property defaults, which the definition stores beside
 * its tree while the tree holds only the `{{prop.<name>}}` token (AGL-2846).
 * Both are read by `nodesReferenceScreen`, so a default matches by exactly the
 * rules a link prop does.
 */
function linksTo(candidate: UsageCandidate, target: string): boolean {
  if (nodesReferenceScreen(candidate.nodes as never, target)) return true
  const linkDefaults = (candidate.props ?? [])
    .filter((prop) => prop?.type === 'href')
    .map((prop) => prop?.defaultValue)
  return nodesReferenceScreen({ linkDefaults: { props: linkDefaults } }, target)
}

/** A collection reduced to the screen pointers a usage scan cares about. */
export interface CollectionCandidate {
  id: string
  displayName?: string
  slug?: string
  deletedAt?: unknown
  /** The three fields a collection can name a template screen with. */
  listScreenId?: string
  entryScreenId?: string
  templateScreenId?: string
}

/**
 * The fields a collection points a template screen with (AGL-105/AGL-551).
 *
 * Re-stated rather than imported from `constants/collection-templates`: that
 * module is reached by `'use client'` pages, and this one runs on the server.
 * The set is small and the tenant runtime's own copy is the authority both
 * follow — see `COLLECTION_TEMPLATE_SCREEN_FIELDS` for why there are three.
 */
const TEMPLATE_FIELDS = [
  'listScreenId',
  'entryScreenId',
  'templateScreenId',
] as const

/**
 * Everything that depends on a SCREEN (AGL-703).
 *
 * The kind this endpoint could not answer, and the one whose deletion is
 * hardest to reason about — because a screen is referenced three unrelated
 * ways and only one of them looks like a reference:
 *
 * - **links.** Buttons, nav strips, tab sets and `Link`-typed component props
 *   store a screen id, deliberately, so renames and re-parenting cannot break
 *   them (AGL-1335). Deleting the target is the one thing that still can, and
 *   AGL-1893 is the issue that got filed when it did: a link to a retired
 *   screen shipped as a live-looking control that silently did nothing on two
 *   production pages for two days.
 * - **children.** A screen's path is built from its ancestors, so a screen
 *   nested under this one is affected by its removal in a way no link is.
 * - **collection templates.** A collection renders its list and its entries
 *   THROUGH a screen. That pointer is the only dependent here that takes a
 *   live route down, so it is the one the copy must not average away.
 *
 * Deliberately NOT counted: the deleted screen's own published path. That is
 * the thing being deleted, not something that depends on it.
 */
export function scanScreenUsage(
  screenId: string,
  sources: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
    collections: CollectionCandidate[]
  },
): UsageDependent[] {
  if (!screenId) return []
  /**
   * One row per DOCUMENT, keyed by kind and id.
   *
   * A child screen that also links back to its parent is one thing in the
   * list and not two, and `relation` keeps the more consequential answer:
   * template beats child beats link, because that is the order in which they
   * cost the reader something — a lost page, a moved path, a dead link.
   */
  const rank = { template: 3, child: 2, link: 1 } as const
  const found = new Map<string, UsageDependent>()
  const add = (dependent: UsageDependent) => {
    const key = `${dependent.type}:${dependent.id}`
    const existing = found.get(key)
    if (
      existing &&
      rank[existing.relation ?? 'link'] >= rank[dependent.relation ?? 'link']
    ) {
      return
    }
    found.set(key, dependent)
  }

  for (const candidate of sources.screens) {
    if (!isLive(candidate) || candidate.id === screenId) continue
    if (candidate.parentId === screenId) {
      add({
        type: 'screen',
        id: candidate.id,
        name: labelFor(candidate),
        via: ['id'],
        relation: 'child',
        ...(candidate.versionId ? { versionId: candidate.versionId } : {}),
      })
    }
  }

  const collectLinks = (
    candidates: UsageCandidate[],
    type: 'screen' | 'layout' | 'component',
  ) => {
    for (const candidate of candidates) {
      if (!isLive(candidate) || candidate.id === screenId) continue
      if (!linksTo(candidate, screenId)) continue
      add({
        type,
        id: candidate.id,
        name: labelFor(candidate),
        // Links store ids, so a rename can never break one — only a delete.
        via: ['id'],
        relation: 'link',
        ...(candidate.versionId ? { versionId: candidate.versionId } : {}),
      })
    }
  }
  collectLinks(sources.screens, 'screen')
  collectLinks(sources.layouts, 'layout')
  collectLinks(sources.components, 'component')

  for (const contentCollection of sources.collections) {
    if (contentCollection.deletedAt) continue
    const binds = TEMPLATE_FIELDS.some(
      (field) => contentCollection[field] === screenId,
    )
    if (!binds) continue
    add({
      type: 'collection',
      id: contentCollection.id,
      name: String(
        contentCollection.displayName ??
          contentCollection.slug ??
          contentCollection.id,
      ),
      via: ['id'],
      relation: 'template',
    })
  }

  return [...found.values()]
}

/**
 * Everything that links to a content collection's LISTING page (AGL-2806).
 *
 * A Screen Link, Button, Image, Link Container, Tabs link, Accordion header,
 * form redirect or Link-typed component property can point at `/{slug}` by
 * storing `collection:<collectionId>` (AGL-2799): the key the linkable routing
 * map holds the listing under, resolved through the same lookup a screen link
 * is. Deleting the collection takes that key out of the map, and every such
 * link renders with no address (AGL-1893). So a listing link is found the way
 * a screen link is — in published screens, published layouts and component
 * definitions, by {@link linksTo}.
 *
 * Links are the only dependents reported. A collection's entries and template
 * screens depend on it too, but `collectionDeleteDenial` refuses the delete
 * while either exists, so neither is a warning to give here.
 *
 * Not searched: a Markdown body. markdown-lite keeps only site-relative and
 * http(s) link targets, so a `collection:` target typed there renders as its
 * words with no link, and a delete has nothing to break.
 */
export function scanCollectionUsage(
  collectionId: string,
  sources: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
): UsageDependent[] {
  if (!collectionId.trim()) return []
  const listing = formatCollectionLinkValue(collectionId)
  const dependents: UsageDependent[] = []
  const collect = (
    candidates: UsageCandidate[],
    type: 'screen' | 'layout' | 'component',
  ) => {
    for (const candidate of candidates) {
      if (!isLive(candidate)) continue
      if (!linksTo(candidate, listing)) continue
      dependents.push({
        type,
        id: candidate.id,
        name: labelFor(candidate),
        // The value names the collection by id, so a slug rename cannot break
        // it — only a delete.
        via: ['id'],
        relation: 'link',
        ...(candidate.versionId ? { versionId: candidate.versionId } : {}),
      })
    }
  }
  collect(sources.screens, 'screen')
  collect(sources.layouts, 'layout')
  collect(sources.components, 'component')
  return dependents
}

/**
 * Every live screen whose rendered output contains the form `formId`, however
 * indirectly.
 *
 * The form twin of {@link screenIdsUsingComponentDeep}, and the same walk for
 * the same reason: a placed form is found by SEARCHING node trees, not by
 * matching a pointer, and it can sit on a screen, inside page chrome, or
 * inside a reusable component that a third component nests. Publishing a form
 * changes every page that renders it, so anything this misses keeps serving
 * the old fields for the whole revalidate window while the editor reports that
 * the live sites now serve the new design.
 *
 * The first level is the only thing that differs from the component walk: a
 * document uses a form by PLACING it. After that the fan-out is identical, so
 * it is delegated rather than restated — a component that holds the form is
 * reached by whatever reaches that component, and a layout by whatever renders
 * inside it.
 *
 * Pure, and separate from the Firestore read, so the closure is testable
 * without a database. Cycle-safe by delegation: both walks it defers to bound
 * themselves.
 */
export function screenIdsUsingFormDeep(
  formId: string,
  sources: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
): string[] {
  if (!formId) return []
  const screenIds = new Set<string>()

  for (const candidate of sources.screens) {
    if (!isLive(candidate)) continue
    if (nodesPlaceForm(candidate.nodes, formId)) screenIds.add(candidate.id)
  }
  for (const candidate of sources.layouts) {
    if (!isLive(candidate)) continue
    if (!nodesPlaceForm(candidate.nodes, formId)) continue
    // The layout itself renders no URL; the screens beneath it do.
    for (const screenId of screenIdsUsingLayoutDeep(
      candidate.id,
      sources.screens,
      sources.layouts,
    )) {
      screenIds.add(screenId)
    }
  }
  for (const candidate of sources.components) {
    if (!isLive(candidate)) continue
    if (!nodesPlaceForm(candidate.nodes, formId)) continue
    // And a component renders wherever it is placed, however deeply nested.
    for (const screenId of screenIdsUsingComponentDeep(candidate.id, sources)) {
      screenIds.add(screenId)
    }
  }

  return [...screenIds]
}

/**
 * One document that places a plugin's elements (AGL-1027).
 *
 * `count` is how many of the plugin's nodes it holds, because "this page uses
 * it once" and "this page is built out of it" are different sentences and the
 * confirmation should be able to say which.
 */
export interface PluginPlacement {
  type: 'screen' | 'layout' | 'component'
  id: string
  name: string
  count: number
  versionId?: string
}

export interface PluginPlacementScan {
  /** Documents that directly place the plugin's elements. */
  placements: PluginPlacement[]
  /**
   * Distinct PUBLISHED screens that would stop rendering it — the number the
   * confirmation quotes.
   *
   * Not the same as `placements.length`, in both directions. One layout is one
   * placement and can be every page on the site; one reusable component that no
   * published screen uses is a placement that breaks nothing visitors can see.
   */
  affectedScreenIds: string[]
}

/**
 * How many of `pluginId`'s nodes a tree holds.
 *
 * Read off each node's stamped `pluginId`, with one exception for Forms
 * (AGL-3029): a `form` node placed before the element left the base library
 * still carries `mui`, and a scan by stamp alone would report a page holding
 * such a form as holding none — the one answer a warning about switching
 * Forms off must never give. The form's `componentId` is the fact that has
 * never changed, so it counts whatever the node was stamped with.
 */
export function countPluginNodes(
  nodes: Record<string, any> | null | undefined,
  pluginId: string,
): number {
  if (!nodes || !pluginId) return 0
  let count = 0
  for (const node of Object.values(nodes)) {
    if (
      node?.pluginId === pluginId ||
      (pluginId === FORMS_PLUGIN_ID && node?.componentId === FORM_COMPONENT_ID)
    ) {
      count += 1
    }
  }
  return count
}

/** One published page an impact scan names. */
export interface ImpactedPage {
  id: string
  name: string
  /** The address the site serves it at, or `null` for a page with none. */
  path: string | null
}

/**
 * The published pages behind a placement scan's screen ids, by name and
 * address (AGL-3029) — what a confirmation NAMES rather than counts.
 *
 * `routes` is the host document's routing map. Pages come back in the order a
 * reader scans them by: addressed pages first, by address, then the rest by
 * name.
 */
export function impactedPages(
  screenIds: readonly string[],
  screens: readonly UsageCandidate[],
  routes: Record<string, unknown> | null | undefined,
): ImpactedPage[] {
  const byId = new Map(screens.map((screen) => [screen.id, screen]))
  return screenIds
    .map((id) => {
      const screen = byId.get(id)
      const path = routes?.[id]
      return {
        id,
        name: screen ? labelFor(screen) : id,
        path: typeof path === 'string' && path ? path : null,
      }
    })
    .sort((a, b) =>
      a.path && b.path
        ? a.path.localeCompare(b.path)
        : a.path
          ? -1
          : b.path
            ? 1
            : a.name.localeCompare(b.name),
    )
}

/**
 * Everything that would stop rendering if a plugin's pin went away (AGL-1027).
 *
 * A plugin is referenced differently from every other artifact this module
 * scans: not by an instance node or an id pointer, but by `pluginId` on any
 * node the plugin contributed. So the match is on the node itself, and one
 * document can hold many.
 *
 * The three places are scanned for the same reason `scanComponentUsage` scans
 * three: the renderer composes from all of them. And the screen closure matters
 * more here than anywhere, because the two indirect cases are exactly the ones
 * a person clicking Uninstall cannot see — a plugin in LAYOUT chrome is on
 * every page under it, and a plugin inside a reusable component is on every
 * page that places the component.
 *
 * ## What this deliberately does not see
 *
 * Screens and layouts are scanned on their PUBLISHED version, so a plugin
 * placed on an unpublished draft is not reported. That is the right scope for
 * "what stops working on live sites" — but it is a real limit, and the caller
 * says so rather than presenting the count as everything.
 */
export function scanPluginPlacements(
  pluginId: string,
  sources: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
): PluginPlacementScan {
  if (!pluginId) return { placements: [], affectedScreenIds: [] }
  const placements: PluginPlacement[] = []
  const screenIds = new Set<string>()

  const collect = (
    candidates: UsageCandidate[],
    type: PluginPlacement['type'],
  ) => {
    for (const candidate of candidates) {
      if (!isLive(candidate)) continue
      const count = countPluginNodes(candidate.nodes, pluginId)
      if (!count) continue
      placements.push({
        type,
        id: candidate.id,
        name: labelFor(candidate),
        count,
        ...(candidate.versionId ? { versionId: candidate.versionId } : {}),
      })
      if (type === 'screen') {
        screenIds.add(candidate.id)
      } else if (type === 'layout') {
        // Page chrome: every screen under this layout, at any nesting depth.
        for (const id of screenIdsUsingLayoutDeep(
          candidate.id,
          sources.screens,
          sources.layouts,
        )) {
          screenIds.add(id)
        }
      } else {
        // A definition renders nowhere on its own; the screens placing it do.
        for (const id of screenIdsUsingComponentDeep(candidate.id, sources)) {
          screenIds.add(id)
        }
      }
    }
  }
  collect(sources.screens, 'screen')
  collect(sources.layouts, 'layout')
  collect(sources.components, 'component')

  return { placements, affectedScreenIds: [...screenIds] }
}
