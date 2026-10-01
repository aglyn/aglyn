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
 * A published page's node map as it crosses from the server into the
 * browser, stating each node's id once (AGL-3401, AGL-3438).
 *
 * The map rides in the page's flight payload, inside its HTML, and it is
 * nearly all of that payload: 346 KB of aglyn.com/press's 376 KB. A stored
 * map names every node three times — as its key, as its `$id`, and in its
 * parent's `nodes` list — and once more as `parentId` in each child. The
 * ids are random, which is the part of the map compression does least with,
 * so every repeat costs close to its full length on the wire.
 *
 * Packed, the map is a TREE in document order: each node is an entry
 * `[id, fields, ...children]`, and a child is either its own entry, inlined
 * where its parent lists it, or its bare id when the node is inlined
 * somewhere else or is not in the map at all. The id is stated once, by its
 * entry; `$id`, `parentId` and `nodes` are left out of `fields` whenever the
 * entry's position says the same thing. On aglyn.com/press that is 6.8 KB
 * less HTML on the wire than the AGL-3401 packing, which only dropped
 * `$id` and `parentId`.
 *
 * `packNodesForWire` drops a field only when `unpackWireNodes` will put back
 * the same value — an `$id` that differs from its key, a `parentId` other
 * than the parent the node is inlined under, or a `nodes` value that is not
 * a list of ids stays in `fields` — so every node comes back equal to the
 * one that left, well-formed map or not. (One that carried no `$id`, or no
 * `parentId` under a parent that lists it, comes back with them.) A child
 * two parents list is inlined under the first and named by id in the other,
 * a cycle is cut where it closes, and a node no list reaches is an entry of
 * its own at the top level — so every key comes back, in document order.
 *
 * Unpacking also takes the flat form — a full map, or one packed by the
 * AGL-3401 format — and fills in each `$id` and `parentId` it can from the
 * keys and `nodes` lists, so it is idempotent. That is what lets a full patch
 * (a withheld panel from `/api/screen/nodes`) be merged over an unpacked map
 * and unpacked again.
 *
 * Banner-free and dependency-free: the tenant's server page packs and its
 * client root unpacks, so it must be importable from both.
 */

/** A node as the map carries it: an object, keyed by its id. */
type WireNode = Record<string, unknown> & {
  $id?: unknown
  parentId?: unknown
  nodes?: unknown
}

/** A node map, packed or not. */
export type WireNodeMap<N = WireNode> = Record<string, N | null | undefined>

/**
 * One node of the packed tree: its id, the fields its position does not
 * already state, and its children — each an entry of its own, or the id of a
 * node that is entered elsewhere or nowhere.
 */
type WireEntry = [id: string, fields: unknown, ...children: WireChild[]]
type WireChild = WireEntry | string

/**
 * The one key a packed map has. `~` is outside the alphabet node ids are
 * drawn from; a map that nevertheless has that key ships flat rather than
 * risk being read back as a tree.
 */
const WIRE_TREE_KEY = '~'

const isNode = (value: unknown): value is WireNode =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** A `nodes` value the tree can carry as its children: ids, and only ids. */
const childIds = (node: WireNode): string[] | undefined =>
  Array.isArray(node.nodes) &&
  node.nodes.length > 0 &&
  node.nodes.every((child) => typeof child === 'string')
    ? (node.nodes as string[])
    : undefined

/** Each child id to the key of the node whose `nodes` list names it. */
function parentsOf(nodes: WireNodeMap): Map<string, string> {
  const parents = new Map<string, string>()
  const claimed = new Set<string>()
  for (const [key, node] of Object.entries(nodes)) {
    const children = node?.nodes
    if (!Array.isArray(children)) continue
    for (const child of children) {
      if (typeof child !== 'string') continue
      // A child two parents list has no single answer, so neither may stand
      // in for the `parentId` it stores.
      if (claimed.has(child)) parents.delete(child)
      else parents.set(child, key)
      claimed.add(child)
    }
  }
  return parents
}

/** Whether `value` is a map packed by {@link packNodesForWire}. */
function isPackedTree(
  value: unknown,
): value is { [WIRE_TREE_KEY]: WireEntry[] } {
  if (!value || typeof value !== 'object') return false
  const keys = Object.keys(value)
  return (
    keys.length === 1 &&
    keys[0] === WIRE_TREE_KEY &&
    Array.isArray((value as Record<string, unknown>)[WIRE_TREE_KEY])
  )
}

/**
 * The map as a tree of entries in document order: every node reachable from
 * a node no list names, then any node that leaves out (a cycle, or a subtree
 * whose only parent is unreachable), each as an entry of its own. A new
 * structure throughout; the argument is never mutated, because the server's
 * is the cached loader's.
 *
 * Typed as the map it is handed rather than as a looser one: the packed form
 * has one reader, `unpackWireNodes`, and the prop it travels in is read
 * nowhere else, so a second type would buy a cast at both ends.
 */
export function packNodesForWire<M extends WireNodeMap | null | undefined>(
  nodes: M,
): M {
  if (!nodes) return nodes
  if (Object.prototype.hasOwnProperty.call(nodes, WIRE_TREE_KEY)) return nodes
  const map = nodes as WireNodeMap
  const listed = new Set<string>()
  for (const node of Object.values(map)) {
    if (!isNode(node)) continue
    for (const child of childIds(node) ?? []) listed.add(child)
  }
  const entered = new Set<string>()
  const enter = (key: string, parent: string | undefined): WireEntry => {
    entered.add(key)
    const node = map[key]
    if (!isNode(node)) return [key, node]
    const { $id, parentId, nodes: list, ...rest } = node
    const fields: WireNode = rest
    if ('$id' in node && $id !== key) fields.$id = $id
    if ('parentId' in node && parentId !== parent) fields.parentId = parentId
    const children = childIds(node)
    if (!children) {
      if ('nodes' in node) fields.nodes = list
      return [key, fields]
    }
    const entry: WireEntry = [key, fields]
    for (const child of children) {
      entry.push(
        Object.prototype.hasOwnProperty.call(map, child) && !entered.has(child)
          ? enter(child, key)
          : child,
      )
    }
    return entry
  }
  const tree: WireEntry[] = []
  for (const key of Object.keys(map)) {
    if (!listed.has(key) && !entered.has(key)) tree.push(enter(key, undefined))
  }
  for (const key of Object.keys(map)) {
    if (!entered.has(key)) tree.push(enter(key, undefined))
  }
  return { [WIRE_TREE_KEY]: tree } as unknown as M
}

/**
 * The map with every node whole: from a packed tree, each entry back under
 * its id with its `$id`, its `parentId` and its `nodes` list restored; from a
 * flat map, each node's `$id` and `parentId` filled in from its key and its
 * parent's `nodes` list. A node that already carries either keeps its own,
 * so a full map comes back equal.
 */
export function unpackWireNodes<M extends WireNodeMap | null | undefined>(
  nodes: M,
): M {
  if (!nodes) return nodes
  if (isPackedTree(nodes)) return unpackTree(nodes[WIRE_TREE_KEY]) as M
  const parents = parentsOf(nodes)
  const unpacked: WireNodeMap = {}
  for (const [key, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') {
      unpacked[key] = node
      continue
    }
    const parent = parents.get(key)
    const needsId = !('$id' in node)
    const needsParent = !('parentId' in node) && parent !== undefined
    unpacked[key] =
      needsId || needsParent
        ? {
            ...(needsId ? { $id: key } : {}),
            ...node,
            ...(needsParent ? { parentId: parent } : {}),
          }
        : node
  }
  return unpacked as M
}

function unpackTree(tree: readonly WireEntry[]): WireNodeMap {
  const out: WireNodeMap = {}
  const visit = (entry: WireEntry, parent: string | undefined): void => {
    const [key, fields, ...children] = entry
    if (!isNode(fields)) {
      out[key] = fields as WireNode | null | undefined
      return
    }
    const node: WireNode = { $id: key, ...fields }
    if (children.length) {
      node.nodes = children.map((child) =>
        typeof child === 'string' ? child : child[0],
      )
    }
    if (parent !== undefined && !('parentId' in fields)) node.parentId = parent
    out[key] = node
    for (const child of children) if (typeof child !== 'string') visit(child, key)
  }
  for (const entry of tree) visit(entry, undefined)
  return out
}
