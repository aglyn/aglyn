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
  consentGroupForHost,
  CONTACT_FACETS_FIELD,
  CRM_COLLECTIONS,
  CRM_LEAD_SOURCE_PICKLIST,
  type CrmPicklist,
  effectiveCrmLeadSourcePicklist,
  newResourceScopeFields,
  normalizeCrmPicklist,
  ORG_SCOPE_TOKEN,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import {
  deletePicklistValue,
  type LeadSourceValuesResponse,
  type PicklistMove,
  renamePicklistValue,
} from '../model/lead-source-values'
import { orgHostIds, readCrmRouteScope } from './org-caller'
import { authorizeCrmWriter } from './task-routes'

/** What the suite gate names when a plan without the CRM asks. */
const SUITE_ACT = "Editing the organization's lead sources"

/** Writes per batch — under Firestore's 500, with room to spare. */
const BATCH_SIZE = 400

/**
 * Set `field` to `to` (or remove it, for `null`) on every document `query`
 * finds holding `from`, a batch at a time. Answers how many were written.
 *
 * The query is re-run after each batch rather than paged, because each
 * batch moves its documents OUT of the query's answer — the next run finds
 * only what is left, and a run that finds nothing is the end.
 */
async function replaceEverywhere(
  firestore: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
  field: string | FirebaseFirestore.FieldPath,
  to: string | null,
): Promise<number> {
  let written = 0
  for (;;) {
    const page = await query.limit(BATCH_SIZE).get()
    if (page.empty) return written
    const batch = firestore.batch()
    for (const snapshot of page.docs) {
      batch.update(snapshot.ref, field, to ?? FieldValue.delete(), 'updatedAt', FieldValue.serverTimestamp())
    }
    await batch.commit()
    written += page.size
    if (page.size < BATCH_SIZE) return written
  }
}

/**
 * `POST crm/lead-source-values` — rename a lead source value, or delete one
 * and move its records to another (AGL-3298).
 *
 * Body: `{ hostId | orgId, action: 'rename', valueId, label }` or
 * `{ hostId | orgId, action: 'delete', valueId, replaceWith: label | null }`.
 *
 * Records store the value's LABEL (see the picklist block in `crm.ts`), so
 * both moves change records as well as the list: every lead and every
 * contact holding the old label is rewritten to the new one — or, for a
 * delete with no replacement, cleared. That is Salesforce's Replace, done
 * as part of the move, so a report grouped by lead source follows a rename
 * instead of splitting into the old name and the new.
 *
 * ## The list first, then the records
 *
 * The list is written in a transaction before any record: from that moment
 * no picker offers the old label and no import or API write accepts it, so
 * the sweep that follows cannot be outrun by a new record taking the name
 * it is removing. A sweep interrupted part-way leaves records holding a
 * label the list no longer has, which they show as "(not in the list)"; the
 * same request sent again finishes it, because the rename of a value to its
 * own current label is a no-op on the list and still sweeps.
 *
 * ## Who may
 *
 * Whoever may write the CRM — `authorizeCrmWriter`, the question every CRM
 * route asks — which is who the rules let edit the list itself. The sweep
 * reaches every lead and contact in the org whatever the caller's scope:
 * it changes one label to another that the same caller could already have
 * picked, and reveals nothing about the records but their count.
 */
export const crmLeadSourceValuesHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const action = body['action']
  const valueId = String(body['valueId'] ?? '').trim().slice(0, 64)
  if ((action !== 'rename' && action !== 'delete') || !valueId) {
    res.status(400).json({ error: 'Name a value, and whether to rename or delete it.' })
    return
  }
  const replaceWith =
    body['replaceWith'] === null || body['replaceWith'] === undefined
      ? null
      : String(body['replaceWith'])

  try {
    const writer = await authorizeCrmWriter(req, scope, { suiteAct: SUITE_ACT })
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(writer.orgId)
    const listRef = orgRef.collection(CRM_COLLECTIONS.picklists).doc(CRM_LEAD_SOURCE_PICKLIST)

    /*
     * THE LIST. Read and written in one transaction, so two admins editing
     * at once cannot each write a list missing the other's change.
     */
    const moved = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(listRef)
      const before: CrmPicklist = effectiveCrmLeadSourcePicklist(snapshot.data())
      const value = before.values.find((entry) => entry.id === valueId)
      if (!value) return { ok: false as const, error: 'That value is no longer in the list.' }
      const move: PicklistMove =
        action === 'rename'
          ? renamePicklistValue(before, valueId, String(body['label'] ?? ''))
          : deletePicklistValue(before, valueId, replaceWith)
      if (move.ok === false) return move
      const created = normalizeCrmPicklist(snapshot.data()) === null
      transaction.set(
        listRef,
        {
          values: move.picklist.values,
          defaultValueId: move.picklist.defaultValueId,
          updatedAt: FieldValue.serverTimestamp(),
          // The stamp every org-wide CRM document carries (see the Fields
          // page), written when this move is what creates the document.
          ...(created
            ? {
                hostId: scope.hostId || null,
                createdAt: FieldValue.serverTimestamp(),
                ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
              }
            : {}),
        },
        { merge: true },
      )
      const to =
        action === 'rename'
          ? (move.picklist.values.find((entry) => entry.id === valueId)?.label ?? null)
          : replaceWith === null
            ? null
            : (move.picklist.values.find(
                (entry) => entry.label.toLowerCase() === replaceWith.trim().toLowerCase(),
              )?.label ?? null)
      return { ok: true as const, from: value.label, to }
    })
    if (moved.ok === false) {
      res.status(400).json({ error: moved.error })
      return
    }

    /*
     * THE RECORDS. Leads by the field itself; contacts by each holder's
     * facet, one query per consent group the org's sites belong to — a
     * contact's lead source is the holder's own, like the rest of its
     * profile. A rename to the same label moves nothing, and says so.
     */
    let leads = 0
    let contacts = 0
    if (moved.from !== moved.to) {
      leads = await replaceEverywhere(
        firestore,
        orgRef.collection('leads').where('leadSource', '==', moved.from),
        'leadSource',
        moved.to,
      )
      const hostIds = await orgHostIds(firestore, writer.orgId)
      const groupIds = [
        ...new Set(hostIds.map((hostId) => consentGroupForHost(writer.org, hostId).groupId)),
      ].filter(Boolean)
      for (const groupId of groupIds) {
        const path = new FieldPath(CONTACT_FACETS_FIELD, groupId, 'leadSource')
        contacts += await replaceEverywhere(
          firestore,
          orgRef.collection('contacts').where(path, '==', moved.from),
          path,
          moved.to,
        )
      }
    }
    const answer: LeadSourceValuesResponse = { ok: true, leads, contacts }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] lead-source-values failed', error)
    res.status(500).json({ error: 'The lead sources could not be saved.' })
  }
}
