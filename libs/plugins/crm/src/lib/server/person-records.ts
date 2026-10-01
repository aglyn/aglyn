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
  containerMembershipField,
  contactContainerFieldPath,
  normalizeContainerIds,
} from '@aglyn/aglyn/app-utils/container-membership'
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  PluginPersonFileRequest,
  PluginPersonFindRequest,
  PluginPersonReadRequest,
  PluginPersonRecord,
  PluginPersonRecords,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import {
  consentGroupForSite,
  firebaseAdmin,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
// The leaves, not the barrel: this plugin's specs substitute the barrel
// wholesale, and the lookup and the restamp must reach the real logic.
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { restampCrmListFieldsAt } from '@aglyn/tenant-data-admin/server/crm-records'
import { FieldValue } from 'firebase-admin/firestore'
import { recordPersonRefund } from './person-refund'

/**
 * THE CRM AS THE PLUGIN THAT KEEPS PEOPLE, asked by the plugins that do not
 * (AGL-3080) — the CRM's side of `plugin-person-records`.
 *
 * Two kinds of record are a person here, in the words `plugin-record-routes`
 * addresses them by: a `contact`, the person once they are known, filed at
 * `orgs/{orgId}/contacts/{id}`; and a `lead`, the person before anybody has
 * qualified them, at `orgs/{orgId}/leads/{personKey}` (AGL-3275). One person
 * is one record (AGL-3232), so a lookup by address answers the contact when
 * there is one and the lead only for a caller that asked for any kind.
 *
 * The record's `data` is the stored document. Beside the fields the platform
 * defines (`marketingConsent…`, `emailState`, `visibleTo`), a contact keeps
 * what each consent group knows of the person in `facets.{groupId}` — the
 * sources, stage, owner, company, address and tags — and a lead keeps the
 * same facts at its top level.
 */

type Firestore = FirebaseFirestore.Firestore

/** The person kinds, as `plugin-record-routes` addresses them. */
export const CRM_PERSON_KINDS = { contact: 'contact', lead: 'lead' } as const

/** The collection each person kind is stored in, under the organization. */
const STORED_IN: Readonly<Record<string, string>> = {
  [CRM_PERSON_KINDS.contact]: 'contacts',
  [CRM_PERSON_KINDS.lead]: 'leads',
}

/** `getAll` takes this many references per call. */
const GET_ALL_CHUNK = 300

export interface CrmPersonRecordsDeps {
  firestore(): Firestore
  /** The organization a site belongs to, or `null` for one with none. */
  orgIdForHost(hostId: string): Promise<string | null>
  /** The consent group a site files its facet under. */
  groupIdForHost(hostId: string): Promise<string>
}

export function defaultCrmPersonRecordsDeps(): CrmPersonRecordsDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    orgIdForHost: async (hostId) => (await resolveOrgIdForHost(hostId)) ?? null,
    groupIdForHost: async (hostId) => (await consentGroupForSite(hostId)).groupId,
  }
}

function personOf(kind: string, snapshot: FirebaseFirestore.DocumentSnapshot): PluginPersonRecord {
  const data = (snapshot.data() ?? {}) as Record<string, unknown>
  return { kind, id: snapshot.id, email: normalizeContactEmail(data['email']), data }
}

/**
 * The organization a request names, or the one its site belongs to. A site
 * with no organization THROWS, as the org-data lookup every caller used to
 * make threw: each caller has already decided which way a failed read falls.
 */
async function orgOf(
  deps: CrmPersonRecordsDeps,
  request: { orgId?: string | null; hostId?: string | null },
): Promise<string> {
  const named = String(request.orgId ?? '').trim()
  if (named) return named
  const hostId = String(request.hostId ?? '').trim()
  const resolved = hostId ? await deps.orgIdForHost(hostId) : null
  if (!resolved) throw new Error(`[crm] no organization to find a person in for host ${hostId || '(none)'}`)
  return resolved
}

export function createCrmPersonRecords(deps: CrmPersonRecordsDeps): PluginPersonRecords {
  return {
    /**
     * The contact first, through the org's address index (AGL-2633) so an
     * address a merge folded into another record still names the person who
     * now holds it; then, for a caller that asked for any kind, the lead the
     * address is keyed as. Narrowed to the site when asked, on the document
     * the address names: a record the site cannot see is `null`.
     */
    async find(request: PluginPersonFindRequest) {
      const email = normalizeContactEmail(request.email)
      if (!email) return null
      const orgId = await orgOf(deps, request)
      const org = deps.firestore().collection('orgs').doc(orgId)
      const hostId = String(request.hostId ?? '').trim()
      const narrowTo = request.onlyVisibleToSite && hostId ? hostId : null
      const contact = await findContactByEmail(
        org.collection(STORED_IN[CRM_PERSON_KINDS.contact]),
        email,
        narrowTo ? { hostId: narrowTo } : {},
      )
      if (contact) return personOf(CRM_PERSON_KINDS.contact, contact)
      if (!request.anyKind) return null
      const key = personKey(email)
      if (!key) return null
      const lead = await org.collection(STORED_IN[CRM_PERSON_KINDS.lead]).doc(key).get()
      if (!lead.exists) return null
      if (narrowTo && !visibleToHost(lead.get('visibleTo') as string[] | undefined, narrowTo)) {
        return null
      }
      return personOf(CRM_PERSON_KINDS.lead, lead)
    },

    /** Every record named, read at once; a kind the CRM does not keep is `null`. */
    async read(request: PluginPersonReadRequest) {
      const firestore = deps.firestore()
      const org = firestore.collection('orgs').doc(request.orgId)
      const refs = request.records.map((record) => {
        const collection = STORED_IN[record.kind]
        const id = String(record.id ?? '').trim()
        return collection && id ? org.collection(collection).doc(id) : null
      })
      const wanted = refs.filter((ref): ref is FirebaseFirestore.DocumentReference => ref !== null)
      const snapshots: FirebaseFirestore.DocumentSnapshot[] = []
      for (let start = 0; start < wanted.length; start += GET_ALL_CHUNK) {
        snapshots.push(...(await firestore.getAll(...wanted.slice(start, start + GET_ALL_CHUNK))))
      }
      let at = 0
      return request.records.map((record, index) => {
        if (!refs[index]) return null
        const snapshot = snapshots[at++]
        return snapshot?.exists ? personOf(record.kind, snapshot) : null
      })
    },

    /**
     * Files the person under the containers as the site holds them: on a
     * contact, inside the site's consent-group facet — which campaigns a
     * merchant filed somebody under is that merchant's record, and written at
     * the top it would be readable by every site of an agency's account; on a
     * lead, in the lead's own membership field, whose list fields are then
     * restamped so the Leads list's filter finds it (AGL-3321).
     *
     * `update`, never a merge-set: a dotted path in `set` is a literal field
     * name, and the record must exist. A record the site cannot see is not
     * filed.
     */
    async fileUnder(request: PluginPersonFileRequest) {
      const ids = normalizeContainerIds(request.ids)
      const collection = STORED_IN[request.record.kind]
      const id = String(request.record.id ?? '').trim()
      if (!ids.length || !collection || !id) return { filed: false }
      const orgId = await orgOf(deps, request)
      const ref = deps.firestore().collection('orgs').doc(orgId).collection(collection).doc(id)
      const snapshot = await ref.get()
      if (!snapshot.exists) return { filed: false }
      if (!visibleToHost(snapshot.get('visibleTo') as string[] | undefined, request.hostId)) {
        return { filed: false }
      }
      if (request.record.kind === CRM_PERSON_KINDS.lead) {
        await ref.update({
          [containerMembershipField(request.containerKind)]: FieldValue.arrayUnion(...ids),
          updatedAt: FieldValue.serverTimestamp(),
        })
        await restampCrmListFieldsAt(ref, 'leads')
        return { filed: true }
      }
      const groupId = await deps.groupIdForHost(request.hostId)
      await ref.update({
        [contactContainerFieldPath(groupId, request.containerKind)]: FieldValue.arrayUnion(...ids),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { filed: true }
    },

    recordRefund: (request) => recordPersonRefund(request),
  }
}

/** The service as the CRM registers it, its storage the admin app's. */
export const crmPersonRecords: PluginPersonRecords = {
  find: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).find(request),
  read: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).read(request),
  fileUnder: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).fileUnder!(request),
  recordRefund: (request) => recordPersonRefund(request),
}
