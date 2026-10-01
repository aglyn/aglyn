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
} from '@aglyn/aglyn/app-utils/container-membership'
import { listPluginContainerKinds } from '@aglyn/aglyn/plugin-manager/plugin-containers'
import type {
  PluginMembershipDetacher,
  PluginMembershipDetachReport,
} from '@aglyn/aglyn/plugin-manager/plugin-membership-detach'
import { restampCrmListFieldsOf } from '@aglyn/tenant-data-admin/server/crm-records'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { consentGroupForSite } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * THE CRM'S SHARE OF TAKING A CONTAINER AWAY (AGL-3080).
 *
 * A lead is filed under a container by the container's id in its own
 * `<kind>Ids`, at the top of its document: on the organization
 * (`orgs/{orgId}/leads`), and on the site for the rows the lead migration has
 * not reached (`hosts/{hostId}/leads`). A contact is shared by every site of
 * the organization, so what one merchant filed a person under lives in that
 * merchant's facet, and the field PATH names the site's consent group.
 *
 * The plugin that keeps a container cannot name either, so when it removes
 * one it asks every plugin's membership detacher, once per site, with the
 * container's id and its membership field. This clears the CRM's records
 * with the walk the owner makes over its own: `array-contains` on the
 * automatic single-field index, `arrayRemove` of the one id, in pages under
 * the batch limit, bounded per request and reporting `remaining` so the
 * removal holds the container for a second run. A lead's list fields are
 * restamped as it now stands, because the Leads list's container filter
 * reads them. The records themselves stay.
 *
 * Asked once per site, the organization's leads are walked on every call:
 * after the first finds them, each later walk is one query that answers
 * nothing. Two sites in one consent group share a facet the same way.
 *
 * Any declared container kind: the membership field names its kind
 * (`<kind>Ids`), and a field no declared kind owns is not one a CRM record
 * carries, so it is answered with nothing detached.
 */

/** Members detached in one write, under the 500-operation batch limit. */
const DETACH_BATCH = 400

/** How many pages one request walks per collection. */
const DETACH_PASSES = 25

export interface CrmContainerDetachDeps {
  firestore(): FirebaseFirestore.Firestore
  /** The site's consent group: whose facet on a shared contact is the site's. */
  consentGroupId(hostId: string): Promise<string>
  /** Restamps the list fields of leads just written, as each now stands. */
  restampLeads(refs: readonly FirebaseFirestore.DocumentReference[]): Promise<unknown>
}

async function detachFrom(
  collection: FirebaseFirestore.CollectionReference,
  fieldPath: string,
  id: string,
  afterWrite?: (refs: FirebaseFirestore.DocumentReference[]) => Promise<unknown>,
): Promise<PluginMembershipDetachReport> {
  const firestore = collection.firestore
  let detached = 0
  for (let pass = 0; pass < DETACH_PASSES; pass += 1) {
    const page = await collection.where(fieldPath, 'array-contains', id).limit(DETACH_BATCH).get()
    if (page.empty) return { detached, remaining: false }
    const batch = firestore.batch()
    for (const member of page.docs) {
      batch.update(member.ref, { [fieldPath]: FieldValue.arrayRemove(id) })
    }
    await batch.commit()
    await afterWrite?.(page.docs.map((member) => member.ref))
    detached += page.size
    if (page.size < DETACH_BATCH) return { detached, remaining: false }
  }
  return { detached, remaining: true }
}

/** The detacher, on the dependencies it is handed. */
export function createCrmContainerDetacher(deps: CrmContainerDetachDeps): PluginMembershipDetacher {
  return async ({ hostId, orgId, field, id }) => {
    const kind = listPluginContainerKinds().find(
      (declared) => containerMembershipField(declared.kind) === field,
    )?.kind
    if (!kind || !id) return { detached: 0, remaining: false }
    const firestore = deps.firestore()
    const passes: PluginMembershipDetachReport[] = []
    if (hostId) {
      passes.push(
        await detachFrom(
          firestore.collection('hosts').doc(hostId).collection('leads'),
          field,
          id,
          deps.restampLeads,
        ),
      )
    }
    if (orgId) {
      const org = firestore.collection('orgs').doc(orgId)
      passes.push(await detachFrom(org.collection('leads'), field, id, deps.restampLeads))
      if (hostId) {
        const groupId = await deps.consentGroupId(hostId)
        passes.push(
          await detachFrom(org.collection('contacts'), contactContainerFieldPath(groupId, kind), id),
        )
      }
    }
    return {
      detached: passes.reduce((sum, pass) => sum + pass.detached, 0),
      remaining: passes.some((pass) => pass.remaining),
    }
  }
}

/**
 * The detacher on the platform's Firestore, as the console registers it —
 * this module is imported with the first removal, not at boot.
 */
export const crmContainerDetacher: PluginMembershipDetacher = createCrmContainerDetacher({
  firestore: () => firebaseAdmin.app().firestore(),
  consentGroupId: async (hostId) => (await consentGroupForSite(hostId)).groupId,
  restampLeads: (refs) => restampCrmListFieldsOf(refs, 'leads'),
})
