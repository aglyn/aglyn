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
 * The Emails console's URL under the site being read.
 *
 * A campaign's page links to two records it does not own — the message that
 * was sent inside it, and the template that message was built from — and both
 * keep their pages on the Emails console. The shell hands a plugin page only
 * its OWN `basePath`, so the sibling hub is named here by its SLUG rather
 * than by editing the last segment off the current path: a slug is a string
 * this file can be searched for when a surface moves, and string surgery on
 * somebody else's path is a link that keeps resolving to the wrong place.
 *
 * Free, deliberately. The org slug and the subdomain are already in the URL
 * the console is on, so this reads the route rather than resolving the host
 * document — the two `getDoc`s that resolution costs would be paid on every
 * open of a campaign, to render a link.
 *
 * `null` before the params resolve, so callers render plain text rather than
 * a link to nowhere.
 */
export function useEmailsHubPath(): string | null {
  return useConsoleHubPath('emails')
}

/**
 * The MARKETING console's URL under the site being read.
 *
 * Named for the same reason the Emails one is, from the opposite direction: a
 * converted record — a form submission in the Inbox, a contact in Contacts —
 * links to the campaign it came from, and those surfaces are handed their own
 * hub's `basePath`, not this one's.
 */
export function useMarketingHubPath(): string | null {
  return useConsoleHubPath('marketing')
}

/**
 * Any sibling hub's URL, by plugin slug.
 *
 * One implementation, because "read the org slug and the subdomain off the
 * route rather than resolving the host document" is the property that keeps
 * these links free, and a second copy of it is where somebody pays for the
 * two `getDoc`s instead.
 */
export function useConsoleHubPath(pluginSlug: string): string | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (!orgSlug || !host) return null
  return buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug })
}

export default useEmailsHubPath
