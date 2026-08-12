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
import {
  applyDatasetQuery,
  parseDatasetFilter,
  parseDatasetSort,
} from './dataset-query'

/** Namespaces cloned template ids per container/record. */
export const REPEAT_NODE_ID_PREFIX = 'rep__'

/**
 * `{{item.field}}` token, plus an optional single reference hop
 * (`{{item.author.name}}`, AGL-180). One hop only — the pattern itself is
 * the depth guard, so cycles can't recurse.
 */
const ITEM_TOKEN_PATTERN =
  /\{\{\s*item\.([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?\s*\}\}/g

/** Hard bound on rows a single repeatable renders, before `repeatLimit`. */
export const REPEAT_MAX_RECORDS = 100

export interface RepeatableDataset {
  /**
   * Row value maps, in display order. Rows carry `$id` (needed to resolve
   * incoming references); values may be typed (AGL-177), stringified at
   * substitution.
   */
  records: Array<Record<string, unknown>>
  /** Typed model (AGL-177); required for reference-hop bindings. */
  model?: import('./dataset-models').DatasetModel
}

interface SubstituteContext {
  record: Record<string, unknown>
  /** Model of the repeated dataset (reference hops need field configs). */
  model?: import('./dataset-models').DatasetModel
  /** All host datasets keyed by id (and name) for hop resolution. */
  datasetsByKey?: Record<string, RepeatableDataset | undefined>
}

const displayValue = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : String(value)

/** Resolves `{{item.ref.field}}`: FKey(s) → target document field value. */
function resolveReferenceHop(
  context: SubstituteContext,
  fieldId: string,
  targetFieldId: string,
): string | null {
  const field = context.model?.fields?.[fieldId]
  if (field?.type !== 'reference' || !field.reference?.datasetId) return null
  const target = context.datasetsByKey?.[field.reference.datasetId]
  if (!target) return null
  const keys = context.record[fieldId]
  const ids = Array.isArray(keys) ? keys : keys != null ? [keys] : []
  const resolved = ids
    .map((id) => {
      const match = target.records.find((row) => row['$id'] === id)
      const value = match?.[targetFieldId]
      return value != null ? displayValue(value) : null
    })
    .filter((value): value is string => value != null)
  return resolved.length ? resolved.join(', ') : null
}

function substituteValue(
  value: unknown,
  context: SubstituteContext,
): unknown {
  const { record } = context
  if (typeof value === 'string') {
    return value.replace(
      ITEM_TOKEN_PATTERN,
      (token, field: string, hop?: string) => {
        if (hop) {
          const resolved = resolveReferenceHop(context, field, hop)
          return resolved != null ? resolved : token
        }
        return record[field] != null ? displayValue(record[field]) : token
      },
    )
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substituteValue(entry, context))
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      next[key] = substituteValue(entry, context)
    }
    return next
  }
  return value
}

/** A node is a repeatable container iff it names a dataset to repeat over. */
const repeatDatasetKey = (node: unknown): string => {
  const key = (node as { props?: { repeatDataset?: unknown } })?.props
    ?.repeatDataset
  return typeof key === 'string' ? key.trim() : ''
}

/**
 * Does this tree contain anything {@link expandRepeatables} would expand?
 *
 * Exported so the tenant compose pipeline can decide whether to PAY for the
 * datasets read at all (AGL-1440). That read is the single worst amplifier on
 * the render path — every dataset the host may see, plus up to
 * {@link REPEAT_MAX_RECORDS} records each, up to ~5,050 Firestore reads — and
 * it was issued unconditionally, including on the great majority of pages that
 * repeat over nothing.
 *
 * The gate has to ask EXACTLY the question the expansion asks, which is why
 * `expandRepeatables` is built on this same predicate rather than on a second
 * copy of it. A gate that is even slightly stricter than the expansion is not a
 * saving: it is a published page that quietly renders one template row where
 * the author put a list.
 */
export function hasRepeatableNodes(
  nodes: Record<NodeId, unknown> | null | undefined,
): boolean {
  if (!nodes) return false
  return Object.values(nodes).some((node) => repeatDatasetKey(node) !== '')
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
  const repeatIds = Object.entries(nodes).filter(
    ([, node]) => repeatDatasetKey(node) !== '',
  )
  if (!repeatIds.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of repeatIds) {
    const key = repeatDatasetKey(container)
    const dataset = datasetsByKey[key]
    // Query config (AGL-181): `repeatFilter` ("field op value") and
    // `repeatSort` ("field asc|desc") evaluate in memory over the
    // fetch-bounded rows; unparseable input fails open (no filter).
    const where = parseDatasetFilter(
      String((container.props as any).repeatFilter ?? ''),
    )
    const orderBy = parseDatasetSort(
      String((container.props as any).repeatSort ?? ''),
    )
    const records = applyDatasetQuery(dataset?.model, dataset?.records ?? [], {
      ...(where ? { where: [where] } : {}),
      ...(orderBy ? { orderBy } : {}),
    })
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
          props: substituteValue(node.props ?? {}, {
            record,
            model: dataset?.model,
            datasetsByKey,
          }) as any,
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
