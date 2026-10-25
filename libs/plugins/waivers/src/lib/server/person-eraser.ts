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
  PluginPersonErasureReport,
  PluginPersonErasureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { waiversDb, waiversRefs } from './db'

/**
 * Erasing a person from a workspace's waivers (AGL-4042): every signature
 * they signed — their own details, the minors they signed for, the drawn
 * signature and any paper photo — goes, on every site. A signature is the
 * signer's personal data and nothing in it is a ledger the store must keep
 * nameless, so it is removed outright rather than kept with the name blanked.
 */
export async function eraseWaiversPerson(request: PluginPersonErasureRequest): Promise<PluginPersonErasureReport> {
  const email = String(request.email ?? '').trim().toLowerCase()
  if (!email || !request.orgId) return { signatures: 0 }
  const found = await waiversRefs.signatures(request.orgId).where('emailLower', '==', email).limit(500).get()
  if (request.dryRun) return { signatures: found.size }
  const bucket = (() => {
    try {
      return firebaseAdmin.app().storage().bucket()
    } catch {
      return null
    }
  })()
  for (let start = 0; start < found.docs.length; start += 200) {
    const batch = waiversDb().batch()
    for (const doc of found.docs.slice(start, start + 200)) {
      if (bucket) {
        await bucket.deleteFiles({ prefix: `orgs/${request.orgId}/waiverSignatures/${doc.id}/` }).catch(() => undefined)
      }
      batch.delete(doc.ref)
    }
    await batch.commit()
  }
  return { signatures: found.size }
}
