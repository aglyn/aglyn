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
 * THE SOURCE'S MENU AND FOOTER, AS IT BUILDS THEM (AGL-4106).
 *
 * The import's header used to be the wave's page titles, seven of them, cut
 * to 28 characters, with no menus: the source's own menu was read as a flat
 * list of links and used only for their order. This reads it as the source
 * builds it, with no model:
 *
 * - **The menu** (`siteImportNavTree`). Each top-level item of the header's
 *   `<nav>` row: its link, and the panel that opens under it (a container of
 *   two or more links), each entry with its name, the line under it in a mega
 *   menu, its address, its icon and the heading of the column it sits in.
 *   The header's buttons outside the row ("Sign in", "Start free") with their
 *   addresses and how they are drawn; whether the source shows a menu button
 *   on phones; the header bar's background.
 * - **The footer** (`siteImportFooterColumns`). Each column: its heading and
 *   its links. Its profiles on other sites, its other links, its lines of
 *   text, its address, phone and email (from its structured data where the
 *   footer prints none), and its © line word for word.
 *
 * Every label is the source's, as written. Untrusted data: it is drawn by the
 * frame compiler as words, and fenced wherever a prompt reads it.
 *=========================================*/

import {
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  type SiteImportButtonStyle,
  type SiteImportFooter,
  type SiteImportFooterLink,
  type SiteImportNavCta,
  type SiteImportNavEntry,
  type SiteImportNavGroup,
  type SiteImportNavTree,
} from '../model/ai-site-import'
import { siteImportBackgroundOf, siteImportCssOf, siteImportHex, siteImportStylesOf, type SiteImportStyles } from './site-import-css'
import type { SiteImportAnchor, SiteImportElement, SiteImportExtract, SiteImportStructure } from './site-import-html'
import { siteImportButtonStyleOf } from './site-import-layout'

/** A page as the menu reader takes it: its structure, its blocks and its structured data. */
export type SiteImportFrameSource = Pick<SiteImportExtract, 'blocks' | 'organization'> & { structure: SiteImportStructure }

/** The most top-level items, entries per menu and footer links kept. */
export const SITE_IMPORT_NAV_LIMITS = { items: 12, entries: 40, footerLinks: 160 } as const

const PHONE_MENU = /\b(?:menu|navigation|nav)\b/i
const PHONE_MENU_CLASS = /hamburger|burger|menu-?toggle|nav-?toggle|mobile-?menu|navbar-toggler|menu-?button|header-menu-toggle|drawer-?toggle/i

const SOCIAL_NETWORKS: ReadonlyArray<[RegExp, string]> = [
  [/(?:^|\.)(?:twitter\.com|x\.com)$/i, 'x'],
  [/(?:^|\.)facebook\.com$/i, 'facebook'],
  [/(?:^|\.)instagram\.com$/i, 'instagram'],
  [/(?:^|\.)linkedin\.com$/i, 'linkedin'],
  [/(?:^|\.)youtube\.com$/i, 'youtube'],
  [/(?:^|\.)tiktok\.com$/i, 'tiktok'],
  [/(?:^|\.)github\.com$/i, 'github'],
  [/(?:^|\.)pinterest\.com$/i, 'pinterest'],
  [/(?:^|\.)threads\.net$/i, 'threads'],
  [/(?:^|\.)yelp\.com$/i, 'yelp'],
  [/(?:^|\.)tripadvisor\.com$/i, 'tripadvisor'],
  [/(?:^|\.)nextdoor\.com$/i, 'nextdoor'],
  [/(?:^|\.)vimeo\.com$/i, 'vimeo'],
  [/(?:^|\.)bsky\.app$/i, 'bluesky'],
  [/(?:^|\.)mastodon\.social$/i, 'mastodon'],
  [/(?:^|\.)discord\.(?:gg|com)$/i, 'discord'],
  [/(?:^|\.)whatsapp\.com$|(?:^|\.)wa\.me$/i, 'whatsapp'],
]

/** The network a profile address is on, or `null` for an address that is no profile. */
export function siteImportSocialNetwork(href: string): string | null {
  try {
    const host = new URL(href).hostname
    return SOCIAL_NETWORKS.find(([pattern]) => pattern.test(host))?.[1] ?? null
  } catch {
    return null
  }
}

const clean = (text: string, max = 300) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

class FrameReader {
  readonly elements: readonly SiteImportElement[]
  /** Each element's anchors, its subtree's, in order. */
  private readonly anchorMemo = new Map<number, SiteImportAnchor[]>()
  private readonly anchorAt = new Map<number, SiteImportAnchor>()

  constructor(
    readonly page: SiteImportFrameSource,
    readonly styles: SiteImportStyles,
  ) {
    this.elements = page.structure.elements
    for (const anchor of page.structure.anchors) this.anchorAt.set(anchor.element, anchor)
  }

  anchors(element: number): SiteImportAnchor[] {
    const held = this.anchorMemo.get(element)
    if (held) return held
    const node = this.elements[element]
    if (!node) return []
    const own = this.anchorAt.get(element)
    const list = own ? [own] : []
    for (const child of node.children) list.push(...this.anchors(child))
    this.anchorMemo.set(element, list)
    return list
  }

  contains(ancestor: number, element: number): boolean {
    for (let at = element; at >= 0; at = this.elements[at]?.parent ?? -1) if (at === ancestor) return true
    return false
  }

  /** The words a menu holds outside its links, by element: a column's heading, a button's name. */
  texts(element: number): Array<{ element: number; text: string }> {
    const texts = this.page.structure.texts ?? []
    return texts.filter((entry) => this.contains(element, entry.element))
  }

  first(test: (node: SiteImportElement) => boolean): SiteImportElement | undefined {
    return this.elements.find(test)
  }

  background(element: number): string | null {
    for (let at = element, depth = 0; at >= 0 && depth < 4; depth += 1) {
      const color = siteImportBackgroundOf(this.styles.of(at)).color
      if (color && color.a >= 0.5) return siteImportHex(color)
      const children: number[] = (this.elements[at]?.children ?? []).filter((child) => this.anchors(child).length || this.elements[child]?.children.length)
      at = children.length === 1 ? (children[0] as number) : -1
    }
    return null
  }

  buttonStyle(element: number): SiteImportButtonStyle | null {
    const node = this.elements[element]
    if (!node) return null
    let under: string | null = null
    for (let at = node.parent; at >= 0; at = this.elements[at]?.parent ?? -1) {
      const color = siteImportBackgroundOf(this.styles.of(at)).color
      if (color && color.a >= 0.5) {
        under = siteImportHex(color)
        break
      }
    }
    return siteImportButtonStyleOf(node, this.styles.of(element), under ?? '#ffffff')
  }
}

function frameReader(page: SiteImportFrameSource, stylesheets: readonly string[]): FrameReader {
  const css = siteImportCssOf([...page.structure.styles, ...stylesheets])
  return new FrameReader(page, siteImportStylesOf(page.structure, css))
}

/**
 * The source's header menu (AGL-4106), as its home page builds it; `null`
 * for a page with no header menu the reader can find.
 */
export function siteImportNavTree(page: SiteImportFrameSource, stylesheets: readonly string[] = []): SiteImportNavTree | null {
  if (!page.structure) return null
  const reader = frameReader(page, stylesheets)
  const header =
    reader.first((node) => node.tag === 'header' && node.region === 'header') ??
    reader.first((node) => node.attrs.role === 'banner') ??
    reader.first((node) => node.tag === 'nav' && node.region !== 'footer')
  if (!header) return null
  const nav =
    reader.first((node) => node.tag === 'nav' && reader.contains(header.id, node.id) && reader.anchors(node.id).length >= 2) ??
    reader.first((node) => node.tag === 'nav' && node.region !== 'footer' && reader.anchors(node.id).length >= 2) ??
    header
  // The row: down through wrappers to the element whose children are the items.
  let row = nav.id
  for (let guard = 0; guard < 32; guard += 1) {
    const children = (reader.elements[row]?.children ?? []).filter((child) => reader.anchors(child).length || reader.texts(child).length)
    if (children.length !== 1) break
    row = children[0] as number
  }
  const brand = (anchor: SiteImportAnchor) => {
    try {
      return new URL(anchor.href ?? '').pathname === '/' && (!!anchor.image || !anchor.label)
    } catch {
      return false
    }
  }
  const items: SiteImportNavGroup[] = []
  const ctas: SiteImportNavCta[] = []
  const inRow = new Set<SiteImportAnchor>()
  for (const child of reader.elements[row]?.children ?? []) {
    const anchors = reader.anchors(child).filter((anchor) => !brand(anchor) && (anchor.label || anchor.href))
    const texts = reader.texts(child)
    if (!anchors.length && !texts.length) continue
    anchors.forEach((anchor) => inRow.add(anchor))
    // A top-level link drawn as a button is a call to action, as the source draws it.
    if (anchors.length === 1 && !texts.length) {
      const anchor = anchors[0] as SiteImportAnchor
      const style = reader.buttonStyle(anchor.element)
      if (style && style !== 'quiet') {
        ctas.push({ label: clean(anchor.label, AI_SITE_IMPORT_LABEL_MAX_CHARS * 2), href: anchor.href, style })
        continue
      }
    }
    // The item's name: its first link, or the words of the button that opens its menu.
    const trigger = anchors[0]
    const opener = texts.find((entry) => !trigger || entry.element < trigger.element)
    const label = clean(opener?.text ?? trigger?.label ?? '', AI_SITE_IMPORT_LABEL_MAX_CHARS * 2)
    if (!label) continue
    const entries = (opener ? anchors : anchors.slice(1)).slice(0, SITE_IMPORT_NAV_LIMITS.entries)
    items.push({
      label,
      href: opener ? null : (trigger?.href ?? null),
      items: entries.filter((anchor) => anchor.href).map((anchor) => navEntry(reader, anchor, child)),
    })
    if (items.length >= SITE_IMPORT_NAV_LIMITS.items) break
  }
  // The header's buttons outside the menu row.
  for (const anchor of reader.anchors(header.id)) {
    if (inRow.has(anchor) || brand(anchor) || !anchor.label || reader.contains(row, anchor.element)) continue
    const style = reader.buttonStyle(anchor.element)
    if (!style) continue
    if (!ctas.some((cta) => cta.label === anchor.label && cta.href === anchor.href)) ctas.push({ label: clean(anchor.label, AI_SITE_IMPORT_LABEL_MAX_CHARS * 2), href: anchor.href, style })
  }
  const phoneMenu = reader.elements.some((node) => {
    if (node.region !== 'header' && !reader.contains(header.id, node.id)) return false
    if (node.tag !== 'button' && node.attrs.role !== 'button' && node.tag !== 'summary' && node.tag !== 'a') return false
    if (node.tag === 'a' && !PHONE_MENU_CLASS.test(node.attrs.class ?? '')) return false
    return PHONE_MENU.test(node.attrs.label ?? '') || PHONE_MENU_CLASS.test(node.attrs.class ?? '') || /menu|nav|drawer/i.test(node.attrs.controls ?? '')
  })
  if (!items.length && !ctas.length) return null
  return { items, ctas, phoneMenu, background: reader.background(header.id) }
}

/** One entry of a menu, with the heading of the column it sits in. */
function navEntry(reader: FrameReader, anchor: SiteImportAnchor, item: number): SiteImportNavEntry {
  const icon = anchor.icon !== undefined ? reader.page.structure.icons[anchor.icon] : undefined
  const column = columnHeading(reader, anchor.element, item)
  return {
    label: clean(anchor.label, AI_SITE_IMPORT_LABEL_MAX_CHARS * 2),
    ...(anchor.text ? { text: clean(anchor.text) } : {}),
    href: anchor.href as string,
    ...(icon?.path ? { iconPath: icon.path, viewBox: icon.viewBox } : {}),
    ...(column ? { column } : {}),
  }
}

/**
 * The words that head the column an entry sits in: the first words, outside
 * any link, of the nearest container around the entry that has words before
 * its first link ("By team" over Agencies, Startups, Creators).
 */
function columnHeading(reader: FrameReader, element: number, item: number): string | null {
  const own = reader.texts(item).filter((entry) => !reader.anchors(item).some((anchor) => reader.contains(anchor.element, entry.element)))
  for (let at = reader.elements[element]?.parent ?? -1; at >= 0 && at !== item; at = reader.elements[at]?.parent ?? -1) {
    const first = own.find((entry) => reader.contains(at, entry.element))
    if (!first) continue
    const firstLink = reader.anchors(at)[0]
    if (firstLink && first.element > firstLink.element) return null
    return first.text.length <= AI_SITE_IMPORT_LABEL_MAX_CHARS ? clean(first.text, AI_SITE_IMPORT_LABEL_MAX_CHARS) : null
  }
  return null
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/
const ADDRESS = /\d+\s+[\p{L}\d .'-]+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|way|court|ct\.?|place|pl\.?|suite|ste\.?|highway|hwy\.?|parkway|pkwy)\b/iu

/**
 * The source's footer (AGL-4106), as its home page builds it; `null` for a
 * page with no footer.
 */
export function siteImportFooterColumns(page: SiteImportFrameSource, stylesheets: readonly string[] = []): SiteImportFooter | null {
  if (!page.structure) return null
  const reader = frameReader(page, stylesheets)
  const footers = reader.elements.filter((node) => (node.tag === 'footer' || node.attrs.role === 'contentinfo') && node.region === 'footer')
  const footer = footers.find((node) => !footers.some((other) => other !== node && reader.contains(other.id, node.id)))
  if (!footer) return null
  const { blocks, structure } = page
  // The footer's words in order: its text blocks, its menu's words, and its links.
  type Leaf = { element: number; text: string; href: string | null }
  const leaves: Leaf[] = []
  structure.blockElement.forEach((element, index) => {
    const block = blocks[index]
    if (!block || block.region !== 'footer' || block.kind === 'image' || block.kind === 'link') return
    // A line that is only its link's words is that link.
    const next = blocks[index + 1]
    if (next?.kind === 'link' && next.inline && next.text === block.text) return
    if (reader.contains(footer.id, element)) leaves.push({ element, text: clean(block.text, 1_000), href: null })
  })
  for (const entry of reader.texts(footer.id)) leaves.push({ element: entry.element, text: clean(entry.text, 1_000), href: null })
  for (const anchor of reader.anchors(footer.id)) {
    // An icon link is named by its label: a profile's network.
    const label = anchor.label || reader.elements[anchor.element]?.attrs.label || ''
    if (anchor.href && label) leaves.push({ element: anchor.element, text: clean(label), href: anchor.href })
  }
  leaves.sort((a, b) => a.element - b.element)
  const within = (element: number) => leaves.filter((leaf) => reader.contains(element, leaf.element))
  // A column: a heading, then its links, nothing else.
  const columns: SiteImportFooter['columns'] = []
  const inColumns = new Set<Leaf>()
  for (const node of reader.elements) {
    if (!reader.contains(footer.id, node.id) || node.id === footer.id) continue
    const own = within(node.id)
    const [heading, ...rest] = own
    if (!heading || heading.href || heading.text.length > AI_SITE_IMPORT_LABEL_MAX_CHARS || rest.length < 2 || rest.some((leaf) => !leaf.href)) continue
    if (own.some((leaf) => inColumns.has(leaf))) continue
    own.forEach((leaf) => inColumns.add(leaf))
    columns.push({ heading: heading.text, links: rest.slice(0, SITE_IMPORT_NAV_LIMITS.footerLinks).map((leaf) => ({ label: leaf.text, href: leaf.href as string })) })
  }
  const social: SiteImportFooter['social'] = []
  const links: SiteImportFooterLink[] = []
  const text: string[] = []
  let copyright: string | null = null
  let address: string | null = null
  let phone: string | null = null
  let email: string | null = null
  for (const leaf of leaves) {
    if (inColumns.has(leaf)) continue
    if (leaf.href) {
      const network = siteImportSocialNetwork(leaf.href)
      if (network) {
        if (!social.some((entry) => entry.href === leaf.href)) social.push({ label: leaf.text, href: leaf.href, network })
      } else if (leaf.href.startsWith('mailto:')) email ??= leaf.href.slice('mailto:'.length)
      else if (leaf.href.startsWith('tel:')) phone ??= leaf.text
      else if (!links.some((entry) => entry.href === leaf.href && entry.label === leaf.text)) links.push({ label: leaf.text, href: leaf.href })
      continue
    }
    if (!copyright && /©|\(c\)\s*\d{4}|\bcopyright\b/i.test(leaf.text)) {
      copyright = leaf.text
      continue
    }
    if (!email && EMAIL.test(leaf.text) && leaf.text.length <= 120) email = (EMAIL.exec(leaf.text) as RegExpExecArray)[0]
    else if (!phone && PHONE.test(leaf.text) && leaf.text.length <= 40) phone = leaf.text
    else if (!address && ADDRESS.test(leaf.text) && leaf.text.length <= 200) address = leaf.text
    else if (!text.includes(leaf.text)) text.push(leaf.text)
  }
  // What the footer does not print, the site's own structured data says.
  const organization = page.organization
  return {
    columns,
    social,
    links,
    text,
    address: address ?? (organization?.address || null),
    phone: phone ?? (organization?.telephone || null),
    email: email ?? (organization?.email || null),
    copyright,
  }
}
