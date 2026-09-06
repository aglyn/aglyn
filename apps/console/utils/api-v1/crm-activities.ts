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
 * `/v1/activities` (AGL-2606) — one thing that happened, logged by a person
 * or by an integration: a call made, a meeting held, a note taken.
 *
 * An activity is a LOG ENTRY, and a log is written once. There is no
 * `PATCH`: an entry that turns out to be wrong is deleted and logged again,
 * which keeps every row's `at` and `byUid` the record of what was logged
 * rather than what somebody later wished had been. It also has to hang off
 * something — a contact, a company or a deal — because an activity attached
 * to nothing is a sentence nobody can find from anywhere.
 */
import {
  CRM_COLLECTIONS,
  type CrmActivity,
  type CrmActivityKind,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  createResourceUid,
  crmActivityLogHasRoom,
} from '@aglyn/aglyn/server'
import {
  apiJson,
  ApiErrors,
  countCrmActivitiesForRecord,
} from '@aglyn/tenant-data-admin'
import { type ApiV1Context, requireScope } from '../api-v1'
import {
  CRM_LABEL_MAX,
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
} from './crm-shared'
import { claimWrite, readJsonBody } from './shared'

const ACTIVITY_KINDS = ['call', 'email', 'meeting', 'note', 'other'] as const

/** The activity object as published. */
function activityView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = (doc.data() ?? {}) as Partial<CrmActivity>
  return {
    id: doc.id,
    object: 'activity',
    kind: data.kind ?? 'note',
    body: data.body ?? null,
    at: isoFromMs(data.atMs),
    byUid: data.byUid ?? null,
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    dealId: data.dealId ?? null,
    outcome: data.outcome ?? null,
    durationMinutes:
      typeof data.durationMinutes === 'number' ? data.durationMinutes : null,
    siteId: data.hostId ?? null,
    ...crmTimes(data as FirebaseFirestore.DocumentData),
  }
}

const ACTIVITY_WRITABLE = new Set([
  'kind',
  'body',
  'at',
  'byUid',
  'contactId',
  'companyId',
  'dealId',
  'outcome',
  'durationMinutes',
  'consentSiteId',
])

interface ActivityInput {
  kind?: CrmActivityKind
  body: string
  atMs?: number
  byUid?: string
  contactId?: string
  companyId?: string
  dealId?: string
  outcome?: string
  durationMinutes?: number
}

function readActivityInput(
  body: Record<string, unknown>,
): { values: ActivityInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  refuseUnknownKeys(body, ACTIVITY_WRITABLE, 'activity', errors)

  const text = String(body.body ?? '')
    .trim()
    .slice(0, CRM_TEXT_MAX)
  if (!text) errors.body = 'A body is required'
  const values: ActivityInput = { body: text }

  const kind = readChoice(body, 'kind', ACTIVITY_KINDS, errors)
  if (kind) values.kind = kind

  if (body.at !== undefined) {
    const ms = parseIsoInstant(body.at)
    if (ms === null) errors.at = 'Must be an ISO 8601 instant, like 2026-09-04T16:30:00Z'
    else values.atMs = ms
  }

  const byUid = readOptionalText(body, 'byUid', CRM_TITLE_MAX, errors)
  if (byUid) values.byUid = byUid
  for (const field of ['contactId', 'companyId', 'dealId'] as const) {
    const id = readRefId(body, field, errors)
    if (id) values[field] = id
  }
  if (!values.contactId && !values.companyId && !values.dealId && !errors.contactId) {
    errors.contactId = 'Name a contactId, companyId or dealId — an activity is logged against something'
  }

  const outcome = readOptionalText(body, 'outcome', CRM_LABEL_MAX, errors)
  if (outcome) values.outcome = outcome

  if (body.durationMinutes !== undefined && body.durationMinutes !== null) {
    if (
      typeof body.durationMinutes !== 'number' ||
      !Number.isInteger(body.durationMinutes) ||
      body.durationMinutes < 0
    ) {
      errors.durationMinutes = 'Must be a whole number of minutes, 0 or more'
    } else {
      values.durationMinutes = body.durationMinutes
    }
  }

  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * `POST /v1/activities`. `at` defaults to now and `byUid` to `'api'`: an
 * integration logging a call as it ends is the common case, and the one
 * logging it on behalf of a member names them.
 */
async function createActivity(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readActivityInput(body)
  if ('errors' in parsed) return crmValidationFailed(ctx, 'activity', parsed.errors)
  const site = readCrmSite(ctx, 'activity', body)
  if ('response' in site) return site.response
  const [by, refs] = await Promise.all([
    memberError(ctx, 'byUid', parsed.values.byUid),
    crmRefErrors(ctx, {
      contactId: parsed.values.contactId,
      companyId: parsed.values.companyId,
      dealId: parsed.values.dealId,
    }),
  ])
  const refErrors = { ...by, ...refs }
  if (Object.keys(refErrors).length) {
    return crmValidationFailed(ctx, 'activity', refErrors)
  }

  const collection = crmCollection(ctx, CRM_COLLECTIONS.activities)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'activities',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const { kind, atMs, byUid, ...rest } = parsed.values
    // The per-record ceiling (AGL-2611): one aggregate on the record the
    // activity is filed under. A platform bound rather than a plan one, so
    // it is a conflict with the record's state, not a plan refusal.
    const logged = await countCrmActivitiesForRecord(
      ctx.firestore.collection('orgs').doc(ctx.orgId),
      parsed.values,
    )
    if (!crmActivityLogHasRoom(logged)) {
      await claim.release()
      return ApiErrors.conflict({
        message: CRM_ACTIVITY_LOG_FULL_MESSAGE,
        code: 'activity_log_full',
        headers: ctx.headers,
      })
    }
    const id = createResourceUid()
    const stamp = crmCreateStamp(ctx, site.siteId)
    await collection.doc(id).create({
      kind: kind ?? 'note',
      // The instant the record was created, from the same clock as its
      // `createdAt`, so an activity logged as it happened reads as one moment.
      atMs: atMs ?? stamp.createdAt.toMillis(),
      byUid: byUid ?? 'api',
      ...createPayload(rest),
      ...stamp,
    })
    const view = activityView(await collection.doc(id).get())
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `DELETE /v1/activities/{id}`. */
async function deleteActivity(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'activity-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const snap = await ref.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({ message: 'No such activity', headers: ctx.headers })
    }
    await ref.delete()
    const view = { id: ref.id, object: 'activity', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `GET /v1/activities` filters, most selective first. */
async function listActivities(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const rawKind = url.searchParams.get('kind')
  if (rawKind !== null && rawKind.trim() !== '' && !(ACTIVITY_KINDS as readonly string[]).includes(rawKind.trim())) {
    return crmValidationFailed(ctx, 'activity filter', {
      kind: `Must be one of: ${ACTIVITY_KINDS.join(', ')}`,
    })
  }
  const filters = readEqualityFilters(url, ['dealId', 'contactId', 'companyId', 'kind'])
  return listCrm(ctx, collection, url, filters, activityView)
}

export async function handleActivities(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = crmCollection(ctx, CRM_COLLECTIONS.activities)
  const [, activityId] = segments

  if (!activityId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'crm:read')
      if (denied) return denied
      return listActivities(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'crm:write')
      if (denied) return denied
      return createActivity(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const ref = collection.doc(activityId)
  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'crm:read')
    if (denied) return denied
    const snap = await ref.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such activity', headers: ctx.headers })
    }
    return apiJson(activityView(snap), { headers: ctx.headers })
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return deleteActivity(request, ctx, ref)
  }
  // No PATCH — see the module header. The `Allow` header says so rather
  // than a 404 that reads as "no such activity".
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, DELETE' },
  })
}
