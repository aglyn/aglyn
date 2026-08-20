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
 * Resource handlers for the customer REST API v1 (AGL-618). All data is
 * org-scoped from the authenticated key (see api-v1.ts). Datasets/records are
 * the headline CRUD surface; sites, form submissions, and contacts are read.
 */
import {
  type AttemptClaim,
  checkApiRequestQuota,
  checkContactQuota,
  checkDataStorageQuota,
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  claimAttempt,
  coerceDocumentValues,
  createResourceUid,
  defaultScopeForNewResource,
  effectiveDatasetModel,
  newResourceScopeFields,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
  screenRoutePathToUrl,
  validateDocument,
} from '@aglyn/aglyn/server'
import {
  apiJson,
  ApiErrors,
  consumeRateLimit,
  dataStorageRefusal,
  decodeCursor,
  encodeCursor,
  listResponse,
  parseLimit,
} from '@aglyn/tenant-data-admin'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, apiUsageMonth, requireScope } from './api-v1'
import { postTenantRevalidate } from './server/tenant-revalidate'

// ── Serialization ───────────────────────────────────────────────────────────

/** Firestore values → JSON-safe values (Timestamps become ISO strings). */
function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

// ── Cursor pagination over a Firestore collection ───────────────────────────

interface Paginated {
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
  nextCursor: string | null
}

async function paginate(
  query: FirebaseFirestore.Query,
  url: URL,
): Promise<Paginated> {
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  let q = query.orderBy(FieldPath.documentId()).limit(limit + 1)
  if (cursor) q = q.startAfter(cursor)
  const snap = await q.get()
  const docs = snap.docs.slice(0, limit)
  const nextCursor =
    snap.docs.length > limit && docs.length > 0
      ? encodeCursor(docs[docs.length - 1].id)
      : null
  return { docs, nextCursor }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

// ── Idempotency ─────────────────────────────────────────────────────────────

/**
 * Take an exclusive claim on one write attempt (AGL-1709), and translate the
 * transport-agnostic result into a v1 `Response`.
 *
 * The claim itself is the shared `claimAttempt` (AGL-1697, `220217133`) — an
 * unconditional `create()`, where Firestore's rejection on an existing document
 * IS the dedupe primitive. This resource used to run its own read-then-create,
 * which is the exact race the mechanism exists to prevent: two concurrent
 * requests carrying one key both read "no prior key", both fall through, both
 * create. Worse than no check at all in one respect, because it made the path
 * look protected. Adopting the shared claim rather than fixing the local copy
 * is the point — POS, refunds and the REST API now answer this question once.
 *
 * `scopeId` carries the ORG as well as the dataset. The helper hashes
 * `{kind}:{scopeId}:{key}` and its plugin callers pass a globally unique host
 * id, but a dataset id is only meaningful under its org — and the claim stores
 * the response body, so a cross-org digest collision would replay one tenant's
 * record to another. The org belongs in the digest, not just in the swept
 * field. Scoping by the DATASET is what `apps/docs/api/conventions.md` already
 * publishes ("replay is looked up within the dataset you're posting to"); the
 * old org-only digest only reached that outcome by accident, by reading a
 * `recordId` that did not exist in the other dataset and falling through — and
 * having fallen through, its key write failed and was swallowed, so the key
 * never deduped there at all.
 *
 * NOTE: the digest changes, so keys stored under the old `orgId:key` shape are
 * orphaned and a retry straddling this deploy creates a duplicate. Accepted —
 * the API is pre-beta and the alternative is carrying the race forever.
 *
 * `kind` separates the create's claims from the delete's (AGL-1710). The
 * helper hashes it into the digest for exactly this reason, and the two record
 * different response BODIES — a record view versus a `{ deleted: true }`
 * receipt. Sharing one namespace would let a key reused across both operations
 * replay the create's record to a delete, which a client parses as a success
 * and which no amount of documentation makes safe. `POST` keeps `records`
 * verbatim: changing its digest orphans keys in flight, and AGL-1709 already
 * paid that cost once.
 *
 * `scopeSuffix` is the object the key is scoped WITHIN — a dataset id for the
 * record operations and for `DELETE /v1/datasets/{id}`, the site for
 * `DELETE …/form-submissions/{id}`, and `*` — the ORGANIZATION — for
 * `POST /v1/datasets` (AGL-2126), where there is no dataset id yet because
 * the request is what creates one, and for both contact writes (AGL-2276),
 * where the organization genuinely IS the containing object: contacts are
 * org-scoped (AGL-237), so there is no site or parent collection to scope to
 * and pretending otherwise would invent a boundary the data does not have.
 * `*` cannot collide with a resource id: `createResourceUid()` never emits
 * one, and the `kind` is separate anyway. The suffix is not the whole story —
 * `kind` is hashed in too, which is what keeps a create's key from replaying
 * into a delete, and what keeps `contacts` and `contact-deletes` apart while
 * they share a suffix.
 *
 * This paragraph used to say `*` covered "the two that act on the dataset
 * collection itself", which the delete has never done — it passes
 * `datasetRef.id`. The published contract in `apps/docs/api/conventions.md` was
 * written from this comment and inherited the error (AGL-2218), which is the
 * argument for reading the call rather than the docblock above it.
 */
async function claimWrite(
  ctx: ApiV1Context,
  scopeSuffix: string,
  key: string | null,
  kind:
    | 'records'
    | 'record-deletes'
    | 'datasets'
    | 'dataset-deletes'
    | 'form-submission-deletes'
    | 'contacts'
    | 'contact-deletes',
): Promise<{ claim: AttemptClaim } | { replay: Response }> {
  const result = await claimAttempt(ctx.firestore, {
    kind,
    scopeId: `${ctx.orgId}:${scopeSuffix}`,
    // The field `eraseOrgIdempotencyKeys` sweeps on (AGL-1448).
    orgId: ctx.orgId,
    key: key ?? '',
    busyMessage: 'A request with this Idempotency-Key is still in progress',
  })
  if ('claim' in result) return result
  // The helper is transport-agnostic and answers `{ status, body }`; its
  // plugin callers hand that straight to a pages-API `res.json()`. v1 publishes
  // a `{ error: { type, message, code } }` envelope that clients branch on, so
  // the refusal is rebuilt here rather than leaking the helper's bare
  // `{ error: '<sentence>' }` onto a documented surface.
  if (result.replay.status === 409) {
    return {
      replay: ApiErrors.conflict({
        message: 'A request with this Idempotency-Key is still in progress',
        code: 'idempotency_in_progress',
        headers: ctx.headers,
      }),
    }
  }
  // Settled: replay the ORIGINAL response, from the stored body rather than a
  // fresh read — which is what makes it survive a record since edited or
  // deleted. The old lookup replayed only while the record still existed and
  // fell through to a SECOND create otherwise.
  return {
    replay: apiJson(result.replay.body, {
      status: result.replay.status,
      headers: ctx.headers,
    }),
  }
}

// ── Datasets & records ──────────────────────────────────────────────────────

const datasetName = (data: FirebaseFirestore.DocumentData): string =>
  (data.displayName as string) ?? (data.name as string) ?? ''

function datasetView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'dataset',
    name: datasetName(data),
    fields: data.fields ?? [],
    created: serialize(data.createdAt) ?? null,
  }
}

function recordView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'record',
    values: serialize(data.values ?? {}),
    created: serialize(data.createdAt) ?? null,
    updated: serialize(data.updatedAt) ?? null,
  }
}

function datasetsCollection(ctx: ApiV1Context) {
  return ctx.firestore.collection('orgs').doc(ctx.orgId).collection('datasets')
}

/** Serialized `model` ceiling, matching the console's create route. */
const DATASET_MODEL_MAX_BYTES = 64 * 1024
const DATASET_NAME_MAX = 120
const DATASET_FIELDS_MAX = 100

/**
 * Validate the writable half of a dataset document (AGL-2126). Returns the
 * cleaned values, or the per-field map `conventions.md` publishes under
 * `validation_failed` — the same shape `validateDocument` produces for a
 * record, so a client branches on one thing across the whole resource.
 *
 * `partial` is what separates PATCH from POST: a create must be told a name
 * and at least one field, an update may send either alone. Absent keys are
 * left alone rather than cleared, because a PATCH that silently emptied
 * `fields` would take a dataset's schema away on a typo'd request body.
 */
function readDatasetInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
):
  | { values: { name?: string; fields?: string[]; model?: unknown } }
  | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: { name?: string; fields?: string[]; model?: unknown } = {}

  const hasName = body.name !== undefined
  if (hasName || !partial) {
    const name = String(body.name ?? '').trim().slice(0, DATASET_NAME_MAX)
    if (!name) errors.name = 'Required'
    else values.name = name
  }

  const hasFields = body.fields !== undefined
  if (hasFields || !partial) {
    if (!Array.isArray(body.fields)) {
      errors.fields = 'Must be an array of field names'
    } else {
      const fields = (body.fields as unknown[])
        .map((field) => String(field).trim())
        .filter((field) => field.length > 0)
        .slice(0, DATASET_FIELDS_MAX)
      if (fields.length === 0) errors.fields = 'At least one field is required'
      else values.fields = fields
    }
  }

  if (body.model !== undefined) {
    if (!body.model || typeof body.model !== 'object') {
      errors.model = 'Must be an object'
    } else if (JSON.stringify(body.model).length > DATASET_MODEL_MAX_BYTES) {
      errors.model = `Must serialize to under ${DATASET_MODEL_MAX_BYTES} bytes`
    } else {
      values.model = body.model
    }
  }

  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * `POST /v1/datasets` (AGL-2126) — the call that lets the API bootstrap itself.
 *
 * Until this shipped, `/v1` could create and edit RECORDS but not the dataset
 * holding them, so an agency provisioning a client workspace, or a developer
 * keeping a schema in source control, had to click a dataset into existence
 * before their first API call could do anything. The console has been able to
 * do this all along (`apps/console/app/api/orgs/datasets`, `create-dataset`).
 *
 * The gates are the console route's, not a looser set. `dataStore` is the
 * entitlement, `checkDatasetQuota` is add-on aware, and — the one that is
 * invisible until it bites — `newResourceScopeFields` stamps `visibleTo`.
 * A dataset created without it matches no `array-contains-any` and therefore
 * renders on NO site at all (AGL-1044): the API would happily create data
 * that never appears anywhere, which is worse than refusing.
 */
async function createDataset(
  request: Request,
  ctx: ApiV1Context,
): Promise<Response> {
  if (!checkEntitlement(ctx.org, 'dataStore')) {
    return ApiErrors.planRequired({
      message: 'Datasets are not included in this organization’s plan',
      code: 'data_store',
      headers: ctx.headers,
    })
  }

  const parsed = readDatasetInput(await readJsonBody(request), {
    partial: false,
  })
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Dataset failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }

  /*
   * CLAIM ABOVE THE QUOTA (AGL-2296), and release on the refusal.
   *
   * This used to check the quota first and claim after, so that a refusal an
   * integrator can act on never consumed their key — a plan refusal is the
   * most retried failure there is, and it clears when somebody buys an
   * add-on. That reasoning is right and is preserved by the `release()`
   * below; the ORDERING it produced was not. A create that consumed the LAST
   * included slot could not be retried at all: the retry re-counts, is now AT
   * the band, and is refused before the claim is ever consulted — so the
   * replay never happens and the integrator cannot tell whether the dataset
   * exists. `conventions.md` publishes the opposite promise.
   *
   * Claiming first and releasing on each refusal gets both properties at
   * once, which is the trade `deleteRecord` already argues for and
   * `createContact` follows. Validation stays above: a deterministic 400 must
   * never take a key at all.
   */
  const collection = datasetsCollection(ctx)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'datasets',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const datasetCount = (await collection.count().get()).data().count
    const quota = checkDatasetQuota(ctx.org, datasetCount)
    if (!quota.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message:
          `Dataset limit reached (${quota.limit}). ` +
          (quota.upgradeRequired
            ? 'Upgrade the plan to add more.'
            : `Buy extra datasets for $${quota.addonPriceUsd}/mo each, or upgrade.`),
        code: 'dataset_quota',
        headers: ctx.headers,
      })
    }

    const id = createResourceUid()
    await collection.doc(id).create({
      displayName: parsed.values.name,
      fields: parsed.values.fields,
      ...(parsed.values.model ? { model: parsed.values.model } : {}),
      // AGL-1484: the required argument exists so a creator that has not
      // decided cannot compile. No site is in context on an org-scoped API
      // key, so the org's own default is the only honest answer.
      ...newResourceScopeFields(
        defaultScopeForNewResource({
          defaultResourceScope: (
            ctx.org as { defaultResourceScope?: 'org' | 'host' }
          )?.defaultResourceScope,
          hostId: null,
        }),
      ),
      createdAt: Timestamp.now(),
    })
    const view = datasetView(await collection.doc(id).get())
    // Stored as 200 so a replay is distinguishable from the fresh 201 — the
    // rule `conventions.md` publishes and `createRecord` already follows.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    // Same direction as every other v1 write: a stranded key is irreversible
    // from outside, a duplicate dataset is one DELETE away.
    await claim.release()
    throw error
  }
}

/**
 * `PATCH /v1/datasets/{id}` — rename, re-field, or re-model. Takes no
 * `Idempotency-Key` and does not need one, for `updateRecord`'s reason: the
 * same body twice lands the same state AND returns the same `200`.
 */
async function updateDataset(
  request: Request,
  ctx: ApiV1Context,
  datasetRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const snap = await datasetRef.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such dataset', headers: ctx.headers })
  }
  const parsed = readDatasetInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Dataset failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }
  const { name, fields, model } = parsed.values
  const update: Record<string, unknown> = {}
  if (name !== undefined) update.displayName = name
  if (fields !== undefined) update.fields = fields
  if (model !== undefined) update.model = model
  // An empty body is a no-op, answered with the current dataset rather than a
  // 400: a client re-sending an unchanged object should not have to special-
  // case it, and there is no state to disagree about.
  if (Object.keys(update).length > 0) await datasetRef.update(update)
  return apiJson(datasetView(await datasetRef.get()), { headers: ctx.headers })
}

/**
 * `DELETE /v1/datasets/{id}` — refuses while records remain.
 *
 * A recursive delete is not something a single REST call should do quietly:
 * the records are the customer's content, and one mistyped id would take all
 * of them with no receipt naming what went. So this answers `409 conflict`
 * with the count, and the integrator deletes the records first — with the
 * same key semantics, through an endpoint that already exists.
 */
async function deleteDataset(
  request: Request,
  ctx: ApiV1Context,
  datasetRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    datasetRef.id,
    request.headers.get('Idempotency-Key'),
    'dataset-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const snap = await datasetRef.get()
    if (!snap.exists) {
      // Release: a wrong id is the integrator's to correct and retry with the
      // same key, exactly as `deleteRecord` does.
      await claim.release()
      return ApiErrors.notFound({ message: 'No such dataset', headers: ctx.headers })
    }
    const records = (await datasetRef.collection('records').count().get()).data()
      .count
    if (records > 0) {
      // Release too — this refusal clears once the records are gone, and the
      // retry that should then succeed must not replay the refusal.
      await claim.release()
      return ApiErrors.conflict({
        message: `Dataset still holds ${records} record${
          records === 1 ? '' : 's'
        }. Delete them first.`,
        code: 'dataset_not_empty',
        headers: ctx.headers,
      })
    }
    await datasetRef.delete()
    const view = { id: datasetRef.id, object: 'dataset', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

async function handleDatasets(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, datasetId, sub, recordId] = segments

  // /v1/datasets
  if (!datasetId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'datasets:read')
      if (denied) return denied
      const { docs, nextCursor } = await paginate(datasetsCollection(ctx), url)
      return listResponse(docs.map(datasetView), nextCursor, ctx.headers)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'datasets:write')
      if (denied) return denied
      return createDataset(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const datasetRef = datasetsCollection(ctx).doc(datasetId)

  // /v1/datasets/{id}
  if (!sub) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'datasets:read')
      if (denied) return denied
      const snap = await datasetRef.get()
      if (!snap.exists) {
        return ApiErrors.notFound({ message: 'No such dataset', headers: ctx.headers })
      }
      return apiJson(datasetView(snap), { headers: ctx.headers })
    }
    if (request.method === 'PATCH') {
      const denied = requireScope(ctx, 'datasets:write')
      if (denied) return denied
      return updateDataset(request, ctx, datasetRef)
    }
    if (request.method === 'DELETE') {
      const denied = requireScope(ctx, 'datasets:write')
      if (denied) return denied
      return deleteDataset(request, ctx, datasetRef)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
    })
  }

  if (sub !== 'records') {
    return ApiErrors.notFound({ message: `Unknown endpoint`, headers: ctx.headers })
  }

  const datasetSnap = await datasetRef.get()
  if (!datasetSnap.exists) {
    return ApiErrors.notFound({ message: 'No such dataset', headers: ctx.headers })
  }
  const recordsRef = datasetRef.collection('records')

  // /v1/datasets/{id}/records
  if (!recordId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'datasets:read')
      if (denied) return denied
      const { docs, nextCursor } = await paginate(recordsRef, url)
      return listResponse(docs.map(recordView), nextCursor, ctx.headers)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'datasets:write')
      if (denied) return denied
      return createRecord(request, ctx, datasetSnap, recordsRef)
    }
    return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  }

  // /v1/datasets/{id}/records/{recordId}
  const recordRef = recordsRef.doc(recordId)
  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'datasets:read')
    if (denied) return denied
    const snap = await recordRef.get()
    if (!snap.exists) return ApiErrors.notFound({ message: 'No such record', headers: ctx.headers })
    return apiJson(recordView(snap), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'datasets:write')
    if (denied) return denied
    return updateRecord(request, ctx, datasetSnap, recordRef)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'datasets:write')
    if (denied) return denied
    return deleteRecord(request, ctx, datasetSnap.id, recordRef)
  }
  return ApiErrors.methodNotAllowed({ headers: ctx.headers })
}

async function createRecord(
  request: Request,
  ctx: ApiV1Context,
  datasetSnap: FirebaseFirestore.DocumentSnapshot,
  recordsRef: FirebaseFirestore.CollectionReference,
): Promise<Response> {
  const model = effectiveDatasetModel(datasetSnap.data() ?? {})
  const body = await readJsonBody(request)
  const coerced = coerceDocumentValues(model, (body.values as Record<string, unknown>) ?? {})
  const errors = validateDocument(model, coerced)
  if (Object.keys(errors).length) {
    return ApiErrors.badRequest({
      message: 'Record failed validation',
      headers: ctx.headers,
      code: 'validation_failed',
      // Name the offending fields (AGL-901): validateDocument already
      // produces this map, and a bare 'something is wrong' on a 20-field
      // record leaves an integrator bisecting their payload.
      fields: errors,
    })
  }

  /*
   * THE TWO QUOTAS THIS ROUTE DID NOT HAVE (AGL-2253).
   *
   * `POST /v1/datasets/{id}/records` counted rows only to compute `order` and
   * checked nothing: not `recordsPerDataset`, not `dataStorageMbPerOrg`. The
   * console route (`/api/orgs/datasets`) enforces both on the same write, and
   * the tenant form path enforces the rows half — so `/v1` was the one door
   * into `orgs/{id}/datasets/{id}/records` with no cap on it, and a customer
   * could blow a limit through the REST API that the UI refuses.
   *
   * They sit BELOW the idempotency claim (AGL-2296), which is a change from
   * how they shipped. Checking them first protected the key on a refusal —
   * right, and kept by the `release()` calls below — but it made a create
   * that consumed the LAST included row impossible to retry: the retry
   * re-counts, is now AT the band, and is refused before the claim is
   * consulted, so the replay never happens. The bytes leg is worse in
   * practice, because a bulk import crosses the storage band mid-run and
   * every retry from that point on is refused rather than replayed.
   *
   * The row count is reused for `order`, so this adds no read on the rows
   * leg. The bytes leg adds no read either on any plan that meters the
   * overage; see `dataStorageRefusal`.
   */
  // Idempotency: replay a prior create for the same key instead of
  // duplicating. Claimed HERE, below validation, so a deterministic 400 never
  // takes the key at all — an integrator fixes the payload and retries with
  // the same key, exactly as the POS cashier does (AGL-1691).
  const claimed = await claimWrite(
    ctx,
    datasetSnap.id,
    request.headers.get('Idempotency-Key'),
    'records',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const order = (await recordsRef.count().get()).data().count
    const recordQuota = checkQuota(ctx.org, 'recordsPerDataset', order)
    if (!recordQuota.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message: `Record limit reached (${recordQuota.limit}). Upgrade the plan to add more.`,
        code: 'record_quota',
        headers: ctx.headers,
      })
    }
    const storageRefusal = await dataStorageRefusal(
      ctx.org,
      ctx.firestore.collection('orgs').doc(ctx.orgId),
    )
    if (storageRefusal) {
      await claim.release()
      return ApiErrors.planRequired({
        message:
          storageRefusal.basis === 'always'
            ? 'Dataset storage is not included in this organization’s plan'
            : `Dataset storage limit reached (${storageRefusal.includedMb} MB). Upgrade the plan to add more.`,
        code: 'data_storage_quota',
        headers: ctx.headers,
      })
    }

    const recordId = createResourceUid()
    await recordsRef.doc(recordId).create({
      values: coerced,
      order,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    const created = await recordsRef.doc(recordId).get()
    const view = recordView(created)
    // Recorded as 200, never the 201 this answers: `conventions.md` publishes
    // the status as how a client tells a fresh create from a replay, and that
    // is the contract integrations branch on.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    /*
     * Release on EVERY failure, including one whose outcome we cannot know —
     * the deliberate opposite of the refund (AGL-1696, `2dd52f01c`), which
     * strands the key on a throw. Same reasoning, applied where its money term
     * is absent.
     *
     * NOTHING on `/v1` moves money — the write surface is datasets, records,
     * the form-submission `read` flag and contacts (AGL-2276), while orders
     * and products stay read-only precisely because writing them would — so
     * "a released key costs a second refund" has no analogue here. The costs invert instead. A duplicate record is visible and
     * reversible BY THE INTEGRATOR with `DELETE /v1/datasets/{id}/records/{id}`
     * — same API, same scope, one extra call. A stranded key is irreversible
     * from outside: keys are documented as never expiring, and an integrator
     * derives them from their own upstream event ids precisely so retries
     * dedupe, so a stranded key means that event can never be written at all.
     *
     * Residual: a process killed between the claim and the record strands the
     * key regardless. `createdAtMs` is written so a sweeper can reap those.
     */
    await claim.release()
    throw error
  }
}

async function updateRecord(
  request: Request,
  ctx: ApiV1Context,
  datasetSnap: FirebaseFirestore.DocumentSnapshot,
  recordRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const snap = await recordRef.get()
  if (!snap.exists) return ApiErrors.notFound({ message: 'No such record', headers: ctx.headers })

  const model = effectiveDatasetModel(datasetSnap.data() ?? {})
  const body = await readJsonBody(request)
  // PATCH merges the supplied fields over the stored values.
  const merged = {
    ...((snap.get('values') as Record<string, unknown>) ?? {}),
    ...coerceDocumentValues(model, (body.values as Record<string, unknown>) ?? {}),
  }
  const errors = validateDocument(model, merged)
  if (Object.keys(errors).length) {
    return ApiErrors.badRequest({
      message: 'Record failed validation',
      headers: ctx.headers,
      code: 'validation_failed',
      // Name the offending fields (AGL-901): validateDocument already
      // produces this map, and a bare 'something is wrong' on a 20-field
      // record leaves an integrator bisecting their payload.
      fields: errors,
    })
  }
  await recordRef.update({ values: merged, updatedAt: Timestamp.now() })
  const updated = await recordRef.get()
  return apiJson(recordView(updated), { headers: ctx.headers })
}

/**
 * Delete a record, and let a retry of the SAME attempt say so (AGL-1710).
 *
 * This used to read, 404 if absent, then delete. The state after two calls was
 * right and the response was not: an integrator whose first response was lost
 * to a timeout retried, got `404 No such record`, and had no way to separate
 * "already deleted, you're fine" from "that id was wrong and nothing was ever
 * deleted". Both readings prescribe different actions and the wrong one —
 * escalate, or re-sync the whole dataset — is the one people pick.
 *
 * The obvious fix, `204` (or a `deleted: true` 200) for ANY missing record, is
 * rejected on two counts. It is a BREAKING change: `datasets.md` publishes
 * `404 not_found "No such record"` on this path and clients branch on it. And
 * it spends a signal to buy one — a caller that never saw the resource would
 * get a success for a typo'd id, losing the only feedback the API gives that
 * it is asking about the wrong thing. Consistency points the same way: `GET`
 * and `PATCH` on this very path answer 404 for a missing record, and every
 * sibling `DELETE` on `/v1` — the dataset, the form submission, the contact —
 * answers the same way, so there is no convention a 204 would be matching.
 *
 * So the key identifies the ATTEMPT rather than the resource, which is what
 * the shared claim is already for. A retry of the attempt that did the
 * deleting replays its receipt; a wrong id still 404s. That expands the
 * published contract instead of changing it — a caller sending no header sees
 * byte-identical behaviour.
 *
 * The claim is taken ABOVE the existence check, which is the one place this
 * deliberately diverges from `createRecord` (which claims below validation, so
 * a deterministic 400 never burns a key). It has to: the record a retry asks
 * about is precisely the one the first attempt removed, so a claim consulted
 * after the existence check would 404 the retry without ever reaching the
 * replay — the bug verbatim. The cost is taking-and-releasing on a genuine
 * miss, which is the trade the ordering requires.
 */
async function deleteRecord(
  request: Request,
  ctx: ApiV1Context,
  datasetId: string,
  recordRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    datasetId,
    request.headers.get('Idempotency-Key'),
    'record-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const snap = await recordRef.get()
    if (!snap.exists) {
      // Release, so the miss does not consume the key: the integrator corrects
      // the id and retries with the same one, exactly as a create's 400 lets
      // them correct the payload. A burned key here would be worse than the
      // 404 — keys never expire, and integrators derive them from upstream
      // event ids, so the corrected delete could never be sent at all.
      await claim.release()
      return ApiErrors.notFound({ message: 'No such record', headers: ctx.headers })
    }
    await recordRef.delete()
    const view = { id: recordRef.id, object: 'record', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    // Same direction as `createRecord`: a failed attempt gives the key back.
    // Nothing here moves money, and a stranded key is the irreversible failure.
    await claim.release()
    throw error
  }
}

// ── Sites & form submissions ────────────────────────────────────────────────

function orgOwnsHost(ctx: ApiV1Context, hostId: string): boolean {
  const hosts = (ctx.org.hosts ?? {}) as Record<string, unknown>
  return Boolean(hosts[hostId])
}

function siteView(hostId: string, data: FirebaseFirestore.DocumentData | undefined) {
  return {
    id: hostId,
    object: 'site',
    displayName: data?.displayName ?? null,
    subdomain: data?.subdomain ?? null,
    domain: data?.cname ?? null,
  }
}

async function handleSites(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, sub] = segments

  if (!hostId) {
    const denied = requireScope(ctx, 'sites:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const hostIds = Object.keys((ctx.org.hosts ?? {}) as Record<string, unknown>).sort()
    const limit = parseLimit(url.searchParams.get('limit'))
    const cursor = decodeCursor(url.searchParams.get('cursor'))
    const start = cursor ? hostIds.findIndex((id) => id > cursor) : 0
    const page = hostIds.slice(start < 0 ? hostIds.length : start, (start < 0 ? hostIds.length : start) + limit)
    const nextCursor = start >= 0 && start + limit < hostIds.length ? encodeCursor(page[page.length - 1]) : null
    const sites = await Promise.all(
      page.map(async (id) => siteView(id, (await ctx.firestore.collection('hosts').doc(id).get()).data())),
    )
    return listResponse(sites, nextCursor, ctx.headers)
  }

  if (!orgOwnsHost(ctx, hostId)) {
    return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  }

  if (!sub) {
    const denied = requireScope(ctx, 'sites:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const snap = await ctx.firestore.collection('hosts').doc(hostId).get()
    return apiJson(siteView(hostId, snap.data()), { headers: ctx.headers })
  }

  if (sub === 'form-submissions') {
    return handleFormSubmissions(request, ctx, segments, url)
  }

  if (sub === 'orders') return handleOrders(request, ctx, segments, url)
  if (sub === 'products') return handleProducts(request, ctx, segments, url)
  if (sub === 'media') return handleScopedMedia(request, ctx, url, hostRef(ctx, hostId))
  if (sub === 'publish') return handlePublish(request, ctx, hostId)
  // Kept below the sub-resources so an unknown one still 404s here.

  return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
}

// ── Publish ─────────────────────────────────────────────────────────────────

/**
 * How many publishes one SITE may spend an hour (AGL-2462).
 *
 * The budget is per host and not per key because it bounds WORK, not requests.
 * One call sends up to `MAX_PATHS` = 250 paths to the tenant, each dropping a
 * cache entry whose next render costs roughly 40 Firestore reads — so the
 * cheapest call in the API is also the most expensive one, and the two limits
 * are not the same unit. Keyed on the API key instead, an organization mints
 * ten keys and multiplies the fan-out by ten; keyed on the host, the ceiling
 * is a property of the site being republished and no number of keys moves it.
 *
 * ## The number
 *
 * 10 an hour. A publish is a human-scale event even when a machine triggers
 * it: an integration that finishes a nightly catalogue sync publishes once,
 * and one that publishes after every record write does not want this endpoint
 * at all — it wants the 60-second window it already has, which is still
 * underneath as the backstop and is why a `429` here costs correctness
 * nothing. Ten leaves room for a bad afternoon of manual retries and still
 * caps the worst case at 2,500 dropped pages per site per hour, against the
 * ~1.2M reads a minute the documented 120/min per-key limit would have
 * allowed on its own.
 *
 * DURABLE (`consumeRateLimit`), not the per-instance counter: this is a limit
 * with a consequence on another service, and a ceiling that moves with how
 * many instances happen to be warm would not be one.
 */
export const PUBLISH_LIMIT_PER_HOUR = 10

/** Window for {@link PUBLISH_LIMIT_PER_HOUR}. */
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000

/**
 * `POST /v1/sites/{siteId}/publish` (AGL-2462) — the call that makes a write
 * visible.
 *
 * ## What was missing
 *
 * `POST /v1/datasets/{id}/records` wrote and called nothing else. What made a
 * live site show the new data was time, and only time: `getDatasets` is cached
 * for `DATASETS_TTL_SECONDS` (60) behind `tenantDataTag(hostId)`, and the
 * tenant catch-all page is `revalidate = 60`. Time-based ISR is
 * stale-while-revalidate, so the visitor AFTER the window can still be served
 * the old copy and the change appears on the visit after that. An integration
 * could therefore own a site's data and never publish it — the cache expiring
 * is a side effect, not an operation the caller performed.
 *
 * ## The authorization, stated plainly
 *
 * The console path (`/api/screens/revalidate`) admits a user whose HOST role
 * `hostRoleCanPublish` accepts — `admin` or `editor`, never `author` — and
 * 404s everyone else so a caller cannot learn a site exists. An API key is an
 * ORG credential with no uid, so there is no host role to read. The same two
 * questions are answered with the two facts a key does carry:
 *
 * 1. **May this credential publish at all?** `sites:publish`, which the
 *    organization's admin ticks when minting the key. That is the deliberate
 *    grant `hostRoleCanPublish` represents, made once at mint time instead of
 *    per request — and, like `author`, a key without it cannot publish however
 *    much else it can read.
 * 2. **May it publish THIS site?** `orgOwnsHost`, the same predicate every
 *    other site sub-resource uses, and the analogue of passing `hostId` to
 *    `resolveOrgPermissions` so a scope over two sites cannot reach a third.
 *
 * The 404 posture is kept for the same reason the console route gives.
 *
 * ## Ordering
 *
 * Scope, then ownership, then the budget, then the work. The budget is spent
 * only by a caller who could actually have published, so a key without the
 * scope cannot burn a site's hourly allowance — a refusal that consumed the
 * budget would be a denial-of-service against the site's own operator, from
 * outside their organization's authorization.
 *
 * No `Idempotency-Key`: publishing twice lands the same state and returns the
 * same answer, exactly as `updateRecord` argues. The budget, not the key, is
 * what makes a retry loop safe.
 */
async function handlePublish(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'POST' },
    })
  }
  const denied = requireScope(ctx, 'sites:publish')
  if (denied) return denied

  const snap = await ctx.firestore.collection('hosts').doc(hostId).get()
  const subdomain = String(snap.get('subdomain') ?? '').trim()
  if (!snap.exists || !subdomain) {
    return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  }

  // Per-host hourly budget, ABOVE the fan-out and below the authorization.
  const rate = await consumeRateLimit(`apiv1-publish:${hostId}`, {
    limit: PUBLISH_LIMIT_PER_HOUR,
    windowMs: PUBLISH_WINDOW_MS,
  })
  if (!rate.allowed) {
    // The per-key `X-RateLimit-*` headers still ride along in `ctx.headers`;
    // they describe a different budget from the one that refused, so the
    // `Retry-After` is computed from THIS window and is the number to obey.
    return ApiErrors.rateLimited(
      Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000)),
      ctx.headers,
    )
  }

  // `screens` is the routing map the console route reads for the same purpose:
  // screen id → route path. A site with none is not an error — an unrouted or
  // empty site has no live page to drop — but it must not report a publish it
  // did not perform, which is the "reported fast, still slow" confusion the
  // original bug was made of.
  const screens = (snap.get('screens') ?? {}) as Record<string, unknown>
  const paths = Object.values(screens)
    .filter((path) => typeof path === 'string')
    .map((path) => screenRoutePathToUrl(path as string))
  if (!paths.length) {
    return apiJson(
      {
        object: 'publish',
        site: hostId,
        published: false,
        reason: 'not_routed',
        pages: 0,
      },
      { headers: ctx.headers },
    )
  }

  const result = await postTenantRevalidate({ subdomain, hostId, paths })
  return apiJson(
    {
      object: 'publish',
      site: hostId,
      published: result.reason === 'ok',
      // Named rather than swallowed: `not-configured` and a tenant refusal are
      // the two cases where a caller would otherwise read a success and keep
      // polling a page that never changed.
      reason: result.reason === 'ok' ? null : result.reason,
      pages: result.revalidated.length,
      // The tenant's own 250-path cap (AGL-1161). A site above it is refreshed
      // in part, and the remainder catches up on the 60-second window — worth
      // saying, because the caller is the one deciding whether to poll.
      pagesDropped: result.pathsDropped,
    },
    { headers: ctx.headers },
  )
}

// ── Form submissions ────────────────────────────────────────────────────────

function formSubmissionView(doc: FirebaseFirestore.DocumentSnapshot) {
  return {
    id: doc.id,
    object: 'form_submission',
    form: doc.get('formName') ?? null,
    path: doc.get('path') ?? null,
    fields: doc.get('fields') ?? {},
    read: Boolean(doc.get('read')),
    created: serialize(doc.get('createdAt')) ?? null,
  }
}

/**
 * `/v1/sites/{siteId}/form-submissions[/{submissionId}]` (AGL-2127).
 *
 * The list was the whole surface, and that shaped every integration written
 * against it badly. A lead sync polls, pushes new rows into a CRM, and then
 * has nowhere to record that it did — so it either re-pushes the same lead
 * next poll, or keeps its own high-water mark of ids against a list that
 * `conventions.md` publishes as ordered by DOCUMENT ID, not by time. The
 * `read` flag the console's inbox toggles on the very same document is the
 * state the integration needed and could not write.
 *
 * `read` is the ONLY writable field. A submission is what a visitor typed,
 * and an API that let an integration quietly rewrite it would make the
 * inbox's contents unattributable — so anything else in the body is a
 * `validation_failed` naming the offending key rather than a silent drop.
 */
async function handleFormSubmissions(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , submissionId] = segments
  const collection = ctx.firestore
    .collection('hosts')
    .doc(hostId)
    .collection('formSubmissions')

  if (!submissionId) {
    const denied = requireScope(ctx, 'forms:read')
    if (denied) return denied
    if (request.method !== 'GET') {
      return ApiErrors.methodNotAllowed({
        headers: { ...ctx.headers, Allow: 'GET' },
      })
    }
    // An EMPTY value means the filter is absent, matching `?email=` and
    // `?tag=` on contacts and `conventions.md`'s single rule for all three.
    // A client serializing an unset form field sends `?read=`, and refusing
    // that while `?email=` accepts it would be an inconsistency an integrator
    // discovers one filter at a time.
    const rawRead = url.searchParams.get('read') || null
    if (rawRead !== null && rawRead !== 'true' && rawRead !== 'false') {
      return ApiErrors.badRequest({
        message: 'Form submission filter failed validation',
        code: 'validation_failed',
        fields: { read: 'Must be true or false' },
        headers: ctx.headers,
      })
    }
    const read = rawRead === null ? null : rawRead === 'true'

    let query: FirebaseFirestore.Query = collection
    const form = url.searchParams.get('form')
    if (form) query = query.where('formName', '==', form)
    // `read` goes to FIRESTORE only when it is the sole filter, and is
    // applied after the read when it joins `form` (AGL-2460).
    //
    // Two equality clauses plus the `orderBy(FieldPath.documentId())` every
    // list here applies is a three-clause query, and Firestore serves that
    // only from a composite index. Shipping one to serve a filter
    // COMBINATION is a migration with a backfill, not a feature — and the
    // failure mode while it builds is this route's documented realistic 500
    // (see the route's `safeDispatch` docblock). Narrowing on `formName` and
    // dropping the rest in memory keeps the pre-existing `?form=` query
    // byte-for-byte what it already was, which is the property worth more
    // than one saved round trip.
    //
    // `read=false` IS exact against Firestore, unlike `?channel=online` on
    // orders. That filter is applied after the read because older orders
    // predate the `channel` field and a `where` would silently drop them.
    // The equivalent question was checked here rather than assumed: the
    // ONLY writer of this collection is the tenant's form-submit route, and
    // it has stamped `read: false` on every row since the feature's first
    // commit (AGL-76/77, `fc149e538`). There is no fieldless generation to
    // drop, so the cheap query is also the correct one.
    if (read !== null && !form) query = query.where('read', '==', read)
    const { docs, nextCursor } = await paginate(query, url)
    const matched =
      read !== null && form
        ? docs.filter((doc) => Boolean(doc.get('read')) === read)
        : docs
    return listResponse(matched.map(formSubmissionView), nextCursor, ctx.headers)
  }

  const submissionRef = collection.doc(submissionId)

  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'forms:read')
    if (denied) return denied
    const snap = await submissionRef.get()
    if (!snap.exists) {
      return ApiErrors.notFound({
        message: 'No such form submission',
        headers: ctx.headers,
      })
    }
    return apiJson(formSubmissionView(snap), { headers: ctx.headers })
  }

  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'forms:write')
    if (denied) return denied
    return updateFormSubmission(request, ctx, submissionRef)
  }

  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'forms:write')
    if (denied) return denied
    return deleteFormSubmission(request, ctx, hostId, submissionRef)
  }

  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}

/**
 * Mark one submission read or unread. No `Idempotency-Key`: the same body
 * twice lands the same state AND returns the same `200`, which is the test
 * `updateRecord` and `updateDataset` are held to.
 */
async function updateFormSubmission(
  request: Request,
  ctx: ApiV1Context,
  submissionRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const body = await readJsonBody(request)
  const unknown = Object.keys(body).filter((key) => key !== 'read')
  if (unknown.length > 0) {
    // Named, not dropped. `values` on a record drops unknown fields because a
    // dataset model defines what exists; a submission has no model, so a
    // silent drop here would read as "we stored your correction" when nothing
    // was stored, and the visitor's answers are exactly the thing that must
    // not be quietly editable.
    return ApiErrors.badRequest({
      message: 'Only `read` can be changed on a form submission',
      code: 'validation_failed',
      fields: Object.fromEntries(
        unknown.map((key) => [key, 'Not writable on a form submission']),
      ),
      headers: ctx.headers,
    })
  }
  if (typeof body.read !== 'boolean') {
    return ApiErrors.badRequest({
      message: 'Form submission failed validation',
      code: 'validation_failed',
      fields: { read: 'Must be true or false' },
      headers: ctx.headers,
    })
  }

  const snap = await submissionRef.get()
  if (!snap.exists) {
    return ApiErrors.notFound({
      message: 'No such form submission',
      headers: ctx.headers,
    })
  }
  await submissionRef.update({ read: body.read })
  return apiJson(formSubmissionView(await submissionRef.get()), {
    headers: ctx.headers,
  })
}

/**
 * Delete one submission. Accepts an `Idempotency-Key` for the reason
 * `deleteRecord` does: a purge that runs after an export is the operation
 * most likely to be retried on a timer, and without a key the retry cannot
 * tell "already gone" from "wrong id".
 */
async function deleteFormSubmission(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  submissionRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    hostId,
    request.headers.get('Idempotency-Key'),
    'form-submission-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const snap = await submissionRef.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({
        message: 'No such form submission',
        headers: ctx.headers,
      })
    }
    await submissionRef.delete()
    const view = {
      id: submissionRef.id,
      object: 'form_submission',
      deleted: true,
    }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

// ── Commerce: orders & products (read) ──────────────────────────────────────

/**
 * Commerce resources need the `commerce` entitlement as well as the scope
 * (AGL-1928). `apiAccess` alone is the wrong gate here: it says the org may
 * call the API at all, not that it may still use the store. AGL-1873 closed
 * exactly this class on the write side — two money doors that asked the
 * plugin switch (`org.enabledPlugins`) instead of the plan, so a lapsed org
 * kept selling — and the same reasoning applies to a read. `enabledPlugins`
 * is the customer's own on/off switch and survives a downgrade; the plan does
 * not, and the published rule is that paid features stop at the door when the
 * plan no longer includes them.
 *
 * Answered as `plan_required` rather than `not_found`, deliberately. Hiding a
 * store that plainly exists behind a 404 sends an integrator hunting a wrong
 * site id; the honest answer names the plan.
 */
function requireCommerce(ctx: ApiV1Context): Response | null {
  return checkEntitlement(ctx.org, 'commerce')
    ? null
    : ApiErrors.planRequired({
        message: 'Commerce is not included in this organization’s plan',
        code: 'commerce',
        headers: ctx.headers,
      })
}

function hostRef(ctx: ApiV1Context, hostId: string) {
  return ctx.firestore.collection('hosts').doc(hostId)
}

/**
 * Orders carry a legacy Commerce Starter shape (AGL-90) alongside the modern
 * one: `amountCents`/`feeCents` at the top level rather than a `totals` map.
 * The console lifts them through `CommerceModel.liftLegacyOrder` and reads
 * `lifted.totals?.totalCents ?? order.amountCents`. The API cannot publish two
 * shapes for one object, so the legacy fields are folded into `totals` here
 * and a client only ever sees the modern one. `channel` defaults to `online`
 * for the same reason the console's list does — an absent channel is a
 * pre-channel order, not an unknown one.
 */
function orderView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  const totals = (data.totals ?? {}) as Record<string, unknown>
  const legacyTotal = Number(data.amountCents ?? NaN)
  const totalCents = Number.isFinite(Number(totals.totalCents))
    ? Number(totals.totalCents)
    : Number.isFinite(legacyTotal)
      ? legacyTotal
      : null
  const legacyFee = Number(data.feeCents ?? NaN)
  return {
    id: doc.id,
    object: 'order',
    number: typeof data.number === 'number' ? data.number : null,
    status: (data.status as string) ?? null,
    channel: (data.channel as string) ?? 'online',
    currency: 'usd',
    customerEmail: data.customerEmail ?? null,
    customerName: data.customerName ?? null,
    lineItems: serialize(data.lineItems ?? []),
    totals: {
      itemsCents: Number(totals.itemsCents ?? 0),
      shippingCents: Number(totals.shippingCents ?? 0),
      taxCents: Number(totals.taxCents ?? 0),
      discountCents: Number(totals.discountCents ?? 0),
      totalCents,
      // The Connect application fee. NOT subtracted from `totalCents` — it is
      // Aglyn's cut of a total the shopper already paid in full, so a client
      // that nets it out of revenue would understate what it collected.
      feeCents: Number.isFinite(Number(totals.feeCents))
        ? Number(totals.feeCents)
        : Number.isFinite(legacyFee)
          ? legacyFee
          : 0,
    },
    // Money already handed back, for any reason. A chargeback lands here too,
    // so `refundedCents > 0` does not by itself mean the merchant chose it.
    refundedCents: Number(data.refundedCents ?? 0),
    disputed: Boolean(data.dispute),
    shippingAddress: serialize(data.shippingAddress) ?? null,
    couponCode: data.couponCode ?? null,
    // Shipment records — the half of fulfilment an integration can use
    // without a write (AGL-2460). `status` says an order is `fulfilled`; it
    // does not say which carrier took it or under what tracking number, so a
    // 3PL or accounting reconcile could see THAT an order shipped and never
    // WHICH shipment it was. The console's order dialog shows both, and an
    // order that has been shipped twice (a split shipment) is indistinguish-
    // able from one shipped once when only the status is published.
    //
    // `atMs` is a number of milliseconds, not a Firestore Timestamp, so
    // `serialize` passes it through untouched. It is republished as `at` in
    // ISO 8601 to match `created` and every other time this API emits: one
    // object publishing two time formats is a bug an integrator finds late,
    // in their own timezone conversion, and blames on their own code.
    fulfillments: (Array.isArray(data.fulfillments) ? data.fulfillments : []).map(
      (entry: Record<string, unknown>) => {
        const atMs = Number((entry ?? {}).atMs)
        return {
          id: (entry ?? {}).id ?? null,
          lineItemIds: Array.isArray((entry ?? {}).lineItemIds)
            ? (entry as { lineItemIds: unknown[] }).lineItemIds
            : [],
          carrier: (entry ?? {}).carrier ?? null,
          trackingNumber: (entry ?? {}).trackingNumber ?? null,
          trackingUrl: (entry ?? {}).trackingUrl ?? null,
          at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
        }
      },
    ),
    created: serialize(data.createdAt) ?? null,
  }
}

async function handleOrders(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , orderId] = segments
  const denied = requireScope(ctx, 'orders:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  }
  const collection = hostRef(ctx, hostId).collection('orders')

  if (orderId) {
    const snap = await collection.doc(orderId).get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such order', headers: ctx.headers })
    }
    return apiJson(orderView(snap), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status) query = query.where('status', '==', status)
  const channel = url.searchParams.get('channel')
  // `online` is the DEFAULT, not a stored value on older orders, so filtering
  // for it in Firestore would silently drop every pre-channel order. Those are
  // exactly the oldest orders an accounting backfill is reaching for, so this
  // one value is filtered after the read instead. The page can therefore come
  // back shorter than `limit` while `has_more` is still true — which the
  // published pagination contract already tells clients to expect (check
  // `has_more`, never a page's length).
  if (channel && channel !== 'online') query = query.where('channel', '==', channel)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs
    .map(orderView)
    .filter((order) => (channel === 'online' ? order.channel === 'online' : true))
  return listResponse(data, nextCursor, ctx.headers)
}

/**
 * Price and stock live on VARIANTS, never on the product — a product-level
 * `inventory` exists only as a denormalized sum the console rewrites on every
 * decrement, and a product-level `priceUsd` is the legacy single-variant
 * shape. Publishing either as the product's price would be wrong the moment a
 * product has two variants, so the variant array is the contract and the
 * product carries only the roll-up, clearly named.
 *
 * `inventory: null` on a variant means UNTRACKED and `0` means SOLD OUT.
 * Collapsing them (the `?? 0` an integrator writes on the first day) turns
 * every untracked product into an out-of-stock one, so the distinction is
 * carried through verbatim rather than defaulted.
 */
function variantView(variant: Record<string, unknown>) {
  const inventory = variant.inventory
  return {
    id: variant.id ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    options: variant.options ?? {},
    priceUsd: typeof variant.priceUsd === 'number' ? variant.priceUsd : null,
    compareAtPriceUsd:
      typeof variant.compareAtPriceUsd === 'number'
        ? variant.compareAtPriceUsd
        : null,
    weightGrams:
      typeof variant.weightGrams === 'number' ? variant.weightGrams : null,
    inventory: typeof inventory === 'number' ? inventory : null,
    inventoryTracked: typeof inventory === 'number',
  }
}

function productView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  const variants = Array.isArray(data.variants)
    ? (data.variants as Array<Record<string, unknown>>)
    : []
  const tracked = variants.filter((v) => typeof v.inventory === 'number')
  return {
    id: doc.id,
    object: 'product',
    name: data.name ?? null,
    slug: data.slug ?? null,
    description: data.description ?? null,
    type: data.type ?? null,
    status: data.status ?? null,
    tags: data.tags ?? [],
    categoryIds: data.categoryIds ?? [],
    mediaUrls: data.mediaUrls ?? [],
    options: data.options ?? [],
    variants: variants.map(variantView),
    // The sum across TRACKED variants only, and `null` when none of them is
    // tracked — so an untracked catalogue reads as "we don't count this"
    // rather than as a store with nothing left to sell.
    inventory: tracked.length
      ? tracked.reduce((sum, v) => sum + Number(v.inventory ?? 0), 0)
      : null,
    subscription: serialize(data.subscription) ?? null,
    created: data.createdAtMs ? new Date(Number(data.createdAtMs)).toISOString() : null,
    updated: data.updatedAtMs ? new Date(Number(data.updatedAtMs)).toISOString() : null,
  }
}

async function handleProducts(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , productId] = segments
  const denied = requireScope(ctx, 'products:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  }
  const collection = hostRef(ctx, hostId).collection('products')

  if (productId) {
    const snap = await collection.doc(productId).get()
    // A soft-deleted product is gone as far as a customer is concerned. The
    // console filters `deletedAt` client-side; the API must not hand back a
    // product the merchant deleted just because the document survives.
    if (!snap.exists || snap.get('deletedAt')) {
      return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
    }
    return apiJson(productView(snap), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status) query = query.where('status', '==', status)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs.filter((doc) => !doc.get('deletedAt')).map(productView)
  return listResponse(data, nextCursor, ctx.headers)
}

// ── Media (read) ────────────────────────────────────────────────────────────

/**
 * Media is stored under BOTH scopes — `orgs/{orgId}/media` is the shared
 * organization library and `hosts/{hostId}/media` is one site's own files —
 * so the API publishes it at both `/v1/media` and `/v1/sites/{id}/media`
 * rather than picking one and lying about the other.
 *
 * `url` is the durable download URL and is always present. `cdnUrl` is the
 * CDN path, which exists only when the plan includes `mediaCdn` AND the asset
 * is not private, so it is published as a separate nullable field rather than
 * folded into `url` — an integrator building a public `<img>` needs to know
 * which one it got. Private assets carry neither a CDN path nor a usable
 * public link and are marked `private: true`.
 */
function mediaView(doc: FirebaseFirestore.DocumentSnapshot, origin: string) {
  const data = doc.data() ?? {}
  const cdnPath = data.cdnPath as string | undefined
  return {
    id: doc.id,
    object: 'media',
    fileName: data.fileName ?? null,
    contentType: data.contentType ?? null,
    sizeBytes: Number(data.sizeBytes ?? 0),
    width: typeof data.width === 'number' ? data.width : null,
    height: typeof data.height === 'number' ? data.height : null,
    alt: data.alt ?? null,
    description: data.description ?? null,
    tags: data.tags ?? [],
    folderId: data.folderId ?? null,
    url: data.url ?? null,
    cdnUrl: cdnPath ? `${origin}${cdnPath}` : null,
    private: Boolean(data.private),
    created: serialize(data.createdAt) ?? null,
  }
}

async function handleScopedMedia(
  request: Request,
  ctx: ApiV1Context,
  url: URL,
  scopeRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const denied = requireScope(ctx, 'media:read')
  if (denied) return denied
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  }
  const origin = url.origin
  const collection = scopeRef.collection('media')
  const segments = url.pathname.split('/').filter(Boolean)
  // The trailing segment is the media id only on the `/media/{id}` shape.
  const mediaId =
    segments[segments.length - 2] === 'media' ? segments[segments.length - 1] : ''

  if (mediaId) {
    const snap = await collection.doc(mediaId).get()
    // `deletedAt` is the soft-delete marker every console read gates on.
    if (!snap.exists || snap.get('deletedAt')) {
      return ApiErrors.notFound({ message: 'No such file', headers: ctx.headers })
    }
    return apiJson(mediaView(snap, origin), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const folder = url.searchParams.get('folder')
  if (folder) query = query.where('folderId', '==', folder)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs
    .filter((doc) => !doc.get('deletedAt'))
    .map((doc) => mediaView(doc, origin))
  return listResponse(data, nextCursor, ctx.headers)
}

// ── Contacts (read) ─────────────────────────────────────────────────────────

/**
 * The contact object as published.
 *
 * `notes` and `marketingConsent` are here because `PATCH` writes them
 * (AGL-2276). A projection that omits a field the same resource accepts is
 * the shape that has shipped broken before: the client writes, reads back,
 * sees nothing, and cannot tell a dropped write from a narrow view. Every
 * writable field appears here, and `contact-writes.spec.ts` asserts that as a
 * property of the pair rather than field by field.
 *
 * `email`, `sources` and `interactions` are read-only and stay that way —
 * `email` is the dedupe key the whole CRM unifies on, and the other two are
 * provenance. `interactions` is not published at all; the console's timeline
 * is not part of the API contract.
 */
function contactView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'contact',
    email: data.email ?? null,
    name: data.name ?? null,
    tags: data.tags ?? [],
    notes: data.notes ?? null,
    marketingConsent: Boolean(data.marketingConsent),
    sources: data.sources ? Object.keys(data.sources) : [],
    created: serialize(data.createdAt) ?? null,
    updated: serialize(data.updatedAt) ?? null,
  }
}

const CONTACT_NAME_MAX = 120
const CONTACT_NOTES_MAX = 2000
const CONTACT_TAGS_MAX = 50
const CONTACT_TAG_MAX = 60

/** Fields a client may send. Anything else is named, never silently dropped. */
const CONTACT_WRITABLE = ['name', 'tags', 'notes', 'marketingConsent'] as const

/**
 * Validate the writable half of a contact (AGL-2276). `partial` separates
 * PATCH from POST exactly as `readDatasetInput` does: a create must carry an
 * `email`, an update may send any one field alone and leaves the rest alone.
 *
 * Unknown keys are REFUSED rather than dropped, following
 * `updateFormSubmission` and not `createRecord`: a record has a dataset model
 * that defines what exists, and a contact does not, so a silent drop would
 * read as "we stored your correction" when nothing was stored. `email` gets
 * its own message on PATCH because sending it is the honest mistake an
 * integrator makes first — it is the field their own system keys on.
 */
function readContactInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
):
  | {
      values: {
        email?: string
        name?: string
        tags?: string[]
        notes?: string
        marketingConsent?: boolean
      }
    }
  | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: {
    email?: string
    name?: string
    tags?: string[]
    notes?: string
    marketingConsent?: boolean
  } = {}

  const allowed = new Set<string>([
    ...CONTACT_WRITABLE,
    ...(partial ? [] : ['email']),
  ])
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) continue
    errors[key] =
      key === 'email'
        ? 'Not writable — a contact is identified by its email'
        : key === 'sources' || key === 'interactions'
          ? 'Not writable — set by the capture point that recorded it'
          : 'Not writable on a contact'
  }

  if (!partial) {
    // The SAME normalizer every capture point uses. Re-implementing the
    // check here would let the API accept an address `upsertHostContact`
    // would reject, and the two would then disagree about who is a duplicate.
    const email = normalizeContactEmail(body.email)
    if (!email) errors.email = 'A valid email address is required'
    else values.email = email
  }

  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim().slice(0, CONTACT_NAME_MAX)
    if (name) values.name = name
    else errors.name = 'Must not be empty'
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      errors.tags = 'Must be an array of strings'
    } else {
      // An EMPTY array is legal and means "clear the tags" — the console's
      // own tag editor can empty the field, and an API that could only ever
      // add tags would leave an integration unable to undo its own mistake.
      values.tags = (body.tags as unknown[])
        .map((tag) => String(tag).trim().slice(0, CONTACT_TAG_MAX))
        .filter((tag) => tag.length > 0)
        .slice(0, CONTACT_TAGS_MAX)
    }
  }

  if (body.notes !== undefined) {
    values.notes = String(body.notes ?? '').slice(0, CONTACT_NOTES_MAX)
  }

  if (body.marketingConsent !== undefined) {
    if (typeof body.marketingConsent !== 'boolean') {
      errors.marketingConsent = 'Must be true or false'
    } else {
      values.marketingConsent = body.marketingConsent
    }
  }

  return Object.keys(errors).length ? { errors } : { values }
}

const contactsCollection = (ctx: ApiV1Context) =>
  ctx.firestore.collection('orgs').doc(ctx.orgId).collection('contacts')

/**
 * `POST /v1/contacts` (AGL-2276) — the call that lets an integration own the
 * customer list.
 *
 * ## The audience band
 *
 * `checkContactQuota` is the gate, and it is the SAME one `upsertHostContact`
 * applies to a form capture (AGL-890). Metered plans always create and bill
 * the overage through the `report-usage` rollup, which counts
 * `orgs/{orgId}/contacts` without caring who wrote them — so an API-created
 * contact meters exactly like a captured one, and there is no unbilled door.
 * Free hard-bands at its included count; free cannot reach `/v1` at all
 * without a staff `features.apiAccess` override, which is precisely the shape
 * AGL-2163 found running unbounded, so the gate is here rather than assumed
 * unreachable.
 *
 * Where capture DROPS a refused contact (silently, onto a
 * `counters/contactsDropped` the console alerts on), this refuses out loud
 * with a `403`: a form must never fail a visitor's signup because of billing,
 * and an API call has an operator on the other end who needs to be told.
 *
 * ## Duplicates
 *
 * A contact is unified on its normalized email, so a second create for an
 * address already present is a `409 conflict` naming the existing id rather
 * than a second row. Silently upserting instead would hide a real integration
 * bug — two upstream systems both claiming to own the record — and would make
 * `POST` and `PATCH` the same call.
 *
 * ## Why the claim is taken ABOVE both refusals
 *
 * `createRecord` and `createDataset` check their quota FIRST and claim after,
 * so that a plan refusal never burns a key. That ordering has a hole this one
 * deliberately does not copy, and `api-v1-contact-writes.spec.ts` is what
 * found it: **a create that exactly fills the band cannot be retried.** The
 * first call succeeds and consumes the last slot; the retry — same key, lost
 * response — re-counts, is now AT the band, and gets a `403` instead of the
 * replay `conventions.md` promises ("if the original succeeded, the same
 * response comes back"). The integrator is left unable to tell whether the
 * contact exists, which is the exact confusion the key exists to remove. The
 * duplicate check has the same shape, and worse: the retry's own successful
 * write is what makes the email a duplicate, so EVERY retry of a successful
 * create would answer `409 contact_exists`.
 *
 * Claiming first and RELEASING on each refusal gets both properties at once:
 * a settled key replays before any of this is reached, and a refusal gives
 * the key back so the retry that should finally succeed still can. It is the
 * ordering `deleteRecord` already argues for, and it pays the same price —
 * taking-and-releasing on a genuine refusal. AGL-2278 applies it to the two
 * older creates.
 *
 * `visibleTo` is stamped with `ORG_SCOPE_TOKEN`, as capture does. A contact
 * written without it matches no `array-contains-any` and is therefore visible
 * on NO site (AGL-1044) — the API would create data nobody can see, which is
 * worse than refusing.
 */
async function createContact(
  request: Request,
  ctx: ApiV1Context,
): Promise<Response> {
  // Validation stays above the claim, as `createRecord` argues: a
  // deterministic 400 must never take the key at all, so an integrator fixes
  // the payload and retries with the same one.
  const parsed = readContactInput(await readJsonBody(request), {
    partial: false,
  })
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }
  const { email, name, tags, notes, marketingConsent } = parsed.values

  const collection = contactsCollection(ctx)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'contacts',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const existing = await collection.where('email', '==', email).limit(1).get()
    if (!existing.empty) {
      // Released: the conflict clears if that contact is deleted or merged
      // upstream, and the retry that should then succeed must not replay it.
      await claim.release()
      return ApiErrors.conflict({
        message: `A contact with this email already exists (${existing.docs[0].id}). Update it instead.`,
        code: 'contact_exists',
        headers: ctx.headers,
      })
    }

    // One aggregate read, the same one `upsertHostContact` and the monthly
    // rollup take. Unconditional, matching `createDataset` — the alternative
    // is a per-plan shape check like `dataStorageEnforcementShape`, and a
    // `count()` costs one read against a write that costs one anyway.
    const count = (await collection.count().get()).data().count
    const quota = checkContactQuota(ctx.org as never, count)
    if (!quota.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message:
          `Audience limit reached (${quota.included} contacts). ` +
          'Upgrade the plan to add more.',
        code: 'contact_quota',
        headers: ctx.headers,
      })
    }

    const id = createResourceUid()
    await collection.doc(id).create({
      email,
      ...(name ? { name } : {}),
      tags: tags ?? [],
      ...(notes ? { notes } : {}),
      ...(marketingConsent
        ? { marketingConsent: true, marketingConsentAtMs: Date.now() }
        : {}),
      // `sources.api` — a first-class provenance value beside `form`,
      // `member`, `order` and `booking`, so a merchant reading the console
      // can see which people an integration put there.
      sources: { api: true },
      interactions: [],
      // AGL-1044/AGL-1037: without this the contact matches no scoped read.
      visibleTo: [ORG_SCOPE_TOKEN],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    const view = contactView(await collection.doc(id).get())
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * `PATCH /v1/contacts/{id}` — the tag/notes edit the console's Contacts page
 * already makes, plus the name and the marketing flag.
 *
 * No `Idempotency-Key`, for `updateRecord`'s reason: the same body twice
 * lands the same state AND returns the same `200`. No quota either — an edit
 * does not grow the audience, and charging a plan refusal for renaming
 * somebody would make a downgraded org unable to correct its own data.
 */
async function updateContact(
  request: Request,
  ctx: ApiV1Context,
  contactRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const parsed = readContactInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }
  const snap = await contactRef.get()
  if (!snap.exists) {
    return ApiErrors.notFound({
      message: 'No such contact',
      headers: ctx.headers,
    })
  }

  const { name, tags, notes, marketingConsent } = parsed.values
  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name
  if (tags !== undefined) update.tags = tags
  if (notes !== undefined) update.notes = notes
  if (marketingConsent !== undefined) {
    update.marketingConsent = marketingConsent
    // The consent timestamp is the evidence, so it is stamped when consent is
    // GIVEN and left alone when it is withdrawn — an audit needs to know when
    // the person opted in, and clearing it would destroy that record.
    if (marketingConsent) update.marketingConsentAtMs = Date.now()
  }
  // An empty body is a no-op answered with the current contact, matching
  // `updateDataset`: a client re-sending an unchanged object should not have
  // to special-case it.
  if (Object.keys(update).length > 0) {
    await contactRef.update({ ...update, updatedAt: Timestamp.now() })
  }
  return apiJson(contactView(await contactRef.get()), { headers: ctx.headers })
}

/**
 * `DELETE /v1/contacts/{id}` — the console's own delete, over the API.
 *
 * Takes an `Idempotency-Key` with `deleteRecord`'s exact semantics, and for a
 * sharper reason: an erasure request is the operation most likely to be run
 * from a script on somebody else's deadline, and a retry after a lost
 * response must be able to tell "already erased" from "wrong id".
 */
async function deleteContact(
  request: Request,
  ctx: ApiV1Context,
  contactRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'contact-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const snap = await contactRef.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({
        message: 'No such contact',
        headers: ctx.headers,
      })
    }
    await contactRef.delete()
    const view = { id: contactRef.id, object: 'contact', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * `GET /v1/contacts` filters (AGL-2460) — the lookup a sync starts with.
 *
 * The list was ordered by document id with no filter of any kind, which left
 * the first question every CRM, mailing tool or migration asks — "do I
 * already have this person?" — answerable only by paging the whole audience.
 * That is not a rounding error. Contacts are ORGANIZATION-wide (AGL-237), so
 * the list is the entire audience band; every page is a BILLED request
 * (`recordApiRequest`) against a documented 120/min per-key ceiling. Finding
 * one address in a 50k audience cost ~500 requests and four minutes, and the
 * integration that gave up and called `POST` instead recovered the id by
 * regex over the `409 contact_exists` sentence — parsing a human message for
 * an identifier, which is not a contract this API should have been offering.
 *
 * Both filters REDUCE work rather than adding it: one indexed lookup replaces
 * a full sweep, so this NARROWS the per-request Firestore read amplification
 * AGL-2414 is about rather than widening it. Neither introduces a new metered
 * dimension — a filtered list is the same billed request the unfiltered one
 * always was, and the customer simply needs far fewer of them.
 *
 * ## `email` runs through the writer's own normalizer
 *
 * `normalizeContactEmail` is the SAME function `createContact` stores
 * through. Matching the raw query string instead would make
 * `?email=Avery@Example.com` answer "no such contact" while `POST` with that
 * identical address answers `409 contact_exists` naming its id — two
 * endpoints disagreeing about whether a person exists, which an integrator
 * reasonably reads as our data being corrupt rather than as our having two
 * spellings of one address.
 *
 * A value that cannot normalize is a `400` naming the field, not an empty
 * page. Every stored email is normalized and pattern-valid, so nothing can
 * match a malformed one and an empty page would be perfectly TRUE and
 * perfectly useless: it is indistinguishable from "we don't have them", and
 * it sends the caller hunting a missing person instead of a typo.
 *
 * ## Why the COMBINATION filters after the read
 *
 * An equality on `email`, an `array-contains` on `tags` and the
 * `orderBy(FieldPath.documentId())` every list applies is a three-clause
 * query, which Firestore serves only from a composite index we would have to
 * ship and wait on. `email` is unique, so it already selects at most one
 * document — testing that one row's tags in memory costs nothing and needs no
 * index. The page can therefore come back empty with `has_more` false, which
 * is the short-page case `conventions.md` already tells clients to expect and
 * which `?channel=online` on orders already produces.
 */
async function listContacts(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const rawEmail = url.searchParams.get('email')
  let email: string | null = null
  if (rawEmail !== null && rawEmail.trim() !== '') {
    email = normalizeContactEmail(rawEmail)
    if (!email) {
      return ApiErrors.badRequest({
        message: 'Contact filter failed validation',
        code: 'validation_failed',
        fields: { email: 'Must be a valid email address' },
        headers: ctx.headers,
      })
    }
  }
  // Trimmed and capped exactly as `readContactInput` stores a tag, so a
  // filter cannot ask for a string the write path could never have written.
  const rawTag = url.searchParams.get('tag')
  const tag =
    rawTag === null ? null : rawTag.trim().slice(0, CONTACT_TAG_MAX) || null

  let query: FirebaseFirestore.Query = collection
  if (email) query = query.where('email', '==', email)
  else if (tag) query = query.where('tags', 'array-contains', tag)

  const { docs, nextCursor } = await paginate(query, url)
  const matched =
    email && tag
      ? docs.filter((doc) => {
          const tags = doc.get('tags')
          return Array.isArray(tags) && tags.includes(tag)
        })
      : docs
  return listResponse(matched.map(contactView), nextCursor, ctx.headers)
}

async function handleContacts(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = contactsCollection(ctx)
  const [, contactId] = segments

  if (!contactId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'contacts:read')
      if (denied) return denied
      return listContacts(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'contacts:write')
      if (denied) return denied
      return createContact(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const contactRef = collection.doc(contactId)

  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'contacts:read')
    if (denied) return denied
    const snap = await contactRef.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such contact', headers: ctx.headers })
    }
    return apiJson(contactView(snap), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'contacts:write')
    if (denied) return denied
    return updateContact(request, ctx, contactRef)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'contacts:write')
    if (denied) return denied
    return deleteContact(request, ctx, contactRef)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}

// ── Usage (read) ────────────────────────────────────────────────────────────

/**
 * One metered dimension, as published (AGL-2277).
 *
 * `included`/`remaining` are `null` for an UNLIMITED band rather than the
 * sentinel itself: `UNLIMITED` is `Number.POSITIVE_INFINITY`, which
 * `JSON.stringify` silently turns into `null` anyway — so the choice is
 * between a `null` that means "unlimited" on purpose and the same `null`
 * arriving by accident, indistinguishable from a bug. Stated explicitly, and
 * documented, so an integrator can branch on it.
 *
 * `metered` is the field that actually answers "what happens when I cross
 * this" — true means the excess bills, false means the next call is refused.
 * It is read off the plan's own overage rate through the `check*Quota`
 * helpers rather than re-derived here, because a second copy of that rule
 * would drift from the one the enforcement path uses, and this endpoint's
 * whole value is telling a customer what the enforcement path will do.
 */
function usageBand(
  used: number,
  included: number,
  remaining: number,
  overageRateUsd: number | null,
) {
  const unlimited = !Number.isFinite(included)
  return {
    used,
    included: unlimited ? null : included,
    remaining: unlimited ? null : remaining,
    metered: overageRateUsd !== null,
  }
}

/**
 * `GET /v1/usage` (AGL-2277) — the caller's own meter, for the current
 * billing month.
 *
 * `/v1` is the metered surface: an integration is the thing generating
 * `apiRequestsPerMonth`, and until this shipped it had no way to ask how much
 * of the band it had spent. The only signal was the `429` at the end of the
 * month with a `Retry-After` pointing at the month boundary — a wall with no
 * approach — and no way at all to check whether a bulk import was about to
 * cross an audience or storage band.
 *
 * NO SCOPE, like `GET /v1/me`. An API key is an organization credential and
 * this is that organization's own meter; requiring, say, `datasets:read`
 * would mean a key scoped to contacts could not see the quota that refuses
 * it. It is metered as one request like everything else, which is why the
 * number it reports may be one behind — see the note on `apiRequests`.
 *
 * `apiRequests` is read from `orgs/{orgId}/apiUsage/{month}` — the LIVE
 * counter `refuseIfApiQuotaExhausted` enforces from, not the swept monthly
 * rollup, so what this reports and what refuses a request are the same
 * number. `dataStorageMb` is the opposite case by necessity: bytes are
 * measured by the `report-usage` sweep, so the honest field to publish is the
 * swept one that billing actually prices from, and its staleness is
 * documented rather than hidden behind a fresh but differently-derived
 * figure.
 */
export async function handleUsage(
  request: Request,
  ctx: ApiV1Context,
): Promise<Response> {
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET' },
    })
  }
  const orgRef = ctx.firestore.collection('orgs').doc(ctx.orgId)
  const month = apiUsageMonth()
  const [apiSnap, storageSnap, contactsSnap, datasetsSnap] = await Promise.all([
    orgRef.collection('apiUsage').doc(month).get(),
    orgRef.collection('usage').doc(month).get(),
    orgRef.collection('contacts').count().get(),
    orgRef.collection('datasets').count().get(),
  ])

  const apiQuota = checkApiRequestQuota(
    ctx.org as never,
    Number(apiSnap.get('count') ?? 0),
  )
  const contactQuota = checkContactQuota(
    ctx.org as never,
    contactsSnap.data().count,
  )
  const datasetQuota = checkDatasetQuota(ctx.org, datasetsSnap.data().count)
  const storageQuota = checkDataStorageQuota(
    ctx.org as never,
    Number(storageSnap.get('dataStorageMb') ?? 0),
  )

  return apiJson(
    {
      object: 'usage',
      month,
      apiRequests: usageBand(
        apiQuota.used,
        apiQuota.included,
        apiQuota.remaining,
        apiQuota.overageRateUsd,
      ),
      contacts: usageBand(
        contactQuota.used,
        contactQuota.included,
        contactQuota.remaining,
        contactQuota.overageRateUsd,
      ),
      // Datasets are the one band with no overage RATE — extra slots are an
      // add-on you buy, not usage that meters — so `metered` is always false
      // and `included` is the effective limit INCLUDING purchased add-ons,
      // which is the number that actually refuses a create.
      datasets: usageBand(
        datasetsSnap.data().count,
        datasetQuota.limit,
        datasetQuota.remaining,
        null,
      ),
      dataStorageMb: usageBand(
        storageQuota.usedMb,
        storageQuota.includedMb,
        storageQuota.remainingMb,
        storageQuota.overageRateUsd,
      ),
    },
    { headers: ctx.headers },
  )
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/** Route a `/v1/<resource>/...` request to its handler. */
export async function dispatchResource(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
): Promise<Response> {
  const url = new URL(request.url)
  switch (segments[0]) {
    case 'datasets':
      return handleDatasets(request, ctx, segments, url)
    case 'sites':
      return handleSites(request, ctx, segments, url)
    case 'contacts':
      return handleContacts(request, ctx, segments, url)
    case 'media':
      // The ORGANIZATION library. A site's own files are the same resource
      // under `/v1/sites/{siteId}/media`.
      return handleScopedMedia(
        request,
        ctx,
        url,
        ctx.firestore.collection('orgs').doc(ctx.orgId),
      )
    default:
      return ApiErrors.notFound({
        message: `Unknown endpoint: /v1/${segments.join('/')}`,
        headers: ctx.headers,
      })
  }
}
