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
  type AglynOrgMember,
  consentGroupForHost,
  CRM_COLLECTIONS,
  type CrmTask,
  crmScopeTokens,
  isOrgWideMember,
  memberCanSee,
  type PluginApiHandler,
  type PluginApiRequest,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  memberHasOrgPermission,
  notifyUsers,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type CrmTaskCompleteResponse,
  type CrmTaskFields,
  type CrmTaskSaveResponse,
  readCrmTaskFields,
} from '../model/task-routes'

/**
 * The two things a task does that a browser must not do alone (AGL-2599).
 *
 * Every other task write is client-direct against the Firestore rules —
 * reopening, deleting, the list's own reads. These two are routes because
 * each has a side effect that lives outside the document:
 *
 * - SAVING a task assigned to somebody else NOTIFIES them, and a
 *   notification is an Admin-SDK write into another person's inbox. Rather
 *   than a client-direct write followed by a "please notify" call — two
 *   operations that can disagree about whether the task exists — the route
 *   persists the task itself and notifies from the same code path, so a
 *   notification can never announce a task that failed to save. It also
 *   stamps the scope, the provenance and the timestamps, which is one
 *   creator computing `visibleTo` rather than two.
 *
 * - COMPLETING a task EMITS the `taskCompleted` host event, which is what a
 *   workflow triggers on. A browser cannot run the workflow runner.
 *
 * Both authenticate the way the other console plugin routes do — the ID
 * token in the `Authorization` header — and then ask the same two questions
 * the rules ask of a `crmTasks` write: is this member allowed to write org
 * data (`owner`/`admin`/`editor`, and `data.manage` resolved through their
 * custom role), and can they reach THIS document's scope.
 */

type Refusal = { ok: false; status: number; body: { error: string } }

interface Writer {
  ok: true
  uid: string
  staff: boolean
  orgId: string
  org: Record<string, unknown>
  member: Partial<AglynOrgMember> | null
}

const refuse = (status: number, error: string): Refusal => ({
  ok: false,
  status,
  body: { error },
})

/**
 * Who is asking, and whether they may write this site's CRM at all.
 *
 * The scope question — may they reach THIS task — is asked by the caller
 * against the document, because on a create the document does not exist yet
 * and its scope is what the route is about to stamp.
 */
async function authorizeCrmWriter(
  req: PluginApiRequest,
  hostId: string,
): Promise<Writer | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse(401, 'Unauthenticated')

  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const staff = decoded['staff'] === true
  const resolved = await getOrgForHost(hostId).catch(() => null)
  if (!resolved) {
    return refuse(404, 'This site has no organization, so it has no CRM.')
  }
  const { orgId, org } = resolved
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
    () => null,
  )
  const member = (membership?.member ?? null) as Partial<AglynOrgMember> | null
  if (!staff) {
    const role = String(member?.role ?? '')
    /*
     * The rules' `canWriteOrgData()` restated: the role list is what an
     * unstamped permission map falls through to, and the permission is the
     * only half a custom role's revocation can reach. A route that checked
     * one and not the other would open a door the rules keep shut.
     */
    const writerRole = role === 'owner' || role === 'admin' || role === 'editor'
    const suspended =
      (member as { orgSuspended?: boolean } | null)?.orgSuspended === true
    if (!member || !writerRole || suspended) {
      return refuse(403, 'Your organization role does not allow editing the CRM.')
    }
    if (!(await memberHasOrgPermission(orgId, member, 'data.manage'))) {
      return refuse(
        403,
        'Your organization role does not allow editing the CRM.',
      )
    }
  }
  return {
    ok: true,
    uid: decoded.uid,
    staff,
    orgId,
    org: (org ?? {}) as Record<string, unknown>,
    member,
  }
}

/** The rules' `canReadScoped()`, for a document the route has in hand. */
const canReach = (writer: Writer, visibleTo: unknown): boolean =>
  writer.staff ||
  isOrgWideMember(writer.member) ||
  memberCanSee(writer.member, visibleTo as string[] | undefined)

/**
 * The console path the assignee's notification opens: the record the task
 * is for, in the hub, or the tasks list when it is for nobody in particular.
 *
 * In the `/{hostDocId}/rest` shape every host notification uses — the
 * console rewrites it to `/{orgSlug}/hosts/{subdomain}/rest` when the link
 * is followed, which is why `hostId` and `orgId` travel on the document.
 */
function assignmentLink(hostId: string, fields: CrmTaskFields): string {
  const base = `/${hostId}/crm`
  if (fields.contactId) return `${base}/contacts/${encodeURIComponent(fields.contactId)}`
  if (fields.dealId) return `${base}/deals/${encodeURIComponent(fields.dealId)}`
  if (fields.companyId) return `${base}/companies/${encodeURIComponent(fields.companyId)}`
  return `${base}/tasks`
}

/**
 * The editable fields as a Firestore write.
 *
 * The optional ids and the assignee are ABSENT on the document when unset,
 * never `null` — the record cards query `where('contactId', '==', id)` and
 * the "My tasks" view `where('assigneeUid', '==', uid)`, and neither is
 * helped by a null. So a create leaves an unset optional out, and an update
 * DELETES it: an assignee cleared in the drawer has to come off the
 * document, and an update that merely omitted the key would keep them.
 * `dueAtMs` is the one field written as `null` when unset, because every
 * view orders by it and a document missing the field drops out of an
 * `orderBy` entirely.
 */
function storedFields(
  fields: CrmTaskFields,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const absent = mode === 'update' ? FieldValue.delete() : undefined
  const optional = (value: string | null) =>
    value ? { present: true, value } : { present: mode === 'update', value: absent }
  const out: Record<string, unknown> = {
    title: fields.title,
    kind: fields.kind,
    priority: fields.priority,
    dueAtMs: fields.dueAtMs,
    notes: fields.notes,
  }
  for (const [key, value] of [
    ['assigneeUid', fields.assigneeUid],
    ['contactId', fields.contactId],
    ['companyId', fields.companyId],
    ['dealId', fields.dealId],
  ] as const) {
    const slot = optional(value)
    if (slot.present) out[key] = slot.value
  }
  return out
}

/**
 * `POST crm/task-save` — create or update a task, and tell its assignee.
 *
 * Body: `{ hostId, taskId?, task: CrmTaskFields }`. Answers
 * `{ ok, taskId, notified }`.
 *
 * The NOTIFICATION fires when the saved assignee is somebody other than the
 * person saving AND is not who the task was already assigned to. Assigning
 * a task to yourself is a note to self; re-saving a task's title does not
 * re-announce it to the person who already has it. The assignee must be a
 * member of the org — a uid nobody can find in the roster is refused rather
 * than written, because a notification to a stranger's inbox is the one
 * thing this route must never do.
 */
export const crmTaskSaveHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const hostId = String(req.body?.hostId ?? '').trim()
  const taskId = String(req.body?.taskId ?? '').trim()
  if (!hostId) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const read = readCrmTaskFields(req.body?.task)
  if (read.ok === false) {
    res.status(400).json({ error: read.error })
    return
  }
  const fields = read.fields

  try {
    const writer = await authorizeCrmWriter(req, hostId)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const firestore = firebaseAdmin.app().firestore()
    const tasks = firestore
      .collection('orgs')
      .doc(writer.orgId)
      .collection(CRM_COLLECTIONS.tasks)

    if (fields.assigneeUid) {
      const assignee = await resolveOrgMembership(
        fields.assigneeUid,
        writer.orgId,
      ).catch(() => null)
      if (!assignee?.member) {
        res.status(400).json({
          error: 'The assignee is not a member of this organization.',
        })
        return
      }
    }

    let previousAssignee: string | null = null
    let savedId = taskId
    if (taskId) {
      const existing = await tasks.doc(taskId).get()
      if (!existing.exists) {
        res.status(404).json({ error: 'That task no longer exists.' })
        return
      }
      if (!canReach(writer, existing.get('visibleTo'))) {
        res.status(403).json({ error: 'That task is not visible to you.' })
        return
      }
      previousAssignee = String(existing.get('assigneeUid') ?? '') || null
      /*
       * `visibleTo` is not touched: the rules let only an org-wide member
       * move a record's scope, and this route is not the place that does
       * it. `hostId` and `createdByUid` are provenance and never rewritten.
       */
      await tasks.doc(taskId).update({
        ...storedFields(fields, 'update'),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else {
      /*
       * The scope every CRM creator stamps: the whole org when the org has
       * chosen that, and otherwise the sites this site presents as one
       * sender with — which, undeclared, is this site alone. A scoped member
       * creating a record they could not then see is refused, which is the
       * rules' `canCreateScoped()` said before the write instead of after.
       */
      const visibleTo = crmScopeTokens(
        writer.org,
        consentGroupForHost(writer.org, hostId),
      )
      if (!canReach(writer, visibleTo)) {
        res.status(403).json({
          error: 'Your access to this organization does not reach this site.',
        })
        return
      }
      const ref = tasks.doc()
      await ref.set({
        ...storedFields(fields, 'create'),
        status: 'open',
        completedAtMs: null,
        visibleTo,
        hostId,
        createdByUid: writer.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      savedId = ref.id
    }

    const assignee = fields.assigneeUid
    const notified = Boolean(
      assignee && assignee !== writer.uid && assignee !== previousAssignee,
    )
    if (notified && assignee) {
      const due =
        typeof fields.dueAtMs === 'number'
          ? ` · due ${new Date(fields.dueAtMs).toLocaleString()}`
          : ''
      await notifyUsers([assignee], {
        type: 'content.taskAssigned',
        title: 'Task assigned to you',
        body: `${fields.title}${due}`,
        link: assignmentLink(hostId, fields),
        orgId: writer.orgId,
        hostId,
      })
    }

    const body: CrmTaskSaveResponse = { ok: true, taskId: savedId, notified }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] task-save failed', error)
    res.status(500).json({ error: 'The task could not be saved.' })
  }
}

/**
 * `POST crm/task-complete` — mark a task done and fire `taskCompleted`.
 *
 * Body: `{ hostId, taskId }`. Answers `{ ok, completedAtMs, alreadyDone? }`.
 *
 * Idempotent on purpose: two people ticking the same box, or one person
 * double-clicking, completes a task once and fires its event once. The
 * second call reads the stored `completedAtMs` back and writes nothing.
 *
 * The event is emitted on the site whose console completed it — the
 * request's `hostId` — because workflows belong to a site, and the person
 * ticking the box is on that site's console. The task's own `hostId` (the
 * site that CREATED it) rides in the payload as `taskHostId` for a workflow
 * that cares about the difference.
 */
export const crmTaskCompleteHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const hostId = String(req.body?.hostId ?? '').trim()
  const taskId = String(req.body?.taskId ?? '').trim()
  if (!hostId || !taskId) {
    res.status(400).json({ error: 'Missing hostId or taskId' })
    return
  }

  try {
    const writer = await authorizeCrmWriter(req, hostId)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const ref = firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(writer.orgId)
      .collection(CRM_COLLECTIONS.tasks)
      .doc(taskId)
    const snapshot = await ref.get()
    if (!snapshot.exists) {
      res.status(404).json({ error: 'That task no longer exists.' })
      return
    }
    const task = snapshot.data() as Partial<CrmTask>
    if (!canReach(writer, task.visibleTo)) {
      res.status(403).json({ error: 'That task is not visible to you.' })
      return
    }
    if (task.status === 'done') {
      const body: CrmTaskCompleteResponse = {
        ok: true,
        completedAtMs: Number(task.completedAtMs ?? 0),
        alreadyDone: true,
      }
      res.status(200).json(body)
      return
    }

    const completedAtMs = Date.now()
    await ref.update({
      status: 'done',
      completedAtMs,
      completedByUid: writer.uid,
      updatedAt: FieldValue.serverTimestamp(),
    })

    /*
     * The payload is what a workflow filter can read: every field a string,
     * number or boolean, and every optional one present as an empty string
     * rather than absent, so `contactId != ""` is a filter somebody can
     * write without knowing whether the key exists.
     */
    await emitHostEvent(hostId, 'taskCompleted', {
      taskId,
      title: String(task.title ?? ''),
      kind: String(task.kind ?? ''),
      priority: String(task.priority ?? ''),
      dueAtMs: typeof task.dueAtMs === 'number' ? task.dueAtMs : 0,
      completedAtMs,
      completedByUid: writer.uid,
      assigneeUid: String(task.assigneeUid ?? ''),
      createdByUid: String(task.createdByUid ?? ''),
      contactId: String(task.contactId ?? ''),
      companyId: String(task.companyId ?? ''),
      dealId: String(task.dealId ?? ''),
      taskHostId: String(task.hostId ?? ''),
    })

    const body: CrmTaskCompleteResponse = { ok: true, completedAtMs }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] task-complete failed', error)
    res.status(500).json({ error: 'The task could not be completed.' })
  }
}
