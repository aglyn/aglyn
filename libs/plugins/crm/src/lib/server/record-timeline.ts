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
  type PluginRecordEntryContext,
  type PluginRecordTaskRequest,
  type PluginRecordTimelineWriter,
  type PluginRecordWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import {
  buildCrmCapturedEmailActivity,
  checkEntitlement,
  consentGroupForHost,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_COLLECTIONS,
  crmActivityLogHasRoom,
  crmCapturedEmailKey,
  crmScopeTokens,
  crmTaskReminderAfterEdit,
  isCrmActivityKind,
  isCrmTaskKind,
  type CrmActivity,
  type CrmActivityLink,
  type CrmTask,
} from '@aglyn/aglyn/server'
import {
  countCrmActivitiesForRecord,
  createCrmEmailActivity,
  crmActivityRef,
  crmCapturedEmailActivityRef,
  firebaseAdmin,
  recomputeCrmNextTaskAt,
} from '@aglyn/tenant-data-admin'
import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
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
 *     CRM writer answers with, before anything is written.
 *
 * Each entry names the plugin that filed it (`sourcePluginId`), and a task's
 * `nextTaskAtMs` is recomputed on the records it names, as every server
 * writer of a task does.
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
    ...(link?.dealId ? { dealId: String(link.dealId) } : {}),
  }
}

/** The document id a caller's key files under: its own namespace, never a raw key. */
function keyedId(sourcePluginId: string, key: string): string {
  return `plg_${createHash('sha256').update(`${sourcePluginId}:${key}`).digest('hex').slice(0, 28)}`
}

export function createCrmRecordTimelineWriter(deps: CrmRecordTimelineDeps): PluginRecordTimelineWriter {
  /** The org, its plan, the link and the scope an entry is stamped with. */
  async function admit(
    context: PluginRecordEntryContext,
  ): Promise<
    | PluginRecordWrite
    | { firestore: Firestore; orgRef: FirebaseFirestore.DocumentReference; link: CrmActivityLink; visibleTo: string[] }
  > {
    const orgId = String(context.orgId ?? '').trim()
    const hostId = String(context.hostId ?? '').trim()
    const link = linkFields(context.link)
    if (!orgId || !hostId || !String(context.sourcePluginId ?? '').trim()) {
      return refuse(400, 'An entry names its organization, its site and the plugin filing it.')
    }
    if (!link.contactId && !link.companyId && !link.dealId) {
      return refuse(400, 'An entry is filed on a contact, a company or a deal.')
    }
    const firestore = deps.firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const snapshot = await orgRef.get()
    if (!snapshot.exists) return refuse(404, 'That organization no longer exists.')
    const org = (snapshot.data() ?? {}) as Record<string, unknown>
    if (!checkEntitlement(org, CRM_SUITE_FEATURE)) {
      return refuse(403, "This workspace's plan doesn't include the CRM.")
    }
    return {
      firestore,
      orgRef,
      link,
      visibleTo: crmScopeTokens(org, consentGroupForHost(org, hostId)),
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
      const admitted = await admit(request)
      if ('ok' in admitted) return admitted
      const { firestore, orgRef, link, visibleTo } = admitted
      const ref = orgRef.collection(CRM_COLLECTIONS.tasks).doc(keyedId(request.sourcePluginId, key))
      const notes = String(request.notes ?? '').trim().slice(0, NOTE_MAX)
      const assigneeUid = String(request.assigneeUid ?? '').trim()
      const task: CrmTask = {
        title,
        ...(notes ? { notes } : {}),
        kind: request.kind,
        priority: 'normal',
        status: 'open',
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
      const created = await createOnce(ref, task as unknown as Record<string, unknown>)
      if (created) {
        // The records the task names carry `nextTaskAtMs` (AGL-2661); a figure
        // that could not move is the Fields section's recompute's.
        await recomputeCrmNextTaskAt(firestore, orgRef.id, [link]).catch((error: unknown) => {
          console.error('[crm] next activity could not be recomputed', orgRef.id, error)
        })
      }
      return { ok: true, id: ref.id, created }
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
