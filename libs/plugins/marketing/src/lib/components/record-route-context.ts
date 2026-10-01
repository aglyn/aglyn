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

'use client'

import type { PluginRecordRouteContext } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { useParams } from 'next/navigation'
import type { MarketingOrgMount } from './marketing-org-mount'
import { useMarketingOrgMount } from './marketing-org-mount'

/**
 * The scope a Marketing card asks another plugin's record routes in: the
 * organization's when the hub is mounted over the org, else the site's from
 * the route.
 *
 * A campaign's page links to records it does not own — the message that was
 * sent inside it, the template that message was built from — and their pages
 * are the Emails page's. The card asks the record-route registry for the
 * kind (`emailMessage`, `emailTemplate`) in this scope rather than spelling
 * that page's slug, and gets `null` — text instead of a link — where the
 * plugin that owns the page is not loaded.
 *
 * Read from the route and the mount, never from a host document, so a link
 * costs no read. `null` before the params resolve.
 */
export function useRecordRouteContext(): PluginRecordRouteContext | null {
  const orgMount = useMarketingOrgMount()
  const params = useParams<{ orgSlug: string; host: string }>()
  if (orgMount) return { orgSlug: orgMount.orgSlug, host: null }
  const orgSlug = params?.orgSlug
  const host = params?.host
  return orgSlug && host ? { orgSlug, host } : null
}

/**
 * The scope for a record that stays a SITE's — a send's template is the
 * sending site's design. Under a site that is the site already in scope; over
 * the org it is the row's own site, by its subdomain in the mount, or `null`
 * for a site the mount does not name.
 */
export function siteRecordRouteContext(
  context: PluginRecordRouteContext | null,
  orgMount: MarketingOrgMount | null,
  hostId: string | null | undefined,
): PluginRecordRouteContext | null {
  if (!context) return null
  if (!orgMount) return context
  const subdomain = hostId ? orgMount.hosts.find((host) => host.id === hostId)?.subdomain : null
  return subdomain ? { orgSlug: orgMount.orgSlug, host: subdomain } : null
}
