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

import { addressSearchWords } from '@aglyn/aglyn/app-utils/activity-search'
import {
  nameSearchKey,
  nameSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'

/**
 * The search fields that travel with a site member's display name (AGL-2501).
 *
 * The console's Site users card is paged, so a name search that compares the
 * rows already fetched answers "no such member" for everyone past the first
 * page. Searching the whole collection needs a query, and a query over a raw
 * `displayName` is case-sensitive — it would miss rather than fail, which is
 * the worse of the two.
 *
 * `email` needs no twin: the register path already lower-cases it before
 * storing, so the stored value IS its own normalized key.
 *
 * ⚠️ EVERY writer of `displayName` must call this. A member updated through a
 * path that skips it keeps a stale key and becomes unfindable by their new
 * name while still listing normally — the quiet half of a search bug.
 */
export function memberNameSearchFields(displayName: string): {
  displayName: string
  displayNameLower: string
  displayNameTokens: string[]
} {
  return {
    displayName,
    displayNameLower: nameSearchKey(displayName),
    // Every prefix of every WORD, so a reader finds "Ada Lovelace" by typing
    // "lovelace" and not only by typing "ada".
    displayNameTokens: nameSearchTokens(displayName),
  }
}

/**
 * What the Site users list's search box finds a member by (AGL-3321): the
 * start of any word of their display name, or of their address — the whole
 * address, its local part, its domain, or any run of letters and digits in
 * it, read the way the activity logs read an actor's (`addressSearchWords`).
 * So `ada`, `lovelace` and `example.com` all find Ada Lovelace
 * <ada@example.com>, and a member who never gave a name is still found.
 *
 * Stamped as `searchTokens` at sign-up (the only writer of `email`, which
 * never changes afterwards) and wherever the display name is written, with
 * the address the document already holds. `Name contains` keeps reading
 * `displayNameTokens`, so it filters the name alone.
 *
 * ⚠️ EVERY writer of `displayName` or `email` must stamp it, or the member
 * lists normally and the search cannot find them.
 */
export function memberSearchTokens(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string[] {
  return nameSearchTokens(
    [...addressSearchWords(email), displayName ?? ''].join(' '),
  )
}
