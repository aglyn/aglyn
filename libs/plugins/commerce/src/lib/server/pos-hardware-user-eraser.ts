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

import type {
  PluginUserEraser,
  PluginUserErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  POS_HARDWARE_ORDERS_COLLECTION,
  POS_HARDWARE_SALES_COLLECTION,
  posHardwareBuyerErasedPatch,
  posHardwareSaleRecord,
  type PosHardwareOrder,
} from '../model/pos-hardware'

/*==========================================
 * COMMERCE'S SHARE OF AN ACCOUNT ERASURE: HARDWARE ORDERS (AGL-4038).
 *
 * A hardware order is the workspace's purchase and the platform's sale, so
 * an account erasure keeps it and every amount on it, and takes the BUYER
 * off it: who started it, the email, the name, the phone, the street and the
 * tracking (`posHardwareBuyerErasedPatch`). The country, state and postal
 * code stay, because sales tax is sourced by them. The retained sale record
 * (`posHardwareSales/{orderId}`) never held the person, and is rewritten
 * from the redacted order in the same transaction so the two agree.
 *
 * Found by a COLLECTION-GROUP query on `createdBy`, so an order placed in a
 * workspace the person has since left is reached too — the support-thread
 * redaction's shape (AGL-1971). It needs the `hardwareOrders.createdBy`
 * collection-group override in `cloud/firebase-firestore.indexes.json`; where
 * that index is not yet deployed the query is refused, and the eraser falls
 * back to the workspaces the person belonged to when the erasure began and
 * says so (`formerWorkspacesReached: false`), rather than reporting a clean
 * pass over orders it could not see.
 *
 * Idempotent: a redacted order no longer carries the uid, so a second run
 * finds nothing to do.
 *=========================================*/

type Firestore = FirebaseFirestore.Firestore

export interface PosHardwareUserEraserDeps {
  firestore(): Firestore
  now?: () => number
}

const LABEL = '[pos-hardware] user eraser'

export function createPosHardwareUserEraser(deps: PosHardwareUserEraserDeps): PluginUserEraser {
  return async ({ uid, orgIds }): Promise<PluginUserErasureReport> => {
    if (!uid) return { hardwareOrdersRedacted: 0, formerWorkspacesReached: true }
    const db = deps.firestore()
    const now = deps.now ?? Date.now

    let refs: FirebaseFirestore.DocumentReference[]
    let formerWorkspacesReached = true
    try {
      const placed = await db.collectionGroup(POS_HARDWARE_ORDERS_COLLECTION).where('createdBy', '==', uid).get()
      refs = placed.docs.map((doc) => doc.ref)
    } catch (error) {
      console.error(`${LABEL}: the collection-group query was refused; reading current workspaces only`, error)
      formerWorkspacesReached = false
      refs = []
      for (const orgId of orgIds) {
        const placed = await db
          .collection('orgs')
          .doc(orgId)
          .collection(POS_HARDWARE_ORDERS_COLLECTION)
          .where('createdBy', '==', uid)
          .get()
        refs.push(...placed.docs.map((doc) => doc.ref))
      }
    }

    let hardwareOrdersRedacted = 0
    for (const ref of refs) {
      const redacted = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        const order = snapshot.data() as PosHardwareOrder | undefined
        // Gone, or already someone else's: nothing of this person is on it.
        if (!snapshot.exists || !order || order.createdBy !== uid) return false
        const patch = posHardwareBuyerErasedPatch(order, now())
        transaction.update(ref, patch)
        transaction.set(
          db.collection(POS_HARDWARE_SALES_COLLECTION).doc(ref.id),
          posHardwareSaleRecord(ref.id, { ...order, ...patch } as PosHardwareOrder),
        )
        return true
      })
      if (redacted) hardwareOrdersRedacted += 1
    }
    return { hardwareOrdersRedacted, formerWorkspacesReached }
  }
}

/** The eraser over the platform's own Firestore, as the declarations register it. */
export const posHardwareUserEraser: PluginUserEraser = (request) =>
  createPosHardwareUserEraser({ firestore: () => firebaseAdmin.app().firestore() })(request)
