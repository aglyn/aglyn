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
import { PAYPAL_COLLECTIONS } from '../constants'

let override: unknown = null

/** The Firestore every PayPal record is read from and written to. */
export function payPalDb(): Firestore {
  return (override ?? firebaseAdmin.app().firestore()) as Firestore
}

/** Test seam: an in-memory Firestore. */
export function setPayPalDbForTests(db: unknown): void {
  override = db
}

export const sellersCollection = () => payPalDb().collection(PAYPAL_COLLECTIONS.sellers)
export const checkoutsCollection = () => payPalDb().collection(PAYPAL_COLLECTIONS.checkouts)
export const webhookEventsCollection = () => payPalDb().collection(PAYPAL_COLLECTIONS.webhookEvents)

/** A value safe to use as one Firestore document id. */
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
