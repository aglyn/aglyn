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
 * The palette an email is painted with (AGL-3370).
 *
 * A color an author picks in the Besigner is stored as a palette TOKEN PATH
 * (`primary.main`, `grey.600`), which MUI resolves on a web page and a mail
 * client never will. So an email needs the same palette the site renders
 * with, as plain data, before it writes a single `style` attribute.
 *
 * That palette is built by `@aglyn/shared-ui-theme` — MUI's `createTheme`,
 * then `createResponsiveTheme`'s shade and accessibility passes — and this
 * lib may not import it: a `type:util` package cannot stand on a `type:ui`
 * one, and a server rendering mail has no business loading MUI to do it. What
 * follows is that derivation ported, light scheme only, with the INPUT colors
 * of the two bases copied and everything else computed the way MUI computes
 * it. `email-palette-parity.spec.ts` in `shared-ui-theme` builds both and
 * holds them equal, so the copy cannot drift without a red.
 */

/**
 * A light-scheme MUI palette as plain data: `primary`, `secondary`,
 * `tertiary`, `surface`, `error`, `warning`, `info`, `success` (each
 * `{ main, light, dark, contrastText }`), `background`, `text`, `tint`,
 * `divider`, `inputOutline`, `grey` and `common`.
 */
export type EmailPalette = Readonly<Record<string, unknown>>

/** One authored palette color: a `main`, and any shade the author also set. */
export interface EmailPaletteColorInput {
  main?: string
  light?: string
  dark?: string
  contrastText?: string
}

/**
 * The shape of `HostThemeSchemeColors` (`@aglyn/shared-data-types`), spelled
 * out so this lib needs no dependency on the types package for one shape. An
 * interface has no index signature, so without this a site's typed colors
 * would not be assignable to a plain record.
 */
export interface EmailPaletteSchemeColors {
  primary?: EmailPaletteColorInput
  secondary?: EmailPaletteColorInput
  tertiary?: EmailPaletteColorInput
  surface?: EmailPaletteColorInput
  error?: EmailPaletteColorInput
  warning?: EmailPaletteColorInput
  info?: EmailPaletteColorInput
  success?: EmailPaletteColorInput
  background?: { default?: string; paper?: string }
  text?: { primary?: string; secondary?: string; disabled?: string }
  tint?: { primary?: string; secondary?: string; tertiary?: string }
  divider?: string
}

export interface EmailPaletteInput {
  /**
   * The base a site or sender layers onto: `'platform'` is the console brand
   * (`consoleOptions`), `'tenant'` the neutral default a customer site wears
   * (`tenantOptions`). {@link emailPaletteBaseForHost} picks it for a site.
   */
  base: 'platform' | 'tenant'
  /**
   * A site's authored light-scheme colors — `host.theme.colorSchemes.light`.
   * Stored data, so every leaf is checked as it is read; a plain record is
   * accepted as readily as the typed shape.
   */
  colors?: EmailPaletteSchemeColors | Readonly<Record<string, unknown>> | null
  /**
   * A white-label org's brand color. It becomes `primary.main` and the whole
   * `primary` record is re-derived from it, exactly as a theme given
   * `palette.primary = { main }` would. Ignored unless it parses as a color.
   */
  primaryColor?: string | null
}

type ColorRecord = Record<string, unknown>
type PaletteDraft = Record<string, unknown>

// ── The two bases' authored inputs ─────────────────────────────────────────
//
// Copied from `console.theme.ts` (`colorScheme.light`) and `tenant.theme.ts`
// (`tenantColorScheme.light`), minus the `svg*` records no email reads. Only
// what those files AUTHOR is here; every shade they leave to MUI is derived
// below, so the copy stays as short as the thing it mirrors.

const BRAND_GREY = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#EEEEEE',
  300: '#E0E0E0',
  400: '#BDBDBD',
  500: '#9E9E9E',
  600: '#757575',
  700: '#616161',
  800: '#424242',
  900: '#212121',
  A100: '#D5D5D5',
  A200: '#AAAAAA',
  A400: '#303030',
  A700: '#616161',
}

const PLATFORM_LIGHT_INPUT: PaletteDraft = {
  mode: 'light',
  primary: { main: '#00b0ff', dark: '#0077ad', contrastText: '#FFFFFF' },
  secondary: { main: '#e040fb', dark: '#9d2db0', contrastText: '#FFFFFF' },
  tertiary: { main: '#404C5C', contrastText: '#FFFFFF' },
  surface: { main: '#F8F9FA', contrastText: '#000000' },
  tint: { primary: '#E6F5FF', secondary: '#FBE6FE', tertiary: '#EEF0F2' },
  inputOutline: 'rgba(0, 0, 0, 0.23)',
  background: { default: '#F5F5F5', paper: '#FFFFFF' },
  info: { main: '#1878cd', contrastText: '#FFFFFF' },
  error: { main: '#e32c27', contrastText: '#FFFFFF' },
  success: { main: '#4CAF50', contrastText: '#000000DE' },
  warning: { main: '#FFAB40', contrastText: '#000000DE' },
  grey: BRAND_GREY,
}

const TENANT_LIGHT_INPUT: PaletteDraft = {
  mode: 'light',
  primary: { main: '#1976d2', dark: '#125393', contrastText: '#FFFFFF' },
  secondary: { main: '#9c27b0', dark: '#6d1b7b', contrastText: '#FFFFFF' },
  tertiary: { main: '#4a5568', dark: '#343b49', contrastText: '#FFFFFF' },
  surface: { main: '#f1f3f5', contrastText: '#000000DE' },
  tint: { primary: '#e8f1fb', secondary: '#f5e9f7', tertiary: '#eef0f3' },
  inputOutline: 'rgba(0, 0, 0, 0.23)',
  background: { default: '#fafafa', paper: '#ffffff' },
  info: { main: '#0288d1', dark: '#015f92', contrastText: '#000000DE' },
  error: { main: '#d32f2f', dark: '#942121', contrastText: '#FFFFFF' },
  success: { main: '#2e7d32', dark: '#205823', contrastText: '#FFFFFF' },
  warning: { main: '#ed6c02', dark: '#a64c01', contrastText: '#000000DE' },
  grey: BRAND_GREY,
}

// ── MUI's light-mode constants (`createPalette`, `colors/*`) ───────────────

const MUI_COMMON = { black: '#000', white: '#fff' }

const MUI_GREY = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#eeeeee',
  300: '#e0e0e0',
  400: '#bdbdbd',
  500: '#9e9e9e',
  600: '#757575',
  700: '#616161',
  800: '#424242',
  900: '#212121',
  A100: '#f5f5f5',
  A200: '#eeeeee',
  A400: '#bdbdbd',
  A700: '#616161',
}

/** `getLight()` — the mode-hydrated slots, minus `action` (no email reads it). */
function muiLightDefaults(): PaletteDraft {
  return {
    text: {
      primary: 'rgba(0, 0, 0, 0.87)',
      secondary: 'rgba(0, 0, 0, 0.6)',
      disabled: 'rgba(0, 0, 0, 0.38)',
    },
    divider: 'rgba(0, 0, 0, 0.12)',
    background: { paper: MUI_COMMON.white, default: MUI_COMMON.white },
  }
}

/** MUI's `light.text.primary`, the dark ink `getContrastText` falls back to. */
const MUI_DARK_INK = 'rgba(0, 0, 0, 0.87)'
const MUI_CONTRAST_THRESHOLD = 3
/** MUI's default `tonalOffset` of 0.2, split the way `addLightOrDark` splits it. */
const TONAL_OFFSET_LIGHT = 0.2
const TONAL_OFFSET_DARK = 0.2 * 1.5

/** The six colors `createPalette` augments. Both bases author every one. */
const MUI_AUGMENTED_KEYS = [
  'primary',
  'secondary',
  'error',
  'warning',
  'info',
  'success',
] as const

/** `createResponsiveTheme`'s FOREGROUND_COLOR_KEYS: `dark` is accent text. */
const FOREGROUND_COLOR_KEYS: ReadonlyArray<string> = [
  'primary',
  'secondary',
  'tertiary',
  'error',
  'warning',
  'info',
  'success',
]
/** …and `contrastText` is text wherever it lives, so `surface` joins. */
const CONTRAST_TEXT_COLOR_KEYS: ReadonlyArray<string> = [
  ...FOREGROUND_COLOR_KEYS,
  'surface',
]

// ── MUI's colorManipulator, ported ─────────────────────────────────────────
//
// Byte-for-byte in behavior, including the parts that look odd: `recompose`
// truncates rgb channels with `parseInt`, and `getLuminance` rounds to three
// places. The palette's derived shades are strings, so a port that rounded
// "better" would be a port that disagrees.

interface DecomposedColor {
  type: string
  values: Array<number>
  colorSpace?: string
}

function hexToRgb(color: string): string {
  const hex = color.slice(1)
  const pattern = new RegExp(`.{1,${hex.length >= 6 ? 2 : 1}}`, 'g')
  let parts: Array<string> | null = hex.match(pattern)
  if (parts && parts[0].length === 1) parts = parts.map((part) => part + part)
  return parts
    ? `rgb${parts.length === 4 ? 'a' : ''}(${parts
        .map((part, index) =>
          index < 3
            ? parseInt(part, 16)
            : Math.round((parseInt(part, 16) / 255) * 1000) / 1000,
        )
        .join(', ')})`
    : ''
}

function decomposeColor(color: string): DecomposedColor {
  if (color.charAt(0) === '#') return decomposeColor(hexToRgb(color))
  const marker = color.indexOf('(')
  const type = color.substring(0, marker)
  if (!['rgb', 'rgba', 'hsl', 'hsla', 'color'].includes(type)) {
    throw new Error(`email-palette: unsupported color "${color}"`)
  }
  const body = color.substring(marker + 1, color.length - 1)
  let raw: Array<string>
  let colorSpace: string | undefined
  if (type === 'color') {
    raw = body.split(' ')
    colorSpace = raw.shift()
    if (raw.length === 4 && raw[3].charAt(0) === '/') raw[3] = raw[3].slice(1)
    if (
      !['srgb', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec-2020'].includes(
        colorSpace ?? '',
      )
    ) {
      throw new Error(`email-palette: unsupported color space "${colorSpace}"`)
    }
  } else {
    raw = body.split(',')
  }
  return { type, values: raw.map((value) => parseFloat(value)), colorSpace }
}

function recomposeColor({ type, colorSpace, values }: DecomposedColor): string {
  let parts: Array<string | number> = values
  if (type.includes('rgb')) {
    parts = values.map((value, index) =>
      index < 3 ? parseInt(String(value), 10) : value,
    )
  } else if (type.includes('hsl')) {
    parts = [...values]
    parts[1] = `${values[1]}%`
    parts[2] = `${values[2]}%`
  }
  const body = type.includes('color')
    ? `${colorSpace} ${parts.join(' ')}`
    : parts.join(', ')
  return `${type}(${body})`
}

function intToHex(value: number): string {
  const hex = value.toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

function rgbToHex(color: string): string {
  if (color.startsWith('#')) return color
  const { values } = decomposeColor(color)
  return `#${values
    .map((value, index) => intToHex(index === 3 ? Math.round(255 * value) : value))
    .join('')}`
}

function hslToRgb(color: string | DecomposedColor): string {
  const decomposed = typeof color === 'string' ? decomposeColor(color) : color
  const { values } = decomposed
  const hue = values[0]
  const saturation = values[1] / 100
  const lightness = values[2] / 100
  const chroma = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number, k = (n + hue / 30) % 12) =>
    lightness - chroma * Math.max(Math.min(k - 3, 9 - k, 1), -1)
  const rgb = [
    Math.round(channel(0) * 255),
    Math.round(channel(8) * 255),
    Math.round(channel(4) * 255),
  ]
  let type = 'rgb'
  if (decomposed.type === 'hsla') {
    type += 'a'
    rgb.push(values[3])
  }
  return recomposeColor({ type, values: rgb })
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function lighten(color: string, coefficient: number): string {
  const decomposed = decomposeColor(color)
  const amount = clampUnit(coefficient)
  const { type, values } = decomposed
  if (type.includes('hsl')) {
    values[2] += (100 - values[2]) * amount
  } else if (type.includes('rgb')) {
    for (let i = 0; i < 3; i += 1) values[i] += (255 - values[i]) * amount
  } else if (type.includes('color')) {
    for (let i = 0; i < 3; i += 1) values[i] += (1 - values[i]) * amount
  }
  return recomposeColor(decomposed)
}

function darken(color: string, coefficient: number): string {
  const decomposed = decomposeColor(color)
  const amount = clampUnit(coefficient)
  const { type, values } = decomposed
  if (type.includes('hsl')) {
    values[2] *= 1 - amount
  } else if (type.includes('rgb') || type.includes('color')) {
    for (let i = 0; i < 3; i += 1) values[i] *= 1 - amount
  }
  return recomposeColor(decomposed)
}

function srgbChannelToLinear(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** MUI's `getLuminance`: WCAG luminance, rounded to three places. */
function muiLuminance(color: string): number {
  const decomposed = decomposeColor(color)
  const rgb =
    decomposed.type === 'hsl' || decomposed.type === 'hsla'
      ? decomposeColor(hslToRgb(decomposed)).values
      : decomposed.values
  const linear = rgb.map((value) =>
    srgbChannelToLinear(decomposed.type !== 'color' ? value / 255 : value),
  )
  return Number(
    (0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]).toFixed(3),
  )
}

/** MUI's `getContrastRatio`, on the rounded luminance. */
function muiContrastRatio(foreground: string, background: string): number {
  const a = muiLuminance(foreground)
  const b = muiLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// ── `accessible-shade.ts`, ported ──────────────────────────────────────────

const AA_TEXT_CONTRAST = 4.5

/** Full-precision WCAG luminance, as `accessible-shade.ts` measures it. */
function relativeLuminance(color: string): number {
  const decomposed = decomposeColor(color)
  if (decomposed.type === 'color') {
    throw new Error(`email-palette: unsupported color format "${color}"`)
  }
  const values = decomposed.type.startsWith('hsl')
    ? decomposeColor(hslToRgb(color)).values
    : decomposed.values
  return (
    0.2126 * srgbChannelToLinear(values[0] / 255) +
    0.7152 * srgbChannelToLinear(values[1] / 255) +
    0.0722 * srgbChannelToLinear(values[2] / 255)
  )
}

function contrastRatio(colorA: string, colorB: string): number {
  const a = relativeLuminance(colorA)
  const b = relativeLuminance(colorB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function meetsContrast(
  foreground: string,
  backgrounds: ReadonlyArray<string>,
): boolean {
  return backgrounds.every(
    (background) => contrastRatio(foreground, background) >= AA_TEXT_CONTRAST,
  )
}

function toHslValues(color: string): [number, number, number] {
  const decomposed = decomposeColor(color)
  if (decomposed.type.startsWith('hsl')) {
    const [h, s, l] = decomposed.values
    return [h, s / 100, l / 100]
  }
  const r = decomposed.values[0] / 255
  const g = decomposed.values[1] / 255
  const b = decomposed.values[2] / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return [hue * 60, saturation, lightness]
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  return rgbToHex(
    hslToRgb(`hsl(${hue}, ${saturation * 100}%, ${lightness * 100}%)`),
  )
}

/** The nearest shade of `color`, walking lightness one way, that clears AA. */
function accessibleShade(
  color: string,
  backgrounds: ReadonlyArray<string>,
  direction: 'darken' | 'lighten',
): string {
  if (!backgrounds.length || meetsContrast(color, backgrounds)) return color
  const [hue, saturation, initialLightness] = toHslValues(color)
  const delta = direction === 'lighten' ? 0.01 : -0.01
  let lightness = initialLightness
  let candidate = color
  for (let i = 0; i < 120; i += 1) {
    lightness = Math.min(1, Math.max(0, lightness + delta))
    candidate = hslToHex(hue, saturation, lightness)
    if (meetsContrast(candidate, backgrounds)) return candidate
    if (lightness === 0 || lightness === 1) return candidate
  }
  return candidate
}

// ── Palette assembly ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** MUI's `deepmerge` with `clone: true`, for plain data. */
function deepMerge(target: PaletteDraft, source: PaletteDraft): PaletteDraft {
  const output: PaletteDraft = { ...target }
  for (const key of Object.keys(source)) {
    const next = source[key]
    const current = target[key]
    if (
      isRecord(next) &&
      Object.prototype.hasOwnProperty.call(target, key) &&
      isRecord(current)
    ) {
      output[key] = deepMerge(current, next)
    } else {
      output[key] = isRecord(next) ? deepMerge({}, next) : next
    }
  }
  return output
}

/**
 * `createPalette`'s `augmentColor` for an object with a `main`: fill `light`
 * and `dark` from the tonal offset, and `contrastText` by MUI's threshold.
 */
function augmentColor(color: ColorRecord): ColorRecord {
  const augmented = { ...color }
  const main = augmented['main']
  if (typeof main !== 'string') {
    throw new Error('email-palette: a palette color needs a string `main`')
  }
  if (!augmented['light']) augmented['light'] = lighten(main, TONAL_OFFSET_LIGHT)
  if (!augmented['dark']) augmented['dark'] = darken(main, TONAL_OFFSET_DARK)
  if (!augmented['contrastText']) {
    augmented['contrastText'] =
      muiContrastRatio(main, MUI_COMMON.white) >= MUI_CONTRAST_THRESHOLD
        ? MUI_COMMON.white
        : MUI_DARK_INK
  }
  return augmented
}

/**
 * `createResponsiveTheme`'s `addShadeVariants`, for the two colors MUI does
 * not know about. Its contrast pick is handed the DARK tonal offset (0.3) as
 * the threshold, so it lands on white for any color at all; the port keeps
 * that, because the parity it owes is to what the site renders, and any
 * pairing below AA is repaired by the accessibility pass that follows.
 */
function addShadeVariants(color: unknown): void {
  if (!isRecord(color) || !color['main']) return
  const main = color['main'] as string
  if (!color['dark']) color['dark'] = darken(main, TONAL_OFFSET_DARK)
  if (!color['light']) color['light'] = lighten(main, TONAL_OFFSET_LIGHT)
  if (!color['contrastText']) {
    color['contrastText'] =
      muiContrastRatio(main, '#FFFFFF') >= TONAL_OFFSET_DARK
        ? '#FFFFFF'
        : 'rgba(0, 0, 0, 0.87)'
  }
}

/**
 * `ensureAccessibleShades` for the light scheme: a DERIVED `dark` that misses
 * 4.5:1 on either background is walked darker, and a derived `contrastText`
 * that misses 4.5:1 on its `main` is walked toward the pole with more room.
 * Whatever the input authored passes through untouched.
 */
function ensureAccessibleShades(
  palette: PaletteDraft,
  input: PaletteDraft,
): void {
  const background = isRecord(palette['background']) ? palette['background'] : {}
  const backgrounds = [background['default'], background['paper']].filter(
    (value): value is string => typeof value === 'string',
  )
  if (!backgrounds.length) return

  for (const key of CONTRAST_TEXT_COLOR_KEYS) {
    const color = palette[key]
    if (!isRecord(color) || typeof color['main'] !== 'string') continue
    const provided = input[key]
    if (isRecord(provided) && !('main' in provided)) continue
    const explicit = isRecord(provided) ? provided : {}
    const main = color['main']

    try {
      if (
        FOREGROUND_COLOR_KEYS.includes(key) &&
        !explicit['dark'] &&
        typeof color['dark'] === 'string' &&
        !meetsContrast(color['dark'], backgrounds)
      ) {
        color['dark'] = accessibleShade(color['dark'], backgrounds, 'darken')
      }
      if (
        !explicit['contrastText'] &&
        typeof color['contrastText'] === 'string' &&
        !meetsContrast(color['contrastText'], [main])
      ) {
        const direction =
          contrastRatio('#fff', main) >= contrastRatio('#000', main)
            ? 'lighten'
            : 'darken'
        color['contrastText'] = accessibleShade(
          color['contrastText'],
          [main],
          direction,
        )
      }
    } catch {
      // An unparseable color is left as derived, as the theme leaves it.
    }
  }
}

/** `createTheme` + `createResponsiveTheme`'s passes, palette only. */
function derivePalette(input: PaletteDraft): PaletteDraft {
  const rest: PaletteDraft = { ...input }
  delete rest['mode']
  delete rest['contrastThreshold']
  delete rest['tonalOffset']

  const augmented: PaletteDraft = {}
  for (const key of MUI_AUGMENTED_KEYS) {
    const color = input[key]
    if (!isRecord(color)) {
      throw new Error(`email-palette: the base palette is missing \`${key}\``)
    }
    augmented[key] = augmentColor(color)
  }

  const palette = deepMerge(
    {
      common: { ...MUI_COMMON },
      mode: 'light',
      ...augmented,
      grey: MUI_GREY,
      ...muiLightDefaults(),
    },
    rest,
  )
  addShadeVariants(palette['tertiary'])
  addShadeVariants(palette['surface'])
  ensureAccessibleShades(palette, input)
  return palette
}

// ── A site's colors, as `hostThemeToThemeOptions` reads them ───────────────

const SCHEME_COLOR_KEYS = [
  'primary',
  'secondary',
  'tertiary',
  'surface',
  'error',
  'warning',
  'info',
  'success',
] as const

/** Truthy string, or nothing: the "copy what was set" test the theme uses. */
function setString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** `pickPaletteColor`: a color needs a `main`; its shades ride along if set. */
function pickPaletteColor(color: unknown): ColorRecord | undefined {
  if (!isRecord(color)) return undefined
  const main = setString(color['main'])
  if (!main) return undefined
  const picked: ColorRecord = { main }
  for (const shade of ['light', 'dark', 'contrastText'] as const) {
    const value = setString(color[shade])
    if (value) picked[shade] = value
  }
  return picked
}

/** Picks the listed string leaves of a group that were set, or nothing. */
function pickLeaves(
  group: unknown,
  keys: ReadonlyArray<string>,
): Record<string, string> | undefined {
  if (!isRecord(group)) return undefined
  const picked: Record<string, string> = {}
  for (const key of keys) {
    const value = setString(group[key])
    if (value) picked[key] = value
  }
  return Object.keys(picked).length ? picked : undefined
}

/** `schemeColorsToPaletteOptions` for the light scheme. */
function siteColorOverrides(
  input: EmailPaletteInput['colors'],
): PaletteDraft {
  const overrides: PaletteDraft = { mode: 'light' }
  if (!isRecord(input)) return overrides
  const colors: Readonly<Record<string, unknown>> = input
  for (const key of SCHEME_COLOR_KEYS) {
    const color = pickPaletteColor(colors[key])
    if (color) overrides[key] = color
  }
  const background = pickLeaves(colors['background'], ['default', 'paper'])
  if (background) overrides['background'] = background
  const text = pickLeaves(colors['text'], ['primary', 'secondary', 'disabled'])
  if (text) overrides['text'] = text
  const tint = pickLeaves(colors['tint'], ['primary', 'secondary', 'tertiary'])
  if (tint) overrides['tint'] = tint
  const divider = setString(colors['divider'])
  if (divider) overrides['divider'] = divider
  return overrides
}

// ── Literal CSS colors ─────────────────────────────────────────────────────

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:%|deg|grad|rad|turn)?`
/**
 * `rgb()`, `rgba()`, `hsl()`, `hsla()` holding numbers and nothing else —
 * comma or space separated, with an optional `/ alpha`. Anything that could
 * close the declaration or open another (`;`, `"`, `(`, `url`) cannot match.
 */
const FUNCTION_COLOR = new RegExp(
  String.raw`^(?:rgba?|hsla?)\(\s*${NUMBER}(?:\s*,\s*|\s+)${NUMBER}(?:\s*,\s*|\s+)${NUMBER}(?:(?:\s*,\s*|\s*\/\s*)${NUMBER})?\s*\)$`,
  'i',
)
/** A color MUI's own manipulators parse: hex, or a comma-separated function. */
const MUI_PARSEABLE_FUNCTION = new RegExp(
  String.raw`^(?:rgba?|hsla?)\(\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}(?:\s*,\s*${NUMBER})?\s*\)$`,
  'i',
)

/** CSS Color Module Level 4 named colors, plus `transparent`. */
const NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black ' +
    'blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse ' +
    'chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite ' +
    'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
    'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender ' +
    'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
    'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey ' +
    'lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace ' +
    'olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown ' +
    'salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
    'slategray slategrey snow springgreen steelblue tan teal thistle tomato ' +
    'turquoise violet wheat white whitesmoke yellow yellowgreen transparent'
  ).split(' '),
)

/** True for a literal CSS color that is safe to write into a style attribute. */
function isLiteralColor(value: string): boolean {
  return (
    HEX_COLOR.test(value) ||
    FUNCTION_COLOR.test(value) ||
    NAMED_COLORS.has(value.toLowerCase())
  )
}

/** True for a color MUI can derive shades from without throwing. */
function isDerivableColor(value: string): boolean {
  return HEX_COLOR.test(value) || MUI_PARSEABLE_FUNCTION.test(value)
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * The fully derived light palette a site or sender renders with: the
 * chosen base, the site's authored colors layered one level deep (a color's
 * whole record replaced, so MUI re-derives its shades from the new `main`),
 * then a white-label `primaryColor` over that.
 *
 * Equal, for every token the Besigner's color picker offers, to the palette
 * of `createResponsiveTheme` over `mergeThemeOptions(siteBaseOptions(…))`
 * and the host theme's light `hostThemeToThemeOptions`.
 *
 * Where the site's colors cannot be derived at all — a `main` MUI cannot
 * parse, on which `createTheme` itself throws — the email falls back to the
 * base rather than failing the send: there is no rendered page to agree with.
 */
export function buildEmailPalette(input: EmailPaletteInput): EmailPalette {
  const base =
    input.base === 'platform' ? PLATFORM_LIGHT_INPUT : TENANT_LIGHT_INPUT
  const primaryColor =
    typeof input.primaryColor === 'string' &&
    isDerivableColor(input.primaryColor.trim())
      ? input.primaryColor.trim()
      : undefined
  const brand: PaletteDraft = primaryColor
    ? { primary: { main: primaryColor } }
    : {}

  const layered = { ...base, ...siteColorOverrides(input.colors), ...brand }
  try {
    return derivePalette(layered)
  } catch {
    return derivePalette({ ...base, ...brand })
  }
}

/** The platform's own palette — the console brand, light scheme. */
export const PLATFORM_EMAIL_PALETTE: EmailPalette = buildEmailPalette({
  base: 'platform',
})

/** Palette token paths: a key, optionally one dot and a leaf (`grey.600`). */
const TOKEN_PATH = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)?$/

function lookupToken(
  palette: EmailPalette,
  path: string,
): string | undefined {
  let node: unknown = palette
  for (const key of path.split('.')) {
    if (!isRecord(node) || !Object.prototype.hasOwnProperty.call(node, key)) {
      return undefined
    }
    node = node[key]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * A palette value as an opaque `#rrggbb`. Translucent values (`text.primary`
 * is `rgba(0, 0, 0, 0.87)`, some `contrastText`s are `#000000DE`) are
 * composited over the palette's paper, the ground an email body sits on:
 * Outlook's Word engine drops `rgba()` and eight-digit hex outright, and the
 * flattened color is what a reader sees on that ground anyway.
 */
function toOpaqueHex(value: string, palette: EmailPalette): string | undefined {
  const channels = rgbaChannels(value)
  if (!channels) return undefined
  const [r, g, b, alpha] = channels
  if (alpha >= 1) return channelsToHex(r, g, b)
  const background = palette['background']
  const paper = isRecord(background) ? background['paper'] : undefined
  const ground =
    (typeof paper === 'string' ? rgbaChannels(paper) : undefined) ?? [
      255, 255, 255, 1,
    ]
  const over = (fore: number, back: number) =>
    fore * alpha + back * (1 - alpha)
  return channelsToHex(over(r, ground[0]), over(g, ground[1]), over(b, ground[2]))
}

function rgbaChannels(
  value: string,
): [number, number, number, number] | undefined {
  if (!isDerivableColor(value)) return undefined
  try {
    const decomposed = decomposeColor(value)
    const rgb = decomposed.type.startsWith('hsl')
      ? decomposeColor(hslToRgb(decomposed)).values
      : decomposed.values
    const alpha = decomposed.values.length > 3 ? decomposed.values[3] : 1
    const channels: [number, number, number, number] = [
      rgb[0],
      rgb[1],
      rgb[2],
      alpha,
    ]
    return channels.every(Number.isFinite) ? channels : undefined
  } catch {
    return undefined
  }
}

function channelsToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) => intToHex(Math.round(Math.min(255, Math.max(0, value)))))
    .join('')}`
}

/**
 * Resolves a stored color prop for an email's markup.
 *
 * - A palette token path (`primary.main`, `grey.600`, `divider`) resolves
 *   against `palette` to an opaque hex — or to nothing without a palette.
 * - A literal CSS color (hex, `rgb()`/`rgba()`/`hsl()`/`hsla()`,
 *   `transparent`, a named color) passes through as written.
 * - Anything else — an unknown token, garbage, an empty value, and anything
 *   that could step outside a `style` attribute — is `undefined`, so the
 *   caller uses its own default.
 */
export function resolveEmailColor(
  value: unknown,
  palette: EmailPalette | undefined,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (palette && TOKEN_PATH.test(trimmed)) {
    const resolved = lookupToken(palette, trimmed)
    if (resolved !== undefined) {
      const hex = toOpaqueHex(resolved, palette)
      if (hex) return hex
      if (isLiteralColor(resolved)) return resolved
      return undefined
    }
  }
  return isLiteralColor(trimmed) ? trimmed : undefined
}

// ── Which base a site wears ────────────────────────────────────────────────

/**
 * The prefix the tenant middleware puts on a custom domain before it becomes
 * the `[host]` route segment — mirrored from `tenant.theme.ts`.
 */
const CNAME_PREFIX = 'cname--'

/**
 * The hosts whose brand is the operator's own, mirrored from
 * `PLATFORM_BRAND_HOSTS` in `tenant.theme.ts` and read from the same
 * variable. Dot notation for the same reason it has there: Next substitutes
 * `process.env.NAME` textually and never the bracket form.
 */
const PLATFORM_BRAND_HOSTS: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_PLATFORM_BRAND_HOSTS ?? 'aglyn.com,aglyn.io')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
)

/**
 * Which base a site's mail layers onto: `'platform'` for the operator's own
 * hosts, `'tenant'` for every customer site — the answer
 * `wearsPlatformBrand(hostBrandKey(host))` gives the page itself, so a site's
 * email and its published page start from the same palette.
 */
export function emailPaletteBaseForHost(
  host: { cname?: string | null; subdomain?: string | null } | null | undefined,
): 'platform' | 'tenant' {
  const key = host?.cname || host?.subdomain || undefined
  if (!key) return 'tenant'
  const normalized = key.trim().toLowerCase()
  const bare = normalized.startsWith(CNAME_PREFIX)
    ? normalized.slice(CNAME_PREFIX.length)
    : normalized
  return PLATFORM_BRAND_HOSTS.has(bare) ? 'platform' : 'tenant'
}
