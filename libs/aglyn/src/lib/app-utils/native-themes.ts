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

/**
 * THE NATIVE APPS' THEMES, AS DATA (AGL-3950).
 *
 * The values are read from the Native App Figma file's variables (Themes,
 * page 2:8; collections Aglyn / Theme, Aglyn / Appearance, Aglyn / Accent,
 * Aglyn / Brand and Aglyn / Density), which win wherever they define a value:
 *
 * - `THEME_PALETTES`: Aglyn is the look that ships, the console's resolved
 *   MUI scheme (see `AGLYN_LIGHT`); Quiet, Night and High contrast, light and
 *   dark, are exactly as Figma's Theme modes hold them. Ocean and Warm exist in Figma
 *   only as four-color previews (rail, surface, canvas, accent), so their
 *   full palettes are derived here by `deriveThemeFromPreview`, the rule
 *   below, and drawn back into Figma as swatch boards.
 * - `THEME_ACCENTS`: the Accent modes Blue, Violet, Pink and Workspace
 *   brand, exactly. `deriveAccent` returns them for their ring colors and
 *   derives any other color (a picked accent, a workspace's brand) by rule.
 * - `THEME_ACCENT_SWATCHES`: the five swatches the Theme settings sheet shows.
 * - `THEME_RETIRED_ACCENTS`: retired blues, and the brand blue each reads as.
 * - `THEME_DENSITIES`: Comfortable and Compact.
 *
 * Contrast is WCAG 2's relative luminance, as `accessible-shade.ts` (the
 * console's theme) measures it; lightness steps are HSL lightness, as it
 * walks them.
 *
 * NO IMPORTS, on purpose: the native apps read the values, the types and the
 * answers of these functions through the generated contracts.
 */

/** A theme the apps offer. */
export type ThemePaletteId = 'aglyn' | 'quiet' | 'night' | 'ocean' | 'warm' | 'highContrast'

/** One appearance of a theme: every color a native screen draws from. */
export interface ThemeColors {
  canvas: string
  surface: string
  raised: string
  sunken: string
  rail: string
  hover: string
  titlebar: string
  borderSubtle: string
  borderStrong: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  successBg: string
  successFg: string
  warningBg: string
  warningFg: string
  dangerBg: string
  dangerFg: string
  infoBg: string
  infoFg: string
  newBg: string
  newFg: string
  /** `#RRGGBBAA`: the wash behind a sheet. */
  scrim: string
  /** A destructive button's fill, and its hover and pressed fills. */
  dangerFill: string
  dangerFillHover: string
  dangerFillPressed: string
}

/**
 * Where a theme's values come from: the console's resolved MUI scheme (the
 * look that ships, Aglyn), Figma's variables, or derived from a Figma preview.
 */
export type ThemeSource = 'console' | 'figma' | 'derived'

export interface ThemePalette {
  id: ThemePaletteId
  /** The name a picker shows; empty when `brandLabel` says to show the configured brand name. */
  label: string
  /** The theme is named after the product: show the build's configured brand name (white-label safe). */
  brandLabel?: boolean
  light: ThemeColors
  dark: ThemeColors
  /** The theme's own accent ("Accent: Theme"), as a raw color for `deriveAccent`. */
  accent: string
  /** Night is the same in both appearances: the theme is always dark. */
  alwaysDark?: boolean
  source: ThemeSource
}

/** An accent, as every control that paints it reads it. */
export interface ThemeAccent {
  /** A filled control's background. */
  fill: string
  /** An icon or an indicator in the accent, on the light surfaces. */
  icon: string
  /** `#RRGGBBAA`: a selected row's or a chip's wash. */
  soft: string
  /** The focus ring: the raw accent. */
  ring: string
  /** Text and icons ON `fill`. */
  on: string
  hover: string
  pressed: string
  /** The accent as text on the light surface, at 4.5:1. */
  textLight: string
  /** The accent as text on the dark surface, at 4.5:1. */
  textDark: string
}

/** An accent the Theme settings sheet offers by name (Figma's Accent modes). */
export interface ThemeNamedAccent {
  id: string
  label: string
  accent: ThemeAccent
}

/** A swatch of the accent picker. */
export interface ThemeAccentSwatch {
  id: string
  label: string
  color: string
}

export type ThemeDensityId = 'comfortable' | 'compact'

/** One density's sizes, in points (Apple) and dp (Android). */
export interface ThemeDensity {
  id: ThemeDensityId
  label: string
  space2: number
  space4: number
  space6: number
  space8: number
  space10: number
  space12: number
  space16: number
  space20: number
  space24: number
  space32: number
  space40: number
  space48: number
  space64: number
  radiusXs: number
  radiusSm: number
  radiusMd: number
  radiusLg: number
  radiusXl: number
  radius2xl: number
  radiusFull: number
  rowHeight: number
  controlHeight: number
  listRowHeight: number
  phoneRowHeight: number
  titlebarHeight: number
}

/** The four colors Figma previews a theme by. */
export interface ThemePreview {
  rail: string
  surface: string
  canvas: string
  accent: string
}

// ── Color arithmetic ────────────────────────────────────────────────────────

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i

/** `[r, g, b]` in 0–255, or null for anything that is not `#RRGGBB(AA)`. */
function channels(color: string): [number, number, number] | null {
  const match = HEX.exec(color ?? '')
  if (!match) return null
  const value = match[1]
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)) as [number, number, number]
}

function hexOf(rgb: readonly number[]): string {
  return `#${rgb
    .map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0'))
    .join('')}`
}

/** Whether a value is `#RRGGBB`. */
export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function linear(channel: number): number {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: readonly number[]): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/** WCAG 2 contrast between two `#RRGGBB` colors, as the console's `contrastRatio` measures it. */
export function themeContrast(a: string, b: string): number {
  const x = channels(a)
  const y = channels(b)
  if (!x || !y) return 1
  const [high, low] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (high + 0.05) / (low + 0.05)
}

function toHsl([r, g, b]: readonly number[]): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0)
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return [hue / 6, saturation, lightness]
}

function fromHsl(hue: number, saturation: number, lightness: number): string {
  const l = Math.min(1, Math.max(0, lightness))
  if (saturation === 0) return hexOf([l * 255, l * 255, l * 255])
  const q = l < 0.5 ? l * (1 + saturation) : l + saturation - l * saturation
  const p = 2 * l - q
  const channel = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return hexOf([channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255])
}

/** `color` with its HSL lightness moved by `delta` (−1 to 1). */
function shiftLightness(color: string, delta: number): string {
  const rgb = channels(color)
  if (!rgb) return color
  const [h, s, l] = toHsl(rgb)
  return fromHsl(h, s, l + delta)
}

/**
 * `color` walked in 2% HSL-lightness steps (darker, or lighter) until it
 * reaches `minContrast` against `against`; the pole when nothing reaches it.
 */
function walkToContrast(color: string, against: string, minContrast: number, direction: -1 | 1): string {
  let candidate = color
  for (let step = 0; step <= 50; step += 1) {
    candidate = shiftLightness(color, direction * 0.02 * step)
    if (themeContrast(candidate, against) >= minContrast) return candidate
  }
  return candidate
}

/** `from` moved `amount` (0–1) of the way to `to`, per sRGB channel. */
export function themeLerp(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)
  if (!a || !b) return from
  return hexOf(a.map((value, index) => value + (b[index] - value) * amount))
}

/** `color` with an alpha byte: `#RRGGBBAA`. */
function withAlpha(color: string, alpha: number): string {
  const rgb = channels(color)
  if (!rgb) return color
  return `${hexOf(rgb)}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
}

// ── Themes ──────────────────────────────────────────────────────────────────

/** Text that must read on every surface: WCAG AA. */
export const THEME_TEXT_CONTRAST = 4.5

/** An icon, a border or an indicator: WCAG AA for non-text. */
export const THEME_NON_TEXT_CONTRAST = 3

const DANGER_LIGHT = { dangerFill: '#b3261e', dangerFillHover: '#9c211a', dangerFillPressed: '#861c16' }
const DANGER_DARK = { dangerFill: '#c93a31', dangerFillHover: '#b3261e', dangerFillPressed: '#9c211a' }

/**
 * Figma's Aglyn mode as it stood before that mode moved to the console's
 * scheme (2026-10-19): the base Quiet's status colors and the Ocean and Warm
 * derivations build on, as the native shells' themes already do. Kept by
 * value, so moving the shipping Aglyn look moves nothing else.
 */
const FIGMA_AGLYN_LIGHT: ThemeColors = {
  canvas: '#f5f5f5',
  surface: '#ffffff',
  raised: '#ffffff',
  sunken: '#edf0f4',
  rail: '#e6eaf0',
  hover: '#eef1f5',
  titlebar: '#fafbfc',
  borderSubtle: '#e3e7ec',
  borderStrong: '#c8d0d9',
  textPrimary: '#1f2329',
  textSecondary: '#5e6773',
  textTertiary: '#7a838e',
  successBg: '#e5f3e6',
  successFg: '#2e6f31',
  warningBg: '#fff0da',
  warningFg: '#85560f',
  dangerBg: '#fce6e5',
  dangerFg: '#a8231e',
  infoBg: '#e3f0fb',
  infoFg: '#10548f',
  newBg: '#f5e4f9',
  newFg: '#8e2aa1',
  scrim: '#0f172152',
  ...DANGER_LIGHT,
}

const FIGMA_AGLYN_DARK: ThemeColors = {
  canvas: '#161c21',
  surface: '#1e262e',
  raised: '#27313b',
  sunken: '#12181d',
  rail: '#0f1418',
  hover: '#2a343e',
  titlebar: '#1a2128',
  borderSubtle: '#2e3944',
  borderStrong: '#45525f',
  textPrimary: '#f3f5f7',
  textSecondary: '#b3bcc6',
  textTertiary: '#8a96a3',
  successBg: '#1b3320',
  successFg: '#82c785',
  warningBg: '#3a2c14',
  warningFg: '#ffc479',
  dangerBg: '#3b1a1a',
  dangerFg: '#ed7876',
  infoBg: '#132c42',
  infoFg: '#5da1dc',
  newBg: '#3a1e44',
  newFg: '#e979fc',
  scrim: '#0000008c',
  ...DANGER_DARK,
}

/** A light and a dark palette. */
export interface ThemeColorsPair {
  light: ThemeColors
  dark: ThemeColors
}

/**
 * The palettes `deriveThemeFromPreview` starts from (the original Figma Aglyn
 * mode), exported so each platform can port the derivation and replay its
 * cases against the same base.
 */
export const THEME_FIGMA_BASE: ThemeColorsPair = { light: FIGMA_AGLYN_LIGHT, dark: FIGMA_AGLYN_DARK }

/**
 * The Aglyn theme is the look that ships: the console's resolved MUI scheme
 * (`getConsoleTheme`, the same scheme the native shared tokens are generated
 * from), with translucent text, dividers and hover composited onto the paper
 * they sit on, and the status colors as the console's MUI Alert draws them
 * (standard: the intent's light shade lightened 90% for the ground and
 * darkened 60% for the text in light, the reverse in dark). Where the console
 * scheme has no such color (sunken, rail, titlebar, the strong border, the
 * "new" status, the scrim) Figma's Aglyn mode supplies it, and so does the
 * danger FILL: the console's `error.main` carries white text at 4.36:1, under
 * the 4.5:1 a button label owes. `apps/console/specs/native-theme-aglyn.spec.ts`
 * holds these to the console's scheme.
 */
const AGLYN_LIGHT: ThemeColors = {
  ...FIGMA_AGLYN_LIGHT,
  canvas: '#f5f5f5',
  surface: '#ffffff',
  raised: '#ffffff',
  hover: '#f5f5f5',
  borderSubtle: '#e0e0e0',
  textPrimary: '#212121',
  textSecondary: '#666666',
  textTertiary: '#9e9e9e',
  successBg: '#f0f8f1',
  successFg: '#2c4c2e',
  warningBg: '#fff8ef',
  warningFg: '#664a28',
  dangerBg: '#fceeed',
  dangerFg: '#5c2220',
  infoBg: '#ecf4fb',
  infoFg: '#1c3a56',
}

const AGLYN_DARK: ThemeColors = {
  ...FIGMA_AGLYN_DARK,
  canvas: '#161c21',
  surface: '#2a3440',
  raised: '#2a3440',
  hover: '#3b444f',
  borderSubtle: '#444c57',
  textPrimary: '#ffffff',
  textSecondary: '#bfc2c6',
  textTertiary: '#959aa0',
  successBg: '#0b130b',
  successFg: '#c5e5c7',
  warningBg: '#19120a',
  warningFg: '#ffe3c1',
  dangerBg: '#170c0b',
  dangerFg: '#f7c9c8',
  infoBg: '#091015',
  infoFg: '#bfd9f1',
}

/** The Aglyn theme's fields the console's scheme supplies; the rest are Figma's Aglyn mode. */
export const THEME_CONSOLE_FIELDS: readonly string[] = [
  'canvas',
  'surface',
  'raised',
  'hover',
  'borderSubtle',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'successBg',
  'successFg',
  'warningBg',
  'warningFg',
  'dangerBg',
  'dangerFg',
  'infoBg',
  'infoFg',
]

const QUIET_LIGHT: ThemeColors = {
  ...FIGMA_AGLYN_LIGHT,
  canvas: '#f4f4f2',
  surface: '#ffffff',
  raised: '#ffffff',
  sunken: '#ecece9',
  rail: '#eaeae7',
  hover: '#efefec',
  titlebar: '#fafaf8',
  borderSubtle: '#e2e2de',
  borderStrong: '#cbcbc5',
  textPrimary: '#222220',
  textSecondary: '#5f5f5a',
  textTertiary: '#7c7c76',
}

const QUIET_DARK: ThemeColors = {
  ...FIGMA_AGLYN_DARK,
  canvas: '#1a1a19',
  surface: '#222221',
  raised: '#2b2b29',
  sunken: '#141413',
  rail: '#121211',
  hover: '#30302e',
  titlebar: '#1e1e1d',
  borderSubtle: '#353533',
  borderStrong: '#4a4a47',
  textPrimary: '#f2f2ef',
  textSecondary: '#b5b5af',
  textTertiary: '#8e8e88',
}

const NIGHT: ThemeColors = {
  canvas: '#0b1120',
  surface: '#121a2b',
  raised: '#1a2337',
  sunken: '#070c17',
  rail: '#050913',
  hover: '#1e2840',
  titlebar: '#0e1525',
  borderSubtle: '#222c42',
  borderStrong: '#33405c',
  textPrimary: '#eef2fa',
  textSecondary: '#a9b4cb',
  textTertiary: '#8290ab',
  successBg: '#12301f',
  successFg: '#7bcb8f',
  warningBg: '#352914',
  warningFg: '#f6be6e',
  dangerBg: '#3a1820',
  dangerFg: '#f08a8f',
  infoBg: '#122a47',
  infoFg: '#79b2ee',
  newBg: '#36193f',
  newFg: '#e68af6',
  scrim: '#00000099',
  ...DANGER_DARK,
}

const HIGH_CONTRAST_LIGHT: ThemeColors = {
  canvas: '#ffffff',
  surface: '#ffffff',
  raised: '#ffffff',
  sunken: '#f0f0f0',
  rail: '#efefef',
  hover: '#e4e4e4',
  titlebar: '#ffffff',
  borderSubtle: '#6b6b6b',
  borderStrong: '#000000',
  textPrimary: '#000000',
  textSecondary: '#1f1f1f',
  textTertiary: '#3d3d3d',
  successBg: '#ddf3de',
  successFg: '#0b4d10',
  warningBg: '#ffe9c7',
  warningFg: '#5c3a00',
  dangerBg: '#fadbd9',
  dangerFg: '#7a0f0b',
  infoBg: '#ddebfa',
  infoFg: '#0a3a66',
  newBg: '#f1ddf6',
  newFg: '#5e0f70',
  scrim: '#00000080',
  ...DANGER_LIGHT,
}

const HIGH_CONTRAST_DARK: ThemeColors = {
  canvas: '#000000',
  surface: '#000000',
  raised: '#0a0a0a',
  sunken: '#141414',
  rail: '#0f0f0f',
  hover: '#262626',
  titlebar: '#000000',
  borderSubtle: '#9a9a9a',
  borderStrong: '#ffffff',
  textPrimary: '#ffffff',
  textSecondary: '#ededed',
  textTertiary: '#c7c7c7',
  successBg: '#0b2a0e',
  successFg: '#9be7a0',
  warningBg: '#2e2000',
  warningFg: '#ffd08a',
  dangerBg: '#330b0a',
  dangerFg: '#ff9e9b',
  infoBg: '#0a2340',
  infoFg: '#9ccbff',
  newBg: '#2e0b38',
  newFg: '#f2a8ff',
  scrim: '#000000b2',
  ...DANGER_DARK,
}

/** Figma's previews of the two themes it does not hold in full. */
export const THEME_PREVIEWS: Readonly<Record<'ocean' | 'warm', ThemePreview>> = {
  ocean: { rail: '#0b3954', surface: '#f2f8fb', canvas: '#e3eef4', accent: '#087e8b' },
  warm: { rail: '#e9dccb', surface: '#fffaf3', canvas: '#f5ece0', accent: '#c2571a' },
}

/**
 * The rail color a theme's DARK appearance is tinted toward. Ocean's rail is
 * already dark, so it is its own seed; Warm's is a light sand, so its dark
 * appearance leans to a dark sand instead.
 */
export const THEME_DARK_RAIL_SEEDS: Readonly<Record<'ocean' | 'warm', string>> = {
  ocean: '#0b3954',
  warm: '#7a5634',
}

/**
 * A theme's full palette from Figma's four-color preview (AGL-3950), by the
 * same rules for both:
 *
 * Light: the preview's canvas, surface and rail as given; raised = surface;
 * sunken = canvas 25% toward the rail; hover = surface 10% toward the rail;
 * titlebar = surface 35% toward the canvas; the borders are Figma's Aglyn
 * mode's, 18% (subtle) and 22% (strong) toward the rail. Text, status, scrim
 * and the danger fill are Figma's Aglyn mode's.
 *
 * Dark: Figma's Aglyn dark mode tinted toward the dark rail seed: canvas
 * 22%, surface and raised 18%, rail 45%; everything else is that mode's.
 *
 * "Toward" is a straight per-channel sRGB blend, rounded to the byte.
 */
export function deriveThemeFromPreview(preview: ThemePreview, darkRailSeed: string): {
  light: ThemeColors
  dark: ThemeColors
} {
  return {
    light: {
      ...FIGMA_AGLYN_LIGHT,
      canvas: preview.canvas,
      surface: preview.surface,
      raised: preview.surface,
      rail: preview.rail,
      sunken: themeLerp(preview.canvas, preview.rail, 0.25),
      hover: themeLerp(preview.surface, preview.rail, 0.1),
      titlebar: themeLerp(preview.surface, preview.canvas, 0.35),
      borderSubtle: themeLerp(FIGMA_AGLYN_LIGHT.borderSubtle, preview.rail, 0.18),
      borderStrong: themeLerp(FIGMA_AGLYN_LIGHT.borderStrong, preview.rail, 0.22),
    },
    dark: {
      ...FIGMA_AGLYN_DARK,
      canvas: themeLerp(FIGMA_AGLYN_DARK.canvas, darkRailSeed, 0.22),
      surface: themeLerp(FIGMA_AGLYN_DARK.surface, darkRailSeed, 0.18),
      raised: themeLerp(FIGMA_AGLYN_DARK.raised, darkRailSeed, 0.18),
      rail: themeLerp(FIGMA_AGLYN_DARK.rail, darkRailSeed, 0.45),
    },
  }
}

const OCEAN = deriveThemeFromPreview(THEME_PREVIEWS.ocean, THEME_DARK_RAIL_SEEDS.ocean)
const WARM = deriveThemeFromPreview(THEME_PREVIEWS.warm, THEME_DARK_RAIL_SEEDS.warm)

/** The Aglyn blue every Figma theme's "Accent: Theme" resolves to. */
const AGLYN_ACCENT = '#00b0ff'

/** Every theme, in the order the Theme settings sheet lists them. */
export const THEME_PALETTES: readonly ThemePalette[] = [
  { id: 'aglyn', label: '', brandLabel: true, light: AGLYN_LIGHT, dark: AGLYN_DARK, accent: AGLYN_ACCENT, source: 'console' },
  { id: 'quiet', label: 'Quiet', light: QUIET_LIGHT, dark: QUIET_DARK, accent: AGLYN_ACCENT, source: 'figma' },
  { id: 'night', label: 'Night', light: NIGHT, dark: NIGHT, accent: AGLYN_ACCENT, alwaysDark: true, source: 'figma' },
  { id: 'ocean', label: 'Ocean', light: OCEAN.light, dark: OCEAN.dark, accent: THEME_PREVIEWS.ocean.accent, source: 'derived' },
  { id: 'warm', label: 'Warm', light: WARM.light, dark: WARM.dark, accent: THEME_PREVIEWS.warm.accent, source: 'derived' },
  {
    id: 'highContrast',
    label: 'High contrast',
    light: HIGH_CONTRAST_LIGHT,
    dark: HIGH_CONTRAST_DARK,
    accent: AGLYN_ACCENT,
    source: 'figma',
  },
]

/**
 * The Aglyn theme on a PHONE: the brand's bold surfaces (AGL-3990). Zach chose
 * the bold look for the phone on 2026-10-19 and kept every other form factor
 * on the console's neutral scheme ("I don't like this light blue everywhere",
 * on the desktop): so only an Aglyn or Aglyn POS PHONE, in the Aglyn theme with
 * the brand blue as its accent, draws these. A tablet, an iPad, a Mac, a
 * Windows or Mac desktop and the POS register keep `THEME_PALETTES`' Aglyn;
 * every other theme, a picked accent and a white-label brand look the same on
 * a phone as anywhere else.
 *
 * The values are Figma's Theme mode 223:0, "Aglyn · phone (bold) 10/19", the
 * explicit mode on every frame of the Native App file's Phone page (2:7). A
 * sky-tinted ground under white panels in light; navy in dark. The strong
 * border is the brand blue at 40% over the white surface, flattened. The
 * statuses are the console's intents, tinted to sit on the sky ground; info's
 * ink in light is the brand's ink, and in dark it is the accent's dark text
 * shade (#4DC8FF), never the fill (Zach, 2026-10-19: blue as text on a dark
 * ground is the console's `primary.dark`).
 */
const PHONE_AGLYN_LIGHT: ThemeColors = {
  canvas: '#edf9ff',
  surface: '#ffffff',
  raised: '#ffffff',
  sunken: '#e6f7ff',
  rail: '#e0f6ff',
  hover: '#f2fbff',
  titlebar: '#f7fdff',
  borderSubtle: '#dbf4ff',
  borderStrong: '#66d0ff',
  textPrimary: '#19202a',
  textSecondary: '#404c5c',
  textTertiary: '#5d6d85',
  successBg: '#e2f2e3',
  successFg: '#306f33',
  warningBg: '#ffebd1',
  warningFg: '#975400',
  dangerBg: '#fbdddc',
  dangerFg: '#ba1c18',
  infoBg: '#ccefff',
  infoFg: '#07171f',
  newBg: '#fae0fe',
  newFg: '#a604c2',
  scrim: '#0f172152',
  ...DANGER_LIGHT,
}

const PHONE_AGLYN_DARK: ThemeColors = {
  canvas: '#07181f',
  surface: '#0d2029',
  raised: '#152b35',
  sunken: '#1a323d',
  rail: '#061319',
  hover: '#213a45',
  titlebar: '#0a1c24',
  borderSubtle: '#263f4a',
  borderStrong: '#395460',
  textPrimary: '#f2f7fb',
  textSecondary: '#c1d0d7',
  textTertiary: '#8ba5b1',
  successBg: '#1d4433',
  successFg: '#72c275',
  warningBg: '#4c432f',
  warningFg: '#ffab40',
  dangerBg: '#452228',
  dangerFg: '#ee7b78',
  infoBg: '#0a3d54',
  infoFg: '#4dc8ff',
  newBg: '#442860',
  newFg: '#ea7cfc',
  scrim: '#0000008c',
  ...DANGER_DARK,
}

/** The Aglyn theme's grounds on a phone, light and dark (Figma Theme mode 223:0): see `PHONE_AGLYN_LIGHT`. */
export const THEME_PHONE_AGLYN: ThemeColorsPair = { light: PHONE_AGLYN_LIGHT, dark: PHONE_AGLYN_DARK }

/** The accent the phone's bold look belongs to: the brand blue, the Aglyn theme's own. */
export const THEME_PHONE_BOLD_ACCENT = AGLYN_ACCENT

// ── Accents ─────────────────────────────────────────────────────────────────

/** The surfaces an accent's text is held to. */
const LIGHT_PAGE = AGLYN_LIGHT.surface
const DARK_PAGE = AGLYN_DARK.surface

function accentText(raw: string): Pick<ThemeAccent, 'textLight' | 'textDark'> {
  return {
    textLight: walkToContrast(raw, LIGHT_PAGE, THEME_TEXT_CONTRAST, -1),
    textDark: walkToContrast(raw, DARK_PAGE, THEME_TEXT_CONTRAST, 1),
  }
}

/**
 * Figma's Accent modes, exactly as the Accent collection holds them.
 *
 * Blue IS the console's primary (AGL-3990). Zach, 2026-10-19: "Just like the
 * web app the solid buttons should have white text and the brand blue when it
 * is on a light background should use the other shade of blue". So the fill
 * is `primary.main` #00B0FF under `contrastText` white (the console's own
 * pairing, knowingly under 4.5:1, AGL-1293), the text shades are
 * `primary.dark` per scheme (#0077AD light, #4DC8FF dark: what MuiLink and the
 * text and outlined MuiButton labels draw, AGL-1186), and the hover fill is
 * `primary.hover`. #0073AE is retired. A mode that names its own text shades
 * keeps them; the others walk their ring to 4.5:1.
 */
const FIGMA_ACCENTS: ReadonlyArray<{
  id: string
  label: string
  accent: Omit<ThemeAccent, 'textLight' | 'textDark'> & Partial<Pick<ThemeAccent, 'textLight' | 'textDark'>>
}> = [
  {
    id: 'blue',
    label: 'Blue',
    accent: {
      fill: '#00b0ff',
      icon: '#00b0ff',
      soft: '#00b0ff29',
      ring: '#00b0ff',
      on: '#ffffff',
      hover: '#0077ad',
      pressed: '#006999',
      textLight: '#0077ad',
      textDark: '#4dc8ff',
    },
  },
  {
    id: 'violet',
    label: 'Violet',
    accent: {
      fill: '#5b3fd6',
      icon: '#8c72f5',
      soft: '#7a5cf02e',
      ring: '#7a5cf0',
      on: '#ffffff',
      hover: '#4e34c2',
      pressed: '#4129aa',
    },
  },
  {
    id: 'pink',
    label: 'Pink',
    accent: {
      fill: '#e040fb',
      icon: '#c93ae3',
      soft: '#e040fb29',
      ring: '#e040fb',
      on: '#ffffff',
      hover: '#cc2ee6',
      pressed: '#b523cf',
    },
  },
  {
    id: 'workspaceBrand',
    label: 'Workspace brand',
    accent: {
      fill: '#2e7d5b',
      icon: '#2e8f66',
      soft: '#2e7d5b2e',
      ring: '#3fa77a',
      on: '#ffffff',
      hover: '#276c4e',
      pressed: '#205a41',
    },
  },
]

/** The named accents, Figma's own values with their text shades (their own where they name them). */
export const THEME_ACCENTS: readonly ThemeNamedAccent[] = FIGMA_ACCENTS.map(({ id, label, accent }) => ({
  id,
  label,
  accent: { ...accentText(accent.ring), ...accent },
}))

/**
 * Blues the brand has retired (AGL-3990), and the color each now reads as. The
 * picker's old "Brand blue" swatch was #0073AE; an accent an account saved
 * from it (`appTheme.accent`) reads as the brand blue, #00B0FF.
 */
export const THEME_RETIRED_ACCENTS: Readonly<Record<string, string>> = {
  '#0073ae': '#00b0ff',
}

/** The accent picker's swatches, in Figma's order. #00B0FF is the one brand blue (AGL-3990), so "Sky" went. */
export const THEME_ACCENT_SWATCHES: readonly ThemeAccentSwatch[] = [
  { id: 'aglynBlue', label: 'Brand blue', color: '#00b0ff' },
  { id: 'violet', label: 'Violet', color: '#7a5cf0' },
  { id: 'pink', label: 'Pink', color: '#e040fb' },
  { id: 'green', label: 'Green', color: '#2e7d5b' },
  { id: 'warm', label: 'Warm', color: '#c2571a' },
]

/**
 * Every control's shade of one accent color (AGL-3950).
 *
 * A retired blue (`THEME_RETIRED_ACCENTS`) reads as the color that replaced
 * it. A color one of Figma's Accent modes is drawn from (its ring) answers
 * with that mode exactly: Figma wins where it defines a value. Blue, the brand
 * blue, is one of them, and wears the console's own pairing. Any other color
 * is derived:
 *
 * 1. White text on the color reads at 3:1 or better: the fill is the color,
 *    `on` is white. Content on a filled control is always white (Zach,
 *    2026-10-19: "Just like the web app the solid buttons should have white
 *    text"), and a brand color white reads on at the large-text bar keeps
 *    its own fill rather than moving off the brand, the console's own
 *    pairing; this is Figma's Pink (#E040FB, 3.34:1).
 * 2. Otherwise the fill is the color darkened in 2% HSL-lightness steps until
 *    white reaches 4.5:1, and `on` is white. The 3:1 threshold is the one
 *    that sends the workspace green (2.99:1) here, as Figma draws it.
 *
 * hover and pressed are the fill 4% and 8% darker (HSL lightness), soft is
 * the color at 16% alpha, ring is the color, icon is the color darkened in 2%
 * steps until it reaches 3:1 on the light surface, and the two text shades
 * walk it (darker on light, lighter on dark) until 4.5:1 on that surface.
 * Null for anything that is not `#RRGGBB`.
 */
export function deriveAccent(color: string): ThemeAccent | null {
  if (!isThemeColor(color)) return null
  const raw = THEME_RETIRED_ACCENTS[color.toLowerCase()] ?? color.toLowerCase()
  const named = THEME_ACCENTS.find((entry) => entry.accent.ring === raw)
  if (named) return { ...named.accent }
  const white = '#ffffff'
  const fill =
    themeContrast(raw, white) >= THEME_NON_TEXT_CONTRAST ? raw : walkToContrast(raw, white, THEME_TEXT_CONTRAST, -1)
  return {
    fill,
    icon: walkToContrast(raw, LIGHT_PAGE, THEME_NON_TEXT_CONTRAST, -1),
    soft: withAlpha(raw, 0.16),
    ring: raw,
    on: white,
    hover: shiftLightness(fill, -0.04),
    pressed: shiftLightness(fill, -0.08),
    ...accentText(raw),
  }
}

// ── Density ─────────────────────────────────────────────────────────────────

/** Figma's Density modes. */
export const THEME_DENSITIES: readonly ThemeDensity[] = [
  {
    id: 'comfortable',
    label: 'Comfortable',
    space2: 2,
    space4: 4,
    space6: 6,
    space8: 8,
    space10: 10,
    space12: 12,
    space16: 16,
    space20: 20,
    space24: 24,
    space32: 32,
    space40: 40,
    space48: 48,
    space64: 64,
    radiusXs: 4,
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
    radiusXl: 16,
    radius2xl: 24,
    radiusFull: 999,
    rowHeight: 32,
    controlHeight: 32,
    listRowHeight: 60,
    phoneRowHeight: 52,
    titlebarHeight: 52,
  },
  {
    id: 'compact',
    label: 'Compact',
    space2: 2,
    space4: 4,
    space6: 4,
    space8: 6,
    space10: 8,
    space12: 8,
    space16: 12,
    space20: 16,
    space24: 20,
    space32: 24,
    space40: 32,
    space48: 40,
    space64: 48,
    radiusXs: 4,
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
    radiusXl: 16,
    radius2xl: 24,
    radiusFull: 999,
    rowHeight: 28,
    controlHeight: 28,
    listRowHeight: 48,
    phoneRowHeight: 44,
    titlebarHeight: 44,
  },
]

/** A theme by id, Aglyn for anything unknown. */
export function themePalette(id: unknown): ThemePalette {
  return THEME_PALETTES.find((entry) => entry.id === id) ?? THEME_PALETTES[0]
}
