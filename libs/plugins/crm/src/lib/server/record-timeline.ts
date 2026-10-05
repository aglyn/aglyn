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
  registerPluginRecordTimelineWriter,
  type PluginRecordActivityRequest,
  type PluginRecordDeliveryRequest,
  type PluginRecordEntryContext,
  type PluginRecordTaskRequest,
  type PluginRecordTimelineWriter,
  type PluginRecordWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import {
  checkEntitlement,
  consentGroupForHost,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_COLLECTIONS,
  crmActivityLogHasRoom,
  crmScopeTokens,
  crmTaskLabelsForNew,
  crmTaskListFields,
  crmTaskReminderAfterEdit,
  isCrmActivityKind,
  isCrmTaskKind,
  readContactFacet,
  visibleToHost,
  type CrmActivity,
  type CrmActivityLink,
  type CrmTask,
} from '@aglyn/aglyn/server'
import {
  countCrmActivitiesForRecord,
  createCrmEmailActivity,
  crmActivityRef,
  crmCapturedEmailActivityRef,
  findContactByEmail,
  firebaseAdmin,
  readLeadForHost,
  recomputeCrmNextTaskAt,
  recordCrmEmailDelivery,
} from '@aglyn/tenant-data-admin'
import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import { buildCrmCapturedEmailActivity, crmCapturedEmailKey } from '../model/crm-inbound'
import { readCrmTaskPicklists } from './read-picklist'
import { CRM_SUITE_FEATURE } from './suite-gate'

/**
 * THE CRM'S WRITER ON THE CORE'S RECORD-TIMELINE SEAM (AGL-2981).
 *
 * Another plugin files an activity or a task on a contact, company or deal —
 * an email a sequence sent, the reply it read, the call it asks for — and
 * this writes it as the CRM writes its own:
 *
 *  1. the workspace's plan carries the CRM (`features.crm`), as at every
 *     CRM door; a Free workspace keeps no records to file on;
 *  2. the entry carries the scope a record made on that site carries
 *     (`crmScopeTokens`), so exactly the people who see the record see it;
 *  3. an EMAIL is filed under the id the capture address files a copy of the
 *     same message by (`cap_` + the digest of its `Message-ID`), and written
 *     with `create()`: the send, a copy the rep forwarded to the capture
 *     address, and a second run of the caller are one row;
 *  4. anything else — a note, a task — is filed under the caller's own key,
 *     hashed with the caller's plugin id, and written once the same way;
 *  5. a record at its activity ceiling is refused with the sentence every
 *     CRM writer answers with, before anything is written;
 *  6. a bounce or a complaint on a filed email (AGL-3245) advances that
 *     email's own delivery state — the row the send was filed under, found
 *     by its `Message-ID` — exactly as the campaign webhook advances one,
 *     so the timeline reads Sent, then Bounced, with what the server said.
 *
 * Each entry names the plugin that filed it (`sourcePluginId`), and a task's
 * `nextTaskAtMs` is recomputed on the records it names, as every server
 * writer of a task does.
 *
 * ## A record found rather than named
 *
 * A caller that holds no id of the CRM's — a booking made through a link a
 * rep dropped from a record, or one taken off the widget cold (AGL-2660) —
 * hands back the record the link carried, or the booker's address, and the
 * entry is filed where the CRM finds it: the record the reference names
 * when this site may see it, otherwise the contact the address names
 * through the org's address index, narrowed to the site. A deal carries its
 * contact and company onto the entry; a contact its company, from the
 * site's own facet. A task with no assignee of the caller's goes to whoever
 * holds that record.
 */

type Firestore = FirebaseFirestore.Firestore

export interface CrmRecordTimelineDeps {
  firestore(): Firestore
}

/** gRPC `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6

/** The longest task title the CRM keeps, as its own forms do. */
const TASK_TITLE_MAX = 200
/** The longest note body or task note an entry filed here keeps. */
const NOTE_MAX = 2_000

const refuse = (status: 400 | 403 | 404 | 409, error: string): PluginRecordWrite => ({
  ok: false,
  status,
  error,
})

/** The record fields of a link, only the ones it names. */
function linkFields(link: PluginRecordEntryContext['link']): CrmActivityLink {
  return {
    ...(link?.contactId ? { contactId: String(link.contactId) } : {}),
    ...(link?.companyId ? { companyId: String(link.companyId) } : {}),
    // A lead (AGL-3234): host-scoped by path, so the entry carries the
    // site's scope like any record created from that site.
    ...(link?.leadId ? { leadId: String(link.leadId) } : {}),
  }
}

/** What a reference handed back by a caller may name: the records a booking link is dropped from. */
const FOUND_RECORD_KINDS: ReadonlySet<string> = new Set(['contact', 'lead', 'deal'])
/**
 * A record id as the CRM mints them: Firestore's for a contact and a deal, a
 * person key for a lead. A reference arrives on a public request, so one
 * that could not be an id is passed over rather than read.
 */
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** The record an entry lands on, and who holds it. */
interface FoundRecord {
  link: CrmActivityLink
  holderUid?: string
}

/** A contact's link and holder, from this site's facet on it. */
function contactRecord(
  contact: FirebaseFirestore.DocumentSnapshot,
  groupId: string,
): FoundRecord {
  const facet = readContactFacet(contact.data() ?? {}, groupId)
  return {
    link: { contactId: contact.id, ...(facet.companyId ? { companyId: facet.companyId } : {}) },
    ...(facet.ownerUid ? { holderUid: facet.ownerUid } : {}),
  }
}

/**
 * The record a caller's reference names, then the contact its address does,
 * as `hostId` may see them; `null` when neither finds one. See the module
 * comment.
 */
async function findRecord(
  orgRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  groupId: string,
  link: PluginRecordEntryContext['link'],
): Promise<FoundRecord | null> {
  const contacts = orgRef.collection('contacts')
  const kind = String(link?.record?.kind ?? '')
  const id = String(link?.record?.id ?? '')
  if (FOUND_RECORD_KINDS.has(kind) && RECORD_ID_PATTERN.test(id)) {
    if (kind === 'contact') {
      const contact = await contacts.doc(id).get()
      if (contact.exists && visibleToHost(contact.get('visibleTo'), hostId)) {
        return contactRecord(contact, groupId)
      }
    } else if (kind === 'deal') {
      const deal = await orgRef.collection(CRM_COLLECTIONS.deals).doc(id).get()
      if (deal.exists && visibleToHost(deal.get('visibleTo'), hostId)) {
        const contactId = String(deal.get('contactId') ?? '')
        const companyId = String(deal.get('companyId') ?? '')
        const ownerUid = String(deal.get('ownerUid') ?? '')
        return {
          link: { dealId: deal.id, ...(contactId ? { contactId } : {}), ...(companyId ? { companyId } : {}) },
          ...(ownerUid ? { holderUid: ownerUid } : {}),
        }
      }
    } else {
      // A lead carries its own `visibleTo` (AGL-3275), and the site has to be
      // allowed to see it, or one brand's booking would name another's lead.
      const lead = await readLeadForHost(hostId, id)
      if (lead && visibleToHost(lead.get('visibleTo'), hostId)) {
        const ownerUid = String(lead.get('ownerUid') ?? '')
        return { link: { leadId: lead.id }, ...(ownerUid ? { holderUid: ownerUid } : {}) }
      }
    }
  }
  const email = String(link?.email ?? '').trim()
  if (!email) return null
  const hit = await findContactByEmail(contacts, email, { hostId })
  return hit ? contactRecord(hit, groupId) : null
}

/** Who holds a record a caller named by id: its contact's site facet, or its lead. */
async function holderOf(
  orgRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  groupId: string,
  link: CrmActivityLink,
): Promise<string | undefined> {
  if (link.contactId) {
    const contact = await orgRef.collection('contacts').doc(link.contactId).get()
    return contact.exists ? contactRecord(contact, groupId).holderUid : undefined
  }
  if (link.leadId) {
    const lead = await readLeadForHost(hostId, link.leadId)
    return String(lead?.get('ownerUid') ?? '') || undefined
  }
  return undefined
}

/** The document id a caller's key files under: its own namespace, never a raw key. */
function keyedId(sourcePluginId: string, key: string): string {
  return `plg_${createHash('sha256').update(`${sourcePluginId}:${key}`).digest('hex').slice(0, 28)}`
}

export function createCrmRecordTimelineWriter(deps: CrmRecordTimelineDeps): PluginRecordTimelineWriter {
  /**
   * The org, its plan, the link and the scope an entry is stamped with — and,
   * when `wantHolder`, who holds the record it lands on.
   */
  async function admit(
    context: PluginRecordEntryContext,
    wantHolder = false,
  ): Promise<
    | PluginRecordWrite
    | {
        firestore: Firestore
        orgRef: FirebaseFirestore.DocumentReference
        link: CrmActivityLink
        visibleTo: string[]
        holderUid?: string
      }
  > {
    const orgId = String(context.orgId ?? '').trim()
    const hostId = String(context.hostId ?? '').trim()
    const named = linkFields(context.link)
    const isNamed = Boolean(named.contactId || named.companyId || named.leadId)
    if (!orgId || !hostId || !String(context.sourcePluginId ?? '').trim()) {
      return refuse(400, 'An entry names its organization, its site and the plugin filing it.')
    }
    if (!isNamed && !context.link?.record && !String(context.link?.email ?? '').trim()) {
      return refuse(400, 'An entry is filed on a contact, a company or a lead, or names how to find one.')
    }
    const firestore = deps.firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const snapshot = await orgRef.get()
    if (!snapshot.exists) return refuse(404, 'That organization no longer exists.')
    const org = (snapshot.data() ?? {}) as Record<string, unknown>
    if (!checkEntitlement(org, CRM_SUITE_FEATURE)) {
      return refuse(403, "This workspace's plan doesn't include the CRM.")
    }
    const group = consentGroupForHost(org, hostId)
    let link = named
    let holderUid: string | undefined
    if (isNamed) {
      if (wantHolder) holderUid = await holderOf(orgRef, hostId, group.groupId, named)
    } else {
      const found = await findRecord(orgRef, hostId, group.groupId, context.link)
      if (!found) return refuse(404, 'Nothing this site keeps matches the record or the address.')
      link = found.link
      holderUid = found.holderUid
    }
    return {
      firestore,
      orgRef,
      link,
      visibleTo: crmScopeTokens(org, group),
      ...(holderUid ? { holderUid } : {}),
    }
  }

  /** Creates a keyed entry once: `created: false` for one already filed. */
  async function createOnce(
    ref: FirebaseFirestore.DocumentReference,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await ref.create({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    } catch (error) {
      if ((error as { code?: unknown })?.code === ALREADY_EXISTS) return false
      throw error
    }
  }

  return {
    async logActivity(request: PluginRecordActivityRequest): Promise<PluginRecordWrite> {
      if (!isCrmActivityKind(request.kind)) return refuse(400, `"${String(request.kind)}" isn't an activity.`)
      const admitted = await admit(request)
      if ('ok' in admitted) return admitted
      const { firestore, orgRef, link, visibleTo } = admitted
      const orgId = orgRef.id

      let ref: FirebaseFirestore.DocumentReference
      let activity: CrmActivity
      if (request.kind === 'email') {
        const email = request.email
        const key = email ? crmCapturedEmailKey(email.messageId, null) : null
        if (!email || !key) return refuse(400, 'An email is filed by its Message-ID.')
        ref = crmCapturedEmailActivityRef(firestore, orgId, key)
        activity = buildCrmCapturedEmailActivity({
          direction: email.direction === 'inbound' ? 'inbound' : 'outbound',
          subject: email.subject,
          excerpt: request.body,
          from: email.from,
          to: email.to,
          messageId: email.messageId,
          inReplyTo: email.inReplyTo ?? null,
          atMs: request.atMs,
          byUid: String(request.byUid ?? ''),
          byName: request.byName ?? null,
          link,
          hostId: request.hostId,
          visibleTo,
        })
      } else {
        const key = String(request.dedupeKey ?? '').trim()
        if (!key) return refuse(400, 'An entry that is not an email names its own key.')
        ref = crmActivityRef(firestore, orgId, keyedId(request.sourcePluginId, key))
        const byName = String(request.byName ?? '').trim()
        activity = {
          kind: request.kind,
          body: String(request.body ?? '').slice(0, NOTE_MAX),
          atMs: request.atMs,
          byUid: String(request.byUid ?? ''),
          ...(byName ? { byName } : {}),
          ...link,
          hostId: request.hostId,
          visibleTo,
        }
      }
      // Filed before: answered off the one read, ahead of the ceiling's count.
      if ((await ref.get()).exists) return { ok: true, id: ref.id, created: false }
      if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, link))) {
        return refuse(409, CRM_ACTIVITY_LOG_FULL_MESSAGE)
      }
      const stamped = { ...activity, sourcePluginId: request.sourcePluginId }
      const created =
        request.kind === 'email'
          ? (await createCrmEmailActivity(ref, stamped)) === 'created'
          : await createOnce(ref, stamped as unknown as Record<string, unknown>)
      return { ok: true, id: ref.id, created }
    },

    async createTask(request: PluginRecordTaskRequest): Promise<PluginRecordWrite> {
      const title = String(request.title ?? '').replace(/\s+/g, ' ').trim().slice(0, TASK_TITLE_MAX)
      const key = String(request.dedupeKey ?? '').trim()
      if (!title || !key) return refuse(400, 'A task has a title and the caller’s own key.')
      if (!isCrmTaskKind(request.kind)) return refuse(400, `"${String(request.kind)}" isn't a task.`)
      if (!Number.isFinite(request.dueAtMs)) return refuse(400, 'A task has a due time.')
      const admitted = await admit(request, request.assigneeUid === null)
      if ('ok' in admitted) return admitted
      const { firestore, orgRef, link, visibleTo } = admitted
      const ref = orgRef.collection(CRM_COLLECTIONS.tasks).doc(keyedId(request.sourcePluginId, key))
      const notes = String(request.notes ?? '').trim().slice(0, NOTE_MAX)
      // `null` is "whoever holds the record", which admission read.
      const assigneeUid =
        request.assigneeUid === null
          ? (admitted.holderUid ?? '')
          : String(request.assigneeUid ?? '').trim()
      // The org's labels for the meanings it is filed with (AGL-3517).
      const labels = crmTaskLabelsForNew(await readCrmTaskPicklists(firestore, orgRef.id), {
        kind: request.kind,
        priority: 'normal',
      })
      const task: CrmTask = {
        title,
        ...(notes ? { notes } : {}),
        kind: request.kind,
        priority: 'normal',
        status: 'open',
        ...labels,
        dueAtMs: request.dueAtMs,
        // The reminder a person's task gets (AGL-2659): the due time.
        remindAtMs: crmTaskReminderAfterEdit({ dueAtMs: request.dueAtMs, previous: null }),
        ...(assigneeUid ? { assigneeUid } : {}),
        createdByUid: String(request.createdByUid ?? ''),
        sourcePluginId: request.sourcePluginId,
        ...link,
        hostId: request.hostId,
        visibleTo,
      }
      // What the Tasks list searches by (AGL-3321), beside the task.
      const created = await createOnce(ref, { ...task, ...crmTaskListFields(task) })
      if (created) {
        // The records the task names carry `nextTaskAtMs` (AGL-2661); a figure
        // that could not move is the Fields section's recompute's.
        await recomputeCrmNextTaskAt(firestore, orgRef.id, [link]).catch((error: unknown) => {
          console.error('[crm] next activity could not be recomputed', orgRef.id, error)
        })
      }
      return { ok: true, id: ref.id, created }
    },

    async recordEmailDelivery(request: PluginRecordDeliveryRequest): Promise<PluginRecordWrite> {
      const orgId = String(request.orgId ?? '').trim()
      const key = crmCapturedEmailKey(request.messageId, null)
      if (!orgId || !key) return refuse(400, 'A delivery names its organization and the email’s Message-ID.')
      if (request.state !== 'bounced' && request.state !== 'complained') {
        return refuse(400, `"${String(request.state)}" isn't a delivery failure.`)
      }
      const firestore = deps.firestore()
      const ref = crmCapturedEmailActivityRef(firestore, orgId, key)
      const outcome = await recordCrmEmailDelivery(firestore, {
        orgId,
        activityId: ref.id,
        state: request.state,
        atMs: request.atMs,
        detail: request.detail ?? null,
      })
      if (outcome === 'missing') return refuse(404, 'No email by that Message-ID is filed here.')
      if (outcome === 'failed') return refuse(409, 'The delivery state could not be written.')
      return { ok: true, id: ref.id, created: outcome === 'advanced' }
    },

    // An automation's email to the person its event is about (AGL-2615):
    // see `automation-steps.ts`, loaded with the first one.
    async prepareEmail(request) {
      const { prepareCrmRecordEmail } = await import('./automation-steps')
      return prepareCrmRecordEmail(request)
    },
  }
}

/** The platform's own dependencies. Specs build their own. */
export function defaultCrmRecordTimelineDeps(): CrmRecordTimelineDeps {
  return { firestore: () => firebaseAdmin.app().firestore() }
}

/** Registers the CRM as the workspace's record system on the timeline seam. */
export function registerCrmRecordTimelineWriter(
  deps: CrmRecordTimelineDeps = defaultCrmRecordTimelineDeps(),
): void {
  registerPluginRecordTimelineWriter(createCrmRecordTimelineWriter(deps), { pluginId: BUNDLE_ID })
}
