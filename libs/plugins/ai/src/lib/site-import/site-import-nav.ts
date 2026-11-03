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
 *   menu, its address, its icon and the heading of the column it sits in;
 *   and (AGL-4139) the panel's columns as the source sets them side by side,
 *   each one's heading, words, fill, picture and width, the tile behind each
 *   icon, and whether the panel opens on hover.
 *   The header's buttons outside the row ("Sign in", "Start free") with their
 *   addresses and how they are drawn; whether the source shows a menu button
 *   on phones; the header bar's background.
 * - **The footer** (`siteImportFooterColumns`). Each column: its heading and
 *   its links. Its profiles on other sites, its other links, its lines of
 *   text, its address, phone and email (from its structured data where the
 *   footer prints none), and its © line word for word; whether it opens with
 *   the logo, and its filled boxes (AGL-4139).
 *
 * Every label is the source's, as written. Untrusted data: it is drawn by the
 * frame compiler as words, and fenced wherever a prompt reads it.
 *=========================================*/

import {
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  type SiteImportBand,
  type SiteImportButtonStyle,
  type SiteImportFooter,
  type SiteImportFooterLink,
  type SiteImportNavColumn,
  type SiteImportNavCta,
  type SiteImportNavEntry,
  type SiteImportNavGroup,
  type SiteImportNavTree,
} from '../model/ai-site-import'
import {
  SITE_IMPORT_CSS_WIDE_WIDTH,
  siteImportBackgroundOf,
  siteImportColorOf,
  siteImportCssOf,
  siteImportGridColumns,
  siteImportHex,
  siteImportLengthPx,
  siteImportRadiusPx,
  siteImportStylesOf,
  type SiteImportStyles,
} from './site-import-css'
import type { SiteImportAnchor, SiteImportElement, SiteImportExtract, SiteImportStructure } from './site-import-html'
import { siteImportBandOfColor, siteImportButtonStyleOf } from './site-import-layout'

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
    return siteImportButtonStyleOf(node, this.styles.of(element), this.ground(node.parent) ?? '#ffffff')
  }

  /** An element's own solid fill, `#rrggbb`, or `null`. */
  fill(element: number): string | null {
    const color = siteImportBackgroundOf(this.styles.of(element)).color
    return color && color.a >= 0.5 ? siteImportHex(color) : null
  }

  /** The fill an element sits on: its own, or the nearest one around it. */
  ground(element: number): string | null {
    for (let at = element; at >= 0; at = this.elements[at]?.parent ?? -1) {
      const fill = this.fill(at)
      if (fill) return fill
    }
    return null
  }

  /** Every element under one, itself first, in order. */
  under(element: number): number[] {
    const out: number[] = []
    const visit = (at: number) => {
      const node = this.elements[at]
      if (!node) return
      out.push(at)
      for (const child of node.children) visit(child)
    }
    visit(element)
    return out
  }

  /** Whether an element is inside one of the page's links. */
  inLink(element: number, within: number): boolean {
    return this.page.structure.anchors.some((anchor) => anchor.element !== within && this.contains(within, anchor.element) && this.contains(anchor.element, element))
  }

  /** The first picture an element shows outside its links. */
  picture(element: number): { url: string; alt: string } | null {
    for (const at of this.under(element)) {
      const picture = this.elements[at]?.picture
      if (picture && !this.inLink(at, element)) return picture
    }
    return null
  }

  /** Whether the source hides an element until something shows it. */
  hidden(element: number): boolean {
    const style = this.styles.of(element)
    return this.elements[element]?.attrs.hidden === true || style.get('display') === 'none' || style.get('visibility') === 'hidden'
  }

  /** Whether an element lays its children side by side: a flex row, or a grid of two columns or more. */
  sideBySide(element: number): boolean {
    const style = this.styles.of(element)
    const display = style.get('display') ?? ''
    if (/flex/.test(display)) return !/column/.test(style.get('flex-direction') ?? '')
    return /grid/.test(display) && (siteImportGridColumns(style.get('grid-template-columns'))?.length ?? 0) >= 2
  }

  /** An element's width in CSS pixels, where the source sets it in pixels. */
  widthPx(element: number, property: 'width' | 'max-width' = 'width', styles: SiteImportStyles = this.styles): number | null {
    const value = styles.of(element).get(property) ?? ''
    return /^\s*-?\d*\.?\d+\s*px\s*$/i.test(value) ? siteImportLengthPx(value) : null
  }

  /** Its icon's color as the source draws it, `#rrggbb`. */
  color(element: number): string | null {
    const color = siteImportColorOf(this.styles.of(element).get('color'))
    return color && color.a >= 0.5 ? siteImportHex(color) : null
  }
}

function frameReader(page: SiteImportFrameSource, stylesheets: readonly string[]): FrameReader & { wide: () => SiteImportStyles } {
  const sheets = [...page.structure.styles, ...stylesheets]
  const reader = new FrameReader(page, siteImportStylesOf(page.structure, siteImportCssOf(sheets)))
  // A panel's cap as a wide screen reads it: a framework's widest container sets its own only from 1,536 px up.
  let wide: SiteImportStyles | null = null
  return Object.assign(reader, { wide: () => (wide ??= siteImportStylesOf(page.structure, siteImportCssOf(sheets, SITE_IMPORT_CSS_WIDE_WIDTH))) })
}

/**
 * A box's fill against the ground it sits on, as a band: none where it is
 * the ground's own; a dark box on a dark ground, or a near-white one, is a
 * light step; else the band its color is.
 */
function boxBand(fill: string | null, ground: string | null): SiteImportBand {
  if (!fill || fill === ground) return 'plain'
  const own = siteImportColorOf(fill)
  if (!own) return 'plain'
  const band = siteImportBandOfColor(own)
  const under = ground ? siteImportColorOf(ground) : null
  if (band === 'dark' && under && siteImportBandOfColor(under) === 'dark') return 'soft'
  return band === 'plain' ? 'soft' : band
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
    const entries = (opener ? anchors : anchors.slice(1)).slice(0, SITE_IMPORT_NAV_LIMITS.entries).filter((anchor) => anchor.href)
    // Its panel as the source sets it (AGL-4139): its columns side by side, and whether it opens on hover.
    const panel = entries.length ? panelOf(reader, child, entries, opener ? opener.element : (trigger as SiteImportAnchor).element) : null
    items.push({
      label,
      href: opener ? null : (trigger?.href ?? null),
      items: entries.map((anchor) => {
        const entry = navEntry(reader, anchor, child)
        if (!panel) return entry
        const at = panel.columns.findIndex((column) => reader.contains(column, anchor.element))
        const tile = tileOf(reader, anchor)
        return { ...entry, ...(at >= 0 ? { at } : {}), ...(tile ? { tile } : {}) }
      }),
      ...(panel ? { columns: panel.columns.map((column) => panelColumn(reader, column, panel.ground)), panel: { width: panel.width, hover: panel.hover } } : {}),
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

/** A menu's panel as the reader finds it: its columns' elements, its ground, its cap and how it opens. */
interface PanelRead {
  columns: number[]
  ground: string | null
  width: number | null
  hover: boolean
}

const BUTTON_TAGS = new Set(['button', 'summary'])

/**
 * The panel a menu's entries sit in (AGL-4139): the box under the item that
 * holds them all and not its name. Its columns are the children of the
 * element that lays them side by side, in the source's order, each one that
 * holds a link, words or a picture (a rule between two holds none); a panel
 * of plain links in a row, or one stacked list, is one column. It opens on
 * hover where the source hides it until shown and its name is no button: a
 * button the source opens on a click, as a disclosure does.
 */
function panelOf(reader: FrameReader & { wide: () => SiteImportStyles }, item: number, entries: readonly SiteImportAnchor[], name: number): PanelRead | null {
  const holdsAll = (at: number) => entries.every((anchor) => reader.contains(at, anchor.element))
  let row = (entries[0] as SiteImportAnchor).element
  while (row >= 0 && row !== item && !holdsAll(row)) row = reader.elements[row]?.parent ?? -1
  if (row < 0 || row === item) return null
  // Up to the panel's own box, short of the item and of its name.
  let panel = row
  for (let up = reader.elements[panel]?.parent ?? -1; up >= 0 && up !== item && !reader.contains(up, name); up = reader.elements[up]?.parent ?? -1) panel = up
  const chain: number[] = []
  for (let at = row; at >= 0; at = reader.elements[at]?.parent ?? -1) {
    chain.push(at)
    if (at === panel) break
  }
  const holds = (at: number) => reader.anchors(at).length > 0 || reader.texts(at).length > 0 || !!reader.picture(at)
  // Down through wrappers to the element that sets its columns side by side.
  for (let guard = 0; guard < 16; guard += 1) {
    const inside = (reader.elements[row]?.children ?? []).filter(holds)
    if (inside.length !== 1) break
    row = inside[0] as number
  }
  const inside = (reader.elements[row]?.children ?? []).filter(holds)
  const plainRow = inside.every((at) => reader.anchors(at).length === 1 && !reader.texts(at).length && !reader.picture(at))
  const columns = reader.sideBySide(row) && inside.length >= 2 && !plainRow ? inside : [row]
  // A name in a button opens on a click; one in a link or plain words on hover, where the panel starts hidden.
  let button = false
  for (let at = name; at >= 0 && at !== item; at = reader.elements[at]?.parent ?? -1) {
    const node = reader.elements[at]
    if (node && (BUTTON_TAGS.has(node.tag) || node.attrs.role === 'button')) button = true
  }
  const hidden = chain.some((at) => reader.hidden(at))
  // Its cap as a wide screen reads it, on it or a wrapper down to its row.
  const wide = reader.wide()
  let width: number | null = null
  for (let at = panel; at >= 0 && width === null; ) {
    width = reader.widthPx(at, 'max-width', wide) ?? (/\bMuiContainer-maxWidthXl\b/.test(reader.elements[at]?.attrs.class ?? '') ? 1536 : null)
    if (at === row) break
    const next = (reader.elements[at]?.children ?? []).filter(holds)
    at = next.length === 1 ? (next[0] as number) : -1
  }
  return { columns, ground: reader.ground(row), width, hover: hidden && !button }
}

/** One column of a panel, or one filled box of a footer, as the source sets it (AGL-4139). */
function panelColumn(reader: FrameReader, column: number, ground: string | null): SiteImportNavColumn {
  const links = reader.anchors(column)
  const firstLink = links[0]?.element ?? Number.POSITIVE_INFINITY
  const own = reader.texts(column).filter((entry) => !reader.inLink(entry.element, column))
  const first = own[0]
  const heading = first && first.element < firstLink && first.text.length <= AI_SITE_IMPORT_LABEL_MAX_CHARS ? clean(first.text, AI_SITE_IMPORT_LABEL_MAX_CHARS) : null
  const lines = (heading ? own.slice(1) : own).map((entry) => clean(entry.text)).filter(Boolean).slice(0, 6)
  // Its fill: its own, or that of the one box it holds.
  const inside = (reader.elements[column]?.children ?? []).filter((at) => reader.anchors(at).length || reader.texts(at).length || reader.picture(at))
  const fill = reader.fill(column) ?? (inside.length === 1 ? reader.fill(inside[0] as number) : null)
  const image = reader.picture(column)
  const width = reader.widthPx(column)
  return {
    heading,
    lines,
    band: boxBand(fill, ground),
    ...(image ? { image } : {}),
    ...(width !== null && width > 2 && width <= 600 ? { width } : {}),
  }
}

/**
 * The filled box an entry's icon sits in (AGL-4139): the nearest box around
 * the icon, inside its link, that holds nothing but the icon and is filled
 * apart from what the link sits on; its corners, and the icon's own color.
 */
function tileOf(reader: FrameReader, anchor: SiteImportAnchor): SiteImportNavEntry['tile'] | null {
  if (anchor.icon === undefined) return null
  const icon = reader.under(anchor.element).find((at) => reader.elements[at]?.icon === anchor.icon)
  if (icon === undefined) return null
  const ground = reader.ground(anchor.element)
  let at = reader.elements[icon]?.parent ?? -1
  for (let depth = 0; depth < 3 && at >= 0 && at !== anchor.element; depth += 1) {
    const fill = reader.fill(at)
    const onlyIcon = reader.under(at).every((inner) => reader.contains(inner, icon) || reader.contains(icon, inner))
    const width = reader.widthPx(at)
    if (fill && fill !== ground && onlyIcon && (width === null || width <= 96)) {
      return { fill, radius: siteImportRadiusPx(reader.styles.of(at)) ?? 0, color: reader.color(icon) }
    }
    at = reader.elements[at]?.parent ?? -1
  }
  return null
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
  // Its filled boxes (AGL-4139): a box filled apart from what it sits on,
  // holding a few words and links of no column, its © line not among them.
  const panels: SiteImportNavColumn[] = []
  const inPanels = new Set<Leaf>()
  const copyrightLine = (leaf: Leaf) => !leaf.href && /©|\(c\)\s*\d{4}|\bcopyright\b/i.test(leaf.text)
  for (const node of reader.elements) {
    if (panels.length >= 4) break
    if (!reader.contains(footer.id, node.id) || node.id === footer.id) continue
    const fill = reader.fill(node.id)
    const ground = reader.ground(node.parent)
    if (!fill || fill === ground) continue
    const own = within(node.id)
    if (!own.length || own.length > 8 || !own.some((leaf) => !leaf.href) || own.some((leaf) => inColumns.has(leaf) || inPanels.has(leaf) || copyrightLine(leaf))) continue
    own.forEach((leaf) => inPanels.add(leaf))
    const words = own.filter((leaf) => !leaf.href)
    const [first] = words
    const heading = first && first.text.length <= AI_SITE_IMPORT_LABEL_MAX_CHARS && own[0] === first ? first.text : null
    const icon = reader.under(node.id).map((at) => reader.elements[at]?.icon).find((index) => index !== undefined)
    const shape = icon !== undefined ? structure.icons[icon] : undefined
    panels.push({
      heading,
      lines: (heading ? words.slice(1) : words).map((leaf) => leaf.text).slice(0, 6),
      band: boxBand(fill, ground),
      links: own.filter((leaf) => leaf.href).map((leaf) => ({ label: leaf.text, href: leaf.href as string })),
      ...(shape?.path && (shape.viewBox || '0 0 24 24') === '0 0 24 24' ? { iconPath: shape.path } : {}),
    })
  }
  // It opens with the site's logo: its first picture, before any of its words, the header's brand by its address or its name.
  const home = structure.anchors.find((anchor) => anchor.region === 'header' && !!anchor.image && /^https?:\/\/[^/]+\/?$/i.test(anchor.href ?? ''))
  const brand = home ? reader.picture(home.element) : null
  const firstPicture = reader.under(footer.id).find((at) => !!reader.elements[at]?.picture)
  const picture = firstPicture !== undefined ? reader.elements[firstPicture]?.picture : undefined
  const logo =
    firstPicture !== undefined &&
    !!picture &&
    !leaves.some((leaf) => leaf.element < firstPicture) &&
    (!!brand && (brand.url === picture.url || (!!brand.alt && brand.alt === picture.alt)))
  const social: SiteImportFooter['social'] = []
  const links: SiteImportFooterLink[] = []
  const text: string[] = []
  let copyright: string | null = null
  let address: string | null = null
  let phone: string | null = null
  let email: string | null = null
  for (const leaf of leaves) {
    if (inColumns.has(leaf) || inPanels.has(leaf)) continue
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
    ...(logo ? { logo: true } : {}),
    ...(panels.length ? { panels } : {}),
  }
}
