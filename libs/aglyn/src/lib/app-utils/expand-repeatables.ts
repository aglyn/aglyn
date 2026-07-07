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

/** Namespaces cloned template ids per container/record. */
export const REPEAT_NODE_ID_PREFIX = 'rep__'

/** `{{item.field}}` token in a repeated template's string props. */
const ITEM_TOKEN_PATTERN = /\{\{\s*item\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

/** Hard bound on rows a single repeatable renders, before `repeatLimit`. */
export const REPEAT_MAX_RECORDS = 100

export interface RepeatableDataset {
  /** Row value maps, in display order. */
  records: Array<Record<string, string>>
}

function substituteValue(value: unknown, record: Record<string, string>) {
  if (typeof value === 'string') {
    return value.replace(ITEM_TOKEN_PATTERN, (token, field) =>
      record[field] != null ? record[field] : token,
    )
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substituteValue(entry, record))
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      next[key] = substituteValue(entry, record)
    }
    return next
  }
  return value
}

/**
 * Repeatable components (AGL-103): a container node carrying
 * `props.repeatDataset` (dataset id or display name) treats its children as
 * the item template and renders them once per dataset record, with
 * `{{item.field}}` tokens in cloned string props replaced by that record's
 * values (unknown fields keep the literal token, like variable bindings).
 *
 * - Clone ids are namespaced `rep__{containerId}__{index}__…` so repeats
 *   never collide, including inside grafted reusable components — run this
 *   AFTER `composeReusableComponentNodes` and BEFORE binding resolution.
 * - Rows are bounded by `props.repeatLimit` and {@link REPEAT_MAX_RECORDS}.
 * - Unknown datasets or empty records leave the node untouched (fail-open:
 *   a deleted dataset must never take a published screen down).
 * - Inputs are never mutated; template nodes stay in the map unreferenced.
 */
export function expandRepeatables<N extends AglynNodeSchema = AglynNodeSchema>(
  nodes: Record<NodeId, N>,
  datasetsByKey: Record<string, RepeatableDataset | undefined> | undefined,
): Record<NodeId, N> {
  if (!datasetsByKey) return nodes
  const repeatIds = Object.entries(nodes).filter(([, node]) => {
    const key = (node?.props as any)?.repeatDataset
    return typeof key === 'string' && key.trim() !== ''
  })
  if (!repeatIds.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of repeatIds) {
    const key = String((container.props as any).repeatDataset).trim()
    const dataset = datasetsByKey[key]
    const records = dataset?.records ?? []
    if (!records.length) continue
    const limitRaw = Number((container.props as any).repeatLimit)
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, REPEAT_MAX_RECORDS)
        : REPEAT_MAX_RECORDS
    const templateIds = Array.isArray(container.nodes)
      ? (container.nodes as NodeId[])
      : []
    if (!templateIds.length) continue

    const childIds: NodeId[] = []
    records.slice(0, limit).forEach((record, index) => {
      const prefix = `${REPEAT_NODE_ID_PREFIX}${containerId}__${index}__`
      const prefixId = (id: NodeId) => `${prefix}${id}`
      const cloneSubtree = (id: NodeId, parentId: NodeId) => {
        const node = nodes[id]
        if (!node) return
        const clonedChildren = Array.isArray(node.nodes)
          ? (node.nodes as NodeId[])
          : undefined
        next[prefixId(id)] = {
          ...node,
          $id: prefixId(id),
          parentId,
          props: substituteValue(node.props ?? {}, record) as any,
          ...(clonedChildren && {
            nodes: clonedChildren.map((childId) => prefixId(childId)),
          }),
        }
        clonedChildren?.forEach((childId) =>
          cloneSubtree(childId, prefixId(id)),
        )
      }
      for (const templateId of templateIds) {
        cloneSubtree(templateId, containerId)
        childIds.push(prefixId(templateId))
      }
    })
    next[containerId] = { ...container, nodes: childIds }
  }
  return next
}

export default expandRepeatables
