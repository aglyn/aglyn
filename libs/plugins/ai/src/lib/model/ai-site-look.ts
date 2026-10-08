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

import {
  contrastRatio,
  validateThemeForPublish,
} from '@aglyn/aglyn/app-utils/site-theme'
import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import type {
  HostTheme,
  HostThemeComponentOverride,
  HostThemeSchemeColors,
  HostThemeTypographyVariant,
  HostThemeTypographyVariantKey,
} from '@aglyn/shared-data-types'
import { writeThemeFonts } from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import type { AiTool } from '../runtime/ai-runtime'
import {
  AI_SITE_BASES,
  AI_SITE_CORNERS,
  AI_SITE_FONT_PAIRINGS,
  AI_SITE_GROUNDS,
  AI_SITE_RHYTHMS,
  aiSiteFontPairing,
  type AiSiteBase,
  type AiSiteButtons,
  type AiSiteChroma,
  type AiSiteCorners,
  type AiSiteDensity,
  type AiSiteGround,
  type AiSiteKind,
  type AiSiteRhythm,
} from './ai-site-kinds'

/**
 * A site's look (AGL-3660): one of the platform's base themes, and this
 * site's own customizations layered over it as the site theme's override —
 * the same base-and-edits shape a person's pick on Setup → Theme is stored
 * as, so the Theme page names the base it came from and every edit there
 * starts from what the AI chose.
 *
 * Everything the look decides lives in the THEME, never on a node: palette,
 * fonts, type scale, corners, spacing, and the component defaults and styles
 * of buttons, cards, fields, eyebrows, the header bar and the FAQ. So a Card
 * or a Button a person drags in later looks like the rest of the site, and
 * the layout compiler emits plain components.
 *
 * Three inputs decide it:
 *  - the KIND (`ai-site-kinds.ts`): the family of looks that suit the site;
 *  - the MODEL's choices for this business (`submit_site_look`), any of
 *    which may be missing;
 *  - the per-job SEED, which fills what the model left out from the kind's
 *    options and nudges every hue, chroma and size, so two jobs with the same
 *    brief and the same answers still produce two different themes.
 *
 * Colors are built in OKLCH and held to WCAG: body text 4.5:1 on its ground
 * and on paper, every button label 4.5:1 on its fill, the brand color 3:1 on
 * the page — then the whole theme passes `validateThemeForPublish`, or its
 * colors fall back to the starter theme's.
 */

// ── The tokens ───────────────────────────────────────────────────────────

/** How cards are drawn. */
export const AI_SITE_CARDS = ['flat', 'outlined', 'elevated', 'tinted', 'rule'] as const
export type AiSiteCards = (typeof AI_SITE_CARDS)[number]
/** The form field style. */
export const AI_SITE_FIELDS = ['outlined', 'filled', 'standard'] as const
export type AiSiteFields = (typeof AI_SITE_FIELDS)[number]
/** How an eyebrow above a heading is set. */
export const AI_SITE_EYEBROWS = ['caps', 'small', 'rule'] as const
export type AiSiteEyebrow = (typeof AI_SITE_EYEBROWS)[number]
/** What sets a plain header bar off the page. */
export const AI_SITE_HEADERS = ['line', 'shadow', 'flat'] as const
export type AiSiteHeader = (typeof AI_SITE_HEADERS)[number]
/** Button shapes and casing; `link` draws quiet buttons as underlined links. */
export const AI_SITE_BUTTONS: readonly AiSiteButtons[] = ['rounded', 'pill', 'square', 'caps', 'link']
const DENSITIES: readonly AiSiteDensity[] = ['compact', 'regular', 'airy']

/**
 * A site's style tokens: everything its theme was built from. Stored with the
 * site (`hosts/{id}.siteStyle`) so a later AI edit keeps the look.
 */
export interface AiSiteStyle {
  v: 1
  kind: string
  base: AiSiteBase
  seed: number
  hue: number
  accent: number
  chroma: AiSiteChroma
  ground: AiSiteGround
  fonts: string
  corners: AiSiteCorners
  buttons: AiSiteButtons
  cards: AiSiteCards
  fields: AiSiteFields
  eyebrow: AiSiteEyebrow
  header: AiSiteHeader
  /** The header's arrangement: brand at the start and links after it, or both centered. */
  headerAlign: 'start' | 'center'
  /** How the pages alternate their bands. */
  rhythm: AiSiteRhythm
  headingScale: number
  density: AiSiteDensity
  /** A brand color the brief gave, used as the primary color. */
  brand: string | null
}

/** What the model may choose, every field optional. */
export type AiSiteLookAnswer = Partial<
  Pick<
    AiSiteStyle,
    'base' | 'hue' | 'accent' | 'ground' | 'fonts' | 'corners' | 'buttons' | 'cards' | 'fields' | 'eyebrow' | 'header' | 'brand'
  >
>

// ── The seed ─────────────────────────────────────────────────────────────

/** A job's seed: FNV-1a over its id. */
export function aiSiteSeed(jobId: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < jobId.length; index += 1) {
    hash ^= jobId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A small deterministic generator over a seed (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length) % list.length] as T

// ── The model's answer ───────────────────────────────────────────────────

export const AI_SITE_LOOK_TOOL_NAME = 'submit_site_look'

const enumOf = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description })

/** The strict tool the look is answered with; every field is required and the reader is lenient. */
export const AI_SITE_LOOK_TOOL: AiTool = {
  name: AI_SITE_LOOK_TOOL_NAME,
  description: "Submit this website's look: the base theme it starts from and the choices that make it this business's own.",
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['base', 'hue', 'accent', 'ground', 'fonts', 'corners', 'buttons', 'cards', 'fields', 'eyebrow', 'header', 'brand'],
    properties: {
      base: enumOf(AI_SITE_BASES, 'The base theme to start from, from the list in the request.'),
      hue: { type: 'integer', description: 'The brand color as a hue from 0 to 359 (0 red, 30 orange, 55 gold, 140 green, 190 teal, 220 blue, 270 violet, 330 pink).' },
      accent: { type: 'integer', description: 'The accent color as a hue from 0 to 359, chosen to sit well beside the brand hue.' },
      ground: enumOf(AI_SITE_GROUNDS, 'The page background: white, warm (cream), cool (gray-blue) or tinted (a whisper of the brand color).'),
      fonts: enumOf(AI_SITE_FONT_PAIRINGS.map((pairing) => pairing.id), 'A font pairing from the list in the request.'),
      corners: enumOf(AI_SITE_CORNERS, 'Corner rounding for cards and fields.'),
      buttons: enumOf(AI_SITE_BUTTONS, 'Buttons: rounded, pill, square, caps (capitals) or link (quiet buttons drawn as underlined links).'),
      cards: enumOf(AI_SITE_CARDS, 'Cards: flat, outlined, elevated (a soft shadow), tinted (a wash of the brand color) or rule (a colored line on top).'),
      fields: enumOf(AI_SITE_FIELDS, 'Form fields: outlined, filled or standard (underlined).'),
      eyebrow: enumOf(AI_SITE_EYEBROWS, 'The small label above headings: caps (spaced capitals), small (quiet small text) or rule (capitals after a short line).'),
      header: enumOf(AI_SITE_HEADERS, 'What sets the header bar off the page: a line, a shadow, or flat.'),
      brand: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'A hex brand color the brief gives, exactly as written, or null.' },
    },
  },
}

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined

const hueOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? ((Math.round(value) % 360) + 360) % 360 : undefined

/** A brand color as a six-digit hex, or `null`. */
export function aiSiteBrandHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /#?([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(value.trim())
  if (!match) return null
  const hex = match[1] as string
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
  return `#${full.toLowerCase()}`
}

/** The model's answer, read leniently: a value outside its vocabulary is left for the seed. */
export function aiReadSiteLook(answer: unknown): AiSiteLookAnswer {
  const raw = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
  const look: AiSiteLookAnswer = {}
  const base = oneOf(raw['base'], AI_SITE_BASES)
  if (base) look.base = base
  const hue = hueOf(raw['hue'])
  if (hue !== undefined) look.hue = hue
  const accent = hueOf(raw['accent'])
  if (accent !== undefined) look.accent = accent
  const ground = oneOf(raw['ground'], AI_SITE_GROUNDS)
  if (ground) look.ground = ground
  if (aiSiteFontPairing(raw['fonts'])) look.fonts = raw['fonts'] as string
  const corners = oneOf(raw['corners'], AI_SITE_CORNERS)
  if (corners) look.corners = corners
  const buttons = oneOf(raw['buttons'], AI_SITE_BUTTONS)
  if (buttons) look.buttons = buttons
  const cards = oneOf(raw['cards'], AI_SITE_CARDS)
  if (cards) look.cards = cards
  const fields = oneOf(raw['fields'], AI_SITE_FIELDS)
  if (fields) look.fields = fields
  const eyebrow = oneOf(raw['eyebrow'], AI_SITE_EYEBROWS)
  if (eyebrow) look.eyebrow = eyebrow
  const header = oneOf(raw['header'], AI_SITE_HEADERS)
  if (header) look.header = header
  const brand = aiSiteBrandHex(raw['brand'])
  if (brand) look.brand = brand
  return look
}

// ── Kind, model and seed into tokens ─────────────────────────────────────

/** The building-block styles a kind leans to, before the model or the seed choose. */
const BLOCK_BIAS: Partial<
  Record<string, { cards: readonly AiSiteCards[]; eyebrow: readonly AiSiteEyebrow[]; header: readonly AiSiteHeader[]; fields: readonly AiSiteFields[] }>
> = {
  portfolio: { cards: ['rule', 'flat', 'outlined'], eyebrow: ['small', 'rule', 'caps'], header: ['flat', 'line', 'shadow'], fields: ['standard', 'outlined', 'filled'] },
  studio: { cards: ['flat', 'rule', 'outlined'], eyebrow: ['rule', 'small', 'caps'], header: ['flat', 'line', 'shadow'], fields: ['standard', 'outlined', 'filled'] },
  photography: { cards: ['flat', 'rule', 'outlined'], eyebrow: ['small', 'rule', 'caps'], header: ['flat', 'line', 'shadow'], fields: ['standard', 'outlined', 'filled'] },
  blog: { cards: ['rule', 'outlined', 'flat', 'tinted'], eyebrow: ['small', 'caps', 'rule'], header: ['line', 'flat', 'shadow'], fields: ['outlined', 'standard', 'filled'] },
  trades: { cards: ['elevated', 'outlined', 'rule', 'flat', 'tinted'], eyebrow: ['caps', 'rule', 'small'], header: ['shadow', 'line', 'flat'], fields: ['outlined', 'filled', 'standard'] },
  fitness: { cards: ['elevated', 'flat', 'rule', 'outlined'], eyebrow: ['caps', 'rule', 'small'], header: ['shadow', 'flat', 'line'], fields: ['filled', 'outlined', 'standard'] },
  professional: { cards: ['outlined', 'rule', 'flat', 'elevated'], eyebrow: ['caps', 'rule', 'small'], header: ['line', 'flat', 'shadow'], fields: ['outlined', 'standard', 'filled'] },
  wellness: { cards: ['tinted', 'flat', 'elevated', 'outlined'], eyebrow: ['small', 'caps', 'rule'], header: ['flat', 'line', 'shadow'], fields: ['filled', 'outlined', 'standard'] },
  yoga: { cards: ['tinted', 'flat', 'outlined'], eyebrow: ['small', 'rule', 'caps'], header: ['flat', 'line', 'shadow'], fields: ['filled', 'standard', 'outlined'] },
  restaurant: { cards: ['flat', 'elevated', 'tinted', 'rule'], eyebrow: ['caps', 'rule', 'small'], header: ['flat', 'shadow', 'line'], fields: ['outlined', 'filled', 'standard'] },
  beauty: { cards: ['tinted', 'flat', 'outlined', 'rule'], eyebrow: ['rule', 'small', 'caps'], header: ['flat', 'line', 'shadow'], fields: ['standard', 'filled', 'outlined'] },
  music: { cards: ['flat', 'rule', 'elevated'], eyebrow: ['caps', 'rule', 'small'], header: ['flat', 'shadow', 'line'], fields: ['filled', 'standard', 'outlined'] },
}
const ANY_BLOCKS = { cards: AI_SITE_CARDS, eyebrow: AI_SITE_EYEBROWS, header: AI_SITE_HEADERS, fields: AI_SITE_FIELDS }

/** The hue family a hue is in: twelve families of thirty degrees, 0 the reds. */
export function aiSiteHueFamily(hue: number): number {
  return Math.floor((((hue + 15) % 360) + 360) % 360 / 30)
}

/** Which of a kind's hue ranges a hue falls in, or -1. */
function rangeOf(hue: number, kind: AiSiteKind): number {
  return kind.look.hues.findIndex(([from, to]) => (from <= to ? hue >= from && hue <= to : hue >= from || hue <= to))
}

/** The look dimensions two sites are compared by (`ai-site-look.spec.ts`). */
export const AI_SITE_LOOK_DIMENSIONS = [
  'base',
  'hueFamily',
  'fonts',
  'buttons',
  'cards',
  'corners',
  'ground',
  'eyebrow',
  'header',
  'fields',
  'headerAlign',
  'rhythm',
] as const

/** A style's value on each tracked dimension. */
export function aiSiteLookSignature(style: AiSiteStyle): Record<(typeof AI_SITE_LOOK_DIMENSIONS)[number], string> {
  return {
    base: style.base,
    hueFamily: String(aiSiteHueFamily(style.hue)),
    fonts: style.fonts,
    buttons: style.buttons,
    cards: style.cards,
    corners: style.corners,
    ground: style.ground,
    eyebrow: style.eyebrow,
    header: style.header,
    fields: style.fields,
    headerAlign: style.headerAlign,
    rhythm: style.rhythm,
  }
}

/**
 * The style tokens for a site of this kind (AGL-3660). Every dimension is
 * the SEED's choice among what suits the kind, with the model's choice for
 * this business as a favored candidate — kept at a given chance, not always
 * — so the brief steers the look and two jobs with the same brief and the
 * same answer still come out as two sites: another base, another hue family,
 * another pairing, other buttons. A brand color the brief gives is always
 * kept.
 */
export function aiSiteStyleFor(input: {
  kind: AiSiteKind
  answer: AiSiteLookAnswer
  seed: number
  brand?: string | null
  /**
   * The looks of the workspace's other sites (AGL-3660): a look that shares
   * one's base, hue family, heading font and buttons, or differs from one in
   * fewer than three tracked dimensions, is drawn again from the next seed.
   */
  avoid?: readonly AiSiteStyle[]
}): AiSiteStyle {
  const avoid = input.avoid ?? []
  if (!avoid.length) return styleOnce(input, input.seed)
  const signatures = avoid.map(aiSiteLookSignature)
  let best: { style: AiSiteStyle; least: number } | null = null
  for (let attempt = 0; attempt < AI_SITE_LOOK_DRAWS; attempt += 1) {
    const style = styleOnce(input, attempt === 0 ? input.seed : (Math.imul(input.seed ^ 0x5bd1e995, attempt + 1) >>> 0))
    const own = aiSiteLookSignature(style)
    const least = Math.min(
      ...signatures.map((other) =>
        TUPLE.every((dimension) => own[dimension] === other[dimension])
          ? -1
          : AI_SITE_LOOK_DIMENSIONS.filter((dimension) => own[dimension] !== other[dimension]).length,
      ),
    )
    if (least >= AI_SITE_LOOK_LEAST_DIFFERENCES) return style
    if (!best || least > best.least) best = { style, least }
  }
  return (best as { style: AiSiteStyle }).style
}

/** How many seeds a look draws before it settles for the most different. */
export const AI_SITE_LOOK_DRAWS = 32
/** The fewest tracked dimensions in which two of a workspace's sites differ. */
export const AI_SITE_LOOK_LEAST_DIFFERENCES = 3
/** The dimensions no two of a workspace's sites share all of. */
const TUPLE = ['base', 'hueFamily', 'fonts', 'buttons'] as const

function styleOnce(
  input: { kind: AiSiteKind; answer: AiSiteLookAnswer; brand?: string | null },
  seed: number,
): AiSiteStyle {
  const { kind, answer } = input
  const next = random(seed)
  const family = kind.look
  const blocks = BLOCK_BIAS[kind.id] ?? ANY_BLOCKS
  /** The model's choice at a chance of `keep`, else the seed's among `options`. */
  const choose = <T,>(model: T | undefined, options: readonly T[], keep: number): T =>
    model !== undefined && next() < keep ? model : pick(next, options)

  // The hue: a family among the kind's (the brief's industry), the model's
  // own family favored, and a hue within it.
  const modelRange = answer.hue === undefined ? -1 : rangeOf(answer.hue, kind)
  const keepHue = modelRange !== -1 && next() < 0.3
  const range = keepHue ? modelRange : Math.floor(next() * family.hues.length) % family.hues.length
  const [from, to] = family.hues[range] as readonly [number, number]
  const span = from <= to ? to - from : 360 - from + to
  const hue = keepHue
    ? ((answer.hue as number) + (next() < 0.5 ? -1 : 1) * Math.round(4 + next() * 8) + 360) % 360
    : Math.round(from + next() * span) % 360
  const accentFrom = answer.accent !== undefined && next() < 0.4 ? answer.accent : (hue + pick(next, [30, 150, 180, 210, 330])) % 360
  const accent = (accentFrom + (next() < 0.5 ? -1 : 1) * Math.round(8 + next() * 16) + 360) % 360

  const bases = [...new Set([...(answer.base ? [answer.base] : []), ...family.bases])]
  return {
    v: 1,
    kind: kind.id,
    base: choose(answer.base, bases, 0.3),
    seed,
    hue,
    accent,
    chroma: family.chroma,
    ground: choose(answer.ground, family.grounds, 0.35),
    fonts: choose(answer.fonts, family.fonts, 0.3),
    corners: choose(answer.corners, family.corners, 0.35),
    buttons: choose(answer.buttons, [family.buttons, ...AI_SITE_BUTTONS], 0.3),
    cards: choose(answer.cards, blocks.cards, 0.35),
    fields: choose(answer.fields, blocks.fields, 0.35),
    eyebrow: choose(answer.eyebrow, blocks.eyebrow, 0.35),
    header: choose(answer.header, blocks.header, 0.35),
    headerAlign: pick(next, family.headerAligns ?? ['start', 'start', 'center']),
    rhythm: pick(next, family.rhythms ?? AI_SITE_RHYTHMS),
    headingScale: Math.round(family.headingScale * (0.94 + next() * 0.12) * 100) / 100,
    density: family.density === 'regular' && next() < 0.25 ? pick(next, DENSITIES) : family.density,
    brand: aiSiteBrandHex(input.brand) ?? answer.brand ?? null,
  }
}

// ── Color ────────────────────────────────────────────────────────────────

type Rgb = [number, number, number]

function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const toSrgb = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
const fromSrgb = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

/** An OKLCH color as hex, its chroma reduced until it fits sRGB. */
export function aiOklchHex(L: number, C: number, h: number): string {
  const lightness = Math.min(1, Math.max(0, L))
  let chroma = Math.max(0, C)
  for (;;) {
    const radians = (h * Math.PI) / 180
    const linear = oklabToLinear(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians))
    const fits = linear.every((channel) => channel >= -0.0005 && channel <= 1.0005)
    if (fits || chroma <= 0) {
      return `#${linear
        .map((channel) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, channel))))) * 255))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')}`
    }
    chroma = Math.max(0, chroma - 0.004)
  }
}

/** A hex color in OKLCH. */
export function aiHexOklch(hex: string): { L: number; C: number; h: number } {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((at) => fromSrgb(parseInt(value.slice(at, at + 2), 16) / 255)) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 1

/** The lightness, stepped from `L` toward `toward`, at which `hex(L)` first reaches `min` against `against`. */
function untilContrast(L: number, C: number, h: number, against: string, min: number, toward: 0 | 1): number {
  let lightness = L
  for (let step = 0; step < 60; step += 1) {
    if (ratio(aiOklchHex(lightness, C, h), against) >= min) return lightness
    lightness += toward ? 0.012 : -0.012
    if (lightness <= 0.05 || lightness >= 0.98) break
  }
  return lightness
}

/** The label color of a fill: white or a deep ink of its hue, whichever reads at 4.5:1, or better. */
function labelOn(fill: string, h: number): string {
  const white = '#ffffff'
  const ink = aiOklchHex(0.2, 0.04, h)
  return ratio(white, fill) >= 4.5 ? white : ratio(ink, fill) >= 4.5 ? ink : ratio(white, fill) > ratio(ink, fill) ? white : '#000000'
}

const CHROMA: Record<AiSiteChroma, number> = { neutral: 0.15, muted: 0.085, balanced: 0.135, vivid: 0.185 }
const START_L: Record<AiSiteChroma, number> = { neutral: 0.52, muted: 0.48, balanced: 0.52, vivid: 0.56 }

/** Both schemes' colors for a style. */
export function aiSiteColors(style: AiSiteStyle): { light: HostThemeSchemeColors; dark: HostThemeSchemeColors } {
  const next = random(style.seed ^ 0x9e3779b9)
  const neutral = style.chroma === 'neutral'
  const brand = style.brand ? aiHexOklch(style.brand) : null
  const h = brand?.h ?? style.hue
  const chroma = brand?.C ?? CHROMA[style.chroma] * (0.9 + next() * 0.2)
  const groundChroma = neutral ? 0.3 : 1
  const white = '#ffffff'

  // The page grounds.
  const grounds: Record<AiSiteGround, { L: number; C: number; h: number; paper: [number, number] }> = {
    white: { L: 0.985, C: 0.004, h, paper: [1, 0] },
    warm: { L: 0.972, C: 0.016, h: 78, paper: [0.993, 0.007] },
    cool: { L: 0.974, C: 0.009, h: 250, paper: [1, 0] },
    tinted: { L: 0.968, C: 0.02, h, paper: [0.994, 0.006] },
  }
  const ground = grounds[style.ground]
  const background = aiOklchHex(ground.L, ground.C * groundChroma, ground.h)
  const paper = aiOklchHex(ground.paper[0], ground.paper[1] * groundChroma, ground.h)

  // The brand color: a button label reads on it, so it reads on the page too.
  let primaryMain: string
  let primaryL: number
  if (brand && ratio(white, style.brand as string) >= 4.5) {
    primaryMain = style.brand as string
    primaryL = brand.L
  } else {
    primaryL = untilContrast(brand ? Math.min(brand.L, START_L[style.chroma]) : START_L[style.chroma] + (next() - 0.5) * 0.06, chroma, h, white, 4.6, 0)
    primaryMain = aiOklchHex(primaryL, chroma, h)
  }
  const accentChroma = neutral ? 0.17 : Math.max(0.07, chroma * 0.95)

  // The secondary color fills a button ON a brand band, so it stands apart from the brand color.
  const secondary = neutral
    ? { main: aiOklchHex(0.24, 0.012, h), h }
    : (() => {
        // A light wash of the accent rather than the accent at full strength:
        // it reads on the brand color without fighting it.
        const washChroma = Math.min(accentChroma, 0.08)
        let L = 0.9
        let main = aiOklchHex(L, washChroma, style.accent)
        while (ratio(main, primaryMain) < 3 && L < 0.96) {
          L += 0.02
          main = aiOklchHex(L, washChroma, style.accent)
        }
        return { main, h: style.accent }
      })()
  const tertiaryHue = (style.accent + 60) % 360
  const tertiaryL = untilContrast(0.52, 0.12, tertiaryHue, white, 4.6, 0)
  const tertiary = aiOklchHex(tertiaryL, 0.12, tertiaryHue)
  const textChroma = neutral ? 0.006 : 0.02

  const light: HostThemeSchemeColors = {
    primary: {
      main: primaryMain,
      light: aiOklchHex(Math.min(0.92, primaryL + 0.12), chroma, h),
      dark: aiOklchHex(Math.max(0.15, primaryL - 0.1), chroma, h),
      contrastText: labelOn(primaryMain, h),
    },
    secondary: {
      main: secondary.main,
      light: aiOklchHex(0.93, accentChroma * 0.6, secondary.h),
      dark: aiOklchHex(0.42, accentChroma, secondary.h),
      contrastText: labelOn(secondary.main, secondary.h),
    },
    tertiary: {
      main: tertiary,
      light: aiOklchHex(Math.min(0.9, tertiaryL + 0.14), 0.12, tertiaryHue),
      dark: aiOklchHex(Math.max(0.15, tertiaryL - 0.1), 0.12, tertiaryHue),
      contrastText: labelOn(tertiary, tertiaryHue),
    },
    surface: { main: aiOklchHex(0.955, 0.012 * groundChroma, h), contrastText: aiOklchHex(0.22, textChroma, h) },
    background: { default: background, paper },
    text: {
      primary: aiOklchHex(0.22, textChroma, h),
      secondary: aiOklchHex(0.45, textChroma + 0.005, h),
      disabled: aiOklchHex(0.68, 0.01, h),
    },
    tint: {
      primary: aiOklchHex(0.955, neutral ? 0.03 : 0.035, neutral ? style.accent : h),
      secondary: aiOklchHex(0.955, 0.035, style.accent),
      tertiary: aiOklchHex(0.955, 0.03, tertiaryHue),
    },
    divider: aiOklchHex(0.9, 0.012 * groundChroma, h),
  }

  const darkGround = style.ground === 'tinted' ? 0.024 : style.ground === 'warm' ? 0.014 : 0.012
  const darkBackground = aiOklchHex(0.17, darkGround * groundChroma, style.ground === 'warm' ? 60 : h)
  const darkPaper = aiOklchHex(0.215, darkGround * groundChroma, style.ground === 'warm' ? 60 : h)
  const darkChroma = Math.min(chroma, 0.14)
  const darkPrimaryL = untilContrast(0.78, darkChroma, h, darkBackground, 4.5, 1)
  const darkPrimary = aiOklchHex(darkPrimaryL, darkChroma, h)
  const darkSecondary = neutral ? aiOklchHex(0.93, 0.01, h) : aiOklchHex(0.45, accentChroma * 0.85, style.accent)
  const darkTertiary = aiOklchHex(0.8, 0.1, tertiaryHue)
  const dark: HostThemeSchemeColors = {
    primary: {
      main: darkPrimary,
      light: aiOklchHex(Math.min(0.94, darkPrimaryL + 0.08), darkChroma, h),
      dark: aiOklchHex(darkPrimaryL - 0.1, darkChroma, h),
      contrastText: labelOn(darkPrimary, h),
    },
    secondary: {
      main: darkSecondary,
      light: aiOklchHex(0.6, accentChroma * 0.7, secondary.h),
      dark: aiOklchHex(0.35, accentChroma * 0.7, secondary.h),
      contrastText: labelOn(darkSecondary, secondary.h),
    },
    tertiary: {
      main: darkTertiary,
      light: aiOklchHex(0.88, 0.08, tertiaryHue),
      dark: aiOklchHex(0.7, 0.1, tertiaryHue),
      contrastText: labelOn(darkTertiary, tertiaryHue),
    },
    surface: { main: aiOklchHex(0.25, 0.014 * groundChroma, h), contrastText: aiOklchHex(0.95, 0.01, h) },
    background: { default: darkBackground, paper: darkPaper },
    text: {
      primary: aiOklchHex(0.95, 0.008, h),
      secondary: aiOklchHex(0.77, 0.014, h),
      disabled: aiOklchHex(0.52, 0.01, h),
    },
    tint: {
      primary: aiOklchHex(0.27, 0.05, neutral ? style.accent : h),
      secondary: aiOklchHex(0.27, 0.05, style.accent),
      tertiary: aiOklchHex(0.27, 0.04, tertiaryHue),
    },
    divider: aiOklchHex(0.32, 0.015 * groundChroma, h),
  }
  return { light, dark }
}

// ── The theme ────────────────────────────────────────────────────────────

const RADIUS: Record<AiSiteCorners, number> = { sharp: 2, soft: 6, round: 12, pill: 18 }
const SPACING: Record<AiSiteDensity, number> = { compact: 7, regular: 8, airy: 9 }

/** How much of the heading scale each style takes: a display line grows most, small headings not at all. */
const SCALE_SHARE: Partial<Record<HostThemeTypographyVariantKey, { size: number; share: number }>> = {
  displayXl: { size: 4, share: 1.2 },
  h1: { size: 3.25, share: 1 },
  h2: { size: 2.25, share: 0.8 },
  h3: { size: 1.75, share: 0.5 },
  h4: { size: 1.5, share: 0.3 },
  h5: { size: 1.25, share: 0 },
  h6: { size: 1.125, share: 0 },
}

const rem = (value: number) => `${Math.round(value * 1000) / 1000}rem`

/** The type a style sets: headings at its scale, weight and tracking, and the eyebrow and button styles. */
function typographyFor(style: AiSiteStyle): HostTheme['typography'] {
  const pairing = aiSiteFontPairing(style.fonts) ?? (AI_SITE_FONT_PAIRINGS[0] as NonNullable<ReturnType<typeof aiSiteFontPairing>>)
  const variants: Partial<Record<HostThemeTypographyVariantKey, HostThemeTypographyVariant>> = {
    ...(DEFAULT_SITE_THEME.typography?.variants ?? {}),
  }
  for (const [key, { size, share }] of Object.entries(SCALE_SHARE) as Array<[HostThemeTypographyVariantKey, { size: number; share: number }]>) {
    const big = key === 'displayXl' || key === 'h1' || key === 'h2'
    const variant: HostThemeTypographyVariant = {
      fontSize: rem(size * (1 + (style.headingScale - 1) * share) * (pairing.caps && big ? 0.92 : 1)),
      fontWeight: big ? pairing.heading.weight : pairing.heading.sub,
      lineHeight: big ? (pairing.caps ? 1.05 : 1.1) : 1.25,
    }
    if (pairing.tracking !== undefined && (big || key === 'h3')) variant.letterSpacing = `${pairing.tracking}em`
    if (pairing.caps && (big || key === 'h3')) variant.textTransform = 'uppercase'
    variants[key] = variant
  }
  const bodyBold = pairing.body.weights.includes(600) ? 600 : 700
  variants.overline =
    style.eyebrow === 'small'
      ? { fontSize: '0.875rem', fontWeight: bodyBold, letterSpacing: '0.01em', textTransform: 'none' }
      : { fontSize: '0.78rem', fontWeight: 700, letterSpacing: style.eyebrow === 'rule' ? '0.16em' : '0.12em', textTransform: 'uppercase' }
  variants.button = {
    fontWeight: style.buttons === 'caps' ? 700 : bodyBold,
    textTransform: style.buttons === 'caps' ? 'uppercase' : 'none',
    ...(style.buttons === 'caps' ? { letterSpacing: '0.06em' } : {}),
  }
  return { variants }
}

/** The card's look, in theme terms only: palette paths, shadow indexes and border widths. */
function cardSx(cards: AiSiteCards): Record<string, unknown> {
  switch (cards) {
    case 'flat':
      return { boxShadow: 0, border: 0, bgcolor: 'surface.main' }
    case 'outlined':
      return { boxShadow: 0, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }
    case 'elevated':
      return { boxShadow: 3, border: 0, bgcolor: 'background.paper' }
    case 'tinted':
      return { boxShadow: 0, border: 0, bgcolor: 'tint.primary' }
    case 'rule':
      return { boxShadow: 0, border: 0, borderTop: 3, borderColor: 'primary.main', borderRadius: 0, bgcolor: 'background.paper' }
  }
}

/** The component defaults and styles a style sets: buttons, cards, fields, eyebrows, the header bar and the FAQ. */
function componentsFor(style: AiSiteStyle): Record<string, HostThemeComponentOverride> {
  const radius = RADIUS[style.corners]
  const buttonRadius = style.buttons === 'pill' ? 999 : style.buttons === 'square' ? 2 : radius
  const card = cardSx(style.cards)
  return {
    MuiButton: {
      defaultProps: { disableElevation: true },
      // 44px: the touch target a visitor's thumb needs.
      styleOverrides: { root: { borderRadius: buttonRadius, minHeight: 44, boxShadow: 'none' } },
      ...(style.buttons === 'link'
        ? {
            variants: [
              {
                props: { variant: 'text' },
                style: { textDecoration: 'underline', textUnderlineOffset: '0.3em', textDecorationThickness: '2px' },
              },
            ],
          }
        : {}),
    },
    MuiCard: {
      defaultProps:
        style.cards === 'outlined'
          ? { variant: 'outlined' }
          : { variant: 'elevation', elevation: style.cards === 'elevated' ? 3 : 0 },
      styleOverrides: { root: { borderRadius: style.cards === 'rule' ? 0 : Math.max(radius, 4) } },
      sx: { root: card },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      sx: {
        root: {
          ...card,
          borderTop: style.cards === 'rule' ? 1 : card['borderTop'] ?? card['border'],
          '&::before': { display: 'none' },
          '&:not(:last-of-type)': { mb: 1 },
        },
      },
    },
    MuiTextField: { defaultProps: { variant: style.fields } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: radius } } },
    MuiFilledInput: { styleOverrides: { root: { borderTopLeftRadius: radius, borderTopRightRadius: radius } } },
    MuiChip: { styleOverrides: { root: { borderRadius: style.corners === 'sharp' ? 2 : 999 } } },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      variants: [
        {
          props: { color: 'inherit' },
          sx:
            style.header === 'line'
              ? { boxShadow: 0, borderBottom: 1, borderColor: 'divider' }
              : style.header === 'shadow'
                ? { boxShadow: 2, borderBottom: 0 }
                : { boxShadow: 0, borderBottom: 0 },
        },
      ],
    },
    ...(style.eyebrow === 'rule'
      ? {
          MuiTypography: {
            variants: [
              {
                props: { variant: 'overline' },
                // A short line in the eyebrow's own color, so it reads on any band.
                style: {
                  '&::before': {
                    content: '""',
                    display: 'inline-block',
                    width: '1.75em',
                    height: '2px',
                    marginRight: '0.75em',
                    verticalAlign: 'middle',
                    backgroundColor: 'currentColor',
                  },
                },
              },
            ],
          },
        }
      : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `over` merged into `under`, objects key by key, anything else replaced. */
function merged<T>(under: T, over: unknown): T {
  if (!isRecord(under) || !isRecord(over)) return (over === undefined ? under : over) as T
  const out: Record<string, unknown> = { ...under }
  for (const [key, value] of Object.entries(over)) out[key] = key in out ? merged(out[key], value) : value
  return out as T
}

/** Whether a theme passes the publish check and the brand-on-page contrast the doctrine asks. */
function themeReads(theme: HostTheme): boolean {
  if (!validateThemeForPublish(theme).ok) return false
  for (const scheme of ['light', 'dark'] as const) {
    const colors = theme.colorSchemes?.[scheme]
    const main = colors?.primary?.main
    const page = colors?.background?.default
    if (!main || !page || ratio(main, page) < 3) return false
    for (const key of ['primary', 'secondary', 'tertiary'] as const) {
      const fill = colors?.[key]
      if (fill?.main && fill.contrastText && ratio(fill.contrastText, fill.main) < 4.5) return false
    }
  }
  return true
}

/**
 * The site's theme: the base theme with this style layered over it. Colors,
 * type, corners, spacing and the building blocks' component styles are the
 * site's own; whatever the base sets beyond them — its focus rings, its menu
 * and dialog styles, its control heights — stays the base's.
 */
export function aiSiteTheme(style: AiSiteStyle, base: HostTheme): HostTheme {
  const pairing = aiSiteFontPairing(style.fonts) ?? (AI_SITE_FONT_PAIRINGS[0] as NonNullable<ReturnType<typeof aiSiteFontPairing>>)
  const colors = aiSiteColors(style)
  const keep = (scheme: 'light' | 'dark') => {
    const own = base.colorSchemes?.[scheme] ?? {}
    // The status colors stay the base's: they mean the same thing on every site.
    return {
      ...(own.error ? { error: own.error } : {}),
      ...(own.warning ? { warning: own.warning } : {}),
      ...(own.info ? { info: own.info } : {}),
      ...(own.success ? { success: own.success } : {}),
      ...colors[scheme],
    }
  }
  let theme: HostTheme = {
    ...base,
    colorSchemes: { light: keep('light'), dark: keep('dark') },
    typography: merged(base.typography ?? {}, typographyFor(style)),
    shape: { ...(base.shape ?? {}), borderRadius: RADIUS[style.corners] },
    spacing: SPACING[style.density],
    components: merged(base.components ?? {}, componentsFor(style)),
  }
  delete theme.darkScheme
  const sameFamily = pairing.heading.family === pairing.body.family
  theme = writeThemeFonts(theme, {
    body: { family: pairing.body.family, category: pairing.body.category, weights: [...pairing.body.weights], source: 'google' },
    heading: sameFamily
      ? null
      : {
          family: pairing.heading.family,
          category: pairing.heading.category,
          weights: [...new Set([pairing.heading.weight, pairing.heading.sub])].sort((a, b) => a - b),
          source: 'google',
        },
  })
  // A pairing whose heading is the body family loads the heading weights too.
  if (sameFamily && theme.fonts?.[0]) {
    theme.fonts[0] = {
      ...theme.fonts[0],
      weights: [...new Set([...(theme.fonts[0].weights ?? []), pairing.heading.weight, pairing.heading.sub])].sort((a, b) => a - b),
    }
  }
  if (!themeReads(theme)) {
    // Never a theme that fails the reading checks: the starter's colors, with everything else kept.
    theme = { ...theme, colorSchemes: DEFAULT_SITE_THEME.colorSchemes }
  }
  return theme
}
