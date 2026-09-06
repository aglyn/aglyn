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

import { buildRoute, Route } from '@aglyn/aglyn'
import { useParams } from 'next/navigation'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'

/**
 * The Emails hub of the site this page is on — `/{org}/hosts/{site}/emails`
 * — or `null` when the page is not under a site.
 *
 * The sibling-hub pattern the Emails console uses to reach Marketing, in the
 * other direction: a CRM record page links a campaign entry to the email's
 * own report, which lives on the Emails surface, and the shell's `basePath`
 * names only this surface. Read off the URL rather than derived from
 * `basePath`, because the `[host]` segment is the site's subdomain and
 * nothing a CRM component holds says what that is.
 *
 * ⚠️ Under a site, THIS SITE's hub only. A record page under one site cannot
 * address a sibling site's Emails console without that site's subdomain,
 * which a contact document does not carry.
 *
 * At the ORGANIZATION level (AGL-2634) the URL names no site, and the mount
 * holds the org's site list instead: handed a `hostId`, this answers that
 * site's hub — `${hostsPath}/${subdomain}/emails` — or `null` for a site
 * whose subdomain the list could not answer, which is named and not linked.
 * Handed none, `null`: an org-level page has no hub of its own to fall
 * back to.
 */
export function useEmailsHubPath(hostId?: string | null): string | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const mount = useCrmOrgMount()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (orgSlug && host) {
    return buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: 'emails' })
  }
  if (!mount || !hostId) return null
  const subdomain = mount.siteSubdomain(hostId)
  return subdomain ? `${mount.hostsPath}/${encodeURIComponent(subdomain)}/emails` : null
}

export default useEmailsHubPath
