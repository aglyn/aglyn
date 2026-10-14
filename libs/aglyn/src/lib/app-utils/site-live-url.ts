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

import { TENANT_APEX } from './tenant-apex'

/**
 * Where a site's pages are live, as the CONSOLE reaches them (AGL-3758):
 * the custom domain, else the platform subdomain, else — on a preview or
 * local console — the tenant preview origin with `?tenantHost=`. Moved out of
 * the console app so a plugin's console card (the Actions element picker)
 * opens the same page every "View live" link does.
 */

// Preview consoles link to the tenant preview deployment, which carries
// no tenant subdomain and resolves the host via the ?tenantHost= override.
const TENANT_PREVIEW_HOST =
  process.env.NEXT_PUBLIC_AGLYN_TENANT_PREVIEW_HOST ||
  'aglyn-tenant-git-main-aglyn.vercel.app'

/**
 * A console served from localhost links to the LOCAL tenant dev server
 * (AGL-1203), not the remote preview deployment.
 *
 * Sending a local console to `aglyn-tenant-git-main-*.vercel.app` meant every
 * Live link 404'd for anything that had not been deployed yet — which is the
 * normal state of the work you are doing on localhost. `nx serve tenant`
 * listens on 4500; override for a different port.
 */
const TENANT_LOCAL_ORIGIN =
  process.env.NEXT_PUBLIC_AGLYN_TENANT_LOCAL_ORIGIN || 'http://localhost:4500'

/** True for `localhost` and `*.localhost`, which have a local tenant to use. */
export function isLocalConsole(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

export function isPreviewConsole(hostname: string): boolean {
  return (
    hostname.endsWith('.vercel.app') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost')
  )
}

/** The live URL for a site-relative slug on this host's real origin. */
export function siteLiveUrlForSlug(
  host: { subdomain?: string | null; cname?: string | null } | undefined,
  slug: string,
  consoleHostname: string | undefined = typeof window !== 'undefined'
    ? window.location.hostname
    : undefined,
): string | undefined {
  if (!host) return undefined
  // Published slugs are stored with a leading slash ("/product/besigner");
  // the origin already ends without one, so strip it rather than emitting the
  // "//" that every one of these URLs used to carry.
  const path = slug === '/' ? '' : String(slug).replace(/^\/+/, '')

  if (consoleHostname && isPreviewConsole(consoleHostname)) {
    if (!host.subdomain) return undefined
    const tenantHost = encodeURIComponent(host.subdomain)
    // Local console → local tenant. Both resolve the site through the same
    // `?tenantHost=` override; only the origin differs.
    const origin = isLocalConsole(consoleHostname)
      ? TENANT_LOCAL_ORIGIN
      : `https://${TENANT_PREVIEW_HOST}`
    return `${origin}/${path}?tenantHost=${tenantHost}`
  }

  const domain =
    host.cname || (host.subdomain ? `${host.subdomain}.${TENANT_APEX}` : undefined)
  if (!domain) return undefined
  return `https://${domain}/${path}`
}
