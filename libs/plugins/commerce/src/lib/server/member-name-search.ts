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
