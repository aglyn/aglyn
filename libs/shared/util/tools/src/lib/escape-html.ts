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
 * HTML-escape a value for interpolation into markup assembled as a string.
 *
 * Every place in this repo that builds HTML by concatenation rather than
 * through React needs this, and each one that wrote its own arrived at a
 * different set of characters. Two of them omitted `'`, which is not a
 * cosmetic difference: single quotes delimit attributes just as well as
 * double quotes do, so `<a href='…'>` with an unescaped apostrophe in the
 * value is an attribute break, and an attribute break is a tag.
 *
 * The five characters below are the complete set for both HTML text and
 * attribute values. `'` becomes `&#39;` rather than `&apos;`, which HTML 4
 * does not define. Non-string input coerces rather than throwing: callers
 * read optional fields off stored documents, and a `null` slipping through
 * must produce empty text, never a crash in the middle of rendering a page
 * somebody is already waiting on.
 *
 * Deliberately NOT re-exported from this library's index — reach it as
 * `@aglyn/shared-util-tools/escape-html`. The index note records why.
 */
export function escapeHtml(value: unknown): string {
  if (value == null) return ''
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] as string,
  )
}

export default escapeHtml
