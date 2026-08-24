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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { useEffect, useRef } from 'react'

/** What happened to one definition this document renders. */
export type ComponentPropagationKind = 'updated' | 'appeared' | 'removed'

export interface ComponentPropagationChange {
  /** Definition (host component) id. */
  id: string
  /** Its display name when known, else the id — never blank. */
  name: string
  kind: ComponentPropagationKind
}

export interface ComponentPropagationNoticeOptions {
  /**
   * Node maps this canvas draws. More than one because the component an
   * author edits is usually in the LAYOUT — a site nav reached from a
   * screen — so a screen besigner passes its own nodes AND its bound
   * layout's, and a surface with only one passes one.
   */
  documents: (Record<string, unknown> | undefined | null)[]
  /**
   * The live host definitions map, `undefined` until the first snapshot
   * settles. Loading and "this host has none" must not look the same here:
   * treating loading as an empty map would report every component on the
   * page as removed and then re-appeared.
   */
  definitions: Record<string, Aglyn.ReusableComponentTree> | undefined
  /** Display names by definition id, for the copy. */
  names?: Record<string, string | undefined> | undefined
  /** Called once per snapshot that actually changed something rendered here. */
  onPropagated: (changes: ComponentPropagationChange[]) => void
}

/**
 * Deterministic JSON: object keys sorted, so two snapshots of the same
 * document cannot differ only by field order.
 *
 * `JSON.stringify` alone would be a false-positive generator — it preserves
 * insertion order, and nothing promises a Firestore snapshot rebuilds a map
 * in the order the last one did. A notice that fires when nothing changed
 * teaches authors to ignore it, which costs more than the notice is worth.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(',')}}`
}

/**
 * What a definition contributes to what is DRAWN.
 *
 * `icon` is deliberately excluded: it is editor chrome on the hierarchy row,
 * and republishing a component only to change its glyph must not tell a
 * screen author their page just changed. `rootId`, `nodes` and declared
 * `props` are the three the graft consumes.
 */
function renderSignature(
  definition: Aglyn.ReusableComponentTree | undefined,
): string | undefined {
  if (!definition) return undefined
  return stableStringify({
    rootId: definition.rootId,
    nodes: definition.nodes,
    props: definition.props ?? null,
  })
}

/**
 * The changes one snapshot made to definitions THIS document renders
 * (AGL-1898 phase 2), given the previous snapshot.
 *
 * Pulled out of the hook because the interesting rules are all here and all
 * testable without a renderer:
 *
 * - **Only what this document renders.** The definitions map is per HOST, so
 *   it changes whenever any component in the site is published — most of
 *   them not on this page. The referenced set is transitive
 *   ({@link Aglyn.collectReferencedComponentIds}), because the shared
 *   component an author edits is usually reached through a nav or a card
 *   rather than placed on the screen itself. Filtering on direct instances
 *   would stay silent for exactly the case the feature exists for.
 * - **Only what changed what is drawn.** Compared by render signature, not
 *   object identity: `useHostComponentDefinitions` rebuilds every definition
 *   object on every snapshot, so identity always differs and would report
 *   the whole page as changed each time a colleague published anything.
 * - **A newly PLACED instance is not a change.** The baseline covers the
 *   whole map rather than the referenced subset, so dragging in a component
 *   that was already published reports nothing — its definition's signature
 *   never moved.
 *
 * The reference walk runs over previous ∪ current definitions so a component
 * nested inside one that was just deleted is still reachable, rather than
 * dropping out of the referenced set at the moment it most needs reporting.
 */
export function diffRenderedComponentDefinitions(options: {
  documents: (Record<string, unknown> | undefined | null)[]
  previous: Record<string, Aglyn.ReusableComponentTree>
  next: Record<string, Aglyn.ReusableComponentTree>
  names?: Record<string, string | undefined> | undefined
}): ComponentPropagationChange[] {
  const { documents, previous, next, names } = options
  const merged = { ...previous, ...next }
  const referenced = new Set<string>()
  for (const document of documents) {
    if (!document) continue
    for (const id of Aglyn.collectReferencedComponentIds(
      document as Record<string, Aglyn.AglynNodeSchema | undefined>,
      merged,
    )) {
      referenced.add(id)
    }
  }

  const changes: ComponentPropagationChange[] = []
  for (const id of referenced) {
    const before = renderSignature(previous[id])
    const after = renderSignature(next[id])
    if (before === after) continue
    changes.push({
      id,
      name: names?.[id] || id,
      kind:
        before === undefined
          ? 'appeared'
          : after === undefined
            ? 'removed'
            : 'updated',
    })
  }
  return changes
}

/** Oxford-comma list: `a`, `a and b`, `a, b and c`. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The line an author reads when a component they are using changed under
 * them (AGL-1898 phase 2).
 *
 * It says the canvas ALREADY updated, in the past tense, because it has —
 * the graft re-ran before this message could be composed. The loop's real
 * weakness was never the transport but the silence: an author publishes in
 * the component tab, switches back, and cannot tell a working propagation
 * from a broken one, because a component edit is usually too small to spot.
 *
 * Named, not counted. "A component updated" sends the author hunting; the
 * name tells them where to look, and is the only part of this message that
 * does any work.
 */
export function describeComponentPropagation(
  changes: ComponentPropagationChange[],
): string {
  if (!changes.length) return ''
  const names = joinNames(changes.map((change) => change.name))
  const plural = changes.length > 1
  if (changes.every((change) => change.kind === 'removed')) {
    // Not an update, and must not read like one: the instance is drawing a
    // placeholder now, and saying "updated" would send the author looking
    // for a change they cannot see.
    return plural
      ? `${names} are no longer published, so this page shows placeholders where they were.`
      : `${names} is no longer published, so this page shows a placeholder where it was.`
  }
  return plural
    ? `${names} were updated by their components — this page already shows the new versions.`
    : `${names} was updated by its component — this page already shows the new version.`
}

/**
 * Tells an author when a component this document renders changed under them
 * (AGL-1898 phase 2).
 *
 * Phase 2's transport already works: `useHostComponentDefinitions` is a live
 * listener, so publishing a component re-grafts every open canvas rendering
 * it. What was missing is any sign that it happened. This adds NO reads —
 * it is derived entirely from the snapshot stream the canvas already
 * consumes — and deliberately reports only PUBLISHED changes, because that
 * is what the parent doc carries and what the live site serves.
 *
 * The first settle is silent. Recording a baseline rather than reporting
 * against an empty map is what stops a page announcing its own components on
 * load, and is the reason `definitions === undefined` is not treated as
 * `{}`.
 */
export function useComponentPropagationNotice(
  options: ComponentPropagationNoticeOptions,
): void {
  const { documents, definitions, names, onPropagated } = options
  // Read through refs: this must fire on a SNAPSHOT, never on the author's
  // own typing. `documents` is a fresh array on every render and the node
  // map changes on every keystroke, so either in the dependency list would
  // re-run the effect constantly — and with a stale-but-equal baseline, a
  // change would then be reported once per keystroke instead of once.
  const documentsRef = useRef(documents)
  documentsRef.current = documents
  const namesRef = useRef(names)
  namesRef.current = names
  const onPropagatedRef = useRef(onPropagated)
  onPropagatedRef.current = onPropagated
  const previousRef = useRef<Record<string, Aglyn.ReusableComponentTree> | null>(
    null,
  )

  useEffect(() => {
    if (!definitions) return
    const previous = previousRef.current
    previousRef.current = definitions
    if (!previous) return
    const changes = diffRenderedComponentDefinitions({
      documents: documentsRef.current,
      previous,
      next: definitions,
      names: namesRef.current,
    })
    if (changes.length) onPropagatedRef.current(changes)
  }, [definitions])
}

export default useComponentPropagationNotice
