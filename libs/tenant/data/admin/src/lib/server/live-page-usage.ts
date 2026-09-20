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
 * Which live pages a change reaches, for a site's screens, layouts and
 * components.
 *
 * The corpus read and the two closures over it, held here rather than in the
 * console because the console is no longer the only side that needs them. A
 * dataset record is written from the tenant as well — a form submission, an
 * automation step — and those writes make the same pages stale as a console
 * edit does. Two implementations of "which screens render this" is the shape
 * that put AGL-1223 in the tree: one reader handled a node tree's second
 * storage form and the other did not, so half the corpus answered "used
 * nowhere" and a publish dropped no cache.
 *
 * Nothing here is dataset-specific, and nothing is console-specific. The
 * console's `scan-artifact-usage` re-exports these and keeps the parts that
 * are about the console's own "what would I break" copy.
 */

import {
  nodesReferenceComponent,
  decodeStoredNodes,
  type ReusableComponentProp,
} from '@aglyn/aglyn/server'

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
  /** Screens only: the screen they nest under, which is part of their path. */
  parentId?: string
  /**
   * Components only: the properties the definition declares (AGL-1247). A
   * Link property's default renders as a link wherever an instance leaves the
   * property unset, and it is stored here, not in `nodes` (AGL-2846).
   */
  props?: ReadonlyArray<ReusableComponentProp | null | undefined> | null
}

/** One document that depends on the artifact a scan was asked about. */
export interface UsageDependent {
  type: 'screen' | 'layout' | 'component' | 'collection'
  id: string
  name: string
  via: Array<'id' | 'name'>
  versionId?: string
  /**
   * HOW the dependent references the artifact — screens and collection
   * listings (AGL-703, AGL-2806).
   *
   * A component or a layout has exactly one kind of dependent and the noun
   * says everything: an instance, or a binding. A screen has three, and they
   * break in three different ways — a link goes dead, a child moves, a
   * collection loses the page it renders through. Copy that could not tell
   * them apart would have to describe the worst case every time. A collection
   * listing's dependents are all links, and say so.
   */
  relation?: 'link' | 'child' | 'template'
}

/** The three corpora every closure below walks. */
export interface UsageSources {
  screens: UsageCandidate[]
  layouts: UsageCandidate[]
  components: UsageCandidate[]
}

/** `displayName`, falling back to a legacy `name`, then the raw id. */
export function usageCandidateLabel(candidate: UsageCandidate): string {
  return String(candidate.displayName ?? candidate.name ?? candidate.id)
}

/** A soft-deleted document renders nothing, so it depends on nothing. */
export const isLiveUsageCandidate = (candidate: UsageCandidate): boolean =>
  !candidate.deletedAt

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
  sources: UsageSources,
): UsageDependent[] {
  if (!componentId) return []
  const dependents: UsageDependent[] = []
  const collect = (
    candidates: UsageCandidate[],
    type: UsageDependent['type'],
  ) => {
    for (const candidate of candidates) {
      if (!isLiveUsageCandidate(candidate)) continue
      // A component never counts as using itself, however it nests.
      if (type === 'component' && candidate.id === componentId) continue
      if (!nodesReferenceComponent(candidate.nodes, componentId)) continue
      dependents.push({
        type,
        id: candidate.id,
        name: usageCandidateLabel(candidate),
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
          isLiveUsageCandidate(candidate) &&
          candidate.layoutId === layoutId &&
          candidate.id !== layoutId,
      )
      .map((candidate) => ({
        type,
        id: candidate.id,
        name: usageCandidateLabel(candidate),
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
  sources: UsageSources,
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

export interface UsageCandidateRead {
  candidates: UsageCandidate[]
  /**
   * The collection held more documents than `limit` allowed, so the scan below
   * it is INCOMPLETE.
   *
   * Returned rather than logged, because the two callers owe the user
   * different things: an advisory "what would I break" can show a partial
   * answer and say so, while a cache drop that silently scans a prefix reports
   * a successful publish and leaves real pages stale.
   */
  truncated: boolean
}

/**
 * One collection's documents, with published nodes attached when the scan
 * needs to search them.
 *
 * `limit` is a real bound, not a guess: it is fetched with one extra document
 * so exceeding it is DETECTED rather than assumed away. A caller that ignores
 * `truncated` is choosing to be wrong quietly.
 */
export async function readUsageCandidates(
  hostRef: FirebaseFirestore.DocumentReference,
  collectionName: 'screens' | 'layouts' | 'components',
  options: { withNodes: boolean; limit: number },
): Promise<UsageCandidateRead> {
  const { withNodes, limit } = options
  // One over the limit: if the extra document comes back, there was more than
  // we are about to look at. Cheaper than a count() and exact.
  const docs = await hostRef.collection(collectionName).limit(limit + 1).get()
  const truncated = docs.size > limit
  const inScope = truncated ? docs.docs.slice(0, limit) : docs.docs

  const candidates = await Promise.all(
    inScope.map(async (docSnapshot) => {
      const versionId = docSnapshot.get('versionId')
      // Components keep their tree on the document; screens and layouts keep
      // it on the published version.
      //
      // BOTH reads are decoded (AGL-1223). A component document is msgpack
      // for anything promoted since components were compressed and a plain
      // map for everything older, and `decodeStoredNodes` returns a map
      // unchanged — so the branch below cannot be simplified back into a raw
      // read on either side.
      //
      // What rides on this: every consumer walks the value with
      // `Object.values`, which over a `Buffer` yields byte NUMBERS and
      // matches nothing. The answer that produces is "used nowhere" — for
      // `/api/hosts/where-used` an invitation to delete something a live page
      // renders, and for `/api/screens/revalidate` a publish that drops no
      // cache and leaves the old page served.
      const nodes =
        collectionName === 'components'
          ? decodeStoredNodes(docSnapshot.get('nodes'))
          : withNodes && versionId
            ? await docSnapshot.ref
                .collection('versions')
                .doc(String(versionId))
                .get()
                .then((version) => decodeStoredNodes(version.get('nodes')))
                .catch(() => null)
            : null
      return {
        id: docSnapshot.id,
        displayName: docSnapshot.get('displayName'),
        name: docSnapshot.get('name'),
        deletedAt: docSnapshot.get('deletedAt'),
        nodes,
        ...(versionId ? { versionId: String(versionId) } : {}),
        ...(docSnapshot.get('layoutId')
          ? { layoutId: String(docSnapshot.get('layoutId')) }
          : {}),
        // Screens only, and only the screen scan reads it: a child screen is
        // a dependent of its parent, because its PATH is built from it
        // (AGL-703).
        ...(docSnapshot.get('parentId')
          ? { parentId: String(docSnapshot.get('parentId')) }
          : {}),
        // Components only: the declared properties, whose Link defaults render
        // as links wherever an instance leaves one unset (AGL-2846). The same
        // document the tree came from, so it costs no read.
        ...(collectionName === 'components' &&
        Array.isArray(docSnapshot.get('props'))
          ? { props: docSnapshot.get('props') }
          : {}),
      } satisfies UsageCandidate
    }),
  )

  return { candidates, truncated }
}

/**
 * Every screen, layout and component of a site, with their node trees — the
 * corpus every tree-searching closure above walks.
 *
 * Each collection ONCE, in memory: a query per level would multiply round
 * trips by the nesting depth of the graph. Shared so two scans cannot read
 * different corpora under different bounds, and a change to one cannot quietly
 * narrow the other.
 */
export async function readUsageSources(
  hostRef: FirebaseFirestore.DocumentReference,
  limit: number,
): Promise<{ candidates: UsageSources; truncated: boolean }> {
  const [screens, layouts, components] = await Promise.all([
    readUsageCandidates(hostRef, 'screens', { withNodes: true, limit }),
    readUsageCandidates(hostRef, 'layouts', { withNodes: true, limit }),
    readUsageCandidates(hostRef, 'components', { withNodes: true, limit }),
  ])
  return {
    candidates: {
      screens: screens.candidates,
      layouts: layouts.candidates,
      components: components.candidates,
    },
    truncated: screens.truncated || layouts.truncated || components.truncated,
  }
}
