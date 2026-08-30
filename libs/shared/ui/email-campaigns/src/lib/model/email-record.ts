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
 * **There is no one SEND date field.** The send path writes `{status:'sent',
 * sentAt}` from one branch and `{status:'scheduled', sendAtMs}` from another.
 * So a list ordered on either field in Firestore does not mis-sort —
 * `orderBy` DROPS every document missing the ordered field — and half the
 * messages simply vanish. Sorting on this instead keeps both kinds in one
 * ordered list.
 *
 * `sentAt` is a Firestore `Timestamp`, which the client SDK gives as an
 * object with `seconds` and `toMillis()`; a document read from cache while a
 * write is pending can carry a sentinel with neither, which reads as 0 and
 * sorts last rather than throwing.
 *
 * A DRAFT correctly answers 0 here: it has no send time, and inventing one
 * from its creation would put an unsent message on the timeline of mail that
 * went out. Ordering a list is {@link emailListTimeMs}'s job.
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
 * The field every writer of a message stamps when it MINTS the document.
 *
 * The one date on every message, which is what neither `sentAt` nor
 * `sendAtMs` is — each is written by one branch of the send path and neither
 * is on both kinds. A field carried by every record is the precondition for
 * ordering this collection in Firestore rather than in the browser, because
 * `orderBy` drops documents that lack the ordered field instead of
 * mis-sorting them.
 *
 * Epoch milliseconds rather than a `Timestamp`, matching `sendAtMs` beside
 * it: the two are compared against each other on every list that draws
 * drafts and sends together, and a comparison that has to unwrap one side
 * first is a comparison somebody writes wrong.
 */
export const EMAIL_CREATED_AT_FIELD = 'createdAtMs'

/**
 * When a message was created, for the records that carry it.
 *
 * `null` — not 0 — for a message written before every writer stamped
 * {@link EMAIL_CREATED_AT_FIELD}, because 0 is a real instant at the far end
 * of the sort and "we do not know" is not "1970". The backfill in
 * `tools/scripts/backfill-email-created-at.mjs` fills these in; until it is
 * run they order by their send time, which is the ordering they had.
 */
export function emailCreatedAtMs(
  record: Record<string, any> | null | undefined,
): number | null {
  const created = Number(record?.[EMAIL_CREATED_AT_FIELD] ?? Number.NaN)
  return Number.isFinite(created) && created > 0 ? created : null
}

/**
 * WHERE A MESSAGE SITS IN A LIST OF MESSAGES.
 *
 * Its send time where it has one, and its creation time where it does not.
 *
 * A draft has neither `sentAt` nor `sendAtMs`, so ordering a list on the send
 * time alone gives every draft the key 0 and files it below mail sent years
 * ago — the newest thing a merchant did, at the bottom of the page, behind
 * whatever paging the list has. Falling back to creation puts it where the
 * merchant left it.
 *
 * The fallback is deliberately not the other way round. A SENT message orders
 * by when it went out, never by when it was drafted: the list is a record of
 * what happened, and a message drafted in March and sent in June belongs in
 * June.
 *
 * @returns epoch ms, or 0 for a record with no time of any kind — a draft
 *   written before the created stamp existed, which sorts last exactly as it
 *   did before.
 */
export function emailListTimeMs(
  record: Record<string, any> | null | undefined,
): number {
  return emailSendTimeMs(record) || emailCreatedAtMs(record) || 0
}

/**
 * Reader-facing text for a message's state.
 *
 * The KEYS are persisted values written by the send path and read by the
 * scheduled-campaign processor — nothing here may change them, including
 * `canceled`, which is already the American spelling and is a stored enum in
 * either case. Only the right-hand side is display text, and an unrecognized
 * state falls through as itself rather than being flattened into one of
 * these: a state this list cannot name is worth seeing.
 *
 * `draft` is an email that has been created and not sent. `sending` is the
 * claim the scheduled processor and the send-now route both take before they
 * mail, and it is named here because a merchant who reloads mid-send would
 * otherwise be shown the raw token.
 *
 * ⚠️ **Not what a console row should draw.** This names the STORED value, and
 * an email delivering an audience larger than one batch is stored as
 * `scheduled` between runs — so a row rendering this says "Scheduled" about a
 * send that has already put five hundred messages in five hundred inboxes.
 * `campaignSendDisplay` in `campaign-container.ts` reads the counters beside
 * the status and is what every surface here draws. This remains the honest
 * answer to the narrower question of what one stored token means.
 */
export function emailStateLabel(status: unknown): string {
  const value = String(status ?? '')
  if (value === 'sent') return 'Sent'
  if (value === 'scheduled') return 'Scheduled'
  if (value === 'canceled') return 'Canceled'
  if (value === 'draft') return 'Draft'
  if (value === 'sending') return 'Sending'
  return value || 'Unknown'
}

/**
 * Whether an email has yet been mailed to anybody.
 *
 * The surfaces that report on a send need this because an unsent email has no
 * `stats` at all, and a report that divides into an absent denominator
 * presents "not sent yet" as a delivery rate of 0% — the same class of fault
 * as a rate rendered over a denominator it does not name.
 */
export function emailIsUnsent(
  record: Record<string, any> | null | undefined,
): boolean {
  const value = String(record?.['status'] ?? '')
  return value === 'draft' || value === 'scheduled' || value === 'sending'
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
