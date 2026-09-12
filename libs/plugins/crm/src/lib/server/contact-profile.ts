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
 * What one typed field of a contact's profile may be, for the server routes
 * that write one: the create route (AGL-2596) and the profile route
 * (AGL-2804). One module, so a tag typed into the create drawer and a tag
 * saved on the record page are the same tag to the segment filter that
 * matches on them, and a phone number both refuse is refused in one sentence.
 */

/** The most tags one holder keeps on a person — the record page's cap. */
export const CONTACT_TAGS_MAX = 20

/** The longest note the record page keeps. */
export const CONTACT_NOTES_MAX = 2000

/** The sentence a phone number that cannot be read is refused with, under the field. */
export const CONTACT_PHONE_REFUSAL =
  'That phone number could not be read. Enter it with its country code, like ' +
  '+1 512 555 0107.'

/** What one typed field may be, after the trim every string gets. */
export function typed(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

/**
 * Tags as the record page stores them: lower-cased, trimmed, deduplicated,
 * capped.
 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((tag) => typed(tag, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, CONTACT_TAGS_MAX),
    ),
  ]
}

/**
 * One tag a bulk action names, as the contacts bar normalizes it, or `null`
 * when nothing survives the trim.
 */
export function readBulkTag(value: unknown): string | null {
  const tag = typed(value, 60).toLowerCase()
  return tag || null
}
