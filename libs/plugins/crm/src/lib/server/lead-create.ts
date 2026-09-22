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
 * `POST /api/crm/leads-create` — a lead typed in by hand (AGL-3231).
 *
 * Salesforce's New Lead: a person the team has heard of and has not yet
 * qualified, entered with what is known about them — the address, the
 * name, the company as text, a title, a phone, a website, an address, tags,
 * where they came from — and nothing else brought into being. No contact,
 * no company record: those are the conversion's to make, once the lead is
 * real. Until then the lead is the whole record, which is what lets the
 * Leads section be worked without a second row for every person in it.
 *
 * ## Through the one door
 *
 * `addHostLead` is the single writer of `hosts/{hostId}/leads` — the
 * capture doors, the import and the REST create all reach it — and it is
 * the writer here. That is what keys the lead on the person, so a second
 * "new lead" for one address updates the first rather than filing twice;
 * counts it against the platform ceiling inside the transaction that
 * writes; and records NO marketing basis, because a person typed in by the
 * team is not a person who ticked a box. The profile and the working state
 * are the CRM's own annotations and land in one merge write after the
 * door's, exactly as the import writes them.
 *
 * ## Who may call it
 *
 * The same two gates the convert route asks: `data.manage` in the org, and
 * a role on THIS site — a lead is the site's record, so an org member scoped
 * to a sibling site holds the key but not the host. Then the CRM suite gate,
 * because a lead entered by hand is suite work: the capture doors that fill
 * a Free workspace's leads do not come through here.
 */

import {
  checkVisitorRecordCeiling,
  type CrmLeadProfilePatch,
  type CrmLeadStatus,
  LEADS_MAX_PER_HOST,
  normalizeContactEmail,
  normalizeCrmLeadProfile,
  personKey,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  addHostLead,
  firebaseAdmin,
  getOrgForHost,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { FieldValue } from 'firebase-admin/firestore'
import { holdsDataManage } from './org-caller'
import { crmSuiteRefusal } from './suite-gate'

/** The statuses a lead may be entered in — everything but the converted state. */
const CREATE_STATUSES: readonly CrmLeadStatus[] = ['new', 'working']

const NAME_MAX = 120
const NOTES_MAX = 4000

/** The surface a hand-entered lead names, beside `signup`, `booking`, `form:{id}` and `import`. */
export const LEAD_MANUAL_SOURCE = 'manual'

/** What the New lead drawer posts. */
export interface LeadCreateRequest {
  hostId: string
  email: string
  name?: string
  company?: string
  jobTitle?: string
  phone?: string
  website?: string
  address?: Record<string, unknown> | null
  tags?: string[]
  leadSource?: string
  status?: CrmLeadStatus
  ownerUid?: string
  notes?: string
}

/** What the route answers on success. */
export interface LeadCreateResponse {
  leadId: string
  /** False when the site already held a lead for the address — it was updated. */
  created: boolean
}

/** The lead's own fields as one write, `null` in the patch meaning a clear. */
export function leadProfileWrite(patch: CrmLeadProfilePatch): Record<string, unknown> {
  const write: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    write[key] = value === null ? FieldValue.delete() : value
  }
  return write
}

export const leadCreateHandler: PluginApiHandler = async (req, res) => {
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
  const body: Partial<LeadCreateRequest> & Record<string, unknown> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
    .trim()
    .slice(0, 128)
  if (!hostId) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const email = normalizeContactEmail(body.email)
  if (!email) {
    res.status(400).json({ error: 'Enter a valid email address.' })
    return
  }
  /*
   * The profile, refused BEFORE any read: a phone or a website the record
   * cannot hold is answered under its field, the sentence the drawer shows
   * beneath the input, and nothing was written to retry against.
   */
  const { patch, errors } = normalizeCrmLeadProfile(body)
  const [firstError] = Object.entries(errors)
  if (firstError) {
    res.status(400).json({ error: firstError[1], field: firstError[0] })
    return
  }
  const rawStatus = String(body.status ?? '').trim()
  if (rawStatus && !CREATE_STATUSES.includes(rawStatus as CrmLeadStatus)) {
    res.status(400).json({ error: 'A new lead is New or Working.' })
    return
  }
  const name = String(body.name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX)
  const ownerUid = String(body.ownerUid ?? '')
    .trim()
    .slice(0, 128)
  const notes = String(body.notes ?? '')
    .trim()
    .slice(0, NOTES_MAX)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const staff = decoded['staff'] === true
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (
      !staff &&
      !(membership.hostRole && (await holdsDataManage(membership.orgId, decoded.uid)))
    ) {
      res
        .status(403)
        .json({ error: 'Adding a lead requires the data permission on this site' })
      return
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      res.status(404).json({ error: 'Unknown site' })
      return
    }
    const suite = crmSuiteRefusal(resolved.org, 'Adding a lead by hand')
    if (suite) {
      res.status(suite.status).json(suite.body)
      return
    }

    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const leadsRef = hostRef.collection('leads')
    // Non-null by construction: the normalizer refused every address this
    // derivation could not key.
    const leadId = personKey(email) as string
    const before = await leadsRef.doc(leadId).get()
    const created = !before.exists
    /*
     * The platform ceiling, judged here so the drawer can say WHY rather
     * than only that the lead could not be saved; the door re-judges it
     * inside its own transaction, so a race is still refused there.
     */
    if (created) {
      const used = (await leadsRef.count().get()).data().count
      if (checkVisitorRecordCeiling(used, LEADS_MAX_PER_HOST).exceeded) {
        res.status(409).json({
          error:
            'This site is at the platform lead limit, so the lead was not ' +
            'added. Remove some leads, or contact support if this is real ' +
            'traffic.',
          reason: 'lead-ceiling',
        })
        return
      }
    }
    const stored = await addHostLead({
      hostRef,
      hostId,
      lead: {
        email,
        ...(name ? { name } : {}),
        source: LEAD_MANUAL_SOURCE,
      },
    })
    if (!stored) {
      res.status(500).json({ error: 'The lead could not be saved.' })
      return
    }
    const working: Record<string, unknown> = {
      ...leadProfileWrite(patch),
      ...(rawStatus ? { status: rawStatus } : {}),
      ...(ownerUid ? { ownerUid } : {}),
      ...(notes ? { notes } : {}),
    }
    if (Object.keys(working).length) {
      await leadsRef
        .doc(leadId)
        .set({ ...working, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    /*
     * The audit line, written by the route that verified the caller and
     * performed the write — the one writer that cannot record an add that
     * did not happen. An update of a lead the site already held says so.
     */
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ?? null },
      created ? 'Added lead' : 'Updated lead',
      { type: 'lead', id: leadId, name: name || email },
    )
    const answer: LeadCreateResponse = { leadId, created }
    res.status(created ? 201 : 200).json(answer)
  } catch (error) {
    console.error('leads-create failed', error)
    res.status(500).json({ error: 'The lead could not be saved.' })
  }
}

export default leadCreateHandler
