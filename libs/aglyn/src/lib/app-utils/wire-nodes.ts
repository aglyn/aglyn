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
 * browser, without the two fields the map already states (AGL-3401).
 *
 * The map rides in the page's flight payload, inside its HTML, and on
 * aglyn.com it was 242 KB of it. Every node repeats its own key as `$id` and
 * its parent's key as `parentId`, though the key IS the id and the parent's
 * `nodes` list already says whose child it is. Both are random ids, which is
 * the part of the map compression does least with: dropping them took the
 * map from 34.5 KB to about 28.5 KB gzipped on that page.
 *
 * `packNodesForWire` drops a field only when `unpackWireNodes` will put back
 * the same value — an `$id` that differs from its key, or a `parentId` no
 * single parent's `nodes` list agrees with, is left in place — so a node that
 * carries both comes back exactly as it left, well-formed map or not. (One
 * that carried neither comes back with them.) Unpacking is idempotent, which is
 * what lets a full map (a withheld panel's patch from `/api/screen/nodes`, a
 * members-only tree) be merged over a packed one and unpacked together.
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

/**
 * The map without each `$id` that equals its key and each `parentId` its
 * parent's `nodes` list states. A new map of new node objects; the argument
 * is never mutated, because the server's is the cached loader's.
 *
 * Typed as the map it is handed rather than as a looser one: the packed form
 * has one reader, `unpackWireNodes`, and the prop it travels in is read
 * nowhere else, so a second type would buy a cast at both ends.
 */
export function packNodesForWire<M extends WireNodeMap | null | undefined>(
  nodes: M,
): M {
  if (!nodes) return nodes
  const parents = parentsOf(nodes)
  const packed: WireNodeMap = {}
  for (const [key, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') {
      packed[key] = node
      continue
    }
    const { $id, parentId, ...rest } = node
    const out: WireNode = rest
    if ($id !== key) out.$id = $id
    if (parentId !== undefined && parentId !== parents.get(key)) {
      out.parentId = parentId
    }
    packed[key] = out
  }
  return packed as M
}

/**
 * The map with every node's `$id` and `parentId` back, from its key and its
 * parent's `nodes` list. A node that already carries either keeps its own,
 * so an unpacked map comes back equal and a packed one merged with an
 * unpacked patch comes back whole.
 */
export function unpackWireNodes<M extends WireNodeMap | null | undefined>(
  nodes: M,
): M {
  if (!nodes) return nodes
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
