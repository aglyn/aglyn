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
