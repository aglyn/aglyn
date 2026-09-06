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
  type PluginApiResponse,
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
  CRM_TASK_BATCH_MAX,
  type CrmTaskCompleteOutcome,
  type CrmTaskCompleteResponse,
  type CrmTaskFields,
  type CrmTaskSaveOutcome,
  type CrmTaskSaveResponse,
  type CrmTasksCompleteResponse,
  type CrmTasksSaveResponse,
  readCrmTaskFields,
} from '../model/task-routes'
import { CRM_ORG_TASK_SCOPE } from '../model/task-scope'
import {
  authorizeOrgCaller,
  type CrmRouteScope,
  readCrmRouteScope,
} from './org-caller'

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
 *
 * ## The organization variant (AGL-2637)
 *
 * `{ orgId, … }` instead of a site: the org-level hub. The caller is
 * authorized by the ORG — an org-wide member holding `data.manage`, the
 * hub's own gate, never a site collaborator — and reaches every task the
 * org holds, so no scope check is made against the document. A NEW task
 * names the site it is filed from beside the org, or names none and is the
 * organization's own: `hostId: null`, the org scope token alone. Completing
 * emits on the task's OWN site, where its automations live; an
 * organization task has none and emits nothing, as an uncaptured deal's
 * stage change emits nothing.
 *
 * The org variant also takes a BATCH — `taskIds` to complete, `tasks` to
 * save — so the org hub's bulk bar makes one request per action rather
 * than one per task. Each task is answered on its own in `results`; the
 * request as a whole is refused only for what refuses every task alike.
 */

type Refusal = { ok: false; status: number; body: { error: string } }

interface Writer {
  ok: true
  uid: string
  staff: boolean
  orgId: string
  org: Record<string, unknown>
  /** The member document under a site; `null` at the org level, where the reach is the org's. */
  member: Partial<AglynOrgMember> | null
  level: CrmRouteScope['level']
}

const refuse = (status: number, error: string): Refusal => ({
  ok: false,
  status,
  body: { error },
})

const ORG_REFUSAL =
  'Editing tasks at the organization level requires the "Manage data" ' +
  'permission across the whole workspace.'

/**
 * Who is asking, and whether they may write this CRM at all.
 *
 * Under a site: the org resolved from the site and the rules' own role and
 * permission questions. At the organization level: the org the body names,
 * for an org-wide member with the permission. The scope question — may they
 * reach THIS task — is asked by the caller against the document, because on
 * a create the document does not exist yet and its scope is what the route
 * is about to stamp.
 */
async function authorizeCrmWriter(
  req: PluginApiRequest,
  scope: CrmRouteScope,
): Promise<Writer | Refusal> {
  if (scope.level === 'org') {
    const caller = await authorizeOrgCaller(req, scope.orgId, {
      needs: 'data.manage',
      refusal: ORG_REFUSAL,
    })
    if (caller.ok === false) return refuse(caller.status, caller.error)
    return {
      ok: true,
      uid: caller.uid,
      staff: caller.staff,
      orgId: caller.orgId,
      org: caller.org as Record<string, unknown>,
      member: null,
      level: 'org',
    }
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse(401, 'Unauthenticated')

  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const staff = decoded['staff'] === true
  const resolved = await getOrgForHost(scope.hostId).catch(() => null)
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
    level: 'site',
  }
}

/**
 * The rules' `canReadScoped()`, for a document the route has in hand. An
 * org-level writer was admitted as org-wide, and an org-wide member reads
 * every row.
 */
const canReach = (writer: Writer, visibleTo: unknown): boolean =>
  writer.staff ||
  writer.level === 'org' ||
  isOrgWideMember(writer.member) ||
  memberCanSee(writer.member, visibleTo as string[] | undefined)

/**
 * The console path the assignee's notification opens: the record the task
 * is for, in the hub, or the tasks list when it is for nobody in particular.
 *
 * In the `/{hostDocId}/rest` shape every host notification uses — the
 * console rewrites it to `/{orgSlug}/hosts/{subdomain}/rest` when the link
 * is followed, which is why `hostId` and `orgId` travel on the document. An
 * organization task has no site to open under, so its link is the `/org`
 * shape the console rewrites onto the organization's own hub.
 */
function assignmentLink(hostId: string | null, fields: CrmTaskFields): string {
  const base = hostId ? `/${hostId}/crm` : '/org/crm'
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

const tasksCollection = (orgId: string) =>
  firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_COLLECTIONS.tasks)

type TasksCollection = ReturnType<typeof tasksCollection>

/**
 * Whether a uid names a member of the org, answered once per uid across a
 * batch: a bar reassigning forty tasks to one person asks the roster once.
 */
function rosterOf(orgId: string) {
  const known = new Map<string, Promise<boolean>>()
  return (uid: string): Promise<boolean> => {
    let answer = known.get(uid)
    if (!answer) {
      answer = resolveOrgMembership(uid, orgId)
        .then((found) => Boolean(found?.member))
        .catch(() => false)
      known.set(uid, answer)
    }
    return answer
  }
}

/** Tell the assignee, when they are somebody new and somebody else. */
async function notifyAssignee(
  writer: Writer,
  fields: CrmTaskFields,
  previousAssignee: string | null,
  hostId: string | null,
): Promise<boolean> {
  const assignee = fields.assigneeUid
  const notified = Boolean(
    assignee && assignee !== writer.uid && assignee !== previousAssignee,
  )
  if (!notified || !assignee) return false
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
    ...(hostId ? { hostId } : {}),
  })
  return true
}

/**
 * Rewrite one existing task's editable fields, and tell a new assignee.
 *
 * `visibleTo` is not touched: the rules let only an org-wide member move a
 * record's scope, and this route is not the place that does it. `hostId`
 * and `createdByUid` are provenance and never rewritten. The notification
 * opens under the site the caller is on, or — at the organization level —
 * under the task's own site, and under the org hub for a task with none.
 */
async function updateTask(
  writer: Writer,
  scope: CrmRouteScope,
  tasks: TasksCollection,
  taskId: string,
  fields: CrmTaskFields,
  onRoster: (uid: string) => Promise<boolean>,
): Promise<{ ok: true; notified: boolean } | Refusal> {
  if (fields.assigneeUid && !(await onRoster(fields.assigneeUid))) {
    return refuse(400, 'The assignee is not a member of this organization.')
  }
  const existing = await tasks.doc(taskId).get()
  if (!existing.exists) return refuse(404, 'That task no longer exists.')
  if (!canReach(writer, existing.get('visibleTo'))) {
    return refuse(403, 'That task is not visible to you.')
  }
  const previousAssignee = String(existing.get('assigneeUid') ?? '') || null
  await tasks.doc(taskId).update({
    ...storedFields(fields, 'update'),
    updatedAt: FieldValue.serverTimestamp(),
  })
  const linkHostId =
    scope.level === 'site'
      ? scope.hostId
      : String(existing.get('hostId') ?? '').trim() || null
  const notified = await notifyAssignee(writer, fields, previousAssignee, linkHostId)
  return { ok: true, notified }
}

/**
 * Where a NEW task is filed from: the mounted site, or at the organization
 * level the site the body names — which has to be one of THIS org's, or an
 * org-wide member of one org could stamp a task with another org's site
 * token — or no site at all, the organization's own.
 */
async function resolveFiledFrom(
  writer: Writer,
  scope: CrmRouteScope,
): Promise<{ ok: true; hostId: string | null } | Refusal> {
  if (scope.level === 'site') return { ok: true, hostId: scope.hostId }
  if (!scope.hostId) return { ok: true, hostId: null }
  const owner = await getOrgForHost(scope.hostId).catch(() => null)
  if (!owner || owner.orgId !== writer.orgId) {
    return refuse(400, 'That site is not one of this organization’s.')
  }
  return { ok: true, hostId: scope.hostId }
}

/**
 * Create one task, stamped with its scope and provenance.
 *
 * The scope every CRM creator stamps for a task filed from a site: the
 * whole org when the org has chosen that, and otherwise the sites this
 * site presents as one sender with — which, undeclared, is this site
 * alone. A scoped member creating a record they could not then see is
 * refused, which is the rules' `canCreateScoped()` said before the write
 * instead of after. An organization task — no site — carries
 * `CRM_ORG_TASK_SCOPE` and `hostId: null`.
 */
async function createTask(
  writer: Writer,
  scope: CrmRouteScope,
  tasks: TasksCollection,
  fields: CrmTaskFields,
  onRoster: (uid: string) => Promise<boolean>,
): Promise<{ ok: true; taskId: string; notified: boolean } | Refusal> {
  if (fields.assigneeUid && !(await onRoster(fields.assigneeUid))) {
    return refuse(400, 'The assignee is not a member of this organization.')
  }
  const filed = await resolveFiledFrom(writer, scope)
  if (filed.ok === false) return filed
  const { hostId } = filed
  const visibleTo = hostId
    ? crmScopeTokens(writer.org, consentGroupForHost(writer.org, hostId))
    : [...CRM_ORG_TASK_SCOPE]
  if (!canReach(writer, visibleTo)) {
    return refuse(403, 'Your access to this organization does not reach this site.')
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
  const notified = await notifyAssignee(writer, fields, null, hostId)
  return { ok: true, taskId: ref.id, notified }
}

/**
 * `POST crm/task-save` — create or update a task, and tell its assignee.
 *
 * Body: `{ hostId, taskId?, task: CrmTaskFields }` under a site;
 * `{ orgId, hostId?, taskId?, task }` at the organization level; or the
 * org-level batch `{ orgId, tasks: [{ taskId, task }] }`. Answers
 * `{ ok, taskId, notified }`, or `{ ok, results }` for the batch.
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
  const scope = readCrmRouteScope(req.body as Record<string, unknown>)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  if (Array.isArray(req.body?.tasks)) {
    await saveBatch(req, res, scope)
    return
  }
  const taskId = String(req.body?.taskId ?? '').trim()
  const read = readCrmTaskFields(req.body?.task)
  if (read.ok === false) {
    res.status(400).json({ error: read.error })
    return
  }
  const fields = read.fields

  try {
    const writer = await authorizeCrmWriter(req, scope)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const tasks = tasksCollection(writer.orgId)
    const onRoster = rosterOf(writer.orgId)
    let body: CrmTaskSaveResponse
    if (taskId) {
      const saved = await updateTask(writer, scope, tasks, taskId, fields, onRoster)
      if (saved.ok === false) {
        res.status(saved.status).json(saved.body)
        return
      }
      body = { ok: true, taskId, notified: saved.notified }
    } else {
      const saved = await createTask(writer, scope, tasks, fields, onRoster)
      if (saved.ok === false) {
        res.status(saved.status).json(saved.body)
        return
      }
      body = { ok: true, taskId: saved.taskId, notified: saved.notified }
    }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] task-save failed', error)
    res.status(500).json({ error: 'The task could not be saved.' })
  }
}

/**
 * The batch: every entry read before any is written, so a body with one
 * unreadable entry is refused whole rather than half-applied; then each
 * task in order, each answered on its own.
 */
async function saveBatch(
  req: PluginApiRequest,
  res: PluginApiResponse,
  scope: CrmRouteScope,
): Promise<void> {
  if (scope.level !== 'org') {
    res.status(400).json({
      error: 'A batch of tasks is saved at the organization level only.',
    })
    return
  }
  const entries = (req.body?.tasks as unknown[]).slice(0, CRM_TASK_BATCH_MAX + 1)
  if (!entries.length || entries.length > CRM_TASK_BATCH_MAX) {
    res.status(400).json({
      error: `Save between 1 and ${CRM_TASK_BATCH_MAX} tasks at a time.`,
    })
    return
  }
  const parsed: Array<{ taskId: string; fields: CrmTaskFields }> = []
  for (const entry of entries) {
    const raw = (entry ?? {}) as Record<string, unknown>
    const taskId = String(raw['taskId'] ?? '').trim()
    const read = readCrmTaskFields(raw['task'])
    if (!taskId || read.ok === false) {
      res.status(400).json({
        error: read.ok === false ? read.error : 'Every task in a batch names its taskId.',
      })
      return
    }
    parsed.push({ taskId, fields: read.fields })
  }

  try {
    const writer = await authorizeCrmWriter(req, scope)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const tasks = tasksCollection(writer.orgId)
    const onRoster = rosterOf(writer.orgId)
    const results: CrmTaskSaveOutcome[] = []
    for (const { taskId, fields } of parsed) {
      const saved = await updateTask(writer, scope, tasks, taskId, fields, onRoster)
      results.push(
        saved.ok === false
          ? { taskId, ok: false, error: saved.body.error }
          : { taskId, ok: true, notified: saved.notified },
      )
    }
    const body: CrmTasksSaveResponse = { ok: true, results }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] task-save batch failed', error)
    res.status(500).json({ error: 'The tasks could not be saved.' })
  }
}

/**
 * Mark one task done and fire `taskCompleted` on the site whose automations
 * hear it: under a site, the site whose console ticked the box — workflows
 * belong to a site, and the person is on that site's console. At the
 * organization level there is no such console, so the event goes to the
 * task's OWN site, and an organization task, having none, fires nothing.
 * The task's own `hostId` rides in the payload as `taskHostId` either way,
 * for a workflow that cares about the difference.
 *
 * Idempotent on purpose: two people ticking the same box, or one person
 * double-clicking, completes a task once and fires its event once. The
 * second call reads the stored `completedAtMs` back and writes nothing.
 */
async function completeTask(
  writer: Writer,
  scope: CrmRouteScope,
  tasks: TasksCollection,
  taskId: string,
): Promise<CrmTaskCompleteOutcome> {
  const ref = tasks.doc(taskId)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    return { taskId, ok: false, error: 'That task no longer exists.' }
  }
  const task = snapshot.data() as Partial<CrmTask>
  if (!canReach(writer, task.visibleTo)) {
    return { taskId, ok: false, error: 'That task is not visible to you.' }
  }
  if (task.status === 'done') {
    return {
      taskId,
      ok: true,
      completedAtMs: Number(task.completedAtMs ?? 0),
      alreadyDone: true,
    }
  }

  const completedAtMs = Date.now()
  await ref.update({
    status: 'done',
    completedAtMs,
    completedByUid: writer.uid,
    updatedAt: FieldValue.serverTimestamp(),
  })

  const eventHostId =
    scope.level === 'site' ? scope.hostId : String(task.hostId ?? '').trim()
  if (eventHostId) {
    /*
     * The payload is what a workflow filter can read: every field a string,
     * number or boolean, and every optional one present as an empty string
     * rather than absent, so `contactId != ""` is a filter somebody can
     * write without knowing whether the key exists.
     */
    await emitHostEvent(eventHostId, 'taskCompleted', {
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
  }
  return { taskId, ok: true, completedAtMs }
}

/** A per-task outcome as the single-task route has always answered. */
const completeStatus = (outcome: Extract<CrmTaskCompleteOutcome, { ok: false }>) =>
  outcome.error === 'That task no longer exists.' ? 404 : 403

/**
 * `POST crm/task-complete` — mark a task done and fire `taskCompleted`.
 *
 * Body: `{ hostId, taskId }` under a site, `{ orgId, taskId }` at the
 * organization level, or the org-level batch `{ orgId, taskIds }`. Answers
 * `{ ok, completedAtMs, alreadyDone? }`, or `{ ok, results }` for the batch.
 */
export const crmTaskCompleteHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const scope = readCrmRouteScope(req.body as Record<string, unknown>)
  if (Array.isArray(req.body?.taskIds)) {
    await completeBatch(req, res, scope)
    return
  }
  const taskId = String(req.body?.taskId ?? '').trim()
  if (!scope || !taskId) {
    res.status(400).json({ error: 'Missing hostId or taskId' })
    return
  }

  try {
    const writer = await authorizeCrmWriter(req, scope)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const outcome = await completeTask(writer, scope, tasksCollection(writer.orgId), taskId)
    if (outcome.ok === false) {
      res.status(completeStatus(outcome)).json({ error: outcome.error })
      return
    }
    const body: CrmTaskCompleteResponse = {
      ok: true,
      completedAtMs: outcome.completedAtMs,
      ...(outcome.alreadyDone ? { alreadyDone: true } : {}),
    }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] task-complete failed', error)
    res.status(500).json({ error: 'The task could not be completed.' })
  }
}

/**
 * The batch: the ids deduplicated and capped, then each task in order —
 * in order rather than at once, because each completion may run a site's
 * workflows, and two hundred runners started together is the burst the
 * per-task client call was written to avoid.
 */
async function completeBatch(
  req: PluginApiRequest,
  res: PluginApiResponse,
  scope: CrmRouteScope | null,
): Promise<void> {
  if (!scope || scope.level !== 'org') {
    res.status(400).json({
      error: 'A batch of tasks is completed at the organization level only.',
    })
    return
  }
  const taskIds = [
    ...new Set(
      (req.body?.taskIds as unknown[]).map((id) => String(id ?? '').trim()).filter(Boolean),
    ),
  ]
  if (!taskIds.length || taskIds.length > CRM_TASK_BATCH_MAX) {
    res.status(400).json({
      error: `Complete between 1 and ${CRM_TASK_BATCH_MAX} tasks at a time.`,
    })
    return
  }

  try {
    const writer = await authorizeCrmWriter(req, scope)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const tasks = tasksCollection(writer.orgId)
    const results: CrmTaskCompleteOutcome[] = []
    for (const taskId of taskIds) {
      results.push(await completeTask(writer, scope, tasks, taskId))
    }
    const body: CrmTasksCompleteResponse = { ok: true, results }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] task-complete batch failed', error)
    res.status(500).json({ error: 'The tasks could not be completed.' })
  }
}
