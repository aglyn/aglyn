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

import type { HostThemeFont } from '@aglyn/shared-data-types'
import { buildFontFamilyList, FontFamily } from './constants'

/**
 * The platform brand as data with no MUI in it (AGL-3656): which hosts wear
 * it, the face it is set in, and the weights its text styles draw with. A
 * published page's server layout reads these to load the right fonts, and it
 * is a Server Component, where importing the built themes would pull MUI's
 * React context into the server graph (AGL-405).
 */

/**
 * Hosts whose brand IS the operator's own brand, and which therefore keep
 * `consoleOptions` rather than the tenant default.
 *
 * Comma-separated in `NEXT_PUBLIC_PLATFORM_BRAND_HOSTS`, so a self-host
 * operator points it at their own marketing domain and their customers still
 * resolve the neutral tenant palette. The literal is the `??` default and
 * nothing else reads it: the platform's own deployment needs no variable to
 * keep its brand. Setting the variable to an empty string puts every host,
 * including the operator's own, on the tenant default.
 *
 * Matched on the registrable domain, after stripping the `cname--` prefix the
 * tenant middleware puts on a CUSTOM DOMAIN before it becomes the `[host]`
 * route segment: the param this is handed reads `cname--example.com`, never
 * the bare apex. A platform subdomain resolves to a bare label instead
 * (`acme` for `acme.aglyn.app`), which correctly matches nothing — a customer
 * on a platform subdomain is still a tenant.
 */
const CNAME_PREFIX = 'cname--'

export const PLATFORM_BRAND_HOSTS: ReadonlySet<string> = new Set(
  // Dot notation, not brackets: Next substitutes `process.env.NAME`
  // TEXTUALLY, and never the bracket form, so a bracket read is `undefined`
  // in any browser or edge bundle and silently falls back to the default
  // below — which on a self-host install would hand the operator Aglyn's
  // hosts (AGL-2037).
  (process.env.NEXT_PUBLIC_PLATFORM_BRAND_HOSTS ?? 'aglyn.com,aglyn.io')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
)

export function wearsPlatformBrand(host: string | undefined): boolean {
  if (!host) return false
  const normalized = host.trim().toLowerCase()
  return PLATFORM_BRAND_HOSTS.has(
    normalized.startsWith(CNAME_PREFIX)
      ? normalized.slice(CNAME_PREFIX.length)
      : normalized,
  )
}

/** The platform brand's face. */
export const PLATFORM_BRAND_FONT_FAMILY = 'Roboto Flex'

/**
 * The brand's face as a theme font: what an operator's own host loads when its
 * theme names no font of its own. The brand stack has always named it first,
 * and nothing loaded it, so aglyn.com drew in Roboto Flex on machines that
 * have it installed and in the system font everywhere else.
 */
export const PLATFORM_BRAND_FONT: HostThemeFont = {
  family: PLATFORM_BRAND_FONT_FAMILY,
  source: 'google',
  category: 'sans-serif',
}

/**
 * The face a customer site draws with until its theme picks one: the
 * visitor's own system font (AGL-3656).
 *
 * The platform's stack names Roboto Flex first, and Roboto Flex is the
 * platform's brand, which only the platform's own surfaces load. A
 * customer site loads only the fonts its theme lists, so naming Roboto Flex
 * there loaded nothing, and drew the page in Roboto Flex on the few machines
 * that have it installed and in the system font everywhere else — one site,
 * two typefaces, depending on whose computer it was. The system stack costs
 * no bytes and draws the same face on every visit.
 */
export const TENANT_SYSTEM_FONT_STACK = buildFontFamilyList(FontFamily.APPLE_SYSTEM)
  .filter((family, index, all) => all.indexOf(family) === index)
  .filter((family) => !/roboto flex/i.test(family))
  .join(',')

/**
 * The weights the platform's text styles draw with — the brand's ramp over
 * MUI's defaults — and its named weights, in the shape of MUI typography
 * options. `platform-brand.spec.ts` holds it to the built console theme, so a
 * change to the ramp there fails until it is made here too.
 */
export const PLATFORM_TYPE_RAMP_WEIGHTS: Readonly<Record<string, unknown>> = {
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,
  fontWeightSemiBold: 600,
  fontWeightExtraBold: 800,
  fontWeightBlack: 900,
  displayXl: { fontWeight: 900 },
  h1: { fontWeight: 900 },
  h2: { fontWeight: 800 },
  h3: { fontWeight: 700 },
  h4: { fontWeight: 400 },
  h5: { fontWeight: 400 },
  h6: { fontWeight: 500 },
  subtitle1: { fontWeight: 400 },
  subtitle2: { fontWeight: 500 },
  body1: { fontWeight: 400 },
  body2: { fontWeight: 400 },
  button: { fontWeight: 500 },
  caption: { fontWeight: 400 },
  overline: { fontWeight: 400 },
  lede: { fontWeight: 400 },
  bodyCompact: { fontWeight: 400 },
  micro: { fontWeight: 400 },
}

/**
 * The typography a site's theme is layered onto, as far as fonts go: the
 * brand stack on an operator host, the system stack on a customer's, and the
 * platform's weights either way.
 */
export function siteBaseTypography(host: string | undefined): Record<string, unknown> {
  return {
    ...PLATFORM_TYPE_RAMP_WEIGHTS,
    fontFamily: wearsPlatformBrand(host)
      ? buildFontFamilyList().join(',')
      : TENANT_SYSTEM_FONT_STACK,
  }
}

/**
 * The fonts a site's base draws with that its theme does not list: the brand
 * face on an operator host whose theme names no family of its own, else none.
 */
export function siteBaseFonts(
  host: string | undefined,
  theme: { fonts?: readonly HostThemeFont[]; typography?: { fontFamily?: string } } | undefined,
): HostThemeFont[] {
  if (!wearsPlatformBrand(host)) return []
  if (theme?.typography?.fontFamily) return []
  const listed = (theme?.fonts ?? []).some(
    (font) => font.family?.trim().toLowerCase() === PLATFORM_BRAND_FONT_FAMILY.toLowerCase(),
  )
  return listed ? [] : [PLATFORM_BRAND_FONT]
}
