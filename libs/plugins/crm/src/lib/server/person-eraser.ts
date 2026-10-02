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

import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { runPluginEventHandlers } from '@aglyn/aglyn/plugin-manager/plugin-events'
import type {
  PluginPersonErasureReport,
  PluginPersonErasureRequest,
  PluginPersonErasureTarget,
  PluginPersonRecordsEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { companyContactsCountFields } from '@aglyn/tenant-data-admin/server/contact-company-link'
import { deleteWhereEquals, updateWhereEquals } from '@aglyn/tenant-data-admin/server/paged-sweeps'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * THE CRM'S SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080): the records
 * eraser of the plugin that keeps people.
 *
 * `locate` names the person's contacts — every contact document whose address
 * is theirs — before anything is erased, so every other plugin can find what
 * it keeps by them. `erase` runs after every other eraser:
 *
 *  1. each contact and its satellites — each linked company's contact count
 *     moved down once, deals unlinked (a deal is the team's own pipeline
 *     record and stays), tasks and activities deleted — then the contact
 *     document itself, WHOLE. Not the CRM's delete, which is a detach that
 *     leaves the row for the other holders: every site's facet, every consent
 *     entry and every attribution goes with it;
 *  2. the person's lead: the organization's row (AGL-3275), and every legacy
 *     per-site row still standing on a site of this workspace — and no other
 *     workspace's;
 *  3. once those rows are gone, `host.records.removed` names them, so a plugin
 *     keeping a figure over leads — a form counting the people it filed —
 *     drops by this person and by nothing else (AGL-3330).
 *
 * Each step is best-effort against the others: a failure is logged and counted
 * as zero, and the report says what happened. A DRY RUN counts the contacts
 * and the lead rows and writes nothing.
 */

type Firestore = FirebaseFirestore.Firestore

export interface CrmPersonEraserDeps {
  firestore(): Firestore
}

/** The label every log line of this eraser carries — never the address. */
const LABEL = 'crm person eraser'

async function contactsOf(
  firestore: Firestore,
  target: PluginPersonErasureTarget,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const contacts = firestore.collection('orgs').doc(target.orgId).collection('contacts')
  return (await contacts.where('email', '==', target.email).get()).docs
}

export function createCrmPersonEraser(deps: CrmPersonEraserDeps): PluginPersonRecordsEraser {
  async function locate(target: PluginPersonErasureTarget): Promise<readonly string[]> {
    return (await contactsOf(deps.firestore(), target)).map((contact) => String(contact.id))
  }

  async function erase(request: PluginPersonErasureRequest): Promise<PluginPersonErasureReport> {
    const db = deps.firestore()
    const orgRef = db.collection('orgs').doc(request.orgId)
    const report = {
      contacts: 0,
      companyLinks: 0,
      deals: 0,
      tasks: 0,
      activities: 0,
      leads: 0,
    }
    const wanted = new Set(request.contactIds)
    // The contacts `locate` named, read again: a dry run counts them, and a
    // contact deleted since is simply not there to erase.
    const contacts = (await contactsOf(db, request)).filter((contact) => wanted.has(contact.id))
    const hostIds = (await db.collection('hosts').where('orgId', '==', request.orgId).get()).docs.map(
      (doc) => String(doc.id),
    )

    if (request.dryRun) {
      let leads = (await orgRef.collection('leads').doc(request.key).get()).exists ? 1 : 0
      for (const hostId of hostIds) {
        const lead = await db.collection('hosts').doc(hostId).collection('leads').doc(request.key).get()
        if (lead.exists) leads += 1
      }
      return { ...report, contacts: contacts.length, leads }
    }

    for (const contact of contacts) {
      const contactId = String(contact.id)
      const companyIds: unknown = contact.get('companyIds')
      const linked = Array.isArray(companyIds)
        ? companyIds.filter((id): id is string => typeof id === 'string' && !!id)
        : []
      for (const companyId of new Set(linked)) {
        try {
          await orgRef
            .collection(CRM_COLLECTIONS.companies)
            .doc(companyId)
            .update(companyContactsCountFields(-1))
          report.companyLinks += 1
        } catch (error) {
          console.error(`${LABEL}: company count could not move for ${companyId}`, error)
        }
      }
      report.deals += await updateWhereEquals(
        db,
        orgRef.collection(CRM_COLLECTIONS.deals),
        'contactId',
        contactId,
        { contactId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
        LABEL,
      )
      report.tasks += await deleteWhereEquals(db, orgRef.collection(CRM_COLLECTIONS.tasks), 'contactId', contactId, LABEL)
      report.activities += await deleteWhereEquals(
        db,
        orgRef.collection(CRM_COLLECTIONS.activities),
        'contactId',
        contactId,
        LABEL,
      )
      try {
        await contact.ref.delete()
        report.contacts += 1
      } catch (error) {
        console.error(`${LABEL}: contact delete failed for ${contactId}`, error)
      }
    }

    /*
     * THE ORG ROW, ONCE (AGL-3275) — and then every legacy row still standing.
     * A lead is one document for the whole org now, but until every site is
     * folded a person can still be held at `hosts/{hostId}/leads`, and an
     * erasure that deleted only the org row would leave that copy behind. So
     * both are swept, and `leads` is what was actually destroyed rather than
     * how many places were looked at.
     */
    const erasedLeads: Array<{ id: string; data: Record<string, unknown> }> = []
    try {
      const orgLead = orgRef.collection('leads').doc(request.key)
      const snapshot = await orgLead.get()
      if (snapshot.exists) {
        erasedLeads.push({ id: request.key, data: snapshot.data() ?? {} })
        await orgLead.delete()
        report.leads += 1
      }
    } catch (error) {
      console.error(`${LABEL}: org lead delete failed`, error)
    }
    for (const hostId of hostIds) {
      try {
        const lead = db.collection('hosts').doc(hostId).collection('leads').doc(request.key)
        const snapshot = await lead.get()
        if (snapshot.exists) {
          erasedLeads.push({ id: request.key, data: snapshot.data() ?? {} })
          await lead.delete()
          report.leads += 1
        }
      } catch (error) {
        console.error(`${LABEL}: legacy lead delete failed for ${hostId}`, error)
      }
    }
    if (erasedLeads.length) {
      // Isolated per plugin by the seam, and never the erasure's failure.
      await runPluginEventHandlers('host.records.removed', {
        orgId: request.orgId,
        hostIds,
        collection: 'leads',
        records: erasedLeads,
      }).catch((error) => console.error(`${LABEL}: records-removed event failed`, error))
    }
    return report
  }

  return { locate, erase }
}

/** The records eraser over the platform's own Firestore, as the declarations register it. */
export function crmPersonEraser(): PluginPersonRecordsEraser {
  return createCrmPersonEraser({ firestore: () => firebaseAdmin.app().firestore() })
}
