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
 * `/v1/deals` (AGL-2606) — the most commercially sensitive row in the CRM.
 *
 * ## The stage owns the status
 *
 * `status` is denormalized from the stage's `kind` (`crm.ts`), so the two
 * can never disagree on a stored deal. A client may move a deal by either
 * name: `stageId` picks a stage and the status follows; `status` alone picks
 * the pipeline's one `won` or `lost` stage, or its FIRST open stage for
 * `open` — a reopen has to land somewhere, and the top of the pipeline is
 * the only somewhere that needs no second field. Both together must agree,
 * and a pair that does not is refused rather than resolved in favor of
 * either, because whichever one we picked would be the one the client did
 * not mean.
 *
 * Every stage move stamps `stageChangedAtMs`, which is what "stuck in
 * stage" reports read, and a move into or out of a closed stage sets or
 * clears `closedAtMs`.
 */
import {
  CRM_COLLECTIONS,
  type CrmDeal,
  type CrmDealStage,
  type CrmDealStatus,
  createResourceUid,
  dealStageById,
} from '@aglyn/aglyn/server'
import { apiJson, ApiErrors } from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from '../api-v1'
import { orderedStages, type ResolvedPipeline, resolvePipeline } from './crm-pipelines'
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

const DEAL_STATUSES = ['open', 'won', 'lost'] as const

/** The deal object as published. Every writable field appears here. */
function dealView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = (doc.data() ?? {}) as Partial<CrmDeal>
  return {
    id: doc.id,
    object: 'deal',
    title: data.title ?? null,
    pipelineId: data.pipelineId ?? null,
    stageId: data.stageId ?? null,
    status: data.status ?? null,
    amountCents: typeof data.amountCents === 'number' ? data.amountCents : null,
    // `'usd'` when absent, as the model says — a deal with no currency is a
    // dollar deal, not a deal with an unknown one.
    currency: data.currency ?? 'usd',
    expectedCloseAt: isoFromMs(data.expectedCloseAtMs),
    closedAt: isoFromMs(data.closedAtMs),
    stageChangedAt: isoFromMs(data.stageChangedAtMs),
    ownerUid: data.ownerUid ?? null,
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    lostReason: data.lostReason ?? null,
    notes: data.notes ?? null,
    siteId: data.hostId ?? null,
    ...crmTimes(data as FirebaseFirestore.DocumentData),
  }
}

const DEAL_WRITABLE = new Set([
  'title',
  'stageId',
  'status',
  'amountCents',
  'currency',
  'expectedCloseAt',
  'ownerUid',
  'contactId',
  'companyId',
  'lostReason',
  'notes',
])

interface DealInput {
  title?: string
  pipelineId?: string
  stageId?: string
  status?: CrmDealStatus
  amountCents?: Clearable<number>
  currency?: string
  expectedCloseAtMs?: Clearable<number>
  ownerUid?: Clearable<string>
  contactId?: Clearable<string>
  companyId?: Clearable<string>
  lostReason?: Clearable<string>
  notes?: Clearable<string>
}

/**
 * The writable half of a deal, validated. `pipelineId` is accepted on a
 * create only: a deal's stages are its pipeline's, and moving one between
 * pipelines is a new deal in the other pipeline, not an edit.
 */
function readDealInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: DealInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: DealInput = {}
  const allowed = new Set(DEAL_WRITABLE)
  if (!partial) {
    allowed.add('consentSiteId')
    allowed.add('pipelineId')
  }
  refuseUnknownKeys(body, allowed, 'deal', errors)
  if (partial && body.pipelineId !== undefined) {
    errors.pipelineId = 'Not writable — create the deal in the other pipeline'
  }

  if (body.title !== undefined || !partial) {
    const title = String(body.title ?? '')
      .trim()
      .slice(0, CRM_TITLE_MAX)
    if (title) values.title = title
    else errors.title = partial ? 'Must not be empty' : 'A title is required'
  }

  if (!partial && body.pipelineId !== undefined) {
    const pipelineId = readRefId(body, 'pipelineId', errors)
    if (pipelineId) values.pipelineId = pipelineId
    else if (pipelineId === null) errors.pipelineId = 'Must be an id'
  }

  const stageId = readRefId(body, 'stageId', errors)
  if (stageId) values.stageId = stageId
  else if (stageId === null) errors.stageId = 'Must be a stage id'

  const status = readChoice(body, 'status', DEAL_STATUSES, errors)
  if (status) values.status = status

  if (body.amountCents !== undefined) {
    if (body.amountCents === null) {
      values.amountCents = null
    } else if (
      typeof body.amountCents !== 'number' ||
      !Number.isInteger(body.amountCents) ||
      body.amountCents < 0
    ) {
      errors.amountCents = 'Must be a whole number of cents, 0 or more'
    } else {
      values.amountCents = body.amountCents
    }
  }

  if (body.currency !== undefined) {
    const currency = String(body.currency ?? '')
      .trim()
      .toLowerCase()
    if (/^[a-z]{3}$/.test(currency)) values.currency = currency
    else errors.currency = 'Must be a three-letter ISO 4217 code, like usd'
  }

  if (body.expectedCloseAt !== undefined) {
    if (body.expectedCloseAt === null) {
      values.expectedCloseAtMs = null
    } else {
      const ms = parseIsoInstant(body.expectedCloseAt)
      if (ms === null) {
        errors.expectedCloseAt =
          'Must be an ISO 8601 instant, like 2026-12-31T00:00:00Z'
      } else {
        values.expectedCloseAtMs = ms
      }
    }
  }

  const ownerUid = readOptionalText(body, 'ownerUid', CRM_TITLE_MAX, errors)
  if (ownerUid !== undefined) values.ownerUid = ownerUid
  const contactId = readRefId(body, 'contactId', errors)
  if (contactId !== undefined) values.contactId = contactId
  const companyId = readRefId(body, 'companyId', errors)
  if (companyId !== undefined) values.companyId = companyId
  const lostReason = readOptionalText(body, 'lostReason', CRM_TEXT_MAX, errors)
  if (lostReason !== undefined) values.lostReason = lostReason
  const notes = readOptionalText(body, 'notes', CRM_TEXT_MAX, errors)
  if (notes !== undefined) values.notes = notes

  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * The stage a write lands the deal in, from `stageId` and/or `status` — see
 * the module header for the rule. `null` when neither was sent, which on a
 * PATCH means "leave the stage alone" and on a create means the first open
 * stage.
 */
function resolveStage(
  pipeline: ResolvedPipeline['pipeline'],
  values: Pick<DealInput, 'stageId' | 'status'>,
): { stage: CrmDealStage | null } | { errors: Record<string, string> } {
  const stages = orderedStages(pipeline)
  if (values.stageId) {
    const stage = dealStageById(pipeline, values.stageId)
    if (!stage) return { errors: { stageId: 'No such stage in this pipeline' } }
    if (values.status && values.status !== stage.kind) {
      return { errors: { status: `Must match the stage, which is ${stage.kind}` } }
    }
    return { stage }
  }
  if (values.status) {
    const stage =
      values.status === 'open'
        ? stages.find((candidate) => candidate.kind === 'open')
        : stages.find((candidate) => candidate.kind === values.status)
    if (!stage) {
      return { errors: { status: `This pipeline has no ${values.status} stage` } }
    }
    return { stage }
  }
  return { stage: null }
}

/** The fields a stage move writes, beside the stage itself. */
function stageMove(stage: CrmDealStage, nowMs: number) {
  return {
    stageId: stage.id,
    status: stage.kind,
    stageChangedAtMs: nowMs,
    closedAtMs: stage.kind === 'open' ? null : nowMs,
  }
}

/** The membership and reference checks a deal write makes, merged. */
async function dealRefErrors(
  ctx: ApiV1Context,
  values: DealInput,
): Promise<Record<string, string>> {
  const [owner, refs] = await Promise.all([
    memberError(ctx, 'ownerUid', values.ownerUid),
    crmRefErrors(ctx, {
      contactId: values.contactId ?? undefined,
      companyId: values.companyId ?? undefined,
    }),
  ])
  return { ...owner, ...refs }
}

/**
 * `POST /v1/deals`. The pipeline is resolved AFTER the claim because
 * resolving it can create one (`resolvePipeline`), and a refusal past that
 * point releases the key so the retry that names a real stage still can.
 */
async function createDeal(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readDealInput(body, { partial: false })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'deal', parsed.errors)
  const site = readCrmSite(ctx, 'deal', body)
  if ('response' in site) return site.response
  const refErrors = await dealRefErrors(ctx, parsed.values)
  if (Object.keys(refErrors).length) return crmValidationFailed(ctx, 'deal', refErrors)

  const collection = crmCollection(ctx, CRM_COLLECTIONS.deals)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'deals',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const { title, pipelineId, stageId, status, ...rest } = parsed.values
    const resolved = await resolvePipeline(ctx, site.siteId, pipelineId)
    if ('error' in resolved) {
      await claim.release()
      return crmValidationFailed(ctx, 'deal', { pipelineId: resolved.error })
    }
    const placed = resolveStage(resolved.pipeline, { stageId, status })
    if ('errors' in placed) {
      await claim.release()
      return crmValidationFailed(ctx, 'deal', placed.errors)
    }
    const stage = placed.stage ?? orderedStages(resolved.pipeline)[0]
    if (!stage) {
      await claim.release()
      return crmValidationFailed(ctx, 'deal', {
        pipelineId: 'This pipeline has no stages',
      })
    }
    const id = createResourceUid()
    await collection.doc(id).create({
      title,
      titleLower: (title ?? '').toLowerCase(),
      pipelineId: resolved.id,
      ...createPayload({ ...rest, ...stageMove(stage, Date.now()) }),
      ...crmCreateStamp(ctx, site.siteId),
    })
    const view = dealView(await collection.doc(id).get())
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `PATCH /v1/deals/{id}`. */
async function updateDeal(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const parsed = readDealInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'deal', parsed.errors)
  const snap = await ref.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such deal', headers: ctx.headers })
  }
  const refErrors = await dealRefErrors(ctx, parsed.values)
  if (Object.keys(refErrors).length) return crmValidationFailed(ctx, 'deal', refErrors)

  const { title, stageId, status, ...rest } = parsed.values
  const update: Record<string, unknown> = {
    ...(title !== undefined ? { title, titleLower: title.toLowerCase() } : {}),
    ...updatePayload(rest),
  }
  if (stageId !== undefined || status !== undefined) {
    const current = snap.data() as CrmDeal
    const resolved = await resolvePipeline(ctx, current.hostId, current.pipelineId)
    if ('error' in resolved) {
      return crmValidationFailed(ctx, 'deal', {
        stageId: "This deal's pipeline no longer exists",
      })
    }
    const placed = resolveStage(resolved.pipeline, { stageId, status })
    if ('errors' in placed) return crmValidationFailed(ctx, 'deal', placed.errors)
    if (placed.stage && placed.stage.id !== current.stageId) {
      Object.assign(update, stageMove(placed.stage, Date.now()))
    }
  }
  if (Object.keys(update).length > 0) {
    await ref.update({ ...update, updatedAt: Timestamp.now() })
  }
  return apiJson(dealView(await ref.get()), { headers: ctx.headers })
}

/** `DELETE /v1/deals/{id}` — the deal alone; its tasks and activities stay. */
async function deleteDeal(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'deal-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const snap = await ref.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({ message: 'No such deal', headers: ctx.headers })
    }
    await ref.delete()
    const view = { id: ref.id, object: 'deal', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * `GET /v1/deals` filters, most selective first — the order `listCrm`
 * indexes them in. `status` is validated against the three values a deal
 * can hold, because `?status=closed` matching nothing is the plausible empty
 * page the conventions refuse to serve.
 */
async function listDeals(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const rawStatus = url.searchParams.get('status')
  if (rawStatus !== null && rawStatus.trim() !== '' && !(DEAL_STATUSES as readonly string[]).includes(rawStatus.trim())) {
    return crmValidationFailed(ctx, 'deal filter', {
      status: `Must be one of: ${DEAL_STATUSES.join(', ')}`,
    })
  }
  const filters = readEqualityFilters(url, [
    'contactId',
    'companyId',
    'pipelineId',
    'ownerUid',
    'status',
  ])
  return listCrm(ctx, collection, url, filters, dealView)
}

export async function handleDeals(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = crmCollection(ctx, CRM_COLLECTIONS.deals)
  const [, dealId] = segments

  if (!dealId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'crm:read')
      if (denied) return denied
      return listDeals(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'crm:write')
      if (denied) return denied
      return createDeal(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const ref = collection.doc(dealId)
  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'crm:read')
    if (denied) return denied
    const snap = await ref.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such deal', headers: ctx.headers })
    }
    return apiJson(dealView(snap), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return updateDeal(request, ctx, ref)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return deleteDeal(request, ctx, ref)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}
