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
