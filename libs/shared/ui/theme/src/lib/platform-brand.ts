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
 * Hosts wearing the operator's own brand (AGL-2703), with no MUI so a Server
 * Component can ask (AGL-3656). `NEXT_PUBLIC_PLATFORM_BRAND_HOSTS` lists them
 * (the literal is its default; empty puts every host on the tenant default),
 * matched after the middleware's `cname--` prefix; a platform subdomain is a
 * bare label and matches nothing.
 */
const CNAME_PREFIX = 'cname--'

export const PLATFORM_BRAND_HOSTS: ReadonlySet<string> = new Set(
  // Dot notation: Next inlines `process.env.NAME` textually, never the
  // bracket form, which would read undefined in a browser (AGL-2037).
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
 * A customer site's face until its theme picks one: the system stack, minus
 * the brand's Roboto Flex, which only the platform's own surfaces load
 * (AGL-3656). Naming it drew a site in Roboto Flex only where it happened to
 * be installed.
 */
export const TENANT_SYSTEM_FONT_STACK = buildFontFamilyList()
  .filter((family) => family !== FontFamily.ROBOTO_FLEX)
  .join(',')
