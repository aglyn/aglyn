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

import { AI_TYPED_LIST_MIN_ITEMS, type AiDoctrineViolation } from './ai-doctrine-validators'

/**
 * A repeated item written once (AGL-3053).
 *
 * A workspace that keeps no reusable components can place no instance, so a
 * row of cards is drawn card by card. Written out in a model's answer, every
 * card repeats its whole subtree — the Card, its body, its heading and its
 * text, each node's JSON escaped inside the tool call — and four practice
 * areas with real copy run past a section pass's answer ceiling. So on such a
 * workspace an answer writes the item ONCE and lists what differs between its
 * copies, and this module draws the copies before any check reads the answer:
 *
 * ```json
 * "card":  { "componentId": "muiCard", "nodes": ["body"],
 *            "repeat": [["Estate planning", "Wills and trusts…"],
 *                       ["Real estate", "Closings and title…"]] },
 * "title": { "componentId": "muiTypography", "props": { "children": "{{1}}" } },
 * "text":  { "componentId": "muiTypography", "props": { "children": "{{2}}" } }
 * ```
 *
 * `repeat` holds one list of values a copy, and `{{n}}` stands for a copy's
 * n-th value wherever it appears in the item's props or styles.
 *
 *  - **Positional, because it is the smallest list a copy can be.** Each value
 *    costs its quotes and a comma. A named value repeats its name on every
 *    copy, and a list of columns keeps a copy's values apart from each other.
 *  - **Numbered, because no binding token is a number.** A site variable's
 *    `{{name}}` starts with a letter, and a component's `{{prop.name}}`, a
 *    template's `{{entry.field}}` and a function's `{{fn:…}}` carry a dot or a
 *    colon (`binding-tokens.ts`), so copy that binds one keeps its token, and
 *    nothing a placeholder leaves behind can bind.
 *
 * The copies are the item cloned in order, in its place under its parent. The
 * first keeps the ids the model wrote, and copy `n` takes `<id>~<n>` on every
 * node of the subtree, so one answer always draws one tree and every id a copy
 * took leads back to the node the model wrote (`sourceIds`). The drawn tree is
 * what every check reads and what a page stores: nothing downstream sees
 * `repeat` or a placeholder.
 *
 * Refused, each with a sentence a re-ask can act on and the model's own nodes
 * named: `repeat` where the workspace keeps reusable components (rule 1: place
 * a component's instances), on the document wrapper or what it holds
 * directly, or inside another repeated item; a list that is not one list of
 * values a copy; fewer than 2 copies or more than `AI_REPEAT_MAX_COPIES`; a
 * placeholder a copy gives no value for, or one outside every repeated item; a
 * value no placeholder uses; and a copy's id that the answer already gives
 * another node. Pure: no provider and no Firestore.
 */

/** The key a repeated item's node lists its copies' values under. */
export const AI_REPEAT_KEY = 'repeat'

/**
 * The most copies one item may list: a list of `AI_TYPED_LIST_MIN_ITEMS` or
 * more typed into a page is data (rule 8), which a plan binds or shortens.
 */
export const AI_REPEAT_MAX_COPIES = AI_TYPED_LIST_MIN_ITEMS - 1

/** A copy's `n`-th value, by its 1-based position. */
const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g

/** A string that is one placeholder and nothing else, whose value keeps its own type. */
const WHOLE_PLACEHOLDER = /^\s*\{\{\s*(\d+)\s*\}\}\s*$/

/** What a list of copies looks like, in every sentence that asks for one. */
const EXAMPLE = '[["Title 1", "Text 1"], ["Title 2", "Text 2"]]'

export interface AiRepeatedItemsOptions {
  /** The workspace keeps no reusable components: the one place an item is written once. */
  inline: boolean
  /** What the answer is, as a person reads a refusal: `section`, `page`. */
  noun: string
}

export type AiRepeatedItemsResult =
  | {
      ok: true
      /** The answer with every repeated item drawn into its copies; the answer itself when none is. */
      tree: unknown
      /** Each id a copy took → the id the model wrote for that node. */
      sourceIds: Record<string, string>
      /** How many items were written once. */
      items: number
    }
  | { ok: false; violations: AiDoctrineViolation[] }

type RawNode = Record<string, unknown>
type Scalar = string | number | boolean

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  )
}

function childIds(node: RawNode | undefined): string[] {
  const children = node?.['nodes']
  return Array.isArray(children) ? children.filter((id): id is string => typeof id === 'string') : []
}

/** Every placeholder position a value uses, however deep in props or styles. */
function positionsIn(value: unknown, into: Set<number>): Set<number> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(PLACEHOLDER)) into.add(Number(match[1]))
  } else if (Array.isArray(value)) {
    for (const inner of value) positionsIn(inner, into)
  } else if (isRecord(value)) {
    for (const inner of Object.values(value)) positionsIn(inner, into)
  }
  return into
}

/** The positions one node's props and styles use. */
function nodePositions(node: RawNode): Set<number> {
  return positionsIn(node['sx'], positionsIn(node['props'], new Set()))
}

/** A value with every placeholder filled from one copy's values. */
function fill(value: unknown, values: readonly Scalar[]): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(value)
    if (whole) return values[Number(whole[1]) - 1]
    return value.replace(PLACEHOLDER, (_token, position: string) => String(values[Number(position) - 1]))
  }
  if (Array.isArray(value)) return value.map((inner) => fill(inner, values))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner, values)]))
  }
  return value
}

/** 1 → first, 2 → second, 12 → 12th. */
function ordinal(position: number): string {
  const word = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'][position - 1]
  if (word) return word
  const tens = position % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][position % 10] ?? 'th')
  return `${position}${suffix}`
}

/** `{{1}}`, `{{1}} and {{2}}`, `{{1}}, {{2}} and {{3}}`. */
function placeholders(positions: Iterable<number>): string {
  const list = [...positions].sort((a, b) => a - b).map((position) => `{{${position}}}`)
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/**
 * The answer with every repeated item drawn into its copies, or the reasons it
 * cannot be. An answer that is not a node map, or that writes nothing once, is
 * handed back as it came, for the palette validator to read as it always has.
 */
export function expandAiRepeatedItems(input: unknown, options: AiRepeatedItemsOptions): AiRepeatedItemsResult {
  const unchanged: AiRepeatedItemsResult = { ok: true, tree: input, sourceIds: {}, items: 0 }
  if (!isRecord(input) || typeof input['rootId'] !== 'string' || !isRecord(input['nodes'])) return unchanged
  const rootId = input['rootId']
  const nodes = input['nodes'] as Record<string, unknown>
  const nodeOf = (id: string): RawNode | undefined => {
    const node = nodes[id]
    return isRecord(node) ? node : undefined
  }

  // The walk the palette validator makes: breadth first from the root, each
  // node under the first parent that lists it.
  const parentOf = new Map<string, string | null>([[rootId, null]])
  const order: string[] = []
  const queue = [rootId]
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    if (!nodeOf(id)) continue
    order.push(id)
    for (const child of childIds(nodeOf(id))) {
      if (parentOf.has(child)) continue
      parentOf.set(child, id)
      queue.push(child)
    }
  }
  const marked = order.filter((id) => Object.prototype.hasOwnProperty.call(nodeOf(id), AI_REPEAT_KEY))

  if (!options.inline) {
    return marked.length
      ? {
          ok: false,
          violations: [
            {
              rule: 1,
              code: 'repeat-not-inline',
              message: 'This draws a repeated item to be copied, instead of placing it as instances of a component.',
              detail: `Remove "${AI_REPEAT_KEY}", and place each copy as an instance of a component the site has (componentId "reusableInstance").`,
              nodeIds: marked,
            },
          ],
        }
      : unchanged
  }

  /** A node and everything under it, each node once. */
  const subtreeOf = (id: string): string[] => {
    const seen = new Set<string>()
    const stack = [id]
    const out: string[] = []
    while (stack.length) {
      const next = stack.pop() as string
      if (seen.has(next) || !nodeOf(next)) continue
      seen.add(next)
      out.push(next)
      stack.push(...childIds(nodeOf(next)).reverse())
    }
    return out
  }
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = []
    for (let parent = parentOf.get(id); parent; parent = parentOf.get(parent)) out.push(parent)
    return out
  }

  const violations: AiDoctrineViolation[] = []
  const refuse = (code: string, detail: string, nodeIds: string[]) => {
    violations.push({
      rule: null,
      code,
      message: `The answer could not be used as a ${options.noun}.`,
      detail,
      nodeIds: [...new Set(nodeIds)],
    })
  }
  const inItem = new Set(marked.flatMap(subtreeOf))
  const topLevel = new Set([rootId, ...childIds(nodeOf(rootId))])
  const taken = new Set(Object.keys(nodes))
  const items: Array<{ id: string; parent: string; subtree: string[]; copies: Scalar[][] }> = []

  for (const id of marked) {
    const outer = ancestorsOf(id).find((ancestor) => marked.includes(ancestor))
    if (outer) {
      refuse(
        'repeat-nested',
        `"${id}" has "${AI_REPEAT_KEY}" inside "${outer}", which repeats already: keep "${AI_REPEAT_KEY}" on "${outer}" alone, and write what repeats inside it out in full.`,
        [id, outer],
      )
      continue
    }
    if (topLevel.has(id)) {
      refuse(
        'repeat-on-section',
        `"${id}" is the document wrapper or what it holds directly, and never repeats: put "${AI_REPEAT_KEY}" on the item that repeats inside the ${options.noun}.`,
        [id],
      )
      continue
    }
    const list = nodeOf(id)?.[AI_REPEAT_KEY]
    if (!Array.isArray(list)) {
      refuse(
        'repeat-shape',
        `"${AI_REPEAT_KEY}" on "${id}" is not a list of copies: give it one list of values for each copy, such as ${EXAMPLE}.`,
        [id],
      )
      continue
    }
    // A copy of one value may be the value itself.
    const listed = list.map((copy: unknown) => (isScalar(copy) ? [copy] : copy))
    const malformed = listed.findIndex((copy) => !Array.isArray(copy) || !copy.every(isScalar))
    if (malformed !== -1) {
      refuse(
        'repeat-shape',
        `The ${ordinal(malformed + 1)} copy of "${id}" is not a list of text values: give each copy one list, such as ${EXAMPLE}.`,
        [id],
      )
      continue
    }
    const copies = listed as Scalar[][]
    if (copies.length < 2 || copies.length > AI_REPEAT_MAX_COPIES) {
      refuse(
        'repeat-count',
        `"${AI_REPEAT_KEY}" on "${id}" lists ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'}: list from 2 to ${AI_REPEAT_MAX_COPIES}, and write an item that appears once without "${AI_REPEAT_KEY}".`,
        [id],
      )
      continue
    }
    const subtree = subtreeOf(id)
    const users = new Map<number, string[]>()
    for (const node of subtree) {
      for (const position of nodePositions(nodeOf(node) as RawNode)) {
        users.set(position, [...(users.get(position) ?? []), node])
      }
    }
    const used = [...users.keys()].sort((a, b) => a - b)
    const highest = used.length ? used[used.length - 1] : 0
    if (users.has(0)) {
      refuse(
        'repeat-placeholder-without-value',
        `"${(users.get(0) as string[])[0]}" uses {{0}}, and a copy's values count from {{1}}: write {{1}} for each copy's first value.`,
        [id, ...(users.get(0) as string[])],
      )
      continue
    }
    const gap = used.findIndex((position, index) => position !== index + 1) + 1
    if (gap > 0) {
      refuse(
        'repeat-value-without-placeholder',
        `"${id}" uses ${placeholders(used)} and no {{${gap}}}, so each copy's ${ordinal(gap)} value fills nothing: number the placeholders from {{1}} with no gap.`,
        [id],
      )
      continue
    }
    const short = copies.findIndex((copy) => copy.length < highest)
    if (short !== -1) {
      const unfilled = used.filter((position) => position > copies[short].length)
      refuse(
        'repeat-placeholder-without-value',
        `The ${ordinal(short + 1)} copy of "${id}" gives ${copies[short].length} ${copies[short].length === 1 ? 'value' : 'values'}, and the item uses ${placeholders(used)}: give every copy one value for each placeholder, in order.`,
        [id, ...unfilled.flatMap((position) => users.get(position) ?? [])],
      )
      continue
    }
    const long = copies.findIndex((copy) => copy.length > highest)
    if (long !== -1) {
      refuse(
        'repeat-value-without-placeholder',
        highest
          ? `The ${ordinal(long + 1)} copy of "${id}" gives ${copies[long].length} values, and the item uses only ${placeholders(used)}: give every copy one value for each placeholder, in order.`
          : `"${id}" lists values and uses no placeholder for them: write {{1}}, {{2}} and on where its copies differ, each copy's values in that order.`,
        [id],
      )
      continue
    }
    const collision = subtree
      .flatMap((node) => copies.slice(1).map((_values, index) => ({ node, copy: index + 2 })))
      .find(({ node, copy }) => taken.has(`${node}~${copy}`))
    if (collision) {
      const clash = `${collision.node}~${collision.copy}`
      refuse(
        'repeat-id-collision',
        `The ${ordinal(collision.copy)} copy of "${collision.node}" takes the id "${clash}", which the answer already gives another node: rename "${clash}".`,
        [id, clash],
      )
      continue
    }
    for (const node of subtree) copies.slice(1).forEach((_values, index) => taken.add(`${node}~${index + 2}`))
    items.push({ id, parent: parentOf.get(id) as string, subtree, copies })
  }

  // A placeholder in no repeated item has no copy to take a value from.
  for (const id of order) {
    if (inItem.has(id)) continue
    const positions = nodePositions(nodeOf(id) as RawNode)
    if (!positions.size) continue
    refuse(
      'repeat-placeholder-without-value',
      `"${id}" uses ${placeholders(positions)} and sits in no item with "${AI_REPEAT_KEY}": write its text out, or put "${AI_REPEAT_KEY}" on the item it repeats in.`,
      [id],
    )
  }

  if (violations.length) return { ok: false, violations }
  if (!items.length) return unchanged

  const drawn: Record<string, unknown> = { ...nodes }
  const sourceIds: Record<string, string> = {}
  for (const item of items) {
    const members = new Set(item.subtree)
    const idIn = (node: string, copy: number) => (copy === 1 || !members.has(node) ? node : `${node}~${copy}`)
    item.copies.forEach((values, index) => {
      const copy = index + 1
      for (const node of item.subtree) {
        const source = nodeOf(node) as RawNode
        const clone: RawNode = { ...source }
        delete clone[AI_REPEAT_KEY]
        if (source['props'] !== undefined) clone['props'] = fill(source['props'], values)
        if (source['sx'] !== undefined) clone['sx'] = fill(source['sx'], values)
        if (Array.isArray(source['nodes'])) {
          clone['nodes'] = source['nodes'].map((child: unknown) => (typeof child === 'string' ? idIn(child, copy) : child))
        }
        if (node !== item.id && typeof source['parentId'] === 'string') clone['parentId'] = idIn(source['parentId'], copy)
        const id = idIn(node, copy)
        drawn[id] = clone
        if (copy > 1) sourceIds[id] = node
      }
    })
    // Every copy in the item's place, in order: the parent as drawn so far,
    // which an item beside this one may already have drawn into.
    const parent = drawn[item.parent] as RawNode
    const siblings = Array.isArray(parent['nodes']) ? [...parent['nodes']] : []
    siblings.splice(siblings.indexOf(item.id), 1, ...item.copies.map((_values, index) => idIn(item.id, index + 1)))
    drawn[item.parent] = { ...parent, nodes: siblings }
  }
  return { ok: true, tree: { ...input, nodes: drawn }, sourceIds, items: items.length }
}
