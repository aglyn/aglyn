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
 * A PAGE BROUGHT IN, BUILT BY THE SITE COMPILER (AGL-4107).
 *
 * On 10/29 an import of aglyn.com came out one column of plain lines: the
 * import drew its own stacked text instead of the site's cards, columns,
 * pictures, icons and bands. This module is the page's build now:
 *
 *   1. The source's LAYOUT, as the reader read it (`AiSiteImportPageRead.
 *      layout`, AGL-4106) — its sections and bands, rows of columns, groups of
 *      cards, steps, figures, questions, quotes, logos and plans, its tables,
 *      tabs, pictures and icons — becomes the layout language the guided
 *      start's compiler takes (`aiSiteImportDesignedSections`): a group is a
 *      `cards` block whose items carry every part (icon, picture, figure,
 *      paragraphs, bullet points, links), a table a `table` block, tabs a
 *      `tabs` block. Every line is placed exactly once, in its own section; a
 *      line the layout placed nowhere is added at its section's end.
 *   2. The site compiler draws it (`aiCompileLayoutPage`, `verbatim`), with
 *      the palette's own elements and the theme's tokens: the Card, the
 *      Accordion, the Table, the Tabs, the hero around the source's picture.
 *      Every word is the source's, as written.
 *   A video is the Video element where the source's film sat (AGL-4140),
 *   poster first, playing from where the old page played it, and a button
 *   whose words say it plays the film scrolls to it and presses play.
 *   3. A main page's DESIGN is the one question a model answers
 *      (`submit_design`, `aiSiteImportDesignText`): which hero the opening
 *      becomes, how each group is drawn, a band where the source gave none,
 *      the kind of a group the reader could not tell, an alignment. A page of
 *      a collection, and any page whose answer is missing, is drawn from the
 *      layout with no model.
 *
 * A read made before the reader kept no layout: its page is read into one
 * here, from its lines, one section at each second-level heading.
 *=========================================*/

import {
  aiCompileLayoutPage,
  type AiLayoutCompiledPage,
  type AiLayoutPagePlan,
} from '../layout-language/ai-layout-compiler'
import type { AiLayoutDesign } from '../layout-language/ai-layout-design'
import {
  AI_LAYOUT_GROUP_STYLES,
  AI_LAYOUT_IMPORT_HEROES,
  AI_LAYOUT_MAX_COLS,
  type AiLayoutBlock,
  type AiLayoutColorRole,
  type AiLayoutDesignAnswer,
  type AiLayoutDesignSection,
  type AiLayoutGroupStyle,
  type AiLayoutImportHero,
  type AiLayoutItem,
  type AiLayoutLink,
  type AiLayoutPicture,
  type AiLayoutPictureFit,
  type AiLayoutSection,
  type AiLayoutSettlement,
  type AiLayoutStyle,
  type AiLayoutVideo,
} from '../layout-language/ai-layout-language'
import type { AiLayoutTargets } from '../layout-language/ai-layout-links'
import {
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  SITE_IMPORT_PLAY_WORDS,
  siteImportFilmSource,
  siteImportWidthOf,
  type AiSiteImportPhoto,
  type SiteImportGroupKind,
  type SiteImportHeroPicture,
  type SiteImportIconShape,
  type SiteImportLayout,
  type SiteImportLayoutGroup,
  type SiteImportLayoutItem,
  type SiteImportLayoutLine,
  type SiteImportLayoutNode,
  type SiteImportLayoutSection,
  type SiteImportLayoutVideo,
  type SiteImportLineRef,
  type SiteImportLookFacts,
  type SiteImportPictureFit,
  type SiteImportRule,
  type AiSiteImportFinish,
} from '../model/ai-site-import'
import { aiHexOklch } from '../model/ai-site-look'
import { aiModelAtLeastStepTier } from '../providers/routing'
import type { SiteImportBlock } from '../site-import/site-import-html'
import {
  AI_SITE_IMPORT_DOC_MAX_NODES,
  AI_SITE_IMPORT_LABEL_CHARS,
  aiSiteImportDocLines,
  aiSiteImportTextParts,
  aiSiteImportWordsIn,
  type AiSiteImportDocument,
} from './ai-site-import-document'

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

/** Whether a block is a line of the page: a link inside a sentence is in its sentence. */
function isLine(block: SiteImportBlock | undefined): boolean {
  if (!block) return false
  if (block.kind === 'image') return !!block.url
  if (block.kind === 'link') return !block.inline && !!clean(block.text)
  return !!clean(block.text)
}

/*------------------------------------------
 * The page's job: its model and its links
 *-----------------------------------------*/

/**
 * The model a page brought in asks its design answer on (AGL-4107): the page
 * step's own tier, balanced, whatever the deployment's default model is — the
 * job's own pick where it is that tier or above.
 */
export function aiImportPageModel(modelFor?: (kind: 'job.page') => string | undefined): string {
  return aiModelAtLeastStepTier('job.page', modelFor?.('job.page'))
}

/**
 * Every page the import plans that a page brought in may link (AGL-4107), by
 * the id its draft is written under: a link to one in a wave still to come
 * shows its words until that page is live, then goes there.
 */
export function aiSiteImportLinkablePages(doc: Pick<AiSiteImportDocument, 'links'> | null): Array<{ id: string; label: string; slug: string }> {
  if (!doc) return []
  const seen = new Set<string>()
  return doc.links.flatMap((link) => {
    if (seen.has(link.id)) return []
    seen.add(link.id)
    const path = link.path.replace(/\/+$/, '') || '/'
    return [{ id: link.id, label: path, slug: path }]
  })
}

/**
 * The listing a page brought in keeps (AGL-4107): its source's own title and
 * description, word for word, never clipped and never rewritten — the 10/29
 * import's Home was retitled "Aglyn: Build a Website with AI, Free to Start".
 * Only a part the source left empty takes what was `written` for it.
 */
export function aiImportedPageListing(
  screen: { seoTitle: string; seoDescription: string },
  written: { title?: string; description?: string } = {},
): { title: string; description: string } {
  return {
    title: screen.seoTitle.trim() || (written.title ?? '').trim(),
    description: screen.seoDescription.trim() || (written.description ?? '').trim(),
  }
}

/** Whether a page brought in still owes a part of its listing: one its source left empty. */
export function aiImportedPageListingOwed(listing: { title: string; description: string }): boolean {
  return !listing.title || !listing.description
}

/*------------------------------------------
 * The layout a page is built from
 *-----------------------------------------*/

/**
 * The layout of a page whose read kept none (AGL-4107): its lines in their
 * sections — the opening, then one at each second-level heading — each line
 * where the source put it, in order.
 */
export function aiSiteImportLayoutOfLines(doc: Pick<AiSiteImportDocument, 'blocks' | 'title'>): SiteImportLayout {
  const { lines, sections } = aiSiteImportDocLines(doc.blocks, doc.title)
  // The document's lines are numbered over the page's lines; the layout's are indexes of its blocks.
  const refOf: number[] = []
  doc.blocks.forEach((block, index) => {
    if (isLine(block)) refOf.push(index)
  })
  return {
    v: 1,
    sections: sections.map((section, index) => {
      const refs = section.lines.map((n) => refOf[n - 1]).filter((ref): ref is number => ref !== undefined)
      return {
        name: section.name,
        from: 'heading' as const,
        band: index % 2 === 1 ? ('soft' as const) : ('plain' as const),
        background: null,
        align: 'start' as const,
        nodes: refs.map((ref): SiteImportLayoutNode => (doc.blocks[ref]?.kind === 'image' ? { kind: 'picture', line: ref } : { kind: 'line', line: ref })),
        lines: refs,
      }
    }),
    icons: [],
    look: { fonts: { body: null, headings: null, google: [] }, background: null, text: null, buttonFill: null, buttonText: null, buttonRadius: null, link: null, header: null },
  }
}

/** The layout a page is built from: the reader's, else one read from its lines. */
export function aiSiteImportLayoutOf(doc: Pick<AiSiteImportDocument, 'blocks' | 'title' | 'layout'>): SiteImportLayout {
  return doc.layout && doc.layout.sections.length ? doc.layout : aiSiteImportLayoutOfLines(doc)
}

/**
 * The page's sections by name, in order (AGL-4107): the source's own, as its
 * layout names them — its `aria-label`s, its headings — two of one name told
 * apart, so a link to either finds it. The page's plan has exactly these.
 */
export function aiSiteImportSectionNames(doc: Pick<AiSiteImportDocument, 'blocks' | 'title' | 'layout'>): string[] {
  const named = new Set<string>()
  const names = aiSiteImportLayoutOf(doc).sections.map((section, index) => {
    const name = clean(section.name).slice(0, AI_SITE_IMPORT_LABEL_MAX_CHARS) || `Section ${index + 1}`
    let unique = name
    for (let attempt = 2; named.has(unique.toLowerCase()); attempt += 1) {
      unique = `${name.slice(0, AI_SITE_IMPORT_LABEL_MAX_CHARS - 5)} (${attempt})`
    }
    named.add(unique.toLowerCase())
    return unique
  })
  return names.length ? names : ['Introduction']
}

/*------------------------------------------
 * The source's icons, on the icon element's square
 *-----------------------------------------*/

/** How many numbers each path command takes, by its lower-case letter. */
const PATH_PARAMS: Readonly<Record<string, number>> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

const NUMBER = /[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/y
const FLAG = /[\s,]*([01])/y

/** A number of a path, at most three decimals, as short as it reads. */
const round = (value: number): string => {
  const fixed = Math.round(value * 1000) / 1000
  return Object.is(fixed, -0) ? '0' : String(fixed)
}

/**
 * A path's drawing moved onto the icon element's 24-unit square (AGL-4107):
 * every coordinate scaled from its viewBox and centered, every relative move
 * scaled alone, an arc's radii scaled and its flags and rotation kept.
 * `null` for anything that is not path data.
 */
export function aiSiteImportPathOn24(d: string, viewBox: string): string | null {
  const box = viewBox.trim().split(/[\s,]+/).map(Number)
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) return null
  const [minX, minY, width, height] = box
  const scale = 24 / Math.max(width, height)
  const dx = (24 - width * scale) / 2 - minX * scale
  const dy = (24 - height * scale) / 2 - minY * scale
  const identity = Math.abs(scale - 1) < 1e-9 && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9
  const out: string[] = []
  let at = 0
  let first = true
  const source = d.trim()
  while (at < source.length) {
    while (at < source.length && /[\s,]/.test(source[at])) at += 1
    if (at >= source.length) break
    const command = source[at]
    const lower = command.toLowerCase()
    if (!(lower in PATH_PARAMS)) return null
    at += 1
    const count = PATH_PARAMS[lower]
    const relative = command === lower
    const groups: number[][] = []
    if (count === 0) {
      out.push(command)
      first = false
      continue
    }
    for (;;) {
      const group: number[] = []
      for (let index = 0; index < count; index += 1) {
        const pattern = lower === 'a' && (index === 3 || index === 4) ? FLAG : NUMBER
        pattern.lastIndex = at
        const match = pattern.exec(source)
        if (!match) break
        group.push(Number(match[1]))
        at = pattern.lastIndex
      }
      if (group.length === 0) break
      if (group.length !== count) return null
      groups.push(group)
    }
    if (!groups.length) return null
    const parts = groups.map((group, index) => {
      // A path that opens on a relative move opens at that point, as an absolute one would.
      const absolute = !relative || (first && lower === 'm' && index === 0)
      const x = (value: number) => (absolute ? value * scale + dx : value * scale)
      const y = (value: number) => (absolute ? value * scale + dy : value * scale)
      switch (lower) {
        case 'h':
          return [x(group[0])]
        case 'v':
          return [y(group[0])]
        case 'a':
          return [group[0] * scale, group[1] * scale, group[2], group[3], group[4], x(group[5]), y(group[6])]
        default:
          return group.map((value, position) => (position % 2 === 0 ? x(value) : y(value)))
      }
    })
    out.push(`${command}${parts.map((part) => part.map(round).join(' ')).join(' ')}`)
    first = false
  }
  if (!out.length || !/^[Mm]/.test(out[0])) return null
  return identity ? source : out.join('')
}

/** The attributes of a shape in a reader's cleaned drawing. */
function shapeAttributes(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of source.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) out[match[1].toLowerCase()] = match[2]
  return out
}

const num = (value: string | undefined): number => (value === undefined ? Number.NaN : Number.parseFloat(value))

/** A shape of a drawing as path data, or `null` for one that is only a stroke or is moved by a transform. */
function shapePath(tag: string, attributes: Record<string, string>): string | null {
  if (attributes['transform'] || attributes['fill'] === 'none') return null
  switch (tag) {
    case 'path':
      return attributes['d']?.trim() || null
    case 'circle':
    case 'ellipse': {
      const cx = num(attributes['cx'] ?? '0')
      const cy = num(attributes['cy'] ?? '0')
      const rx = tag === 'circle' ? num(attributes['r']) : num(attributes['rx'])
      const ry = tag === 'circle' ? rx : num(attributes['ry'])
      if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return null
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
    }
    case 'rect': {
      const x = num(attributes['x'] ?? '0')
      const y = num(attributes['y'] ?? '0')
      const width = num(attributes['width'])
      const height = num(attributes['height'])
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
      return `M${x} ${y}H${x + width}V${y + height}H${x}Z`
    }
    case 'polygon': {
      const points = (attributes['points'] ?? '').trim().split(/[\s,]+/).map(Number)
      if (points.length < 4 || points.length % 2 || points.some((value) => !Number.isFinite(value))) return null
      return `M${points.slice(0, 2).join(' ')}L${points.slice(2).join(' ')}Z`
    }
    default:
      // A line or an open polyline is a stroke: filled, it draws nothing.
      return null
  }
}

/**
 * The source's icon as the icon element draws one (AGL-4107): one path on its
 * 24-unit square. A one-path icon is its path, moved onto the square; a small
 * drawing of several filled shapes is their paths together. A drawing made of
 * strokes, or of shapes a transform moves, has no one path, and is left out:
 * an icon is no word of the page.
 */
export function aiSiteImportIconPath(shape: SiteImportIconShape | undefined): string | null {
  if (!shape) return null
  if (shape.path) return aiSiteImportPathOn24(shape.path, shape.viewBox)
  if (!shape.svg) return null
  const paths: string[] = []
  for (const match of shape.svg.matchAll(/<(path|circle|ellipse|rect|polygon|polyline|line)\b([^>]*)\/?>/gi)) {
    const path = shapePath(match[1].toLowerCase(), shapeAttributes(match[2]))
    if (!path) return null
    paths.push(path)
  }
  return paths.length ? aiSiteImportPathOn24(paths.join(''), shape.viewBox) : null
}

/*------------------------------------------
 * The layout in the layout language
 *-----------------------------------------*/

/** The groups a design answer may read as another kind: the ones whose kind the reader told by their shape alone. */
const OPEN_KINDS: ReadonlySet<SiteImportGroupKind> = new Set(['cards', 'steps', 'stats', 'list', 'text'])

/** The hero each place of the source's picture opens as, where no answer chose one. */
const HERO_FOR: Readonly<Record<SiteImportHeroPicture, AiLayoutImportHero>> = {
  beside: 'split',
  behind: 'cover',
  below: 'column',
  above: 'column',
}

interface MapScope {
  doc: AiSiteImportDocument
  layout: SiteImportLayout
  /** Lines taken into a block, by index of the page's blocks. */
  used: Set<number>
  /** Pictures the library could not hold, which a page leaves out. */
  missing: Set<number>
  photos: ReadonlyMap<string, AiSiteImportPhoto>
  pathTo: ReadonlyMap<string, string>
  /** The site's saved form a page brought in places where its source had one. */
  formId: string | null
  formPlaced: boolean
  /** The section being mapped: its design answer, and how many of its groups have been met. */
  answer: AiLayoutDesignSection | null
  groupAt: number
  settled: AiLayoutSettlement[]
  at: string
  /** The page's films the Video element plays, by their index (AGL-4140). */
  films: ReadonlyMap<number, AiLayoutVideo>
  /** The film a play button of this section plays: the section's own first, else the page's. */
  film: number | null
}

/** Where a link of the source goes on the new site, in the compiler's words; `undefined` where it can go nowhere a page may send a visitor. */
function linkTo(scope: Pick<MapScope, 'doc' | 'pathTo'>, href: string | undefined): string | undefined {
  const value = (href ?? '').trim()
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value) || /^tel:\+?[\d\s().-]{3,}$/i.test(value)) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (scope.doc.origins.includes(url.origin)) {
    // The old site's own page: the page it becomes, any page the import plans
    // (AGL-4107), which a visitor reaches once it is live.
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const id = scope.pathTo.get(path)
    return id ? `page:${id}` : undefined
  }
  return url.protocol === 'https:' ? url.toString() : undefined
}

/** A line's words, as written; marks it taken. */
function take(scope: MapScope, ref: SiteImportLineRef | undefined): string {
  if (ref === undefined || scope.used.has(ref)) return ''
  const block = scope.doc.blocks[ref]
  if (!isLine(block)) return ''
  scope.used.add(ref)
  return block.kind === 'image' ? '' : clean(block.text)
}

/** A width over a height as `aspect-ratio` writes it: "1600 / 900", or "1.7778" for a ratio alone. */
function ratioText(width: number, height = 1): string {
  const round = (value: number) => String(Math.round(value * 10_000) / 10_000)
  return height === 1 ? round(width) : `${round(width)} / ${round(height)}`
}

/** The radius past which a source's picture reads as rounded (AGL-4138), not merely softened: 10 px. */
const ROUNDED_PX = 10

/**
 * How a picture of a page brought in is framed (AGL-4138): at the box the
 * source crops it to, where it sets one, else at the picture's own shape —
 * the library's copy's size first, its `width` and `height` second — so a
 * frame of its own shape, filled, cuts nothing off; its fit, and the
 * source's rounded corners and shadow. A round portrait is the byline's.
 */
function pictureFitOf(photo: AiSiteImportPhoto, fit: SiteImportPictureFit | undefined): AiLayoutPictureFit | undefined {
  const out: AiLayoutPictureFit = {}
  if (fit?.box) Object.assign(out, { ratio: ratioText(fit.box), cropped: true as const })
  else if (fit?.height) Object.assign(out, { height: Math.round(fit.height), cropped: true as const })
  else if (photo.width && photo.height) out.ratio = ratioText(photo.width, photo.height)
  else if (fit?.ratio) out.ratio = ratioText(fit.ratio)
  if (fit?.objectFit) out.objectFit = fit.objectFit
  if (fit?.radius !== undefined && fit.radius >= ROUNDED_PX && fit.radius < 999) out.rounded = true
  if (fit?.shadow) out.shadow = true
  // The width the source holds it to, as the theme's breakpoint nearest it; the widest is no hold at all.
  const measure = siteImportWidthOf(fit?.measure)
  if (measure && measure !== 'xl') out.measure = measure
  return Object.keys(out).length ? out : undefined
}

/** A picture line as the library holds it; marks it taken, and missing where the library holds none. */
function takePicture(scope: MapScope, ref: SiteImportLineRef | undefined, href?: string, fit?: SiteImportPictureFit): AiLayoutPicture | null {
  if (ref === undefined || scope.used.has(ref)) return null
  const block = scope.doc.blocks[ref]
  if (!block || block.kind !== 'image') return null
  scope.used.add(ref)
  const photo = scope.photos.get(block.url)
  if (!photo) {
    scope.missing.add(ref)
    return null
  }
  const alt = clean(block.alt || photo.alt || '').slice(0, 200)
  const ratio = photo.width && photo.height ? photo.width / photo.height : 0
  const to = linkTo(scope, href)
  const framed = pictureFitOf(photo, fit)
  return { src: photo.src, alt, ...(ratio > 0 ? { ratio } : {}), ...(to ? { to } : {}), ...(framed ? { fit: framed } : {}) }
}

/*------------------------------------------
 * The source's colors as the theme's roles (AGL-4138)
 *-----------------------------------------*/

/** How colorful a color must be to be a color, not a grey. */
const COLORFUL_CHROMA = 0.04

/** How far apart two colors look, in OKLab. */
function colorGap(a: string, b: string): number {
  const [x, y] = [aiHexOklch(a), aiHexOklch(b)]
  const ax = x.C * Math.cos((x.h * Math.PI) / 180)
  const ay = x.C * Math.sin((x.h * Math.PI) / 180)
  const bx = y.C * Math.cos((y.h * Math.PI) / 180)
  const by = y.C * Math.sin((y.h * Math.PI) / 180)
  return Math.hypot(x.L - y.L, ax - bx, ay - by)
}

const HEX = /^#[0-9a-f]{6}$/i

/** Whether a colorful color is the brand's: the source's buttons' fill or its links' color, by its look or its hue. */
function brandish(hex: string, look: Pick<SiteImportLookFacts, 'buttonFill' | 'link'> | null | undefined): boolean {
  const own = aiHexOklch(hex)
  return [look?.buttonFill, look?.link].some((other) => {
    if (!other || !HEX.test(other)) return false
    const them = aiHexOklch(other)
    if (them.C < COLORFUL_CHROMA) return false
    const hue = Math.abs(own.h - them.h) % 360
    return colorGap(hex, other) <= 0.1 || Math.min(hue, 360 - hue) <= 25
  })
}

/**
 * A source's own color as the theme role a page brought in draws it in
 * (AGL-4138), so no value is ever written onto an element: the brand's
 * colors as `primary`, any other color as the theme's third, which the look
 * pins to the source's eyebrows' (`aiSiteImportStyle`); a grey as the words'
 * ink or their muted shade, or as the divider for a rule; a light fill as the
 * theme's tint. `null` where no role is the color's: white words on a dark
 * band take the band's own.
 */
export function aiSiteImportColorRole(hex: string | null | undefined, look: Pick<SiteImportLookFacts, 'buttonFill' | 'link'> | null | undefined, use: 'ink' | 'fill' | 'rule'): AiLayoutColorRole | null {
  if (!hex || !HEX.test(hex)) return null
  const own = aiHexOklch(hex)
  if (use === 'fill' && own.L >= 0.9) return 'action.hover'
  if (own.C < COLORFUL_CHROMA) {
    if (use === 'rule') return 'divider'
    if (use === 'fill' || own.L >= 0.9) return null
    return own.L <= 0.35 ? 'text.primary' : 'text.secondary'
  }
  return brandish(hex, look) ? 'primary.main' : 'tertiary.main'
}

/** An icon's color in a tile: the fill's own contrast where the icon is a light one on a strong fill. */
function tileInk(fill: AiLayoutColorRole, color: string | null, look: SiteImportLookFacts): AiLayoutColorRole | null {
  const light = !!color && HEX.test(color) && aiHexOklch(color).L >= 0.9
  if (light && fill === 'primary.main') return 'primary.contrastText'
  if (light && fill === 'tertiary.main') return 'tertiary.contrastText'
  return aiSiteImportColorRole(color, look, 'ink')
}

/** A group's rule as the compiler draws it: its side, its width in the theme's border steps, its color's role. */
function ruleOf(rule: SiteImportRule, look: SiteImportLookFacts): NonNullable<AiLayoutBlock['rule']> {
  const width = rule.width >= 3 ? 3 : rule.width === 2 ? 2 : 1
  return { side: rule.side, width, color: aiSiteImportColorRole(rule.color, look, 'rule') }
}

/** Words as text blocks, a paragraph longer than a text element holds split between its sentences. */
function textBlocks(kind: 'text' | 'lede' | 'note', text: string): AiLayoutBlock[] {
  return aiSiteImportTextParts(text).map((part) => ({ kind, text: part }))
}

/** A link of the source: a button where its words fit one, a link in a list where they run longer, its words where it goes nowhere. */
function linkBlocks(scope: MapScope, text: string, href: string, style: AiLayoutStyle): AiLayoutBlock[] {
  const to = linkTo(scope, href)
  if (text.length <= AI_SITE_IMPORT_LABEL_CHARS) return [{ kind: 'button', text, ...(to ? { to } : {}), style }]
  if (to) return [{ kind: 'list', items: [{ title: text, text: '', to }] }]
  return textBlocks('text', text)
}

/** One line in place, as the kind of block its source and its role say. */
function lineBlocks(scope: MapScope, node: SiteImportLayoutLine): AiLayoutBlock[] {
  const block = scope.doc.blocks[node.line]
  if (!block || scope.used.has(node.line)) return []
  if (block.kind === 'image') {
    const picture = takePicture(scope, node.line)
    return picture ? [{ kind: 'image', picture }] : []
  }
  const text = take(scope, node.line)
  if (!text) return []
  switch (block.kind) {
    case 'heading':
      return [{ kind: 'heading', text }]
    case 'link':
      return linkBlocks(scope, text, block.href, node.button ?? 'quiet')
    case 'list-item':
      return [{ kind: 'list', items: [{ title: text, text: '' }] }]
    case 'quote':
      return [{ kind: 'quotes', style: 'quiet', items: [{ title: '', text }] }]
    default: {
      // A button whose words say it plays a film plays the section's film, else the page's (AGL-4140).
      if (node.button && scope.film !== null && SITE_IMPORT_PLAY_WORDS.test(text) && text.length <= AI_SITE_IMPORT_LABEL_CHARS) {
        return [{ kind: 'button', text, style: node.button, to: `video:${scope.film}` }]
      }
      if (node.role === 'eyebrow') {
        // In its own pill and its own color, as the source sets it (AGL-4138).
        const color = aiSiteImportColorRole(node.color, scope.layout.look, 'ink')
        return [{ kind: 'eyebrow', text, ...(node.chip ? { chip: true as const } : {}), ...(color ? { color } : {}) }]
      }
      // A statement is a lede set large (AGL-4138), split as any text is between its sentences where it runs long.
      if (node.role === 'statement') return textBlocks('lede', text).map((block) => ({ ...block, style: 'large' as const }))
      return textBlocks(node.role === 'lede' ? 'lede' : node.role === 'note' ? 'note' : 'text', text)
    }
  }
}

/** The icon a group item or a bullet carries, by its index into the page's icons. */
function iconAt(scope: MapScope, index: number | undefined): string | undefined {
  return index === undefined ? undefined : (aiSiteImportIconPath(scope.layout.icons[index]) ?? undefined)
}

/** The style of a link inside an item: as the source draws it, else a plan's own button outlined and any other a quiet link. */
function itemLinkStyle(group: SiteImportLayoutGroup, item: SiteImportLayoutItem, ref: SiteImportLineRef): AiLayoutStyle {
  return item.ctas?.find((cta) => cta.line === ref)?.style ?? (group.group === 'pricing' ? 'secondary' : 'quiet')
}

/** One item of a group, drawn as `kind`, every line of it in exactly one of its parts. */
function itemOf(scope: MapScope, group: SiteImportLayoutGroup, item: SiteImportLayoutItem, kind: SiteImportGroupKind = group.group): AiLayoutItem {
  const out: AiLayoutItem = { title: '', text: '' }
  const named = new Set<number>([
    ...(item.title !== undefined ? [item.title] : []),
    ...(item.figure !== undefined ? [item.figure] : []),
    ...(item.image !== undefined ? [item.image] : []),
    ...(item.badge !== undefined ? [item.badge] : []),
    ...(item.period !== undefined ? [item.period] : []),
    ...(item.text ?? []),
    ...(item.list ?? []),
    ...(item.link ?? []),
  ])
  const paragraphs: string[] = []
  const links: AiLayoutLink[] = []
  const addLink = (ref: number) => {
    const block = scope.doc.blocks[ref]
    const text = take(scope, ref)
    if (!text) return
    const to = block?.kind === 'link' ? linkTo(scope, block.href) : undefined
    if (text.length <= AI_SITE_IMPORT_LABEL_CHARS) links.push({ text, ...(to ? { to } : {}), style: itemLinkStyle(group, item, ref) })
    else paragraphs.push(text)
  }
  // The item's lines in the source's order: each where its part says.
  for (const ref of item.lines) {
    if (scope.used.has(ref)) continue
    const block = scope.doc.blocks[ref]
    if (!block) continue
    if (ref === item.title) out.title = take(scope, ref)
    else if (ref === item.figure) out.figure = take(scope, ref)
    else if (ref === item.period) out.period = take(scope, ref)
    // A figure stands alone: its tag, if it has one, is among its words.
    else if (ref === item.badge && kind !== 'stats') out.badge = take(scope, ref)
    else if (ref === item.image || (block.kind === 'image' && !named.has(ref))) {
      const picture = takePicture(scope, ref, undefined, ref === item.image ? item.imageFit : undefined)
      if (picture && !out.picture) out.picture = picture
    } else if (item.list?.includes(ref)) {
      const line = take(scope, ref)
      if (line) out.list = [...(out.list ?? []), line]
    } else if (item.link?.includes(ref) || (block.kind === 'link' && (!named.has(ref) || clean(block.text).length <= AI_SITE_IMPORT_LABEL_CHARS))) addLink(ref)
    else {
      const line = take(scope, ref)
      if (line) paragraphs.push(...aiSiteImportTextParts(line))
    }
  }
  if (paragraphs.length) out.text = paragraphs[0]
  if (paragraphs.length > 1) out.more = paragraphs.slice(1)
  if (links.length) out.links = links
  // A row's name is a heading only where the source says so.
  if (group.inline && item.title !== undefined && scope.doc.blocks[item.title]?.kind !== 'heading') out.label = true
  const icon = iconAt(scope, item.icon)
  if (icon) out.iconPath = icon
  const mark = iconAt(scope, item.listIcon)
  if (mark && out.list?.length) out.listIconPath = mark
  // Its icon's square and its arrow, as the source draws them (AGL-4138).
  const fill = icon && item.tile ? aiSiteImportColorRole(item.tile.fill, scope.layout.look, 'fill') : null
  if (fill && item.tile) out.tile = { fill, color: tileInk(fill, item.tile.color, scope.layout.look) }
  const arrow = iconAt(scope, item.mark)
  if (arrow) out.markPath = arrow
  if (item.figureMuted && out.figure) out.figureMuted = true
  // A film the item holds plays from its poster (AGL-4140), and the item is no link around it.
  const film = item.video !== undefined ? scope.films.get(item.video) : undefined
  if (film && out.picture) {
    out.picture = { ...out.picture, video: film }
    return out
  }
  const to = linkTo(scope, item.to)
  if (to) out.to = to
  return out
}

/** The style a group of cards is drawn in where its design answer chose none: the source's own box, its rule, icons or pictures. */
function defaultStyle(group: SiteImportLayoutGroup, items: readonly AiLayoutItem[]): AiLayoutGroupStyle {
  const pictured = items.length > 0 && items.every((item) => item.picture)
  if (pictured) return group.boxed ? 'articles' : 'pictures'
  if (group.boxed) return 'cards'
  // A rule along each item, a step's line over its number, is no box (AGL-4138).
  if (group.rule) return 'ruled'
  return items.length > 0 && items.every((item) => item.iconPath) ? 'icons' : 'ruled'
}

/** What a group of a page brought in carries of how its source draws it (AGL-4138): its items' own alignment, its tablet columns, its rule when it is drawn ruled. */
function drawnAs(scope: MapScope, group: SiteImportLayoutGroup, style?: AiLayoutGroupStyle): Pick<AiLayoutBlock, 'itemsAlign' | 'columnsSm' | 'rule'> {
  return {
    ...(group.align ? { itemsAlign: group.align } : {}),
    ...(group.columnsSm ? { columnsSm: group.columnsSm } : {}),
    ...(style === 'ruled' && group.rule ? { rule: ruleOf(group.rule, scope.layout.look) } : {}),
  }
}

/** The style an answer chose, where the group can be drawn so: pictures need a picture on every item, icons an icon. */
function styleFor(asked: AiLayoutGroupStyle | undefined, group: SiteImportLayoutGroup, items: readonly AiLayoutItem[]): AiLayoutGroupStyle {
  const fallback = defaultStyle(group, items)
  if (!asked || !(AI_LAYOUT_GROUP_STYLES as readonly string[]).includes(asked)) return fallback
  if ((asked === 'pictures' || asked === 'articles') && !items.every((item) => item.picture)) return fallback
  if (asked === 'icons' && !items.every((item) => item.iconPath)) return fallback
  return asked
}

/** The longest line that leads a figure: "1-click", "$0.83". */
const FIGURE_MAX_CHARS = 14

/**
 * Whether a group can be drawn as figures (AGL-4083): each item a short line
 * over its label and nothing else. A figure has no place for a link, a bullet,
 * a picture or an icon, so an item with one, drawn as a figure, loses it.
 */
function holdsOnlyFigures(scope: MapScope, group: SiteImportLayoutGroup): boolean {
  return group.items.every((item) => {
    const lead = item.title ?? item.lines[0]
    const block = lead === undefined ? undefined : scope.doc.blocks[lead]
    return (
      !!block &&
      block.kind !== 'image' &&
      clean(block.text).length <= FIGURE_MAX_CHARS &&
      item.lines.length <= 3 &&
      !item.link?.length &&
      !item.list?.length &&
      item.image === undefined &&
      item.icon === undefined &&
      !item.lines.some((ref) => scope.doc.blocks[ref]?.kind === 'link' || scope.doc.blocks[ref]?.kind === 'image')
    )
  })
}

/** A group of the source, in the layout language: every item of it, in the kind and style its answer chose or its source shows. */
function groupBlocks(scope: MapScope, group: SiteImportLayoutGroup): AiLayoutBlock[] {
  const answer = scope.answer?.groups[scope.groupAt] ?? null
  scope.groupAt += 1
  // Rows the source sets are drawn as its rows: no answer's kind or style is one of them (AGL-4083).
  if (group.inline) {
    if (answer?.kind || answer?.style) scope.settled.push({ at: scope.at, what: `a ${group.group} group drawn as the source's rows` })
    return [{ kind: 'cards', items: group.items.map((item) => itemOf(scope, group, item)), columns: 1, inline: true }]
  }
  const asked: SiteImportGroupKind = answer?.kind && OPEN_KINDS.has(group.group) ? answer.kind : group.group
  // A list is one line an item (AGL-4083): one asked of items with more would
  // join a label to its value, and 49 of a plan's rows lost theirs so on 11/1.
  const joins = asked === 'list' && group.group !== 'list' && group.items.some((item) => item.lines.length > 1)
  const unfigured = asked === 'stats' && group.group !== 'stats' && !holdsOnlyFigures(scope, group)
  const kind: SiteImportGroupKind = joins ? 'cards' : unfigured ? group.group : asked
  if (joins) scope.settled.push({ at: scope.at, what: `a ${group.group} group kept apart: its items hold more than one line each, so it is no list` })
  else if (unfigured) scope.settled.push({ at: scope.at, what: `a ${group.group} group kept as it is: its items hold more than a figure can show` })
  else if (kind !== group.group) scope.settled.push({ at: scope.at, what: `a ${group.group} group drawn as ${kind}, as its design answer read it` })
  const columns = Math.max(1, Math.min(AI_LAYOUT_MAX_COLS, group.columns || 1))
  if (kind === 'text') {
    // Lines that only share a shape: each where it stands.
    return group.items.flatMap((item) => item.lines.flatMap((ref) => lineBlocks(scope, { kind: 'line', line: ref })))
  }
  if (kind === 'list') {
    const items = group.items.flatMap((item): AiLayoutItem[] => {
      const linked = item.lines.map((ref) => scope.doc.blocks[ref]).find((block) => block?.kind === 'link')
      const words = item.lines.map((ref) => take(scope, ref)).filter(Boolean).join(' ')
      for (const ref of item.lines) {
        if (scope.doc.blocks[ref]?.kind === 'image') takePicture(scope, ref)
      }
      if (!words) return []
      const icon = iconAt(scope, item.icon)
      const to = linkTo(scope, item.to ?? (linked?.kind === 'link' ? linked.href : undefined))
      return [{ title: words, text: '', ...(icon ? { iconPath: icon } : {}), ...(to ? { to } : {}) }]
    })
    return items.length ? [{ kind: 'list', items, columns }] : []
  }
  if (kind === 'logos') {
    const items = group.items.flatMap((item): AiLayoutItem[] => {
      let picture: AiLayoutPicture | null = null
      const words: string[] = []
      for (const ref of item.lines) {
        if (scope.doc.blocks[ref]?.kind === 'image') picture = picture ?? takePicture(scope, ref)
        else {
          const line = take(scope, ref)
          if (line) words.push(line)
        }
      }
      if (picture && !words.length) return [{ title: '', text: '', picture }]
      // A strip of linked tags keeps its links (AGL-4138): a blog's categories go to their pages.
      const to = picture ? undefined : linkTo(scope, item.to)
      return words.length ? [{ title: words.join(' '), text: '', ...(picture ? { picture } : {}), ...(to ? { to } : {}) }] : picture ? [{ title: '', text: '', picture }] : []
    })
    return items.length ? [{ kind: 'logos', items }] : []
  }
  const items = group.items.map((item) => itemOf(scope, group, item, kind))
  if (kind === 'quotes') {
    // The reader names a quote's words its title and who said it its text.
    const quotes = items.map((item) => ({ ...item, title: [item.text, ...(item.more ?? [])].filter(Boolean).join(' '), text: item.title, more: [] as string[] }))
    return [{ kind: 'quotes', items: quotes.map(({ more: _more, ...item }) => item), columns, ...(group.boxed ? { variant: 'cards' as const } : { style: 'quiet' as const }), ...drawnAs(scope, group) }]
  }
  if (kind === 'faq') return [{ kind: 'faq', items, columns }]
  if (kind === 'stats') return [{ kind: 'stats', items, columns, ...(group.boxed ? { variant: 'cards' as const } : {}), ...drawnAs(scope, group) }]
  const style = joins ? 'ruled' : styleFor(answer?.style, group, items)
  return [{ kind: kind === 'steps' ? 'steps' : 'cards', items, columns, variant: style, ...drawnAs(scope, group, style) }]
}

/** A section's nodes in the layout language, a row of columns placed by `col` where the section may still take one. */
function nodeBlocks(scope: MapScope, nodes: readonly SiteImportLayoutNode[], row: { cols: number[] | null; allowed: boolean }): AiLayoutBlock[] {
  const out: AiLayoutBlock[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case 'line':
        out.push(...lineBlocks(scope, node))
        break
      case 'picture': {
        const picture = takePicture(scope, node.line, node.button ? undefined : node.href, node.fit)
        if (picture) out.push({ kind: 'image', picture })
        break
      }
      case 'icon':
        // A lone icon is no word and no picture of the page.
        break
      case 'video':
        out.push(...videoBlocks(scope, node))
        break
      case 'form': {
        // The form rebuilt for this one (AGL-4083); a read from before they were, the site's only form, once.
        const own = scope.doc.forms?.find((entry) => entry.index === node.form)
        if (scope.doc.forms) {
          if (own?.formId) out.push({ kind: 'form', to: own.formId })
        } else if (scope.formId && !scope.formPlaced) {
          scope.formPlaced = true
          out.push({ kind: 'form', to: scope.formId })
        }
        break
      }
      case 'row': {
        const cells = node.cells.filter((cell) => cell.nodes.length)
        const byline = bylineOf(scope, cells)
        if (byline) {
          // A portrait beside a name and a date: the portrait small, over its words.
          out.push(...byline)
          break
        }
        if (row.allowed && !row.cols && cells.length >= 2 && cells.length <= AI_LAYOUT_MAX_COLS) {
          // The section's row: each cell a column, by the source's widths.
          const weights = node.cells.map((cell, index) => ({ cell, weight: node.cols[index] ?? 1 })).filter((entry) => entry.cell.nodes.length)
          row.cols = weights.map((entry) => Math.min(12, Math.max(1, Math.round(entry.weight))))
          weights.forEach((entry, col) => {
            for (const block of nodeBlocks(scope, entry.cell.nodes, { cols: null, allowed: false })) out.push({ ...block, col })
          })
        } else {
          // A second row of a section, or one inside a column: its cells one under another.
          for (const cell of node.cells) out.push(...nodeBlocks(scope, cell.nodes, { cols: null, allowed: false }))
        }
        break
      }
      case 'group':
        out.push(...groupBlocks(scope, node))
        break
      case 'table': {
        const rows = node.rows.map((tableRow) => ({ cells: tableRow.cells.map((cell) => cell.lines.map((ref) => take(scope, ref)).filter(Boolean).join(' ')) }))
        if (rows.some((tableRow) => tableRow.cells.some(Boolean))) out.push({ kind: 'table', header: node.header, rows })
        break
      }
      case 'tabs': {
        const tabs = node.tabs.map((tab) => {
          const label = tab.label === null ? '' : take(scope, tab.label)
          // A panel sets its first row side by side, as a section does (AGL-4114).
          const panelRow = { cols: null as number[] | null, allowed: true }
          const blocks = mergeLists(nodeBlocks(scope, tab.panel, panelRow))
          return {
            label,
            ...(tab.selected ? { selected: true } : {}),
            blocks,
            ...(panelRow.cols && blocks.some((block) => block.col !== undefined) ? { cols: panelRow.cols } : {}),
          }
        })
        if (tabs.some((tab) => tab.label || tab.blocks.length)) out.push({ kind: 'tabs', tabs })
        break
      }
      default:
        break
    }
  }
  return out
}

/**
 * A video of the source, where it sat (AGL-4140): the Video element, its
 * poster the library's copy of the source's, where the Video element can play
 * the film. One on a host it cannot play is its poster, linking to where the
 * film plays; with no poster either, nothing of it can be shown.
 */
function videoBlocks(scope: MapScope, node: Pick<SiteImportLayoutVideo, 'video' | 'poster' | 'fit' | 'shadow'>): AiLayoutBlock[] {
  const film = scope.films.get(node.video)
  if (film) {
    // A film is pressed to play from its poster: with none, the Video element has nothing to show, and it is left out.
    const picture = filmPlaces(scope, node.video, node.poster) ? takePicture(scope, node.poster, undefined, node.fit) : null
    if (!picture) {
      scope.settled.push({ at: scope.at, what: 'a video left out: it has no poster picture' })
      return []
    }
    const video: AiLayoutVideo = { ...film, ...(node.shadow ? { shadow: true } : {}) }
    return [{ kind: 'video', video, picture }]
  }
  const source = scope.doc.videos?.[node.video]
  const where = source?.embed ?? source?.src
  const picture = takePicture(scope, node.poster, where, node.fit)
  const host = (() => {
    try {
      return where ? new URL(where).hostname.replace(/^www\./, '') : ''
    } catch {
      return ''
    }
  })()
  if (picture && source) scope.settled.push({ at: scope.at, what: `a video${host ? ` on ${host}` : ''} shown as its picture${picture.to ? ', linking to it' : ''}` })
  return picture ? [{ kind: 'image', picture }] : []
}

/** The page's films the Video element plays, by index (AGL-4140): each read's video that plays from a host it knows, or from the old site's https address. */
function filmsOf(doc: AiSiteImportDocument): Map<number, AiLayoutVideo> {
  const films = new Map<number, AiLayoutVideo>()
  ;(doc.videos ?? []).forEach((video, index) => {
    const source = siteImportFilmSource(video)
    if (!source) return
    const title = clean(video.title).slice(0, 200)
    const description = clean(video.description).slice(0, 2_000)
    films.set(index, {
      index,
      src: source.src,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(video.uploadDate ? { uploadDate: video.uploadDate } : {}),
      ...(video.durationSeconds ? { durationSeconds: video.durationSeconds } : {}),
    })
  })
  return films
}

/** Whether a film is drawn as the Video element: one it plays, its poster a picture the library holds. */
function filmPlaces(scope: Pick<MapScope, 'films' | 'doc' | 'photos'>, video: number, poster: SiteImportLineRef | undefined): boolean {
  const block = poster === undefined ? undefined : scope.doc.blocks[poster]
  return scope.films.has(video) && block?.kind === 'image' && scope.photos.has(block.url)
}

/** The first film of a list of nodes drawn as the Video element, rows, tabs and items opened. */
function firstFilm(scope: Pick<MapScope, 'films' | 'doc' | 'photos'>, nodes: readonly SiteImportLayoutNode[]): number | null {
  for (const node of nodes) {
    const found =
      node.kind === 'video'
        ? filmPlaces(scope, node.video, node.poster)
          ? node.video
          : null
        : node.kind === 'row'
          ? firstFilm(scope, node.cells.flatMap((cell) => cell.nodes))
          : node.kind === 'tabs'
            ? firstFilm(scope, node.tabs.flatMap((tab) => tab.panel))
            : node.kind === 'group'
              ? (node.items.find((item) => item.video !== undefined && filmPlaces(scope, item.video, item.image))?.video ?? null)
              : null
    if (found !== null) return found
  }
  return null
}

/** The most words beside a lone picture that make a row a byline: a name, a date, a role. */
const BYLINE_MAX_WORDS = 12

/**
 * A row that is a byline (AGL-4107): one cell a lone picture, the other a few
 * words — a writer's portrait beside their name and date. Drawn as columns it
 * set a portrait across half the page; it is the portrait, small, and its words.
 */
function bylineOf(scope: MapScope, cells: ReadonlyArray<{ nodes: SiteImportLayoutNode[] }>): AiLayoutBlock[] | null {
  if (cells.length !== 2) return null
  const at = cells.findIndex((cell) => cell.nodes.length === 1 && cell.nodes[0].kind === 'picture')
  if (at === -1) return null
  const words = cells[1 - at].nodes
  if (!words.every((node) => node.kind === 'line')) return null
  const count = words.reduce((total, node) => {
    const block = scope.doc.blocks[(node as SiteImportLayoutLine).line]
    return total + (block && block.kind !== 'image' ? aiSiteImportWordsIn(clean(block.text)) : 0)
  }, 0)
  if (count === 0 || count > BYLINE_MAX_WORDS) return null
  const node = cells[at].nodes[0] as Extract<SiteImportLayoutNode, { kind: 'picture' }>
  const picture = takePicture(scope, node.line, node.button ? undefined : node.href, node.fit)
  return [...(picture ? [{ kind: 'image' as const, picture: { ...picture, small: true } }] : []), ...nodeBlocks(scope, words, { cols: null, allowed: false })]
}

/** Paragraphs past which a section is reading copy, set at the start whatever its source centers. */
const READING_PARAGRAPHS = 4

/** Neighboring one-line lists of one column as one list, as the source's list items read. */
function mergeLists(blocks: readonly AiLayoutBlock[]): AiLayoutBlock[] {
  const out: AiLayoutBlock[] = []
  for (const block of blocks) {
    const last = out[out.length - 1]
    const plain = (entry: AiLayoutBlock | undefined) => entry?.kind === 'list' && entry.columns === undefined && !entry.items?.some((item) => item.iconPath)
    if (plain(block) && plain(last) && last?.col === block.col) {
      out[out.length - 1] = { ...last, items: [...(last.items ?? []), ...(block.items ?? [])] }
      continue
    }
    out.push(block)
  }
  return out
}

/** The heroes that lay dimmed words over the picture, which draw their section dark. */
const DIMMED_HEROES: ReadonlySet<AiLayoutImportHero> = new Set(['cover', 'poster'])

/**
 * The heroes that keep the source's picture where it lays it (AGL-4138): under
 * or over its words in a column, beside them, or behind them. An answer may
 * choose among these alone.
 */
const HEROES_AT: Readonly<Record<SiteImportHeroPicture, ReadonlySet<AiLayoutImportHero>>> = {
  below: new Set(['column', 'editorial']),
  above: new Set(['column', 'editorial']),
  beside: new Set(['split', 'bleed', 'panel']),
  behind: new Set(['cover', 'poster', 'panel']),
}

/**
 * The hero a section's opening takes: the first section's, around its picture
 * beside, behind or under its words. Words dimmed over the picture draw the
 * section dark, so a section that keeps a lighter ground of its own, with its
 * picture anywhere but behind it, opens as its source does (AGL-4083): an
 * answer never repaints a section's own band. Nor does it move the picture
 * (AGL-4138): a picture under centered words stays under them, as a picture
 * beside the words stays beside them.
 */
function heroOf(section: SiteImportLayoutSection, index: number, answer: AiLayoutDesignSection | null, settled: AiLayoutSettlement[]): AiLayoutImportHero | undefined {
  if (index !== 0 || !section.hero?.picture) return undefined
  // An answer of "none" keeps the opening as the source lays it out.
  if (answer?.hero === 'none') return undefined
  const place = section.hero.picture
  const own = HERO_FOR[place]
  if (answer?.hero && DIMMED_HEROES.has(answer.hero) && section.band !== 'dark' && place !== 'behind') {
    settled.push({ at: 'sections[0]', what: `the ${answer.hero} hero set aside: the section keeps its own lighter ground` })
    return own
  }
  if (answer?.hero && !HEROES_AT[place].has(answer.hero)) {
    settled.push({ at: 'sections[0]', what: `the ${answer.hero} hero set aside: the source lays its picture ${place} its words` })
    return own
  }
  return answer?.hero ?? own
}

export interface AiSiteImportDesigned {
  sections: AiLayoutSection[]
  /** Lines taken into a block, by index of the page's blocks. */
  used: Set<number>
  /** Pictures the library could not hold. */
  missing: Set<number>
  settled: AiLayoutSettlement[]
}

/**
 * The page's sections in the layout language (AGL-4107): the source's layout,
 * each section in its own band (or the answer's, where the source gave none),
 * its row, its groups and their items, its tables, tabs and pictures, every
 * line taken exactly once and every line the layout placed nowhere added at
 * its section's end.
 */
export function aiSiteImportDesignedSections(
  doc: AiSiteImportDocument,
  answer?: AiLayoutDesignAnswer | null,
  options: { formId?: string | null } = {},
): AiSiteImportDesigned {
  const layout = aiSiteImportLayoutOf(doc)
  const scope: MapScope = {
    doc,
    layout,
    used: new Set(),
    missing: new Set(),
    photos: new Map(doc.photos.flatMap((photo) => (photo.from ? [[photo.from, photo] as const] : []))),
    pathTo: new Map(doc.links.map((link) => [link.path.replace(/\/+$/, '') || '/', link.id])),
    formId: options.formId ?? null,
    formPlaced: false,
    answer: null,
    groupAt: 0,
    settled: [],
    at: '',
    films: filmsOf(doc),
    film: null,
  }
  const backdropOf = (section: SiteImportLayoutSection) => (section.backdrop?.kind === 'video' ? section.backdrop : null)
  const pageFilm = layout.sections.reduce<number | null>((found, section) => found ?? firstFilm(scope, section.nodes), null)
  const sections = layout.sections.map((section, index): AiLayoutSection => {
    const given = answer?.sections[index] ?? null
    scope.answer = given
    scope.groupAt = 0
    scope.at = `sections[${index}]`
    const behind = backdropOf(section)
    scope.film = firstFilm(scope, section.nodes) ?? pageFilm
    const row = { cols: null as number[] | null, allowed: true }
    // A film playing on its own behind the section's words is drawn as its poster there (AGL-4140): the
    // opening's hero lays it behind them. A film that starts on its own is one rule 16 refuses.
    const poster = behind ? takePicture(scope, behind.poster) : null
    if (behind) scope.settled.push({ at: scope.at, what: 'a film playing behind the words drawn as its poster' })
    const blocks = [...(poster ? [{ kind: 'image' as const, picture: poster }] : []), ...nodeBlocks(scope, section.nodes, row)]
    // Every line the layout placed nowhere, at the section's end, as its kind says.
    for (const ref of section.lines) {
      if (scope.used.has(ref)) continue
      const block = doc.blocks[ref]
      if (!isLine(block)) continue
      blocks.push(...lineBlocks(scope, { kind: 'line', line: ref }))
    }
    const hero = heroOf(section, index, given, scope.settled)
    // A band only where the source gave the section none of its own.
    const band = section.background === null && !section.backdrop && given?.band ? given.band : section.band
    // A long read is set at the start, as text is read, whatever its source centers.
    const reading = blocks.filter((block) => block.kind === 'text').length > READING_PARAGRAPHS
    return {
      band,
      align: given?.align ?? (reading ? 'start' : section.align),
      // As wide as the source runs (AGL-4083); where it sets no cap, a page's width, a long read's measure.
      width: siteImportWidthOf(section.width) ?? (reading ? 'md' : 'lg'),
      ...(row.cols && blocks.some((block) => block.col !== undefined) ? { cols: row.cols } : {}),
      blocks: mergeLists(blocks),
      ...(hero ? { hero } : {}),
    }
  })
  return { sections, used: scope.used, missing: scope.missing, settled: scope.settled }
}

/*------------------------------------------
 * The page compiled
 *-----------------------------------------*/

export interface AiSiteImportCompileInput {
  doc: AiSiteImportDocument
  /** The ids the page stores its sections under, in plan order: one for each of the page's sections. */
  sectionIds: readonly string[]
  /** The page's plan: its title and its sections by name. */
  plan: AiLayoutPagePlan
  targets: AiLayoutTargets
  /** The site the page belongs to, which its hero is drawn for. */
  design?: AiLayoutDesign | null
  language?: string
  /** The page's design answer, for a main page; absent, the page is drawn as its source lays it out. */
  answer?: AiLayoutDesignAnswer | null
  /** How the page is finished (AGL-4152); absent is `keep`. */
  finish?: AiSiteImportFinish | null
}

export interface AiSiteImportCompiled extends Pick<AiLayoutCompiledPage, 'tree' | 'sectionRoots' | 'videoIds'> {
  sections: AiLayoutSection[]
  /** The lines on the page, by index of its blocks, in source order. */
  placed: number[]
  /** Every line the page has. */
  lines: number
  /** The words on the page, and the words its lines hold. */
  words: number
  sourceWords: number
  /** Set when the page ran past what one page may weigh, and its last sections keep only their names. */
  cut: boolean
  settled: AiLayoutSettlement[]
}

/**
 * The page brought in, built by the site compiler (AGL-4107): every line on
 * it exactly once, every word as its source wrote it, laid out as its source
 * lays it out and drawn in the site's own theme.
 */
export function aiCompileImportedPage(input: AiSiteImportCompileInput): AiSiteImportCompiled {
  const { doc } = input
  const formId = input.targets.forms.length === 1 ? input.targets.forms[0].id : null
  const designed = aiSiteImportDesignedSections(doc, input.answer ?? null, { formId })
  const compile = (sections: readonly AiLayoutSection[]) =>
    aiCompileLayoutPage(sections, input.plan, input.targets, {
      // A page brought in draws its repeats as its source does (AGL-4107).
      reusableComponents: false,
      sectionIds: input.sectionIds,
      verbatim: true,
      ...(input.design ? { design: input.design } : {}),
      ...(input.language ? { language: input.language } : {}),
    })
  let sections = designed.sections
  let compiled = compile(sections)
  let cut = false
  // A page past what one page may weigh keeps its last sections by name.
  for (let last = sections.length - 1; Object.keys(compiled.tree.nodes).length > AI_SITE_IMPORT_DOC_MAX_NODES && last > 0; last -= 1) {
    cut = true
    sections = sections.map((section, index) => (index >= last ? { ...section, blocks: [], cols: undefined } : section))
    compiled = compile(sections)
  }
  const dropped = new Set<number>()
  if (cut) {
    const layout = aiSiteImportLayoutOf(doc)
    layout.sections.forEach((section, index) => {
      if (!sections[index]?.blocks.length) for (const ref of section.lines) dropped.add(ref)
    })
  }
  const lineRefs = doc.blocks.flatMap((block, index) => (isLine(block) ? [index] : []))
  const placed = lineRefs.filter((ref) => designed.used.has(ref) && !designed.missing.has(ref) && !dropped.has(ref))
  const wordsOf = (ref: number) => {
    const block = doc.blocks[ref]
    return block && block.kind !== 'image' ? aiSiteImportWordsIn(clean(block.text)) : 0
  }
  return {
    tree: compiled.tree,
    sectionRoots: compiled.sectionRoots,
    // Its films' Video elements keep their ids when stored, as its sections do: a button that plays one names it (AGL-4140).
    ...(compiled.videoIds?.length ? { videoIds: compiled.videoIds } : {}),
    sections,
    placed,
    lines: lineRefs.length,
    words: placed.reduce((total, ref) => total + wordsOf(ref), 0),
    sourceWords: lineRefs.reduce((total, ref) => total + wordsOf(ref), 0),
    cut,
    settled: [...designed.settled, ...compiled.settled],
  }
}

/*------------------------------------------
 * What the design answer is shown
 *-----------------------------------------*/

/** The most characters of a page's structure a design prompt shows. */
export const AI_SITE_IMPORT_DESIGN_MAX_CHARS = 12_000

/** What a line is, as the design answer reads its place. */
function lineKind(block: SiteImportBlock | undefined, node: SiteImportLayoutLine): string {
  if (!block) return 'line'
  if (block.kind === 'heading') return 'heading'
  if (block.kind === 'link') return node.button ? `${node.button === 'primary' ? 'filled' : node.button === 'secondary' ? 'outlined' : 'quiet'} button` : 'link'
  if (block.kind === 'list-item') return 'list item'
  if (block.kind === 'quote') return 'quote'
  if (block.kind === 'image') return 'picture'
  // A statement is read as the lede it was before the import drew it larger (AGL-4138): the answer's text is unchanged.
  return node.role === 'statement' ? 'lede' : (node.role ?? 'text')
}

/** What an item of a group shows, as one phrase: "icon + title + text + link". */
function itemShape(item: SiteImportLayoutItem): string[] {
  return [
    item.image !== undefined ? 'picture' : '',
    item.icon !== undefined ? 'icon' : '',
    item.figure !== undefined ? 'figure' : '',
    item.title !== undefined ? 'title' : '',
    item.text?.length ? 'text' : '',
    item.list?.length ? `${item.listIcon !== undefined ? 'checked ' : ''}list` : '',
    item.link?.length ? 'link' : '',
  ].filter(Boolean)
}

/** A run of one kind of part counted: "2 buttons", not "button, button". */
function counted(parts: readonly string[]): string {
  const out: string[] = []
  for (let at = 0; at < parts.length; ) {
    let run = 1
    while (parts[at + run] === parts[at]) run += 1
    out.push(run > 1 ? `${run} ${parts[at]}s` : parts[at])
    at += run
  }
  return out.join(', ')
}

/** A section's nodes as the design answer reads them, its groups numbered in order. */
function describeNodes(doc: Pick<AiSiteImportDocument, 'blocks'>, nodes: readonly SiteImportLayoutNode[], groups: { count: number }): string[] {
  const parts: string[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case 'line':
        parts.push(lineKind(doc.blocks[node.line], node))
        break
      case 'picture':
      // A film reads as the picture it opens on (AGL-4140): the design answer is asked nothing new of it.
      case 'video':
        parts.push('picture')
        break
      case 'form':
        parts.push('form')
        break
      case 'row':
        parts.push(`a row of ${node.cells.length} columns (${node.cells.map((cell, index) => `column ${index + 1}: ${describeNodes(doc, cell.nodes, groups).join(', ') || 'empty'}`).join('; ')})`)
        break
      case 'group': {
        groups.count += 1
        const shape = [...new Set(node.items.map((item) => itemShape(item).join(' + ')).filter(Boolean))].slice(0, 2).join(' or ')
        // A group set apart by a rule reads "boxed", as it did before the rule was kept (AGL-4138): the answer's text is unchanged.
        parts.push(`group ${groups.count}: ${node.items.length} ${node.group} in ${node.columns} column${node.columns === 1 ? '' : 's'}${node.boxed || node.rule ? ', boxed' : ''}${shape ? `, each ${shape}` : ''}`)
        break
      }
      case 'table':
        parts.push(`a table of ${node.rows.length} rows`)
        break
      case 'tabs':
        parts.push(`${node.tabs.length} tabs (${node.tabs.map((tab, index) => `tab ${index + 1}: ${describeNodes(doc, tab.panel, groups).join(', ') || 'not drawn'}`).join('; ')})`)
        break
      default:
        break
    }
  }
  return parts
}

/**
 * The page's structure as its design answer reads it (AGL-4107): each
 * section's name, band, alignment and what it shows, its groups numbered as
 * the answer names them. No word of the page is in it but its sections'
 * names, which are fenced where the prompt shows them.
 */
export function aiSiteImportDesignText(doc: Pick<AiSiteImportDocument, 'blocks' | 'title' | 'layout'>): string {
  const layout = aiSiteImportLayoutOf(doc)
  const names = aiSiteImportSectionNames(doc)
  return layout.sections
    .map((section, index) => {
      const groups = { count: 0 }
      const shows = describeNodes(doc, section.nodes, groups)
      const band = section.background === null && !section.backdrop ? 'no band of its own' : `${section.band} band${section.backdrop?.kind === 'gradient' ? ' with a gradient' : ''}`
      const hero = index === 0 && section.hero?.picture ? `; opens the page, its picture ${section.hero.picture} its words` : index === 0 ? '; opens the page, with no picture' : ''
      return `Section ${index + 1} "${names[index]}": ${band}, ${section.align === 'center' ? 'centered' : 'aligned to the start'}${hero}. Groups: ${groups.count}. Shows: ${counted(shows)}.`
    })
    .join('\n')
}
