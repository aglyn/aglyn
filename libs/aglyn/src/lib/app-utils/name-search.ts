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
 * Normalized search key for a human display name (AGL-835).
 *
 * Firestore has no case-insensitive query, so name search is done by storing
 * a normalized `nameLower` alongside the display name and running a prefix
 * range query against it: `orderBy(nameLower) startAt(q) endAt(q + '')`.
 * For that to match, the stored key and the typed query MUST be normalized the
 * same way — so both the write paths (screen/host creates and renames) and the
 * switcher's query builder run the raw text through this one function.
 *
 * Normalization is deliberately minimal and reversible-in-spirit: lower-case,
 * trim, and collapse internal whitespace. Diacritics are intentionally NOT
 * stripped — a user who types "café" should match the stored "café", and one
 * who types "cafe" is doing a different search; folding accents here would make
 * the prefix range silently disagree with the key. Returns '' for nullish or
 * blank input, which callers treat as "no searchable name / skip the field".
 */
export function nameSearchKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The longest word-prefix a token may be.
 *
 * Every prefix of every word is stored, so the token count grows with name
 * LENGTH rather than word count. Twelve characters is past the point where a
 * search box narrows anything — a reader who has typed twelve characters has
 * already found it — and it keeps a long name from spending a hundred index
 * entries on the tail of one word.
 */
export const NAME_TOKEN_MAX_PREFIX = 12

/** Ceiling on tokens per document, so a pathological name cannot bloat the index. */
export const NAME_TOKEN_LIMIT = 120

/**
 * Word-prefix tokens for `array-contains` search (AGL-2501).
 *
 * `nameSearchKey` supports a PREFIX range, which is anchored at the start of
 * the whole name: "acme" finds "Acme Coffee" and "coffee" does not. That is
 * the wrong shape for a search box, where the word a reader remembers is
 * rarely the first one.
 *
 * Firestore cannot answer `contains` on a string, but it can answer
 * `array-contains` on a field the write path prepared. Storing every prefix
 * of every WORD turns "does this name contain a word starting with X" into a
 * single indexed equality:
 *
 *   "Acme Coffee" → a, ac, acm, acme, c, co, cof, coff, coffe, coffee
 *
 * So "cof" finds it, and so does "acme". What it still cannot do is match
 * mid-word — "offee" is not a prefix of any word — which is the honest edge
 * of doing this without a search service.
 *
 * Normalized through `nameSearchKey` so the stored tokens and the typed query
 * agree on case, trimming and internal whitespace; diacritics are kept, for
 * the reason given there.
 */
export function nameSearchTokens(name: string | null | undefined): string[] {
  const key = nameSearchKey(name)
  if (!key) return []
  const tokens = new Set<string>()
  for (const word of key.split(' ')) {
    if (!word) continue
    // Walked by CODEPOINT, never by UTF-16 unit (AGL-3689, 2026-10-08). The
    // first unit of an emoji is a lone surrogate, which is not valid UTF-8,
    // and Firestore refuses the whole write with `3 INVALID_ARGUMENT` — a
    // site named "Nova Library. 📚" was created and then failed its member
    // projections, so its owner got a 500 for a site that existed. Identical
    // to the unit walk for every BMP name, so no stored token moves.
    const capped = [...word].slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end).join(''))
      if (tokens.size >= NAME_TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/**
 * The one token a typed query becomes.
 *
 * `array-contains` takes a single value, and Firestore allows only one such
 * clause per query — so a multi-word query cannot be an AND on the server.
 * The FIRST word is used, which is what a reader is narrowing by when they
 * type "acme cof": they see the Acme results and read the rest themselves.
 * Capped to the same prefix length the tokens were written at, or a longer
 * query would match a token that was never stored.
 */
export function nameSearchToken(query: string | null | undefined): string {
  const key = nameSearchKey(query)
  if (!key) return ''
  // By codepoint, as the tokens were written: a query is capped where a
  // stored token was, or it would ask for one that was never stored.
  return [...(key.split(' ')[0] ?? '')].slice(0, NAME_TOKEN_MAX_PREFIX).join('')
}

/**
 * The normalized name, reversed, so "ends with" becomes a prefix range.
 *
 * Firestore has one string operator that is not equality: the range. That
 * gives "starts with" directly — `>= q` and `<= q + ''` over
 * `nameLower` — and gives "ends with" nothing at all, because a range is
 * anchored at the front of the stored value.
 *
 * Reversing the stored key moves the end to the front. "Acme Coffee" is
 * stored as "eeffoc emca", and a search for names ending "coffee" becomes a
 * prefix range for "eeffoc" — the same query, on the same kind of index.
 *
 * Reversed by CODEPOINT (`[...key]`), not by UTF-16 unit: `split('')` cuts
 * surrogate pairs in half, so an emoji or a non-BMP character in a workspace
 * name would reverse into two lone surrogates and never match anything.
 */
export function nameSearchReversed(name: string | null | undefined): string {
  return [...nameSearchKey(name)].reverse().join('')
}

/**
 * The three search fields that travel with a `name`, as one object.
 *
 * Every collection whose list is SEARCHED on the server carries them, and
 * carrying only some is the failure mode worth designing against: `orderBy`
 * drops a document missing the field it sorts by, and `array-contains` drops
 * one missing the array. Either way the record still LISTS normally, so the
 * gap shows up only as a search that quietly cannot find one row.
 *
 * ⚠️ Spread this at every write that sets `name`, and only where `name` is
 * actually being written — a partial write that stamped an empty key over a
 * real one would make the document unfindable by the name it still displays.
 */
export function nameSearchFields(name: string): {
  name: string
  nameLower: string
  nameTokens: string[]
  nameReversed: string
} {
  // `name` is INCLUDED so this is a drop-in replacement for writing `{ name }`.
  // A helper that returned only the derived keys would be spread beside the
  // name at four call sites, and the one that forgot would write search keys
  // for a name it never stored.
  return {
    name,
    nameLower: nameSearchKey(name),
    nameTokens: nameSearchTokens(name),
    nameReversed: nameSearchReversed(name),
  }
}

/**
 * The search fields a document NAMED BY `displayName` carries (AGL-3321):
 * the site artifacts (screens of every kind, layouts, reusable components,
 * templates) and the marketplace listings.
 *
 * `nameSearchFields` is for documents whose name IS `name`. These documents
 * name themselves `displayName`, and have since before search existed, so
 * the keys ride beside it under the same three names every list declares —
 * `lowerPath: 'nameLower'`, `tokensPath: 'nameTokens'`,
 * `reversedPath: 'nameReversed'` — and one list query grammar reads them all.
 *
 * `displayName` is NOT returned. A create that carries no name must not gain
 * an empty one: readers fall back with `displayName ?? id`, which an empty
 * string defeats. But the KEYS are always returned, empty for a missing name,
 * so a create stamps them unconditionally — an `orderBy('nameLower')` drops
 * any document that lacks the field, and a document created without a name
 * is still one a list must reach.
 *
 * ⚠️ Spread at every write that sets `displayName`, and at every create —
 * and nowhere else: a partial update that stamped keys for a name it did not
 * write would make the document unfindable by the name it still shows.
 */
export function displayNameSearchFields(displayName: unknown): {
  nameLower: string
  nameTokens: string[]
  nameReversed: string
} {
  const name = typeof displayName === 'string' ? displayName : ''
  return {
    nameLower: nameSearchKey(name),
    nameTokens: nameSearchTokens(name),
    nameReversed: nameSearchReversed(name),
  }
}

/**
 * The normalizers a list query plan (`planListQuery` in
 * `@aglyn/shared-ui-jsx/const/list-query-plan`) turns typed values into keys
 * with: the same functions the writers stamp `nameLower`, `nameTokens` and
 * `nameReversed` with, so a query asks for what was stored (AGL-3321).
 */
export const nameSearchNormalizers = {
  key: (value: string) => nameSearchKey(value),
  token: (value: string) => nameSearchToken(value),
  reversed: (value: string) => nameSearchReversed(value),
  maxPrefix: NAME_TOKEN_MAX_PREFIX,
} as const


/**
 * What joins a scope token to a search prefix in a SCOPED search token
 * (AGL-3321): `host:abc~acm`.
 *
 * A list under a scope clause (`visibleTo array-contains-any [...]`) has
 * spent Firestore's one array clause on the scope, so its search cannot be a
 * second `array-contains`. The list query plan folds the typed word INTO the scope
 * clause instead (`ListQueryDeclaration.search.scoped`), asking for each
 * scope token joined to the word; the writers stamp every scope token
 * joined to every prefix, through {@link scopedSearchTokens}. A declaration
 * names this constant as its `join`, so the writer and the reader cannot
 * disagree about the character between the two halves.
 *
 * ⛔ Security rules cannot prove a folded query for a reader limited to some
 * sites. Rules like `canReadScoped` grant a list from
 * `visibleTo.hasAny(<the reader's scopes>)`, and a query that constrains only
 * the scoped-token field says nothing about `visibleTo`, so Firestore denies
 * it (pinned in cloud/rules-tests/firestore-rules.test.mjs). A folded search
 * is therefore for readers the rules admit WITHOUT a `visibleTo` term (an
 * org-wide member, whose rule short-circuits) or for an Admin-SDK route that
 * checks the reader's scope itself. A partial-reach collaborator's search
 * stays beside the `visibleTo` clause instead, as a prefix range on one
 * ordered key (media: `nameLower`; inbox leads: `email`).
 *
 * `~` appears in no scope token (`org`, `host:{id}`), so the split is never
 * ambiguous; a prefix that itself holds a `~` is matched whole on both sides
 * and needs no escaping.
 */
export const SCOPED_SEARCH_JOIN = '~'

/**
 * The `search.scoped` half of a list declaration, over the array the
 * writers stamp with {@link scopedSearchTokens}.
 */
export function scopedSearch(tokensPath: string): {
  tokensPath: string
  join: typeof SCOPED_SEARCH_JOIN
} {
  return { tokensPath, join: SCOPED_SEARCH_JOIN }
}

/**
 * Every scope a record is visible to, joined to every search prefix it
 * carries: `[org~a, org~ac, host:x~a, …]`, in scope order then token order,
 * with no duplicates (AGL-3321).
 *
 * `visibleTo` is read defensively — a record's stored array — and keeps
 * every non-empty string in it; anything else answers no scope, and so no
 * scoped tokens: a record visible to nobody is found by no scoped search.
 * `tokens` is whatever the record's plain search array holds, so a list that
 * searches several fields passes their merged prefixes rather than one
 * name's. Each is stamped beside the plain array on every write that sets
 * either the searched text or `visibleTo`.
 *
 * The count is the product of the two, so a record placed on thirty sites
 * with a long name carries thousands of entries. That stays far inside
 * Firestore's per-document index-entry ceiling, and it is the price of a
 * search a scoped reader can run at all.
 */
export function scopedSearchTokens(
  visibleTo: unknown,
  tokens: readonly string[],
): string[] {
  if (!Array.isArray(visibleTo)) return []
  const scopes = [
    ...new Set(
      visibleTo.filter(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      ),
    ),
  ]
  const words = [...new Set(tokens.filter((token) => typeof token === 'string' && token))]
  const scoped: string[] = []
  for (const scope of scopes) {
    for (const word of words) scoped.push(`${scope}${SCOPED_SEARCH_JOIN}${word}`)
  }
  return scoped
}
