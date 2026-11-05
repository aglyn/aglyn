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

/*==========================================
 * WHAT A GENERATIVE IMPROVE IT MAY NOT LOSE (AGL-4152).
 *
 * A redesign writes its own copy and plans its own sections, so nothing it
 * answers can be scored line by line against the source. What it must carry
 * is held by code instead, as a ledger read from the source's layout: each
 * thing with a ref a `keep` block places (`form:1`, `picture:3`, `plan:1`),
 * whether it must land exactly once, and every link's destination. The page
 * prompt reads it, the honesty validator holds an answer to it, and the
 * fidelity scores the built page against it. No model reads or writes this.
 *=========================================*/

import type { SiteImportBlock } from '../site-import/site-import-html'
import type { SiteImportLayout, SiteImportLayoutNode, SiteImportLineRef, SiteImportPictureFit } from './ai-site-import'

export type SiteImportLedgerKind = 'picture' | 'form' | 'plan' | 'table' | 'quote' | 'video' | 'contact' | 'stats' | 'logos' | 'gallery' | 'tabs' | 'group'

/** One thing of the source a `keep` block places. */
export interface SiteImportLedgerItem {
  /** `kind:n`, counted within its kind in source order. */
  ref: string
  kind: SiteImportLedgerKind
  /** It must land exactly once: a form, plan, table, quote, video, contact line, or the page's opening picture. */
  must: boolean
  /** The source's section it was read in. */
  section: number
  /** The lines it holds, as blocks of the page. */
  lines: SiteImportLineRef[]
  /** What a `keep` block expands to; a picture on an item of a group has only its line. */
  node?: SiteImportLayoutNode
  /** How the source frames a picture. */
  fit?: SiteImportPictureFit
  /** A group's: the refs of the things it holds (its pictures, a contact line), placed with it when it is kept whole. */
  holds?: string[]
  /** A group's on a long page: shown by its items' titles alone, and kept whole. */
  folded?: true
}

/** A link of the source, each destination once. */
export interface SiteImportLedgerLink {
  ref: string
  line: SiteImportLineRef
  href: string
  text: string
}

/** A line of the source a redesign rewrites freely. */
export interface SiteImportLedgerLine {
  line: SiteImportLineRef
  section: number
  kind: SiteImportBlock['kind']
  text: string
  /** The group of like items it is a line of, by its ref. */
  group?: string
}

export interface SiteImportLedger {
  items: SiteImportLedgerItem[]
  links: SiteImportLedgerLink[]
  lines: SiteImportLedgerLine[]
  /**
   * A long page (AGL-4152): its lines run past `SITE_IMPORT_LEDGER_FOLD_CHARS`,
   * so each of its groups is shown by its titles and kept whole, and an
   * answer writes only what is around them. One answer then fits a page's
   * ceiling however many like items the page has.
   */
  folded: boolean
}

/** The fewest like items a group of the source is a ledger item at (AGL-4152): a `keep` places it whole. */
export const SITE_IMPORT_LEDGER_GROUP_ITEMS = 3

/** The most characters of lines a page's ledger shows in full: past it, the page is long and its groups fold (AGL-4152). */
export const SITE_IMPORT_LEDGER_FOLD_CHARS = 4_500

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

/** A postal address as a page writes one: a house number, a few words and a street word; a PO box; a region and postal code. */
export const SITE_IMPORT_POSTAL_PATTERNS = [
  /\b\d{1,6}\s+(?:[\p{L}\d'.-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|parkway|pkwy|highway|hwy|trail|trl|circle|cir|square|sq|suite|ste)\b/iu,
  /\bp\.?\s?o\.?\s+box\s+\d/iu,
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/u,
] as const

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/

/** Whether a line says how to reach the business: an email, a phone number or a street address. */
export function siteImportLineIsContact(text: string): boolean {
  if (EMAIL.test(text) || SITE_IMPORT_POSTAL_PATTERNS.some((pattern) => pattern.test(text))) return true
  const phone = PHONE.exec(text)?.[0]
  return !!phone && phone.replace(/\D/g, '').length >= 7
}

const GROUP_ITEMS: Readonly<Record<string, SiteImportLedgerKind>> = { pricing: 'plan', quotes: 'quote', stats: 'stats', logos: 'logos' }

/** What must land exactly once, by its kind. */
const MUST: ReadonlySet<SiteImportLedgerKind> = new Set(['form', 'plan', 'table', 'quote', 'video', 'contact'])

/** A source's ledger (AGL-4152), in source order. */
export function siteImportLedger(source: { layout: SiteImportLayout; blocks: readonly SiteImportBlock[] }): SiteImportLedger {
  const { layout, blocks } = source
  const items: SiteImportLedgerItem[] = []
  const lines: SiteImportLedgerLine[] = []
  const seen = new Set<SiteImportLineRef>()
  const counts = new Map<SiteImportLedgerKind, number>()
  let section = 0
  const add = (kind: SiteImportLedgerKind, held: readonly SiteImportLineRef[], extra: Partial<SiteImportLedgerItem> = {}) => {
    const count = (counts.get(kind) ?? 0) + 1
    counts.set(kind, count)
    for (const ref of held) seen.add(ref)
    items.push({ ref: `${kind}:${count}`, kind, must: MUST.has(kind), section, lines: [...held], ...extra })
  }
  const line = (ref: SiteImportLineRef, node?: SiteImportLayoutNode) => {
    if (seen.has(ref)) return
    const block = blocks[ref]
    if (!block) return
    if (block.kind === 'image') {
      add('picture', [ref], node ? { node } : {})
      return
    }
    const text = clean(block.text)
    if (!text || (block.kind === 'link' && block.inline)) return
    seen.add(ref)
    // A paragraph that is only the words of the link after it is that link's label, read twice: the link is its line.
    const next = blocks[ref + 1]
    if (block.kind === 'paragraph' && next?.kind === 'link' && clean(next.text) === text) return
    const contact = (block.kind === 'link' && /^(?:mailto|tel):/i.test(block.href)) || siteImportLineIsContact(text)
    if (block.kind === 'quote') add('quote', [ref], { node: node ?? { kind: 'line', line: ref } })
    else if (contact) add('contact', [ref], { node: node ?? { kind: 'line', line: ref } })
    else lines.push({ line: ref, section, kind: block.kind, text })
  }
  const visit = (nodes: readonly SiteImportLayoutNode[]) => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'line':
          line(node.line, node)
          break
        case 'picture':
          add('picture', [node.line], { node, ...(node.fit ? { fit: node.fit } : {}) })
          break
        case 'video':
          add('video', node.poster === undefined ? [] : [node.poster], { node })
          break
        case 'form':
          add('form', [], { node })
          break
        case 'row':
          for (const cell of node.cells) visit(cell.nodes)
          break
        case 'table':
          add('table', node.rows.flatMap((row) => row.cells.flatMap((cell) => cell.lines)), { node })
          break
        case 'tabs':
          add('tabs', node.tabs.flatMap((tab) => [...(tab.label === null ? [] : [tab.label]), ...siteImportLedgerNodeLines(tab.panel)]), { node })
          break
        case 'group': {
          // A group of photos the reader marked a gallery is one thing, its pictures with it (AGL-4152).
          const whole = node.group === 'logos' && node.gallery ? 'gallery' : GROUP_ITEMS[node.group]
          if (whole) {
            add(whole, node.items.flatMap((item) => item.lines), { node })
            break
          }
          const before = items.length
          const from = lines.length
          for (const item of node.items) for (const ref of item.lines) line(ref)
          // Three or more like items are one thing a `keep` may place whole, with what they hold (AGL-4152).
          if (node.items.length >= SITE_IMPORT_LEDGER_GROUP_ITEMS) {
            const holds = items.slice(before).map((item) => item.ref)
            add('group', node.items.flatMap((item) => item.lines), { node, ...(holds.length ? { holds } : {}) })
            const ref = items[items.length - 1]?.ref as string
            for (const entry of lines.slice(from)) entry.group = ref
          }
          break
        }
        default:
          break
      }
    }
  }
  layout.sections.forEach((entry, index) => {
    section = index
    visit(entry.nodes)
    // A film behind the words is its poster; a line the layout placed nowhere is still a line.
    if (entry.backdrop?.kind === 'video' && entry.backdrop.poster !== undefined) line(entry.backdrop.poster)
    for (const ref of entry.lines) line(ref)
  })
  // The picture the page opens on outranks a new one.
  const opening = items.find((item) => item.kind === 'picture' && item.section === 0)
  if (opening) opening.must = true
  const links: SiteImportLedgerLink[] = []
  const hrefs = new Set<string>()
  blocks.forEach((block, ref) => {
    if (block.kind !== 'link' || /^(?:mailto|tel):/i.test(block.href)) return
    const href = block.href.replace(/#.*$/, '').replace(/\/+$/, '')
    if (!href || hrefs.has(href)) return
    hrefs.add(href)
    links.push({ ref: `link:${links.length + 1}`, line: ref, href: block.href, text: clean(block.text) })
  })
  // A long page folds its groups: each is shown by its titles, and kept whole, as are its tabs, figures and logos:
  // one answer places what the page holds and writes what is around it (AGL-4152).
  const folded = lines.reduce((sum, entry) => sum + entry.text.length, 0) > SITE_IMPORT_LEDGER_FOLD_CHARS
  if (folded) {
    for (const item of items) {
      if (item.kind === 'group') item.folded = true
      if (item.kind !== 'picture') item.must = true
    }
  }
  return { items, links, lines, folded }
}

/** Every line a list of layout nodes holds, rows, groups, tables and tabs opened. */
export function siteImportLedgerNodeLines(nodes: readonly SiteImportLayoutNode[]): SiteImportLineRef[] {
  const out: SiteImportLineRef[] = []
  for (const node of nodes) {
    if (node.kind === 'line' || node.kind === 'picture') out.push(node.line)
    else if (node.kind === 'video' && node.poster !== undefined) out.push(node.poster)
    else if (node.kind === 'row') for (const cell of node.cells) out.push(...siteImportLedgerNodeLines(cell.nodes))
    else if (node.kind === 'group') for (const item of node.items) out.push(...item.lines)
    else if (node.kind === 'table') for (const row of node.rows) for (const cell of row.cells) out.push(...cell.lines)
    else if (node.kind === 'tabs') for (const tab of node.tabs) out.push(...(tab.label === null ? [] : [tab.label]), ...siteImportLedgerNodeLines(tab.panel))
  }
  return out
}
