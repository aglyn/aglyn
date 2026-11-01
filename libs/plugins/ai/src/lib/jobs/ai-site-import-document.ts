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
 * A PAGE BROUGHT IN WORD FOR WORD (AGL-4084, AGL-4107).
 *
 * An imported page is never rewritten. Its words are the source's, as the
 * crawler read them (`AiSiteImportPageRead.blocks`), and how the source lays
 * them out is the reader's (`AiSiteImportPageRead.layout`, AGL-4106). This
 * module is the page as its job carries it: its blocks, its layout, its
 * photos and where its links go, read defensively off the job's inputs.
 *
 * - **Lines.** The page's main region, numbered: every heading, paragraph,
 *   list item, quote, link and picture in source order. A link inside a
 *   sentence is in its sentence already and is no line of its own.
 * - **Sections.** Where a read kept no layout (one made before the reader,
 *   or one past its budget), one for the page's opening and one at each
 *   second-level heading, as the source divides itself.
 *
 * The page is drawn by the site compiler (`ai-site-import-compile.ts`), with
 * every line on it exactly once and never a word that is not the source's.
 *=========================================*/


import {
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  AI_SITE_IMPORT_MAX_SECTIONS,
  type AiSiteImportBuild,
  type AiSiteImportPhoto,
  type SiteImportLayout,
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
  /**
   * How the source lays the page out (AGL-4106), over `blocks` by index;
   * absent on a read made before the reader, or one past its budget.
   */
  layout?: SiteImportLayout | null
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
 * the section before, marked `cut`.
 */
export const AI_SITE_IMPORT_DOC_MAX_NODES = 1_400
export const AI_SITE_IMPORT_DOC_MAX_CHARS = 200_000

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

/** How many words a line says: its runs of letters and digits, as the review counts them. */
export const aiSiteImportWordsIn = (text: string): number => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

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
    ...(isLayout(value['layout']) ? { layout: value['layout'] } : {}),
  }
}

/** Whether a value is a layout as the reader writes one: its sections, icons and look. */
function isLayout(value: unknown): value is SiteImportLayout {
  if (!value || typeof value !== 'object') return false
  const layout = value as Record<string, unknown>
  return (
    layout['v'] === 1 &&
    Array.isArray(layout['sections']) &&
    (layout['sections'] as unknown[]).every((section) => !!section && typeof section === 'object' && Array.isArray((section as Record<string, unknown>)['nodes'])) &&
    Array.isArray(layout['icons'])
  )
}

/*------------------------------------------
 * Words in parts a text element holds
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
