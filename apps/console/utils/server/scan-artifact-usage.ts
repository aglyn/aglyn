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

import { nodesReferenceComponent } from '@aglyn/aglyn/server'

export interface UsageDependent {
  type: 'screen' | 'layout' | 'component'
  id: string
  name: string
  via: Array<'id' | 'name'>
  versionId?: string
}

/** A screen/layout/component reduced to what a usage scan needs. */
export interface UsageCandidate {
  id: string
  displayName?: string
  /** Legacy field some older documents used instead of `displayName`. */
  name?: string
  deletedAt?: unknown
  /**
   * Node tree to search. For screens and layouts this is the PUBLISHED
   * version's nodes (what visitors see); for components it is the definition
   * tree off the component document, which is what the runtime reads.
   */
  nodes?: Record<string, any> | null
  /** Published version, carried through so the caller can deep-link. */
  versionId?: string
  /** Screens only: the layout they render inside. */
  layoutId?: string
}

/** `displayName`, falling back to a legacy `name`, then the raw id. */
function labelFor(candidate: UsageCandidate): string {
  return String(candidate.displayName ?? candidate.name ?? candidate.id)
}

const isLive = (candidate: UsageCandidate) => !candidate.deletedAt

/**
 * Everything that references a reusable component (AGL-703).
 *
 * Three places, because the renderer expands instances in three places:
 * published screen versions, published layout versions, and OTHER component
 * definitions — `composeReusableComponentNodes` grafts nested instances, so
 * a component used only inside another component is genuinely used. Omitting
 * that third scan would report "used nowhere" for it and invite a confident
 * deletion, which is worse than showing nothing at all.
 */
export function scanComponentUsage(
  componentId: string,
  sources: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
): UsageDependent[] {
  if (!componentId) return []
  const dependents: UsageDependent[] = []
  const collect = (
    candidates: UsageCandidate[],
    type: UsageDependent['type'],
  ) => {
    for (const candidate of candidates) {
      if (!isLive(candidate)) continue
      // A component never counts as using itself, however it nests.
      if (type === 'component' && candidate.id === componentId) continue
      if (!nodesReferenceComponent(candidate.nodes, componentId)) continue
      dependents.push({
        type,
        id: candidate.id,
        name: labelFor(candidate),
        // Instances reference by id, so a rename can never break them.
        via: ['id'],
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
 * Everything rendering inside a layout (AGL-703).
 *
 * Two kinds of dependent, both expressed by the same `layoutId` pointer:
 *
 * - **screens**, which name the layout they render inside;
 * - **other layouts**, since a layout can itself sit inside one. A nested
 *   layout is a real dependent — deleting its parent unwraps every screen
 *   underneath it — so leaving layouts out would report a parent layout as
 *   used only by the screens that name it directly, and none of the ones
 *   that reach it through a child.
 *
 * A layout never counts as its own dependent; `canNestLayout` refuses that,
 * and this refuses to report it even if stored data holds one.
 */
export function scanLayoutUsage(
  layoutId: string,
  screens: UsageCandidate[],
  layouts: UsageCandidate[] = [],
): UsageDependent[] {
  if (!layoutId) return []
  const dependentsOf = (
    candidates: UsageCandidate[],
    type: 'screen' | 'layout',
  ) =>
    candidates
      .filter(
        (candidate) =>
          isLive(candidate) &&
          candidate.layoutId === layoutId &&
          candidate.id !== layoutId,
      )
      .map((candidate) => ({
        type,
        id: candidate.id,
        name: labelFor(candidate),
        via: ['id' as const],
        ...(candidate.versionId ? { versionId: candidate.versionId } : {}),
      }))
  return [
    ...dependentsOf(screens, 'screen'),
    ...dependentsOf(layouts, 'layout'),
  ]
}

/**
 * Every live screen rendered inside `layoutId`, at ANY nesting depth
 * (AGL-1150).
 *
 * `scanLayoutUsage` answers one level. Layouts nest — a screen points at a
 * layout, which can point at a parent layout, and `compose-screen-nodes` walks
 * that whole chain when composing a page. So publishing a layout changes every
 * screen below it, not just the ones bound to it directly, and a cache drop
 * that only handles the direct level leaves the rest showing stale chrome for
 * the full revalidate window.
 *
 * Pure, and separate from the Firestore read, so the nesting behaviour is
 * testable without a database.
 *
 * Cycle-safe. `canNestLayout` refuses to create a cycle, but a document written
 * straight to Firestore is not bound by that, and a cycle here would hang a
 * publish request rather than surface anything.
 */
export function screenIdsUsingLayoutDeep(
  layoutId: string,
  screens: UsageCandidate[],
  layouts: UsageCandidate[] = [],
): string[] {
  if (!layoutId) return []
  const screenIds = new Set<string>()
  const seenLayouts = new Set<string>([layoutId])
  let frontier = [layoutId]

  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const dependent of scanLayoutUsage(id, screens, layouts)) {
        if (dependent.type === 'screen') {
          screenIds.add(dependent.id)
        } else if (!seenLayouts.has(dependent.id)) {
          seenLayouts.add(dependent.id)
          next.push(dependent.id)
        }
      }
    }
    frontier = next
  }

  return [...screenIds]
}

/**
 * Every live screen whose rendered output contains `componentId`, however
 * indirectly (AGL-1161).
 *
 * `scanComponentUsage` answers one level and returns three kinds of dependent.
 * Only one of them is a screen, and the other two both reach screens by routes
 * a single-level scan cannot see:
 *
 * - a **component** dependent nests the target inside itself, and that outer
 *   component may itself only be used inside a third — so component→component
 *   edges have to be followed to a fixed point;
 * - a **layout** dependent puts the component in page chrome, which every
 *   screen under that layout renders. Layouts nest, so that is
 *   `screenIdsUsingLayoutDeep`, not a direct `layoutId` match.
 *
 * Miss either and a publish reports success while some pages keep serving the
 * old component for the full revalidate window — the failure this whole arc
 * exists to remove, and the one that is hardest to notice because the pages
 * that ARE dropped update instantly.
 *
 * Pure, and separate from the Firestore read, so the closure is testable
 * without a database — the same split `screenIdsUsingLayoutDeep` uses.
 *
 * Cycle-safe. `composeReusableComponentNodes` would not survive a cycle, but a
 * document written straight to Firestore is not bound by what the editor
 * allows, and a cycle here would hang a publish rather than surface anything.
 */
export function screenIdsUsingComponentDeep(
  componentId: string,
  sources: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
): string[] {
  if (!componentId) return []
  const screenIds = new Set<string>()
  const seenComponents = new Set<string>([componentId])
  // Layouts are resolved through their own deep walk, so remember which ones
  // have already been expanded: two components in the same layout would
  // otherwise re-walk the whole layout tree once each.
  const seenLayouts = new Set<string>()
  let frontier = [componentId]

  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const dependent of scanComponentUsage(id, sources)) {
        if (dependent.type === 'screen') {
          screenIds.add(dependent.id)
        } else if (dependent.type === 'layout') {
          if (seenLayouts.has(dependent.id)) continue
          seenLayouts.add(dependent.id)
          // The layout itself renders no URL; the screens beneath it do.
          for (const screenId of screenIdsUsingLayoutDeep(
            dependent.id,
            sources.screens,
            sources.layouts,
          )) {
            screenIds.add(screenId)
          }
        } else if (!seenComponents.has(dependent.id)) {
          seenComponents.add(dependent.id)
          next.push(dependent.id)
        }
      }
    }
    frontier = next
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

/** How many of `pluginId`'s nodes a tree holds. */
export function countPluginNodes(
  nodes: Record<string, any> | null | undefined,
  pluginId: string,
): number {
  if (!nodes || !pluginId) return 0
  let count = 0
  for (const node of Object.values(nodes)) {
    if (node?.pluginId === pluginId) count += 1
  }
  return count
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
