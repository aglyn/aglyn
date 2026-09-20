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

import { publishedScreenCount } from './host-status'

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
 * site with no page a visitor can reach — and `/api/hosts/create` writes
 * exactly `screens: {}` and seeds no starter (AGL-687), so a genuinely new
 * site always qualifies. The settings layout already subscribes the host
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
  host: { screens?: Record<string, unknown> } | null | undefined,
): boolean {
  return publishedScreenCount(host) === 0
}

/**
 * "Start blank" (AGL-2918): the person left the `hostFirstRun` zone's guided
 * start for the blank site they already had, and this site does not ask again.
 *
 * ## Why the browser, and not the site document
 *
 * The choice decides whether ONE card is drawn. It grants nothing, it gates
 * nothing, and the blank path is what a reader gets when it cannot be read —
 * so the cheapest store that survives a reload is the right one, and a site
 * document write would put a console preference on the record a tenant
 * renders from.
 *
 * Every read and write is therefore allowed to fail: storage throws in a
 * private window and returns nothing where site data was cleared. Forgetting
 * the choice re-offers a start the person may take or leave again, which is
 * the same offer they were given the first time.
 *
 * Deliberately per SITE rather than per account: skipping the start on one
 * site says nothing about the next one somebody makes.
 */

const KEY_PREFIX = 'aglyn.hostFirstRun.blank.'

function key(hostId: string): string {
  return `${KEY_PREFIX}${hostId}`
}

/** Whether this site's guided start was left for the blank path already. */
export function hostStartedBlank(hostId: string): boolean {
  if (!hostId) return false
  try {
    return window.localStorage.getItem(key(hostId)) === '1'
  } catch {
    return false
  }
}

/** Records that this site's guided start was left for the blank path. */
export function rememberHostStartedBlank(hostId: string): void {
  if (!hostId) return
  try {
    window.localStorage.setItem(key(hostId), '1')
  } catch {
    // A browser that will not store the choice re-offers the start, which is
    // an offer and not a demand.
  }
}
