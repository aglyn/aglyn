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
 * Privacy erasure of one PERSON from one workspace (AGL-2623).
 *
 * The CRM's **Delete contact** is a detach: one site lets go of a shared row
 * and the document dies only when the last holder does. A privacy erasure is
 * the opposite act — the person is removed from every site in the workspace
 * regardless of who holds them, together with everything the workspace keeps
 * beside them — and it is filed as a REQUEST rather than executed on the
 * click, so that the same daily job that executes workspace erasures
 * executes these, with one audit trail and one place to watch the queue.
 *
 * A request lives at `personErasures/{orgId}__{sha256(email)}`: keyed by
 * the workspace AND the person, because the workspace is the controller of
 * this data and a second workspace that also knows the person has a
 * relationship of its own that this request has no claim on. The id is
 * deterministic so a second request for the same person is the same
 * document rather than a second one, and the address itself is carried only
 * while the request is pending — the sweep needs it to find the records,
 * and the completed request keeps the hash alone.
 *
 * Pure data module: names, types and the small helpers the dialog, the
 * route and the job would otherwise each write for themselves. No
 * Firestore, no React, no `node:` import — the client barrel re-exports it.
 */

import { normalizeContactEmail } from './contacts'

/** Top-level collection holding one document per (workspace, person). */
export const PERSON_ERASURES_COLLECTION = 'personErasures'

/**
 * The document id: workspace first, then the person's key, joined by a
 * separator neither can contain. A Firestore id may not hold a `/`, and a
 * person key is hex, so a double underscore is unambiguous.
 */
export function personErasureId(orgId: string, personKey: string): string {
  if (!orgId || !personKey) {
    throw new Error('a person erasure names a workspace and a person')
  }
  return `${orgId}__${personKey}`
}

/**
 * The field a pending request stamps on the records it covers — the contact
 * document and each site's lead — so a record page can show the state off
 * the document it already listens to, with no second read. Epoch millis.
 *
 * A marker, not the request: the job reads the queue, never this field, so
 * a client write that strips it hides the banner and changes nothing else.
 */
export const CONTACT_ERASURE_REQUESTED_FIELD = 'erasureRequestedAtMs'

/** When a record's erasure was requested, or null for a record with none. */
export function readErasureRequestedAtMs(
  row: Record<string, unknown> | null | undefined,
): number | null {
  const value = (row ?? {})[CONTACT_ERASURE_REQUESTED_FIELD]
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

/**
 * Where a request is in its life.
 *
 * - `pending` — filed, waiting for the next run. `pendingSinceMs` is set,
 *   which is what the job orders on.
 * - `erased` — the sweep ran and reported its counts. The address is gone
 *   from the document.
 * - `failed` — the sweep threw. The request stays pending (it keeps
 *   `pendingSinceMs`, moved to the back of the queue) so the next run tries
 *   again, and the failure is on the document for a staff member to read.
 */
export type PersonErasureStatus = 'pending' | 'erased' | 'failed'

/** `personErasures/{orgId}__{personKey}` document shape. */
export interface PersonErasureRequest {
  orgId: string
  /** `sha256(normalizedEmail)` — the same key `emailDeliveries` files under. */
  personKey: string
  status: PersonErasureStatus
  /**
   * The address, present ONLY while the request is pending: the sweep
   * queries by it, and nothing else may. Deleted by the job on completion.
   */
  email?: string
  requestedAtMs: number
  /** The workspace admin who filed it. */
  requestedByUid: string
  /** The site the request was filed from — for the activity feed's link. */
  hostId?: string
  /** The record it was filed from, when it was a contact. */
  contactId?: string
  /** The record it was filed from, when it was a lead. */
  leadId?: string
  /**
   * Set while pending. Absent once erased, so `orderBy('pendingSinceMs')`
   * lists exactly the queue — a document without the field is not returned.
   */
  pendingSinceMs?: number
  erasedAtMs?: number
  /** Counts only — what the sweep removed or anonymized, for the audit. */
  result?: Record<string, number>
  failedAtMs?: number
  failureCount?: number
  /** The last failure's message, for the staff reader. Never the data. */
  lastError?: string
}

/**
 * The `reason` a per-site suppression row carries when it was written by
 * an erasure. Such a row keeps NO address — the id is the hash — and does
 * two jobs the ordinary suppression already does one of: every campaign
 * gate refuses the address, and the contact capture path refuses to create
 * a record for it, so a later form fill or order does not quietly rebuild
 * the person the workspace just erased.
 */
export const PERSON_ERASURE_SUPPRESSION_REASON = 'erasure'

/**
 * What a door says when it refuses to create a record for an erased address
 * — the contact create route and both lead-convert doors alike. The person
 * asked to be removed and a workspace admin filed it; a record cannot be
 * re-created by hand any more than by a form, and the sentence says where
 * the decision lives rather than implying the address is malformed.
 */
export const CONTACT_ERASED_MESSAGE =
  'This person was erased from your workspace at their request, so a ' +
  'record cannot be created for this address.'

/**
 * What one request removes across the workspace — the dialog's list and the
 * docs' list, from one source so the two cannot drift. Each line names a
 * thing a reader recognizes from the console, not a collection.
 */
export const PERSON_ERASURE_REMOVES: readonly string[] = [
  'The contact record on every site in this workspace — profile, notes, tags, timeline and custom fields',
  'Every lead for this address, on every site',
  'The tasks and logged activities filed against the person',
  'The person on any email audience list',
  'The campaign delivery log — every message sent to the address, with its opens and clicks',
]

/**
 * What survives, and how. Orders and bookings are the workspace's financial
 * and appointment records, and tax law keeps them; the person is taken off
 * them rather than the record destroyed. A deal is the team's own pipeline
 * record and is unlinked, not deleted.
 */
export const PERSON_ERASURE_RETAINS: readonly string[] = [
  'Orders and bookings stay as financial records with the name, email, phone and addresses removed',
  'Deals stay on the pipeline, unlinked from the person',
  'Companies stay, with their contact count reduced',
]

/**
 * What the request does not reach, so the admin can finish the job by hand
 * where the person asked for everything. A form submission keeps the
 * address inside the answers it recorded, under whatever the form called
 * the field, so there is no key to find them by; a site member holds a
 * login of their own.
 */
export const PERSON_ERASURE_NOT_REACHED: readonly string[] = [
  'Form submissions — delete them from the Inbox',
  'A site member account — close it from the site’s Members page',
]

/**
 * Whether the typed confirmation names the record's address.
 *
 * Normalized on both sides, so `Jane@Example.com` confirms `jane@example.com`
 * — the confirmation is there to make the admin read the address, not to
 * test their capitalization.
 */
export function personErasureConfirmationMatches(
  typed: unknown,
  email: unknown,
): boolean {
  const wanted = normalizeContactEmail(email)
  if (!wanted) return false
  return normalizeContactEmail(typed) === wanted
}
