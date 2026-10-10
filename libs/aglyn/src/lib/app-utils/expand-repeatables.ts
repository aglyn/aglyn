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
  applyRepeatQuery,
  parseRepeatFilter,
  parseRepeatSort,
} from './repeat-query'

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

/**
 * What the expansion reads of the rows' field model (AGL-177, AGL-180): which
 * fields are references, each with the key its target's rows are answered
 * under (`datasetsByKey`). The model itself is the plugin's that keeps the
 * rows, and it states this much of it when it hands the rows over
 * (`plugin-manager/repeat-rows`, `repeat-sources`); a field it does not name
 * here hops nowhere, and its token is left as written.
 */
export interface RepeatRowsModel {
  /** Reference field id → the key of the rows it points into. */
  references?: Readonly<Record<string, string>>
}

export interface RepeatableDataset {
  /**
   * Row value maps, in display order. Rows carry `$id` (needed to resolve
   * incoming references); values may be typed (AGL-177), stringified at
   * substitution.
   */
  records: Array<Record<string, unknown>>
  /** The rows' references; required for reference-hop bindings. */
  model?: RepeatRowsModel
}

interface SubstituteContext {
  record: Record<string, unknown>
  /** The repeated rows' references (AGL-180). */
  model?: RepeatRowsModel
  /** All host datasets keyed by id (and name) for hop resolution. */
  datasetsByKey?: Record<string, RepeatableDataset | undefined>
  /**
   * What a token whose field the record leaves empty becomes: `'token'` keeps
   * it as written (the besigner's canvas, where an author edits the template),
   * `'empty'` prints nothing (a rendered page, AGL-3616). A published page
   * never shows a visitor `{{item.venue}}` because one record has no venue.
   */
  missing?: 'token' | 'empty'
}

const displayValue = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : String(value)

/** Resolves `{{item.ref.field}}`: FKey(s) → target document field value. */
function resolveReferenceHop(
  context: SubstituteContext,
  fieldId: string,
  targetFieldId: string,
): string | null {
  const targetKey = context.model?.references?.[fieldId]
  if (!targetKey) return null
  const target = context.datasetsByKey?.[targetKey]
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
    const unresolved = (token: string) =>
      context.missing === 'empty' ? '' : token
    return value.replace(
      ITEM_TOKEN_PATTERN,
      (token, field: string, hop?: string) => {
        if (hop) {
          const resolved = resolveReferenceHop(context, field, hop)
          return resolved != null ? resolved : unresolved(token)
        }
        return record[field] != null
          ? displayValue(record[field])
          : unresolved(token)
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

/** A text that is nothing but `{{item.*}}` tokens: a binding, not words. */
const WHOLE_BINDING = new RegExp(
  `^\\s*(?:${ITEM_TOKEN_PATTERN.source}\\s*)+$`,
)

/**
 * Whether a copy's element is a binding its record left empty (AGL-3616):
 * its text, `children`, was only `{{item.*}}` tokens and they printed
 * nothing. The copy leaves the element out rather than drawing an empty line
 * (an eyebrow with no venue), and a record that fills the field draws it.
 */
function isEmptyBinding(
  template: Record<string, unknown> | undefined,
  substituted: Record<string, unknown>,
): boolean {
  const text = template?.['children']
  if (typeof text !== 'string' || !WHOLE_BINDING.test(text)) return false
  const printed = substituted['children']
  return typeof printed === 'string' && printed.trim() === ''
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

/**
 * One record's values put into `{{item.field}}` tokens, anywhere in a props
 * map — the substitution {@link expandRepeatables} makes on every copy it
 * builds, for a caller that already knows which record it is rendering.
 *
 * The besigner's canvas is that caller (AGL-3111): the element an author
 * edits IS the first copy, so it draws with the first record's values while
 * the node it saves keeps the tokens. Exported rather than reimplemented
 * because a canvas that resolved a token differently from the page would be
 * showing the author a page that does not exist.
 */
export function substituteRecordTokens<T>(
  props: T,
  context: {
    record: Record<string, unknown>
    /** The repeated rows' references (AGL-180). */
    model?: RepeatRowsModel
    /** Rows by key, for a one-hop reference (AGL-180). */
    datasetsByKey?: Record<string, RepeatableDataset | undefined>
  },
): T {
  return substituteValue(props, context) as T
}

/**
 * The one record a whole page is rendered for (AGL-3475): a record template's
 * routed record, in the shape a repeat hands each of its copies.
 */
export interface PageRecordScope {
  record: Record<string, unknown>
  /** The record's references (AGL-180). */
  model?: RepeatRowsModel
  /** Rows by key, for a one-hop reference (AGL-180). */
  datasetsByKey?: Record<string, RepeatableDataset | undefined>
}

/**
 * Every node's props with the page's record put into its `{{item.field}}`
 * tokens — the substitution a repeat makes on each copy, made once over a
 * page that renders one record (AGL-3475).
 *
 * Run AFTER {@link expandRepeatables}: a repeat inside the page has already
 * spent its own `{{item.*}}` tokens on its own rows by then, so what is left
 * is the page's. A token naming a field the record leaves empty prints
 * nothing, exactly as in a repeat (AGL-3616). Returns the input when there is
 * no record.
 */
export function substituteNodesRecordTokens<N>(
  nodes: Record<NodeId, N>,
  scope: PageRecordScope | null | undefined,
): Record<NodeId, N> {
  if (!scope) return nodes
  const next: Record<NodeId, N> = {}
  for (const [id, node] of Object.entries(nodes) as Array<[NodeId, N]>) {
    const props = (node as { props?: unknown })?.props
    next[id] = props
      ? ({
          ...node,
          props: substituteValue(props, { ...scope, missing: 'empty' }),
        } as N)
      : node
  }
  return next
}

/**
 * The page's record put into each repeat's FILTER, before the repeats expand
 * (AGL-3475): on a record template, `category == {{item.category}}` lists the
 * other records in the routed record's category. Only `repeatFilter` is
 * touched — everything else inside a repeat is its template, whose
 * `{{item.*}}` belongs to its own rows. Returns the input when there is no
 * record or no filter names one.
 */
export function substituteRepeatFilterRecordTokens<N>(
  nodes: Record<NodeId, N>,
  scope: PageRecordScope | null | undefined,
): Record<NodeId, N> {
  if (!scope) return nodes
  let next: Record<NodeId, N> | null = null
  for (const [id, node] of Object.entries(nodes) as Array<[NodeId, N]>) {
    const props = (node as { props?: Record<string, unknown> })?.props
    const filter = props?.['repeatFilter']
    if (typeof filter !== 'string' || !filter.includes('{{')) continue
    next ??= { ...nodes }
    next[id] = {
      ...node,
      props: { ...props, repeatFilter: substituteValue(filter, scope) },
    } as N
  }
  return next ?? nodes
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
  const where = parseRepeatFilter(String(props['repeatFilter'] ?? ''))
  const orderBy = parseRepeatSort(String(props['repeatSort'] ?? ''))
  const limit = Number(props['repeatLimit'])
  return applyRepeatQuery(dataset?.records ?? [], {
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
 * Does this tree contain anything {@link expandRepeatables} would expand —
 * or, with no rows, empty?
 *
 * The rows read is the largest on the render path — up to two pages of
 * {@link REPEAT_MAX_RECORDS} records for every key a page repeats over — and a
 * page that repeats over nothing should pay none of it (AGL-1440).
 *
 * Any gate on that read has to ask EXACTLY the question the expansion asks,
 * which is why this and {@link repeatKeys} share the one predicate
 * `expandRepeatables` looks keys up with, {@link repeatKey}. A gate that is
 * even slightly stricter than the expansion is not a saving: it is a published
 * page whose repeat never reaches the expansion at all, and so goes out as
 * its raw template — `{{item.*}}` tokens and all — where the author put a list.
 */
export function hasRepeatableNodes(
  nodes: Record<NodeId, unknown> | null | undefined,
): boolean {
  if (!nodes) return false
  return Object.values(nodes).some((node) => repeatKey(node) !== '')
}

/**
 * Every key this tree repeats over, exactly as {@link expandRepeatables} looks
 * it up — sorted and without repeats.
 *
 * What the tenant compose asks the repeat-rows contract for
 * (`plugin-manager/repeat-rows.ts`), so a page loads the rows it renders and
 * not everything its site may see. Built on the same predicate as
 * {@link hasRepeatableNodes} for the reason given there.
 */
export function repeatKeys(
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
 * values. A field the record leaves empty prints nothing — never the raw
 * token — and an element whose whole text is such a binding is left out of
 * that copy (AGL-3616: a tour date with no venue drew `{{ITEM.VENUE}}` as its
 * eyebrow on a published site). The besigner's canvas keeps the tokens of
 * the template an author edits ({@link substituteRecordTokens}).
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
 * - No rows renders ZERO copies (AGL-3496): a `children` repeat keeps its
 *   element with an empty child list, a `self` repeat leaves its parent's
 *   list. That covers a filter matching nothing, an empty dataset, and a key
 *   the rows answer nothing under — a deleted or unshared dataset, or no rows
 *   map at all — because the template drawn without a record is its literal
 *   `{{item.*}}` tokens, printed to every visitor. Never a throw: a dataset
 *   going away empties a list, it does not take the page down.
 * - An empty template, or a self-scoped node its parent does not list (the
 *   document root, say), has nothing to copy or nowhere to put copies, and is
 *   left as written.
 * - Inputs are never mutated; templates stay in the map unreferenced.
 *
 * This is the PUBLISHED page's composition. The besigner's canvas keeps the
 * template on screen whatever the rows say — it is what an author edits — and
 * flags a repeat with no rows on its badge instead ({@link repeatedRecords}
 * is the count both read).
 */
export function expandRepeatables<N extends AglynNodeSchema = AglynNodeSchema>(
  nodes: Record<NodeId, N>,
  datasetsByKey: Record<string, RepeatableDataset | undefined> | undefined,
): Record<NodeId, N> {
  const rowsByKey = datasetsByKey ?? {}
  const repeatIds = Object.entries(nodes).filter(
    ([, node]) => repeatKey(node) !== '',
  )
  if (!repeatIds.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [repeatId, repeated] of repeatIds) {
    const dataset = rowsByKey[repeatKey(repeated)]
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
    if (!templateIds.length || (self && slot < 0)) continue
    if (!records.length) {
      // Zero copies (AGL-3496). The template is a design, not content: drawn
      // without a record it prints `{{item.name}}` to every visitor.
      if (self) {
        const listed = [...(next[parentId].nodes as NodeId[])]
        listed.splice(slot, 1)
        next[parentId] = { ...next[parentId], nodes: listed }
      } else {
        next[repeatId] = { ...next[repeatId], nodes: [] }
      }
      continue
    }

    const copyIds: NodeId[] = []
    records.forEach((record, index) => {
      const prefix = `${REPEAT_NODE_ID_PREFIX}${repeatId}__${index}__`
      const prefixId = (id: NodeId) => `${prefix}${id}`
      // Whether the copy drew the node: an element whose whole text is a
      // binding this record leaves empty is left out of it (AGL-3616).
      const cloneSubtree = (id: NodeId, clonedParentId: NodeId): boolean => {
        const node = nodes[id]
        if (!node) return false
        const props = substituteValue(node.props ?? {}, {
          record,
          model: dataset?.model,
          datasetsByKey: rowsByKey,
          missing: 'empty',
        }) as Record<string, unknown>
        if (isEmptyBinding(node.props as Record<string, unknown>, props)) {
          return false
        }
        const clonedChildren = Array.isArray(node.nodes)
          ? (node.nodes as NodeId[])
          : undefined
        const drawn = clonedChildren?.filter((childId) =>
          cloneSubtree(childId, prefixId(id)),
        )
        next[prefixId(id)] = withoutRepeatDirective({
          ...node,
          $id: prefixId(id),
          parentId: clonedParentId,
          props: props as any,
          ...(drawn && {
            nodes: drawn.map((childId) => prefixId(childId)),
          }),
        })
        return true
      }
      for (const templateId of templateIds) {
        if (cloneSubtree(templateId, parentId)) {
          copyIds.push(prefixId(templateId))
        }
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
