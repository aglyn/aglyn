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

import { CANVAS_ROOT_ELEMENT_ID } from '../foundation/constants/canvas'
import { ensureCanvasRoot } from './ensure-canvas-root'

type Nodes = Record<string, any>

/** What was wrong with one node, and what was done about it. */
export interface CanvasRepairFinding {
  /** The node the finding is about — a map key, or an id listed on a parent. */
  nodeId: string
  /** Best available human label: the node's name, else its componentId. */
  label?: string
  kind:
    | 'not-a-node'
    | 'no-component'
    | 'unknown-component'
    | 'dangling-child'
    | 'orphaned'
    | 'cycle'
    | 'unreachable'
    | 'unlisted'
  action: 'removed' | 'reparented' | 'relisted' | 'unlinked'
  /** One sentence an author can read, written for the preview dialog. */
  detail: string
}

export interface CanvasRepairResult {
  /** The repaired map. Reference-equal to nothing — always a fresh object. */
  nodes: Nodes
  findings: CanvasRepairFinding[]
  /** Node ids dropped from the document. */
  removed: string[]
  /** Node ids that kept their content but moved. */
  reparented: string[]
  /** How many nodes the repair KEPT, root excluded. */
  kept: number
  /** True when the document was already sound and `nodes` is unchanged. */
  healthy: boolean
}

export interface CanvasRepairOptions {
  /**
   * Whether a `componentId` still resolves to a registered component.
   *
   * OPTIONAL on purpose, and skipped entirely when absent. A resolver that
   * has not finished loading its plugins answers "no" for everything, and a
   * repair that believes it would delete the whole document — the same shape
   * of mistake as a stubbed resolver making every capacity ceiling read zero.
   * Pass it only from a caller that knows the registry is populated.
   */
  isKnownComponent?: (componentId: string) => boolean
}

function labelOf(node: any): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const name = typeof node.name === 'string' ? node.name.trim() : ''
  if (name) return name
  return typeof node.componentId === 'string' ? node.componentId : undefined
}

/**
 * Strip what a canvas cannot render, keep everything that still works
 * (AGL-2555).
 *
 * ## Why this exists rather than "clear and start again"
 *
 * A besigner document corrupted while `/alternatives/webflow` was being
 * built: the hierarchy rendered literal `'Invalid node'` rows, section order
 * scrambled, two component instances stopped resolving — and the damage
 * survived a reload, so it was persisted in the draft rather than client
 * state. **Most of the document was still fine.** The prose, the FAQ
 * accordions and the layout binding all rendered correctly. Only some nodes
 * were broken, and the only way out of it was to delete the screen and
 * rebuild every one of them.
 *
 * That is the whole case: an author in this position should lose the handful
 * of nodes that are actually broken, not the hours of work around them.
 *
 * ## What counts as broken
 *
 * Every case here is one the canvas already fails on somewhere, not a rule
 * invented for this function:
 *
 * - **not-a-node** — `canvas-manager` throws `Invalid node` on a null or
 *   non-object entry.
 * - **no-component** / **unknown-component** — nothing to render. The second
 *   is only checked when the caller supplies a resolver it trusts.
 * - **dangling-child** — an id listed on a parent that the map does not
 *   hold. This is the one that renders `'Invalid node'`: `node-tree-view`
 *   maps over the parent's child ids and prints that string for every id
 *   that resolves to nothing. The PARENT is fine; the stale id is dropped.
 * - **orphaned** — `parentId` names a node that is not in the map. Adopted
 *   by the root, which is the rule `ensureCanvasRoot` already established:
 *   recovering into an editable document beats discarding what is there.
 * - **cycle** — a node that is its own ancestor. Walking `parent` upward is
 *   what the hierarchy and the breadcrumb both do, so a loop does not
 *   degrade the UI, it hangs the tab. A stored root that is its own parent
 *   is the shape this was measured in.
 * - **unreachable** — in the map, but no walk from the root reaches it.
 *   These are invisible and still saved, still shipped, still counted
 *   against the 1 MiB ceiling — AGL-1363 found 61 of them on `/product`,
 *   26 carrying the only copy of two Hero sections' text. So they are
 *   RE-PARENTED, never dropped: an author can see and delete a node that is
 *   on the canvas, and cannot do either to one that is not.
 * - **unlisted** — `parentId` agrees, the parent's child list does not. The
 *   node is relisted rather than moved.
 *
 * ## What it will not do
 *
 * It removes nodes only for the first three, and every removal takes the
 * subtree hanging off it — a child of an unrenderable node has nowhere to
 * be. Everything else is a link repair that keeps the content, because a
 * repair tool that deletes more than it has to is the corruption with
 * better manners.
 *
 * ⚠️ Not an auto-heal. The result carries a full account of what it would
 * do so a caller can put it in front of the author BEFORE anything is
 * applied; a quiet repair that removes content is worse than the damage.
 */
export function repairCanvasNodes(
  nodes: Nodes | undefined,
  options: CanvasRepairOptions = {},
): CanvasRepairResult {
  const { isKnownComponent } = options
  // A rootless map is its own defect, and it has an owner already. Doing it
  // first means every walk below has a root to start from.
  const source = ensureCanvasRoot(nodes)
  const findings: CanvasRepairFinding[] = []
  const removed: string[] = []
  const reparented: string[] = []

  // ── 1. Entries that are not renderable nodes ────────────────────────────
  const map: Nodes = {}
  for (const [id, node] of Object.entries(source)) {
    if (!node || typeof node !== 'object') {
      removed.push(id)
      findings.push({
        nodeId: id,
        kind: 'not-a-node',
        action: 'removed',
        detail: 'Not an element — the canvas cannot render this entry.',
      })
      continue
    }
    if (id !== CANVAS_ROOT_ELEMENT_ID) {
      const componentId = node.componentId
      if (typeof componentId !== 'string' || !componentId) {
        removed.push(id)
        findings.push({
          nodeId: id,
          label: labelOf(node),
          kind: 'no-component',
          action: 'removed',
          detail: 'No element type — there is nothing to draw.',
        })
        continue
      }
      if (isKnownComponent && !isKnownComponent(componentId)) {
        removed.push(id)
        findings.push({
          nodeId: id,
          label: labelOf(node),
          kind: 'unknown-component',
          action: 'removed',
          detail: `"${componentId}" is not an element this site has — it may come from a plugin that is switched off.`,
        })
        continue
      }
    }
    map[id] = { ...node, nodes: Array.isArray(node.nodes) ? [...node.nodes] : [] }
  }

  // A removed node takes its subtree: a child of something unrenderable has
  // nowhere to be, and re-parenting it to the root would strand a fragment
  // the author never authored at the top of the document.
  let grew = true
  while (grew) {
    grew = false
    for (const [id, node] of Object.entries(map)) {
      if (id === CANVAS_ROOT_ELEMENT_ID) continue
      const parentId = node.parentId
      if (typeof parentId === 'string' && removed.includes(parentId)) {
        delete map[id]
        removed.push(id)
        findings.push({
          nodeId: id,
          label: labelOf(node),
          kind: 'not-a-node',
          action: 'removed',
          detail: 'Sat inside an element that had to be removed.',
        })
        grew = true
      }
    }
  }

  // ── 2. Child ids that resolve to nothing — the 'Invalid node' rows ──────
  for (const [id, node] of Object.entries(map)) {
    const kept: string[] = []
    for (const childId of node.nodes as string[]) {
      if (typeof childId === 'string' && map[childId]) {
        kept.push(childId)
        continue
      }
      findings.push({
        nodeId: typeof childId === 'string' ? childId : String(childId),
        kind: 'dangling-child',
        action: 'unlinked',
        detail: `Listed inside "${labelOf(node) ?? id}" but not present — this is what shows as "Invalid node".`,
      })
    }
    node.nodes = kept
  }

  // ── 3. Parents that do not exist, and loops ─────────────────────────────
  const adopt = (
    id: string,
    kind: CanvasRepairFinding['kind'],
    detail: string,
  ) => {
    const node = map[id]
    const previous = node.parentId
    node.parentId = CANVAS_ROOT_ELEMENT_ID
    if (typeof previous === 'string' && map[previous]) {
      map[previous].nodes = (map[previous].nodes as string[]).filter(
        (child) => child !== id,
      )
    }
    if (!(map[CANVAS_ROOT_ELEMENT_ID].nodes as string[]).includes(id)) {
      ;(map[CANVAS_ROOT_ELEMENT_ID].nodes as string[]).push(id)
    }
    reparented.push(id)
    findings.push({ nodeId: id, label: labelOf(node), kind, action: 'reparented', detail })
  }

  for (const id of Object.keys(map)) {
    if (id === CANVAS_ROOT_ELEMENT_ID) continue
    const parentId = map[id].parentId
    if (typeof parentId !== 'string' || !map[parentId]) {
      adopt(
        id,
        'orphaned',
        'Its container is gone — moved to the top level so you can put it back.',
      )
    }
  }

  for (const id of Object.keys(map)) {
    if (id === CANVAS_ROOT_ELEMENT_ID) continue
    // Bounded by the map size, so a loop ends rather than hanging the way
    // the hierarchy's own upward walk does.
    const seen = new Set<string>([id])
    let cursor: string | undefined = map[id].parentId
    let looped = false
    while (typeof cursor === 'string' && map[cursor]) {
      if (seen.has(cursor)) {
        looped = true
        break
      }
      seen.add(cursor)
      if (cursor === CANVAS_ROOT_ELEMENT_ID) break
      cursor = map[cursor].parentId
    }
    if (looped) {
      adopt(
        id,
        'cycle',
        'Was inside itself — a loop the hierarchy cannot walk out of. Moved to the top level.',
      )
    }
  }

  // ── 4. Reachability, and links that disagree with themselves ───────────
  for (const id of Object.keys(map)) {
    if (id === CANVAS_ROOT_ELEMENT_ID) continue
    const parent = map[map[id].parentId]
    if (!parent) continue
    if (!(parent.nodes as string[]).includes(id)) {
      ;(parent.nodes as string[]).push(id)
      findings.push({
        nodeId: id,
        label: labelOf(map[id]),
        kind: 'unlisted',
        action: 'relisted',
        detail: `Belonged to "${labelOf(parent) ?? map[id].parentId}" but was not listed in it — put back in place.`,
      })
    }
  }

  const reachable = new Set<string>()
  const queue = [CANVAS_ROOT_ELEMENT_ID]
  while (queue.length) {
    const id = queue.shift()!
    if (reachable.has(id)) continue
    reachable.add(id)
    for (const childId of map[id]?.nodes ?? []) {
      if (map[childId]) queue.push(childId)
    }
  }
  for (const id of Object.keys(map)) {
    if (reachable.has(id)) continue
    adopt(
      id,
      'unreachable',
      'Saved with the document but never drawn — moved to the top level so you can see it and decide.',
    )
  }

  const kept = Object.keys(map).length - 1
  return {
    nodes: map,
    findings,
    removed,
    reparented,
    kept,
    healthy: findings.length === 0,
  }
}

/**
 * The document a newly created screen has: a root with nothing in it
 * (AGL-2554).
 *
 * Built from `repairCanvasNodes` rather than `{}` so it works on the
 * document that needs it most. Clearing is wanted precisely when the tree
 * holds nodes the hierarchy cannot render — those rows are not selectable,
 * so `Delete Element` cannot reach them and there is no click-path to empty
 * the document at all. Running the repair first means the root that survives
 * is a sound one whatever shape the map was in, including no root at all.
 *
 * The root's own fields are kept. It carries the document's own styling —
 * background, padding, the page's own `sx` — and an author asking for a
 * blank canvas is asking to remove the CONTENT, not to reset the page.
 */
export function clearCanvasNodes(nodes: Nodes | undefined): Nodes {
  const { nodes: repaired } = repairCanvasNodes(nodes)
  return {
    [CANVAS_ROOT_ELEMENT_ID]: {
      ...repaired[CANVAS_ROOT_ELEMENT_ID],
      $id: CANVAS_ROOT_ELEMENT_ID,
      parentId: null,
      nodes: [],
    },
  }
}

export default repairCanvasNodes
