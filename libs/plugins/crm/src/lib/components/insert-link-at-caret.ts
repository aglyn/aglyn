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
 * A link dropped into a plain-text draft at the caret, replacing whatever
 * was selected. A space is put on either side where the text would
 * otherwise run into the URL — a mail client reads `word https://…` as a
 * link and `wordhttps://…` as a typo — and none where the caret already
 * sits on whitespace, a line end, or an edge of the draft. The caret lands
 * after the inserted run, where typing continues.
 */
export function insertLinkAtCaret(
  text: string,
  link: string,
  start: number,
  end: number,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const before = text.slice(0, from)
  const after = text.slice(to)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  const inserted = `${lead}${link}${trail}`
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length }
}
