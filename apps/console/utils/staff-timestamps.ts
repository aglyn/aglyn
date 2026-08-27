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
 * When something happened, for a staff surface (AGL-1482).
 *
 * The same moment was rendered three different ways on two pages: the account
 * list printed `toLocaleDateString()`, which is a date with the time thrown
 * away; the identity card printed the raw string Firebase Auth returns, which
 * is `Wed, 26 Aug 2026 04:48:13 GMT`; and everything else on that page used
 * `toLocaleString()`. Only the last one is right.
 *
 * ## Why the time matters, and why local
 *
 * These are the timestamps someone reads while answering "is this the account
 * that just signed in", "did this happen before or after the report", "is
 * this session still live". A date alone cannot answer any of them, and a GMT
 * string makes the reader do the arithmetic — at which point they are doing
 * it in their head, against a session they are trying to make a decision
 * about. The reader's own clock is the one they are comparing against.
 *
 * ## Absent is not the same as unparseable
 *
 * A missing timestamp is an em dash, because it is genuinely nothing — an
 * account that has never signed in. A value that IS there and cannot be
 * parsed comes back verbatim instead: it is data the surface received, and
 * turning it into the same em dash would hide a real answer behind the shape
 * of an absent one.
 */
export function formatStaffTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value as string | number | Date)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}
