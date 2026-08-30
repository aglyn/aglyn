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
 * READING ONE MESSAGE RECORD.
 *
 * A message — an email that was or will be sent — is a document under
 * `hosts/{hostId}/campaigns`. Two facts about that document are awkward
 * enough that every surface reading it gets them wrong the same way, so they
 * are decided here once.
 */

/**
 * When a message went out, or is due to.
 *
 * **There is no one date field.** The send path writes `{status:'sent',
 * sentAt}` from one branch and `{status:'scheduled', sendAtMs}` from another,
 * and no writer stamps a `createdAt`. So a list ordered on either field in
 * Firestore does not mis-sort — `orderBy` DROPS every document missing the
 * ordered field — and half the messages simply vanish. Sorting on this
 * instead keeps both kinds in one ordered list.
 *
 * `sentAt` is a Firestore `Timestamp`, which the client SDK gives as an
 * object with `seconds` and `toMillis()`; a document read from cache while a
 * write is pending can carry a sentinel with neither, which reads as 0 and
 * sorts last rather than throwing.
 *
 * @returns epoch ms, or 0 when the message has no time at all.
 */
export function emailSendTimeMs(
  record: Record<string, any> | null | undefined,
): number {
  const sentAt = record?.['sentAt'] as
    | { toMillis?: () => number; seconds?: number }
    | undefined
  if (typeof sentAt?.toMillis === 'function') return sentAt.toMillis()
  if (typeof sentAt?.seconds === 'number') return sentAt.seconds * 1000
  const scheduled = Number(record?.['sendAtMs'] ?? 0)
  return Number.isFinite(scheduled) ? scheduled : 0
}

/**
 * Reader-facing text for a message's state.
 *
 * The KEYS are persisted values written by the send path and read by the
 * scheduled-campaign processor — nothing here may change them, including
 * `canceled`, which is already the American spelling and is a stored enum in
 * either case. Only the right-hand side is display text, and an unrecognised
 * state falls through as itself rather than being flattened into one of
 * these: a state this list cannot name is worth seeing.
 */
export function emailStateLabel(status: unknown): string {
  const value = String(status ?? '')
  if (value === 'sent') return 'Sent'
  if (value === 'scheduled') return 'Scheduled'
  if (value === 'canceled') return 'Canceled'
  return value || 'Unknown'
}

/**
 * Reader-facing names for the built-in audience kinds.
 *
 * The KEYS are the persisted `audience` values written on every message since
 * the composer shipped; only the values on the right are display text. A
 * `list` audience is deliberately absent — it is not a kind of audience, it
 * is a NAMED one, and naming it is {@link emailAudienceLabel}'s job.
 */
export const EMAIL_AUDIENCE_LABELS: Record<string, string> = {
  leads: 'All leads',
  members: 'All site members',
  segment: 'A contact segment',
  manual: 'Addresses typed into the composer',
}

/**
 * Which audience a message went to, named for a reader.
 *
 * A list send is named by the name the SEND recorded, never by the name the
 * list carries today: resolving it now would let a rename rewrite the history
 * of a message that went out months ago, and a deletion erase it. A send that
 * recorded no name says so instead of printing a document id, which is not
 * something a merchant recognises as a list.
 */
export function emailAudienceLabel(
  record: Record<string, any> | null | undefined,
): string {
  const audience = String(record?.['audience'] ?? '')
  if (audience !== 'list') {
    return EMAIL_AUDIENCE_LABELS[audience] ?? audience ?? 'Not recorded'
  }
  const name = String(record?.['listName'] ?? '')
  if (name) return name
  return record?.['listId']
    ? 'A list this send did not name'
    : 'A list this send did not record'
}
