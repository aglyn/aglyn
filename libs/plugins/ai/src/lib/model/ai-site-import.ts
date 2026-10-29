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
 * BRING MY SITE: THE WHOLE SITE, IN REVIEWED WAVES (AGL-3976, parent AGL-3973).
 *
 * The `import` job reads a website the workspace has PROVED it owns
 * (AGL-3974's claims) and brings it in as draft pages of a new site. This
 * module is the job's plan of record, pure, so the step, the doors, the
 * console and the specs read one set of rules:
 *
 * - **The inventory.** The crawl's pages, grouped: the MAIN pages (home, the
 *   pages its menu links, every top-level page, and any page that belongs to
 *   no collection), then each COLLECTION (an address prefix holding at least
 *   `AI_SITE_IMPORT_COLLECTION_MIN` pages: `/blog/…`, `/news/…`, a dated
 *   `/2024/05/…` archive).
 * - **Never past the plan.** Pages are kept in that order until the site's
 *   room under its plan's page count is used; the rest are LEFT OUT, said so
 *   with the reason, never dropped silently. So a plan's limit always leaves
 *   out a collection's tail before it leaves out a main page.
 * - **Waves.** The kept pages are cut into waves of at most
 *   `AI_SITE_IMPORT_WAVE_PAGES`. The first wave is the main pages, with the
 *   site's header and footer built first; each later wave is one
 *   collection's next slice, so a review is about one kind of page at a
 *   time ("Blog, 1 of 3"). A wave runs, then waits for the person: nothing
 *   starts the next one but them.
 * - **The price.** An imported page is an AI page (`AI_MEASURED_IMPORT_CREDITS`,
 *   about 27 credits); a wave is quoted before it starts as its pages and,
 *   for the first, its header and footer. Once the step says how each page
 *   is built, a page copied as it is costs its listing and a page Aglyn AI
 *   arranges its arrangement, and the quote names both (AGL-4083).
 * - **Home first (AGL-4083).** The read's verdict (`aiSiteImportReadVerdict`)
 *   stops an import whose home page could not be read before anything is
 *   planned, quoted or spent: a site seen without its home page is not the
 *   site. The person is told why and checks again.
 *=========================================*/

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { SiteImportBlock, SiteImportForm } from '../site-import/site-import-html'
import { aiCreditRangeOrdered, aiCreditRangeText, AI_MEASURED_IMPORT_CREDITS, type AiCreditRange } from './ai-credit-estimate'
import type { AiJobItemLedger } from './ai-jobs.types'

/** The job kind. */
export const AI_SITE_IMPORT_KIND = 'import' as const

/** The input naming the proved domain the job brings in. */
export const AI_SITE_IMPORT_DOMAIN_INPUT = 'domain'

/** The most pages one wave brings in. */
export const AI_SITE_IMPORT_WAVE_PAGES = 10

/**
 * The most pages one import reads, whatever the plan allows: an unlimited
 * plan is still one crawl's worth, and the crawl's own time budget may stop
 * sooner (the inventory then says so). Only pages count: a file a link
 * points at is never fetched as one (AGL-4106), so aglyn.com's 209 pages fit
 * with room where 136 press-kit files once took 136 of 200.
 */
export const AI_SITE_IMPORT_MAX_PAGES = 400

/** The fewest pages under one address prefix that make it a collection. */
export const AI_SITE_IMPORT_COLLECTION_MIN = 3

/** The most photos brought in from one page. */
export const AI_SITE_IMPORT_IMAGES_PER_PAGE = 8

/**
 * The most characters of one page's text a wave keeps for the page step's
 * prompt, which reads no more than this; every word is kept on the read's
 * `blocks` (AGL-4083).
 */
export const AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS = 6_000

/** The most sections one imported page is planned with: one for every second-level heading (AGL-4083). */
export const AI_SITE_IMPORT_MAX_SECTIONS = 24

/** The most blocks of one page a wave's read keeps. */
export const AI_SITE_IMPORT_READ_MAX_BLOCKS = 2_000

/** The most characters of one page's blocks a wave's read keeps: a long policy is 40,000. */
export const AI_SITE_IMPORT_READ_MAX_CHARS = 120_000

/** The most characters one page's layout keeps on the job document (AGL-4106): its icons' drawings go first. */
export const AI_SITE_IMPORT_LAYOUT_MAX_CHARS = 48_000

/**
 * The most characters of blocks (and their layouts, AGL-4106) the reads of one import hold at once: they
 * ride the job document, which Firestore caps at 1 MiB, beside the
 * inventory and the ledger. A wave's later page past it keeps what fits and
 * says it was cut.
 */
export const AI_SITE_IMPORT_WAVE_READ_MAX_CHARS = 400_000

/**
 * A collection's page longer than this is prose: a policy, an article, a
 * long story (AGL-4083). A collection's page is copied as it is whatever its
 * length, and since AGL-4106 a main page is arranged whatever its length:
 * `/product` at 1,072 words is laid out as its source lays it out, not copied
 * as one column.
 */
export const AI_SITE_IMPORT_PROSE_WORDS = 900

/** The answers bot protection and firewalls turn a crawler away with: asked to sign in, refused, or told to slow down. */
export const AI_SITE_IMPORT_BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429])

/** The most characters a section's name, a page's title or a label keeps. */
export const AI_SITE_IMPORT_LABEL_MAX_CHARS = 60

/** A page with fewer words than this and no photo has nothing to bring in. */
export const AI_SITE_IMPORT_MIN_WORDS = 5

/** The item ledger slot of the site's header and footer. */
export const AI_SITE_IMPORT_FRAME_SLOT = 'frame'

/** The ceiling one imported page reserves: its answer pass and its listing pass, at 50 each. */
export const AI_SITE_IMPORT_PAGE_CEILING_CREDITS = 100

/** The ceiling a page copied as it is reserves: its listing pass alone. */
export const AI_SITE_IMPORT_COPIED_CEILING_CREDITS = 50

/** The ceiling the header and footer reserve: one answer at 50. */
export const AI_SITE_IMPORT_FRAME_CEILING_CREDITS = 50

/** The most left-out pages listed by address; the rest are counted. */
export const AI_SITE_IMPORT_LEFT_OUT_LISTED = 60

/** A page the crawl read, as the inventory keeps it: no text, only what plans it. */
export interface AiSiteImportListedPage {
  url: string
  path: string
  title: string
  foundBy: 'home' | 'sitemap' | 'link'
  words: number
  images: number
}

export type AiSiteImportGroupKind = 'main' | 'collection'

export interface AiSiteImportGroup {
  /** `main`, or `c:<prefix>` for a collection. */
  id: string
  label: string
  kind: AiSiteImportGroupKind
  /** Pages of the group the crawl read, kept or not. */
  pages: number
}

/** Why a page the site has is not brought in. */
export type AiSiteImportLeftOutReason =
  /** Past the site's room under its plan's page count. */
  | 'plan-limit'
  /** robots.txt keeps AglynBot off it. */
  | 'robots'
  /** A sign-in page: refused outright. */
  | 'login-form'
  /** No text and no photo: nothing to bring in. */
  | 'empty'
  /** It could not be read: an error, no answer, or not a web page. */
  | 'unreadable'
  /** The site's bot protection or firewall turned AglynBot away (401, 403 or 429). */
  | 'blocked'
  /** Over the size one page may be. */
  | 'too-large'
  /** It sends visitors to another website. */
  | 'off-site'
  /** The read stopped (its clock, its bytes, its page count) before it got to it (AGL-4083). */
  | 'not-reached'
  /** A link to a file (a download, a PDF with no extension), not a page (AGL-4106). */
  | 'file'

export const AI_SITE_IMPORT_LEFT_OUT_REASONS: readonly AiSiteImportLeftOutReason[] = [
  'plan-limit',
  'robots',
  'login-form',
  'empty',
  'unreadable',
  'blocked',
  'too-large',
  'off-site',
  'not-reached',
  'file',
]

/** The reasons that mean the page was there and AglynBot could not read it: the "could not be read" of what was found. */
export const AI_SITE_IMPORT_UNREAD_REASONS: readonly AiSiteImportLeftOutReason[] = ['unreadable', 'blocked', 'too-large', 'not-reached']

export interface AiSiteImportLeftOut {
  url: string
  path: string
  title: string
  reason: AiSiteImportLeftOutReason
}

/** A photo brought into the site's media library, as a page places it. */
export interface AiSiteImportPhoto {
  mediaId: string
  src: string
  width?: number
  height?: number
  alt?: string
  /** The address on the old site it was read from, where a page that is copied places it (AGL-4084). */
  from?: string
}

/*------------------------------------------
 * The source's layout, as the reader reads it (AGL-4106)
 *-----------------------------------------*/

/**
 * One line of a page, by its index in the page's main-region blocks
 * (`AiSiteImportPageRead.blocks`, 0-based). The layout holds no words of
 * its own: every word is a block's, placed once.
 */
export type SiteImportLineRef = number

/** A section's background, in the layout language's bands. */
export type SiteImportBand = 'plain' | 'soft' | 'brand' | 'dark'

/** How the source draws a button: filled, outlined, or as a link with button padding. */
export type SiteImportButtonStyle = 'primary' | 'secondary' | 'quiet'

/** What a repeated group of the source is. */
export type SiteImportGroupKind = 'cards' | 'steps' | 'stats' | 'faq' | 'quotes' | 'logos' | 'pricing' | 'list' | 'text'

export const SITE_IMPORT_GROUP_KINDS: readonly SiteImportGroupKind[] = ['cards', 'steps', 'stats', 'faq', 'quotes', 'logos', 'pricing', 'list', 'text']

/** One line in place. `role` only where the source's own styling says it (an uppercase eyebrow, a large lede, a small note). */
export interface SiteImportLayoutLine {
  kind: 'line'
  line: SiteImportLineRef
  role?: 'eyebrow' | 'lede' | 'note'
  /** The source draws this line (a link, or a `<button>`'s words) as a button. Its destination is the link block's `href`. */
  button?: SiteImportButtonStyle
}

/** A picture in place: an image block. */
export interface SiteImportLayoutPicture {
  kind: 'picture'
  line: SiteImportLineRef
  /** Where clicking it goes, when it sits in a link. */
  href?: string
  /** It sits in a `<button>` (a video's poster, a lightbox): the picture is kept, the button is not a destination. */
  button?: true
}

/** An icon standing on its own, by index into `SiteImportLayout.icons`. */
export interface SiteImportLayoutIcon {
  kind: 'icon'
  icon: number
}

/** Where one of the page's forms sat, by index into `AiSiteImportPageRead.forms`. */
export interface SiteImportLayoutForm {
  kind: 'form'
  form: number
}

/**
 * A row of columns side by side; `cols` are relative widths in twelfths
 * (`[4, 8]`, `[1, 1, 1]`). Every list of lists is a list of objects: the
 * layout rides a Firestore document, which holds no array inside an array.
 */
export interface SiteImportLayoutRow {
  kind: 'row'
  cols: number[]
  cells: Array<{ nodes: SiteImportLayoutNode[] }>
}

/**
 * One item of a group. Every line of the item is in `lines`, in order, and
 * in exactly one of the named parts.
 */
export interface SiteImportLayoutItem {
  lines: SiteImportLineRef[]
  /** The item's name: its heading, its title link, or its first short line. */
  title?: SiteImportLineRef
  /** A stat's figure, a step's number, a plan's price. */
  figure?: SiteImportLineRef
  text?: SiteImportLineRef[]
  /** Its bullet points (a plan's features). */
  list?: SiteImportLineRef[]
  /** Its own call to action: a "See … →" link or a button, last in the item. */
  link?: SiteImportLineRef[]
  image?: SiteImportLineRef
  /** The icon that leads it, by index into `SiteImportLayout.icons`. */
  icon?: number
  /** The icon each of its bullet points carries (a check mark), when they share one. */
  listIcon?: number
  /** Where the item goes as a whole: its title link's address. */
  to?: string
}

export interface SiteImportLayoutGroup {
  kind: 'group'
  group: SiteImportGroupKind
  /** Columns the source lays the items out in on a wide screen. */
  columns: number
  /** Each item is drawn as a box (a border, a shadow or a fill of its own). */
  boxed: boolean
  items: SiteImportLayoutItem[]
}

/** A table: rows of cells, each cell its lines (objects, not nested arrays, for Firestore). */
export interface SiteImportLayoutTable {
  kind: 'table'
  /** Whether the first row names the columns. */
  header: boolean
  rows: Array<{ cells: Array<{ lines: SiteImportLineRef[] }> }>
}

/** A tab strip and its panels; a panel the source did not draw is empty. */
export interface SiteImportLayoutTabs {
  kind: 'tabs'
  tabs: Array<{ label: SiteImportLineRef | null; selected?: true; panel: SiteImportLayoutNode[] }>
}

export type SiteImportLayoutNode =
  | SiteImportLayoutLine
  | SiteImportLayoutPicture
  | SiteImportLayoutIcon
  | SiteImportLayoutForm
  | SiteImportLayoutRow
  | SiteImportLayoutGroup
  | SiteImportLayoutTable
  | SiteImportLayoutTabs

/** Where the hero's picture sits against its words. */
export type SiteImportHeroPicture = 'beside' | 'behind' | 'below' | 'above'

export interface SiteImportLayoutSection {
  /** Its `aria-label`, its heading, or "Section n": neutralized, cut to a label. */
  name: string
  /** How its edges were found: a landmark (`<section>`), a container of its own, or its headings. */
  from: 'landmark' | 'container' | 'heading'
  band: SiteImportBand
  /** Its background color as `#rrggbb`, when it has one. */
  background: string | null
  /** A gradient or a photo behind it. */
  backdrop?: { kind: 'gradient' } | { kind: 'picture'; url: string }
  align: 'start' | 'center'
  /** Set on the section holding the page's first `<h1>`. */
  hero?: { picture: SiteImportHeroPicture | null }
  nodes: SiteImportLayoutNode[]
  /** Every line of the section, in order. */
  lines: SiteImportLineRef[]
}

/** An icon the page draws, once however often it repeats. */
export interface SiteImportIconShape {
  viewBox: string
  /** One path, for the Besigner's icon element (`iconPath`, drawn on a 24-unit square). */
  path?: string
  /** A small drawing of several shapes, geometry only, for a picture of it. */
  svg?: string
}

/** What the source's look is made of (AGL-4106), read from its stylesheets. */
export interface SiteImportLookFacts {
  fonts: {
    /** The family its body text is set in, as named, when it is not a system font. */
    body: string | null
    /** The family its headings are set in. */
    headings: string | null
    /** The families it loads from Google Fonts, in order. */
    google: string[]
  }
  /** The page's own background, `#rrggbb`. */
  background: string | null
  /** Its body text color. */
  text: string | null
  /** The fill of its filled buttons, the most used first. */
  buttonFill: string | null
  /** The text color on them. */
  buttonText: string | null
  /** Its buttons' corner radius, px. */
  buttonRadius: number | null
  /** The color its text links are drawn in. */
  link: string | null
  /** Its header bar's background. */
  header: string | null
}

/** A page's layout, as the source lays it out (AGL-4106). */
export interface SiteImportLayout {
  v: 1
  sections: SiteImportLayoutSection[]
  icons: SiteImportIconShape[]
  look: SiteImportLookFacts
}

/** One entry of a menu, as the source's header shows it. */
export interface SiteImportNavEntry {
  label: string
  /** The line under it in a mega menu. */
  text?: string
  /** Where it goes: absolute http(s), `mailto:` or `tel:`. */
  href: string
  /** Its icon, when it has a one-path icon. */
  iconPath?: string
  viewBox?: string
  /** The heading of the menu's column it sits in ("By team"). */
  column?: string
}

/** A top-level item of the source's menu: a link, or a menu of entries under a name. */
export interface SiteImportNavGroup {
  label: string
  /** Where the name itself goes; `null` when it only opens its menu. */
  href: string | null
  /** Empty for a plain link. */
  items: SiteImportNavEntry[]
}

/** A button in the source's header outside its menu ("Sign in", "Start free"). */
export interface SiteImportNavCta {
  label: string
  href: string | null
  style: SiteImportButtonStyle
}

/** The source's header menu (AGL-4106). Untrusted data from the owner's site. */
export interface SiteImportNavTree {
  items: SiteImportNavGroup[]
  ctas: SiteImportNavCta[]
  /** The source shows a menu button on phones. */
  phoneMenu: boolean
  /** The header bar's background, `#rrggbb`. */
  background: string | null
}

export interface SiteImportFooterLink {
  label: string
  href: string
}

/** The source's footer (AGL-4106): its columns, profiles and facts, as written. */
export interface SiteImportFooter {
  columns: Array<{ heading: string; links: SiteImportFooterLink[] }>
  /** Its links to profiles on other sites. */
  social: Array<SiteImportFooterLink & { network: string }>
  /** Links outside any column and not a profile (Privacy, Terms, Status). */
  links: SiteImportFooterLink[]
  /** Its lines of text outside links (a tagline), as written. */
  text: string[]
  address: string | null
  phone: string | null
  email: string | null
  /** Its © line, word for word. */
  copyright: string | null
}

/** Every line a layout's nodes place, in order. */
export function siteImportLayoutLines(nodes: readonly SiteImportLayoutNode[]): SiteImportLineRef[] {
  const out: SiteImportLineRef[] = []
  const visit = (list: readonly SiteImportLayoutNode[]) => {
    for (const node of list) {
      switch (node.kind) {
        case 'line':
        case 'picture':
          out.push(node.line)
          break
        case 'row':
          for (const cell of node.cells) visit(cell.nodes)
          break
        case 'group':
          for (const item of node.items) out.push(...item.lines)
          break
        case 'table':
          for (const row of node.rows) for (const cell of row.cells) out.push(...cell.lines)
          break
        case 'tabs':
          for (const tab of node.tabs) {
            if (tab.label !== null) out.push(tab.label)
            visit(tab.panel)
          }
          break
        default:
          break
      }
    }
  }
  visit(nodes)
  return out
}

/** How many characters a layout weighs on the job document. */
export function siteImportLayoutChars(layout: SiteImportLayout | null | undefined): number {
  return layout ? JSON.stringify(layout).length : 0
}

/**
 * A layout over only the first `count` lines (a read the wave's budget cut
 * short): references past the cut are dropped, and what is left empty goes.
 */
export function siteImportLayoutWithin(layout: SiteImportLayout, count: number): SiteImportLayout {
  const keep = (ref: SiteImportLineRef) => ref >= 0 && ref < count
  const sections = layout.sections
    .map((section) => ({ ...section, nodes: siteImportFilterNodes(section.nodes, keep), lines: section.lines.filter(keep) }))
    .filter((section) => section.lines.length)
  return { ...layout, sections }
}

/** Nodes with only the lines `keep` keeps; what is left empty goes. */
export function siteImportFilterNodes(list: readonly SiteImportLayoutNode[], keep: (ref: SiteImportLineRef) => boolean): SiteImportLayoutNode[] {
  const nodes = (list: readonly SiteImportLayoutNode[]): SiteImportLayoutNode[] =>
    list.flatMap((node): SiteImportLayoutNode[] => {
      switch (node.kind) {
        case 'line':
        case 'picture':
          return keep(node.line) ? [node] : []
        case 'icon':
        case 'form':
          return [node]
        case 'row': {
          const cells = node.cells.map((cell) => ({ nodes: nodes(cell.nodes) }))
          return cells.some((cell) => cell.nodes.length) ? [{ ...node, cells }] : []
        }
        case 'group': {
          const items = node.items
            .map((item) => trimItem(item, keep))
            .filter((item) => item.lines.length || item.icon !== undefined)
          return items.length ? [{ ...node, items }] : []
        }
        case 'table': {
          const rows = node.rows
            .map((row) => ({ cells: row.cells.map((cell) => ({ lines: cell.lines.filter(keep) })) }))
            .filter((row) => row.cells.some((cell) => cell.lines.length))
          return rows.length ? [{ ...node, rows }] : []
        }
        case 'tabs': {
          const tabs = node.tabs.map((tab) => ({ ...tab, label: tab.label !== null && keep(tab.label) ? tab.label : null, panel: nodes(tab.panel) }))
          return tabs.some((tab) => tab.label !== null || tab.panel.length) ? [{ ...node, tabs }] : []
        }
        default:
          return []
      }
    })
  return nodes(list)
}

function trimItem(item: SiteImportLayoutItem, keep: (ref: SiteImportLineRef) => boolean): SiteImportLayoutItem {
  const out: SiteImportLayoutItem = { ...item, lines: item.lines.filter(keep) }
  for (const key of ['title', 'figure', 'image'] as const) if (out[key] !== undefined && !keep(out[key] as number)) delete out[key]
  for (const key of ['text', 'list', 'link'] as const) {
    const list = out[key]?.filter(keep)
    if (list?.length) out[key] = list
    else delete out[key]
  }
  return out
}

/** A layout with its icons' drawings dropped, for a page that must be lighter. */
export function siteImportLayoutWithoutDrawings(layout: SiteImportLayout): SiteImportLayout {
  return { ...layout, icons: layout.icons.map((icon) => (icon.svg ? { viewBox: icon.viewBox } : icon)) }
}

/** What a wave's read found on one page, for its model answer. Never on the wire. */
export interface AiSiteImportPageRead {
  at: string
  title: string
  /** The page's text in order, cut to `AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS`; fenced only when a prompt reads it. */
  text: string
  /** The page's sections, from its headings. */
  sections: string[]
  /** Its photos' addresses, at most `AI_SITE_IMPORT_IMAGES_PER_PAGE`. */
  images: Array<{ url: string; alt: string }>
  /**
   * Every block of the page's main region, in order (AGL-4083): its words as
   * written, its headings, lists, links and pictures, within
   * `AI_SITE_IMPORT_READ_MAX_BLOCKS` and `AI_SITE_IMPORT_READ_MAX_CHARS`.
   * Untrusted data: fenced wherever a prompt reads it. Emptied once the page
   * is in; absent on a read made before it was kept.
   */
  blocks?: SiteImportBlock[]
  /** Set when `blocks` had to stop short of the page, at its budget or the wave's. */
  cut?: boolean
  /** The words of the page's main region, as the old page has them. */
  words?: number
  /** The forms the page asks visitors to fill in, by their fields. */
  forms?: SiteImportForm[]
  /**
   * How the source lays the page out (AGL-4106): its sections, bands, rows,
   * groups, pictures, icons and buttons, over `blocks` by index. Absent on a
   * read made before the reader, or when it did not fit the wave's budget.
   */
  layout?: SiteImportLayout | null
}

/** How a page is built from its old page, as the step chose: its words copied as they are, or arranged by Aglyn AI. */
export type AiSiteImportBuild = 'copied' | 'arranged'

export interface AiSiteImportPage {
  /** The item ledger slot: `p0`, `p1`, … */
  slot: string
  url: string
  path: string
  title: string
  group: string
  wave: number
  /** The id the page's draft is written under, minted with the inventory. */
  draftId: string
  /** The page's address on the new site. */
  slug: string
  words: number
  images: number
  /** Filled by the wave's read; the text is cleared once the page is in. */
  read?: AiSiteImportPageRead | null
  /** Set when the wave's read found the page cannot be brought in after all. */
  refused?: AiSiteImportLeftOutReason | null
  /** How the step builds the page (`aiSiteImportPageBuild`); absent until it chooses, and the page is priced as an AI page. */
  build?: AiSiteImportBuild | null
  /** What came through once the page is in: its words on the new page. */
  brought?: { words: number } | null
  /** Filled once the page's photos are in the library. */
  photos?: {
    brought: number
    /** Already in the library from an earlier page or import: the same file, never a second copy. */
    reused: number
    skipped: number
    assets: AiSiteImportPhoto[]
  } | null
}

export type AiSiteImportWaveStatus = 'waiting' | 'running' | 'review' | 'done'

export interface AiSiteImportWave {
  index: number
  label: string
  /** The group the wave brings in; the first wave's is `main`. */
  group: string
  slots: string[]
  /** Whether the wave builds the site's header and footer first. */
  frame: boolean
  status: AiSiteImportWaveStatus
  startedAt: string | null
  finishedAt: string | null
}

export interface AiSiteImportState {
  domain: string
  /** The site's name, as Create site was given it: the header's name. */
  siteName: string
  ownership: { method: string | null; provenAt: number | null; detail: string | null }
  readAt: string
  /** The plan's page count; `null` when it has none. */
  pageLimit: number | null
  /** Pages the site already had when its import read the old site. */
  existingPages: number
  /** Pages the crawl read. */
  found: number
  /** Why the crawl stopped short of the whole site, or `null` when it did not. */
  stoppedBy: string | null
  groups: AiSiteImportGroup[]
  pages: AiSiteImportPage[]
  waves: AiSiteImportWave[]
  /** At most `AI_SITE_IMPORT_LEFT_OUT_LISTED`, by address. */
  leftOut: AiSiteImportLeftOut[]
  /** Every page left out, by reason, listed or not. */
  leftOutCount: Partial<Record<AiSiteImportLeftOutReason, number>>
  /** The header and footer's draft id, built in the first wave; `null` when there are no main pages. */
  frame: { draftId: string } | null
  /** The Trust & Safety row this import is logged under. */
  reviewId: string | null
  /**
   * "Start every remaining wave" (AGL-4083): each wave closes and the next
   * starts with no review between them; the last wave's close is the stop.
   * Off unless the person chose it.
   */
  autoContinue?: boolean
  /**
   * The wave "Start every remaining wave" was chosen at (AGL-4084): the one
   * start the person made, which the day's limit counts; the waves it starts
   * after it are the same start.
   */
  autoContinueFrom?: number | null
  /** What the read found of the site as a whole; a stopping verdict plans nothing. */
  verdict?: AiSiteImportReadVerdict | null
  /** What the home page says of the site as a whole (AGL-4084): its look, its header and footer, its listing. */
  home?: AiSiteImportHome | null
  /** The look pass, once it ran in the first wave (AGL-4084). */
  look?: AiSiteImportLook | null
}

/**
 * What the home page says of the site as a whole (AGL-4084), kept from the
 * read: the site's listing in its own words, its header's brand as the
 * source draws it, and the words its header and footer carry. Untrusted
 * data from the owner's site, fenced wherever a prompt reads it.
 */
export interface AiSiteImportHome {
  url: string
  title: string
  description: string
  ogImage: string | null
  siteName: string
  brand: {
    kind: 'logo-only' | 'logo-and-name' | 'name-only'
    /** The name as the header prints it, where it prints one. */
    text: string
    logo: { url: string; alt: string; type: 'svg' | 'raster' | null } | null
  }
  facts: {
    /** The header's and footer's lines, as written, in order. */
    lines: string[]
    emails: string[]
    phones: string[]
    social: string[]
    address: string
  }
}

/** What the look pass did (AGL-4084): no model is asked. */
export interface AiSiteImportLook {
  at: string
  /** The theme: drawn from the source (`applied`), the owner's kept (`kept`), or the source's look could not be read. */
  theme: 'applied' | 'kept' | 'unread'
  /** The source's colors it was drawn from, the strongest first. */
  colors: string[]
  /** The source's logo, as the library holds it, for the header's brand. */
  logo: AiSiteImportPhoto | null
  /** Whether the site's listing was taken from the home page's own words. */
  seo: boolean
  /** The look's seed, which every page of the import is drawn with. */
  seed: number | null
  /** The look's header arrangement, band rhythm and motion, which the header, the footer and every page are drawn in. */
  style?: { headerAlign?: string; rhythm?: string; motion?: string } | null
}

/*------------------------------------------
 * The read's verdict: Home first (AGL-4083)
 *-----------------------------------------*/

/**
 * - `home-blocked`: bot protection or a firewall turned AglynBot away from
 *   the home page (401, 403 or 429).
 * - `home-unreadable`: the home page could not be read for any other reason,
 *   or read as an empty shell (a site that needs a browser to show its words).
 * - `mostly-blocked`: the home page came in, but more than half the site's
 *   addresses were turned away; the import goes on, and says so.
 * - `ok`: anything else.
 */
export type AiSiteImportReadVerdictKind = 'ok' | 'home-blocked' | 'home-unreadable' | 'mostly-blocked'

/** Why the home page did not come in. */
export type AiSiteImportHomeProblem =
  | 'blocked'
  | 'http-error'
  | 'unreachable'
  | 'not-html'
  | 'too-large'
  | 'off-site'
  | 'robots'
  | 'login-form'
  | 'not-reached'
  | 'empty'

export interface AiSiteImportReadVerdict {
  kind: AiSiteImportReadVerdictKind
  /** Addresses turned away by bot protection or a firewall, the home page among them. */
  blocked: number
  /** The site's addresses the read knew of: the sitemaps', or everything it asked for. */
  total: number
  /** What the home page answered, when it answered with an error. */
  homeStatus: number | null
  homeProblem: AiSiteImportHomeProblem | null
  /** Whose edge turned the home page away, when it said. */
  edge: 'vercel' | 'cloudflare' | null
}

/** A crawl as the verdict reads it; the crawler's `SiteImportInventory` is one. */
export interface AiSiteImportReadInput {
  pages: ReadonlyArray<{
    path: string
    foundBy: string
    blocks: ReadonlyArray<{ kind: string; text?: string; inline?: boolean }>
    images: readonly unknown[]
  }>
  skipped: ReadonlyArray<{ url: string; reason: string; status?: number; edge?: string | null }>
  sitemapUrls: number
}

const pathOfUrl = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/'
  } catch {
    return ''
  }
}

const wordsOf = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** One verdict from what became of the home page and how much of the site was turned away. */
function readVerdictOf(
  home: { problem: AiSiteImportHomeProblem; status: number | null; edge: string | null } | null,
  blocked: number,
  total: number,
): AiSiteImportReadVerdict {
  const edge: AiSiteImportReadVerdict['edge'] = home?.edge === 'vercel' ? 'vercel' : home?.edge === 'cloudflare' ? 'cloudflare' : null
  const base = { blocked, total, homeStatus: home?.status ?? null, homeProblem: home?.problem ?? null, edge }
  if (home) return { kind: home.problem === 'blocked' ? 'home-blocked' : 'home-unreadable', ...base }
  return { kind: total > 0 && blocked * 2 > total ? 'mostly-blocked' : 'ok', ...base }
}

/** What a crawler skip of the home page means for it. */
function homeProblemOfSkip(reason: string, status: number | undefined): AiSiteImportHomeProblem {
  switch (reason) {
    case 'http-error':
      return status !== undefined && AI_SITE_IMPORT_BLOCKED_STATUSES.has(status) ? 'blocked' : 'http-error'
    case 'off-origin-redirect':
      return 'off-site'
    case 'not-html':
    case 'too-large':
    case 'robots':
    case 'login-form':
    case 'not-reached':
      return reason
    default:
      return 'unreachable'
  }
}

/**
 * The read's verdict (AGL-4083), pure over the crawl: whether the home page
 * came in, and how much of the site bot protection turned away. An import
 * whose verdict stops (`aiSiteImportReadStops`) plans no wave, quotes
 * nothing and spends nothing: the person is told why and checks again.
 */
export function aiSiteImportReadVerdict(crawled: AiSiteImportReadInput): AiSiteImportReadVerdict {
  const blocked = crawled.skipped.filter(
    (entry) => entry.reason === 'http-error' && entry.status !== undefined && AI_SITE_IMPORT_BLOCKED_STATUSES.has(entry.status),
  ).length
  const total = Math.max(crawled.sitemapUrls, crawled.pages.length + crawled.skipped.length)
  const page = crawled.pages.find((entry) => entry.foundBy === 'home') ?? crawled.pages.find((entry) => (entry.path.replace(/\/+$/, '') || '/') === '/')
  if (page) {
    const words = page.blocks.reduce((sum, block) => sum + (block.kind === 'image' || block.inline ? 0 : wordsOf(block.text ?? '')), 0)
    const empty = words < AI_SITE_IMPORT_MIN_WORDS && page.images.length === 0
    return readVerdictOf(empty ? { problem: 'empty', status: null, edge: null } : null, blocked, total)
  }
  const skip = crawled.skipped.find((entry) => pathOfUrl(entry.url) === '/')
  return readVerdictOf(
    skip
      ? { problem: homeProblemOfSkip(skip.reason, skip.status), status: skip.status ?? null, edge: skip.edge ?? null }
      : { problem: 'not-reached', status: null, edge: null },
    blocked,
    total,
  )
}

/** Whether a verdict stops the import before anything is planned: its home page is not in. */
export function aiSiteImportReadStops(verdict: AiSiteImportReadVerdict | null | undefined): boolean {
  return verdict?.kind === 'home-blocked' || verdict?.kind === 'home-unreadable'
}

/** The review an import that stopped at its read waits under: `blocked` or `unreadable`; `null` when it goes on. */
export function aiSiteImportReadVerdictReason(verdict: AiSiteImportReadVerdict | null | undefined): 'blocked' | 'unreadable' | null {
  if (verdict?.kind === 'home-blocked') return 'blocked'
  if (verdict?.kind === 'home-unreadable') return 'unreadable'
  return null
}

/** Where a site owner lets AglynBot through, on the edges that name themselves. */
export const AI_SITE_IMPORT_EDGE_HINTS: Readonly<Record<'vercel' | 'cloudflare', string>> = {
  vercel: 'Your site answers through Vercel: in its Firewall, under Rules, add a bypass rule for the user agent AglynBot.',
  cloudflare:
    'Your site answers through Cloudflare: under Security, WAF, add a custom rule that skips the checks when the user agent contains AglynBot.',
}

const NOTHING_SPENT = 'Nothing was brought in and no AI credits were used.'

/** Why the home page could not be read, inside the sentence that says so. */
function homeProblemText(verdict: AiSiteImportReadVerdict): string {
  switch (verdict.homeProblem) {
    case 'http-error':
      return verdict.homeStatus ? `it answered with an error, ${verdict.homeStatus}` : 'it answered with an error'
    case 'not-html':
      return 'it did not answer with a web page'
    case 'too-large':
      return 'it is larger than a page can be to bring in'
    case 'off-site':
      return 'it sends visitors to another website'
    case 'not-reached':
      return 'the read ran out of time before it'
    default:
      return 'it did not answer'
  }
}

/**
 * What the person is told about the read (AGL-4083), in console words: why
 * nothing was brought in and what to do, or that most of the site was turned
 * away. `null` when there is nothing to say.
 */
export function aiSiteImportReadVerdictMessage(verdict: AiSiteImportReadVerdict | null | undefined, domain: string): string | null {
  if (!verdict) return null
  if (verdict.kind === 'home-blocked') {
    const others = Math.max(0, verdict.blocked - 1)
    const more = others ? `, and ${others.toLocaleString('en-US')} other ${others === 1 ? 'page' : 'pages'}` : ''
    const lead = `Your site’s bot protection or firewall turned AglynBot away before it could read your home page${more}. ${NOTHING_SPENT} Allow AglynBot in your site’s bot or firewall settings, then choose Check again.`
    return verdict.edge ? `${lead} ${AI_SITE_IMPORT_EDGE_HINTS[verdict.edge]}` : lead
  }
  if (verdict.kind === 'home-unreadable') {
    switch (verdict.homeProblem) {
      case 'robots':
        return `Your site’s robots.txt asks AglynBot not to read your home page. ${NOTHING_SPENT} Allow AglynBot in your robots.txt, then choose Check again.`
      case 'login-form':
        return `Your home page asks for a password, and pages that do are never brought in. ${NOTHING_SPENT} Open your home page to visitors, then choose Check again.`
      case 'empty':
        return `No text could be read from your home page. If your site is built in a way that needs a browser to show its words, it cannot be brought in yet. ${NOTHING_SPENT}`
      default:
        return `Your home page could not be read (${homeProblemText(verdict)}). ${NOTHING_SPENT} Check that ${domain} is up and answers at https://${domain}/, then choose Check again.`
    }
  }
  if (verdict.kind === 'mostly-blocked') {
    return `${verdict.blocked.toLocaleString('en-US')} of ${verdict.total.toLocaleString('en-US')} pages were turned away by your site’s bot protection; see Not brought in.`
  }
  return null
}

/** The verdict an inventory reads from its own pages and skips, when the step did not hand it the crawl's. */
function inventoryVerdict(input: Pick<AiSiteImportInventoryInput, 'pages' | 'skipped' | 'skippedOverflow'>): AiSiteImportReadVerdict {
  const blocked = input.skipped.filter((entry) => entry.reason === 'blocked').length
  const total = input.pages.length + input.skipped.length + Math.max(0, input.skippedOverflow ?? 0)
  const page = input.pages.find((entry) => entry.foundBy === 'home') ?? input.pages.find((entry) => (entry.path.replace(/\/+$/, '') || '/') === '/')
  if (page) {
    const empty = page.words < AI_SITE_IMPORT_MIN_WORDS && page.images === 0
    return readVerdictOf(empty ? { problem: 'empty', status: null, edge: null } : null, blocked, total)
  }
  const skip = input.skipped.find((entry) => pathOfUrl(entry.url) === '/')
  const problem: AiSiteImportHomeProblem = !skip
    ? 'not-reached'
    : skip.reason === 'blocked'
      ? 'blocked'
      : skip.reason === 'robots' || skip.reason === 'login-form' || skip.reason === 'too-large' || skip.reason === 'off-site' || skip.reason === 'not-reached' || skip.reason === 'empty'
        ? skip.reason
        : 'unreachable'
  return readVerdictOf({ problem, status: null, edge: null }, blocked, total)
}

/*------------------------------------------
 * Grouping and waves
 *-----------------------------------------*/

const clipLabel = (text: string) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > AI_SITE_IMPORT_LABEL_MAX_CHARS
    ? `${line.slice(0, AI_SITE_IMPORT_LABEL_MAX_CHARS - 1).trimEnd()}…`
    : line
}

const segmentsOf = (path: string) => String(path ?? '').split('/').filter(Boolean)

/** A collection's prefix for a page address: its first segment, a dated archive's `posts`; `null` for a top-level page. */
export function aiSiteImportPrefix(path: string): string | null {
  const segments = segmentsOf(path)
  if (segments.length < 2) return null
  const first = segments[0].toLowerCase()
  return /^\d{4}$/.test(first) ? 'posts' : first
}

/** "news-and-events" → "News and events". */
export function aiSiteImportPrefixLabel(prefix: string): string {
  const words = decodeURIComponent(prefix).replace(/[-_+]+/g, ' ').trim()
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Pages'
}

/**
 * The inventory's groups, in the order they are brought in: the main pages,
 * then each collection — one the home page's menu links first, in menu order,
 * then the larger before the smaller.
 */
export function aiSiteImportGroups(
  pages: readonly AiSiteImportListedPage[],
  menu: readonly string[] = [],
): { groups: AiSiteImportGroup[]; groupOf: (page: AiSiteImportListedPage) => string } {
  const counts = new Map<string, number>()
  for (const page of pages) {
    const prefix = aiSiteImportPrefix(page.path)
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  const menuPaths = new Set(menu.map((path) => path.replace(/\/+$/, '') || '/'))
  const collections = new Set([...counts].filter(([, count]) => count >= AI_SITE_IMPORT_COLLECTION_MIN).map(([prefix]) => prefix))
  const groupOf = (page: AiSiteImportListedPage) => {
    const path = page.path.replace(/\/+$/, '') || '/'
    if (page.foundBy === 'home' || menuPaths.has(path)) return 'main'
    const prefix = aiSiteImportPrefix(page.path)
    return prefix && collections.has(prefix) ? `c:${prefix}` : 'main'
  }
  const menuRank = (prefix: string) => {
    const index = menu.findIndex((path) => {
      const first = segmentsOf(path)[0]?.toLowerCase()
      return first === prefix
    })
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }
  const sized = new Map<string, number>()
  for (const page of pages) sized.set(groupOf(page), (sized.get(groupOf(page)) ?? 0) + 1)
  const ordered = [...collections]
    .filter((prefix) => (sized.get(`c:${prefix}`) ?? 0) > 0)
    .sort((a, b) => menuRank(a) - menuRank(b) || (sized.get(`c:${b}`) ?? 0) - (sized.get(`c:${a}`) ?? 0) || a.localeCompare(b))
  const groups: AiSiteImportGroup[] = []
  if ((sized.get('main') ?? 0) > 0) groups.push({ id: 'main', label: 'Main pages', kind: 'main', pages: sized.get('main') ?? 0 })
  for (const prefix of ordered) {
    groups.push({ id: `c:${prefix}`, label: aiSiteImportPrefixLabel(prefix), kind: 'collection', pages: sized.get(`c:${prefix}`) ?? 0 })
  }
  return { groups, groupOf }
}

/**
 * The main pages in the order a visitor meets them: home, then the menu's
 * order, then the rest as the crawl read them. A collection keeps the crawl's
 * order, which is its sitemap's.
 */
function orderedWithin(
  group: string,
  pages: readonly AiSiteImportListedPage[],
  menu: readonly string[],
): AiSiteImportListedPage[] {
  if (group !== 'main') return [...pages]
  const rank = (page: AiSiteImportListedPage) => {
    if (page.foundBy === 'home' || segmentsOf(page.path).length === 0) return -1
    const path = page.path.replace(/\/+$/, '') || '/'
    const index = menu.findIndex((entry) => (entry.replace(/\/+$/, '') || '/') === path)
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }
  return pages
    .map((page, order) => ({ page, order }))
    .sort((a, b) => rank(a.page) - rank(b.page) || a.order - b.order)
    .map(({ page }) => page)
}

/**
 * The address a page takes on the new site: one segment, as every Aglyn page
 * has, from the last segment of its old address; home is the root. Two pages
 * that would take the same address are told apart by their collection, then
 * by a number. The draft writer still makes it unique on the site itself.
 */
export function aiSiteImportSlug(path: string, taken: Set<string>): string {
  const segments = segmentsOf(path)
  if (!segments.length) {
    if (!taken.has('/')) {
      taken.add('/')
      return '/'
    }
  }
  const clean = (value: string) =>
    decodeURIComponent(value)
      .toLowerCase()
      .replace(/\.(?:html?|php|aspx?)$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  const last = clean(segments[segments.length - 1] ?? '') || 'page'
  const prefixed = segments.length > 1 ? clean(`${segments[0]}-${segments[segments.length - 1]}`) : last
  for (const candidate of [last, prefixed]) {
    if (candidate && !taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  let attempt = 2
  while (taken.has(`${last}-${attempt}`)) attempt += 1
  const slug = `${last}-${attempt}`
  taken.add(slug)
  return slug
}

export interface AiSiteImportInventoryInput {
  domain: string
  siteName: string
  ownership: AiSiteImportState['ownership']
  readAt: string
  pages: readonly AiSiteImportListedPage[]
  /** Addresses the home page's menu links, in its order. */
  menu: readonly string[]
  /** What the crawl could not read, by reason. */
  skipped: ReadonlyArray<{ url: string; reason: AiSiteImportLeftOutReason }>
  /** Skips the crawl only counted. */
  skippedOverflow?: number
  stoppedBy: string | null
  /**
   * The read's verdict from the crawl itself (`aiSiteImportReadVerdict`), with
   * the status and edge the home page answered with; read from `pages` and
   * `skipped` when absent.
   */
  verdict?: AiSiteImportReadVerdict | null
  /** The plan's page count; `null` for none. */
  pageLimit: number | null
  existingPages: number
  /** Mints one draft id; the inventory names every page's draft before any is written. */
  mintId: () => string
  reviewId?: string | null
  wavePages?: number
}

/**
 * The site's inventory cut into waves, every page left out said with its
 * reason. Pure: the step reads the site, this decides what comes in.
 */
export function aiSiteImportInventory(input: AiSiteImportInventoryInput): AiSiteImportState {
  const wavePages = Math.max(1, Math.floor(input.wavePages ?? AI_SITE_IMPORT_WAVE_PAGES))
  const limit = input.pageLimit === null || !Number.isFinite(input.pageLimit) ? null : Math.max(0, Math.floor(input.pageLimit))
  const leftOut: AiSiteImportLeftOut[] = []
  const leftOutCount: Partial<Record<AiSiteImportLeftOutReason, number>> = {}
  const leave = (entry: AiSiteImportLeftOut) => {
    leftOutCount[entry.reason] = (leftOutCount[entry.reason] ?? 0) + 1
    if (leftOut.length < AI_SITE_IMPORT_LEFT_OUT_LISTED) leftOut.push(entry)
  }
  // The read asks for a wave's worth past the plan's room, so a page its page
  // budget never reached is past the plan; any other stop is not the plan's.
  const unreached: AiSiteImportLeftOutReason = input.stoppedBy === 'page-budget' && limit !== null ? 'plan-limit' : 'not-reached'
  for (const skipped of input.skipped) {
    let path = '/'
    try {
      path = new URL(skipped.url).pathname
    } catch {
      // A malformed address keeps the root as its path.
    }
    leave({ url: skipped.url, path, title: '', reason: skipped.reason === 'not-reached' ? unreached : skipped.reason })
  }
  if (input.skippedOverflow) leftOutCount['unreadable'] = (leftOutCount['unreadable'] ?? 0) + input.skippedOverflow

  // Home first: a site read without its home page plans nothing at all.
  const verdict = input.verdict ?? inventoryVerdict(input)
  if (aiSiteImportReadStops(verdict)) {
    return {
      domain: input.domain,
      siteName: clipLabel(input.siteName) || input.domain,
      ownership: input.ownership,
      readAt: input.readAt,
      pageLimit: limit,
      existingPages: Math.max(0, input.existingPages),
      found: input.pages.length,
      stoppedBy: input.stoppedBy,
      groups: [],
      pages: [],
      waves: [],
      leftOut,
      leftOutCount,
      frame: null,
      reviewId: input.reviewId ?? null,
      verdict,
    }
  }

  const readable = input.pages.filter((page) => {
    if (page.words >= AI_SITE_IMPORT_MIN_WORDS || page.images > 0) return true
    leave({ url: page.url, path: page.path, title: clipLabel(page.title), reason: 'empty' })
    return false
  })
  const { groups, groupOf } = aiSiteImportGroups(readable, input.menu)
  let room = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - Math.max(0, input.existingPages))
  const pages: AiSiteImportPage[] = []
  const waves: AiSiteImportWave[] = []
  const taken = new Set<string>()
  for (const group of groups) {
    const members = orderedWithin(group.id, readable.filter((page) => groupOf(page) === group.id), input.menu)
    const kept: AiSiteImportListedPage[] = []
    for (const page of members) {
      if (room > 0) {
        kept.push(page)
        room -= 1
      } else {
        leave({ url: page.url, path: page.path, title: clipLabel(page.title), reason: 'plan-limit' })
      }
    }
    const parts = Math.ceil(kept.length / wavePages)
    for (let part = 0; part < parts; part += 1) {
      const index = waves.length
      const slice = kept.slice(part * wavePages, (part + 1) * wavePages)
      const slots: string[] = []
      for (const page of slice) {
        const slot = `p${pages.length}`
        slots.push(slot)
        pages.push({
          slot,
          url: page.url,
          path: page.path,
          title: clipLabel(page.title) || aiSiteImportPrefixLabel(segmentsOf(page.path).pop() ?? 'Home'),
          group: group.id,
          wave: index,
          draftId: input.mintId(),
          slug: aiSiteImportSlug(page.path, taken),
          words: page.words,
          images: page.images,
        })
      }
      waves.push({
        index,
        label: parts > 1 ? `${group.label}, ${part + 1} of ${parts}` : group.label,
        group: group.id,
        slots,
        frame: index === 0 && group.kind === 'main',
        status: 'waiting',
        startedAt: null,
        finishedAt: null,
      })
    }
  }
  return {
    domain: input.domain,
    siteName: clipLabel(input.siteName) || input.domain,
    ownership: input.ownership,
    readAt: input.readAt,
    pageLimit: limit,
    existingPages: Math.max(0, input.existingPages),
    found: input.pages.length,
    stoppedBy: input.stoppedBy,
    groups,
    pages,
    waves,
    leftOut,
    leftOutCount,
    frame: waves[0]?.frame ? { draftId: input.mintId() } : null,
    reviewId: input.reviewId ?? null,
    verdict,
  }
}

/** The item ledger an inventory starts: the header and footer, then every page, all pending. */
export function aiSiteImportLedger(state: AiSiteImportState): AiJobItemLedger[] {
  const row = (slot: string, op: string, label: string): AiJobItemLedger => ({
    slot,
    op,
    label,
    status: 'pending',
    attempt: 1,
    creditsSpent: 0,
    creditsRefunded: 0,
    outputs: [],
  })
  return [
    ...(state.frame ? [row(AI_SITE_IMPORT_FRAME_SLOT, 'layout', 'Header and footer')] : []),
    ...state.pages.map((page) => row(page.slot, 'page', page.title)),
  ]
}

/*------------------------------------------
 * What runs next
 *-----------------------------------------*/

export type AiSiteImportWork =
  | { kind: 'inventory' }
  | { kind: 'start-wave'; wave: AiSiteImportWave }
  /** Pages of the running wave its read did not reach before its clock ran out. */
  | { kind: 'read'; wave: AiSiteImportWave; pages: AiSiteImportPage[] }
  | { kind: 'frame'; wave: AiSiteImportWave }
  | { kind: 'images'; wave: AiSiteImportWave; page: AiSiteImportPage }
  | { kind: 'page'; wave: AiSiteImportWave; page: AiSiteImportPage }
  | { kind: 'close-wave'; wave: AiSiteImportWave }
  | { kind: 'done' }

const OPEN = new Set(['pending', 'running'])

/** Whether an item is still to be built. */
export function aiSiteImportItemOpen(items: readonly AiJobItemLedger[] | null | undefined, slot: string): boolean {
  const row = (items ?? []).find((entry) => entry.slot === slot)
  return Boolean(row && OPEN.has(row.status))
}

/** The wave running now, else `null`. */
export function aiSiteImportRunningWave(state: AiSiteImportState | null | undefined): AiSiteImportWave | null {
  return state?.waves.find((wave) => wave.status === 'running') ?? null
}

/** The next wave a person may start, else `null`. */
export function aiSiteImportNextWave(state: AiSiteImportState | null | undefined): AiSiteImportWave | null {
  if (!state || aiSiteImportRunningWave(state) || aiSiteImportReadStops(state.verdict)) return null
  return state.waves.find((wave) => wave.status === 'waiting') ?? null
}

/** The wave a person is reviewing, else `null`. */
export function aiSiteImportReviewWave(state: AiSiteImportState | null | undefined): AiSiteImportWave | null {
  return state?.waves.find((wave) => wave.status === 'review') ?? null
}

/** What the next pass of the step does. */
export function aiSiteImportNextWork(
  state: AiSiteImportState | null | undefined,
  items: readonly AiJobItemLedger[] | null | undefined,
): AiSiteImportWork {
  // A read that stopped at its home page reads again: the person's Check again.
  if (!state || aiSiteImportReadStops(state.verdict)) return { kind: 'inventory' }
  const running = aiSiteImportRunningWave(state)
  if (!running) {
    const next = aiSiteImportNextWave(state)
    return next ? { kind: 'start-wave', wave: next } : { kind: 'done' }
  }
  // A page the wave's read has not reached yet is read before anything is built.
  const unread = running.slots
    .map((slot) => state.pages.find((page) => page.slot === slot))
    .filter((page): page is AiSiteImportPage => !!page && !page.read && !page.refused && aiSiteImportItemOpen(items, page.slot))
  if (unread.length) return { kind: 'read', wave: running, pages: unread }
  if (running.frame && state.frame && aiSiteImportItemOpen(items, AI_SITE_IMPORT_FRAME_SLOT)) {
    return { kind: 'frame', wave: running }
  }
  for (const slot of running.slots) {
    if (!aiSiteImportItemOpen(items, slot)) continue
    const page = state.pages.find((entry) => entry.slot === slot)
    if (!page) continue
    return page.photos ? { kind: 'page', wave: running, page } : { kind: 'images', wave: running, page }
  }
  return { kind: 'close-wave', wave: running }
}

/*------------------------------------------
 * The state, one pass at a time
 *-----------------------------------------*/

const withPage = (state: AiSiteImportState, slot: string, patch: Partial<AiSiteImportPage>): AiSiteImportState => ({
  ...state,
  pages: state.pages.map((page) => (page.slot === slot ? { ...page, ...patch } : page)),
})

const withWave = (state: AiSiteImportState, index: number, patch: Partial<AiSiteImportWave>): AiSiteImportState => ({
  ...state,
  waves: state.waves.map((wave) => (wave.index === index ? { ...wave, ...patch } : wave)),
})

/** A wave started: running, with what its read found on each page. */
export function aiSiteImportWaveStarted(
  state: AiSiteImportState,
  index: number,
  at: string,
  reads: ReadonlyMap<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>,
): AiSiteImportState {
  // The wave reviewed before this one is done: starting the next is the person's say-so.
  const next = withWave(
    { ...state, waves: state.waves.map((wave) => (wave.status === 'review' ? { ...wave, status: 'done' as const } : wave)) },
    index,
    { status: 'running', startedAt: at, finishedAt: null },
  )
  return aiSiteImportPagesRead(next, reads)
}

/** How many characters a block holds, as the job document stores it. */
export function aiSiteImportBlockChars(block: SiteImportBlock): number {
  if (block.kind === 'image') return block.url.length + block.alt.length
  return block.text.length + (block.kind === 'link' ? block.href.length : 0)
}

/** A page's blocks in order, as many as fit `maxChars` and `maxBlocks`, and whether any had to go. */
export function aiSiteImportCapBlocks(
  blocks: readonly SiteImportBlock[],
  maxChars: number,
  maxBlocks: number = AI_SITE_IMPORT_READ_MAX_BLOCKS,
): { blocks: SiteImportBlock[]; chars: number; cut: boolean } {
  const kept: SiteImportBlock[] = []
  let chars = 0
  for (const block of blocks) {
    const size = aiSiteImportBlockChars(block)
    if (kept.length >= maxBlocks || chars + size > maxChars) return { blocks: kept, chars, cut: true }
    kept.push(block)
    chars += size
  }
  return { blocks: kept, chars, cut: false }
}

const readChars = (read: AiSiteImportPageRead | null | undefined) =>
  (read?.blocks ?? []).reduce((total, block) => total + aiSiteImportBlockChars(block), 0) + siteImportLayoutChars(read?.layout)

/**
 * A page's layout in the room the wave has left after its blocks (AGL-4106):
 * cut to the blocks kept, its drawings dropped when it would not fit with
 * them, and left off when it would not fit at all (the page is then laid out
 * from its lines alone).
 */
function layoutWithin(layout: SiteImportLayout | null | undefined, blocks: number, left: number): SiteImportLayout | null {
  if (!layout) return null
  const room = Math.min(left, AI_SITE_IMPORT_LAYOUT_MAX_CHARS)
  const cut = siteImportLayoutWithin(layout, blocks)
  if (siteImportLayoutChars(cut) <= room) return cut
  const light = siteImportLayoutWithoutDrawings(cut)
  return siteImportLayoutChars(light) <= room ? light : null
}

/**
 * More of a running wave's pages, read now. Their blocks share
 * `AI_SITE_IMPORT_WAVE_READ_MAX_CHARS` with every read still held: a page
 * past it keeps what fits, in order, and is marked `cut`.
 */
export function aiSiteImportPagesRead(
  state: AiSiteImportState,
  reads: ReadonlyMap<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>,
): AiSiteImportState {
  let held = state.pages.filter((page) => !reads.has(page.slot)).reduce((total, page) => total + readChars(page.read), 0)
  let next = state
  for (const [slot, read] of reads) {
    if (typeof read === 'string') {
      next = withPage(next, slot, { refused: read, read: null })
      continue
    }
    let kept = read
    if (read.blocks) {
      const room = Math.max(0, Math.min(AI_SITE_IMPORT_READ_MAX_CHARS, AI_SITE_IMPORT_WAVE_READ_MAX_CHARS - held))
      const capped = aiSiteImportCapBlocks(read.blocks, room)
      held += capped.chars
      kept = { ...read, blocks: capped.blocks, ...(capped.cut || read.cut ? { cut: true } : {}) }
      if (read.layout) {
        const layout = layoutWithin(read.layout, capped.blocks.length, Math.max(0, AI_SITE_IMPORT_WAVE_READ_MAX_CHARS - held))
        held += siteImportLayoutChars(layout)
        kept = { ...kept, layout }
      }
    }
    next = withPage(next, slot, { read: kept, refused: null, title: clipLabel(read.title) || next.pages.find((page) => page.slot === slot)?.title || '' })
  }
  return next
}

/** A page's photos are in the library. */
export function aiSiteImportPhotosIn(
  state: AiSiteImportState,
  slot: string,
  photos: NonNullable<AiSiteImportPage['photos']>,
): AiSiteImportState {
  return withPage(state, slot, { photos })
}

/** A page is in: its text and its blocks are no longer kept. */
export function aiSiteImportPageSettled(state: AiSiteImportState, slot: string): AiSiteImportState {
  const page = state.pages.find((entry) => entry.slot === slot)
  if (!page?.read) return state
  return withPage(state, slot, { read: { ...page.read, text: '', blocks: [], layout: null } })
}

/** A wave is in: waiting for its review, or done when no wave follows it. */
export function aiSiteImportWaveClosed(state: AiSiteImportState, index: number, at: string): AiSiteImportState {
  const later = state.waves.some((wave) => wave.index > index && wave.status === 'waiting')
  // Start every remaining wave: no review between waves, the last one's close is the stop.
  let next = withWave(state, index, { status: later && !state.autoContinue ? 'review' : 'done', finishedAt: at })
  // What the wave read is no longer needed by any model answer.
  for (const slot of state.waves.find((wave) => wave.index === index)?.slots ?? []) next = aiSiteImportPageSettled(next, slot)
  return next
}

/** The state as the console reads it: every page's read text left off. */
export function aiSiteImportWire(state: AiSiteImportState | null | undefined): AiSiteImportState | null {
  if (!state) return null
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.read ? { ...page, read: { ...page.read, text: '', images: [], blocks: [], forms: [], layout: null } } : page,
    ),
  }
}

/*------------------------------------------
 * Credits
 *-----------------------------------------*/

/**
 * How a page is built (AGL-4083), decided by code: every page of a collection
 * (a blog, the legal pages, news) is copied as it is; every main page is
 * arranged by Aglyn AI whatever its length (AGL-4106), its words kept as
 * written. Both are laid out from the source's own layout.
 */
export function aiSiteImportPageBuild(page: Pick<AiSiteImportPage, 'group' | 'words'>): AiSiteImportBuild {
  return page.group !== 'main' ? 'copied' : 'arranged'
}

const whole = (value: number | undefined) => Math.max(0, Math.floor(Number.isFinite(value) ? (value as number) : 0))

/**
 * What bringing in this many pages costs, quoted before it starts (AGL-3976):
 * each page an AI page as measured, its ceiling its two passes, and the
 * site's header and footer once when the wave builds them. Pages the step has
 * chosen a build for (AGL-4083) are priced by it: `arranged` at the
 * arrangement answer and its listing, `copied` at the listing alone.
 */
export function aiSiteImportCreditRange(
  pages: number,
  options: { frame?: boolean; arranged?: number; copied?: number } = {},
): AiCreditRange {
  const count = whole(pages)
  const arranged = whole(options.arranged)
  const copied = whole(options.copied)
  const measured = AI_MEASURED_IMPORT_CREDITS
  return aiCreditRangeOrdered({
    likely:
      count * measured.page.median + arranged * measured.arranged.median + copied * measured.copied.median + (options.frame ? measured.frame.median : 0),
    p90: count * measured.page.p90 + arranged * measured.arranged.p90 + copied * measured.copied.p90 + (options.frame ? measured.frame.p90 : 0),
    ceiling:
      (count + arranged) * AI_SITE_IMPORT_PAGE_CEILING_CREDITS +
      copied * AI_SITE_IMPORT_COPIED_CEILING_CREDITS +
      (options.frame ? AI_SITE_IMPORT_FRAME_CEILING_CREDITS : 0),
  })
}

/** What a wave still owes, by how its pages are built, and whether its header and footer are owed. */
export function aiSiteImportWaveOwed(
  state: AiSiteImportState,
  wave: AiSiteImportWave,
  items?: readonly AiJobItemLedger[] | null,
): { pages: number; arranged: number; copied: number; frame: boolean } {
  const owed = (slot: string) => (items ? aiSiteImportItemOpen(items, slot) : true)
  const counts = { pages: 0, arranged: 0, copied: 0, frame: wave.frame && !!state.frame && owed(AI_SITE_IMPORT_FRAME_SLOT) }
  for (const slot of wave.slots) {
    const page = state.pages.find((entry) => entry.slot === slot)
    if (!owed(slot) || page?.refused) continue
    if (page?.build === 'arranged') counts.arranged += 1
    else if (page?.build === 'copied') counts.copied += 1
    else counts.pages += 1
  }
  return counts
}

/** A wave's quote: the pages it has still to bring in, and its header and footer while they are owed. */
export function aiSiteImportWaveCreditRange(
  state: AiSiteImportState,
  wave: AiSiteImportWave,
  items?: readonly AiJobItemLedger[] | null,
): AiCreditRange {
  const owed = aiSiteImportWaveOwed(state, wave, items)
  return aiSiteImportCreditRange(owed.pages, { frame: owed.frame, arranged: owed.arranged, copied: owed.copied })
}

/** Every wave still waiting, quoted at once: "Start every remaining wave" (AGL-4083). */
export function aiSiteImportRemainingCreditRange(
  state: AiSiteImportState,
  items?: readonly AiJobItemLedger[] | null,
): AiCreditRange {
  const total = { pages: 0, arranged: 0, copied: 0, frame: false }
  for (const wave of state.waves) {
    if (wave.status !== 'waiting') continue
    const owed = aiSiteImportWaveOwed(state, wave, items)
    total.pages += owed.pages
    total.arranged += owed.arranged
    total.copied += owed.copied
    total.frame = total.frame || owed.frame
  }
  return aiSiteImportCreditRange(total.pages, { frame: total.frame, arranged: total.arranged, copied: total.copied })
}

/** "About 95 credits (up to 600): 7 pages arranged by Aglyn AI, 3 copied as they are"; the build is named once the step has chosen. */
export function aiSiteImportQuoteText(
  range: AiCreditRange,
  owed: Pick<ReturnType<typeof aiSiteImportWaveOwed>, 'arranged' | 'copied'>,
): string {
  const parts: string[] = []
  if (owed.arranged) parts.push(`${aiSiteImportPagesText(owed.arranged)} arranged by ${PLATFORM_BRAND_NAME} AI`)
  if (owed.copied) parts.push(`${owed.arranged ? owed.copied.toLocaleString('en-US') : aiSiteImportPagesText(owed.copied)} copied as ${owed.copied === 1 ? 'it is' : 'they are'}`)
  return parts.length ? `${aiCreditRangeText(range)}: ${parts.join(', ')}` : aiCreditRangeText(range)
}

/*------------------------------------------
 * Words
 *-----------------------------------------*/

/** Why a page is not brought in, as a person reads it. */
export const AI_SITE_IMPORT_LEFT_OUT_COPY: Readonly<Record<AiSiteImportLeftOutReason, string>> = {
  'plan-limit': 'Past your plan’s page count. Upgrade for more pages, then bring the rest in.',
  robots: 'The site’s robots.txt asks AglynBot not to read it.',
  'login-form': 'A sign-in page. Pages that ask for a password are never brought in.',
  empty:
    'No text could be read from this page. If your site is built in a way that needs a browser to show its words, it cannot be brought in yet.',
  unreadable: 'It could not be read just now.',
  blocked:
    'The site’s bot protection or firewall turned AglynBot away. Allow AglynBot in your site’s bot or firewall settings, then bring the site in again.',
  'too-large': 'Larger than a page can be to bring in.',
  'off-site': 'It sends visitors to another website.',
  'not-reached': 'Not reached: the read stopped before it got to this page.',
  file: 'A file, not a page.',
}

/** "3 pages" / "1 page". */
export function aiSiteImportPagesText(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'page' : 'pages'}`
}

/** The review a finished wave parks on, or the first wave's go-ahead once the site is read. */
export function aiSiteImportWaveMessage(
  state: AiSiteImportState,
  items: readonly AiJobItemLedger[] | null | undefined,
): string {
  // A read that stopped at its home page says why, and what to do.
  if (aiSiteImportReadStops(state.verdict)) return aiSiteImportReadVerdictMessage(state.verdict, state.domain) ?? ''
  const next = aiSiteImportNextWave(state)
  const reviewing = aiSiteImportReviewWave(state)
  if (!reviewing) {
    const kept = state.pages.length
    return next
      ? `Your site is read: ${aiSiteImportPagesText(kept)} to bring in, in ${state.waves.length === 1 ? 'one wave' : `${state.waves.length} waves`}. Start the first wave when you are ready.`
      : 'Your site is read, and nothing on it can be brought in.'
  }
  const rows = (items ?? []).filter((row) => reviewing.slots.includes(row.slot))
  const done = rows.filter((row) => row.status === 'succeeded' || row.status === 'degraded').length
  const lead = `${reviewing.label} is in: ${aiSiteImportPagesText(done)} ready to review as drafts.`
  return next ? `${lead} Start ${next.label} when you are ready.` : lead
}
