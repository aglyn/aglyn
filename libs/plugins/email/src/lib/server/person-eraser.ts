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
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { listMemberDocIds } from '@aglyn/tenant-data-admin/server/list-members'

/**
 * THE EMAIL PLUGIN'S SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080): the
 * person comes off every audience list of the workspace.
 *
 * A member is filed under one of the ids `listMemberDocIds` names — the
 * canonical key, then the ids earlier writers minted — so every list is asked
 * for all of them with one `getAll`, and a member enrolled under an old id is
 * not missed. The lists themselves, and their other members, stay.
 *
 * Unsubscribes and bounces are not touched: a suppression is keyed by the
 * hash and is the promise the erasure keeps.
 *
 * A DRY RUN counts the memberships and writes nothing.
 */

type Firestore = FirebaseFirestore.Firestore

export interface EmailPersonEraserDeps {
  firestore(): Firestore
}

export function createEmailPersonEraser(deps: EmailPersonEraserDeps): PluginPersonEraser {
  return async ({ orgId, email, dryRun }): Promise<PluginPersonErasureReport> => {
    const db = deps.firestore()
    const memberIds = listMemberDocIds(email)
    let memberships = 0
    if (!memberIds.length) return { memberships }
    const lists = await db.collection('orgs').doc(orgId).collection('lists').get()
    for (const list of lists.docs) {
      const found = await db.getAll(...memberIds.map((id) => list.ref.collection('members').doc(id)))
      for (const member of found) {
        if (!member.exists) continue
        if (!dryRun) await member.ref.delete()
        memberships += 1
      }
    }
    return { memberships }
  }
}

/** The eraser over the platform's own Firestore, as the declarations register it. */
export const emailPersonEraser: PluginPersonEraser = (request) =>
  createEmailPersonEraser({ firestore: () => firebaseAdmin.app().firestore() })(request)
