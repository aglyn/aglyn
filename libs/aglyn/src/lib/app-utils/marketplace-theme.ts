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

import type {
  HostTheme,
  HostThemeFont,
  HostThemeScheme,
  HostThemeSchemeColors,
} from '@aglyn/shared-data-types'
import {
  diffOverride,
  isEmptyOverride,
  overrideConflicts,
  overridePaths,
  readArtifactOverride,
  resolveOverride,
  type ArtifactOverride,
} from './marketplace-overrides'

/**
 * Publish-time validation for themes as a marketplace artifact (AGL-1020).
 *
 * A plugin bundle is validated because it is code and the risk is a
 * compromised site. A theme is data, so the risk is different in kind but not
 * in consequence: the failure mode is an unreadable or half-painted site, which
 * a publisher cannot see from their own machine because their fonts are
 * installed and their eyes already know what the text says.
 *
 * Both of the things that go wrong are mechanically checkable, so they are
 * checked here rather than left to review:
 *
 * * **Completeness.** Light and dark are not one palette with a filter. A theme
 *   that defines only light is half a theme, and installing it leaves every
 *   dark-mode visitor on MUI's stock blue — which reads as the site being
 *   broken, not as the theme being partial.
 * * **Contrast.** Text on its background, and label on its button, are the two
 *   pairs that make a site unusable when they are wrong. WCAG gives an exact
 *   ratio, so "is this readable" has an answer rather than an opinion.
 *
 * Errors refuse the publish; warnings are shown and can be published past. The
 * split is deliberate — a 3.9:1 heading is a judgement call a designer may
 * legitimately win, but a theme with no dark scheme is not a complete artifact
 * whoever is asking.
 *
 * Pure and MUI-free so the publish route, the console's pre-flight and the
 * tests all reach the same verdict from the same code.
 */

export interface ThemeValidationIssue {
  /** Dotted path into the theme, so the editor can focus the offending field. */
  path: string
  message: string
}

export interface ThemeValidation {
  /** No errors. Warnings do not block. */
  ok: boolean
  errors: ThemeValidationIssue[]
  warnings: ThemeValidationIssue[]
}

/**
 * WCAG AA for body text. The same 4.5 the accessibility audit uses, rather
 * than a house number, so a theme that passes here passes there.
 */
export const CONTRAST_AA = 4.5

/**
 * WCAG AA for large text (18pt+/14pt bold) and UI component boundaries. Button
 * labels are judged against this rather than 4.5 because they are large, short
 * and centred, and holding them to body-text contrast rejects palettes that are
 * genuinely fine.
 */
export const CONTRAST_AA_LARGE = 3

const SCHEMES: HostThemeScheme[] = ['light', 'dark']

/**
 * Font families that need no loading. Anything else is either declared in the
 * theme's own `fonts` array or will silently fall back to the browser's default
 * — which is the failure the issue calls out, so it is at least a warning.
 */
const SYSTEM_FAMILIES = new Set(
  [
    'system-ui',
    'sans-serif',
    'serif',
    'monospace',
    'cursive',
    'fantasy',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    'ui-rounded',
    '-apple-system',
    'blinkmacsystemfont',
    'segoe ui',
    'roboto',
    'helvetica',
    'helvetica neue',
    'arial',
    'georgia',
    'times new roman',
    'courier new',
    'inherit',
    'initial',
  ].map((family) => family.toLowerCase()),
)

/**
 * Parses a CSS colour into sRGB channels, or null when it is not something we
 * can reason about.
 *
 * `null` means "not checked", never "failed": a theme is free to use `color-mix`
 * or a CSS variable, and refusing to publish because this parser is narrower
 * than CSS would be a validator inventing a rule the platform does not have.
 */
export function parseColor(
  value: unknown,
): { r: number; g: number; b: number } | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()

  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    const digits = hex[1]
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: parseInt(digits[0] + digits[0], 16),
        g: parseInt(digits[1] + digits[1], 16),
        b: parseInt(digits[2] + digits[2], 16),
      }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
      }
    }
    return null
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(text)
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channels = parts.slice(0, 3).map((part) =>
      part.endsWith('%')
        ? (Number(part.slice(0, -1)) / 100) * 255
        : Number(part),
    )
    if (channels.some((channel) => !Number.isFinite(channel))) return null
    const [r, g, b] = channels
    return { r, g, b }
  }

  if (text === 'white') return { r: 255, g: 255, b: 255 }
  if (text === 'black') return { r: 0, g: 0, b: 0 }
  return null
}

/** WCAG relative luminance. */
function luminance(channels: { r: number; g: number; b: number }): number {
  const channel = (raw: number) => {
    const value = Math.min(255, Math.max(0, raw)) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(channels.r) +
    0.7152 * channel(channels.g) +
    0.0722 * channel(channels.b)
  )
}

/**
 * WCAG contrast ratio between two colours, or null when either is unparseable.
 * Ranges 1 (identical) to 21 (black on white).
 */
export function contrastRatio(a: unknown, b: unknown): number | null {
  const first = parseColor(a)
  const second = parseColor(b)
  if (!first || !second) return null
  const light = Math.max(luminance(first), luminance(second))
  const dark = Math.min(luminance(first), luminance(second))
  return (light + 0.05) / (dark + 0.05)
}

const round = (ratio: number) => Math.round(ratio * 10) / 10

/**
 * The colours a scheme must actually define to be usable on its own.
 *
 * Deliberately short. MUI derives an enormous amount from very little, and
 * demanding a full palette would reject good themes; but a scheme that names no
 * primary, no background and no text has not expressed an identity at all — it
 * is an empty object that happens to have a key.
 */
function validateScheme(
  scheme: HostThemeScheme,
  colors: HostThemeSchemeColors | undefined,
  errors: ThemeValidationIssue[],
  warnings: ThemeValidationIssue[],
): void {
  const at = `colorSchemes.${scheme}`
  if (!colors || !Object.keys(colors).length) {
    errors.push({
      path: at,
      message:
        `This theme defines no ${scheme} scheme. Light and dark are not one ` +
        'palette with a filter — install it and every visitor in ' +
        `${scheme} mode sees the stock palette instead of your design.`,
    })
    return
  }
  if (!colors.primary?.main) {
    errors.push({
      path: `${at}.primary.main`,
      message: `The ${scheme} scheme has no primary colour.`,
    })
  }

  const background = colors.background?.default
  const paper = colors.background?.paper
  const text = colors.text?.primary
  const secondaryText = colors.text?.secondary

  // Text on background is the pair that decides whether a site can be read at
  // all, so it is the one contrast failure that refuses the publish.
  const bodyContrast = contrastRatio(text, background)
  if (bodyContrast != null && bodyContrast < CONTRAST_AA) {
    errors.push({
      path: `${at}.text.primary`,
      message:
        `Body text on the ${scheme} background is ${round(bodyContrast)}:1, ` +
        `below the ${CONTRAST_AA}:1 minimum for readable text.`,
    })
  }

  const paperContrast = contrastRatio(text, paper)
  if (paperContrast != null && paperContrast < CONTRAST_AA) {
    errors.push({
      path: `${at}.background.paper`,
      message:
        `Body text on ${scheme} cards and menus is ${round(paperContrast)}:1, ` +
        `below the ${CONTRAST_AA}:1 minimum. Surfaces inherit this everywhere ` +
        'a Paper is used, which is most of the site.',
    })
  }

  // Secondary text is legitimately dimmer by design, so it warns rather than
  // refuses — but silently shipping unreadable captions is worse than saying so.
  const captionContrast = contrastRatio(secondaryText, background)
  if (captionContrast != null && captionContrast < CONTRAST_AA) {
    warnings.push({
      path: `${at}.text.secondary`,
      message:
        `Secondary text on the ${scheme} background is ` +
        `${round(captionContrast)}:1. Captions and helper text will be hard ` +
        'to read.',
    })
  }

  // A button whose label disappears into its own fill. Only checkable when the
  // theme states contrastText — otherwise MUI derives one, and derives it well.
  for (const key of ['primary', 'secondary', 'error'] as const) {
    const color = colors[key]
    const ratio = contrastRatio(color?.contrastText, color?.main)
    if (ratio != null && ratio < CONTRAST_AA_LARGE) {
      warnings.push({
        path: `${at}.${key}.contrastText`,
        message:
          `The ${scheme} ${key} button label is ${round(ratio)}:1 against its ` +
          `own fill, below ${CONTRAST_AA_LARGE}:1. Leave contrast text unset ` +
          'to let the theme derive a readable one.',
      })
    }
  }
}

/**
 * Every family named in the typography, split out of its CSS stack.
 *
 * A stack is a fallback chain, so only the FIRST entry is the one the design
 * depends on; the rest exist precisely to be substituted and warning about them
 * would be noise.
 */
function declaredFamilies(theme: HostTheme): string[] {
  const stacks: string[] = []
  if (theme.typography?.fontFamily) stacks.push(theme.typography.fontFamily)
  for (const variant of Object.values(theme.typography?.variants ?? {})) {
    if (variant?.fontFamily) stacks.push(variant.fontFamily)
  }
  const primary: string[] = []
  for (const stack of stacks) {
    const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
    if (first) primary.push(first)
  }
  return primary
}

function validateFonts(
  theme: HostTheme,
  warnings: ThemeValidationIssue[],
): void {
  const loadable = new Set(
    (theme.fonts ?? [])
      .map((font: HostThemeFont) => font.family?.trim().toLowerCase())
      .filter(Boolean) as string[],
  )
  const seen = new Set<string>()
  for (const family of declaredFamilies(theme)) {
    const key = family.toLowerCase()
    if (seen.has(key) || loadable.has(key) || SYSTEM_FAMILIES.has(key)) continue
    seen.add(key)
    warnings.push({
      path: 'typography.fontFamily',
      message:
        `"${family}" is used but not listed in the theme's fonts, so it will ` +
        'only appear on machines that happen to have it installed. Add it as ' +
        'a Google font, or fall back to a system family.',
    })
  }
}

/**
 * Validates a theme for publishing.
 *
 * The same function backs the console's pre-flight and the publish route: a
 * publisher who is told "this will be refused" and then has it accepted (or the
 * reverse) stops trusting either, so there is one verdict from one place.
 */
export function validateThemeForPublish(
  theme: HostTheme | null | undefined,
): ThemeValidation {
  const errors: ThemeValidationIssue[] = []
  const warnings: ThemeValidationIssue[] = []

  if (!theme || !Object.keys(theme).length) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          message:
            'This site has no theme customisations yet, so there is nothing ' +
            'to publish.',
        },
      ],
      warnings,
    }
  }

  for (const scheme of SCHEMES) {
    validateScheme(scheme, theme.colorSchemes?.[scheme], errors, warnings)
  }
  validateFonts(theme, warnings)

  return { ok: !errors.length, errors, warnings }
}

/**
 * Every field of a `HostTheme` that is part of the published artifact.
 *
 * Typed as a total record over `keyof HostTheme` on purpose: adding a field to
 * `HostTheme` fails to compile here until someone decides whether it ships. The
 * alternative — a hand-written list of `if` statements — silently drops the new
 * field, and a theme that loses one is not obviously broken, it is subtly
 * wrong. `mixins` arrived exactly that way (AGL-1242, toolbar heights) while
 * this was being written, which is why the check is a type and not a comment.
 *
 * A `false` here would mean "host-local, never published". Nothing is today —
 * `HostTheme` is pure design data — but the shape leaves room to say so.
 */
const THEME_ARTIFACT_FIELDS: Record<keyof Required<HostTheme>, true> = {
  colorSchemes: true,
  typography: true,
  fonts: true,
  shape: true,
  spacing: true,
  mixins: true,
  components: true,
}

/**
 * The theme content as published — the artifact and nothing else.
 *
 * What goes in here is what "reset to the publisher's version" restores and
 * what the update diff compares against, so it must hold no per-install data:
 * a host document also carries `updatedAt`, `updatedBy` and whatever else the
 * editor writes alongside, and any of those in the content would read as a user
 * edit on the next diff.
 *
 * Empty branches are dropped so two themes that render identically also hash
 * identically — `{fonts: []}` and `{}` must not produce two base snapshots.
 */
export function themeArtifactContent(
  theme: HostTheme | null | undefined,
): HostTheme {
  const content: Record<string, unknown> = {}
  if (!theme) return content
  for (const key of Object.keys(THEME_ARTIFACT_FIELDS)) {
    const value = (theme as Record<string, unknown>)[key]
    if (value == null) continue
    if (Array.isArray(value) ? !value.length : typeof value === 'object'
      ? !Object.keys(value as object).length
      : false) {
      continue
    }
    content[key] = value
  }
  return content
}

/**
 * A short, human summary of what a theme actually contains, for the install
 * confirmation and the listing card.
 *
 * Installing a theme replaces a site's visual identity, so the confirmation has
 * to say what is about to change in terms someone recognises — "both schemes,
 * 2 fonts, 4 component styles" — rather than showing them a JSON blob and
 * asking them to agree to it.
 */
export function describeTheme(theme: HostTheme | null | undefined): string[] {
  if (!theme) return []
  const parts: string[] = []
  const schemes = SCHEMES.filter(
    (scheme) => Object.keys(theme.colorSchemes?.[scheme] ?? {}).length,
  )
  if (schemes.length === 2) parts.push('Light and dark schemes')
  else if (schemes.length === 1) parts.push(`${schemes[0]} scheme only`)

  const fonts = theme.fonts?.length ?? 0
  if (fonts) parts.push(`${fonts} font${fonts === 1 ? '' : 's'}`)
  if (theme.typography?.variants) {
    const count = Object.keys(theme.typography.variants).length
    if (count) parts.push(`${count} text style${count === 1 ? '' : 's'}`)
  }
  if (theme.shape?.borderRadius != null) {
    parts.push(`${theme.shape.borderRadius}px corners`)
  }
  if (typeof theme.spacing === 'number') parts.push(`${theme.spacing}px spacing`)
  const components = Object.keys(theme.components ?? {}).length
  if (components) {
    parts.push(`${components} component style${components === 1 ? '' : 's'}`)
  }
  return parts
}

/* ------------------------------------------------------------------------ *
 * The override layer, applied to themes (AGL-1021)
 * ------------------------------------------------------------------------ */

/**
 * The field on a host document holding the site's theme override.
 *
 * A theme is a FIELD on the host, not a document of its own, so it cannot use
 * `ARTIFACT_OVERRIDE_FIELD` — a host may one day override more than one thing,
 * and a bare `overrides` would be the first to claim the name. The override
 * layer is general precisely so a namespaced field works with it unchanged.
 */
export const THEME_OVERRIDE_FIELD = 'themeOverride'

/** A host document, as far as the theme layer is concerned. */
export interface ThemeHostDocument {
  theme?: HostTheme | null
  themeOverride?: unknown
  themeInstalledFrom?: { sha256?: string | null; listingId?: string } | null
}

/** Reads the stored theme override off a host document, tolerating junk. */
export function readThemeOverride(
  host: ThemeHostDocument | null | undefined,
): ArtifactOverride | undefined {
  // The override layer's reader is keyed to its own field name, so hand it a
  // shim rather than duplicating its validation — which is where the "a
  // top-level null blanks the artifact" guard lives.
  return readArtifactOverride({ overrides: host?.themeOverride })
}

/**
 * The site's effective theme: the marketplace theme (or the site's own) with
 * this site's overrides resolved over it.
 *
 * This is the MIDDLE and TOP of the three layers the issue describes. The
 * bottom — the platform default — is applied further down by
 * `HostThemeProvider`, which layers whatever this returns onto the brand base
 * (AGL-1180) so a theme that omits a value still yields a complete theme
 * rather than an undefined-shaped hole. Doing it there rather than here is not
 * a detail: the default is a runtime MUI theme with FUNCTION style overrides
 * that JSON cannot represent, so a "default" merged at this layer would be a
 * lossy copy of the real one.
 *
 * Every surface that renders a site's appearance calls this — the tenant, all
 * four besigner editors, and the document preview — because a theme that
 * resolves differently in the editor than on the site is worse than one that
 * does not resolve at all.
 */
export function resolveSiteTheme(
  host: ThemeHostDocument | null | undefined,
): HostTheme | undefined {
  const base = host?.theme ?? undefined
  const override = readThemeOverride(host)
  if (!override) return base
  return resolveOverride<HostTheme>(base ?? {}, override.patch)
}

/**
 * Was this override authored against the theme currently installed?
 *
 * False after a theme swap, which is the whole reason `baseSha256` is recorded.
 * Overrides deliberately SURVIVE a swap (the issue's call, and the right one —
 * a brand colour still expresses intent when the theme underneath it changes)
 * but surviving silently is what would surprise people, so every surface that
 * shows an override can ask this and say so.
 *
 * True when there is no override, and when either side has no hash to compare:
 * "we cannot tell" must not render as "these are stale".
 */
export function isOverrideForCurrentTheme(
  host: ThemeHostDocument | null | undefined,
): boolean {
  const override = readThemeOverride(host)
  if (!override?.baseSha256) return true
  const installed = host?.themeInstalledFrom?.sha256
  if (!installed) return true
  return override.baseSha256 === installed
}

/** One row of the "what have I changed?" view. */
export interface ThemeOverrideEntry {
  /** Dotted path into the theme, e.g. `colorSchemes.dark.primary.main`. */
  path: string
  /** A human label for the path, for a UI that is not a JSON viewer. */
  label: string
  /** Which scheme this touches, when it touches one. */
  scheme?: HostThemeScheme
  /** The publisher's value, or undefined when the override adds the field. */
  themeValue: unknown
  /** What this site set it to, or undefined when the override removes it. */
  overrideValue: unknown
}

const SEGMENT_LABELS: Record<string, string> = {
  colorSchemes: 'Colour',
  typography: 'Typography',
  components: 'Component',
  shape: 'Shape',
  spacing: 'Spacing',
  fonts: 'Fonts',
  mixins: 'Layout',
  variants: '',
  background: 'background',
  text: 'text',
  main: '',
  contrastText: 'label colour',
  borderRadius: 'corner radius',
  fontFamily: 'font',
}

/**
 * A readable label for a theme path.
 *
 * "Colour · dark · primary" beats `colorSchemes.dark.primary.main`, and the
 * difference matters because this list is the answer to "what have I changed?"
 * — a question nobody asks wanting to read JSON paths.
 */
export function describeThemePath(path: string): string {
  const segments = path.split('.').filter(Boolean)
  const words: string[] = []
  for (const segment of segments) {
    const mapped = SEGMENT_LABELS[segment]
    if (mapped === '') continue
    words.push(mapped ?? segment)
  }
  return words.join(' · ') || 'the whole theme'
}

/**
 * "What have I changed?" — the patch, rendered.
 *
 * Literally a read of the stored override rather than a diff computed at call
 * time, which is the property the whole layer exists to provide: the answer is
 * the thing that was saved, so it cannot disagree with what will be applied.
 */
export function describeThemeOverride(
  host: ThemeHostDocument | null | undefined,
): ThemeOverrideEntry[] {
  const override = readThemeOverride(host)
  if (!override) return []
  const base = host?.theme ?? {}
  const resolved = resolveOverride<HostTheme>(base, override.patch)
  return overridePaths(override.patch).map((path) => {
    const segments = path.split('.')
    const scheme =
      segments[0] === 'colorSchemes' &&
      (segments[1] === 'light' || segments[1] === 'dark')
        ? (segments[1] as HostThemeScheme)
        : undefined
    return {
      path,
      label: describeThemePath(path),
      scheme,
      themeValue: readThemePath(base, path),
      overrideValue: readThemePath(resolved, path),
    }
  })
}

/** Reads a dotted path out of a theme. */
function readThemePath(theme: unknown, path: string): unknown {
  let cursor: unknown = theme
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * The override this site should store after the theme editor produced `edited`.
 *
 * The editor edits the RESOLVED theme — that is what it renders and what the
 * user sees — so the patch is the difference between the publisher's base and
 * what came back. Diffing here rather than tracking per-field dirty state means
 * a field the user set and then set back to the theme's value stops being an
 * override, which is what "reset" means without needing a reset button to have
 * been pressed.
 */
export function themeOverridePatch(
  host: ThemeHostDocument | null | undefined,
  edited: HostTheme,
): unknown {
  return diffOverride(host?.theme ?? {}, edited)
}

/**
 * Where this site's overrides sit on top of values a theme update also changes
 * — the only place a conflict can exist.
 *
 * Narrow by construction: an override touching four paths can conflict in at
 * most four places however much of the theme the publisher rewrote. That is the
 * difference between "the publisher also changed your heading colour, whose
 * wins?" and "this update rewrites your theme, continue?".
 */
export function themeUpdateConflicts(
  host: ThemeHostDocument | null | undefined,
  incoming: HostTheme,
): ThemeOverrideEntry[] {
  const override = readThemeOverride(host)
  if (!override || isEmptyOverride(override.patch)) return []
  const base = host?.theme ?? {}
  const resolved = resolveOverride<HostTheme>(base, override.patch)
  return overrideConflicts(base, override.patch, incoming).map((path) => ({
    path,
    label: describeThemePath(path),
    scheme:
      path.startsWith('colorSchemes.light.')
        ? ('light' as const)
        : path.startsWith('colorSchemes.dark.')
          ? ('dark' as const)
          : undefined,
    themeValue: readThemePath(incoming, path),
    overrideValue: readThemePath(resolved, path),
  }))
}
