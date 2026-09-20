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

/**
 * The key a node repeats over, trimmed, or `''` when it repeats over nothing.
 *
 * The one predicate every repeat question is asked through: the expansion, the
 * datasets-read gate below, the reusable-component graft that moves a
 * placement's repeat onto the element it becomes, and the besigner's preview
 * and badge. Two copies of it are how a `.trim()` on one side and not the
 * other becomes an empty list on a customer's page.
 */
export const repeatKey = (node: unknown): string => {
  const key = (node as { props?: { repeatDataset?: unknown } })?.props
    ?.repeatDataset
  return typeof key === 'string' ? key.trim() : ''
}

/**
 * Makes an element that holds children repeat ITSELF, once per record, instead
 * of what is inside it (AGL-3111): a card whose contents are the design, rather
 * than a list whose contents are the item.
 *
 * Persisted in screen, layout and component documents — never rename. `'true'`
 * counts too, because a switch round-tripped through a text-shaped store comes
 * back as the string.
 */
export const REPEAT_SELF_PROP = 'repeatSelf'

/**
 * Every prop that directs a repeat. They are instructions to the composition,
 * never attributes of the element: the expansion consumes them from every node
 * it expands and every copy it makes, so a published element never carries
 * one. Persisted — never rename.
 */
export const REPEAT_DIRECTIVE_PROPS: readonly string[] = [
  'repeatDataset',
  'repeatLimit',
  'repeatFilter',
  'repeatSort',
  REPEAT_SELF_PROP,
]

/**
 * What a repeating node copies once per record (AGL-3111).
 *
 * - `children` — what is inside it. The node stays one element around the
 *   copies: the list, grid or gallery they fill. This is how a Stack has
 *   always repeated (AGL-103), and a stored Stack names neither scope.
 * - `self` — the node itself, with everything inside it. What a leaf and a
 *   component instance repeat, and what any element carrying
 *   {@link REPEAT_SELF_PROP} repeats.
 */
export type RepeatScope = 'self' | 'children'

/**
 * Which scope a repeating node has, read off the node alone so the published
 * page's composition and the besigner decide it identically.
 *
 * {@link REPEAT_SELF_PROP} decides it whenever the node carries one, which is
 * every repeat the Attributes panel writes. Without one the node's own shape
 * decides, and it decides CONSERVATIVELY: anything that holds a child list —
 * a Stack, empty or not — keeps repeating its children, and only a node with
 * no child list at all repeats itself. A stored repeat predates the prop, so
 * this branch is the one that has to render it unchanged, and an author who
 * named a dataset before filling the container in would otherwise come back to
 * a hundred empty copies of it.
 *
 * A component instance never reaches that branch: the graft stamps the prop on
 * the element it becomes, whose children are the component's own.
 */
export function repeatScope(node: unknown): RepeatScope {
  const { props, nodes } = (node ?? {}) as {
    props?: Record<string, unknown>
    nodes?: unknown
  }
  // `'true'`/`'false'` too: a switch round-tripped through a text-shaped
  // store comes back as the string it was written as.
  const self = props?.[REPEAT_SELF_PROP]
  if (self === true || self === 'true') return 'self'
  if (self === false || self === 'false') return 'children'
  return Array.isArray(nodes) ? 'children' : 'self'
}

/** The node minus its repeat directives, or the node itself when it has none. */
export function withoutRepeatDirective<N>(node: N): N {
  const props = (node as { props?: Record<string, unknown> })?.props
  if (!props || !REPEAT_DIRECTIVE_PROPS.some((key) => key in props)) {
    return node
  }
  const kept = { ...props }
  for (const key of REPEAT_DIRECTIVE_PROPS) delete kept[key]
  return { ...node, props: kept }
}

/**
 * The records a repeating node renders, in order (AGL-181): its filter and sort
 * evaluated over the rows, then its limit, never past
 * {@link REPEAT_MAX_RECORDS}. An unparseable filter or sort fails open.
 *
 * Shared by the expansion and the besigner's canvas preview and badge, so the
 * canvas can never show a copy or a count the published page does not.
 */
export function repeatedRecords(
  node: unknown,
  dataset: RepeatableDataset | undefined,
): Array<Record<string, unknown>> {
  const props = ((node as { props?: unknown })?.props ?? {}) as Record<
    string,
    unknown
  >
  const where = parseDatasetFilter(String(props['repeatFilter'] ?? ''))
  const orderBy = parseDatasetSort(String(props['repeatSort'] ?? ''))
  const limit = Number(props['repeatLimit'])
  return applyDatasetQuery(dataset?.model, dataset?.records ?? [], {
    ...(where ? { where: [where] } : {}),
    ...(orderBy ? { orderBy } : {}),
  }).slice(
    0,
    Number.isFinite(limit) && limit > 0
      ? Math.min(limit, REPEAT_MAX_RECORDS)
      : REPEAT_MAX_RECORDS,
  )
}

/**
 * Does this tree contain anything {@link expandRepeatables} would expand?
 *
 * The datasets read is the largest on the render path — up to two pages of
 * {@link REPEAT_MAX_RECORDS} records for every dataset a page repeats over —
 * and a page that repeats over nothing should pay none of it (AGL-1440).
 *
 * Any gate on that read has to ask EXACTLY the question the expansion asks,
 * which is why this and {@link repeatDatasetKeys} share the one predicate
 * `expandRepeatables` looks keys up with, {@link repeatKey}. A gate that is
 * even slightly stricter than the expansion is not a saving: it is a published
 * page that quietly renders one template row where the author put a list.
 */
export function hasRepeatableNodes(
  nodes: Record<NodeId, unknown> | null | undefined,
): boolean {
  if (!nodes) return false
  return Object.values(nodes).some((node) => repeatKey(node) !== '')
}

/**
 * Every dataset key this tree repeats over — a dataset id or a display name,
 * exactly as {@link expandRepeatables} looks it up — sorted and without
 * repeats.
 *
 * What the tenant compose reads, so a page loads the datasets it renders and
 * not every dataset its site may see. Built on the same predicate as
 * {@link hasRepeatableNodes} for the reason given there.
 */
export function repeatDatasetKeys(
  nodes: Record<NodeId, unknown> | null | undefined,
): string[] {
  const keys = new Set<string>()
  for (const node of Object.values(nodes ?? {})) {
    const key = repeatKey(node)
    if (key) keys.add(key)
  }
  return [...keys].sort()
}

/**
 * Repeats (AGL-103, AGL-3111): any node carrying `props.repeatDataset` (a
 * dataset id or display name) renders once per record of that dataset, with
 * `{{item.field}}` tokens in the copied string props replaced by the record's
 * values (unknown fields keep the literal token, like variable bindings).
 *
 * What is copied is the node's {@link repeatScope}:
 *
 * - `children` — its children are the item template. The node stays, and its
 *   child list becomes the copies, record by record. Its own props are not the
 *   template, so no token in them is substituted.
 * - `self` — the node and everything inside it are the template. The copies
 *   take the node's place in its parent's child list, and every prop in the
 *   subtree is substituted, the node's own included.
 *
 * - Copy ids are namespaced `rep__{repeatId}__{index}__…` — the repeat's own
 *   id, then the template node's — so repeats never collide, including inside
 *   grafted reusable components. A self-scoped node's first copy is
 *   `rep__{id}__0__{id}`. Run this AFTER `composeReusableComponentNodes` and
 *   BEFORE binding resolution.
 * - Rows are the node's {@link repeatedRecords}.
 * - The repeat directives ({@link REPEAT_DIRECTIVE_PROPS}) are consumed: every
 *   node this expands, and every copy it makes, comes out without them.
 * - Repeats do not nest. A repeat inside another repeat's template is copied
 *   with its directives consumed, so it renders once in each copy.
 * - An unknown dataset, no matching records, an empty template, or a
 *   self-scoped node its parent does not list (the document root, say) leave
 *   the node rendering once, as written (fail-open: a deleted dataset must
 *   never take a published screen down).
 * - Inputs are never mutated; templates stay in the map unreferenced.
 */
export function expandRepeatables<N extends AglynNodeSchema = AglynNodeSchema>(
  nodes: Record<NodeId, N>,
  datasetsByKey: Record<string, RepeatableDataset | undefined> | undefined,
): Record<NodeId, N> {
  if (!datasetsByKey) return nodes
  const repeatIds = Object.entries(nodes).filter(
    ([, node]) => repeatKey(node) !== '',
  )
  if (!repeatIds.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [repeatId, repeated] of repeatIds) {
    const dataset = datasetsByKey[repeatKey(repeated)]
    const records = repeatedRecords(repeated, dataset)
    const self = repeatScope(repeated) === 'self'
    // The copies' parent: the node itself, or — for a self-scoped node — the
    // parent whose child list the copies take its place in, read from `next`
    // so two self-scoped siblings both land in the list the other has left.
    const parentId = (self ? repeated.parentId : repeatId) as NodeId
    const siblings = next[parentId]?.nodes
    const slot = Array.isArray(siblings)
      ? (siblings as NodeId[]).indexOf(repeatId)
      : -1
    const templateIds = self
      ? [repeatId]
      : Array.isArray(repeated.nodes)
        ? (repeated.nodes as NodeId[])
        : []
    next[repeatId] = withoutRepeatDirective(next[repeatId])
    if (!records.length || !templateIds.length || (self && slot < 0)) continue

    const copyIds: NodeId[] = []
    records.forEach((record, index) => {
      const prefix = `${REPEAT_NODE_ID_PREFIX}${repeatId}__${index}__`
      const prefixId = (id: NodeId) => `${prefix}${id}`
      const cloneSubtree = (id: NodeId, clonedParentId: NodeId) => {
        const node = nodes[id]
        if (!node) return
        const clonedChildren = Array.isArray(node.nodes)
          ? (node.nodes as NodeId[])
          : undefined
        next[prefixId(id)] = withoutRepeatDirective({
          ...node,
          $id: prefixId(id),
          parentId: clonedParentId,
          props: substituteValue(node.props ?? {}, {
            record,
            model: dataset?.model,
            datasetsByKey,
          }) as any,
          ...(clonedChildren && {
            nodes: clonedChildren.map((childId) => prefixId(childId)),
          }),
        })
        clonedChildren?.forEach((childId) =>
          cloneSubtree(childId, prefixId(id)),
        )
      }
      for (const templateId of templateIds) {
        cloneSubtree(templateId, parentId)
        copyIds.push(prefixId(templateId))
      }
    })
    if (self) {
      const listed = [...(next[parentId].nodes as NodeId[])]
      listed.splice(slot, 1, ...copyIds)
      next[parentId] = { ...next[parentId], nodes: listed }
    } else {
      next[repeatId] = { ...next[repeatId], nodes: copyIds }
    }
  }
  return next
}

export default expandRepeatables
