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
 * A PAGE BROUGHT IN, ITS WORDING IMPROVED (AGL-4152).
 *
 * Under Improve it with Also improve my wording on, a main page Aglyn AI
 * arranges is asked one more answer after its design: `submit_wording`, the
 * lines it rewords, each by its index in the page's blocks with its new
 * words. Nothing else rides the tool — no link, no picture, no structure —
 * so the page's sections, groups, buttons and destinations are the source's
 * whatever it says.
 *
 * - **What may be reworded** (`aiSiteImportWordingPage`): headings,
 *   paragraphs, list items and a link the source draws as a button, the
 *   words of FAQ, card, step and list items among them. Everything else is
 *   kept as written: quotes and testimonials, pricing, stats and logos,
 *   card titles, figures, badges, tables, tabs, eyebrows and fine print, a
 *   paragraph with a link inside it, a postal address, an email or phone
 *   link, and every line with no words.
 * - **What every rewrite holds** (`aiSiteImportWordingHolds`, pure): its
 *   facts — prices, numbers, dates, times, percentages, emails, web
 *   addresses, phones and names, the site's own name among them — exactly as
 *   often as its line says them and none of its own; no contact the page
 *   does not give; no gap; its line's script; 0.5 to 1.6 times its words,
 *   within the characters its place holds; most of its meaning
 *   (`SITE_IMPORT_MEANING_FLOOR`); and no filler, placeholder or judgment
 *   word. A line refused is asked again once; refused again, it is kept as
 *   written.
 * - **The page** (`aiSiteImportRewordedDocument`): the source's document
 *   with the rewritten lines' words swapped in, every block at its index and
 *   the source's own layout pinned, which the page step compiles and checks
 *   whole as any page brought in, rule 14's copy checks on for the reworded
 *   lines (`AiDoctrineTreeContext.rewritten`).
 *
 * Never asked of a page copied as it is, of a policy page, of the header and
 * footer, of the page's listing or of its title in the Pages list.
 *=========================================*/

import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from '@aglyn/shared-util-tools/untrusted-text'
import { aiLayoutGuardContacts } from '../layout-language/ai-layout-copy'
import type { SiteImportLayoutNode, SiteImportLineRef } from '../model/ai-site-import'
import { SITE_IMPORT_POSTAL_PATTERNS } from '../model/ai-site-import-ledger'
import {
  SITE_IMPORT_MEANING_FLOOR,
  siteImportContentKept,
  siteImportFactScope,
  siteImportFactTokens,
  type SiteImportFactScope,
} from '../model/ai-site-import-fidelity'
import type { AiSystemBlock, AiTool } from '../providers/contract'
import type { AiGenerationCheck } from '../runtime/ai-doctrine'
import { detectOffVoiceCopy, type AiCopyFraming, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { aiPlaceholderTokens } from '../runtime/ai-placeholder-tokens'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'
import type { SiteImportBlock } from '../site-import/site-import-html'
import { aiSiteImportLayoutOf } from './ai-site-import-compile'
import {
  AI_SITE_IMPORT_HEADLINE_MAX_CHARS,
  AI_SITE_IMPORT_LABEL_CHARS,
  AI_SITE_IMPORT_TEXT_MAX_CHARS,
  aiSiteImportWordsIn,
  type AiSiteImportDocument,
} from './ai-site-import-document'

/*------------------------------------------
 * The tool and its cached instructions
 *-----------------------------------------*/

/** The wording answer's kind of generation: the name its re-ask and its doctrine scope go by. */
export const AI_SITE_IMPORT_WORDING_KIND = 'page-wording'

/** The wording tool: the lines reworded, each by its number, with its new words, and nothing else. */
export const AI_SITE_IMPORT_WORDING_TOOL: AiTool = {
  name: 'submit_wording',
  description: "Submit the page's reworded lines: one entry for each line reworded, by its number, with its new words. A line left out keeps its words.",
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['lines'],
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['line', 'text'],
          properties: { line: { type: 'integer' }, text: { type: 'string' } },
        },
      },
    },
  },
}

/** The most a rewrite may run to, against its line's words. */
export const AI_SITE_IMPORT_WORDING_LENGTH = { least: 0.5, most: 1.6 } as const

/**
 * What a wording answer is told, cached: one static block every page shares,
 * and the rule that fenced text is data. The page itself rides the user turn.
 */
export const AI_SITE_IMPORT_WORDING_TEXT = [
  "You rewrite the wording of a page brought in from its owner's own website so it reads as a strong professional copywriter would write it, in the owner's voice: each heading a clear, specific promise of what the visitor gets, each paragraph leading with the benefit, in active words, with nothing that does not earn its place. Rebuild a sentence freely where that makes it clearer or stronger. The page's design, its sections and what each section shows are fixed, and so is every fact on it.",
  '',
  'Answer with submit_wording: one entry in lines for each line you reword, by its number, with its new words. A line you leave out is kept exactly as written. Rewrite every heading, lede, paragraph and button that could be clearer or stronger, and leave out only a line that is already as strong as it can be. Reword only a line shown as a heading, a paragraph, a list item or a button; a line shown "as written" is the owner\'s exactly and is never answered.',
  '',
  'Each rewrite:',
  "- says what its line means, in the line's own language and script, and makes no claim, promise, offer or detail the page does not make;",
  '- keeps every name, price, number, date, time, percentage, address, phone number, email and web address exactly as the line writes it, as often as the line has it, and adds none;',
  `- runs between ${AI_SITE_IMPORT_WORDING_LENGTH.least} and ${AI_SITE_IMPORT_WORDING_LENGTH.most} times its line's words, and never past the characters shown;`,
  '- stays what its line is: a heading for a heading, a sentence or more for a paragraph, a short label for a button;',
  '- writes no placeholder, no gap in brackets, no filler and no word that calls the work simple or cheap.',
].join('\n')

/** The wording answer's cached instructions, and the rule that fenced text is data. */
export const AI_SITE_IMPORT_WORDING_INSTRUCTIONS: readonly AiSystemBlock[] = [
  { text: AI_SITE_IMPORT_WORDING_TEXT, cacheBreakpoint: true },
  { text: UNTRUSTED_TEXT_RULE },
]

/*------------------------------------------
 * The page's lines: those it may reword, and those kept as written
 *-----------------------------------------*/

/** What a line is, as the prompt names it and its place holds it. */
export type AiSiteImportWordingKind = 'heading' | 'paragraph' | 'list item' | 'button'

/** A line a rewrite may reword. */
export interface AiSiteImportWordingLine {
  /** Its index in the page's blocks: the number the tool answers by. */
  line: SiteImportLineRef
  kind: AiSiteImportWordingKind
  /** Its words as written. */
  text: string
  /** The most characters a rewrite of it holds. */
  limit: number
  /** Its section, by index. */
  section: number
}

/** One entry of the page as the prompt shows it: a line to reword, one kept as written, or a part with no lines of the tool. */
export interface AiSiteImportWordingEntry {
  section: number
  /** The line's number, absent for a part shown whole (a table). */
  line?: SiteImportLineRef
  /** What it is: "heading", "quote", "a table of 4 rows". */
  what: string
  text: string
  /** Set where a rewrite may reword it. */
  reword?: AiSiteImportWordingLine
}

/** A page as the wording answer is shown it. */
export interface AiSiteImportWordingPage {
  /** The page's sections' names, in order. */
  sections: string[]
  /** Every entry, in order, as far as the prompt's room goes. */
  entries: AiSiteImportWordingEntry[]
  /** The lines a rewrite may reword: those shown. */
  lines: AiSiteImportWordingLine[]
  /** Whether the page runs past what the prompt shows: the rest keeps its words. */
  cut: boolean
}

/** The most characters of a page the wording prompt shows, inside the fence's cap with room for its section heads. */
export const AI_SITE_IMPORT_WORDING_MAX_CHARS = 12_000
const SHOWN_MAX_CHARS = AI_SITE_IMPORT_WORDING_MAX_CHARS - 1_000

/** The most characters of a line kept as written the prompt shows: it is there to be read around, never answered. */
const KEPT_SHOWN_CHARS = 160

/** Groups whose every line is the owner's exactly: quotes, prices, figures, names. */
const FIXED_GROUPS = new Set(['quotes', 'pricing', 'stats', 'logos'])

/** Groups whose items' titles are names: a card's title is a product's or a service's. */
const NAMED_GROUPS = new Set(['cards', 'pricing'])

const POSTAL = SITE_IMPORT_POSTAL_PATTERNS

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

/** Whether a block is a line of the page: a link inside a sentence is in its sentence. */
function isLine(block: SiteImportBlock | undefined): boolean {
  if (!block) return false
  if (block.kind === 'image') return !!block.url
  if (block.kind === 'link') return !block.inline && !!clean(block.text)
  return !!clean(block.text)
}

/** The most characters a rewrite of a line holds: its place's, or the line's own where it already runs past it. */
function limitOf(kind: AiSiteImportWordingKind, text: string, title: boolean): number {
  const place =
    kind === 'heading'
      ? AI_SITE_IMPORT_HEADLINE_MAX_CHARS
      : kind === 'button'
        ? AI_SITE_IMPORT_LABEL_CHARS
        : title
          ? AI_TEXT_LIMITS.label
          : AI_SITE_IMPORT_TEXT_MAX_CHARS
  return text.length > place ? text.length : place
}

/** Tokens a line's words come to, as the ceiling plans them: four characters a token, and the entry around it. */
const tokensOf = (line: AiSiteImportWordingLine) => Math.ceil(line.text.length / 4) + 12

/** Room for the thinking a wording answer does before it writes, inside its ceiling. */
export const AI_SITE_IMPORT_WORDING_THINKING_TOKENS = 1_000

/** How much of a page the wording answer is shown. */
export interface AiSiteImportWordingRoom {
  /** The most characters of the page the prompt shows. */
  maxChars?: number
  /** The ceiling the answer is asked at: the lines offered are those a rewrite of every one fits in (`aiSiteImportWordingTokens`). */
  maxTokens?: number
}

/**
 * The page as the wording answer is shown it (G1, G2): its sections and,
 * in each, its lines in order, each marked as a line a rewrite may reword
 * or one kept as written. A line is reworded only where every place the
 * layout puts it allows it. The lines shown stop where the prompt's room,
 * or the answer's ceiling, does; those past it keep their words.
 */
export function aiSiteImportWordingPage(doc: Pick<AiSiteImportDocument, 'blocks' | 'title' | 'layout'>, room: AiSiteImportWordingRoom = {}): AiSiteImportWordingPage {
  const maxChars = room.maxChars ?? SHOWN_MAX_CHARS
  const maxTokens = room.maxTokens ?? Number.POSITIVE_INFINITY
  const layout = aiSiteImportLayoutOf(doc)
  const fixed = new Set<SiteImportLineRef>()
  const order: Array<{ section: number; ref?: SiteImportLineRef; what?: string; reword?: { kind: AiSiteImportWordingKind; title: boolean } }> = []
  const seen = new Set<SiteImportLineRef>()

  const kept = (section: number, ref: SiteImportLineRef | undefined) => {
    if (ref === undefined || !isLine(doc.blocks[ref]) || doc.blocks[ref]?.kind === 'image') return
    fixed.add(ref)
    if (!seen.has(ref)) {
      seen.add(ref)
      order.push({ section, ref })
    }
  }
  // A line placed where a rewrite may reach it, unless what it says keeps it as written.
  const offer = (section: number, ref: SiteImportLineRef | undefined, place: { button?: boolean; role?: string; title?: boolean } = {}) => {
    if (ref === undefined) return
    const block = doc.blocks[ref]
    if (!block || !isLine(block) || block.kind === 'image') return
    const kind = rewordable(ref, block, place)
    if (!kind) return kept(section, ref)
    if (!seen.has(ref)) {
      seen.add(ref)
      order.push({ section, ref, reword: { kind, title: !!place.title } })
    }
  }
  const rewordable = (ref: SiteImportLineRef, block: SiteImportBlock, place: { button?: boolean; role?: string }): AiSiteImportWordingKind | null => {
    if (block.kind === 'image' || block.kind === 'quote') return null
    const text = clean(block.text)
    if (!aiSiteImportWordsIn(text) || !/\p{L}/u.test(text)) return null
    if (POSTAL.some((pattern) => pattern.test(text))) return null
    // A label the source sets apart, or its fine print, is the owner's as written.
    if (place.role === 'eyebrow' || place.role === 'note') return null
    if (block.kind === 'link') {
      if (!place.button || /^(?:mailto|tel|sms):/i.test(block.href)) return null
      return 'button'
    }
    // A sentence with a link inside it keeps its words, so the link's words are still in it.
    const next = doc.blocks[ref + 1]
    if (next?.kind === 'link' && next.inline) return null
    if (block.kind === 'heading') return 'heading'
    if (block.kind === 'list-item') return 'list item'
    return 'paragraph'
  }

  const walk = (nodes: readonly SiteImportLayoutNode[], section: number, whole: boolean): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'line':
          if (whole) kept(section, node.line)
          else offer(section, node.line, { button: !!node.button, ...(node.role ? { role: node.role } : {}) })
          break
        case 'row':
          for (const cell of node.cells) walk(cell.nodes, section, whole)
          break
        case 'group': {
          const all = whole || FIXED_GROUPS.has(node.group)
          for (const item of node.items) {
            const ctas = new Set((item.ctas ?? []).map((cta) => cta.line))
            const named = new Set<SiteImportLineRef>()
            const place = (ref: SiteImportLineRef | undefined, how: { button?: boolean; title?: boolean } = {}) => {
              if (ref === undefined) return
              named.add(ref)
              if (all) kept(section, ref)
              else offer(section, ref, how)
            }
            // A card's title names its product or service; a figure, a badge and a period are facts.
            if (NAMED_GROUPS.has(node.group)) {
              if (item.title !== undefined) named.add(item.title)
              kept(section, item.title)
            } else place(item.title, { title: true })
            for (const ref of [item.figure, item.badge, item.period]) {
              if (ref === undefined) continue
              named.add(ref)
              kept(section, ref)
            }
            for (const ref of item.text ?? []) place(ref)
            for (const ref of item.list ?? []) place(ref)
            for (const ref of item.link ?? []) {
              if (ctas.has(ref)) place(ref, { button: true })
              else {
                named.add(ref)
                kept(section, ref)
              }
            }
            for (const ref of item.lines) if (!named.has(ref) && ref !== item.image) kept(section, ref)
          }
          break
        }
        case 'table': {
          for (const row of node.rows) {
            for (const cell of row.cells) {
              for (const ref of cell.lines) {
                fixed.add(ref)
                seen.add(ref)
              }
            }
          }
          order.push({ section, what: `a table of ${node.rows.length} ${node.rows.length === 1 ? 'row' : 'rows'}` })
          break
        }
        case 'tabs':
          for (const tab of node.tabs) {
            kept(section, tab.label ?? undefined)
            walk(tab.panel, section, true)
          }
          break
        default:
          break
      }
    }
  }
  layout.sections.forEach((section, index) => {
    walk(section.nodes, index, false)
    // A line of the section no part of its layout places keeps its words.
    for (const ref of section.lines) if (!seen.has(ref)) kept(index, ref)
  })

  const all: AiSiteImportWordingEntry[] = order.map((entry) => {
    if (entry.ref === undefined) return { section: entry.section, what: `${entry.what ?? 'a part'}, as written`, text: '' }
    const block = doc.blocks[entry.ref] as SiteImportBlock
    const text = block.kind === 'image' ? '' : clean(block.text)
    const reword = entry.reword && !fixed.has(entry.ref) ? entry.reword : null
    if (!reword) {
      return { section: entry.section, line: entry.ref, what: block.kind === 'quote' ? 'quote, as written' : 'as written', text: text.length > KEPT_SHOWN_CHARS ? `${text.slice(0, KEPT_SHOWN_CHARS).trimEnd()} …` : text }
    }
    const line: AiSiteImportWordingLine = { line: entry.ref, kind: reword.kind, text, limit: limitOf(reword.kind, text, reword.title), section: entry.section }
    // A paragraph's own ceiling is far past what 1.6 times its words reach: only a tighter place's is shown.
    const bound = line.limit < AI_SITE_IMPORT_TEXT_MAX_CHARS
    return { section: entry.section, line: entry.ref, what: bound ? `${line.kind}, up to ${line.limit} characters` : line.kind, text, reword: line }
  })
  const entries: AiSiteImportWordingEntry[] = []
  const lines: AiSiteImportWordingLine[] = []
  let chars = 0
  let tokens = 0
  let cut = false
  for (const entry of shortened(all)) {
    chars += entry.what.length + entry.text.length + 12
    if (entry.reword) tokens += tokensOf(entry.reword)
    if (chars > maxChars || 2 * tokens + AI_SITE_IMPORT_WORDING_THINKING_TOKENS > maxTokens) {
      cut = true
      break
    }
    entries.push(entry)
    if (entry.reword) lines.push(entry.reword)
  }
  return { sections: layout.sections.map((section) => section.name), entries, lines, cut }
}

/** The most lines kept as written the prompt shows in a row: a run longer than this shows its first two, and how many follow. */
const KEPT_RUN = 3

/**
 * The page's entries with each long run of lines kept as written told in a
 * few: a plan's prices or a table's cells are there to be read around, and
 * a run of them would crowd out the lines that are the answer's to reword.
 */
function shortened(entries: readonly AiSiteImportWordingEntry[]): AiSiteImportWordingEntry[] {
  const out: AiSiteImportWordingEntry[] = []
  for (let at = 0; at < entries.length; ) {
    const first = entries[at] as AiSiteImportWordingEntry
    if (first.reword) {
      out.push(first)
      at += 1
      continue
    }
    let end = at
    while (end < entries.length && !entries[end]?.reword && entries[end]?.section === first.section) end += 1
    const run = entries.slice(at, end)
    if (run.length > KEPT_RUN) {
      out.push(...run.slice(0, 2), { section: first.section, what: `${run.length - 2} more lines, as written`, text: '' })
    } else out.push(...run)
    at = end
  }
  return out
}

/*------------------------------------------
 * The prompt
 *-----------------------------------------*/

/** The page's lines as the fence holds them: each section's name, then its lines, numbered. */
export function aiSiteImportWordingText(page: AiSiteImportWordingPage): string {
  const out: string[] = []
  let section = -1
  for (const entry of page.entries) {
    if (entry.section !== section) {
      section = entry.section
      out.push(`Section ${section + 1} "${page.sections[section] ?? ''}":`)
    }
    out.push(entry.line === undefined ? `- ${entry.what}` : `[${entry.line}] ${entry.what}: ${entry.text}`)
  }
  if (page.cut) out.push('(The page goes on past here; the rest keeps its words.)')
  return out.join('\n')
}

/** A wording answer's user turn: the page, the site's own name, and its lines, fenced as the owner's data. */
export function aiSiteImportWordingPrompt(input: {
  screen: { title: string; slug: string }
  doc: Pick<AiSiteImportDocument, 'url'>
  page: AiSiteImportWordingPage
  siteName?: string | null
}): string {
  const name = clean(input.siteName)
  const count = input.page.lines.length
  return [
    `Page: "${input.screen.title}" at ${input.screen.slug}`,
    ...(name ? ["The site's own name, which every rewrite writes exactly as it is wherever its line says it:", fenceUntrustedText("The site's name", name, { maxChars: 200 })] : []),
    `Its lines, in order, ${count === 1 ? 'one of them' : `${count} of them`} yours to reword, each with its number and what it is, and the most characters a rewrite may hold where its place holds fewer than a paragraph:`,
    fenceUntrustedText(`The words of the owner's page ${input.doc.url}`, aiSiteImportWordingText(input.page), { maxChars: AI_SITE_IMPORT_WORDING_MAX_CHARS }),
  ].join('\n')
}

/**
 * The ceiling a page's wording answer wants (G1): twice its lines' own
 * tokens, so a rewrite of every line fits with room, and its thinking.
 * The page step holds it to the time the design answer leaves.
 */
export function aiSiteImportWordingTokens(page: AiSiteImportWordingPage): number {
  return 2 * page.lines.reduce((sum, line) => sum + tokensOf(line), 0) + AI_SITE_IMPORT_WORDING_THINKING_TOKENS
}

/*------------------------------------------
 * The answer, and what every rewrite holds
 *-----------------------------------------*/

/** One line as an answer rewords it. */
export interface AiSiteImportRewrite {
  line: number
  text: string
}

/** An answer's lines, read defensively: each with a whole number and words; `null` where it has no list of lines. */
export function aiReadWordingAnswer(answer: Record<string, unknown> | null | undefined): AiSiteImportRewrite[] | null {
  const lines = answer?.['lines']
  if (!Array.isArray(lines)) return null
  return lines.flatMap((entry): AiSiteImportRewrite[] => {
    if (!entry || typeof entry !== 'object') return []
    const { line, text } = entry as Record<string, unknown>
    return typeof line === 'number' && Number.isInteger(line) && typeof text === 'string' ? [{ line, text }] : []
  })
}

/** Why a rewrite was refused (G3). */
export type AiSiteImportWordingCode =
  | 'wording-no-line'
  | 'wording-fixed-line'
  | 'wording-repeated-line'
  | 'wording-empty'
  | 'wording-script'
  | 'wording-length'
  | 'wording-dropped-fact'
  | 'wording-dropped-name'
  | 'wording-invented-fact'
  | 'wording-gap'
  | 'wording-meaning'
  | 'wording-copy'

/** A rewrite refused, and why. */
export interface AiSiteImportWordingRefusal {
  line: number
  code: AiSiteImportWordingCode
  /** What the model is told: what the line broke and what to do. */
  message: string
  /** What it broke, beyond the message: the facts it dropped or added. */
  detail?: string
}

/** What a page's rewrites are held to beyond their own lines. */
export interface AiSiteImportWordingScope {
  doc: Pick<AiSiteImportDocument, 'blocks'>
  page: Pick<AiSiteImportWordingPage, 'lines'>
  /** The site's own name, which every rewrite says as often as its line does. */
  siteName?: string | null
  /** Who the copy is framed for: agency and enterprise copy holds to the judgment-word rule. */
  framing?: AiCopyFraming
}

/** The rewrites that hold, by line, and those refused. */
export interface AiSiteImportWordingHeld {
  held: Map<number, string>
  refused: AiSiteImportWordingRefusal[]
}

/** The scripts a line is told apart by; Chinese and Japanese writing count as one. */
const SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['thai', /\p{Script=Thai}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
]

/** The script most of a line's letters are written in; `null` for a line with none. */
export function aiSiteImportScriptOf(text: string): string | null {
  const counts = new Map<string, number>()
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue
    const script = SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0] ?? 'other'
    counts.set(script, (counts.get(script) ?? 0) + 1)
  }
  let best: string | null = null
  let most = 0
  for (const [script, count] of counts) {
    if (count > most) {
      best = script
      most = count
    }
  }
  return best
}

/** How often a run of words says a name, whole, in any case. */
function timesSaid(text: string, name: string): number {
  if (!name) return 0
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))].length
}

/** Each token of `a` not matched by one of `b`, as often as it is short. */
function short(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>()
  for (const token of b) left.set(token, (left.get(token) ?? 0) + 1)
  const out: string[] = []
  for (const token of a) {
    const count = left.get(token) ?? 0
    if (count > 0) left.set(token, count - 1)
    else out.push(token)
  }
  return out
}

/** A fact token as the model reads it: its words, not its kind. */
const shownFact = (token: string) => `"${token.replace(/^[a-z]+:/, '')}"`

/** The words of every line of the page as written: the facts a rewrite's contact details are held to. */
function pageText(doc: Pick<AiSiteImportDocument, 'blocks'>): string {
  return doc.blocks.map((block) => (block.kind === 'image' ? clean(block.alt) : clean(block.text))).filter(Boolean).join('\n')
}

/**
 * Every rule a rewrite is held to (G2, G3), pure, one line at a time: a
 * rewrite that breaks one is refused, and its line keeps its words. A
 * rewrite the same as its line is no rewrite, and is neither.
 */
export function aiSiteImportWordingHolds(scope: AiSiteImportWordingScope, rewrites: readonly AiSiteImportRewrite[]): AiSiteImportWordingHeld {
  const allowed = new Map(scope.page.lines.map((line) => [line.line, line]))
  const sources = scope.doc.blocks.flatMap((block) => (isLine(block) && block.kind !== 'image' ? [clean(block.text)] : []))
  const facts: SiteImportFactScope = siteImportFactScope(sources)
  const contacts = pageText(scope.doc)
  const name = clean(scope.siteName)
  const held = new Map<number, string>()
  const refused: AiSiteImportWordingRefusal[] = []
  const answered = new Set<number>()
  for (const rewrite of rewrites) {
    const at = rewrite.line
    const refuse = (code: AiSiteImportWordingCode, message: string, detail?: string) => refused.push({ line: at, code, message: `Line ${at}: ${message}`, ...(detail ? { detail } : {}) })
    if (answered.has(at)) {
      refuse('wording-repeated-line', 'it was answered more than once. Give each line once.')
      continue
    }
    answered.add(at)
    const block = scope.doc.blocks[at]
    if (!block || !isLine(block)) {
      refuse('wording-no-line', 'there is no such line on this page. Answer only the lines shown, by their numbers.')
      continue
    }
    const line = allowed.get(at)
    if (!line) {
      refuse('wording-fixed-line', 'it is kept exactly as the owner wrote it. Leave it out.')
      continue
    }
    const text = clean(rewrite.text)
    if (!text) {
      refuse('wording-empty', 'it was given no words. Leave a line out to keep it as written; never empty it.')
      continue
    }
    if (text === line.text) continue
    if (aiSiteImportScriptOf(text) !== aiSiteImportScriptOf(line.text)) {
      refuse('wording-script', "it is not written in the line's own language. Write it in the language and script the line is in.")
      continue
    }
    const words = aiSiteImportWordsIn(text)
    const source = aiSiteImportWordsIn(line.text)
    if (words < AI_SITE_IMPORT_WORDING_LENGTH.least * source || words > AI_SITE_IMPORT_WORDING_LENGTH.most * source || text.length > line.limit) {
      const least = Math.ceil(AI_SITE_IMPORT_WORDING_LENGTH.least * source)
      const most = Math.floor(AI_SITE_IMPORT_WORDING_LENGTH.most * source)
      refuse(
        'wording-length',
        `it runs to ${words} ${words === 1 ? 'word' : 'words'} and ${text.length} characters. Keep it between ${least} and ${most} words, and within ${line.limit} characters.`,
        `The line has ${source} ${source === 1 ? 'word' : 'words'}.`,
      )
      continue
    }
    const before = siteImportFactTokens(line.text, facts, false)
    const after = siteImportFactTokens(text, facts, true)
    const nameBefore = timesSaid(line.text, name)
    const nameAfter = timesSaid(text, name)
    const dropped = short(before, after)
    const added = short(after, before)
    const names = [...dropped.filter((token) => token.startsWith('name:')), ...(nameAfter < nameBefore ? [`name:${name}`] : [])]
    if (names.length) {
      refuse('wording-dropped-name', 'it leaves out a name the line says. Keep every name exactly as the line writes it, as often.', `Left out: ${[...new Set(names)].map(shownFact).join(', ')}.`)
      continue
    }
    if (dropped.length) {
      refuse(
        'wording-dropped-fact',
        'it leaves out a fact the line says. Keep every price, number, date, time, percentage, address, phone number, email and web address exactly as the line writes it, as often.',
        `Left out: ${[...new Set(dropped)].map(shownFact).join(', ')}.`,
      )
      continue
    }
    const guarded = aiLayoutGuardContacts(text, contacts)
    if (added.length || nameAfter > nameBefore || guarded !== text) {
      const shown = [...new Set([...added, ...(nameAfter > nameBefore ? [`name:${name}`] : [])])]
      refuse('wording-invented-fact', 'it adds a fact or a name the line does not say. Add none of your own.', shown.length ? `Added: ${shown.map(shownFact).join(', ')}.` : undefined)
      continue
    }
    if (/\[[^\]]*\]/.test(text) && !/\[[^\]]*\]/.test(line.text)) {
      refuse('wording-gap', 'it leaves a gap in square brackets. Write the line whole, from its own words.')
      continue
    }
    if (siteImportContentKept(line.text, text) < SITE_IMPORT_MEANING_FLOOR) {
      refuse('wording-meaning', "it no longer says what the line says. Keep its meaning and most of its words' substance.")
      continue
    }
    if (detectOffVoiceCopy([{ at: 'line', text }], scope.framing ?? null).length || aiPlaceholderTokens(text).length) {
      refuse('wording-copy', "it holds filler, a placeholder or a word that calls the work simple or cheap. Write real words from the line's own.")
      continue
    }
    held.set(at, text)
  }
  return { held, refused }
}

/** A refusal as the re-ask names it. */
export function aiSiteImportWordingViolation(refusal: AiSiteImportWordingRefusal): AiDoctrineViolation {
  const shape = refusal.code === 'wording-no-line' || refusal.code === 'wording-fixed-line' || refusal.code === 'wording-repeated-line'
  return { rule: shape ? null : 14, code: refusal.code, message: refusal.message, ...(refusal.detail ? { detail: refusal.detail } : {}) }
}

/*------------------------------------------
 * The page reworded
 *-----------------------------------------*/

/**
 * The page with its rewrites (G3): the source's document, each rewritten
 * line's words in place of its own and every block at its index, its layout
 * pinned to the source's so no section moves or is renamed. An image, or a
 * line no rewrite names, is the source's.
 */
export function aiSiteImportRewordedDocument(doc: AiSiteImportDocument, rewrites: ReadonlyMap<number, string>): AiSiteImportDocument {
  return {
    ...doc,
    layout: aiSiteImportLayoutOf(doc),
    blocks: doc.blocks.map((block, index) => {
      const text = rewrites.get(index)
      return text === undefined || block.kind === 'image' ? block : { ...block, text }
    }),
  }
}

/** A page's wording, settled: the page built in its rewrites, and the lines kept as written after their re-ask. */
export interface AiSiteImportWorded<T> {
  built: T
  /** The lines reworded, by number. */
  rewrites: Map<number, string>
  /** The lines refused twice, which keep their words. */
  kept: AiSiteImportWordingRefusal[]
}

/**
 * The wording answer's check (G3): every rewrite held line by line, a
 * refused one asked again once — the lines that held are kept between the
 * answers — and the page built whole in what held (`build`, the page step's
 * check of a page brought in, with rule 14 on for the rewritten lines). On
 * the last answer a line refused again keeps its words; a page that cannot
 * be built in its rewrites is refused whole, and the page step keeps the
 * page's words.
 *
 * Stateful across one generation's answers: make one for each.
 */
export function aiSiteImportWordingCheck<T>(input: AiSiteImportWordingScope & {
  doc: AiSiteImportDocument
  build: (reworded: AiSiteImportDocument, rewritten: readonly string[]) => { value: T | null; violations: AiDoctrineViolation[] }
  /** The answers one generation makes; the last keeps a line refused again as written. */
  attempts?: number
}): AiGenerationCheck<AiSiteImportWorded<T>> {
  const attempts = input.attempts ?? AI_GENERATION_MAX_ATTEMPTS
  const held = new Map<number, string>()
  let answers = 0
  return (answer) => {
    answers += 1
    const rewrites = aiReadWordingAnswer(answer)
    if (!rewrites) return { value: null, violations: [{ rule: null, code: 'wording-unreadable', message: 'The answer gave no list of lines. Answer with submit_wording.' }] }
    const checked = aiSiteImportWordingHolds(input, rewrites)
    for (const [line, text] of checked.held) held.set(line, text)
    // A line refused now that held in an earlier answer keeps that rewrite.
    const refused = checked.refused.filter((refusal) => !held.has(refusal.line))
    if (refused.length && answers < attempts) {
      return {
        value: null,
        violations: [
          ...refused.map(aiSiteImportWordingViolation),
          {
            rule: null,
            code: 'wording-kept-lines',
            message: `Every other line you reworded holds and is kept. Answer again with ${refused.length === 1 ? 'that line' : 'those lines'} alone, or leave ${refused.length === 1 ? 'it' : 'them'} out to keep the owner's words.`,
          },
        ],
        offending: { lines: rewrites.filter((rewrite) => refused.some((refusal) => refusal.line === rewrite.line)) },
      }
    }
    const reworded = aiSiteImportRewordedDocument(input.doc, held)
    const built = input.build(reworded, [...held.values()])
    if (!built.value) return { value: null, violations: built.violations }
    return { value: { built: built.value, rewrites: new Map(held), kept: refused }, violations: [] }
  }
}
