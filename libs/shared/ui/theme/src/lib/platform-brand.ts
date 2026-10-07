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

import { buildFontFamilyList, FontFamily } from './constants'

/**
 * The platform brand as data with no MUI in it (AGL-3656): which hosts wear
 * it, and the face a site that does not draws with. A published page's
 * server layout reads these, and it is a Server Component, where importing
 * the built themes would pull MUI's React context into the server graph
 * (AGL-405).
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
