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
  PluginPersonEraser,
  PluginPersonErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { updateWhereEquals } from '@aglyn/tenant-data-admin/server/paged-sweeps'
import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * COMMERCE'S SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080).
 *
 * An order is the merchant's record of a sale: the amounts, the line items
 * and the tax are theirs to keep and the law expects them kept. So the person
 * is taken OFF every order they placed on a site of the workspace — name,
 * email, both addresses — and a stamp says when; the order itself stays.
 *
 * The address also lives in what the orders list queries by (AGL-3321): its
 * lower-cased key, its search prefixes, and the quick search's token array,
 * which holds those prefixes beside the order number's and the item names'.
 * The first two go; the prefixes are taken back out of the third. A prefix
 * the number or an item name shares with the address goes with it — a search
 * for that prefix misses this order until the orders backfill restamps it —
 * and nothing left on the order answers to the address.
 *
 * A DRY RUN counts the orders and writes nothing.
 */

type Firestore = FirebaseFirestore.Firestore

export interface CommercePersonEraserDeps {
  firestore(): Firestore
}

const LABEL = 'commerce person eraser'

/** The patch that takes the buyer off one order, as it stands. */
export function erasedOrderPatch(
  data: FirebaseFirestore.DocumentData | undefined,
  now: number,
): Record<string, unknown> {
  const addressTokens = new Set(
    Array.isArray(data?.['customerEmailTokens']) ? data['customerEmailTokens'] : [],
  )
  return {
    customerEmail: null,
    customerName: null,
    shippingAddress: FieldValue.delete(),
    billingAddress: FieldValue.delete(),
    customerErasedAtMs: now,
    customerEmailLower: null,
    customerEmailTokens: [],
    ...(Array.isArray(data?.['searchTokens'])
      ? {
          searchTokens: (data['searchTokens'] as unknown[]).filter(
            (token) => !addressTokens.has(token),
          ),
        }
      : {}),
  }
}

export function createCommercePersonEraser(deps: CommercePersonEraserDeps): PluginPersonEraser {
  return async ({ orgId, email, dryRun, atMs }): Promise<PluginPersonErasureReport> => {
    const db = deps.firestore()
    const hosts = await db.collection('hosts').where('orgId', '==', orgId).get()
    let orders = 0
    for (const host of hosts.docs) {
      const placed = host.ref.collection('orders')
      if (dryRun) {
        orders += (await placed.where('customerEmail', '==', email).get()).size
        continue
      }
      orders += await updateWhereEquals(
        db,
        placed,
        'customerEmail',
        email,
        (data) => erasedOrderPatch(data, atMs),
        LABEL,
      )
    }
    return { orders }
  }
}

/** The eraser over the platform's own Firestore, as the declarations register it. */
export const commercePersonEraser: PluginPersonEraser = (request) =>
  createCommercePersonEraser({ firestore: () => firebaseAdmin.app().firestore() })(request)
