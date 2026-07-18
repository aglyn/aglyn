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

// U+2028/U+2029 are valid inside JSON strings but terminate an inline
// <script>; matched via fromCharCode so no irregular-whitespace lands in
// source.
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g')
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g')

/**
 * Serialize a value for embedding inside an inline
 * `<script type="application/ld+json">` via `dangerouslySetInnerHTML`
 * (AGL-496). `JSON.stringify` does NOT escape `<`, `>` or `&`, so a
 * user-authored string containing `</script>` closes the element and any
 * following markup executes — a stored-XSS breakout on tenant sites whose
 * JSON-LD is built from editor-authored titles/descriptions.
 *
 * Escape those characters (plus the JS line separators U+2028/U+2029) to
 * their `\uXXXX` forms — still valid JSON, no longer able to break out of
 * the element.
 */
export function safeJsonLd(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029')
}
