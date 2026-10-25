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
 * ONE CRAWLED PAGE, AS AN IMPORT KEEPS IT (AGL-3976).
 *
 * The crawler's page (`SiteImportPage`) holds everything it extracted; an
 * import keeps much less, and keeps it in two shapes:
 *
 * - **Listed**, for the inventory: its address, title, how it was found and
 *   how many words and photos it has. No text: an inventory of a whole site
 *   rides the job document.
 * - **Read**, for a wave: its text in order, its sections from its headings,
 *   and its photos' addresses. The text is kept as the page says it and is
 *   fenced as untrusted data only where a prompt shows it; the section names
 *   and the title travel outside the fence, so they are neutralized (no
 *   fence marker, no hidden character) and cut short.
 *=========================================*/

import { neutralizeUntrustedText } from '@aglyn/shared-util-tools/untrusted-text'
import {
  AI_SITE_IMPORT_IMAGES_PER_PAGE,
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  AI_SITE_IMPORT_MAX_SECTIONS,
  AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS,
  type AiSiteImportLeftOutReason,
  type AiSiteImportListedPage,
  type AiSiteImportPageRead,
} from '../model/ai-site-import'
import type { SiteImportPage, SiteImportSkipReason } from './site-import-crawl'

/** A line of untrusted text safe to show outside a fence: neutralized, one line, cut short. */
export function siteImportLabel(text: string, max = AI_SITE_IMPORT_LABEL_MAX_CHARS): string {
  const line = neutralizeUntrustedText(text).replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const wordsIn = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** How many words a page says, its title and headings included. */
export function siteImportPageWords(page: Pick<SiteImportPage, 'title' | 'blocks'>): number {
  return page.blocks.reduce((total, block) => total + (block.kind === 'image' ? 0 : wordsIn(block.text)), 0)
}

/** Between a page's own name and its site's in a browser title: "About | Rosie's Bakery". */
const TITLE_SEPARATOR = /\s+[|\u2013\u2014\u00b7:-]\s+/

/**
 * A page's name on the new site: "Home" for the home page, else its browser
 * title without the old site's name after a separator ("About | Rosie's
 * Bakery" is "About"), else its first heading.
 */
export function siteImportPageTitle(page: Pick<SiteImportPage, 'path' | 'title' | 'blocks'>): string {
  if ((page.path.replace(/\/+$/, '') || '/') === '/') return 'Home'
  const own = siteImportLabel((page.title ?? '').split(TITLE_SEPARATOR)[0] ?? '')
  if (own.length >= 2) return own
  return siteImportLabel(page.blocks.find((block) => block.kind === 'heading')?.text ?? '')
}

/** The page as the inventory lists it. */
export function siteImportListedPage(page: SiteImportPage): AiSiteImportListedPage {
  return {
    url: page.url,
    path: page.path,
    title: siteImportPageTitle(page),
    foundBy: page.foundBy,
    words: siteImportPageWords(page),
    images: page.images.length,
  }
}

/** The page's photos, the ones in its body first, each once. */
export function siteImportPageImages(page: Pick<SiteImportPage, 'blocks' | 'images'>): Array<{ url: string; alt: string }> {
  const seen = new Set<string>()
  const images: Array<{ url: string; alt: string }> = []
  const add = (url: string, alt: string) => {
    if (!url || seen.has(url) || images.length >= AI_SITE_IMPORT_IMAGES_PER_PAGE) return
    seen.add(url)
    images.push({ url, alt: siteImportLabel(alt, 250) })
  }
  for (const block of page.blocks) if (block.kind === 'image' && block.region === 'main') add(block.url, block.alt)
  for (const image of page.images) add(image.url, image.alt)
  return images
}

/**
 * The page's sections, from its headings: the first is its opening (its
 * title or first heading), then one for each second-level heading of its
 * body, at most `AI_SITE_IMPORT_MAX_SECTIONS`. A page with no headings below
 * its title but more to say than an opening gets a second section for it.
 */
export function siteImportPageSections(page: Pick<SiteImportPage, 'title' | 'blocks'>): string[] {
  const main = page.blocks.filter((block) => block.region === 'main')
  const headings = main.filter((block): block is Extract<typeof block, { kind: 'heading' }> => block.kind === 'heading')
  const opening = siteImportLabel(headings.find((block) => block.level === 1)?.text || page.title || '') || 'Introduction'
  const sections = [opening]
  const seen = new Set([opening.toLowerCase()])
  for (const heading of headings) {
    if (heading.level !== 2) continue
    const name = siteImportLabel(heading.text)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    sections.push(name)
    if (sections.length >= AI_SITE_IMPORT_MAX_SECTIONS) break
  }
  if (sections.length === 1 && siteImportPageWords({ title: '', blocks: main }) > 80) sections.push('Details')
  return sections
}

/** The page's text in order, as a prompt shows it inside its fence. */
export function siteImportPageText(page: Pick<SiteImportPage, 'title' | 'description' | 'blocks'>): string {
  const lines: string[] = []
  if (page.title) lines.push(`Title: ${page.title}`)
  if (page.description) lines.push(`Description: ${page.description}`)
  for (const block of page.blocks) {
    const where = block.region === 'main' ? '' : `(${block.region}) `
    if (block.kind === 'heading') lines.push(`${'#'.repeat(block.level)} ${block.text}`)
    else if (block.kind === 'image') lines.push(`${where}[photo: ${block.alt || 'no description'}]`)
    else if (block.kind === 'list-item') lines.push(`${where}- ${block.text}`)
    else if (block.kind === 'quote') lines.push(`${where}> ${block.text}`)
    else lines.push(`${where}${block.text}`)
  }
  const text = lines.join('\n')
  return text.length > AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS ? text.slice(0, AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS) : text
}

/** The page as a wave reads it. */
export function siteImportPageRead(page: SiteImportPage, at: string): AiSiteImportPageRead {
  return {
    at,
    title: siteImportPageTitle(page),
    text: siteImportPageText(page),
    sections: siteImportPageSections(page),
    images: siteImportPageImages(page),
  }
}

/**
 * The answers bot protection and firewalls turn a crawler away with: asked to
 * sign in, refused, or told to slow down. The owner can let AglynBot through.
 */
const SITE_IMPORT_BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429])

/** Why the crawler could not read a page, as an import leaves it out; `status` is the answer an `http-error` got. */
export function siteImportLeftOutReason(reason: SiteImportSkipReason, status?: number): AiSiteImportLeftOutReason {
  switch (reason) {
    case 'login-form':
      return 'login-form'
    case 'robots':
      return 'robots'
    case 'too-large':
      return 'too-large'
    case 'off-origin-redirect':
      return 'off-site'
    case 'http-error':
      return status !== undefined && SITE_IMPORT_BLOCKED_STATUSES.has(status) ? 'blocked' : 'unreadable'
    default:
      return 'unreadable'
  }
}
