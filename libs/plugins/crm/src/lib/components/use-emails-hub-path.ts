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
 * ⚠️ THIS SITE's hub only. A record page under one site cannot address a
 * sibling site's Emails console without that site's subdomain, which a
 * contact document does not carry. A mount that holds the org's host list —
 * the org-level contacts surface does — should hand the component a href
 * builder of its own rather than this one.
 */
export function useEmailsHubPath(): string | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (!orgSlug || !host) return null
  return buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: 'emails' })
}

export default useEmailsHubPath
