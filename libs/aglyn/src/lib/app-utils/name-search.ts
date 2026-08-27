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
 * Word-prefix tokens for `array-contains` search (AGL-693).
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
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
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
  return (key.split(' ')[0] ?? '').slice(0, NAME_TOKEN_MAX_PREFIX)
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
