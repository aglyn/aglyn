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

import { nameSearchTokens } from './name-search'

/*
 * WHAT AN ACTIVITY LOG'S SEARCH BOX FINDS (AGL-3321).
 *
 * Every activity log — a site's (`hosts/{hostId}/activity`), an
 * organization's (`orgs/{orgId}/activity`), and the person-centred feeds read
 * across both — searches the same written token array, so the box promises
 * the same thing wherever it appears: a word typed there finds an entry when
 * it is the START of
 *
 *   - the address the actor had when the entry was written, of its local
 *     part or its domain, or of any run of letters and digits in it —
 *     `ada`, `lovelace`, `ada.lovelace@`, `example.com`, `example` all find
 *     `ada.lovelace@example.com`;
 *   - a word of the API key's name, for an entry an integration wrote;
 *   - a word of the name of what changed (`target.name`) — the screen, the
 *     member, the workflow.
 *
 * Not the action sentence: it is prose written by forty call sites, some of
 * it three hundred characters of run errors, and every word of it would be
 * an index entry. Action is a Filters field instead.
 *
 * The array is `nameSearchTokens` over those words — the same normalizer the
 * query plan asks with (`nameSearchNormalizers`), so a typed word and a
 * stored token cannot disagree about case, whitespace or prefix length.
 *
 * ⚠️ Every writer stamps it, through `activitySearchTokens`: the site logger
 * in the browser, the two server loggers, the workflow engine's run rows, the
 * inbound-webhook runner, the site importer and the reconstruction backfill.
 * A writer that forgets writes an entry the log still LISTS and that no
 * search can find. The scripts that write or backfill entries use its
 * script-side twin, `tools/scripts/lib/activity-search-tokens.mjs`, held to
 * the same worked examples (`activity-search-tokens.fixtures.json` beside
 * it), which this library's spec asserts too.
 */

/** The written field every activity search reads. */
export const ACTIVITY_SEARCH_TOKENS_PATH = 'searchTokens'

/** What an entry's search tokens are derived from; every field may be absent. */
export interface ActivitySearchSource {
  actorEmail?: unknown
  apiKeyName?: unknown
  /** The entry's target as stored — only its `name` is read. */
  target?: { name?: unknown } | null
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * An address as the words a reader might start typing it by: the whole
 * address, its local part, its domain, and each run of letters and digits.
 * Shared by every search that finds a record by an address — the activity
 * logs' actor, and a site account's own address (the Site users list).
 */
export function addressSearchWords(address: unknown): string[] {
  const whole = text(address).toLowerCase()
  if (!whole) return []
  const at = whole.lastIndexOf('@')
  const halves = at > 0 ? [whole.slice(0, at), whole.slice(at + 1)] : []
  const runs = whole.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return [whole, ...halves, ...runs].filter(Boolean)
}

/**
 * The search tokens one activity entry carries. Stamped by every writer as
 * `searchTokens`; see the note at the top of this file for what it promises.
 */
export function activitySearchTokens(entry: ActivitySearchSource): string[] {
  const words = [
    ...addressSearchWords(entry.actorEmail),
    text(entry.apiKeyName),
    text(entry.target?.name),
  ].filter(Boolean)
  return nameSearchTokens(words.join(' '))
}
