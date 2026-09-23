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

import {
  registerPluginRecordEmailStateWriter,
  type PluginRecordEmailStateReport,
  type PluginRecordEmailStateRequest,
  type PluginRecordEmailStateWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import {
  EMAIL_STATE_FIELD,
  nextEmailState,
  normalizeContactEmail,
  personKey,
  readEmailState,
  type EmailState,
} from '@aglyn/aglyn/server'
import { findContactByEmail, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * THE CRM'S WRITER ON THE CORE'S RECORD EMAIL-STATE SEAM (AGL-3245).
 *
 * A sender filed a verdict on an address — the outreach runtime's bounce,
 * the campaign webhook's complaint, a member's do-not-contact mark, the
 * unsubscribe link — and says so here; this writes it onto every record
 * the address is, as `emailState`, so the record a person reads and the
 * lists a send consults agree.
 *
 * One address can be several records: the contact the organization holds
 * (found through the address index, `findContactByEmail`), and a lead on
 * each site the organization owns — leads are keyed by `personKey`, so a
 * lead is addressed directly under every host. All of them are stamped;
 * the verdict is about the address, not about which record a rep opened.
 * A caller that knows only the site reads the organization off it.
 *
 * The write keeps the STRONGER verdict (`nextEmailState`): a member's
 * do-not-contact mark is not undone by a later bounce, and `ok` lands only
 * when a caller forces it. `updatedAt` is left alone — a verdict is
 * something that happened to the person, not an edit the team made, and a
 * list sorted on recency must not reshuffle on a bounce.
 *
 * Never throws: the list is the control, and a record that could not be
 * stamped is a chip a page goes without, logged.
 */

type Firestore = FirebaseFirestore.Firestore

export interface CrmRecordEmailStateDeps {
  firestore(): Firestore
}

const NONE: PluginRecordEmailStateReport = { records: 0 }

/**
 * Applies the verdict to one record; answers whether it moved. A read then
 * a merge rather than a transaction: two verdicts landing together each
 * compare against a state at least as old as their own, and the ranking
 * makes the order of two writes of the same rank immaterial.
 */
async function stampRecord(
  ref: FirebaseFirestore.DocumentReference,
  incoming: EmailState,
  force: boolean,
): Promise<boolean> {
  const snapshot = await ref.get()
  if (!snapshot.exists) return false
  const current = readEmailState(snapshot.data() as Record<string, unknown>)
  const next = nextEmailState(current, incoming, { force })
  // The current verdict stood, or the same verdict arrived again — a second
  // run of the caller — and there is nothing to write.
  if (
    next === current ||
    (current &&
      next.status === current.status &&
      next.atMs === current.atMs &&
      next.source === current.source &&
      next.detail === current.detail)
  ) {
    return false
  }
  await ref.set({ [EMAIL_STATE_FIELD]: next }, { merge: true })
  return true
}

/** The organization a request names, or the one its site belongs to. */
async function resolveOrgId(firestore: Firestore, request: PluginRecordEmailStateRequest): Promise<string> {
  const named = String(request.orgId ?? '').trim()
  if (named) return named
  const hostId = String(request.hostId ?? '').trim()
  if (!hostId) return ''
  const host = await firestore.collection('hosts').doc(hostId).get()
  return host.exists ? String(host.get('orgId') ?? '') : ''
}

export function createCrmRecordEmailStateWriter(deps: CrmRecordEmailStateDeps): PluginRecordEmailStateWriter {
  return {
    async stamp(request) {
      const email = normalizeContactEmail(request.email)
      const key = email ? personKey(email) : null
      if (!email || !key) return NONE
      const firestore = deps.firestore()
      let orgId: string
      try {
        orgId = await resolveOrgId(firestore, request)
      } catch (error) {
        console.error('[crm] the site’s organization could not be read for an email state', request.hostId, error)
        return NONE
      }
      if (!orgId) return NONE
      const state: EmailState = {
        status: request.state.status,
        atMs: Number.isFinite(request.state.atMs) && request.state.atMs > 0 ? request.state.atMs : Date.now(),
        source: request.state.source,
        detail: request.state.detail
          ? String(request.state.detail).replace(/\s+/g, ' ').trim().slice(0, 500)
          : null,
        ...(request.state.enrollmentId ? { enrollmentId: request.state.enrollmentId } : {}),
      }
      const force = request.force === true
      let records = 0
      try {
        const contacts = firestore.collection('orgs').doc(orgId).collection('contacts')
        const contact = await findContactByEmail(contacts, email)
        if (contact && (await stampRecord(contact.ref, state, force))) records += 1
      } catch (error) {
        console.error('[crm] the contact could not be stamped with an email state', orgId, error)
      }
      try {
        /*
         * ONE ORG ROW. A bounce or a do-not-contact mark is the platform's
         * verdict on the ADDRESS, and since AGL-3277 there is one document
         * carrying it — the per-site loop beside this had nothing left to
         * find once AGL-3276 emptied the host path.
         */
        if (await stampRecord(
          firestore.collection('orgs').doc(orgId).collection('leads').doc(key),
          state,
          force,
        )) {
          records += 1
        }
      } catch (error) {
        console.error('[crm] the leads could not be stamped with an email state', orgId, error)
      }
      return { records }
    },
  }
}

/** The platform's own dependencies. Specs build their own. */
export function defaultCrmRecordEmailStateDeps(): CrmRecordEmailStateDeps {
  return { firestore: () => firebaseAdmin.app().firestore() }
}

/** Registers the CRM as the workspace's record system on the email-state seam. */
export function registerCrmRecordEmailStateWriter(
  deps: CrmRecordEmailStateDeps = defaultCrmRecordEmailStateDeps(),
): void {
  registerPluginRecordEmailStateWriter(createCrmRecordEmailStateWriter(deps), { pluginId: BUNDLE_ID })
}
