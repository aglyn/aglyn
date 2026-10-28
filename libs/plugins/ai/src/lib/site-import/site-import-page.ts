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
 *   fence marker, no hidden character) and cut short. Every block of its
 *   main region rides along too (AGL-4083), so a page can be brought in word
 *   for word.
 *
 * And from the home page, what the site's header and footer are made of
 * (AGL-4083): its brand as the source draws it (`siteImportHeaderBrand`) and
 * its own facts (`siteImportSiteFacts`), for the header and footer the import
 * builds.
 *=========================================*/

import { neutralizeUntrustedText } from '@aglyn/shared-util-tools/untrusted-text'
import {
  AI_SITE_IMPORT_BLOCKED_STATUSES,
  AI_SITE_IMPORT_IMAGES_PER_PAGE,
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  AI_SITE_IMPORT_MAX_SECTIONS,
  AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS,
  AI_SITE_IMPORT_READ_MAX_CHARS,
  aiSiteImportCapBlocks,
  type AiSiteImportLeftOutReason,
  type AiSiteImportListedPage,
  type AiSiteImportPageRead,
} from '../model/ai-site-import'
import type { SiteImportPage, SiteImportSkipReason } from './site-import-crawl'
import type { SiteImportBlock, SiteImportOrganization } from './site-import-html'
import { siteImportLogoCandidates, type SiteImportLogoCandidate } from './site-import-images'

/** A line of untrusted text safe to show outside a fence: neutralized, one line, cut short. */
export function siteImportLabel(text: string, max = AI_SITE_IMPORT_LABEL_MAX_CHARS): string {
  const line = neutralizeUntrustedText(text).replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const wordsIn = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** How many words a page says, its title and headings included; a link inside a sentence is counted once. */
export function siteImportPageWords(page: Pick<SiteImportPage, 'title' | 'blocks'>): number {
  return page.blocks.reduce(
    (total, block) => total + (block.kind === 'image' || (block.kind === 'link' && block.inline) ? 0 : wordsIn(block.text)),
    0,
  )
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
    else if (block.kind === 'link') {
      // A link inside a sentence is in its block's words already.
      if (!block.inline) lines.push(`${where}${block.text}`)
    } else lines.push(`${where}${block.text}`)
  }
  const text = lines.join('\n')
  return text.length > AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS ? text.slice(0, AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS) : text
}

/** The page as a wave reads it: its main region's blocks whole, within the read's budget. */
export function siteImportPageRead(page: SiteImportPage, at: string): AiSiteImportPageRead {
  const main = page.blocks.filter((block) => block.region === 'main')
  const capped = aiSiteImportCapBlocks(main, AI_SITE_IMPORT_READ_MAX_CHARS)
  return {
    at,
    title: siteImportPageTitle(page),
    text: siteImportPageText(page),
    sections: siteImportPageSections(page),
    images: siteImportPageImages(page),
    blocks: capped.blocks,
    ...(capped.cut ? { cut: true } : {}),
    words: siteImportPageWords({ title: '', blocks: main }),
    forms: page.forms.kept,
  }
}

/*------------------------------------------
 * The home page's header and footer (AGL-4083)
 *-----------------------------------------*/

/**
 * How the source's header draws its brand: its logo alone (aglyn.com), its
 * logo with its name beside it, or its name alone. `text` is the name as the
 * header prints it, or the site's own name when it prints nothing at all.
 */
export interface SiteImportHeaderBrand {
  kind: 'logo-only' | 'logo-and-name' | 'name-only'
  logo: SiteImportLogoCandidate | null
  /** Whether the header prints the name as words. */
  name: boolean
  text: string
}

/** The site's own name: its head's, its structured data's, else its home page's title before a separator. */
export function siteImportSiteName(home: Pick<SiteImportPage, 'siteName' | 'organization' | 'title'>): string {
  return siteImportLabel(home.siteName || home.organization?.name || (home.title ?? '').split(TITLE_SEPARATOR).pop() || '')
}

/** Words short enough to be a name, not a sentence. */
const looksLikeName = (text: string) => text.length >= 2 && text.length <= AI_SITE_IMPORT_LABEL_MAX_CHARS && text.split(/\s+/).length <= 8

/**
 * The home page's header brand (AGL-4083), as the source shows it: the link
 * home in its header, the picture inside it, and whether words sit beside
 * the picture, inside the link or next to it. A header with no picture link
 * home is the name alone.
 */
export function siteImportHeaderBrand(
  home: Pick<SiteImportPage, 'brand' | 'images' | 'icons' | 'siteName' | 'organization' | 'title' | 'blocks'>,
): SiteImportHeaderBrand {
  const logo = siteImportLogoCandidates(home).find((candidate) => candidate.source === 'header') ?? null
  const siteName = siteImportSiteName(home)
  const linked = siteImportLabel(home.brand?.text ?? '')
  const beside = home.blocks.find(
    (block) =>
      block.region === 'header' &&
      (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'link') &&
      !!siteName &&
      block.text.trim().toLowerCase() === siteName.toLowerCase(),
  )
  const printed = looksLikeName(linked) ? linked : beside && beside.kind !== 'image' ? siteImportLabel(beside.text) : ''
  if (logo && printed) return { kind: 'logo-and-name', logo, name: true, text: printed }
  if (logo) return { kind: 'logo-only', logo, name: false, text: '' }
  return { kind: 'name-only', logo: null, name: true, text: printed || siteName }
}

/** The facts a site's header and footer carry, as the source writes them. */
export interface SiteImportSiteFacts {
  header: SiteImportBlock[]
  footer: SiteImportBlock[]
  organization: SiteImportOrganization | null
  /** Email addresses, from its structured data and its `mailto:` links. */
  emails: string[]
  /** Phone numbers as written, from its structured data and its `tel:` links. */
  phones: string[]
  /** Its profiles on other sites: its structured data's `sameAs` and its links to them. */
  social: string[]
}

const SOCIAL_HOSTS =
  /(?:^|\.)(?:twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|github\.com|pinterest\.com|threads\.net|yelp\.com|tripadvisor\.com|nextdoor\.com|vimeo\.com|bsky\.app|mastodon\.social)$/i

/**
 * The home page's own facts (AGL-4083), word for word: its header and footer
 * blocks, its Organization structured data, and the email addresses, phone
 * numbers and profiles they hold. Nothing here is invented or reworded; a
 * fact the page does not state is not here.
 */
export function siteImportSiteFacts(home: Pick<SiteImportPage, 'blocks' | 'organization'>): SiteImportSiteFacts {
  const header = home.blocks.filter((block) => block.region === 'header')
  const footer = home.blocks.filter((block) => block.region === 'footer')
  const organization = home.organization ?? null
  const emails: string[] = []
  const phones: string[] = []
  const social: string[] = []
  const add = (list: string[], value: string) => {
    const clean = value.trim()
    if (clean && !list.some((entry) => entry.toLowerCase() === clean.toLowerCase())) list.push(clean)
  }
  if (organization?.email) add(emails, organization.email.toLowerCase())
  if (organization?.telephone) add(phones, organization.telephone)
  for (const url of organization?.sameAs ?? []) add(social, url)
  for (const block of [...header, ...footer]) {
    if (block.kind !== 'link') continue
    if (block.href.startsWith('mailto:')) add(emails, block.href.slice('mailto:'.length))
    else if (block.href.startsWith('tel:')) add(phones, block.text)
    else {
      try {
        if (SOCIAL_HOSTS.test(new URL(block.href).hostname)) add(social, block.href)
      } catch {
        // A link that is not an address is no profile.
      }
    }
  }
  return { header, footer, organization, emails, phones, social }
}

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
      return status !== undefined && AI_SITE_IMPORT_BLOCKED_STATUSES.has(status) ? 'blocked' : 'unreadable'
    case 'not-reached':
      return 'not-reached'
    default:
      return 'unreadable'
  }
}
