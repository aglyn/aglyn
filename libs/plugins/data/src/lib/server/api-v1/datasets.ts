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
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  createResourceUid,
  defaultScopeForNewResource,
  newResourceScopeFields,
} from '@aglyn/aglyn/server'
import {
  ApiErrors,
  apiJson,
  dataStorageRefusal,
  listResponse,
} from '@aglyn/tenant-data-admin'
import {
  type ApiV1Context,
  claimWrite,
  paginate,
  readJsonBody,
  requireScope,
  serialize,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { announceDatasetRecords as announceDatasetChange } from '../announce-dataset-records'
import { loadCustomFieldTypes } from '../custom-field-types'
import { coerceDocumentValues, datasetIntegrityFields, datasetIntegrityUpdate, effectiveDatasetModel, validateDocument } from '../../model/dataset-models'

/**
 * The organization's datasets on the customer REST API, `/v1/datasets/…`
 * (AGL-2126, AGL-3080): the datasets themselves and the records inside them.
 * Registered from this plugin's console server declarations; the console's
 * `/v1` router owns the pipeline in front — the key, the plan's API access,
 * the request quota, the rate limit — and hands every request under
 * `/v1/datasets` here.
 */

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
  // The fields and the model decide how every bound page formats and orders
  // this dataset's rows, so a schema change is a change to those pages — and
  // no publish follows a `/v1` write (AGL-3386). A rename alone renders
  // nothing: the display name is the console's label for the dataset. Best
  // effort, like the record writes' announce; the update is already stored.
  if (fields !== undefined || model !== undefined) {
    await announceDatasetChange({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      datasetId: datasetRef.id,
    })
  }
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

export async function handleDatasets(
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
  // A plugin's field validator only runs once its plugin has registered it.
  await loadCustomFieldTypes(model, ctx.loadPluginSurfaces)
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
      // The integrity index the delete check queries, written on the same
      // write as the values it describes.
      ...datasetIntegrityFields(model, coerced),
      order,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    const created = await recordsRef.doc(recordId).get()
    const view = recordView(created)
    // AGL-2462 recorded that a `/v1` write cannot publish, and the ONLY thing
    // that made it visible was the hour. It announces now (AGL-3113): the
    // pages repeating over this dataset are dropped, on every site it is
    // shared with. Best effort — the record is already stored.
    await announceDatasetChange({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      datasetId: datasetSnap.id,
    })
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
  // A plugin's field validator only runs once its plugin has registered it.
  await loadCustomFieldTypes(model, ctx.loadPluginSurfaces)
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
  await recordRef.update({
    values: merged,
    // A PATCH that clears the last reference has to REMOVE the index, not
    // omit it: an update leaves an omitted field standing, and a stale
    // `referencedIds` refuses a delete nothing is holding.
    ...datasetIntegrityUpdate(model, merged, FieldValue.delete()),
    updatedAt: Timestamp.now(),
  })
  const updated = await recordRef.get()
  // An edited row is as stale on a live page as a new one (AGL-3113).
  await announceDatasetChange({
    firestore: ctx.firestore,
    orgId: ctx.orgId,
    datasetId: datasetSnap.id,
  })
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
    // A row that is gone is the same staleness as a row that changed: the
    // page goes on rendering it until its cache is dropped (AGL-3113).
    await announceDatasetChange({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      datasetId,
    })
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
