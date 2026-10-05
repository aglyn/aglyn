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
 * `/v1/tasks` (AGL-2606) — what the team owes a person: a call, an email, a
 * meeting or a to-do, with a due date, pointing at the contact, company or
 * deal it is for. A task may point at nothing — a plain to-do is still a
 * task — which is the one place it differs from an activity.
 *
 * `status` is the only state machine here and it has two states. Marking a
 * task `done` stamps `completedAtMs`; marking it `open` again clears it, so
 * a reopened task never reads as completed on the date it was first closed.
 *
 * `remindAt` (AGL-2659) is the task's reminder: the due time unless the
 * body names a time or `null`, carried along when a moved due date leaves
 * it behind, and cleared by completion while it is still owed — the rule
 * in `crmTaskReminderAfterEdit`, the same one the console's drawer keeps.
 * `reminderSentAt` is read-only: when the hourly runner handled it.
 *
 * `kind`, `priority` and `status` (AGL-3517) take a value of the org's
 * Type, Priority or Status picklist — its label, "In Progress" — or the
 * meaning behind it, `open`; the task stores both, and answers the meaning
 * under the field's own name with the label beside it as `typeLabel`,
 * `priorityLabel` and `statusLabel`.
 */
import {
  CRM_COLLECTIONS,
  CRM_TASK_PICKLIST_IDS,
  type CrmPicklistId,
  crmPicklistLabelForNew,
  type CrmTask,
  type CrmTaskKind,
  type CrmTaskPicklists,
  crmTaskPicklistLabels,
  type CrmTaskPriority,
  type CrmTaskStatus,
  createResourceUid,
  crmTaskListFields,
  resolveCrmSemanticPicklistWrite,
} from '@aglyn/aglyn/server'
import {
  apiJson,
  ApiErrors,
  restampCrmListFieldsAt,
} from '@aglyn/tenant-data-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  type ApiV1Context,
  claimWrite,
  readJsonBody,
  requireScope,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import {
  type Clearable,
  CRM_TEXT_MAX,
  CRM_TITLE_MAX,
  createPayload,
  crmCollection,
  crmCreateStamp,
  crmRefErrors,
  crmTimes,
  crmValidationFailed,
  isoFromMs,
  listCrm,
  memberError,
  parseIsoInstant,
  readCrmSite,
  readEqualityFilters,
  readOptionalText,
  readRefId,
  refuseUnknownKeys,
  updatePayload,
} from './crm-shared'
import { readCrmTaskPicklists } from '../read-picklist'
import { crmTaskReminderAfterEdit, crmTaskReminderPending } from '../../model/crm-task-reminders'
import { crmNextActivityLinksOf, recomputeCrmNextTaskAt } from '../crm-next-activity'

const TASK_STATUSES = ['open', 'done'] as const

/** The org's task picklists, read once for a request. */
const taskPicklistsOf = (ctx: ApiV1Context): Promise<CrmTaskPicklists> =>
  readCrmTaskPicklists(ctx.firestore, ctx.orgId)

/** The task object as published. Every writable field appears here. */
function taskView(doc: FirebaseFirestore.DocumentSnapshot, picklists: CrmTaskPicklists) {
  const data = (doc.data() ?? {}) as Partial<CrmTask>
  const labels = crmTaskPicklistLabels(data, picklists)
  return {
    id: doc.id,
    object: 'task',
    title: data.title ?? null,
    notes: data.notes ?? null,
    kind: data.kind ?? 'todo',
    typeLabel: labels.type,
    priority: data.priority ?? 'normal',
    priorityLabel: labels.priority,
    status: data.status ?? 'open',
    statusLabel: labels.status,
    dueAt: isoFromMs(data.dueAtMs),
    remindAt: isoFromMs(data.remindAtMs),
    reminderSentAt: isoFromMs(data.reminderSentAtMs),
    completedAt: isoFromMs(data.completedAtMs),
    assigneeUid: data.assigneeUid ?? null,
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    dealId: data.dealId ?? null,
    siteId: data.hostId ?? null,
    ...crmTimes(data as FirebaseFirestore.DocumentData),
  }
}

const TASK_WRITABLE = new Set([
  'title',
  'notes',
  'kind',
  'priority',
  'status',
  'dueAt',
  'remindAt',
  'assigneeUid',
  'contactId',
  'companyId',
  'dealId',
])

/** A picklist field as resolved: the meaning stored under its name, the label beside it. */
interface Picked<T extends string> {
  meaning: T
  label: string | null
}

interface TaskInput {
  title?: string
  notes?: Clearable<string>
  kind?: Picked<CrmTaskKind>
  priority?: Picked<CrmTaskPriority>
  status?: Picked<CrmTaskStatus>
  dueAtMs?: Clearable<number>
  remindAtMs?: Clearable<number>
  assigneeUid?: Clearable<string>
  contactId?: Clearable<string>
  companyId?: Clearable<string>
  dealId?: Clearable<string>
}

/**
 * A Type, Priority or Status as the body names it — a label or a meaning —
 * against the org's list; the stored label is kept when the body names it
 * again. Absent answers `undefined`; anything the list does not hold is an
 * error naming the values it does.
 */
function readPicklistField<T extends string>(
  body: Record<string, unknown>,
  key: 'kind' | 'priority' | 'status',
  id: CrmPicklistId,
  picklists: CrmTaskPicklists,
  stored: string | null | undefined,
  errors: Record<string, string>,
): Picked<T> | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  const list =
    key === 'kind' ? picklists.type : key === 'priority' ? picklists.priority : picklists.status
  const resolved =
    typeof value === 'string' ? resolveCrmSemanticPicklistWrite(id, list, value, stored) : null
  if (resolved?.ok) return { meaning: resolved.meaning as T, label: resolved.label }
  errors[key] =
    resolved?.ok === false ? resolved.error : 'Must be a value of the list, or its meaning'
  return undefined
}

function readTaskInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
  picklists: CrmTaskPicklists,
  stored: Partial<CrmTask> | null = null,
): { values: TaskInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: TaskInput = {}
  const allowed = new Set(TASK_WRITABLE)
  if (!partial) allowed.add('consentSiteId')
  refuseUnknownKeys(body, allowed, 'task', errors)

  if (body.title !== undefined || !partial) {
    const title = String(body.title ?? '')
      .trim()
      .slice(0, CRM_TITLE_MAX)
    if (title) values.title = title
    else errors.title = partial ? 'Must not be empty' : 'A title is required'
  }

  const notes = readOptionalText(body, 'notes', CRM_TEXT_MAX, errors)
  if (notes !== undefined) values.notes = notes
  const kind = readPicklistField<CrmTaskKind>(
    body, 'kind', CRM_TASK_PICKLIST_IDS.type, picklists, stored?.typeLabel, errors,
  )
  if (kind) values.kind = kind
  const priority = readPicklistField<CrmTaskPriority>(
    body, 'priority', CRM_TASK_PICKLIST_IDS.priority, picklists, stored?.priorityLabel, errors,
  )
  if (priority) values.priority = priority
  const status = readPicklistField<CrmTaskStatus>(
    body, 'status', CRM_TASK_PICKLIST_IDS.status, picklists, stored?.statusLabel, errors,
  )
  if (status) values.status = status

  if (body.dueAt !== undefined) {
    if (body.dueAt === null) {
      values.dueAtMs = null
    } else {
      const ms = parseIsoInstant(body.dueAt)
      if (ms === null) {
        errors.dueAt = 'Must be an ISO 8601 instant, like 2026-09-10T15:00:00Z'
      } else {
        values.dueAtMs = ms
      }
    }
  }

  if (body.remindAt !== undefined) {
    if (body.remindAt === null) {
      values.remindAtMs = null
    } else {
      const ms = parseIsoInstant(body.remindAt)
      if (ms === null) {
        errors.remindAt = 'Must be an ISO 8601 instant, like 2026-09-10T14:00:00Z'
      } else {
        values.remindAtMs = ms
      }
    }
  }

  const assigneeUid = readOptionalText(body, 'assigneeUid', CRM_TITLE_MAX, errors)
  if (assigneeUid !== undefined) values.assigneeUid = assigneeUid
  for (const field of ['contactId', 'companyId', 'dealId'] as const) {
    const id = readRefId(body, field, errors)
    if (id !== undefined) values[field] = id
  }

  return Object.keys(errors).length ? { errors } : { values }
}

async function taskRefErrors(
  ctx: ApiV1Context,
  values: TaskInput,
): Promise<Record<string, string>> {
  const [assignee, refs] = await Promise.all([
    memberError(ctx, 'assigneeUid', values.assigneeUid),
    crmRefErrors(ctx, {
      contactId: values.contactId ?? undefined,
      companyId: values.companyId ?? undefined,
      dealId: values.dealId ?? undefined,
    }),
  ])
  return { ...assignee, ...refs }
}

/**
 * The records the task names carry `nextTaskAtMs` (AGL-2661), recomputed
 * after every write here from BOTH sides of the change. Its own catch: the
 * task write is done, and a figure that did not move is what the Fields
 * section's recompute is for, not a failed request.
 */
async function settleNextActivity(
  ctx: ApiV1Context,
  links: readonly (Record<string, unknown> | null | undefined)[],
): Promise<void> {
  try {
    await recomputeCrmNextTaskAt(
      ctx.firestore,
      ctx.orgId,
      links.map((link) => crmNextActivityLinksOf(link)),
    )
  } catch (error) {
    console.error('[api-v1] next activity could not be recomputed', ctx.orgId, error)
  }
}

/** `POST /v1/tasks`. */
async function createTask(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const picklists = await taskPicklistsOf(ctx)
  const parsed = readTaskInput(body, { partial: false }, picklists)
  if ('errors' in parsed) return crmValidationFailed(ctx, 'task', parsed.errors)
  const site = readCrmSite(ctx, 'task', body)
  if ('response' in site) return site.response
  const refErrors = await taskRefErrors(ctx, parsed.values)
  if (Object.keys(refErrors).length) return crmValidationFailed(ctx, 'task', refErrors)

  const collection = crmCollection(ctx, CRM_COLLECTIONS.tasks)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'tasks',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const { title, kind: pickedKind, priority: pickedPriority, status: pickedStatus, remindAtMs, ...rest } =
      parsed.values
    const kind = pickedKind?.meaning ?? 'todo'
    const priority = pickedPriority?.meaning ?? 'normal'
    const status = pickedStatus?.meaning ?? 'open'
    const id = createResourceUid()
    const stamp = crmCreateStamp(ctx, site.siteId)
    const record: Record<string, unknown> = {
      title,
      // Each meaning with the org's label beside it (AGL-3517).
      kind,
      typeLabel: pickedKind ? pickedKind.label : crmPicklistLabelForNew(picklists.type, kind),
      priority,
      priorityLabel: pickedPriority
        ? pickedPriority.label
        : crmPicklistLabelForNew(picklists.priority, priority),
      status,
      statusLabel: pickedStatus
        ? pickedStatus.label
        : crmPicklistLabelForNew(picklists.status, status),
      // A task created done was completed the instant it was created — the
      // same instant its `createdAt` carries.
      ...(status === 'done' ? { completedAtMs: stamp.createdAt.toMillis() } : {}),
      ...createPayload({
        ...rest,
        // A reminder on a task created done is owed to nobody.
        remindAtMs:
          status === 'done'
            ? null
            : crmTaskReminderAfterEdit({
                dueAtMs: rest.dueAtMs ?? null,
                remindAtMs,
                previous: null,
              }),
      }),
      /*
       * Stored as `null` when the body names none, never left absent: every
       * tasks list orders by `dueAtMs`, and Firestore leaves a document
       * without the ordered field out of the answer (AGL-3321).
       */
      dueAtMs: rest.dueAtMs ?? null,
      ...stamp,
    }
    // What the console's Tasks list searches by (AGL-3321).
    await collection.doc(id).create({ ...record, ...crmTaskListFields(record) })
    await settleNextActivity(ctx, [rest as Record<string, unknown>])
    const view = taskView(await collection.doc(id).get(), picklists)
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `PATCH /v1/tasks/{id}`. */
async function updateTask(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const body = await readJsonBody(request)
  const snap = await ref.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such task', headers: ctx.headers })
  }
  const picklists = await taskPicklistsOf(ctx)
  const parsed = readTaskInput(body, { partial: true }, picklists, snap.data() as Partial<CrmTask>)
  if ('errors' in parsed) return crmValidationFailed(ctx, 'task', parsed.errors)
  const refErrors = await taskRefErrors(ctx, parsed.values)
  if (Object.keys(refErrors).length) return crmValidationFailed(ctx, 'task', refErrors)

  const { status: pickedStatus, kind: pickedKind, priority: pickedPriority, remindAtMs, ...rest } =
    parsed.values
  const update: Record<string, unknown> = updatePayload(rest)
  // Each meaning with the org's label beside it (AGL-3517).
  if (pickedKind) {
    update.kind = pickedKind.meaning
    update.typeLabel = pickedKind.label
  }
  if (pickedPriority) {
    update.priority = pickedPriority.meaning
    update.priorityLabel = pickedPriority.label
  }
  // A cleared due date is stored `null`, not deleted — see the create.
  if (rest.dueAtMs === null) update.dueAtMs = null
  // One instant for the write: a task completed at T reads updated at T.
  const now = Timestamp.now()
  const status = pickedStatus?.meaning
  const completing = status === 'done' && status !== snap.get('status')
  if (pickedStatus) update.statusLabel = pickedStatus.label
  if (status !== undefined && status !== snap.get('status')) {
    update.status = status
    update.completedAtMs = status === 'done' ? now.toMillis() : null
  }
  /*
   * The reminder the edit leaves: what the body said, else the rule over
   * the stored task and the due date this PATCH moves it to. Completion
   * clears one still owed. A reminder that MOVED — to a time or to none —
   * is one not yet sent, so the runner's mark comes off with it; one that
   * stayed keeps its mark.
   */
  const stored = snap.data() as Partial<CrmTask>
  const previous = {
    dueAtMs: typeof stored.dueAtMs === 'number' ? stored.dueAtMs : null,
    remindAtMs: typeof stored.remindAtMs === 'number' ? stored.remindAtMs : null,
  }
  const nextRemindAtMs =
    completing && crmTaskReminderPending(stored)
      ? null
      : crmTaskReminderAfterEdit({
          dueAtMs: rest.dueAtMs === undefined ? previous.dueAtMs : rest.dueAtMs,
          remindAtMs,
          previous,
        })
  if (nextRemindAtMs !== previous.remindAtMs) {
    update.remindAtMs = nextRemindAtMs === null ? FieldValue.delete() : nextRemindAtMs
    update.reminderSentAtMs = FieldValue.delete()
  }
  if (Object.keys(update).length > 0) {
    await ref.update({ ...update, updatedAt: now })
    await settleNextActivity(ctx, [snap.data(), rest as Record<string, unknown>])
    // What the console's Tasks list searches (AGL-3321).
    if ('title' in update) await restampCrmListFieldsAt(ref, 'crmTasks')
  }
  return apiJson(taskView(await ref.get(), picklists), { headers: ctx.headers })
}

/** `DELETE /v1/tasks/{id}`. */
async function deleteTask(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'task-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const snap = await ref.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({ message: 'No such task', headers: ctx.headers })
    }
    // Read before the delete: the records it named are recomputed without it.
    const named = snap.data()
    await ref.delete()
    await settleNextActivity(ctx, [named])
    const view = { id: ref.id, object: 'task', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `GET /v1/tasks` filters, most selective first. */
async function listTasks(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const rawStatus = url.searchParams.get('status')
  if (rawStatus !== null && rawStatus.trim() !== '' && !(TASK_STATUSES as readonly string[]).includes(rawStatus.trim())) {
    return crmValidationFailed(ctx, 'task filter', {
      status: `Must be one of: ${TASK_STATUSES.join(', ')}`,
    })
  }
  const filters = readEqualityFilters(url, [
    'dealId',
    'contactId',
    'companyId',
    'assigneeUid',
    'status',
  ])
  const picklists = await taskPicklistsOf(ctx)
  return listCrm(ctx, collection, url, filters, (doc) => taskView(doc, picklists))
}

export async function handleTasks(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = crmCollection(ctx, CRM_COLLECTIONS.tasks)
  const [, taskId] = segments

  if (!taskId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'crm:read')
      if (denied) return denied
      return listTasks(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'crm:write')
      if (denied) return denied
      return createTask(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const ref = collection.doc(taskId)
  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'crm:read')
    if (denied) return denied
    const snap = await ref.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such task', headers: ctx.headers })
    }
    return apiJson(taskView(snap, await taskPicklistsOf(ctx)), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return updateTask(request, ctx, ref)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return deleteTask(request, ctx, ref)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}
