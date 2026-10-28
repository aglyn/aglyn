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

import { TENANT_APEX, liveCustomDomain, type HostCustomDomainState } from '@aglyn/aglyn/app-utils/host-naming'
import { WAIVERS_SITE_SIGN_PATH } from '../constants/bundle-common'

/*==========================================
 * WHERE A SHARE LINK OPENS (AGL-4042): the store's own site, branded, never
 * the console's address. Kept out of the model barrel, because only the
 * server builds these links: the console is handed the origin it reads.
 *=========================================*/

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The origin a store's signing page is served on: its custom domain while it
 * is actually serving (a domain still attaching, or being disconnected, is
 * passed over, since a printed QR code outlives either), else its platform
 * address, which forwards to the custom domain once it serves. `null` for a
 * site with neither.
 */
export function waiverSiteOrigin(host: HostCustomDomainState | Record<string, unknown> | null | undefined): string | null {
  const state = (host ?? {}) as HostCustomDomainState
  const domain = liveCustomDomain(state)
  if (domain) return `https://${domain}`
  const subdomain = String(state.subdomain ?? '').trim().toLowerCase()
  return SUBDOMAIN.test(subdomain) ? `https://${subdomain}.${TENANT_APEX}` : null
}

/** The store's signing page: for one waiver, or the site's list when none is named. */
export function waiverSiteSignUrl(origin: string, waiverId?: string | null): string {
  const base = `${origin.replace(/\/+$/, '')}/${WAIVERS_SITE_SIGN_PATH}`
  return waiverId ? `${base}?${new URLSearchParams({ waiver: waiverId }).toString()}` : base
}
