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

import type { AglynHost, ScreenUid } from '@aglyn/aglyn'

const TENANT_PRODUCTION_ROOT = 'aglyn.app'

// Preview/dev consoles link to the tenant preview deployment, which carries
// no tenant subdomain and resolves the host via the ?tenantHost= override.
const TENANT_PREVIEW_HOST =
  process.env.NEXT_PUBLIC_AGLYN_TENANT_PREVIEW_HOST ||
  'aglyn-tenant-git-main-aglyn.vercel.app'

/**
 * The site's public address for display (AGL-632): its custom domain when
 * connected, otherwise the assigned Aglyn subdomain (`{subdomain}.aglyn.app`).
 * Always the production domain — this is a label, not a live link.
 */
export function hostDisplayDomain(
  host: { cname?: string; subdomain?: string } | undefined,
): string | undefined {
  if (!host) return undefined
  return (
    host.cname ||
    (host.subdomain ? `${host.subdomain}.${TENANT_PRODUCTION_ROOT}` : undefined)
  )
}

export function isPreviewConsole(hostname: string): boolean {
  return (
    hostname.endsWith('.vercel.app') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost')
  )
}

export function buildScreenLiveUrl(
  host: AglynHost | undefined,
  screenId: ScreenUid,
): string | undefined {
  if (!host) return undefined
  const slug = host.screens?.[screenId]
  if (slug == null) return undefined
  const path = slug === '/' ? '' : slug

  if (
    typeof window !== 'undefined' &&
    isPreviewConsole(window.location.hostname)
  ) {
    if (!host.subdomain) return undefined
    const tenantHost = encodeURIComponent(host.subdomain)
    return `https://${TENANT_PREVIEW_HOST}/${path}?tenantHost=${tenantHost}`
  }

  const domain =
    host.cname ||
    (host.subdomain ? `${host.subdomain}.${TENANT_PRODUCTION_ROOT}` : undefined)
  if (!domain) return undefined
  return `https://${domain}/${path}`
}
