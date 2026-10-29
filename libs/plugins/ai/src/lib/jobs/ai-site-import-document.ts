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
 * A PAGE BROUGHT IN WORD FOR WORD (AGL-4084).
 *
 * An imported page is never rewritten. Its words are the source's, as the
 * crawler read them (`AiSiteImportPageRead.blocks`), and this module is the
 * only thing that puts them on the new page:
 *
 * - **Lines.** The page's main region, numbered: every heading, paragraph,
 *   list item, quote, link and picture in source order. A link inside a
 *   sentence is in its sentence already and is no line of its own.
 * - **Sections.** One for the page's opening (its title and what comes
 *   before the first second-level heading), then one for each second-level
 *   heading, as the source divides itself. The page's plan has exactly
 *   these sections, by these names.
 * - **Copied** (a collection's page, a long page): laid out by code, every
 *   line in order, the bands alternating plain and soft, with no model at
 *   all.
 * - **Arranged** (a main page): the model's answer says each section's band
 *   and columns and which numbered lines go in which kind of block
 *   (`AI_LAYOUT_ARRANGE_TOOL`, which has no field for a word of copy). Code
 *   substitutes the lines exactly as written. A block naming a line already
 *   placed is dropped, a line of another section is not taken, and every
 *   line the answer never placed is added at the end of its own section, so
 *   each line is on the page exactly once.
 *
 * Both write the palette's own elements with the theme's tokens, the way the
 * layout language compiler does (`ai-layout-compiler.ts`), so the page
 * renders in the site's theme and every word stays editable in the
 * Besigner's fields. Nothing is fitted, cut at a clean boundary or reworded:
 * a paragraph longer than a text element holds is split between sentences,
 * and a page longer than one page may weigh ends at a line, marked `cut`, so
 * the review says how many of its words came through.
 *=========================================*/

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { bandSx } from '../layout-language/ai-layout-compiler'
import {
  AI_LAYOUT_ARRANGE_ITEM_KINDS,
  type AiLayoutArrangeBand,
  type AiLayoutArrangedBlock,
  type AiLayoutArrangedSection,
  type AiLayoutArrangement,
} from '../layout-language/ai-layout-language'
import type { AiLayoutPage } from '../layout-language/ai-layout-links'
import { AiLayoutTreeBuilder, aiLayoutSpans, type AiLayoutRawTree } from '../layout-language/ai-layout-tree'
import {
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  AI_SITE_IMPORT_MAX_SECTIONS,
  type AiSiteImportBuild,
  type AiSiteImportPhoto,
} from '../model/ai-site-import'
import type { SiteImportBlock } from '../site-import/site-import-html'
import { siteImportLabel } from '../site-import/site-import-page'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'

/** The unit input carrying a page brought in word for word: its lines, its photos and where its links go. */
export const AI_LAYOUT_IMPORTED_SECTIONS_INPUT = 'importedSections'

/** A page brought in, as the import step hands it to the page step. Untrusted data from the owner's site. */
export interface AiSiteImportDocument {
  build: AiSiteImportBuild
  /** The page's name on the new site: its h1 where the source shows no heading. */
  title: string
  /** Where the page is on the owner's website. */
  url: string
  /** The page's main region, in order. */
  blocks: SiteImportBlock[]
  /** Its photos as the library holds them, each by the source address it was read from. */
  photos: AiSiteImportPhoto[]
  /** The site's own pages a link may go to: the source path each was read from, and the page it is now. */
  links: Array<{ path: string; id: string }>
  /** The origins the old site answers on: a link to one of them is to a page of its own. */
  origins: string[]
}

/** The most characters a text element holds (the palette's ceiling for body copy). */
export const AI_SITE_IMPORT_TEXT_MAX_CHARS = AI_TEXT_LIMITS.body

/** The most characters a heading style holds; a longer heading is drawn in a subtitle style, still a heading. */
export const AI_SITE_IMPORT_HEADLINE_MAX_CHARS = AI_TEXT_LIMITS.headline

/** The most characters a button's label holds; a longer link keeps its words as a line of text. */
export const AI_SITE_IMPORT_LABEL_CHARS = 40

/**
 * What one page may weigh, inside the budget of a page of its owner's own
 * words (`AI_OWN_WORDS_PAGE_BUDGET`): a page that would run past it ends at
 * the line before, marked `cut`.
 */
export const AI_SITE_IMPORT_DOC_MAX_NODES = 1_400
export const AI_SITE_IMPORT_DOC_MAX_CHARS = 200_000

const SECTION_PADDING = { xs: 8, md: 12 } as const

/** One numbered line of a page. */
export interface AiSiteImportLine {
  /** 1-based, in source order. */
  n: number
  block: SiteImportBlock
  /** The section it belongs to, by plan index. */
  section: number
}

export interface AiSiteImportDocSection {
  name: string
  /** Its lines' numbers, in order. */
  lines: number[]
}

export interface AiSiteImportDocLines {
  lines: AiSiteImportLine[]
  sections: AiSiteImportDocSection[]
}

const clean = (text: string) => String(text ?? '').replace(/\s+/g, ' ').trim()

/** Whether a block is a line of its own: a link inside a sentence is in its sentence already. */
function isLine(block: SiteImportBlock): boolean {
  if (block.kind === 'image') return !!block.url
  if (block.kind === 'link') return !block.inline && !!clean(block.text)
  return !!clean(block.text)
}

/**
 * The page's lines and sections (AGL-4084): the opening, then one section
 * at each second-level heading, at most `AI_SITE_IMPORT_MAX_SECTIONS` (the
 * last holds whatever follows). A page that opens on a second-level heading
 * opens with it. Section names are the headings' words, neutralized and cut
 * to a label, since they travel outside a fence.
 */
export function aiSiteImportDocLines(blocks: readonly SiteImportBlock[], title: string): AiSiteImportDocLines {
  const lines: AiSiteImportLine[] = []
  const sections: AiSiteImportDocSection[] = []
  let current: AiSiteImportDocSection | null = null
  for (const block of blocks) {
    if (!isLine(block)) continue
    const starts = block.kind === 'heading' && block.level === 2 && sections.length < AI_SITE_IMPORT_MAX_SECTIONS
    if (!current || (starts && current.lines.length > 0)) {
      current = { name: '', lines: [] }
      sections.push(current)
    }
    const n = lines.length + 1
    lines.push({ n, block, section: sections.length - 1 })
    current.lines.push(n)
  }
  const named = new Set<string>()
  sections.forEach((section, index) => {
    const heading = section.lines.map((n) => lines[n - 1].block).find((block) => block.kind === 'heading')
    let name = siteImportLabel(heading && heading.kind === 'heading' ? heading.text : index === 0 ? title : '') || (index === 0 ? siteImportLabel(title) : '')
    if (!name) name = `Section ${index + 1}`
    // Two sections of one name are told apart, so a link to either finds it.
    let unique = name
    for (let attempt = 2; named.has(unique.toLowerCase()); attempt += 1) {
      unique = `${name.slice(0, AI_SITE_IMPORT_LABEL_MAX_CHARS - 4)} (${attempt})`
    }
    named.add(unique.toLowerCase())
    section.name = unique
  })
  if (!sections.length) sections.push({ name: siteImportLabel(title) || 'Introduction', lines: [] })
  return { lines, sections }
}

/** The words a line shows: an image's are its description. */
export function aiSiteImportLineText(line: Pick<AiSiteImportLine, 'block'>): string {
  return line.block.kind === 'image' ? clean(line.block.alt) : clean(line.block.text)
}

const wordsIn = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** The input a page job carries, read defensively; `null` on every other job. */
export function aiSiteImportDocumentOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSiteImportDocument | null {
  const raw = inputs?.[AI_LAYOUT_IMPORTED_SECTIONS_INPUT]
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const build = value['build'] === 'copied' || value['build'] === 'arranged' ? value['build'] : null
  if (!build || !Array.isArray(value['blocks'])) return null
  const blocks = (value['blocks'] as unknown[]).flatMap((entry): SiteImportBlock[] => {
    if (!entry || typeof entry !== 'object') return []
    const block = entry as Record<string, unknown>
    const text = typeof block['text'] === 'string' ? block['text'] : ''
    const region = 'main' as const
    switch (block['kind']) {
      case 'heading': {
        const level = Number(block['level'])
        return [{ kind: 'heading', level: (Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2) as 1 | 2 | 3 | 4 | 5 | 6, text, region }]
      }
      case 'paragraph':
      case 'list-item':
      case 'quote':
        return [{ kind: block['kind'], text, region }]
      case 'image':
        return typeof block['url'] === 'string' ? [{ kind: 'image', url: block['url'], alt: typeof block['alt'] === 'string' ? block['alt'] : '', region }] : []
      case 'link':
        return typeof block['href'] === 'string'
          ? [{ kind: 'link', text, href: block['href'], region, ...(block['inline'] === true ? { inline: true as const } : {}) }]
          : []
      default:
        return []
    }
  })
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [])
  return {
    build,
    title: typeof value['title'] === 'string' ? value['title'] : '',
    url: typeof value['url'] === 'string' ? value['url'].slice(0, 2048) : '',
    blocks,
    photos: (Array.isArray(value['photos']) ? value['photos'] : []).flatMap((entry): AiSiteImportPhoto[] => {
      const photo = entry as Record<string, unknown> | null
      return photo && typeof photo['mediaId'] === 'string' && typeof photo['src'] === 'string'
        ? [
            {
              mediaId: photo['mediaId'],
              src: photo['src'],
              ...(typeof photo['alt'] === 'string' ? { alt: photo['alt'] } : {}),
              ...(typeof photo['from'] === 'string' ? { from: photo['from'] } : {}),
            },
          ]
        : []
    }),
    links: (Array.isArray(value['links']) ? value['links'] : []).flatMap((entry) => {
      const link = entry as Record<string, unknown> | null
      return link && typeof link['path'] === 'string' && typeof link['id'] === 'string' ? [{ path: link['path'], id: link['id'] }] : []
    }),
    origins: strings(value['origins']),
  }
}

/*------------------------------------------
 * Drawing the lines
 *-----------------------------------------*/

/** A paragraph cut between sentences into parts a text element holds, every word kept in order. */
export function aiSiteImportTextParts(text: string, max = AI_SITE_IMPORT_TEXT_MAX_CHARS): string[] {
  const words = clean(text)
  if (words.length <= max) return words ? [words] : []
  const sentences = words.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*\s*|$)/g) ?? [words]
  const parts: string[] = []
  let part = ''
  const push = () => {
    if (part.trim()) parts.push(part.trim())
    part = ''
  }
  for (const sentence of sentences) {
    if ((part + sentence).trim().length <= max) {
      part += sentence
      continue
    }
    push()
    // One sentence longer than an element holds is cut between words.
    let rest = sentence.trim()
    while (rest.length > max) {
      const at = rest.lastIndexOf(' ', max)
      const cut = at > 0 ? at : max
      parts.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    part = rest ? `${rest} ` : ''
  }
  push()
  return parts
}

type Style = 'heading' | 'eyebrow' | 'lede' | 'text' | 'note'

interface DocScope {
  tree: AiLayoutTreeBuilder
  doc: AiSiteImportDocument
  /** The pages a link may go to by id. */
  pageIds: ReadonlySet<string>
  /** Source path → page id, for the ones a link may go to. */
  pathTo: ReadonlyMap<string, string>
  photos: ReadonlyMap<string, AiSiteImportPhoto>
  /** Whether the page's h1 is written. */
  titled: boolean
  /** The level of the last heading drawn, which the next may go at most one under. */
  lastLevel: number
  /** Pictures drawn so far: the first loads at once, the rest when reached. */
  pictures: number
  /** Lines on the page, in the order drawn. */
  placed: number[]
  words: number
  chars: number
  cut: boolean
}

/** Whether the page has room for one more line of this many characters. */
function room(scope: DocScope, chars: number): boolean {
  if (scope.cut) return false
  if (Object.keys(scope.tree.nodes).length >= AI_SITE_IMPORT_DOC_MAX_NODES || scope.chars + chars > AI_SITE_IMPORT_DOC_MAX_CHARS) {
    scope.cut = true
    return false
  }
  return true
}

function took(scope: DocScope, line: AiSiteImportLine): void {
  scope.placed.push(line.n)
  const text = aiSiteImportLineText(line)
  scope.chars += text.length
  if (line.block.kind !== 'image') scope.words += wordsIn(text)
}

/** A heading at its place in the outline: the page's one h1 first, then the section's h2, then h3 under it. */
function headingNode(scope: DocScope, text: string, level: number, centered: boolean): string {
  // The outline never skips a level: an h3 straight under the h1 is drawn an h2.
  const tag = !scope.titled ? 1 : Math.max(2, Math.min(3, level, scope.lastLevel + 1))
  scope.titled = true
  scope.lastLevel = tag
  const variant = text.length > AI_SITE_IMPORT_HEADLINE_MAX_CHARS ? 'subtitle1' : tag === 1 ? 'h1' : tag === 2 ? 'h2' : 'h4'
  return scope.tree.add(
    'muiTypography',
    { children: text, variant, component: `h${tag}`, ...(centered ? { align: 'center' } : {}) },
    null,
    null,
    'heading',
  )
}

const VARIANTS: Record<Exclude<Style, 'heading'>, string> = { eyebrow: 'overline', lede: 'lede', text: 'body1', note: 'body2' }

/** Words in a style, split where a text element would cut them. */
function textNodes(scope: DocScope, text: string, style: Exclude<Style, 'heading'>, centered: boolean): string[] {
  return aiSiteImportTextParts(text).map((part) =>
    scope.tree.add(
      'muiTypography',
      { children: part, variant: VARIANTS[style], component: 'p', ...(centered ? { align: 'center' } : {}) },
      style === 'note' ? { color: 'text.secondary' } : null,
      null,
      style,
    ),
  )
}

/** Where a link goes on the new site, or `null` where it goes nowhere a page of it may send a visitor. */
function linkProps(scope: DocScope, href: string): Record<string, unknown> | null {
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href) || /^tel:\+?[\d\s().-]{3,}$/i.test(href)) return { href }
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (scope.doc.origins.includes(url.origin)) {
    // The old site's own page: the page it became, where that page may be linked.
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const id = scope.pathTo.get(path)
    return id && scope.pageIds.has(id) ? { screenId: id } : null
  }
  return url.protocol === 'https:' ? { href: url.toString(), target: '_blank' } : null
}

/** A link line: a button that goes where the source's did, or its words as a line where it cannot. */
function linkNodes(scope: DocScope, line: AiSiteImportLine, style: 'primary' | 'secondary' | 'quiet', centered: boolean): string[] {
  const block = line.block
  if (block.kind !== 'link') return []
  const label = clean(block.text)
  const goes = label.length <= AI_SITE_IMPORT_LABEL_CHARS ? linkProps(scope, block.href) : null
  if (!goes) return textNodes(scope, label, 'text', centered)
  const look =
    style === 'primary'
      ? { variant: 'contained', color: 'primary' }
      : style === 'secondary'
        ? { variant: 'outlined', color: 'primary' }
        : { variant: 'text', color: 'primary' }
  return [
    scope.tree.add(
      'muiButton',
      { children: label, ...look, size: 'medium', ...goes },
      { alignSelf: centered ? 'center' : 'flex-start' },
      null,
      'button',
    ),
  ]
}

/** A picture line: the photo the library holds for it, or nothing where it could not be brought in. */
function imageNodes(scope: DocScope, line: AiSiteImportLine): string[] {
  const block = line.block
  if (block.kind !== 'image') return []
  const photo = scope.photos.get(block.url)
  if (!photo) return []
  const alt = clean(block.alt || photo.alt || '').slice(0, 200)
  scope.pictures += 1
  return [
    scope.tree.add(
      'image',
      {
        src: photo.src,
        ...(alt ? { alt } : { decorative: true }),
        objectFit: 'cover',
        ...(scope.pictures > 1 ? { loading: 'lazy' } : {}),
      },
      null,
      null,
      'image',
    ),
  ]
}

/** One line in a style a block asked for; a picture is a picture and a link a link, wherever they are placed. */
function lineNodes(scope: DocScope, line: AiSiteImportLine, style: Style, centered: boolean, button: 'primary' | 'secondary' | 'quiet' = 'quiet'): string[] {
  if (!room(scope, aiSiteImportLineText(line).length)) return []
  const block = line.block
  let ids: string[]
  if (block.kind === 'image') ids = imageNodes(scope, line)
  else if (block.kind === 'link') ids = linkNodes(scope, line, button, centered)
  else if (style === 'heading' || (block.kind === 'heading' && style === 'text')) ids = [headingNode(scope, clean(block.text), block.kind === 'heading' ? block.level : 2, centered)]
  else if (block.kind === 'quote' && style === 'text') {
    ids = [scope.tree.add('muiBox', { component: 'blockquote' }, null, textNodes(scope, block.text, 'text', centered), 'quote')]
  } else ids = textNodes(scope, block.text, style, centered)
  // A picture the library could not bring in is not on the page.
  if (ids.length) took(scope, line)
  return ids
}

/** A run of lines as a list, one item each. */
function listNode(scope: DocScope, lines: readonly AiSiteImportLine[]): string[] {
  const rows: string[] = []
  const rest: string[] = []
  for (const line of lines) {
    if (line.block.kind === 'image' || line.block.kind === 'link') {
      rest.push(...lineNodes(scope, line, 'text', false))
      continue
    }
    const text = aiSiteImportLineText(line)
    if (!room(scope, text.length)) break
    for (const part of aiSiteImportTextParts(text)) {
      rows.push(
        scope.tree.add('muiListItem', { disableGutters: true }, null, [scope.tree.add('muiListItemText', { primary: part }, null, null, 'line')], 'row'),
      )
    }
    took(scope, line)
  }
  return [...(rows.length ? [scope.tree.add('muiList', { disablePadding: true }, null, rows, 'list')] : []), ...rest]
}

/** A group's items, each a title line over its text lines, laid out side by side. */
function groupNode(scope: DocScope, kind: AiLayoutArrangedBlock['kind'], items: readonly AiSiteImportLine[][]): string[] {
  const pairs: string[] = []
  const rest: string[] = []
  for (const item of items) {
    const words = item.filter((line) => line.block.kind !== 'image' && line.block.kind !== 'link')
    for (const line of item) if (line.block.kind === 'image' || line.block.kind === 'link') rest.push(...lineNodes(scope, line, 'text', false))
    if (!words.length) continue
    const [title, ...body] = words
    const text = body.map(aiSiteImportLineText).join(' ')
    if (!room(scope, aiSiteImportLineText(title).length + text.length)) break
    const primary = aiSiteImportLineText(title)
    if (primary.length > AI_SITE_IMPORT_TEXT_MAX_CHARS || text.length > AI_SITE_IMPORT_TEXT_MAX_CHARS) {
      // An item too long for its element is its lines, one under another.
      for (const line of words) rest.push(...lineNodes(scope, line, 'text', false))
      continue
    }
    pairs.push(scope.tree.add('muiListItemText', { primary, ...(text ? { secondary: text } : {}) }, null, null, 'pair'))
    for (const line of words) took(scope, line)
  }
  if (!pairs.length) return rest
  const perRow = kind === 'faq' || kind === 'steps' || pairs.length === 1 ? 1 : Math.min(3, pairs.length)
  if (perRow === 1) return [scope.tree.add('muiStack', { spacing: '3' }, null, pairs, kind), ...rest]
  const size = perRow === 2 ? 'xs:12 sm:6' : 'xs:12 md:4'
  const cells = pairs.map((id) => scope.tree.add('muiGrid', { size }, null, [id], 'cell'))
  return [scope.tree.add('muiGrid', { container: true, spacing: '3' }, null, cells, kind), ...rest]
}

/** A section root: its band, its container and its content, under the id its plan stores it by. */
function sectionNode(scope: DocScope, index: number, name: string, band: AiLayoutArrangeBand, parts: readonly string[], id: string, wide: boolean): string {
  const tree = scope.tree
  const content = parts.length === 1 ? parts[0] : tree.add('muiStack', { spacing: '3', useFlexGap: true }, null, parts, 'content')
  const container = tree.add('muiContainer', { maxWidth: wide ? 'lg' : 'md' }, { py: { ...SECTION_PADDING } }, [content], 'container')
  return tree.add(
    'section',
    { element: 'section', ariaLabel: name || `Section ${index + 1}`, ...(band === 'dark' ? { colorScheme: 'dark' } : {}) },
    bandSx(band),
    [container],
    'section',
    id,
  )
}

/** The lines of a section, in source order, as the source draws them: lists as lists, the rest one under another. */
function copiedParts(scope: DocScope, lines: readonly AiSiteImportLine[]): string[] {
  const parts: string[] = []
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]
    if (line.block.kind === 'list-item') {
      const run: AiSiteImportLine[] = []
      while (at < lines.length && lines[at].block.kind === 'list-item') run.push(lines[at++])
      at -= 1
      parts.push(...listNode(scope, run))
      continue
    }
    parts.push(...lineNodes(scope, line, 'text', false))
  }
  return parts
}

/** One arranged block's lines, still unplaced and of its own section; `null` where it named a line already placed. */
function ownLines(lineOf: (n: number) => AiSiteImportLine | undefined, numbers: readonly number[], section: number, used: Set<number>): AiSiteImportLine[] | null {
  const lines: AiSiteImportLine[] = []
  for (const n of numbers) {
    const line = lineOf(n)
    if (!line || line.section !== section) continue
    if (used.has(n)) return null
    lines.push(line)
  }
  return lines
}

/** An arranged block drawn: its lines in the kind it asked for. */
function arrangedBlock(scope: DocScope, block: AiLayoutArrangedBlock, lines: readonly AiSiteImportLine[], items: readonly AiSiteImportLine[][], centered: boolean): string[] {
  switch (block.kind) {
    case 'list':
      return listNode(scope, lines)
    case 'cards':
    case 'steps':
    case 'stats':
    case 'faq':
      return groupNode(scope, block.kind, items.length ? items : lines.map((line) => [line]))
    case 'button': {
      const style = block.style === 'primary' || block.style === 'secondary' ? block.style : 'quiet'
      return lines.flatMap((line) => lineNodes(scope, line, 'text', centered, style))
    }
    case 'image':
      return lines.flatMap((line) => lineNodes(scope, line, 'text', centered))
    case 'heading':
    case 'eyebrow':
    case 'lede':
    case 'note': {
      const style: Style = block.kind
      return lines.flatMap((line, position) =>
        // A heading block's first line is the heading; any more are its words.
        lineNodes(scope, line, style === 'heading' && position > 0 ? 'text' : style, centered),
      )
    }
    default:
      return lines.flatMap((line) => lineNodes(scope, line, line.block.kind === 'heading' ? 'heading' : 'text', centered))
  }
}

/** One section as the arrangement lays it out, every line of it that the arrangement left out added at its end. */
function arrangedParts(
  scope: DocScope,
  arranged: AiLayoutArrangedSection,
  index: number,
  lines: readonly AiSiteImportLine[],
  lineOf: (n: number) => AiSiteImportLine | undefined,
  used: Set<number>,
): { parts: string[]; wide: boolean } {
  const centered = arranged.align === 'center'
  const cols = arranged.cols && arranged.cols.length >= 2 ? arranged.cols : null
  const head: string[] = []
  const tail: string[] = []
  const columns: string[][] = cols ? cols.map(() => []) : []
  let placedInRow = false
  for (const block of arranged.blocks) {
    const groups = AI_LAYOUT_ARRANGE_ITEM_KINDS.has(block.kind)
    const named = groups && block.items?.length ? block.items.flat() : block.from
    const taken = ownLines(lineOf, named, index, used)
    // A block that names a line twice is dropped; its other lines are added at the end.
    if (!taken?.length) continue
    for (const line of taken) used.add(line.n)
    const items = groups && block.items?.length ? block.items.map((item) => taken.filter((line) => item.includes(line.n))).filter((item) => item.length) : []
    const ids = arrangedBlock(scope, block, taken, items, centered && block.col === undefined)
    if (cols && block.col !== undefined) {
      columns[Math.min(block.col, cols.length - 1)].push(...ids)
      placedInRow = true
    } else (placedInRow ? tail : head).push(...ids)
  }
  // Every line the arrangement did not place, in source order, at the section's end.
  const left = lines.filter((line) => !used.has(line.n))
  for (const line of left) used.add(line.n)
  tail.push(...copiedParts(scope, left))
  const filled = columns.map((ids, position) => ({ ids, weight: cols?.[position] ?? 1 })).filter((entry) => entry.ids.length)
  const parts = [...head]
  if (filled.length >= 2) {
    const spans = aiLayoutSpans(filled.map((entry) => entry.weight))
    const cells = filled.map((entry, position) =>
      scope.tree.add(
        'muiGrid',
        { size: `xs:12 md:${spans[position]}` },
        null,
        [entry.ids.length === 1 ? entry.ids[0] : scope.tree.add('muiStack', { spacing: '3' }, null, entry.ids, 'column')],
        'cell',
      ),
    )
    parts.push(scope.tree.add('muiGrid', { container: true, spacing: '6' }, null, cells, 'row'))
  } else if (filled.length === 1) parts.push(...filled[0].ids)
  parts.push(...tail)
  return { parts, wide: filled.length >= 2 }
}

export interface AiSiteImportCompileInput {
  doc: AiSiteImportDocument
  /** The ids the page stores its sections under, in plan order: one for each of the document's sections. */
  sectionIds: readonly string[]
  /** The site's pages a link may go to (the page step's targets). */
  pages: readonly Pick<AiLayoutPage, 'id'>[]
  /** The model's arrangement, for an arranged page; absent, the page is laid out as the source has it. */
  arrangement?: AiLayoutArrangement | null
}

export interface AiSiteImportCompiled {
  tree: AiLayoutRawTree
  /** The line numbers on the page, in the order drawn. */
  placed: number[]
  /** Every line the page has. */
  lines: number
  /** The words on the page, and the words its lines hold. */
  words: number
  sourceWords: number
  /** Set when the page ran past what one page may weigh, and ends at the line before. */
  cut: boolean
}

/**
 * The page brought in, compiled into its tree (AGL-4084): copied as the
 * source has it, or as the arrangement lays it out, with every line on it
 * exactly once in either case and never a word that is not the source's.
 */
export function aiCompileImportedDocument(input: AiSiteImportCompileInput): AiSiteImportCompiled {
  const { doc } = input
  const { lines, sections } = aiSiteImportDocLines(doc.blocks, doc.title)
  const tree = new AiLayoutTreeBuilder('li')
  const pageIds = new Set(input.pages.map((page) => page.id))
  const scope: DocScope = {
    tree,
    doc,
    pageIds,
    pathTo: new Map(doc.links.map((link) => [link.path.replace(/\/+$/, '') || '/', link.id])),
    photos: new Map(doc.photos.flatMap((photo) => (photo.from ? [[photo.from, photo] as const] : []))),
    titled: false,
    lastLevel: 1,
    pictures: 0,
    placed: [],
    words: 0,
    chars: 0,
    cut: false,
  }
  const lineOf = (n: number) => lines[n - 1]
  const used = new Set<number>()
  const arranged = doc.build === 'arranged' ? input.arrangement : null
  // An arranged opening with no heading block takes its first heading line as one, so the page keeps its h1.
  const opening = arranged?.sections[0]
  if (opening && !opening.blocks.some((block) => block.kind === 'heading')) {
    const first = opening.blocks.find((block) => block.from.some((n) => lineOf(n)?.block.kind === 'heading'))
    if (first && !AI_LAYOUT_ARRANGE_ITEM_KINDS.has(first.kind) && first.kind !== 'list') first.kind = 'heading'
  }
  const roots = sections.map((section, index) => {
    const own = section.lines.map(lineOf)
    // The page's h1: its title, where its opening shows no heading of its own.
    const titleParts: string[] = []
    if (index === 0 && !own.some((line) => line.block.kind === 'heading') && !(arranged?.sections[0]?.blocks.some((block) => block.kind === 'heading'))) {
      titleParts.push(headingNode(scope, clean(doc.title) || section.name, 1, false))
    }
    const plan = arranged?.sections[index] ?? null
    const drawn = plan ? arrangedParts(scope, plan, index, own, lineOf, used) : { parts: copiedParts(scope, own.filter((line) => !used.has(line.n))), wide: false }
    for (const line of own) used.add(line.n)
    const band: AiLayoutArrangeBand = plan?.band ?? (index % 2 === 1 ? 'soft' : 'plain')
    const parts = [...titleParts, ...drawn.parts]
    if (!parts.length) {
      // A section whose lines could not come through (its pictures, the page's weight) keeps its place by its name.
      parts.push(headingNode(scope, section.name, 2, false))
    }
    return sectionNode(scope, index, section.name, band, parts, input.sectionIds[index] ?? `section-${index + 1}`, drawn.wide)
  })
  const rootId = tree.add('div', null, null, roots, 'page', CANVAS_ROOT_ELEMENT_ID)
  for (const root of roots) tree.prune(root)
  const sourceWords = lines.reduce((total, line) => total + (line.block.kind === 'image' ? 0 : wordsIn(aiSiteImportLineText(line))), 0)
  return { tree: { rootId, nodes: tree.nodes }, placed: scope.placed, lines: lines.length, words: scope.words, sourceWords, cut: scope.cut }
}

/*------------------------------------------
 * What the arrangement is shown
 *-----------------------------------------*/

/** The most characters of a page's numbered lines an arrangement prompt shows. */
export const AI_SITE_IMPORT_ARRANGE_MAX_CHARS = 60_000

const LINE_KIND: Record<SiteImportBlock['kind'], string> = {
  heading: 'heading',
  paragraph: 'text',
  'list-item': 'list item',
  quote: 'quote',
  link: 'link',
  image: 'picture',
}

/** The page's lines as the arrangement reads them: each section, its numbered lines and their kinds. */
export function aiSiteImportArrangeText(doc: Pick<AiSiteImportDocument, 'blocks' | 'title'>): string {
  const { lines, sections } = aiSiteImportDocLines(doc.blocks, doc.title)
  return sections
    .map((section, index) =>
      [
        `Section ${index + 1}: ${section.name}`,
        ...section.lines.map((n) => {
          const line = lines[n - 1]
          const kind = line.block.kind === 'heading' ? `heading ${line.block.level}` : LINE_KIND[line.block.kind]
          return `[${n}] (${kind}) ${aiSiteImportLineText(line) || '(no description)'}`
        }),
      ].join('\n'),
    )
    .join('\n\n')
}
