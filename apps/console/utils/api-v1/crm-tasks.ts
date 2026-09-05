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
 */
import {
  CRM_COLLECTIONS,
  type CrmTask,
  type CrmTaskKind,
  type CrmTaskPriority,
  type CrmTaskStatus,
  createResourceUid,
} from '@aglyn/aglyn/server'
import { apiJson, ApiErrors } from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from '../api-v1'
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
  readChoice,
  readCrmSite,
  readEqualityFilters,
  readOptionalText,
  readRefId,
  refuseUnknownKeys,
  updatePayload,
} from './crm-shared'
import { claimWrite, readJsonBody } from './shared'

const TASK_KINDS = ['call', 'email', 'meeting', 'todo'] as const
const TASK_PRIORITIES = ['low', 'normal', 'high'] as const
const TASK_STATUSES = ['open', 'done'] as const

/** The task object as published. Every writable field appears here. */
function taskView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = (doc.data() ?? {}) as Partial<CrmTask>
  return {
    id: doc.id,
    object: 'task',
    title: data.title ?? null,
    notes: data.notes ?? null,
    kind: data.kind ?? 'todo',
    priority: data.priority ?? 'normal',
    status: data.status ?? 'open',
    dueAt: isoFromMs(data.dueAtMs),
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
  'assigneeUid',
  'contactId',
  'companyId',
  'dealId',
])

interface TaskInput {
  title?: string
  notes?: Clearable<string>
  kind?: CrmTaskKind
  priority?: CrmTaskPriority
  status?: CrmTaskStatus
  dueAtMs?: Clearable<number>
  assigneeUid?: Clearable<string>
  contactId?: Clearable<string>
  companyId?: Clearable<string>
  dealId?: Clearable<string>
}

function readTaskInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
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
  const kind = readChoice(body, 'kind', TASK_KINDS, errors)
  if (kind) values.kind = kind
  const priority = readChoice(body, 'priority', TASK_PRIORITIES, errors)
  if (priority) values.priority = priority
  const status = readChoice(body, 'status', TASK_STATUSES, errors)
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

/** `POST /v1/tasks`. */
async function createTask(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readTaskInput(body, { partial: false })
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
    const { title, kind, priority, status, ...rest } = parsed.values
    const id = createResourceUid()
    await collection.doc(id).create({
      title,
      kind: kind ?? 'todo',
      priority: priority ?? 'normal',
      status: status ?? 'open',
      ...(status === 'done' ? { completedAtMs: Date.now() } : {}),
      ...createPayload(rest),
      ...crmCreateStamp(ctx, site.siteId),
    })
    const view = taskView(await collection.doc(id).get())
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
  const parsed = readTaskInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'task', parsed.errors)
  const snap = await ref.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such task', headers: ctx.headers })
  }
  const refErrors = await taskRefErrors(ctx, parsed.values)
  if (Object.keys(refErrors).length) return crmValidationFailed(ctx, 'task', refErrors)

  const { status, ...rest } = parsed.values
  const update: Record<string, unknown> = updatePayload(rest)
  if (status !== undefined && status !== snap.get('status')) {
    update.status = status
    update.completedAtMs = status === 'done' ? Date.now() : null
  }
  if (Object.keys(update).length > 0) {
    await ref.update({ ...update, updatedAt: Timestamp.now() })
  }
  return apiJson(taskView(await ref.get()), { headers: ctx.headers })
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
    await ref.delete()
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
  return listCrm(ctx, collection, url, filters, taskView)
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
    return apiJson(taskView(snap), { headers: ctx.headers })
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
