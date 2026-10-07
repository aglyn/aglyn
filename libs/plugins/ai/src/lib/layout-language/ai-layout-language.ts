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

import type { AiTool } from '../providers/contract'
import { AI_ICON_WORDS } from '../runtime/ai-icon-library'

/**
 * The compact layout language (AGL-3660): what a model designs a page, and a
 * site's header and footer, in — and the one place its shape is declared.
 *
 * ── Why a language, not a tree ───────────────────────────────────────────
 *
 * A page used to be asked for as a raw element tree, packed as escaped JSON
 * text inside a tool call and held to the doctrine's building rules: Grid
 * items sized as strings, every child attached, one h1, a destination on
 * every button, headings under their ceiling. A real model kept about half
 * of a page's sections on the first try, and a Free section was cut off at
 * its token ceiling. The founder chose a language over a library of section
 * templates (10/7): every page is designed for its own request, so no two
 * sites come out alike, and the rules hold because CODE writes the tree.
 *
 * So the model says WHAT each section is and how it is arranged, in a few
 * words of structure, and writes every word a visitor reads; the compiler
 * (`ai-layout-compiler.ts`) turns that into the element tree with the
 * palette's elements and the theme's tokens, by construction.
 *
 * ── The shape ────────────────────────────────────────────────────────────
 *
 * A page is its plan's sections, in order. A SECTION is
 *  - `band`  — its background: `plain` (the page), `soft` (a paper band),
 *              `brand` (the brand color) or `dark` (always dark);
 *  - `cols`  — a row of columns by relative width, as `[7, 5]` or `[1, 1, 1]`,
 *              up to four; absent, one column;
 *  - `align` — `start` or `center`;
 *  - `blocks` — what it shows, top to bottom.
 *
 * A BLOCK is one thing a visitor reads or uses. Its `kind` is one of
 * `AI_LAYOUT_BLOCK_KINDS`; `col` places it in a column of the row (0 first),
 * and a block with no `col` spans the section — above the row when it comes
 * before the first placed block, below it when it comes after. `text` is its
 * words, `to` where it goes, `style` its emphasis and `icon` a word from the
 * icon library. A group — `list`, `cards`, `steps`, `stats`, `quotes`,
 * `faq` — carries its `items`, each a `title`, a `text`, and optionally its
 * own `to` and `icon`.
 *
 * Where a block goes (`to`): `page:<id>` for a page of this site (its label
 * works too), `#<n>` for section n of this page, `form` for the site's form,
 * a form's or a component's id for a `form` or `component` block, or an
 * `https:` address the brief gave.
 *
 * A site's header and footer are two sections in the same language
 * (`AI_LAYOUT_FRAME_TOOL`): the header's brand and navigation are the
 * site's own and written by the compiler, so the model gives the header its
 * band, its alignment and an optional call-to-action button; the footer is
 * a section like any other.
 *
 * ── Cheap by shape ───────────────────────────────────────────────────────
 *
 * The schema is a structured object in the tool input (never JSON text in a
 * string), small enough for a strict tool (`tool-schema-limits.spec.ts`), and
 * the language's instructions ride in the cached prefix. A section is a few
 * dozen words of structure beside its copy, so a whole page is one answer.
 */

/** Every kind of block, in the order the schema lists them. */
export const AI_LAYOUT_BLOCK_KINDS = [
  'eyebrow',
  'heading',
  'lede',
  'text',
  'note',
  'list',
  'button',
  'image',
  'cards',
  'steps',
  'stats',
  'quotes',
  'faq',
  'form',
  'component',
] as const

export type AiLayoutBlockKind = (typeof AI_LAYOUT_BLOCK_KINDS)[number]

/** The kinds that carry `items`. */
export const AI_LAYOUT_GROUP_KINDS: ReadonlySet<AiLayoutBlockKind> = new Set([
  'list',
  'cards',
  'steps',
  'stats',
  'quotes',
  'faq',
])

export const AI_LAYOUT_BANDS = ['plain', 'soft', 'brand', 'dark'] as const
export type AiLayoutBand = (typeof AI_LAYOUT_BANDS)[number]

export const AI_LAYOUT_ALIGNS = ['start', 'center'] as const
export type AiLayoutAlign = (typeof AI_LAYOUT_ALIGNS)[number]

export const AI_LAYOUT_STYLES = [
  'primary',
  'secondary',
  'quiet',
  'large',
] as const
export type AiLayoutStyle = (typeof AI_LAYOUT_STYLES)[number]

/** The most columns a row holds; a fifth is folded into the fourth. */
export const AI_LAYOUT_MAX_COLS = 4

/**
 * The most items a group shows: one under the eight copies rule 8 reads as a
 * list typed out by hand, which belongs in a dataset.
 */
export const AI_LAYOUT_MAX_ITEMS = 7

/** The most quotes a group shows: each is a gap the owner fills with a real one. */
export const AI_LAYOUT_MAX_QUOTES = 3

export interface AiLayoutItem {
  title: string
  text: string
  to?: string
  icon?: string
}

export interface AiLayoutBlock {
  kind: AiLayoutBlockKind
  col?: number
  text?: string
  to?: string
  style?: AiLayoutStyle
  icon?: string
  items?: AiLayoutItem[]
}

export interface AiLayoutSection {
  band?: AiLayoutBand
  cols?: number[]
  align?: AiLayoutAlign
  blocks: AiLayoutBlock[]
}

/** A page: its plan's sections, in order. */
export interface AiLayoutPageDoc {
  sections: AiLayoutSection[]
}

/** A site's frame: the header and the footer every page renders between. */
export interface AiLayoutFrameDoc {
  header: AiLayoutSection
  footer: AiLayoutSection
}

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'text'],
  properties: {
    title: { type: 'string' },
    text: { type: 'string' },
    to: { type: 'string' },
    icon: { type: 'string' },
  },
} as const

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: [...AI_LAYOUT_BLOCK_KINDS] },
    col: { type: 'integer' },
    text: { type: 'string' },
    to: { type: 'string' },
    style: { type: 'string', enum: [...AI_LAYOUT_STYLES] },
    icon: { type: 'string' },
    items: { type: 'array', items: ITEM_SCHEMA },
  },
} as const

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks'],
  properties: {
    band: { type: 'string', enum: [...AI_LAYOUT_BANDS] },
    cols: { type: 'array', items: { type: 'integer' } },
    align: { type: 'string', enum: [...AI_LAYOUT_ALIGNS] },
    blocks: { type: 'array', items: BLOCK_SCHEMA },
  },
} as const

/** The page tool: every section of one page, in plan order, in one answer. */
export const AI_LAYOUT_PAGE_TOOL: AiTool = {
  name: 'submit_page',
  description:
    'Submit the page: one entry in sections for each planned section, in order, in the layout language.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sections'],
    properties: { sections: { type: 'array', items: SECTION_SCHEMA } },
  },
}

/** The frame tool: the site's header and footer, in the same language. */
export const AI_LAYOUT_FRAME_TOOL: AiTool = {
  name: 'submit_frame',
  description:
    "Submit the site's header and footer, each as a section in the layout language.",
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['header', 'footer'],
    properties: { header: SECTION_SCHEMA, footer: SECTION_SCHEMA },
  },
}

/**
 * The language as a model is taught it: the cached instructions both doors
 * share. Every word of copy is the model's; this says only how a design is
 * written down and what each word becomes.
 */
export const AI_LAYOUT_LANGUAGE_TEXT = [
  "You design web pages in a compact layout language. You decide the structure and write every word; the platform turns your design into the page, with the site's theme, spacing and type, so never describe styling beyond the words below.",
  '',
  'A page is a list of sections, one for each section the plan names, in that order. A section has:',
  '- band: plain (the page background), soft (a light band), brand (the brand color) or dark (always dark). Vary the bands down a page so neighboring sections read apart; keep brand and dark to one or two sections a page.',
  '- cols: optional relative column widths for a row, such as [1, 1] for halves, [7, 5] for a wide and a narrow column, or [1, 1, 1]; at most 4. Leave it out for one column.',
  '- align: start or center.',
  '- blocks: what the section shows, top to bottom. A block with "col" goes in that column of the row (0 is the first); a block without one spans the whole section, above the row when it comes first and below it when it comes last.',
  '',
  'Block kinds:',
  "- eyebrow: a short label above a heading. heading: a heading; the first heading of the page's first section is the page's title, and the first heading of every other section is that section's heading. lede: the larger sentence under a heading. text: a paragraph. note: small print.",
  '- button: text is the label and to says where it goes; style primary, secondary or quiet. Two buttons in a row read as a pair.',
  '- image: text describes the picture to place, which becomes its alt text; the owner adds the picture. icon names a drawing to show until then.',
  '- list: items are the lines (title only; text may be empty).',
  "- cards, steps, stats, quotes, faq: items, each with a title and a text. cards are features or services; steps are numbered; stats are a figure (title) with its label (text); faq items are a question (title) and its answer (text); quotes are what a customer should be quoted saying, written as the gap the owner fills, never as a real person's words.",
  "- form: places a saved form by its id in to. component: places a reusable component by its id in to; its items fill the component's props, title the prop name and text the value.",
  '- style large on a heading makes the page title display-sized. icon (on a block or an item) is one of: ' +
    AI_ICON_WORDS.join(', ') +
    '.',
  '',
  "Where a link goes (to): page:<page id> for a page of this site; #<n> for section n of this page (counted from 1); form for the site's form; or an https: address the brief gives. A button the page has nowhere to send is left out.",
  '',
  "Writing: plain, specific copy in the site's voice, from the brief, the business and its audience, never filler. Keep a page title under 70 characters and a section heading under 80. Where the brief leaves out a fact such as a price, a figure, a name, a phone number, an email or an address, write the gap in square brackets, like [phone number], instead of inventing it. Never invent a customer, a review, an award or a statistic.",
  '',
  'Design each page for this business and this request: choose the bands, the rows and the blocks that tell its story best, so no two sites read alike.',
].join('\n')

// ── Reading an answer ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined {
  return typeof value === 'string' &&
    (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/** What the reader settled on its own, for the job's record and the specs. */
export interface AiLayoutSettlement {
  /** Where: `sections[2].blocks[1]`, `header`. */
  at: string
  what: string
}

function readItem(raw: unknown): AiLayoutItem | null {
  if (!isRecord(raw)) return null
  const item: AiLayoutItem = {
    title: typeof raw['title'] === 'string' ? raw['title'] : '',
    text: typeof raw['text'] === 'string' ? raw['text'] : '',
  }
  if (!item.title.trim() && !item.text.trim()) return null
  const to = text(raw['to'])
  const icon = text(raw['icon'])
  return { ...item, ...(to ? { to } : {}), ...(icon ? { icon } : {}) }
}

function readBlock(
  raw: unknown,
  at: string,
  settled: AiLayoutSettlement[],
): AiLayoutBlock | null {
  if (!isRecord(raw)) {
    settled.push({ at, what: 'not a block; left out' })
    return null
  }
  const kind = oneOf(raw['kind'], AI_LAYOUT_BLOCK_KINDS)
  if (!kind) {
    settled.push({
      at,
      what: `unknown kind ${JSON.stringify(raw['kind'] ?? null)}; left out`,
    })
    return null
  }
  const block: AiLayoutBlock = { kind }
  if (
    typeof raw['col'] === 'number' &&
    Number.isInteger(raw['col']) &&
    raw['col'] >= 0
  )
    block.col = raw['col']
  const words = text(raw['text'])
  if (words) block.text = words
  const to = text(raw['to'])
  if (to) block.to = to.trim()
  const style = oneOf(raw['style'], AI_LAYOUT_STYLES)
  if (style) block.style = style
  const icon = text(raw['icon'])
  if (icon) block.icon = icon.trim().toLowerCase()
  if (AI_LAYOUT_GROUP_KINDS.has(kind) || kind === 'component') {
    const items = (Array.isArray(raw['items']) ? raw['items'] : [])
      .map(readItem)
      .filter((item): item is AiLayoutItem => !!item)
    const most =
      kind === 'quotes'
        ? AI_LAYOUT_MAX_QUOTES
        : kind === 'component'
          ? Infinity
          : AI_LAYOUT_MAX_ITEMS
    if (items.length > most)
      settled.push({
        at,
        what: `${items.length} items; the first ${most} kept`,
      })
    if (items.length) block.items = items.slice(0, most)
  }
  // A block with nothing to show is no block: a group with no items, words
  // with no words. A form or a component may name its record alone.
  const empty = AI_LAYOUT_GROUP_KINDS.has(kind)
    ? !block.items?.length
    : kind === 'form' || kind === 'component'
      ? false
      : !block.text
  if (empty) {
    settled.push({ at, what: `an empty ${kind}; left out` })
    return null
  }
  return block
}

/** A section read from an answer, or `null` with why it could not be. */
export function aiReadLayoutSection(
  raw: unknown,
  at: string,
  settled: AiLayoutSettlement[],
): AiLayoutSection | null {
  if (!isRecord(raw)) return null
  const section: AiLayoutSection = { blocks: [] }
  const band = oneOf(raw['band'], AI_LAYOUT_BANDS)
  if (band) section.band = band
  const align = oneOf(raw['align'], AI_LAYOUT_ALIGNS)
  if (align) section.align = align
  if (Array.isArray(raw['cols'])) {
    const cols = raw['cols'].filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value > 0,
    )
    if (cols.length > AI_LAYOUT_MAX_COLS) {
      settled.push({
        at: `${at}.cols`,
        what: `${cols.length} columns; the first ${AI_LAYOUT_MAX_COLS} kept`,
      })
    }
    if (cols.length >= 2)
      section.cols = cols
        .slice(0, AI_LAYOUT_MAX_COLS)
        .map((value) => Math.min(12, Math.max(1, Math.round(value))))
  }
  const blocks = Array.isArray(raw['blocks']) ? raw['blocks'] : []
  blocks.forEach((entry, index) => {
    const block = readBlock(entry, `${at}.blocks[${index}]`, settled)
    if (!block) return
    if (
      block.col !== undefined &&
      section.cols &&
      block.col >= section.cols.length
    ) {
      settled.push({
        at: `${at}.blocks[${index}]`,
        what: `column ${block.col} of ${section.cols.length}; placed in the last`,
      })
      block.col = section.cols.length - 1
    }
    if (block.col !== undefined && !section.cols) delete block.col
    section.blocks.push(block)
  })
  return section.blocks.length ? section : null
}

/** A page answer read: the sections it gave, by plan position, and the positions it could not. */
export interface AiLayoutPageReading {
  /** One entry per planned section; `null` where the answer gave nothing usable. */
  sections: Array<AiLayoutSection | null>
  settled: AiLayoutSettlement[]
}

/**
 * The page an answer describes, against the number of sections its plan
 * names: each planned section takes the answer's section at its position,
 * an answer's extra sections are left out, and a planned section the answer
 * left empty or out is `null` — the one thing a re-ask asks for again.
 */
export function aiReadLayoutPage(
  raw: unknown,
  planned: number,
): AiLayoutPageReading {
  const settled: AiLayoutSettlement[] = []
  const given =
    isRecord(raw) && Array.isArray(raw['sections']) ? raw['sections'] : []
  if (given.length > planned) {
    settled.push({
      at: 'sections',
      what: `${given.length} sections for a plan of ${planned}; the extra left out`,
    })
  }
  const sections = Array.from({ length: planned }, (_, index) =>
    aiReadLayoutSection(given[index], `sections[${index}]`, settled),
  )
  return { sections, settled }
}

/** A frame answer read: a header and a footer, either `null` where it was not usable. */
export function aiReadLayoutFrame(raw: unknown): {
  header: AiLayoutSection | null
  footer: AiLayoutSection | null
  settled: AiLayoutSettlement[]
} {
  const settled: AiLayoutSettlement[] = []
  const record = isRecord(raw) ? raw : {}
  // A header needs no block of its own: its brand and navigation are the
  // site's, so an empty one is a plain bar.
  const header = isRecord(record['header'])
    ? (aiReadLayoutSection(record['header'], 'header', settled) ??
      readBare(record['header']))
    : null
  const footer = aiReadLayoutSection(record['footer'], 'footer', settled)
  return { header, footer, settled }
}

/** A section with no usable block, keeping only its band and alignment. */
function readBare(raw: Record<string, unknown>): AiLayoutSection {
  const band = oneOf(raw['band'], AI_LAYOUT_BANDS)
  const align = oneOf(raw['align'], AI_LAYOUT_ALIGNS)
  return { ...(band ? { band } : {}), ...(align ? { align } : {}), blocks: [] }
}
