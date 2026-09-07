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
 * A person's lifecycle stage, FLOORED at what just happened to them
 * (AGL-2641).
 *
 * The capture doors floor a stage inside `upsertHostContact`: an order
 * names `customer` as its `initialLifecycleStage`, and the door fills an
 * empty stage or advances an earlier one and never moves anybody back. A
 * won deal is the same fact as a purchase — the business has decided this
 * person bought — but it arrives at a record that already exists, through a
 * writer that is not a capture door: the deal-stage route and the REST
 * deals resource. This is the door's rule for them, over a contact document
 * they already hold a reference to.
 *
 * The write goes into ONE holder's facet, because a stage is one business's
 * reading of a person and the row is shared by every site in the org. The
 * holder is the site the deal was made on, resolved to its consent group
 * the way every other facet writer resolves it; a deal that names no site
 * falls back to the site that captured the person, which is the one
 * holder a contact always has. A contact that names none either is left
 * alone and the caller told, rather than written into a facet nobody reads.
 *
 * The write is skipped when it would change nothing — a customer stays a
 * customer, an evangelist stays an evangelist, `other` is never overwritten
 * — so a caller can announce `contactStageChanged` exactly when `advanced`
 * says the stage moved, and an automation listening for the change never
 * hears one that did not happen.
 */

import {
  consentGroupForHost,
  advanceContactLifecycleStage,
  contactFacetPath,
  type ContactLifecycleStage,
  isContactLifecycleStage,
  readContactFacet,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'

export type ContactLifecycleFloor =
  | {
      /** The stage was raised to the floor. */
      outcome: 'advanced'
      contactId: string
      /** The address on the row, for the event a caller announces. */
      email: string
      /** The site whose facet was written. */
      hostId: string
      groupId: string
      /** The stage before the write, or `''` for a person who had none. */
      previousStage: ContactLifecycleStage | ''
      lifecycleStage: ContactLifecycleStage
    }
  | {
      /** The person already held the floor or a later stage; nothing was written. */
      outcome: 'held'
      contactId: string
      email: string
      hostId: string
      groupId: string
      lifecycleStage: ContactLifecycleStage
    }
  | {
      /** No such contact. */
      outcome: 'missing'
      contactId: string
    }
  | {
      /** Neither the caller nor the contact names a site, so there is no facet to write. */
      outcome: 'unheld'
      contactId: string
    }

export interface ContactLifecycleFloorOptions {
  contactRef: FirebaseFirestore.DocumentReference
  /**
   * The org the contact belongs to, for the consent groups — the same
   * document every facet writer resolves the holder through.
   */
  org: Record<string, unknown> | null | undefined
  /**
   * The site the act happened on, whose facet takes the stage. `null` for a
   * record no site captured; the contact's own capturing site is used then.
   */
  hostId: string | null | undefined
  /** The EARLIEST stage that describes what happened — see `advanceContactLifecycleStage`. */
  floor: ContactLifecycleStage
}

export async function floorContactLifecycleStage(
  options: ContactLifecycleFloorOptions,
): Promise<ContactLifecycleFloor> {
  const { contactRef, org, floor } = options
  const snapshot = await contactRef.get()
  if (!snapshot.exists) return { outcome: 'missing', contactId: contactRef.id }
  const data = (snapshot.data() ?? {}) as Record<string, unknown>
  const hostId = String(options.hostId ?? '').trim() || String(data['hostId'] ?? '').trim()
  if (!hostId) return { outcome: 'unheld', contactId: snapshot.id }

  const { groupId } = consentGroupForHost(org ?? null, hostId)
  const facet = readContactFacet(data, groupId)
  const held = isContactLifecycleStage(facet.lifecycleStage)
    ? facet.lifecycleStage
    : undefined
  const lifecycleStage = advanceContactLifecycleStage(held, floor) ?? floor
  const email = String(data['email'] ?? '')
  if (lifecycleStage === held) {
    return { outcome: 'held', contactId: snapshot.id, email, hostId, groupId, lifecycleStage }
  }
  await snapshot.ref.update({
    [contactFacetPath(groupId, 'lifecycleStage')]: lifecycleStage,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return {
    outcome: 'advanced',
    contactId: snapshot.id,
    email,
    hostId,
    groupId,
    previousStage: held ?? '',
    lifecycleStage,
  }
}
