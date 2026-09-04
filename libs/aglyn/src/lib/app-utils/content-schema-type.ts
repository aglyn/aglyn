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
 * What KIND of article a content collection publishes (AGL-2536).
 *
 * Every entry the tenant published was typed `Article`, whatever collection it
 * came from — so a press release, a blog post and a changelog note serialised
 * identically, and none of them claimed the more specific type `schema.org`
 * defines for it.
 *
 * ## Why this is a stored setting and not an inference
 *
 * Nothing on a collection document says what kind of thing it holds: `kind` is
 * the commerce split (`content` / `catalog`), and the rest is a slug, a
 * display name, categories and template pointers. So the only way to choose a
 * subtype without asking is to read the slug — and that is wrong the first
 * time somebody names a collection `news` for a knowledge base, or `blog` for
 * a docs section. Wrong permanently, and invisibly, in the one place nobody
 * looks until a rich result stops appearing.
 *
 * The author knows. The author is asked once, per collection.
 *
 * ## The list is short on purpose
 *
 * `schema.org` has dozens of `Article` descendants and almost all of them are
 * traps: `ScholarlyArticle`, `SatiricalArticle`, `AdvertiserContentArticle`
 * each make a claim a marketing site should not make by accident. These four
 * are the ones a customer's content actually is, and every one of them is a
 * type Google documents support for.
 */
export const CONTENT_SCHEMA_TYPES = [
  {
    value: 'Article',
    label: 'Article',
    description:
      'The general type. Correct for anything the others do not fit.',
  },
  {
    value: 'BlogPosting',
    label: 'Blog post',
    description: 'A post in a blog — the usual choice for a blog collection.',
  },
  {
    value: 'NewsArticle',
    label: 'News article',
    description:
      'A press release or newsroom item — something reporting news about you.',
  },
  {
    value: 'TechArticle',
    label: 'Technical article',
    description:
      'A changelog note, a how-to, release notes — writing about how the product works.',
  },
] as const

export type ContentSchemaType = (typeof CONTENT_SCHEMA_TYPES)[number]['value']

/**
 * What an unset collection publishes, and what every collection published
 * before this existed.
 *
 * The default is load-bearing: it means adopting this feature changes nothing
 * until somebody makes a choice, so no site's structured data moves under it.
 */
export const CONTENT_SCHEMA_TYPE_DEFAULT: ContentSchemaType = 'Article'

/**
 * The type to publish for a stored value, defaulting for anything
 * unrecognised.
 *
 * Unrecognised rather than unset covers the case that matters: a value written
 * by a newer console, restored from a backup, or typed into a REST call. An
 * `@type` the vocabulary does not define is worse than a general one — a
 * consumer that cannot resolve the type discards the whole node, so a typo
 * would silently cost the page every property it publishes, not just this one.
 */
export function normalizeContentSchemaType(value: unknown): ContentSchemaType {
  const wanted = String(value ?? '').trim()
  const match = CONTENT_SCHEMA_TYPES.find((type) => type.value === wanted)
  return match ? match.value : CONTENT_SCHEMA_TYPE_DEFAULT
}
