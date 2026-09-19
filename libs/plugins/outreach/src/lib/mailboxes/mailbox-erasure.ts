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
import type {
  PluginUserEraser,
  PluginUserErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import {
  mailboxCredentialsRef,
  mailboxRef,
  readMailboxCredentials,
  type OutreachGoogleMailboxCredentials,
} from './mailbox-credentials'
import {
  revokeMailboxGrant,
  type OutreachGrantRevocation,
  type OutreachRevokeDeps,
} from './mailbox-revoke'
import { outreachOAuthStateRef } from './oauth-state'
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
 * An ACCOUNT erasure (`plugin-user-erasure`, AGL-3106) reaches none of it on
 * its own: a person's mailbox lives under the organization and their grant
 * in a top-level collection, and the erasure removes the person, not the
 * organizations they belonged to. So the account eraser below revokes every
 * grant the person connected and deletes it, with their mailboxes and their
 * pending connects — their Gmail address and a token that sends as them are
 * about the person, and must not outlive them.
 *
 * Both erasers are registered from the console-only declarations entry:
 * revoking opens a sealed token with `OUTREACH_TOKEN_KEY`, which only the
 * console holds.
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

/** Firestore refuses a batch of more than 500 writes. */
const BATCH_LIMIT = 450

/** Deletes every reference, in batches under Firestore's limit. */
async function deleteAll(
  firestore: FirebaseFirestore.Firestore,
  refs: readonly FirebaseFirestore.DocumentReference[],
): Promise<void> {
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = firestore.batch()
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) batch.delete(ref)
    await batch.commit()
  }
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

/**
 * The account eraser (AGL-3106): every mailbox the person connected, in the
 * organizations they belonged to and in any they had already left, revoked
 * at Google and deleted with its stored grant; and their pending connects.
 *
 * A grant is kept at Google when a TEAMMATE still uses the same Google
 * account — a shared inbox two members connected — because revoking it would
 * cut the teammate's mailbox off; the erased person's own copy is deleted
 * either way. Every other copy the person holds is being erased too, so it
 * does not count as a use.
 */
export function createOutreachUserEraser(deps: OutreachErasureDeps): PluginUserEraser {
  return async ({ uid, orgIds }): Promise<PluginUserErasureReport> => {
    const firestore = deps.firestore()
    // By the person, across every organization — including one they have
    // already left, which `orgIds` no longer names.
    const credentials = await firestore
      .collection(OUTREACH_COLLECTIONS.mailboxCredentials)
      .where('connectedByUid', '==', uid)
      .get()
    const mailboxes = new Map<string, { orgId: string; mailboxId: string }>()
    const stored: OutreachGoogleMailboxCredentials[] = []
    for (const doc of credentials.docs) {
      const credential = readMailboxCredentials(doc.data())
      const orgId = credential?.orgId ?? String(doc.get('orgId') ?? '')
      if (credential) stored.push(credential)
      if (orgId) mailboxes.set(`${orgId}/${doc.id}`, { orgId, mailboxId: doc.id })
    }
    // A mailbox whose grant is already gone still names the person's
    // address; find those under each organization the person was in.
    for (const orgId of orgIds) {
      const connected = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection(OUTREACH_COLLECTIONS.mailboxes)
        .where('connectedByUid', '==', uid)
        .get()
      for (const doc of connected.docs) mailboxes.set(`${orgId}/${doc.id}`, { orgId, mailboxId: doc.id })
    }

    const theirs = new Set(credentials.docs.map((doc) => doc.id))
    const tally = emptyTally()
    for (const credential of stored) {
      count(tally, await revokeMailboxGrant(firestore, credential, deps, { excludeMailboxIds: theirs }))
    }
    tally.failed += credentials.size - stored.length

    const orgsWithPending = new Set([...orgIds, ...[...mailboxes.values()].map((entry) => entry.orgId)])
    await deleteAll(firestore, [
      ...credentials.docs.map((doc) => mailboxCredentialsRef(firestore, doc.id)),
      ...[...mailboxes.values()].map(({ orgId, mailboxId }) => mailboxRef(firestore, orgId, mailboxId)),
      ...[...orgsWithPending].map((orgId) => outreachOAuthStateRef(firestore, orgId, uid)),
    ])

    return {
      mailboxes: mailboxes.size,
      grants: credentials.size,
      ...tally,
    }
  }
}
