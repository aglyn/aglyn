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
 * What the collection elements share (AGL-3401): the sample values the entry
 * blocks preview with on editing surfaces, and the guards on an author href.
 *
 * The nine elements were one module, and the element tier loaded all of them
 * — 68 KB with the fuzzy matcher — for a page placing any one. Each is its
 * own module now, so a page downloads the ones it places. What two of them
 * need lives here, or, when it draws markup only some of them render, in
 * `collection-search-box.tsx` (Entries, Search) and
 * `collection-author-links.tsx` (Entry Author, Author Profile) — so that
 * Entry Meta does not carry ten platform marks, nor Category Pills an input.
 *
 * Each element's persisted id is declared in its own module rather than here:
 * this module is in every one of their chunks, and an id reads its constant
 * from the module that defines it, so nine ids here were nine modules of
 * `@aglyn/aglyn` in every chunk (AGL-3401).
 */

/** A still-unresolved `{{token}}` (no entry context on this render). */
export const UNRESOLVED_TOKEN = /^\{\{[^}]+\}\}$/

/**
 * The instant the sample cards are dated. A FIXED one, never `Date.now()`:
 * the canvas has to render the same bytes every time it opens, and this is
 * the date the Date-format labels use as their worked example — so the
 * dropdown and the cards it previews agree word for word.
 */
export const RELATED_SAMPLE_PUBLISHED_AT = { seconds: Date.UTC(2026, 7, 9) / 1000 }

/** Category chip text for the sample cards; names the field, not a taxonomy. */
export const RELATED_SAMPLE_CATEGORY = 'Category'

/**
 * THE SAMPLE VALUES THE ENTRY BLOCKS PREVIEW WITH (AGL-2486).
 *
 * Entry Meta and Entry Author resolve FROM the routed entry, and a besigner
 * canvas has no routed entry — so both drew a one-line dashed strip and an
 * author styling a byline or an author card was styling something they could
 * not see. Related Posts had the same gap and was answered the same way: the
 * block's REAL markup, at the author's own settings, on editing surfaces
 * only.
 *
 * These two need no "this is a sample" notice the way the related CARDS do.
 * A card carries a title, a cover and a category, which is what a real post
 * looks like; a byline reading `Sample author` says what it is in the words
 * themselves, and a notice above a single line of caption text would be
 * taller than the thing it labels.
 *
 * The date is a FIXED instant, never `Date.now()`: the canvas has to render
 * the same bytes every time it opens, and it is the same instant the related
 * sample uses, so two blocks on one template never disagree about what day
 * their example is.
 */
export const ENTRY_SAMPLE_PUBLISHED_AT = RELATED_SAMPLE_PUBLISHED_AT

/** Byline name for the samples; names the field rather than a person. */
export const ENTRY_SAMPLE_AUTHOR = 'Sample author'

/** Category text for the samples; names the field, not a taxonomy. */
export const ENTRY_SAMPLE_CATEGORY = RELATED_SAMPLE_CATEGORY

/** Two chips, so the row previews its own wrapping and gap. */
export const ENTRY_SAMPLE_TAGS = 'first tag, second tag'

/** Bio line for the author-card sample; one sentence, as a real one is. */
export const ENTRY_SAMPLE_BIO =
  'The bio from this author’s record reads here, in a line or two.'

/**
 * The portrait STAND-IN, for a sample that has no image to resolve.
 *
 * A neutral plate rather than nothing, and for the reason the related sample
 * draws its cover slot: on an entry template the portrait arrives from the
 * author record at render, so the slot is exactly what the author is sizing
 * and spacing. `aria-hidden` because it depicts nothing.
 */
export const samplePortraitSx = (size: number) => ({
  width: size,
  height: size,
  flexShrink: 0,
  borderRadius: '50%',
  backgroundColor: 'action.hover',
})

/** Unresolved tokens render empty on the site, literal in the besigner. */
export const metaValue = (
  value: string | undefined,
  suppressNavigation: boolean | undefined,
): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  if (UNRESOLVED_TOKEN.test(trimmed) && !suppressNavigation) return ''
  return trimmed
}

/**
 * What the byline may link to — an absolute `https:` page, or a route on this
 * site. The Social Links block guards its hrefs the same way and for the same
 * reason: the value comes from a stored record, so `javascript:` and friends
 * have to be unreachable rather than merely unlikely.
 */
export const SAFE_AUTHOR_HREF = /^(https:\/\/|\/(?!\/))/i

/** An off-site author page opens in a new tab; a route on this site does not. */
export const EXTERNAL_AUTHOR_HREF = /^https:\/\//i
