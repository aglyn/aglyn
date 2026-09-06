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

/**
 * `POST /api/crm/contacts-merge` — two records for one person become one
 * (AGL-2625).
 *
 * Body: `{ hostId, survivorId, mergedId }`. The survivor keeps its address
 * as the identity; the merged record's address becomes an alternate on it,
 * every deal, task, activity and lead naming the merged record is repointed,
 * and the merged document is deleted. `mergeContacts` in the data library
 * is the whole of the work, so the REST door performs the same merge.
 *
 * ## Who may call it
 *
 * An ORG-WIDE member holding `data.manage`. Narrower than the other CRM
 * routes, which admit a site-scoped member for the site they reach, and
 * deliberately: a merge is org-scoped by nature. Contacts are org documents
 * shared by every site that captured the person, and folding two of them
 * together touches every holder's facet, every site's consent entry and
 * every deal in the org that named the merged record — a decision about
 * records a site-scoped member cannot read, made on their behalf. The
 * console offers the action to org-wide members only, and this is the door
 * that makes that a rule rather than a hint.
 *
 * ## Why a server route
 *
 * A browser could write the survivor and delete the merged record under the
 * rules, and could not do the rest: a scoped `array-contains-any` listener
 * cannot repoint deals it may not list, the address index is closed to
 * clients, and the transaction over both documents is what keeps two merges
 * of one pair from both succeeding.
 */

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost, mergeContacts } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

export const CONTACTS_MERGE_ROUTE = 'crm/contacts-merge'

/** The body the console's merge dialog posts. */
export interface ContactsMergeRequest {
  hostId: string
  /** `orgs/{orgId}/contacts/{id}` — the record that stays. */
  survivorId: string
  /** The record folded into it and deleted. */
  mergedId: string
}

/** What the route answers on success. */
export interface ContactsMergeResponse {
  ok: true
  survivorId: string
  survivorEmail: string
  mergedId: string
  mergedEmail: string
  /** Every address the survivor answers to now, primary first. */
  emails: string[]
  repointed: { deals: number; tasks: number; activities: number; leads: number }
}

function typed(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

export const contactsMergeHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body: Partial<ContactsMergeRequest> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = typed(body.hostId, 128)
  const survivorId = typed(body.survivorId, 200)
  const mergedId = typed(body.mergedId, 200)
  if (!hostId || !survivorId || !mergedId) {
    res.status(400).json({ error: 'Missing hostId, survivorId or mergedId' })
    return
  }
  if (survivorId === mergedId) {
    res.status(400).json({ error: 'Pick two different contacts to merge' })
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

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const staff = decoded['staff'] === true
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (
      !staff &&
      !(membership.orgWide && membership.permissions['data.manage'] === true)
    ) {
      res.status(403).json({
        error:
          'Merging contacts requires the data permission across the whole workspace',
      })
      return
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      res.status(404).json({ error: 'Unknown site' })
      return
    }
    const firestore = firebaseAdmin.app().firestore()
    const result = await mergeContacts({
      firestore,
      orgRef: firestore.collection('orgs').doc(resolved.orgId),
      survivorId,
      mergedId,
      actor: { uid: decoded.uid, email: decoded.email ?? null },
      hostId,
      actorName: typeof decoded['name'] === 'string' ? decoded['name'] : null,
    })
    if (result.ok === false) {
      if (result.reason === 'same-record') {
        res.status(400).json({ error: 'Pick two different contacts to merge' })
        return
      }
      res.status(404).json({
        error:
          result.reason === 'survivor-missing'
            ? 'The contact to keep could not be found'
            : 'The contact to merge could not be found — it may already have been merged',
      })
      return
    }
    const answer: ContactsMergeResponse = {
      ok: true,
      survivorId: result.survivorId,
      survivorEmail: result.survivorEmail,
      mergedId: result.mergedId,
      mergedEmail: result.mergedEmail,
      emails: result.emails,
      repointed: result.repointed,
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] contacts-merge failed', hostId, survivorId, mergedId, error)
    res.status(500).json({ error: 'The contacts could not be merged.' })
  }
}

export default contactsMergeHandler
