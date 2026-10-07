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
import type { Appearance, CssFontSource } from '@stripe/stripe-js'

/**
 * The site theme, translated for Stripe's Appearance API (AGL-3606).
 *
 * Stripe draws the card, address and wallet fields in its own iframes, which
 * inherit nothing from the page: not the palette, not the radius, not the
 * font. Without this the in-page form is Stripe's default blue-and-grey on a
 * storefront the merchant styled, which reads as a third party's widget
 * rather than as their checkout.
 *
 * Read from the MUI theme the storefront already renders under — the site's
 * own theme tokens — so a merchant's theme edit reaches the payment fields
 * the same way it reaches every other block.
 */

/**
 * Stripe parses colors and lengths inside its iframe, where a CSS custom
 * property from the page cannot resolve. A theme built in CSS-variables mode
 * hands out `var(--…)` strings, and passing one through would have Stripe
 * reject the whole appearance object; dropping that one variable keeps
 * Stripe's default for it and everything else themed.
 */
function usable(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('var(')) return undefined
  return trimmed
}

function radius(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`
  return usable(value)
}

/**
 * Families a browser already has, or keywords that are not families at all.
 * Asking Google Fonts for one of these is a 400 at best, so only the first
 * family that is NOT one of them is loaded into Stripe's frames.
 */
const LOCAL_FAMILIES = new Set(
  [
    'inherit',
    'initial',
    'sans-serif',
    'serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    '-apple-system',
    'blinkmacsystemfont',
    'segoe ui',
    'helvetica',
    'helvetica neue',
    'arial',
    'georgia',
    'times',
    'times new roman',
    'courier',
    'courier new',
    'verdana',
    'tahoma',
  ].map((family) => family.toLowerCase()),
)

/** The families named in a CSS `font-family` value, unquoted, in order. */
export function fontFamilies(fontFamily: string | undefined): string[] {
  return String(fontFamily ?? '')
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean)
}

/**
 * The stylesheet that puts the theme's own typeface inside Stripe's frames,
 * or none when the theme uses only system fonts.
 *
 * The page itself self-hosts its theme fonts (AGL-3485), but those files are
 * served from the site's origin for the site's document; Stripe's frames load
 * fonts only from a `cssSrc` they fetch themselves. Google's CSS2 endpoint is
 * where every theme font comes from in the first place, so the same family
 * resolves to the same face.
 */
export function storefrontPaymentFonts(
  fontFamily: string | undefined,
): CssFontSource[] {
  const family = fontFamilies(fontFamily).find(
    (name) =>
      !LOCAL_FAMILIES.has(name.toLowerCase()) &&
      !name.toLowerCase().startsWith('ui-') &&
      /^[A-Za-z0-9 ]+$/.test(name),
  )
  if (!family) return []
  return [
    {
      cssSrc: `https://fonts.googleapis.com/css2?family=${family.replace(/ +/g, '+')}:wght@400;500;600;700&display=swap`,
    },
  ]
}

export function storefrontPaymentAppearance(theme: Theme): Appearance {
  const variables: NonNullable<Appearance['variables']> = {}
  const set = (key: keyof typeof variables, value: string | undefined) => {
    if (value) (variables as Record<string, string>)[key] = value
  }
  set('colorPrimary', usable(theme.palette?.primary?.main))
  set('colorBackground', usable(theme.palette?.background?.paper))
  set('colorText', usable(theme.palette?.text?.primary))
  set('colorTextSecondary', usable(theme.palette?.text?.secondary))
  set('colorDanger', usable(theme.palette?.error?.main))
  set('fontFamily', usable(theme.typography?.fontFamily))
  set('borderRadius', radius(theme.shape?.borderRadius))
  return {
    // `night` is Stripe's dark base. The variables above override its colors
    // where the theme states one, so this only decides the fallbacks — the
    // field borders and placeholder tones a theme has no token for.
    theme: theme.palette?.mode === 'dark' ? 'night' : 'stripe',
    variables,
  }
}
