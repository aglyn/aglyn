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
import { buildFontFamilyList } from './constants'
import { TENANT_SYSTEM_FONT_STACK, wearsPlatformBrand } from './platform-brand'

/**
 * What a site's base theme draws with, as far as its fonts go (AGL-3656): the
 * face, and the weights of the platform's text styles. Read by the published
 * page's server layout, so it holds no MUI; it is never in a browser bundle.
 */

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
