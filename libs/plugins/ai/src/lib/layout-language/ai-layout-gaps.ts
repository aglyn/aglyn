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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiBracketedFacts, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { aiStoredScrollTargets } from '../runtime/ai-page-links'

/**
 * No gap on a published page (AGL-3660). A guided start publishes what it
 * builds, so a fact the brief never gave — a phone number, an address, the
 * opening hours — is left out of a page or a frame built in the layout
 * language, never written as the bracketed gap ("[phone number]") a draft a
 * person edits first may carry. An answer holding one is asked again; the
 * last answer a generation takes has each one taken out instead: the line
 * that carries it, the row or card it leaves with nothing to say, and a
 * section left with only its heading.
 */

interface GapNode {
  componentId: string
  props?: Record<string, unknown>
  nodes?: string[]
}

type GapNodes = Record<string, GapNode>

/** Props that hold no words a visitor reads: an icon's drawing is path data. */
const NOT_WORDS = new Set(['iconPath', 'iconId'])

/** The props a node's own words are in. */
const WORD_PROPS = ['children', 'primary', 'secondary', 'label'] as const

/** Elements that say something with no words of their own. */
const SPEAKS_ALONE = new Set([
  'image',
  'form',
  'layoutSlot',
  'reusableInstance',
  'muiDrawerToggle',
  'muiDrawer',
  // The site's own records, listed by the elements that keep them (AGL-3676).
  'product-grid',
  'collectionEntries',
  'cart',
  // A music site's player, placed empty for the owner's tracks (AGL-3716).
  'musicPlayer',
])

const HEADING_VARIANTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'overline'])

/** The violation code a gap is named by. */
export const AI_LAYOUT_GAP_CODE = 'layout-gap'

/** Every string a value holds, however deep, its icon drawings aside. */
function stringsOf(value: unknown, key = ''): string[] {
  if (NOT_WORDS.has(key)) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => stringsOf(entry))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([name, entry]) => stringsOf(entry, name))
  }
  return []
}

/** Each node whose words carry a gap, with the gaps it carries. */
function gapsOf(nodes: GapNodes): Array<{ id: string; facts: string[]; text: string }> {
  return Object.entries(nodes).flatMap(([id, node]) => {
    const texts = stringsOf(node.props ?? {})
    const facts = aiBracketedFacts(texts)
    return facts.length ? [{ id, facts, text: texts.filter((text) => aiBracketedFacts([text]).length).join(' ') }] : []
  })
}

/** The gaps a language-built page or frame carries, as the violation that asks again. */
export function aiLayoutGapViolations(nodes: NodesMap): AiDoctrineViolation[] {
  const found = gapsOf(nodes as unknown as GapNodes)
  if (!found.length) return []
  const facts = aiBracketedFacts(found.flatMap((entry) => entry.facts))
  return [
    {
      rule: 14,
      code: AI_LAYOUT_GAP_CODE,
      message: `${facts.join(', ')} ${facts.length === 1 ? 'is a gap' : 'are gaps'} for a fact the brief does not give, and this site is published exactly as written. Leave each fact out: write the sentence without it, and make no list line, card or contact row for it. Never write a gap in square brackets, and never invent the fact.`,
      nodeIds: found.map((entry) => entry.id),
    },
  ]
}

function parentsOf(nodes: GapNodes): Map<string, string> {
  const parents = new Map<string, string>()
  for (const [id, node] of Object.entries(nodes)) for (const child of node.nodes ?? []) parents.set(child, id)
  return parents
}

function subtree(nodes: GapNodes, id: string): string[] {
  const ids: string[] = []
  const stack = [id]
  while (stack.length) {
    const next = stack.pop() as string
    if (!nodes[next] || ids.includes(next)) continue
    ids.push(next)
    stack.push(...(nodes[next].nodes ?? []))
  }
  return ids
}

function wordsOf(node: GapNode): string {
  for (const prop of WORD_PROPS) {
    const value = node.props?.[prop]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isHeading(node: GapNode): boolean {
  if (node.componentId !== 'muiTypography') return false
  return HEADING_VARIANTS.has(String(node.props?.['variant'] ?? '')) || /^h[1-6]$/.test(String(node.props?.['component'] ?? ''))
}

/** Whether anything under a node says something; with `beyondHeadings`, anything but a heading. */
function speaks(nodes: GapNodes, id: string, beyondHeadings = false): boolean {
  return subtree(nodes, id).some((each) => {
    const node = nodes[each]
    const says = SPEAKS_ALONE.has(node.componentId) || !!wordsOf(node)
    return says && !(beyondHeadings && isHeading(node))
  })
}

/** A node's props, its component's prop values copied too, so a rewrite never reaches the input. */
function copyProps(props: Record<string, unknown>): Record<string, unknown> {
  const values = props['propValues']
  return values && typeof values === 'object' && !Array.isArray(values)
    ? { ...props, propValues: { ...(values as Record<string, unknown>) } }
    : { ...props }
}

function cloneNodes(input: NodesMap): GapNodes {
  return Object.fromEntries(
    Object.entries(input as unknown as GapNodes).map(([id, node]) => [
      id,
      {
        ...node,
        ...(node.props ? { props: copyProps(node.props) } : {}),
        ...(node.nodes ? { nodes: [...node.nodes] } : {}),
      },
    ]),
  )
}

/**
 * Takes each found node out, and each element above it left with nothing to
 * say, up to its section; a section other than the page's first left with
 * only its heading goes too, with any link that scrolled to it.
 */
function pruneFound(nodes: GapNodes, rootId: string, found: ReadonlyArray<{ id: string; text: string }>): string[] {
  const dropped: string[] = []
  const sections = new Set(nodes[rootId]?.nodes ?? [])
  const touched = new Set<string>()
  const remove = (id: string) => {
    const parent = parentsOf(nodes).get(id)
    for (const each of subtree(nodes, id)) delete nodes[each]
    if (parent && nodes[parent]) nodes[parent].nodes = (nodes[parent].nodes ?? []).filter((child) => child !== id)
  }
  /** Takes a node out, and each element above it it leaves with nothing to say, short of a section. */
  const prune = (id: string) => {
    const parents = parentsOf(nodes)
    let section: string | undefined = id
    while (section && !sections.has(section)) section = parents.get(section)
    if (section && section !== id) touched.add(section)
    let parent = parents.get(id)
    remove(id)
    while (parent && parent !== rootId && nodes[parent]) {
      if (sections.has(parent) || speaks(nodes, parent)) break
      const above = parentsOf(nodes).get(parent)
      remove(parent)
      parent = above
    }
  }
  for (const entry of found) {
    if (!nodes[entry.id]) continue
    dropped.push(entry.text)
    prune(entry.id)
  }
  const first = nodes[rootId]?.nodes?.[0]
  for (const section of touched) {
    if (section === first || !nodes[section] || speaks(nodes, section, true)) continue
    const label = String(nodes[section].props?.['ariaLabel'] ?? section)
    remove(section)
    dropped.push(`the section "${label}", left with only its heading`)
    for (const [id, node] of Object.entries(nodes)) {
      if (nodes[id] && aiStoredScrollTargets(node).includes(section)) {
        dropped.push(`"${wordsOf(node)}", a link to that section`)
        prune(id)
      }
    }
  }
  return dropped
}

/** The page or frame with every gap taken out, and what was taken. */
export function aiLayoutWithoutGaps(input: NodesMap, rootId: string): { nodes: NodesMap; dropped: string[] } {
  const found = gapsOf(input as unknown as GapNodes)
  if (!found.length) return { nodes: input, dropped: [] }
  const nodes = cloneNodes(input)
  const dropped = pruneFound(nodes, rootId, found)
  return { nodes: nodes as unknown as NodesMap, dropped }
}

// ── Internal references ─────────────────────────────────────────────────

/**
 * What a link may name, which never belongs in words a visitor reads: the
 * site's pages, with the title a reference to one is written as, and every
 * other id the page or frame was built against (its forms, components and
 * sections).
 */
export interface AiLayoutRefNames {
  pages: ReadonlyArray<{ id: string; label: string }>
  ids: readonly string[]
}

/** The violation code an internal reference in copy is named by. */
export const AI_LAYOUT_REF_CODE = 'layout-internal-ref'

/** A link's own notation, or a template token other than the site's own (`{{host.…}}`). */
const REF = /\b(?:page|new|form|component|screen):[A-Za-z0-9_-]+|\{\{(?!\s*host\.)[^{}]*\}\}/g
const PAGE_REF = /\bpage:([A-Za-z0-9_-]+)/g

/** The props whose words a visitor reads, and a component's prop values. */
const SHOWN_PROPS = [...WORD_PROPS, 'alt', 'title']

function shownTexts(node: GapNode): Array<{ get: () => string; set: (value: string) => void }> {
  const props = node.props ?? {}
  const slots: Array<{ get: () => string; set: (value: string) => void }> = []
  for (const prop of SHOWN_PROPS) {
    if (typeof props[prop] === 'string') slots.push({ get: () => props[prop] as string, set: (value) => (props[prop] = value) })
  }
  const values = props['propValues']
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    const record = values as Record<string, unknown>
    for (const name of Object.keys(record)) {
      if (typeof record[name] === 'string') slots.push({ get: () => record[name] as string, set: (value) => (record[name] = value) })
    }
  }
  return slots
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function refsIn(text: string, names: AiLayoutRefNames): string[] {
  const found = (text.match(REF) ?? []).map((ref) => ref.trim())
  for (const id of names.ids) {
    if (id.length >= 6 && new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(id)}($|[^A-Za-z0-9_-])`).test(text)) found.push(id)
  }
  return [...new Set(found)]
}

/** An entry's own token, which a collection repeater fills per entry when the page renders. */
const ENTRY_TOKEN = /\{\{\s*entry\.[A-Za-z]+\s*\}\}/g

/** Every node under a Collection Entries block: its template, repeated once per entry (AGL-3676). */
function repeatedByEntries(nodes: GapNodes): Set<string> {
  const repeated = new Set<string>()
  for (const [id, node] of Object.entries(nodes)) {
    if (node.componentId !== 'collectionEntries') continue
    for (const each of subtree(nodes, id)) if (each !== id) repeated.add(each)
  }
  return repeated
}

function refsOf(nodes: GapNodes, names: AiLayoutRefNames): Array<{ id: string; refs: string[]; text: string }> {
  // A post's card names its post by the entry's tokens, which the page fills
  // per post: words a visitor reads as the post's own, never a reference.
  const repeated = repeatedByEntries(nodes)
  return Object.entries(nodes).flatMap(([id, node]) => {
    const texts = shownTexts(node).map((slot) => (repeated.has(id) ? slot.get().replace(ENTRY_TOKEN, '') : slot.get()))
    const refs = [...new Set(texts.flatMap((text) => refsIn(text, names)))]
    return refs.length ? [{ id, refs, text: texts.filter((text) => refsIn(text, names).length).join(' ') }] : []
  })
}

/** Internal references in a language-built page's or frame's words, as the violation that asks again. */
export function aiLayoutRefViolations(nodes: NodesMap, names: AiLayoutRefNames): AiDoctrineViolation[] {
  const found = refsOf(nodes as unknown as GapNodes, names)
  if (!found.length) return []
  const refs = [...new Set(found.flatMap((entry) => entry.refs))].map((ref) => `"${ref}"`)
  return [
    {
      rule: 14,
      code: AI_LAYOUT_REF_CODE,
      message: `${refs.join(', ')} ${refs.length === 1 ? 'is a link reference' : 'are link references'} written into words a visitor reads. A reference goes only in a button's or a list item's to; in text, name the page by its title, or leave the reference out.`,
      nodeIds: found.map((entry) => entry.id),
    },
  ]
}

/**
 * The page or frame with no internal reference in its words: a page's
 * reference is written as that page's title, and a line that still names a
 * reference is taken out, as a gap is. Returns what was rewritten and taken.
 */
export function aiLayoutWithoutRefs(
  input: NodesMap,
  rootId: string,
  names: AiLayoutRefNames,
): { nodes: NodesMap; dropped: string[] } {
  if (!refsOf(input as unknown as GapNodes, names).length) return { nodes: input, dropped: [] }
  const nodes = cloneNodes(input)
  const labels = new Map(names.pages.map((page) => [page.id, page.label]))
  const dropped: string[] = []
  for (const node of Object.values(nodes)) {
    for (const slot of shownTexts(node)) {
      const before = slot.get()
      const after = before.replace(PAGE_REF, (ref, id: string) => labels.get(id) ?? ref)
      if (after !== before) {
        slot.set(after)
        dropped.push(`"${before}" written as "${after}"`)
      }
    }
  }
  dropped.push(...pruneFound(nodes, rootId, refsOf(nodes, names)))
  return { nodes: nodes as unknown as NodesMap, dropped }
}

/**
 * A language-built page's or frame's words held to both (AGL-3660): before
 * the last answer, each gap and each internal reference is a violation that
 * asks again; in the last, they are taken out and the rest is kept.
 */
export function aiLayoutCopyCheck(
  input: NodesMap,
  rootId: string,
  names: AiLayoutRefNames,
  last: boolean,
): { nodes: NodesMap; dropped: string[]; violations: AiDoctrineViolation[] } {
  if (!last) {
    return { nodes: input, dropped: [], violations: [...aiLayoutRefViolations(input, names), ...aiLayoutGapViolations(input)] }
  }
  const refs = aiLayoutWithoutRefs(input, rootId, names)
  const gaps = aiLayoutWithoutGaps(refs.nodes, rootId)
  return { nodes: gaps.nodes, dropped: [...refs.dropped, ...gaps.dropped], violations: [] }
}
