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
