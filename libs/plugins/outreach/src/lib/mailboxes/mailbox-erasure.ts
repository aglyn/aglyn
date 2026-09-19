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
  PluginOrgEraser,
  PluginOrgErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { readMailboxCredentials } from './mailbox-credentials'
import {
  revokeMailboxGrant,
  type OutreachGrantRevocation,
  type OutreachRevokeDeps,
} from './mailbox-revoke'
import { readOutreachGoogleConfig } from './outreach-config'

/**
 * OUTREACH'S SHARE OF AN ERASURE (AGL-2978).
 *
 * The workspace erasure deletes every stored Outreach grant on its own —
 * `outreachMailboxCredentials` by its `orgId` field, and the mailboxes and
 * pending connects with the organization's tree — in any process, whether
 * or not this plugin is loaded. Deleting the platform's copy leaves the
 * grant alive at Google, though: listed in the rep's account as an app with
 * access to their mail until they remove it by hand. So Outreach registers a
 * workspace eraser (`plugin-org-erasure`) that revokes each grant first,
 * while the stored credential still exists to revoke it with. It deletes
 * nothing itself; the erasure's own sweep does that right after.
 *
 * Registered from the console-only declarations entry: revoking opens a
 * sealed token with `OUTREACH_TOKEN_KEY`, which only the console holds.
 */

export interface OutreachErasureDeps extends OutreachRevokeDeps {
  firestore(): FirebaseFirestore.Firestore
}

/** The platform's own dependencies. Specs build their own. */
export function defaultOutreachErasureDeps(): OutreachErasureDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    readConfig: readOutreachGoogleConfig,
    transport: {},
  }
}

/** How many grants came to each end, for an erasure's audit record. */
interface RevocationTally {
  revoked: number
  alreadyInvalid: number
  kept: number
  failed: number
}

const emptyTally = (): RevocationTally => ({ revoked: 0, alreadyInvalid: 0, kept: 0, failed: 0 })

function count(tally: RevocationTally, outcome: OutreachGrantRevocation): void {
  if (outcome === 'revoked') tally.revoked += 1
  else if (outcome === 'already-invalid') tally.alreadyInvalid += 1
  else if (outcome === 'kept-for-other-mailbox') tally.kept += 1
  else tally.failed += 1
}

/**
 * The workspace eraser: revoke, at Google, every grant the organization
 * holds. A grant another organization still uses for the same Google
 * account is kept (`kept`), because revoking it would cut that
 * organization's mailbox off too. A plan counts the grants and touches
 * nothing, so its revocation figures are `null` — not measured, not zero.
 */
export function createOutreachOrgEraser(deps: OutreachErasureDeps): PluginOrgEraser {
  return async ({ orgId, dryRun }): Promise<PluginOrgErasureReport> => {
    const firestore = deps.firestore()
    const rows = await firestore
      .collection(OUTREACH_COLLECTIONS.mailboxCredentials)
      .where('orgId', '==', orgId)
      .get()
    if (dryRun) {
      return { grants: rows.size, revoked: null, alreadyInvalid: null, kept: null, failed: null }
    }
    const tally = emptyTally()
    for (const doc of rows.docs) {
      const credential = readMailboxCredentials(doc.data())
      count(
        tally,
        credential
          ? await revokeMailboxGrant(firestore, credential, deps, { excludeOrgId: orgId })
          : 'failed',
      )
    }
    return { grants: rows.size, ...tally }
  }
}
