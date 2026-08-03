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

import * as Aglyn from '@aglyn/aglyn'
import { observable, runInAction } from 'mobx'
import {
  confirmValidLinealRelationship,
  describeInvalidLinealRelationship,
  type LinealItem,
} from '../dnd-manager'

/**
 * Besigner element clipboard (AGL-1202): copy an element — or a whole
 * multi-selection — and paste it somewhere else, including into a
 * *different document*.
 *
 * Cross-document paste is the point. Duplicate already covers "another one
 * of these, right here"; what it cannot do is carry a built column out of
 * the nav component and into the footer component, or lift a finished
 * section off one screen onto another. So the clipboard holds detached
 * nested JSON (never live nodes) and mirrors itself into `localStorage`,
 * which is what lets it survive the full page navigation between two
 * besigner documents.
 *
 * A MobX store, mirroring the focus-manager seam, so menus observing
 * {@link hasContent} re-render the moment something is copied.
 */

/** `localStorage` key holding the mirrored clipboard entry. */
export const CLIPBOARD_STORAGE_KEY = 'aglyn:besigner:clipboard'

/**
 * Bumped whenever the persisted shape changes. A mirrored entry written by
 * an older build is dropped rather than pasted as something unexpected.
 */
export const CLIPBOARD_FORMAT_VERSION = 1

export interface ClipboardEntry {
  version: number
  /** Element labels in copy order, for the menu ("Paste Stack"). */
  labels: string[]
  /** Detached nested subtrees, in document order. */
  nodes: Aglyn.NodeSchemaNested<any>[]
}

interface ClipboardState {
  entry: ClipboardEntry | null
  /** Set once the mirrored entry has been read back after a navigation. */
  hydrated: boolean
}

const state = observable<ClipboardState>({ entry: null, hydrated: false })

const storage = (): Storage | null => {
  try {
    // SSR and privacy-mode both make this throw rather than return null.
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * A copied subtree keeps no tie to the canvas it came from: `$id` and
 * `parentId` are re-minted on paste, and carrying stale ones through
 * `localStorage` invites a paste that collides with a live node.
 */
const detach = (
  node: Aglyn.NodeSchemaNested<any>,
): Aglyn.NodeSchemaNested<any> => {
  const { $id, parentId, ...rest } = node as Record<string, unknown> & {
    $id?: string
    parentId?: string
    nodes?: Aglyn.NodeSchemaNested<any>[]
  }
  return {
    ...rest,
    nodes: (Array.isArray(rest.nodes) ? rest.nodes : []).map(detach),
  } as Aglyn.NodeSchemaNested<any>
}

/**
 * Drop any node that already travels inside another node in the same
 * selection. Selecting a Stack *and* one of its children and hitting copy
 * should yield one column, not a column plus a second loose copy of a row
 * that is already inside it.
 */
const withoutNestedDuplicates = (
  nodes: Aglyn.NodeSchema<any>[],
): Aglyn.NodeSchema<any>[] => {
  const ids = new Set(nodes.map((node) => node?.$id).filter(Boolean))
  return nodes.filter((node) => {
    if (!node?.$id) return false
    // breadcrumbPath is [root, ...ancestors, self] — an ancestor also in the
    // selection means this node is already covered by that ancestor's copy.
    const ancestors = (node.breadcrumbPath ?? []).filter(
      (id: Aglyn.NodeId) => id !== node.$id,
    )
    return !ancestors.some((id: Aglyn.NodeId) => ids.has(id))
  })
}

const persist = (entry: ClipboardEntry | null): void => {
  const store = storage()
  if (!store) return
  try {
    if (entry) store.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(entry))
    else store.removeItem(CLIPBOARD_STORAGE_KEY)
  } catch {
    // A full or unavailable quota only costs cross-document paste; the
    // in-memory entry still works for this document.
  }
}

const readMirror = (): ClipboardEntry | null => {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(CLIPBOARD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ClipboardEntry
    if (parsed?.version !== CLIPBOARD_FORMAT_VERSION) return null
    if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * The current entry, hydrating from the `localStorage` mirror the first
 * time it is asked for in this document.
 */
export function getEntry(): ClipboardEntry | null {
  if (!state.hydrated) {
    const mirrored = readMirror()
    runInAction(() => {
      state.hydrated = true
      if (mirrored && !state.entry) state.entry = mirrored
    })
  }
  return state.entry
}

/** Whether there is anything to paste. */
export function hasContent(): boolean {
  return !!getEntry()?.nodes?.length
}

/** Labels of the copied elements, in copy order. */
export function getLabels(): string[] {
  return getEntry()?.labels ?? []
}

/**
 * Copy one or more live nodes. The document root is skipped — pasting a
 * whole document into itself is never what the gesture meant.
 *
 * Returns the number of elements actually copied.
 */
export function copyNodes(nodes: Aglyn.NodeSchema<any>[]): number {
  const copyable = withoutNestedDuplicates(
    (nodes ?? []).filter((node) => node && !Aglyn.canvas.isRootNode(node)),
  )
  if (!copyable.length) return 0

  const entry: ClipboardEntry = {
    version: CLIPBOARD_FORMAT_VERSION,
    labels: copyable.map(
      (node) => node.labelShort ?? node.componentId ?? 'element',
    ),
    nodes: copyable.map((node) => detach(Aglyn.canvas.makeNested(node))),
  }
  runInAction(() => {
    state.entry = entry
    state.hydrated = true
  })
  persist(entry)
  return copyable.length
}

export function clear(): void {
  runInAction(() => {
    state.entry = null
    state.hydrated = true
  })
  persist(null)
}

/**
 * A plain result object rather than a discriminated union: an `ok: true |
 * false` union stops narrowing once it crosses a library boundary (the
 * emitted declaration widens the tag to `boolean`), so consumers in the
 * designer would have to cast. Callers test `error`.
 */
export interface PasteResult {
  /** What landed on the canvas — empty when `error` is set. */
  nodes: Aglyn.NodeSchema<any>[]
  /** Set when nothing was pasted, explaining why. */
  error?: string
}

/**
 * Paste the clipboard next to / inside `target`, resolved exactly the way
 * the Add-element flow resolves an insertion point: a container receives the
 * elements as children, a leaf gets them as its next siblings.
 *
 * Rejects — rather than half-pasting — when the clipboard came from a
 * document whose element catalog this one does not share (an email besigner
 * has no Screen Link), or when the lineal rules forbid the arrangement.
 * An `error` result means nothing was written to the canvas.
 */
export function pasteInto(target?: Aglyn.NodeSchema<any>): PasteResult {
  const entry = getEntry()
  if (!entry?.nodes?.length) return { nodes: [], error: 'Nothing to paste' }

  const { parent, index } = Aglyn.canvas.resolveInsertTarget(target)
  if (!parent) return { nodes: [], error: 'Nowhere to paste this' }

  // Every component in every subtree has to exist in THIS app before
  // anything lands, so a rejected paste leaves the canvas untouched.
  const unknown = entry.nodes
    .flatMap((node) => collectComponentIds(node))
    .find((id) => !Aglyn.components.getFactory(id as any))
  if (unknown) {
    return {
      nodes: [],
      error: `This copy uses "${unknown}", which isn't available here`,
    }
  }

  // Pasting follows the same lineal placement rules as inserting and dnd —
  // without this, a paste can create an arrangement that drag-and-drop then
  // (correctly) refuses to move.
  const parentActor: LinealItem = {
    componentId: parent.componentId,
    pluginId: parent.pluginId,
    restrictChildren: parent.componentSchema?.restrictChildren,
    restrictParent: parent.componentSchema?.restrictParent,
  }
  for (const nested of entry.nodes) {
    const schema = Aglyn.components.getSchema(nested.componentId as any)
    const item: LinealItem = {
      componentId: nested.componentId as any,
      pluginId: nested.pluginId as any,
      restrictChildren: schema?.restrictChildren,
      restrictParent: schema?.restrictParent,
    }
    const [valid, reason] = confirmValidLinealRelationship(item, parentActor)
    if (!valid) {
      return {
        nodes: [],
        error: describeInvalidLinealRelationship(item, parentActor, reason),
      }
    }
  }

  const pasted: Aglyn.NodeSchema<any>[] = []
  entry.nodes.forEach((nested, i) => {
    // Sequential indices keep multi-element pastes in copy order; NaN keeps
    // the append-to-end behaviour of a container target.
    const at = isNaN(index) ? NaN : index + i
    pasted.push(Aglyn.canvas.addNodeFromNested(nested, parent, at))
  })
  return { nodes: pasted }
}

/** Every `componentId` in a nested subtree, root first. */
export function collectComponentIds(
  node: Aglyn.NodeSchemaNested<any>,
  out: string[] = [],
): string[] {
  if (!node) return out
  if (node.componentId) out.push(node.componentId as string)
  for (const child of Array.isArray(node.nodes) ? node.nodes : []) {
    collectComponentIds(child as Aglyn.NodeSchemaNested<any>, out)
  }
  return out
}
