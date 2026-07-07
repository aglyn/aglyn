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

import type { AglynNodeSchema, NodeId } from '../foundation'

/**
 * Persisted component id of a reusable-component instance node. Persisted in
 * screen documents — never rename (cf. `layoutSlot`, legacy `muiXxx` ids).
 */
export const REUSABLE_INSTANCE_COMPONENT_ID = 'reusableInstance'

/**
 * Prefix namespacing a grafted definition's node ids per instance, so the
 * same definition can appear many times in one tree without id collisions.
 */
export const COMPONENT_NODE_ID_PREFIX = 'cmp__'

/**
 * Definitions may nest instances of other definitions; expansion runs in
 * passes capped here so a self-referencing definition can't recurse forever.
 */
const MAX_COMPONENT_DEPTH = 5

type NormalizedNodes<N extends AglynNodeSchema> = Record<NodeId, N>

/** Stored shape of a host-level reusable component definition's tree. */
export interface ReusableComponentTree<
  N extends AglynNodeSchema = AglynNodeSchema,
> {
  rootId: NodeId
  nodes: NormalizedNodes<N>
}

function instancePrefix(instanceId: NodeId) {
  return `${COMPONENT_NODE_ID_PREFIX}${instanceId}__`
}

/**
 * Expands reusable-component instance nodes (componentId
 * {@link REUSABLE_INSTANCE_COMPONENT_ID}, `props.refId` → definition id) by
 * grafting the referenced definition's subtree under each instance:
 *
 * - Grafted node ids are namespaced per instance (`cmp__{instanceId}__…`).
 * - The instance node keeps its identity (selection/attributes target) and
 *   gains the grafted root as its only child.
 * - Unresolvable refIds leave the instance untouched — a deleted definition
 *   must never take a published screen down.
 * - Definitions may contain instances of other definitions; expansion
 *   repeats up to {@link MAX_COMPONENT_DEPTH} passes, which also bounds
 *   accidental self-reference.
 * - Inputs are never mutated.
 */
export function composeReusableComponentNodes<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: NormalizedNodes<N>,
  definitionsById:
    | Record<string, ReusableComponentTree<N> | undefined>
    | undefined,
): NormalizedNodes<N> {
  if (!definitionsById) return nodes

  let composed: NormalizedNodes<N> = nodes
  for (let depth = 0; depth < MAX_COMPONENT_DEPTH; depth++) {
    const pending = Object.entries(composed).filter(([id, node]) => {
      if (node?.componentId !== REUSABLE_INSTANCE_COMPONENT_ID) return false
      const refId = (node.props as any)?.refId as string | undefined
      if (!refId || !definitionsById[refId]) return false
      // Already expanded in a previous pass?
      const childIds = Array.isArray(node.nodes) ? (node.nodes as NodeId[]) : []
      return !childIds.some(
        (childId) =>
          typeof childId === 'string' &&
          childId.startsWith(instancePrefix(id)),
      )
    })
    if (!pending.length) break

    const next: NormalizedNodes<N> = { ...composed }
    for (const [instanceId, instanceNode] of pending) {
      const refId = (instanceNode.props as any).refId as string
      const definition = definitionsById[refId] as ReusableComponentTree<N>
      const prefix = instancePrefix(instanceId)
      const prefixId = (id: NodeId) => `${prefix}${id}`

      for (const [defId, defNode] of Object.entries(definition.nodes)) {
        if (!defNode) continue
        next[prefixId(defId)] = {
          ...defNode,
          $id: prefixId(defNode.$id ?? defId),
          parentId:
            defId === definition.rootId
              ? instanceId
              : defNode.parentId != null
                ? prefixId(defNode.parentId)
                : defNode.parentId,
          ...(Array.isArray(defNode.nodes) && {
            nodes: (defNode.nodes as NodeId[]).map((childId) =>
              typeof childId === 'string' ? prefixId(childId) : childId,
            ),
          }),
        }
      }
      next[instanceId] = {
        ...instanceNode,
        nodes: [prefixId(definition.rootId)],
      }
    }
    composed = next
  }
  return composed
}

export default composeReusableComponentNodes
