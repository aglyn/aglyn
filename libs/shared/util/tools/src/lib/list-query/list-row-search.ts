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
 * Whether a row answers a quick search: every whitespace-separated word
 * appears, case-insensitively, in SOME of the row's searched values. A
 * blank search matches every row, so an emptied box is the list unfiltered.
 * An array value (tags) is searched member by member.
 */
export function listRowMatchesSearch(
  row: object,
  paths: readonly string[],
  words: readonly string[],
): boolean {
  const asked = words.map((word) => word.trim().toLowerCase()).filter(Boolean)
  if (!asked.length) return true
  const values = paths
    .flatMap((path) => {
      const value = path
        .split('.')
        .reduce<unknown>(
          (at, key) => (at == null ? undefined : (at as Record<string, unknown>)[key]),
          row,
        )
      return Array.isArray(value) ? value : [value]
    })
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).toLowerCase())
    .filter(Boolean)
  return asked.every((word) => values.some((value) => value.includes(word)))
}
