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
 * The MARKETING console's URL: under the site being read, or the
 * organization's own Marketing hub on a page that names no site.
 *
 * A converted record — a form submission in the Inbox, a contact in
 * Contacts — links to the campaign it came from, and the surfaces that draw
 * those records are handed their own hub's `basePath`, not this one's.
 *
 * Free, deliberately: the org slug and the subdomain are already in the URL
 * the console is on, so this reads the route rather than resolving the host
 * document — the two `getDoc`s that resolution costs would be paid on every
 * open of a card, to render a link. `null` before the params resolve, so
 * callers render plain text rather than a link to nowhere.
 *
 * Campaigns belong to the organization, so the org-level CRM and the org
 * Marketing hub itself link a campaign to `/[orgSlug]/marketing/campaigns/{id}`.
 */
export function useMarketingHubPath(): string | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const orgSlug = params?.orgSlug
  if (!orgSlug) return null
  return params?.host
    ? buildRoute(Route.HOST_PLUGIN, {
        orgSlug,
        host: params.host,
        pluginSlug: MARKETING_SLUG,
      })
    : orgMarketingHubPath(orgSlug)
}

/** The Marketing hub's URL slug, under a site and under the org alike. */
const MARKETING_SLUG = 'marketing'

/** The organization's own Marketing hub, `/[orgSlug]/marketing`. */
export function orgMarketingHubPath(orgSlug: string): string {
  return buildRoute(Route.ORG_PLUGIN, { orgSlug, pluginSlug: MARKETING_SLUG })
}

export default useMarketingHubPath
