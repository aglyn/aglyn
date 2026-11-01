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

import type { Theme } from '@mui/material/styles'

/**
 * Stripe Elements' `appearance`, built from the RESOLVED MUI theme.
 *
 * The card form is Stripe's iframe sitting in the middle of our own card,
 * between our own `TextField`s. If its fields are a different height, radius,
 * font or border weight, the seam is the thing the customer notices — which
 * is the whole objection inline Elements exist to answer. So every value here
 * is read off the theme, and none is written down: a hardcoded palette copy
 * stops matching the first time the scheme moves, and nothing would fail.
 *
 * ## Why CSS variables have to be resolved first
 *
 * The console's theme is served through MUI's `cssVariables` surfaces, so
 * `theme.palette.primary.main` can come back as the STRING
 * `'var(--mui-palette-primary-main)'` rather than a color. That string is
 * fine in our own DOM and useless to Stripe: Elements paints inside a
 * cross-origin iframe on Stripe's domain, where our custom properties do not
 * exist. The variable resolves to nothing, and the field renders with
 * Stripe's default — silently, on a surface nobody re-checks after a theme
 * change.
 *
 * `resolveCssVar` is therefore not a nicety. It reads the computed value off
 * the document once, so what crosses the iframe boundary is always a literal
 * color.
 */

/** Reads a custom property's computed value from the document root. */
export type CssVarResolver = (name: string) => string

const documentResolver: CssVarResolver = (name) => {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
}

/**
 * Turn whatever the theme handed us into a literal a cross-origin iframe can
 * paint with.
 *
 * Handles the nested form MUI emits — `var(--a, var(--b, #fff))` — by
 * resolving outside-in and falling back to the declared default, which is
 * what the browser itself would do.
 */
export function resolveThemeColor(
  value: unknown,
  resolveCssVar: CssVarResolver = documentResolver,
  depth = 0,
): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  // Bounded: a malformed theme could otherwise loop on a self-referential var.
  if (depth > 4) return ''
  if (!raw.startsWith('var(')) return raw
  const inner = raw.slice('var('.length, raw.lastIndexOf(')'))
  const comma = inner.indexOf(',')
  const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
  const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim()
  const resolved = resolveCssVar(name)
  if (resolved) return resolveThemeColor(resolved, resolveCssVar, depth + 1)
  return fallback ? resolveThemeColor(fallback, resolveCssVar, depth + 1) : ''
}

/** The subset of Stripe's appearance object this builds. */
export interface StripeAppearance {
  theme: 'stripe' | 'night'
  variables: Record<string, string>
  rules: Record<string, Record<string, string>>
}

/**
 * Build the appearance for one resolved MUI theme.
 *
 * `theme: 'night'` for a dark scheme rather than only recoloring: Stripe's
 * base theme decides things the variables do not reach — icon artwork, the
 * dropdown surface, autofill styling — and a light base wearing dark colors
 * shows through on exactly those.
 */
export function stripeAppearanceFromTheme(
  theme: Theme,
  resolveCssVar: CssVarResolver = documentResolver,
): StripeAppearance {
  const color = (value: unknown) => resolveThemeColor(value, resolveCssVar)
  const palette = theme.palette
  const radius =
    typeof theme.shape?.borderRadius === 'number'
      ? `${theme.shape.borderRadius}px`
      : String(theme.shape?.borderRadius ?? '4px')

  return {
    theme: palette.mode === 'dark' ? 'night' : 'stripe',
    variables: {
      colorPrimary: color(palette.primary?.main),
      // The card's own surface, not the page's — Elements sits inside a
      // `CardDisplay`, which is `background.paper`.
      colorBackground: color(palette.background?.paper),
      colorText: color(palette.text?.primary),
      colorTextSecondary: color(palette.text?.secondary),
      colorTextPlaceholder: color(palette.text?.disabled),
      colorDanger: color(palette.error?.main),
      colorSuccess: color(palette.success?.main),
      // The whole font stack, so a fallback face matches ours too.
      fontFamily: String(theme.typography?.fontFamily ?? ''),
      fontSizeBase: String(theme.typography?.body1?.fontSize ?? '1rem'),
      borderRadius: radius,
      // Spacing is 8 here; Stripe multiplies its own scale by this.
      spacingUnit: theme.spacing(0.5),
    },
    rules: {
      '.Input': {
        // The token that exists because MUI has none — see `PaletteOptions`.
        border: `1px solid ${color(palette.inputOutline)}`,
        boxShadow: 'none',
      },
      '.Input:hover': {
        border: `1px solid ${color(palette.text?.primary)}`,
      },
      '.Input:focus': {
        // MUI's outlined field thickens its border on focus rather than
        // adding a glow; matching that is what keeps the two seamless.
        border: `2px solid ${color(palette.primary?.main)}`,
        boxShadow: 'none',
        outline: 'none',
      },
      '.Input--invalid': {
        border: `1px solid ${color(palette.error?.main)}`,
        boxShadow: 'none',
      },
      '.Label': {
        color: color(palette.text?.secondary),
      },
    },
  }
}
