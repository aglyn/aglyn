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

import { deleteField, Timestamp } from 'firebase/firestore'

/**
 * What deleting an email template writes (AGL-3321): the soft delete, and
 * the name keys cleared with it.
 *
 * A template is soft-deleted — `deletedAt`, never removed — so campaigns sent
 * from it keep their reports. The templates lists are Firestore queries
 * ordered by `nameLower` (`EMAIL_TEMPLATE_QUERY`), and a query cannot ask for
 * a field to be ABSENT, so "not deleted" is not a clause any of them could
 * add. Clearing the keys is what takes the tombstone off the list instead:
 * `orderBy('nameLower')` leaves out a document without the field, and
 * `nameTokens` answers no search. The rules freeze `deletedAt` once written
 * and offer no undelete, so nothing needs the keys back.
 *
 * ⚠️ A backfill that stamps screen name keys must skip a screen with
 * `deletedAt`, or it puts the deleted template back on the list.
 */
export function emailTemplateSoftDelete() {
  return {
    deletedAt: Timestamp.now(),
    nameLower: deleteField(),
    nameTokens: deleteField(),
    nameReversed: deleteField(),
  }
}
