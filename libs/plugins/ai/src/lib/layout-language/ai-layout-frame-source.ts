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
 * A HEADER AND FOOTER BROUGHT IN AS THE SOURCE BUILDS THEM (AGL-4108).
 *
 * On 10/29 an imported header was the wave's page titles, seven of them cut
 * to 28 characters, wrapping onto two and three lines from 900 px up, with
 * no menus, its logo over "Home" at 1280 and its "Start free" sent to the
 * Forms page. The source's own header was five items, two of them menus,
 * and two buttons that leave for the app.
 *
 * So a site brought in from elsewhere is given its source's header and
 * footer as the reader found them (`site-import-nav.ts`), and they are drawn
 * here by code, with no model:
 *
 * - **The menu.** Each top-level item as the source has it: a link, or a
 *   menu of its entries — the Besigner's Mega Menu where its entries carry a
 *   line under them or sit in headed columns, its Dropdown Menu otherwise.
 *   Every label on one line. The row shows from the screen width it fits at
 *   (`aiLayoutNavBreakpoint`), and below it the phone menu's button.
 * - **The buttons.** The source's own, with their own addresses: an address
 *   off the site stays off it, as the source sends it. Drawn as the source
 *   draws them: filled, outlined or as text.
 * - **The panels (AGL-4139).** A mega menu's columns side by side in the
 *   source's order, each its own width, its heading, words and picture, its
 *   light or dark box, each icon in its tile, all in theme roles.
 * - **How a menu opens (AGL-4139).** As the source's: one shown on hover
 *   under a name that is a link stays that link, which a click follows, and
 *   shows its panel on hover; one whose name goes nowhere is the Dropdown or
 *   Mega Menu element opened on hover and on a click; one the source opens
 *   on a click opens on a click.
 * - **The phone menu.** Each menu as a heading over its entries, then the
 *   links, then the buttons: every part of the menu as present as the rest.
 *   A menu shown on hover opens and closes on a tap, holding every word of
 *   its panel.
 * - **The footer.** The source's columns under their headings, its words,
 *   its profiles, its address, phone and email, and its © line word for word.
 *
 * Every word is the source's, as written; nothing here is a model's.
 *=========================================*/

import { ELEMENT_HIDDEN_CLASS } from '@aglyn/aglyn/app-utils/element-hidden-style'
import { parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { nodeInteractionSelector } from '@aglyn/aglyn/app-utils/node-interactions'
import { aiIsIconPathData } from '../runtime/ai-icon-library'
import { isContactHref, isHttpsUrl, isRootRelativePath } from '../runtime/ai-node-tree'
import type { AiLayoutTreeBuilder } from './ai-layout-tree'

/** How a source's button is drawn: filled, outlined, or as text. */
export type AiLayoutFrameSourceStyle = 'primary' | 'secondary' | 'quiet'

/**
 * Where a link of a source's header or footer goes: `page:<id>` for a page of
 * the site, a path on the site (`/pricing`) for a page still to come in, or
 * the source's own address (`https:`, `mailto:`, `tel:`) for anywhere else.
 */
export type AiLayoutFrameSourceTo = string

export interface AiLayoutFrameSourceLink {
  label: string
  to: AiLayoutFrameSourceTo
}

/**
 * A theme role a source's color is drawn in (AGL-4139), never the color
 * itself: a light wash, the brand's, the second color's, or the quiet text's.
 */
export type AiLayoutFrameSourceRole =
  | 'action.hover'
  | 'action.selected'
  | 'primary.main'
  | 'secondary.main'
  | 'text.secondary'
  | 'primary.contrastText'
  | 'secondary.contrastText'

/** The fill a column of a menu's panel, or a box of a footer, sits on (AGL-4139). */
export type AiLayoutFrameSourceBand = 'plain' | 'soft' | 'brand' | 'dark'

/** One entry of a menu. */
export interface AiLayoutFrameSourceEntry extends AiLayoutFrameSourceLink {
  /** The line under it in a mega menu. */
  text?: string
  /** Its icon, drawn on a 24-unit square. */
  iconPath?: string
  /** The heading of the menu's column it sits in. */
  column?: string
  /** The column of its menu's `columns` it sits in (AGL-4139). */
  at?: number
  /** The filled box its icon sits in, and the icon's color, as theme roles (AGL-4139). */
  tile?: { fill: AiLayoutFrameSourceRole; color: AiLayoutFrameSourceRole }
}

/** A column of a menu's panel as the source sets it (AGL-4139). */
export interface AiLayoutFrameSourceColumn {
  heading: string | null
  /** Its words outside its links, after its heading, as written. */
  lines: string[]
  band: AiLayoutFrameSourceBand
  /** The picture it shows, from the site's own library. */
  image?: { src: string; alt: string; ratio?: number }
  /** Its own width in CSS pixels, where the source sets one. */
  width?: number
}

/** A top-level item: a link, or a menu of entries under a name. */
export interface AiLayoutFrameSourceGroup {
  label: string
  /** Where the name itself goes; `null` when it only opens its menu. */
  to: AiLayoutFrameSourceTo | null
  /** Empty for a plain link. */
  items: AiLayoutFrameSourceEntry[]
  /** Its panel's columns side by side, in the source's order (AGL-4139). */
  columns?: AiLayoutFrameSourceColumn[]
  /** It opens on hover, as the source's does (AGL-4139). */
  hover?: boolean
  /** The width its panel's words sit in under a full-width panel: the source's cap (AGL-4139). */
  measure?: 'lg' | 'xl'
}

/** A footer's filled box (AGL-4139): its heading, words and links, and the icon beside its heading. */
export interface AiLayoutFrameSourceBox extends AiLayoutFrameSourceColumn {
  links: AiLayoutFrameSourceLink[]
  iconPath?: string
}

export interface AiLayoutFrameSourceCta extends AiLayoutFrameSourceLink {
  style: AiLayoutFrameSourceStyle
}

export interface AiLayoutFrameSourceFooter {
  columns: Array<{ heading: string; links: AiLayoutFrameSourceLink[] }>
  /** Links outside any column and not a profile (Privacy, Terms). */
  links: AiLayoutFrameSourceLink[]
  /** Its lines of words outside links, as written. */
  text: string[]
  /** Its profiles on other sites, by network. */
  social: Array<AiLayoutFrameSourceLink & { network: string }>
  address: string | null
  phone: string | null
  email: string | null
  /** Its © line, word for word. */
  copyright: string | null
  /** Its filled boxes, as the source draws them (AGL-4139). */
  panels?: AiLayoutFrameSourceBox[]
}

/**
 * What the source's header bar sits on: the page's own ground, paper, the
 * brand color, or a dark band.
 */
export type AiLayoutFrameSourceGround = 'page' | 'paper' | 'brand' | 'dark'

/** A header and footer as the source builds them (AGL-4108). */
export interface AiLayoutFrameSource {
  nav: AiLayoutFrameSourceGroup[]
  ctas: AiLayoutFrameSourceCta[]
  header: AiLayoutFrameSourceGround
  footer: AiLayoutFrameSourceFooter | null
}

/** The most kept of each part: the reader's own limits, held again on the way in. */
export const AI_LAYOUT_FRAME_SOURCE_LIMITS = { groups: 12, entries: 40, ctas: 4, columns: 12, links: 60, text: 12, social: 20, label: 120, line: 300 } as const

const SCREEN_ID = /^[A-Za-z0-9_-]{1,64}$/
const STYLES: readonly AiLayoutFrameSourceStyle[] = ['primary', 'secondary', 'quiet']
const GROUNDS: readonly AiLayoutFrameSourceGround[] = ['page', 'paper', 'brand', 'dark']
const ROLES: readonly AiLayoutFrameSourceRole[] = ['action.hover', 'action.selected', 'primary.main', 'secondary.main', 'text.secondary', 'primary.contrastText', 'secondary.contrastText']
const BANDS: readonly AiLayoutFrameSourceBand[] = ['plain', 'soft', 'brand', 'dark']
/** The most columns a panel, lines a column and boxes a footer keep (AGL-4139). */
const PANEL_LIMITS = { columns: 6, lines: 6, panels: 4 } as const

const roleOf = (value: unknown): AiLayoutFrameSourceRole | null => (ROLES.includes(value as AiLayoutFrameSourceRole) ? (value as AiLayoutFrameSourceRole) : null)

/** A column of a panel, or a box of a footer, read defensively (AGL-4139). */
function columnOf(raw: unknown): AiLayoutFrameSourceColumn | null {
  if (!isRecord(raw)) return null
  const limits = AI_LAYOUT_FRAME_SOURCE_LIMITS
  const heading = words(raw['heading'], limits.label) || null
  const lines = listOf(raw['lines'])
    .slice(0, PANEL_LIMITS.lines)
    .map((line) => words(line, limits.line))
    .filter(Boolean)
  const band = BANDS.includes(raw['band'] as AiLayoutFrameSourceBand) ? (raw['band'] as AiLayoutFrameSourceBand) : 'plain'
  const image = isRecord(raw['image']) ? raw['image'] : null
  const src = typeof image?.['src'] === 'string' ? image['src'].trim() : ''
  const ratio = typeof image?.['ratio'] === 'number' && Number.isFinite(image['ratio']) && image['ratio'] > 0.2 && image['ratio'] < 8 ? Math.round(image['ratio'] * 1000) / 1000 : null
  const width = typeof raw['width'] === 'number' && Number.isFinite(raw['width']) && raw['width'] > 2 && raw['width'] <= 600 ? Math.round(raw['width']) : null
  return {
    heading,
    lines,
    band,
    // A picture from the site's own library, never an address a model could write.
    ...(src && parseMediaRef(src) ? { image: { src, alt: words(image?.['alt'], 200), ...(ratio ? { ratio } : {}) } } : {}),
    ...(width ? { width } : {}),
  }
}

/** Whether a destination is one a link of the frame may carry. */
export function aiLayoutFrameSourceToAllowed(to: unknown): to is AiLayoutFrameSourceTo {
  if (typeof to !== 'string' || !to || to.length > 2_048) return false
  if (to.startsWith('page:')) return SCREEN_ID.test(to.slice(5))
  return isHttpsUrl(to) || isRootRelativePath(to) || isContactHref(to)
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const words = (value: unknown, max: number): string => {
  const line = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function linkOf(raw: unknown): AiLayoutFrameSourceLink | null {
  if (!isRecord(raw)) return null
  const label = words(raw['label'], AI_LAYOUT_FRAME_SOURCE_LIMITS.label)
  return label && aiLayoutFrameSourceToAllowed(raw['to']) ? { label, to: raw['to'] } : null
}

const present = <T,>(value: T | null): value is T => value !== null

/**
 * A source frame as a job carries it, read defensively: every label cut to
 * its limit, every destination one a link may carry, every icon one path.
 * `null` where it holds no menu item and no button to draw.
 */
export function aiLayoutFrameSourceOf(raw: unknown): AiLayoutFrameSource | null {
  if (!isRecord(raw)) return null
  const limits = AI_LAYOUT_FRAME_SOURCE_LIMITS
  const nav = listOf(raw['nav'])
    .slice(0, limits.groups)
    .map((group): AiLayoutFrameSourceGroup | null => {
      if (!isRecord(group)) return null
      const label = words(group['label'], limits.label)
      if (!label) return null
      const items = listOf(group['items'])
        .slice(0, limits.entries)
        .map((entry): AiLayoutFrameSourceEntry | null => {
          const link = linkOf(entry)
          if (!link || !isRecord(entry)) return null
          const text = words(entry['text'], limits.line)
          const column = words(entry['column'], limits.label)
          const at = typeof entry['at'] === 'number' && Number.isInteger(entry['at']) && entry['at'] >= 0 && entry['at'] < PANEL_LIMITS.columns ? entry['at'] : null
          const tile = isRecord(entry['tile']) ? { fill: roleOf(entry['tile']['fill']), color: roleOf(entry['tile']['color']) } : null
          return {
            ...link,
            ...(text ? { text } : {}),
            ...(aiIsIconPathData(entry['iconPath']) ? { iconPath: entry['iconPath'] } : {}),
            ...(column ? { column } : {}),
            ...(at !== null ? { at } : {}),
            ...(tile?.fill && tile.color ? { tile: { fill: tile.fill, color: tile.color } } : {}),
          }
        })
        .filter(present)
      const to = aiLayoutFrameSourceToAllowed(group['to']) ? group['to'] : null
      const columns = listOf(group['columns']).slice(0, PANEL_LIMITS.columns).map(columnOf).filter(present)
      const measure = group['measure'] === 'xl' || group['measure'] === 'lg' ? group['measure'] : null
      // A name that opens nothing and goes nowhere is no item.
      return items.length || to
        ? {
            label,
            to,
            items,
            ...(items.length && columns.length ? { columns } : {}),
            ...(items.length && group['hover'] === true ? { hover: true } : {}),
            ...(items.length && measure ? { measure } : {}),
          }
        : null
    })
    .filter(present)
  const ctas = listOf(raw['ctas'])
    .slice(0, limits.ctas)
    .map((cta): AiLayoutFrameSourceCta | null => {
      const link = linkOf(cta)
      if (!link || !isRecord(cta)) return null
      const style = STYLES.includes(cta['style'] as AiLayoutFrameSourceStyle) ? (cta['style'] as AiLayoutFrameSourceStyle) : 'primary'
      return { ...link, style }
    })
    .filter(present)
  if (!nav.length && !ctas.length) return null
  const header = GROUNDS.includes(raw['header'] as AiLayoutFrameSourceGround) ? (raw['header'] as AiLayoutFrameSourceGround) : 'paper'
  return { nav, ctas, header, footer: footerOf(raw['footer']) }
}

function footerOf(raw: unknown): AiLayoutFrameSourceFooter | null {
  if (!isRecord(raw)) return null
  const limits = AI_LAYOUT_FRAME_SOURCE_LIMITS
  const columns = listOf(raw['columns'])
    .slice(0, limits.columns)
    .map((column) => {
      if (!isRecord(column)) return null
      const heading = words(column['heading'], limits.label)
      const links = listOf(column['links']).slice(0, limits.links).map(linkOf).filter(present)
      return heading && links.length ? { heading, links } : null
    })
    .filter(present)
  const links = listOf(raw['links']).slice(0, limits.links).map(linkOf).filter(present)
  const text = listOf(raw['text'])
    .slice(0, limits.text)
    .map((line) => words(line, limits.line))
    .filter(Boolean)
  const social = listOf(raw['social'])
    .slice(0, limits.social)
    .map((entry) => {
      const link = linkOf(entry)
      const network = isRecord(entry) ? words(entry['network'], 40) : ''
      return link && network && isHttpsUrl(link.to) ? { ...link, network } : null
    })
    .filter(present)
  const fact = (key: string) => words(raw[key], limits.line) || null
  const panels = listOf(raw['panels'])
    .slice(0, PANEL_LIMITS.panels)
    .map((entry): AiLayoutFrameSourceBox | null => {
      const column = columnOf(entry)
      if (!column || !isRecord(entry)) return null
      const boxLinks = listOf(entry['links']).slice(0, limits.links).map(linkOf).filter(present)
      if (!column.heading && !column.lines.length && !boxLinks.length) return null
      return { ...column, links: boxLinks, ...(aiIsIconPathData(entry['iconPath']) ? { iconPath: entry['iconPath'] } : {}) }
    })
    .filter(present)
  const footer = {
    columns,
    links,
    text,
    social,
    address: fact('address'),
    phone: fact('phone'),
    email: fact('email'),
    copyright: fact('copyright'),
    ...(panels.length ? { panels } : {}),
  }
  const empty = !columns.length && !links.length && !text.length && !social.length && !footer.address && !footer.phone && !footer.email && !footer.copyright && !panels.length
  return empty ? null : footer
}

/** The pages a source frame links by id, each once. */
export function aiLayoutFrameSourcePageIds(source: AiLayoutFrameSource): string[] {
  const all = [
    ...source.nav.flatMap((group) => [group.to, ...group.items.map((entry) => entry.to)]),
    ...source.ctas.map((cta) => cta.to),
    ...(source.footer
      ? [
          ...source.footer.columns.flatMap((column) => column.links.map((entry) => entry.to)),
          ...source.footer.links.map((entry) => entry.to),
          ...(source.footer.panels ?? []).flatMap((box) => box.links.map((entry) => entry.to)),
        ]
      : []),
  ]
  return [...new Set(all.filter((to): to is string => typeof to === 'string' && to.startsWith('page:')).map((to) => to.slice('page:'.length)))]
}

/** A link's props for where it goes: a page by its id, anywhere else by its address. */
export function aiLayoutFrameSourceLinkProps(to: AiLayoutFrameSourceTo): Record<string, unknown> {
  return to.startsWith('page:') ? { screenId: to.slice('page:'.length) } : { href: to }
}

/*------------------------------------------
 * Where the menu row fits
 *-----------------------------------------*/

/**
 * The widths the header row is held to, in CSS pixels: a character of a
 * label at the body size, the chevron a menu's trigger carries, the gap
 * between the row's items and between its buttons, a button's padding, and
 * the row's room at each breakpoint (the Container's `lg` width less its
 * gutters).
 */
export const AI_LAYOUT_HEADER_MEASURE = {
  char: 9,
  chevron: 28,
  gap: 24,
  buttonGap: 8,
  padding: { primary: 32, secondary: 32, quiet: 16 },
  room: { md: 900 - 48, lg: 1200 - 48 },
  /** What share of the room the row may fill: the estimate is a character's average, so it keeps a margin. */
  fill: 0.9,
  /** A logo's width where its picture's shape is unknown. */
  logo: 160,
} as const

/** The header row's width in CSS pixels, its brand, its menu and its buttons side by side. */
export function aiLayoutHeaderRowWidth(input: {
  brandWidth: number
  nav: ReadonlyArray<{ label: string; menu: boolean }>
  ctas: ReadonlyArray<{ label: string; style: AiLayoutFrameSourceStyle }>
}): number {
  const measure = AI_LAYOUT_HEADER_MEASURE
  const navWidth = input.nav.reduce((sum, item) => sum + item.label.length * measure.char + (item.menu ? measure.chevron : 0), 0) + Math.max(0, input.nav.length - 1) * measure.gap
  const ctaWidth = input.ctas.reduce((sum, cta) => sum + cta.label.length * measure.char + measure.padding[cta.style], 0) + Math.max(0, input.ctas.length - 1) * measure.buttonGap
  const parts = [input.brandWidth, navWidth, ctaWidth].filter((width) => width > 0)
  return parts.reduce((sum, width) => sum + width, 0) + Math.max(0, parts.length - 1) * measure.gap
}

/**
 * The screen width the menu row shows from (AGL-4108): `md` where it fits a
 * 900-pixel screen with room to spare, else `lg`; and `lg` whatever it
 * measures for a row of more than five items or more than 60 characters.
 * Below it the row is the phone menu's button.
 */
export function aiLayoutNavBreakpoint(input: Parameters<typeof aiLayoutHeaderRowWidth>[0]): 'md' | 'lg' {
  const chars = input.nav.reduce((sum, item) => sum + item.label.length, 0)
  if (input.nav.length > 5 || chars > 60) return 'lg'
  const measure = AI_LAYOUT_HEADER_MEASURE
  return aiLayoutHeaderRowWidth(input) <= measure.room.md * measure.fill ? 'md' : 'lg'
}

/** A source's header row as `aiLayoutHeaderRowWidth` measures it. */
export function aiLayoutFrameSourceRow(source: Pick<AiLayoutFrameSource, 'nav' | 'ctas'>, brandWidth: number): Parameters<typeof aiLayoutHeaderRowWidth>[0] {
  return {
    brandWidth,
    nav: source.nav.map((group) => ({ label: group.label, menu: group.items.length > 0 })),
    ctas: source.ctas.map((cta) => ({ label: cta.label, style: cta.style })),
  }
}

/*------------------------------------------
 * The header
 *-----------------------------------------*/

const VARIANT: Record<AiLayoutFrameSourceStyle, string> = { primary: 'contained', secondary: 'outlined', quiet: 'text' }

/** A column of a menu: its heading, where its entries have one, and its entries. */
interface MenuColumn {
  heading: string | null
  entries: AiLayoutFrameSourceEntry[]
}

/** The most entries one unheaded column of a mega menu holds before it is drawn as two. */
const COLUMN_ENTRIES = 7

/** A menu's entries in the columns the source sets them in, in order; a long unheaded run in two. */
export function aiLayoutMenuColumns(entries: readonly AiLayoutFrameSourceEntry[]): MenuColumn[] {
  const columns: MenuColumn[] = []
  for (const entry of entries) {
    const heading = entry.column ?? null
    const last = columns[columns.length - 1]
    if (last && last.heading === heading) last.entries.push(entry)
    else columns.push({ heading, entries: [entry] })
  }
  return columns.flatMap((column) => {
    if (column.heading || column.entries.length <= COLUMN_ENTRIES) return [column]
    const half = Math.ceil(column.entries.length / 2)
    return [
      { heading: null, entries: column.entries.slice(0, half) },
      { heading: null, entries: column.entries.slice(half) },
    ]
  })
}

/**
 * Whether a menu's panel is drawn in the source's own columns (AGL-4139):
 * two or more side by side, or one the source sets apart with a fill, a
 * picture or words of its own.
 */
export function aiLayoutMenuHasPanelColumns(group: Pick<AiLayoutFrameSourceGroup, 'columns'>): boolean {
  const columns = group.columns ?? []
  return columns.length >= 2 || columns.some((column) => column.band !== 'plain' || !!column.image || column.lines.length > 0)
}

/** Whether a menu is drawn as a Mega Menu: its entries carry a line under them, or sit in more than one headed column, or in the source's own columns. */
export function aiLayoutMenuIsMega(group: Pick<AiLayoutFrameSourceGroup, 'items'> & Partial<Pick<AiLayoutFrameSourceGroup, 'columns'>>): boolean {
  if (group.items.some((entry) => entry.text)) return true
  if (aiLayoutMenuHasPanelColumns(group)) return true
  return new Set(group.items.map((entry) => entry.column).filter(Boolean)).size >= 2 || group.items.length > COLUMN_ENTRIES * 2
}

/**
 * The page a menu's own name opens (AGL-4139): a page of the site, never an
 * address elsewhere (a Squarespace folder's address is no page), whether or
 * not one of its entries opens it too. `null` for a name that only opens its
 * menu.
 */
export function aiLayoutMenuNamePage(group: Pick<AiLayoutFrameSourceGroup, 'to'>): AiLayoutFrameSourceTo | null {
  const to = group.to
  return to && (to.startsWith('page:') || isRootRelativePath(to)) ? to : null
}

export interface AiLayoutSourceHeader {
  /** The menu row, shown from `breakpoint` up; `null` with no item to show. */
  nav: string | null
  /** The buttons beside it; `null` with none. */
  ctas: string | null
  /** The phone menu's contents, in order. */
  drawer: string[]
  breakpoint: 'md' | 'lg'
  /** The mega menus' panels shown on hover, under the whole bar (AGL-4139); `null` with none. */
  panels: string | null
}

/**
 * The source's header drawn (AGL-4108): its menu row, its buttons and its
 * phone menu. `close` is the interaction a link of the phone menu closes it
 * with.
 */
export function aiLayoutSourceHeader(
  tree: AiLayoutTreeBuilder,
  source: AiLayoutFrameSource,
  input: { onBrand: boolean; close: unknown[]; brandWidth: number },
): AiLayoutSourceHeader {
  const breakpoint = aiLayoutNavBreakpoint(aiLayoutFrameSourceRow(source, input.brandWidth))
  // A link's look is its parent's, which every link under it inherits: a
  // style repeated on each is one the doctrine asks be carried once.
  const link = (entry: AiLayoutFrameSourceLink, role: string, interactions?: unknown[], sx: Record<string, unknown> = {}) => {
    const id = tree.add(
      'muiScreenLink',
      { children: entry.label, ...aiLayoutFrameSourceLinkProps(entry.to), renderAs: 'link', color: 'inherit' },
      { textDecoration: 'none', ...sx },
      null,
      role,
    )
    if (interactions) tree.nodes[id].interactions = interactions
    return id
  }
  const hover = new AiLayoutHoverMenus(tree)
  const items = source.nav.map((group) => (group.items.length ? menu(tree, group, link, hover) : group.to ? link({ label: group.label, to: group.to }, 'navLink') : null))
  const nav = items.some(Boolean)
    ? tree.add(
        'muiStack',
        { component: 'nav', ariaLabel: 'Main', direction: 'row', spacing: '3', alignItems: 'center' },
        // Every label on one line, and the row never narrower than its labels.
        { display: { xs: 'none', [breakpoint]: 'flex' }, whiteSpace: 'nowrap', flexShrink: 0 },
        items,
        'nav',
      )
    : null
  const button = (cta: AiLayoutFrameSourceCta, role: string, extra: Record<string, unknown> = {}) =>
    tree.add(
      'muiButton',
      {
        children: cta.label,
        variant: VARIANT[cta.style],
        color: input.onBrand ? 'secondary' : 'primary',
        ...aiLayoutFrameSourceLinkProps(cta.to),
        ...extra,
      },
      null,
      null,
      role,
    )
  // On the smallest phones the buttons move into the menu. Their words on one line, as the row's.
  const ctas = source.ctas.length
    ? tree.add(
        'muiStack',
        { direction: 'row', spacing: '1', alignItems: 'center' },
        { display: { xs: 'none', sm: 'flex' }, flexShrink: 0, whiteSpace: 'nowrap', ml: 'auto' },
        source.ctas.map((cta) => button(cta, 'cta')),
        'ctas',
      )
    : null
  // The phone menu: each menu as a heading over its entries, its columns'
  // headings among them, the links, then the buttons.
  const drawer: string[] = []
  let links: string[] = []
  const flushLinks = () => {
    if (!links.length) return
    drawer.push(tree.add('muiStack', { spacing: '1.5' }, { typography: 'subtitle1' }, links, 'menuLinks'))
    links = []
  }
  for (const group of source.nav) {
    if (!group.items.length) {
      if (group.to) links.push(link({ label: group.label, to: group.to }, 'menuLink', input.close))
      continue
    }
    flushLinks()
    // A menu that opens on hover opens on a tap here, where there is no hover (AGL-4139).
    if (group.hover) {
      drawer.push(drawerGroup(tree, group, (entry, role) => link(entry, role, input.close)))
      continue
    }
    // The menu's name heads its entries; it links where the source's name opens a page and no entry does.
    const own = aiLayoutMenuOwnPage(group)
    const heading = own
      ? link({ label: group.label, to: own }, 'menuHeading', input.close, { typography: 'overline' })
      : tree.add('muiTypography', { children: group.label, variant: 'overline', component: 'p' }, { color: 'text.secondary' }, null, 'menuHeading')
    const entries: string[] = []
    let column: string | null = null
    for (const entry of group.items) {
      const under = entry.column ?? null
      if (under && under !== column) entries.push(tree.add('muiTypography', { children: under, variant: 'caption', component: 'p' }, { color: 'text.secondary' }, null, 'menuColumn'))
      column = under
      entries.push(link(entry, 'menuEntry', input.close))
    }
    drawer.push(tree.add('muiStack', { spacing: '1' }, { typography: 'body1' }, [heading, ...entries], 'menuGroup'))
  }
  flushLinks()
  if (source.ctas.length) {
    drawer.push(
      tree.add(
        'muiStack',
        { spacing: '1' },
        { mt: 1 },
        source.ctas.map((cta) => button(cta, 'menuCta', { fullWidth: true })),
        'menuCtas',
      ),
    )
  }
  return { nav, ctas, drawer, breakpoint, panels: hover.region(breakpoint) }
}

/**
 * The page a menu's own name opens, where none of its entries does: a page
 * of the site, never an address elsewhere (a Squarespace folder's address
 * is no page). `null` otherwise.
 */
export function aiLayoutMenuOwnPage(group: Pick<AiLayoutFrameSourceGroup, 'to' | 'items'>): AiLayoutFrameSourceTo | null {
  const to = group.to
  if (!to || !(to.startsWith('page:') || isRootRelativePath(to))) return null
  return group.items.some((entry) => entry.to === to) ? null : to
}

type LinkDraw = (entry: AiLayoutFrameSourceLink, role: string, interactions?: unknown[], sx?: Record<string, unknown>) => string

/**
 * A menu in the phone menu that opens and closes on a tap (AGL-4139): its
 * name as the Accordion's header, and under it every word of its panel —
 * each column's heading and lines, then its entries — with the page its
 * name opens first, where none of its entries opens it.
 */
function drawerGroup(tree: AiLayoutTreeBuilder, group: AiLayoutFrameSourceGroup, link: (entry: AiLayoutFrameSourceLink, role: string) => string): string {
  const caption = (words: string, role: string) => tree.add('muiTypography', { children: words, variant: 'caption', component: 'p' }, { color: 'text.secondary' }, null, role)
  const own = aiLayoutMenuOwnPage(group)
  const inside: string[] = own ? [link({ label: group.label, to: own }, 'menuOverview')] : []
  const columns = group.columns ?? []
  if (aiLayoutMenuHasPanelColumns(group)) {
    const last = columns.length - 1
    columns.forEach((column, index) => {
      if (column.heading) inside.push(caption(column.heading, 'menuColumn'))
      for (const line of column.lines) inside.push(caption(line, 'menuColumnText'))
      for (const entry of group.items) if (Math.min(entry.at ?? 0, last) === index) inside.push(link(entry, 'menuEntry'))
    })
  } else {
    let column: string | null = null
    for (const entry of group.items) {
      const under = entry.column ?? null
      if (under && under !== column) inside.push(caption(under, 'menuColumn'))
      column = under
      inside.push(link(entry, 'menuEntry'))
    }
  }
  return tree.add(
    'muiAccordion',
    { disableGutters: true },
    // One style each, so a header of many menus repeats no inline look.
    { boxShadow: 'none' },
    [
      tree.add('muiAccordionSummary', { children: group.label }, { px: 0 }, null, 'menuGroupName'),
      tree.add('muiAccordionDetails', null, { px: 0 }, [tree.add('muiStack', { spacing: '1' }, { typography: 'body1' }, inside, 'menuGroupEntries')], 'menuGroupPanel'),
    ],
    'menuGroup',
  )
}

/**
 * A top-level item with entries: the Mega Menu, its entries in the source's
 * columns, each with its icon and the line under it; or the Dropdown Menu.
 * Where the item's own name goes somewhere none of its entries does, the menu
 * opens with that link, so the page the source's name opens stays reachable.
 */
function menu(tree: AiLayoutTreeBuilder, group: AiLayoutFrameSourceGroup, link: LinkDraw, hover: AiLayoutHoverMenus): string {
  // A menu the source opens on hover under a name that opens a page of its
  // own (AGL-4139): the name stays that link, and its panel shows on hover,
  // as the source builds it and as this platform's own site does.
  const named = group.hover ? aiLayoutMenuNamePage(group) : null
  if (named) return hoverMenu(tree, group, link, named, hover)
  const own = aiLayoutMenuOwnPage(group)
  const overview = own ? link({ label: group.label, to: own }, 'menuOverview', undefined, { fontWeight: 700 }) : null
  // A menu with no page of its own opens on hover too, where the source's
  // does, and on a click, since its name has nowhere else to go.
  const opened = (id: string) => {
    if (group.hover) tree.nodes[id].interactions = [aiLayoutOpenMenuOnHover(id)]
    return id
  }
  if (!aiLayoutMenuIsMega(group)) {
    // Its entries' words wrap as the source's do; only the row's labels are held to one line.
    return opened(
      tree.add(
        'muiNavMenu',
        { label: group.label },
        { flexShrink: 0 },
        [tree.add('muiStack', { spacing: '1' }, { whiteSpace: 'normal' }, [overview, ...group.items.map((entry) => link(entry, 'menuItem'))], 'menuItems')],
        'navMenu',
      ),
    )
  }
  if (aiLayoutMenuHasPanelColumns(group)) {
    const panel = tree.add('muiStack', { spacing: '2' }, { whiteSpace: 'normal' }, [overview, panelColumns(tree, group, link)], 'menuPanel')
    return opened(tree.add('muiMegaMenu', { label: group.label, panelWidth: 'wide' }, { flexShrink: 0 }, [panel], 'megaMenu'))
  }
  const grid = megaGrid(tree, group, link)
  // Words in the panel wrap as the source's do; only the row's labels are held to one line.
  const panel = tree.add('muiStack', { spacing: '2' }, { whiteSpace: 'normal' }, [overview, grid], 'menuPanel')
  return opened(tree.add('muiMegaMenu', { label: group.label, panelWidth: 'wide' }, { flexShrink: 0 }, [panel], 'megaMenu'))
}

/** A mega menu's entries in a grid of the columns the source heads them in, side by side from a tablet up, three at most to a row. */
function megaGrid(tree: AiLayoutTreeBuilder, group: AiLayoutFrameSourceGroup, link: LinkDraw): string {
  const columns = aiLayoutMenuColumns(group.items)
  // Its columns side by side from a tablet up, as many to a row as the source sets, three at most.
  const span = 12 / Math.min(3, Math.max(1, columns.length))
  const cells = columns.map((column) =>
    tree.add(
      'muiGrid',
      { size: `xs:12 sm:${span}` },
      null,
      [
        tree.add(
          'muiStack',
          { spacing: '1' },
          null,
          [
            column.heading
              ? tree.add('muiTypography', { children: column.heading, variant: 'overline', component: 'p' }, { color: 'text.secondary' }, null, 'menuColumnHeading')
              : null,
            ...column.entries.map((entry) => (entry.text || entry.iconPath ? described(tree, entry) : link(entry, 'menuItem'))),
          ],
          'menuColumn',
        ),
      ],
      'menuCell',
    ),
  )
  return tree.add('muiGrid', { container: true, spacing: '2' }, null, cells, 'menuColumns')
}

/** How long a menu shown on hover stays once the pointer leaves it: the time to cross from its name to its panel. */
export const AI_LAYOUT_MENU_HOVER_GRACE_MS = 250

/**
 * The platform's own "On hover → Open menu" (AGL-4139), on a Dropdown or
 * Mega Menu element: it opens when the pointer comes to it and closes itself
 * when the pointer leaves its name and panel. A click still opens it.
 */
export function aiLayoutOpenMenuOnHover(menuId: string): Record<string, unknown> {
  return { id: 'ai-open-menu', name: 'Open the menu on hover', enabled: true, trigger: { event: 'elementHoverEnter', everyTime: true }, steps: [{ type: 'openMenu', menuNodeId: menuId }] }
}

/**
 * The menus shown on hover under names that are links (AGL-4139), wired once
 * every one is drawn: pointing at a menu's name or its panel shows it and
 * hides every other at once, leaving them hides it a moment later, and Esc
 * or a click elsewhere closes it. A mega menu's panel sits in the header
 * bar's own panel region, the width of the bar; a dropdown's under its name.
 */
export class AiLayoutHoverMenus {
  private readonly menus: Array<{ on: string[]; panel: string; wide: boolean }> = []

  constructor(private readonly tree: AiLayoutTreeBuilder) {}

  add(on: string[], panel: string, wide: boolean): void {
    this.menus.push({ on, panel, wide })
  }

  /** The panels the width of the bar, in one region under it, shown from `breakpoint` up; `null` with none. */
  region(breakpoint: 'md' | 'lg'): string | null {
    for (const menu of this.menus) {
      const own = nodeInteractionSelector(menu.panel)
      const others = this.menus.filter((other) => other !== menu).map((other) => ({ type: 'hideElement', selector: nodeInteractionSelector(other.panel) }))
      for (const id of menu.on) {
        this.tree.nodes[id].interactions = [
          { id: 'ai-show-menu', name: 'Show the menu on hover', enabled: true, trigger: { event: 'elementHoverEnter', everyTime: true }, steps: [...others, { type: 'showElement', selector: own, dismissOn: ['escape', 'outsideClick'] }] },
          { id: 'ai-hide-menu', name: 'Hide the menu when the pointer leaves', enabled: true, trigger: { event: 'elementHoverLeave', everyTime: true }, steps: [{ type: 'hideElement', selector: own, delayMs: AI_LAYOUT_MENU_HOVER_GRACE_MS }] },
        ]
      }
    }
    const wide = this.menus.filter((menu) => menu.wide).map((menu) => menu.panel)
    // Under the whole bar, whose Toolbar its place is measured from.
    return wide.length
      ? this.tree.add('muiBox', null, { position: 'absolute', top: '100%', left: 0, right: 0, display: { xs: 'none', [breakpoint]: 'block' } }, wide, 'menuPanels')
      : null
  }
}

/**
 * A menu shown on hover under a name that is a link (AGL-4139), built as the
 * source builds it and as this platform's own site does: the name, which a
 * click follows to its page, and its panel, hidden until shown. A mega
 * menu's panel holds its columns at the source's own measure, under the
 * whole bar; a dropdown's sits under its name, its links on one line each.
 */
function hoverMenu(tree: AiLayoutTreeBuilder, group: AiLayoutFrameSourceGroup, link: LinkDraw, to: AiLayoutFrameSourceTo, hover: AiLayoutHoverMenus): string {
  const name = link({ label: group.label, to }, 'menuName')
  if (aiLayoutMenuIsMega(group)) {
    const body = aiLayoutMenuHasPanelColumns(group) ? panelColumns(tree, group, link) : megaGrid(tree, group, link)
    // On paper, rounded and raised, as the source draws its panel's box.
    const card = tree.add('muiCard', { variant: 'elevation', elevation: '3' }, null, [tree.add('muiCardContent', null, null, [body], 'menuBody')], 'menuBox')
    const measure = tree.add('muiContainer', { maxWidth: group.measure ?? 'lg' }, null, [card], 'menuMeasure')
    const panel = tree.add('muiBox', { className: AI_LAYOUT_START_HIDDEN_CLASS }, null, [measure], 'menuPanel')
    hover.add([name, panel], panel, true)
    return name
  }
  // Below its name where the source's sits, as wide as its longest link.
  const card = tree.add(
    'muiCard',
    { variant: 'elevation', elevation: '3' },
    { width: 'max-content' },
    [tree.add('muiCardContent', null, null, [tree.add('muiStack', { spacing: '1' }, null, group.items.map((entry) => link(entry, 'menuItem')), 'menuItems')], 'menuBody')],
    'menuBox',
  )
  const panel = tree.add('muiBox', { className: AI_LAYOUT_START_HIDDEN_CLASS }, { position: 'absolute' }, [card], 'menuPanel')
  const wrapper = tree.add('muiBox', null, { position: 'relative' }, [name, panel], 'hoverMenu')
  hover.add([wrapper], panel, false)
  return wrapper
}

/**
 * The Besigner's "Start hidden until an interaction shows it" (AGL-4139):
 * the class the live site hides an element with from its first paint, which
 * a Show an element step takes away. Code writes it; no model ever does.
 */
export const AI_LAYOUT_START_HIDDEN_CLASS = ELEMENT_HIDDEN_CLASS

/**
 * A column's box, as the source fills it (AGL-4139): none; a light wash; the
 * brand's; or the site's own dark scheme, so every word and link in it reads
 * as it does on a dark band. A box is a Card, its corners the theme's shape.
 */
function columnBox(tree: AiLayoutTreeBuilder, band: AiLayoutFrameSourceBand, children: string[], variant: 'flat' | 'outlined' = 'flat'): string {
  const content = tree.add('muiCardContent', null, null, [tree.add('muiStack', { spacing: '0.5' }, null, children, 'menuColumnWords')], 'menuColumnContent')
  const props = variant === 'outlined' ? { variant: 'outlined' } : { variant: 'elevation', elevation: '0' }
  if (band === 'soft') return tree.add('muiCard', props, { bgcolor: 'action.hover' }, [content], 'menuColumnBox')
  if (band === 'brand') return tree.add('muiCard', props, { bgcolor: 'primary.main', color: 'primary.contrastText' }, [content], 'menuColumnBox')
  return tree.add('muiCard', props, null, [content], 'menuColumnBox')
}

/**
 * A panel's columns side by side, as the source sets them (AGL-4139): in its
 * order, each its own width or a share of the row, each with its heading,
 * its picture and its words, its entries under them, and its fill.
 */
function panelColumns(tree: AiLayoutTreeBuilder, group: AiLayoutFrameSourceGroup, link: LinkDraw): string {
  const columns = group.columns ?? []
  const last = Math.max(0, columns.length - 1)
  const cells = columns.map((column, index) => {
    const entries = group.items.filter((entry) => Math.min(entry.at ?? 0, last) === index)
    const quiet = column.band === 'brand' ? null : { color: 'text.secondary' }
    // The first short line is a title; the rest are its words, quiet.
    const [first, ...rest] = column.lines
    const titled = !!first && first.length <= 60 && !/[.!?]$/.test(first)
    const lines = [
      ...(first ? [tree.add('muiTypography', { children: first, variant: titled ? 'subtitle1' : 'body2', component: 'p' }, titled ? { fontWeight: 700 } : quiet, null, titled ? 'menuColumnTitle' : 'menuColumnText')] : []),
      ...rest.map((line) => tree.add('muiTypography', { children: line, variant: 'body2', component: 'p' }, quiet, null, 'menuColumnText')),
    ]
    const image = column.image
      ? tree.add(
          'image',
          { src: column.image.src, ...(column.image.alt ? { alt: column.image.alt } : { decorative: true }), objectFit: 'cover', loading: 'lazy' },
          { width: '100%', height: 'auto', borderRadius: 2, ...(column.image.ratio ? { aspectRatio: `${column.image.ratio}` } : {}) },
          null,
          'menuPicture',
        )
      : null
    const words = [
      column.heading ? tree.add('muiTypography', { children: column.heading, variant: 'overline', component: 'p' }, quiet, null, 'menuColumnHeading') : null,
      image,
      ...lines,
      ...entries.map((entry) => (entry.text || entry.iconPath ? described(tree, entry) : link(entry, 'menuItem'))),
    ].filter((id): id is string => !!id)
    // Its own width where the source sets one, else a share of the row.
    const flex = column.width ? `0 0 ${column.width}px` : '1 1 200px'
    if (column.band === 'plain') return tree.add('muiStack', { spacing: '0.5' }, { flex }, words, 'menuColumn')
    return tree.add('muiStack', column.band === 'dark' ? { colorScheme: 'dark' } : null, { flex }, [columnBox(tree, column.band, words)], 'menuColumn')
  })
  return tree.add('muiStack', { direction: 'row', spacing: '2', alignItems: 'stretch', useFlexGap: true, flexWrap: 'wrap' }, null, cells, 'menuColumns')
}

/** A mega menu's entry: the whole of it one link, its icon beside its name and the line under it. */
function described(tree: AiLayoutTreeBuilder, entry: AiLayoutFrameSourceEntry): string {
  // In the brand's color, as the source draws its menu's icons; in its own box where the source tiles it (AGL-4139).
  const glyph = entry.iconPath ? tree.add('icon', { iconPath: entry.iconPath, size: '24', color: entry.tile?.color ?? 'primary.main' }, null, null, 'menuIcon') : null
  // A tile is a flat Card, its corners the theme's shape, its fill a role; the icon keeps its room inside it.
  const icon =
    glyph && entry.tile
      ? tree.add('muiCard', { variant: 'elevation', elevation: '0' }, { bgcolor: entry.tile.fill }, [glyph], 'menuTile')
      : glyph
  if (glyph && entry.tile) tree.nodes[glyph].sx = { m: 0.75 }
  const name = tree.add('muiTypography', { children: entry.label, variant: 'subtitle2', component: 'p' }, { fontWeight: 600 }, null, 'menuEntryName')
  const line = entry.text ? tree.add('muiTypography', { children: entry.text, variant: 'body2', component: 'p' }, { color: 'text.secondary' }, null, 'menuEntryText') : null
  const words = tree.add('muiStack', { spacing: '0.25' }, null, [name, line], 'menuEntryWords')
  const row = tree.add('muiStack', { direction: 'row', spacing: '1.5', alignItems: 'flex-start' }, null, [icon, words], 'menuEntryRow')
  return tree.add('muiLinkBox', { ...aiLayoutFrameSourceLinkProps(entry.to), ariaLabel: entry.label }, { color: 'inherit' }, [row], 'menuEntry')
}

/*------------------------------------------
 * The footer
 *-----------------------------------------*/

/** The networks the Social Links element draws, by the reader's name for each. */
const SOCIAL_FIELDS: Readonly<Record<string, string>> = {
  x: 'twitter',
  twitter: 'twitter',
  instagram: 'instagram',
  facebook: 'facebook',
  linkedin: 'linkedin',
  youtube: 'youtube',
  github: 'github',
}

/** A phone number as a link that calls it: its digits, a `+` only first; `null` where it is no number. */
export function aiLayoutTelHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
  const href = `tel:${digits}`
  return isContactHref(href) ? href : null
}

/** The source's footer drawn (AGL-4108): its words and profiles beside its columns, its © line and other links under a rule. */
export function aiLayoutSourceFooter(
  tree: AiLayoutTreeBuilder,
  footer: AiLayoutFrameSourceFooter,
  input: { name: string },
): { top: string | null; bottom: string; sx: Record<string, unknown> } {
  // The footer's words are quiet and small, set once on the footer for every line and link under it.
  const quiet = { color: 'text.secondary' }
  const footerLink = (entry: AiLayoutFrameSourceLink, role: string) =>
    tree.add(
      'muiScreenLink',
      { children: entry.label, ...aiLayoutFrameSourceLinkProps(entry.to), renderAs: 'link', color: 'inherit' },
      { textDecoration: 'none' },
      null,
      role,
    )
  // Its words, its profiles and how to reach it, beside the columns.
  const lines = footer.text.map((line) => tree.add('muiTypography', { children: line, variant: 'body2', component: 'p' }, null, null, 'footerText'))
  const drawn: Record<string, string> = {}
  const others: AiLayoutFrameSourceLink[] = []
  for (const profile of footer.social) {
    const field = SOCIAL_FIELDS[profile.network.toLowerCase()]
    if (field && !drawn[field]) drawn[field] = profile.to
    else if (!field) others.push(profile)
  }
  const icons = Object.keys(drawn).length ? tree.add('socialLinks', drawn, { ml: -1 }, null, 'social') : null
  // A profile the Social Links element has no icon for is linked by its name, beside the icons.
  const named = others.map((profile) => footerLink(profile, 'socialLink'))
  const profiles =
    icons || named.length
      ? tree.add('muiStack', { direction: 'row', spacing: '1.5', alignItems: 'center', useFlexGap: true, flexWrap: 'wrap' }, null, [icons, ...named], 'profiles')
      : null
  const tel = footer.phone ? aiLayoutTelHref(footer.phone) : null
  const mail = footer.email ? `mailto:${footer.email}` : null
  const reach = [
    footer.address ? tree.add('muiTypography', { children: footer.address, variant: 'body2', component: 'p' }, null, null, 'address') : null,
    footer.phone && tel ? footerLink({ label: footer.phone, to: tel }, 'phone') : null,
    footer.email && mail && isContactHref(mail) ? footerLink({ label: footer.email, to: mail }, 'email') : null,
  ].filter((id): id is string => !!id)
  // Its filled boxes, under its words as the source sets them (AGL-4139): a heading with its icon, its words, its links.
  const boxes = (footer.panels ?? []).map((box) => {
    const icon = box.iconPath ? tree.add('icon', { iconPath: box.iconPath, size: '20', color: 'primary.main' }, null, null, 'footerBoxIcon') : null
    const heading = box.heading ? tree.add('muiTypography', { children: box.heading, variant: 'overline', component: 'p' }, { color: 'text.primary' }, null, 'footerBoxHeading') : null
    const words = [
      icon || heading ? tree.add('muiStack', { direction: 'row', spacing: '1', alignItems: 'center' }, null, [icon, heading], 'footerBoxTitle') : null,
      ...box.lines.map((line) => tree.add('muiTypography', { children: line, variant: 'body2', component: 'p' }, null, null, 'footerBoxText')),
      ...box.links.map((entry) => footerLink(entry, 'footerBoxLink')),
    ].filter((id): id is string => !!id)
    // Ruled, as the source draws it; in the site's dark scheme where the source's is a dark box on a light footer.
    const card = columnBox(tree, box.band, words, 'outlined')
    return box.band === 'dark' ? tree.add('muiStack', { colorScheme: 'dark' }, null, [card], 'footerBoxScheme') : card
  })
  const about = [...lines, ...boxes, profiles, ...(reach.length ? [tree.add('muiStack', { spacing: '0.5' }, null, reach, 'reach')] : [])].filter((id): id is string => !!id)
  // Its columns, each under its heading.
  const count = footer.columns.length
  const span = Math.max(2, Math.min(6, Math.floor(12 / Math.max(1, count))))
  const columns = footer.columns.map((column) =>
    tree.add(
      'muiGrid',
      { size: `xs:12 sm:4 md:${span}` },
      null,
      [
        tree.add(
          'muiStack',
          { spacing: '1' },
          null,
          [
            // A heading in the text's own color over its quiet links.
            tree.add('muiTypography', { children: column.heading, variant: 'subtitle2', component: 'p' }, { color: 'text.primary' }, null, 'footerHeading'),
            ...column.links.map((entry) => footerLink(entry, 'footerLink')),
          ],
          'footerColumn',
        ),
      ],
      'footerCell',
    ),
  )
  const grid = columns.length ? tree.add('muiGrid', { container: true, spacing: '3' }, null, columns, 'footerColumns') : null
  const aboutStack = about.length ? tree.add('muiStack', { spacing: '2' }, null, about, 'footerAbout') : null
  const top =
    aboutStack && grid
      ? tree.add(
          'muiGrid',
          { container: true, spacing: '4' },
          { alignItems: 'flex-start' },
          [tree.add('muiGrid', { size: 'xs:12 md:3' }, null, [aboutStack], 'footerAboutCell'), tree.add('muiGrid', { size: 'xs:12 md:9' }, null, [grid], 'footerColumnsCell')],
          'footerTop',
        )
      : (aboutStack ?? grid)
  // The © line word for word, and the links outside the columns beside it.
  const copyright = tree.add('muiTypography', { children: footer.copyright ?? `© ${input.name}`, variant: 'body2', component: 'p' }, null, null, 'copyright')
  const legal = footer.links.length
    ? tree.add('muiStack', { direction: 'row', spacing: '2', useFlexGap: true, flexWrap: 'wrap' }, null, footer.links.map((entry) => footerLink(entry, 'footerLegal')), 'footerLinks')
    : null
  const bottom = tree.add(
    'muiStack',
    { spacing: '2', useFlexGap: true },
    { pt: 3, borderTop: 1, borderColor: 'divider', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' } },
    [copyright, legal],
    'footerBottom',
  )
  return { top, bottom, sx: { ...quiet, typography: 'body2' } }
}
