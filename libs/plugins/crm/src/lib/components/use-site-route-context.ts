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
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'

/**
 * The SITE a CRM surface asks the record-route registry about — the
 * organization's slug and the site's subdomain — or `null` when it cannot
 * name one (AGL-3080).
 *
 * What a CRM record page links to on another plugin's page is a site's: the
 * report of an email a site sent, the Sending section that fixes a site's
 * missing identity. The address itself is the owner's to publish
 * (`pluginRecordHref('emailMessage', …)`), and this names the site to ask it
 * for. Read off the URL rather than resolved, because the `[host]` segment is
 * the site's subdomain and nothing a CRM component holds says what that is.
 *
 * ⚠️ Under a site, THIS SITE only. A record page under one site cannot
 * address a sibling site's pages without that site's subdomain, which a
 * contact document does not carry.
 *
 * At the ORGANIZATION level (AGL-2634) the URL names no site, and the mount
 * holds the org's site list instead: handed a `hostId`, this answers that
 * site — or `null` for a site whose subdomain the list could not answer,
 * which is named and not linked. Handed none, `null`: an org-level page has
 * no site of its own to fall back to.
 */
export function useSiteRouteContext(hostId?: string | null): PluginRecordRouteContext | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const mount = useCrmOrgMount()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (orgSlug && host) return { orgSlug, host }
  if (!mount || !hostId) return null
  const subdomain = mount.siteSubdomain(hostId)
  return subdomain ? { orgSlug: mount.orgSlug, host: subdomain } : null
}

export default useSiteRouteContext
