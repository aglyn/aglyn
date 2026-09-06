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
  canManageOrg,
  CONTACT_ERASURE_REQUESTED_FIELD,
  normalizeContactEmail,
  PERSON_ERASURES_COLLECTION,
  personErasureConfirmationMatches,
  personErasureId,
  type PersonErasureRequest,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  firebaseAdmin,
  getOrgForHost,
  logHostActivity,
  orgDataCollectionForHost,
  suppressEmailForHostErasure,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { FieldValue } from 'firebase-admin/firestore'

/** The route key, as `registerCrmConsoleApi` registers it. */
export const CRM_ERASE_PERSON_ROUTE = 'crm/erase-person'

export interface ErasePersonRequestBody {
  hostId: string
  /** Exactly one of these names the record the request is filed from. */
  contactId?: string
  leadId?: string
  /** The address as the admin typed it — the confirmation. */
  email: string
}

export interface ErasePersonResponse {
  ok: true
  requestId: string
  /** When the request entered the queue. */
  pendingSinceMs: number
  /** True when a request for this person was already waiting; nothing was re-filed. */
  alreadyPending: boolean
}

/**
 * `POST /api/crm/erase-person` — file a privacy erasure for one person
 * (AGL-2623).
 *
 * ## Who may
 *
 * A workspace admin or owner — `canManageOrg` on the caller's org role —
 * and nobody else. Not a site editor with the data permission, who can
 * detach a contact from their own site but has no standing to remove the
 * person from every site in the workspace; and not staff acting alone,
 * because the workspace is the controller of this data and the instruction
 * has to come from it. Staff who are also admins of the workspace pass on
 * that role, as anyone would.
 *
 * ## What it does, and what it does not
 *
 * It files the request and closes the doors; it deletes nothing. The daily
 * erasure job executes the sweep, so that a workspace's person erasures and
 * its own erasure run through one job, one audit trail and one queue a
 * staff member can watch. What happens here, in order:
 *
 *   1. The record named by the body is read and its address is what the
 *      request is about — the body's address must match it, typed, so an
 *      admin who opened the wrong record is stopped by the confirmation
 *      rather than by luck.
 *   2. The request document is written, or found already pending, in
 *      which case nothing is re-filed and the caller is told so.
 *   3. Every site of the workspace gets its suppression row NOW, not when
 *      the job runs: from this moment a capture cannot rebuild the person.
 *   4. The contact document and each site's lead are stamped with the
 *      request time, so their pages can say "erasure pending" off the
 *      document they already read.
 *   5. The site's activity feed and the platform audit log each get a row
 *      that names the record by id and the person by hash, never by
 *      address.
 */
export const crmErasePersonHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }
  const body: Partial<ErasePersonRequestBody> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '').trim()
  const contactId = String(body.contactId ?? '').trim()
  const leadId = String(body.leadId ?? '').trim()
  if (!hostId || (!contactId && !leadId) || (contactId && leadId)) {
    res.status(400).json({ error: 'Name the site and exactly one contact or lead' })
    return
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!canManageOrg(membership.role)) {
      res.status(403).json({
        error: 'Only a workspace admin can erase a person from the workspace',
      })
      return
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved || resolved.orgId !== membership.orgId) {
      res.status(404).json({ error: 'Unknown site' })
      return
    }
    const { orgId } = resolved
    const firestore = firebaseAdmin.app().firestore()

    let recordEmail: string | null = null
    if (contactId) {
      const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
      const contact = await contactsRef.doc(contactId).get()
      if (!contact.exists) {
        res.status(404).json({ error: 'Unknown contact' })
        return
      }
      recordEmail = normalizeContactEmail(contact.get('email'))
    } else {
      const lead = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('leads')
        .doc(leadId)
        .get()
      if (!lead.exists) {
        res.status(404).json({ error: 'Unknown lead' })
        return
      }
      recordEmail = normalizeContactEmail(lead.get('email'))
    }
    const key = recordEmail ? personKey(recordEmail) : null
    if (!recordEmail || !key) {
      res.status(422).json({ error: 'This record has no usable email address to erase by' })
      return
    }
    if (!personErasureConfirmationMatches(body.email, recordEmail)) {
      res.status(400).json({
        error: 'Type the record’s email address exactly to confirm the erasure',
      })
      return
    }

    const requestId = personErasureId(orgId, key)
    const requestRef = firestore.collection(PERSON_ERASURES_COLLECTION).doc(requestId)
    const existing = await requestRef.get()
    if (existing.exists && existing.get('status') === 'pending') {
      const answer: ErasePersonResponse = {
        ok: true,
        requestId,
        pendingSinceMs: Number(existing.get('pendingSinceMs') ?? 0),
        alreadyPending: true,
      }
      res.status(200).json(answer)
      return
    }

    const now = Date.now()
    const request: PersonErasureRequest = {
      orgId,
      personKey: key,
      status: 'pending',
      email: recordEmail,
      requestedAtMs: now,
      requestedByUid: decoded.uid,
      hostId,
      ...(contactId ? { contactId } : {}),
      ...(leadId ? { leadId } : {}),
      pendingSinceMs: now,
    }
    await requestRef.set(
      {
        ...request,
        // A request re-filed after a failed or completed run starts clean.
        erasedAtMs: FieldValue.delete(),
        result: FieldValue.delete(),
        failedAtMs: FieldValue.delete(),
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).get()
    const hostIds: string[] = hosts.docs.map((doc: { id: string }) => String(doc.id))
    for (const siteId of hostIds) {
      await suppressEmailForHostErasure({ hostId: siteId, email: recordEmail }).catch(
        (error: unknown) => {
          console.error('[crm] erase-person suppression write failed', siteId, error)
        },
      )
      const lead = firestore.collection('hosts').doc(siteId).collection('leads').doc(key)
      await lead
        .get()
        .then((snapshot: { exists: boolean }) =>
          snapshot.exists ? lead.update({ [CONTACT_ERASURE_REQUESTED_FIELD]: now }) : undefined,
        )
        .catch((error: unknown) => {
          console.error('[crm] erase-person lead marker failed', siteId, error)
        })
    }
    try {
      const contacts = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection('contacts')
        .where('email', '==', recordEmail)
        .get()
      for (const contact of contacts.docs) {
        await contact.ref.update({ [CONTACT_ERASURE_REQUESTED_FIELD]: now })
      }
    } catch (error) {
      console.error('[crm] erase-person contact marker failed', orgId, error)
    }

    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ?? null },
      'Requested privacy erasure',
      { type: contactId ? 'contact' : 'lead', id: contactId || leadId },
    ).catch(() => undefined)
    await firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'person.erasure-requested',
        target: `orgs/${orgId}/people/${key}`,
        before: null,
        after: { hostId, hosts: hostIds.length, from: contactId ? 'contact' : 'lead' },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    const answer: ErasePersonResponse = {
      ok: true,
      requestId,
      pendingSinceMs: now,
      alreadyPending: false,
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] erase-person failed', hostId, error)
    res.status(500).json({ error: 'The erasure could not be filed' })
  }
}
