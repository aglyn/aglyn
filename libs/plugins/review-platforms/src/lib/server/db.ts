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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { Firestore } from 'firebase-admin/firestore'

/**
 * The Firestore every server module here writes through: the Admin SDK's,
 * or a spec's in-memory double. One getter, so a spec swaps one thing.
 */

let override: unknown = null

export function reviewPlatformsDb(): Firestore {
  return (override ?? firebaseAdmin.app().firestore()) as Firestore
}

/** Test seam. */
export function setReviewPlatformsDbForTests(db: unknown): void {
  override = db
}

/** `orgs/{orgId}`. */
export function orgRef(orgId: string) {
  return reviewPlatformsDb().collection('orgs').doc(orgId)
}

/** Whether a client-supplied id is one Firestore will take as a document id. */
export function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('/') &&
    !/^__.*__$/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}
