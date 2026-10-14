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
 * When something happened, for a staff surface.
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

/**
 * When something a ROUTE sent happened.
 *
 * A Firestore `Timestamp` cannot cross JSON intact, so every route that
 * serves activity flattens it to `{ seconds }` first. That leaves two traps
 * for the surface rendering it, and the org activity card fell into both:
 * `createdAt.toDate()` is not a function on the flattened object, so
 * `?.toDate?.()` quietly yields nothing and the row renders its separator
 * with no date after it; and handing the object to `formatStaffTimestamp`
 * directly makes an Invalid Date that prints as `[object Object]`.
 *
 * Seconds become milliseconds here, once, so no caller has to remember
 * either. `typeof` rather than truthiness because second 0 is a real instant
 * and an audit surface should print it, not an em dash.
 */
export function formatWireTimestamp(
  value: { seconds?: number } | null | undefined,
): string {
  const seconds = value?.seconds
  return formatStaffTimestamp(
    typeof seconds === 'number' ? seconds * 1000 : null,
  )
}

/**
 * How long ago something happened, in the one unit a reader wants: "just
 * now", "12 min ago", "3 h ago", "5 d ago", "4 mo ago", "2 y ago". Absent or
 * unparseable is `null`, so the caller decides what nothing looks like.
 *
 * A moment in the future (a clock ahead of the reader's) reads as "just now"
 * rather than as a negative age.
 */
export function formatStaffAgo(value: unknown, nowMs: number = Date.now()): string | null {
  if (value === null || value === undefined || value === '') return null
  const at = new Date(value as string | number | Date).getTime()
  if (Number.isNaN(at)) return null
  const minutes = Math.floor(Math.max(0, nowMs - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} d ago`
  const months = Math.floor(days / 30.4375)
  if (months < 12) return `${months} mo ago`
  return `${Math.floor(days / 365.25)} y ago`
}

/**
 * A last-activity moment for a staff surface: the local date and time, then
 * how long ago — "10/9/2026, 3:12:04 PM · 2 h ago". The date and time are
 * what a reader compares against a report; the age is what they scan a
 * column for. An em dash when there is nothing, as `formatStaffTimestamp`.
 */
export function formatStaffActivity(value: unknown, nowMs: number = Date.now()): string {
  const stamp = formatStaffTimestamp(value)
  const ago = formatStaffAgo(value, nowMs)
  return ago ? `${stamp} · ${ago}` : stamp
}
