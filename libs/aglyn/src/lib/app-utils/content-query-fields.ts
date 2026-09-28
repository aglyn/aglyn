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

import { contentAuthorSchemaType } from './content-authors'
import type { HostEntityType } from '../foundation/definitions/platform.types'
import { nameSearchKey, nameSearchTokens } from './name-search'

/*
 * The fields the console's content tables QUERY, stamped by the writes that
 * set an entry's title or an author's name (AGL-3321).
 *
 * ⛔ Kept apart from `collection-entries` and `content-authors`. Those two are
 * read by the compose pipeline, so whatever they import ships in the site
 * runtime a published page loads (`check:tenant-wire-weight`). These helpers
 * are only ever called by the console and its routes, and `name-search` has
 * no business on a customer's page.
 */

/**
 * The field the console's entries table searches (AGL-3321): every word
 * prefix of the entry's title, as `nameSearchTokens` writes them, which the
 * table's quick search and its Title "contains" filter ask with
 * `array-contains` on the Firestore query.
 *
 * DERIVED, and never carried in a bundle. Every writer of `title` stamps it
 * through {@link entryTitleSearchFields}: the entry editor's save, the
 * resources route's create, the bundle import, and the seed and changelog
 * scripts. `tools/scripts/backfill-entries-title-tokens.mjs` stamps the
 * entries written before it. An entry without it still lists; it just cannot
 * be found by a word of its title.
 */
export const ENTRY_TITLE_TOKENS_FIELD = 'titleTokens'

/**
 * The search half of a write that sets an entry's `title`. An entry with no
 * title gets an empty array, so the field is present on every entry and the
 * backfill has nothing left to find.
 */
export function entryTitleSearchFields(title: unknown): {
  [ENTRY_TITLE_TOKENS_FIELD]: string[]
} {
  return {
    [ENTRY_TITLE_TOKENS_FIELD]: nameSearchTokens(
      typeof title === 'string' ? title : '',
    ),
  }
}

/**
 * Where an author's schema type is stored as the WORD the console's Authors
 * table filters by (AGL-3321).
 *
 * `type` holds `HostEntityType` in whichever spelling wrote it: the number
 * from the authors tab, a string `"1"`/`"2"` from an older bundle, nothing at
 * all on a record `contentAuthorSchemaType` reads as `Organization`. A query
 * matches one stored value, so an equality on `type` would miss every record
 * spelled another way. This field is that one value.
 */
export const AUTHOR_SCHEMA_TYPE_FIELD = 'schemaType'

/**
 * The fields the Authors table's query reads (AGL-3321), derived from what the
 * record already says: the name's lower-cased key and word-prefix tokens,
 * normalized exactly as `nameSearchKey` / `nameSearchTokens` normalize a typed
 * value, and the schema type as the row reads it.
 *
 * Spread at EVERY write of an author's `name` or `type` — the resources
 * route's create, the authors tab's edit, the bundle import — and stamped on
 * older records by `tools/scripts/backfill-authors-search-fields.mjs`. A
 * record without them still reaches the picker, which reads every author; it
 * is only the table's filters and search that cannot see it.
 */
export function contentAuthorQueryFields(author: {
  name?: unknown
  type?: unknown
}): {
  nameLower: string
  nameTokens: string[]
  [AUTHOR_SCHEMA_TYPE_FIELD]: 'Person' | 'Organization'
} {
  const name = typeof author.name === 'string' ? author.name : ''
  return {
    nameLower: nameSearchKey(name),
    nameTokens: nameSearchTokens(name),
    [AUTHOR_SCHEMA_TYPE_FIELD]: contentAuthorSchemaType(
      author.type as HostEntityType | string | number | undefined | null,
    ),
  }
}
