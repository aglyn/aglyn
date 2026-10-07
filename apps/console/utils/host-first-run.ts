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

import { isFirstPublishedRoute, trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { liveCustomDomain, TENANT_APEX, type HostCustomDomainState } from '@aglyn/aglyn/app-utils/host-naming'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * Whether the `hostFirstRun` zone has anything to offer on this site — that
 * is, whether the site is still the blank one it was created as (AGL-2918).
 *
 * ## Why this exists separately from "did the browser skip"
 *
 * It was missing. The zone's only condition was the skip below, which asks
 * whether THIS BROWSER dismissed the offer — never whether the site was new.
 * But Setup → Basic details is the setup page of every site, not only of a
 * site created a minute ago, so an established site opened in a browser that
 * had never dismissed anything drew the guided start over the top of it. The
 * skip is the answer to "were you asked?"; this is the answer to "is there
 * anything to ask about?", and the offer needs both.
 *
 * ## Nothing published, read off a document already held
 *
 * `host.screens` is the routing map publishing writes, so an empty one is a
 * site with no page a visitor can reach. A new site is created with exactly
 * one entry — the placeholder home page named by `defaultHomeScreenId`
 * (AGL-3408) — and that entry does not count: the platform put it there, not
 * the owner, so a genuinely new site still qualifies. The owner publishing
 * that page clears the marker (AGL-3478), and from then on it counts. This is the same
 * reading `first_publish` makes, through the same predicate, so "blank" and
 * "has not published yet" cannot come to disagree. The settings layout already subscribes the host
 * document for every form in the hub, so this costs NO additional read, which
 * `host-setup-read-cost.spec.tsx` holds to a budget that has no room for one.
 *
 * Chosen over a marker written at creation because there is nothing to write,
 * nothing to backfill and nothing to go stale: an established site is excluded
 * by a fact about itself rather than by the absence of a flag, and the offer
 * retires itself the moment the site publishes anything — on every browser at
 * once, not just the one that dismissed it.
 *
 * ⚠️ WHAT IT GETS WRONG. It reads published routes, so unpublished work is
 * invisible to it: a site with drafts and nothing published still reads as
 * blank and is still offered a start, and a site that published pages and then
 * unpublished all of them becomes eligible again. Both are bounded by the skip
 * below — one dismissal ends the offer for that browser — and by the widget
 * itself, which plans and builds nothing until the person confirms.
 */
export function hostIsBlankSite(
  host:
    | {
        screens?: Record<string, unknown>
        defaultHomeScreenId?: string
        starterProvisionedAt?: unknown
      }
    | null
    | undefined,
): boolean {
  // A site that took the starter for the guided start (AGL-3594) has chosen,
  // on every browser at once; one born with it has not, and is still offered.
  if (host?.starterProvisionedAt) return false
  return isFirstPublishedRoute(host?.screens, host?.defaultHomeScreenId)
}

/**
 * Asks for the site's starter (AGL-3594): `POST /api/hosts/starter`, which
 * writes the published Home page and its layout on a site born for the guided
 * AI start, and does nothing on any other. What `startBlank` does after it
 * remembers the choice.
 *
 * The starter Home is PUBLISHED, so when the route says it wrote one this
 * reports `site_published` with `first_publish: true` — the site's first
 * live page, which a server-provisioned site never reported before. Only
 * then: a no-op published nothing. Never throws; a refusal or an outage
 * leaves the site as it was, and the person on the blank setup page.
 */
export async function requestStarterSite(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
): Promise<boolean> {
  if (!hostId) return false
  try {
    const response = await authorizedFetch(user, '/api/hosts/starter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId }),
    })
    if (!response.ok) return false
    const payload = (await response.json().catch(() => null)) as { provisioned?: boolean } | null
    if (payload?.provisioned !== true) return false
    trackEvent('site_published', { first_publish: true })
    return true
  } catch {
    return false
  }
}

/**
 * The address a visitor reaches the site at: its custom domain only once that
 * domain actually serves (`liveCustomDomain`), otherwise its platform
 * subdomain. `null` for a host with neither, so a caller never shows a
 * half-built URL as the site's address.
 */
export function hostLiveUrl(
  host: HostCustomDomainState | null | undefined,
): string | null {
  const domain = host ? liveCustomDomain(host) : undefined
  if (domain) return `https://${domain}`
  return host?.subdomain ? `https://${host.subdomain}.${TENANT_APEX}` : null
}
