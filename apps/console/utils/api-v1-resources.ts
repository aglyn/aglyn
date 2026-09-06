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
import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import {
  checkApiRequestQuota,
  checkCrmRecordsQuota,
  checkDataStorageQuota,
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  coerceDocumentValues,
  createResourceUid,
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  defaultScopeForNewResource,
  CAPTURED_BY_HOST_FIELD,
  CONTACT_COMPANY_IDS_FIELD,
  CONTACT_FACETS_FIELD,
  CONTACT_LIFECYCLE_STAGES,
  type ContactCompanyLinkPlan,
  contactFacetPath,
  type ContactLifecycleStage,
  CRM_COLLECTIONS,
  effectiveDatasetModel,
  getOrderFulfilmentService,
  inspectUploadBytes,
  isContactLifecycleStage,
  isHostPluginEnabled,
  consentGroupForHost,
  CONTACT_FIELDS_MAX_PER_ORG,
  type ContactCustomValue,
  type ContactFieldDefinition,
  isBlockedSubdomain,
  MARKETING_CONSENT_BY_HOST_FIELD,
  marketingConsentHostIds,
  marketingConsentFieldsForGroup,
  newResourceScopeFields,
  normalizeAddress,
  normalizeContactEmail,
  normalizePhone,
  ORG_SCOPE_TOKEN,
  planContactCompanyLink,
  readContactCompanyLink,
  readContactCustomInput,
  readContactFacet,
  readImageDimensions,
  type AglynPostalAddress,
  type OrderFulfilmentTarget,
  screenRoutePathToUrl,
  SUBDOMAIN_PATTERN,
  UNLIMITED,
  validateDocument,
} from '@aglyn/aglyn/server'
import {
  ApiErrors,
  apiJson,
  consumeRateLimit,
  contactCompanyMirrorValue,
  crmRecordsQuotaForOrg,
  dataStorageRefusal,
  decodeCursor,
  encodeCursor,
  firebaseAdmin,
  generateMediaVariants,
  getMediaQuarantine,
  listResponse,
  parseLimit,
  settleCompanyContactsCounts,
} from '@aglyn/tenant-data-admin'
import { createHash, randomUUID } from 'crypto'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, apiUsageMonth, requireScope } from './api-v1'
import { handleActivities } from './api-v1/crm-activities'
import { handleCompanies } from './api-v1/crm-companies'
import { handleDeals } from './api-v1/crm-deals'
import { handleLeads } from './api-v1/crm-leads'
import { handlePipelines } from './api-v1/crm-pipelines'
import { handleTasks } from './api-v1/crm-tasks'
import {
  CRM_ID_MAX,
  CRM_LABEL_MAX,
  createPayload,
  crmRefErrors,
  memberError,
  readChoice,
  readOptionalText,
  readRefId,
  updatePayload,
} from './api-v1/crm-shared'
import {
  claimWrite,
  orgOwnsHost,
  paginate,
  readJsonBody,
  serialize,
} from './api-v1/shared'
import {
  directUploadMaxBytes,
  isAllowedUploadType,
  isImageUploadType,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  UPLOAD_TYPES_MESSAGE,
} from './media-upload-limits'
import {
  isSvgUploadType,
  sanitizeSvgBuffer,
} from '@aglyn/aglyn/app-utils/sanitize-svg'
import { resolveOrgMediaBand } from './server/media-storage-band'
import { folderStoragePath, mediaCdnPathUpdate } from './server/media-scope'
import {
  claimHostForOrg,
  findSubdomainConflict,
} from './server/provision-host'
import { postTenantRevalidate } from './server/tenant-revalidate'
import { mediaStorageGate, scopeBillsStorageOverage } from './storage-overage'

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
      // The integrity index the delete check queries, written on the same
      // write as the values it describes.
      ...datasetIntegrityFields(model, coerced),
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
  await recordRef.update({
    values: merged,
    // A PATCH that clears the last reference has to REMOVE the index, not
    // omit it: an update leaves an omitted field standing, and a stale
    // `referencedIds` refuses a delete nothing is holding.
    ...datasetIntegrityUpdate(model, merged, FieldValue.delete()),
    updatedAt: Timestamp.now(),
  })
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

/**
 * The only fields a `site` resource is made of, and the projection every
 * host-document read behind it carries. Built from the same list the view
 * reads so a field cannot be added to one and forgotten in the other — a
 * projection missing a field renders it `null` rather than failing, which
 * is the kind of omission a test has to be looking for to catch.
 *
 * The host document is the largest in the product and most of it is theme
 * and routing data no API consumer asked for, so the list read below sends
 * bytes proportional to the page size only through these three names.
 */
const SITE_VIEW_FIELDS = ['displayName', 'subdomain', 'cname'] as const

function siteView(hostId: string, data: FirebaseFirestore.DocumentData | undefined) {
  return {
    id: hostId,
    object: 'site',
    displayName: data?.[SITE_VIEW_FIELDS[0]] ?? null,
    subdomain: data?.[SITE_VIEW_FIELDS[1]] ?? null,
    domain: data?.[SITE_VIEW_FIELDS[2]] ?? null,
  }
}

/**
 * The host documents behind one page of `/v1/sites`, in the order asked for.
 *
 * `Promise.all(ids.map((id) => …doc(id).get()))` is one BatchGetDocuments
 * per site — `DocumentReference.get()` is `getAll([ref])` — so a
 * `?limit=100` list was 100 round trips and 100 whole host documents for
 * three fields each. `getAll` is one round trip for the whole page.
 *
 * Snapshots are paired back by document id and the page is rebuilt in the
 * order it was ASKED for, rather than trusting the order they arrive in: a
 * batch that came back permuted would otherwise hand every site its
 * neighbour's name, and the cursor is the last id of this array.
 */
async function siteViews(
  firestore: FirebaseFirestore.Firestore,
  hostIds: string[],
) {
  // `getAll` requires at least one reference; an empty page is not an error.
  if (!hostIds.length) return []
  const snapshots = await firestore.getAll(
    ...hostIds.map((id) => firestore.collection('hosts').doc(id)),
    { fieldMask: [...SITE_VIEW_FIELDS] },
  )
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  return hostIds.map((id) => siteView(id, byId.get(id)?.data()))
}

/**
 * The per-ORG hourly ceiling on site creation over /v1 (AGL-2465).
 *
 * The console route already limits creates per uid and per IP (AGL-1968),
 * because `*.aglyn.app` is one global namespace and a subdomain someone squats
 * is gone for everybody. An API key has neither a uid nor a stable IP, so the
 * budget is keyed on the ORG — the thing a key actually belongs to, and the
 * thing the `hostLimit` quota is already counted against. Minting ten keys
 * therefore does not multiply the name-grab rate.
 *
 * Generous against real use and fatal to a sweep: an agency onboarding clients
 * does this once per client. The `hostLimit` quota below still bounds how many
 * sites an org may HOLD; this bounds how fast it may try.
 */
export const SITE_CREATE_LIMIT_PER_HOUR = 10
export const SITE_CREATE_WINDOW_MS = 60 * 60 * 1000

/**
 * `POST /v1/sites` — provision a site (AGL-2465).
 *
 * Ordering is scope, then validation, then claim, then budget, then work, and
 * every step of it is load-bearing:
 *
 * - **Scope and ownership first.** A refusal must never consume the budget,
 *   or an unauthorized caller can spend the org's own create allowance from
 *   outside it (AGL-2462's argument for `handlePublish`).
 * - **Deterministic 400s ABOVE the claim**, as `createRecord` and
 *   `createContact` argue: a broken payload must not take the key at all, so
 *   an integrator fixes the body and retries with the SAME key.
 * - **Conditional refusals BELOW it, each releasing the key** (AGL-2296). A
 *   taken subdomain clears when that site is renamed or deleted, and a quota
 *   refusal clears on upgrade — the retry that should finally succeed must
 *   not replay the refusal.
 *
 * The replay itself is what this endpoint exists for. `hosts/create` mints its
 * `hostId` with `createResourceUid()`, so a POST that succeeded server-side
 * but lost its response created a SECOND site on retry; the only thing
 * preventing it was accidental — the retry reused the same subdomain and 409'd
 * on uniqueness — and a client generating a subdomain per attempt lost even
 * that. Site creation is the most expensive object here to duplicate: a
 * `hostLimit` slot, a `hostIndex` write, and `syncOrgAuthProjections` across
 * every member of the org.
 *
 * `claim.record(200, view)` stores the response, so a replay returns the
 * ORIGINAL site — id included — from the stored body rather than a fresh read,
 * which is what makes it survive the site being renamed or deleted afterwards.
 * Stored as 200 while the fresh answer is 201, so a client can tell a replay
 * from a create.
 */
async function createSite(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const displayName = String((body as never)?.['displayName'] ?? '')
    .trim()
    .slice(0, 80)
  const subdomain = String((body as never)?.['subdomain'] ?? '')
    .trim()
    .toLowerCase()

  const fields: Record<string, string> = {}
  if (!displayName) fields['displayName'] = 'Required.'
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    fields['subdomain'] =
      'Must be 3-30 characters, lowercase letters, numbers and hyphens, and start with a letter or number.'
  } else if (isBlockedSubdomain(subdomain)) {
    fields['subdomain'] = 'That subdomain is reserved.'
  }
  if (Object.keys(fields).length > 0) {
    return ApiErrors.badRequest({
      message: 'Site failed validation',
      code: 'validation_failed',
      fields,
      headers: ctx.headers,
    })
  }

  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'sites',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const budget = await consumeRateLimit(`apiv1-site-create:${ctx.orgId}`, {
      limit: SITE_CREATE_LIMIT_PER_HOUR,
      windowMs: SITE_CREATE_WINDOW_MS,
    })
    if (!budget.allowed) {
      // Released: the budget refills, and the retry that should then succeed
      // must not replay a 429.
      await claim.release()
      return ApiErrors.rateLimited(
        Math.max(1, Math.ceil((budget.resetMs - Date.now()) / 1000)),
        ctx.headers,
      )
    }

    const conflict = await findSubdomainConflict(ctx.firestore, subdomain)
    if (conflict) {
      await claim.release()
      return ApiErrors.conflict({
        message: `That subdomain is taken. Available alternatives: ${conflict.suggestions.join(', ') || 'none'}`,
        code: 'subdomain_taken',
        headers: ctx.headers,
      })
    }

    const created = await claimHostForOrg({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      displayName,
      subdomain,
      org: ctx.org as never,
    })
    // Lost the subdomain to a concurrent create between the pre-check above
    // and the transaction's commit (AGL-2465). Same 409 the pre-check answers,
    // and the key is released for the same reason: the caller picks another
    // name and retries, and a burnt key would replay the refusal forever.
    // Suggestions are computed here rather than carried out of the transaction
    // — the winner's name is now genuinely taken, so the ordinary lookup is
    // correct and this path is rare enough that the extra reads do not matter.
    if (!created.allowed && created.conflict === true) {
      await claim.release()
      const raced = await findSubdomainConflict(ctx.firestore, subdomain)
      return ApiErrors.conflict({
        message: `That subdomain is taken. Available alternatives: ${raced?.suggestions.join(', ') || 'none'}`,
        code: 'subdomain_taken',
        headers: ctx.headers,
      })
    }
    if (!created.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message: `Site limit reached (${created.limit}). Upgrade the plan or add extra sites.`,
        code: 'site_quota',
        headers: ctx.headers,
      })
    }

    const view = siteView(created.hostId, {
      displayName,
      subdomain,
    } as never)
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
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
    // `sites:write` is checked BEFORE `sites:read`, matching
    // `handleScopedMedia` (AGL-900): a create-only key must not be told it
    // lacks the read scope it was never meant to hold.
    if (request.method === 'POST') {
      const deniedWrite = requireScope(ctx, 'sites:write')
      if (deniedWrite) return deniedWrite
      return createSite(request, ctx)
    }
    const denied = requireScope(ctx, 'sites:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const hostIds = Object.keys((ctx.org.hosts ?? {}) as Record<string, unknown>).sort()
    const limit = parseLimit(url.searchParams.get('limit'))
    const cursor = decodeCursor(url.searchParams.get('cursor'))
    const start = cursor ? hostIds.findIndex((id) => id > cursor) : 0
    const page = hostIds.slice(start < 0 ? hostIds.length : start, (start < 0 ? hostIds.length : start) + limit)
    const nextCursor = start >= 0 && start + limit < hostIds.length ? encodeCursor(page[page.length - 1]) : null
    return listResponse(
      await siteViews(ctx.firestore, page),
      nextCursor,
      ctx.headers,
    )
  }


  if (!orgOwnsHost(ctx, hostId)) {
    return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  }

  if (!sub) {
    const denied = requireScope(ctx, 'sites:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const [site] = await siteViews(ctx.firestore, [hostId])
    return apiJson(site, { headers: ctx.headers })
  }

  if (sub === 'form-submissions') {
    return handleFormSubmissions(request, ctx, segments, url)
  }

  if (sub === 'orders') return handleOrders(request, ctx, segments, url)
  if (sub === 'products') return handleProducts(request, ctx, segments, url)
  if (sub === 'media')
    return handleScopedMedia(request, ctx, url, hostRef(ctx, hostId), {
      collection: 'hosts',
      base: `hosts/${hostId}`,
      hostId,
      cdnScope: hostId,
    })
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

  const result = await postTenantRevalidate({
    subdomain,
    hostId,
    paths,
    // Same second cache key as the console's own publish route — a site on a
    // custom domain serves its pages under `cname--{domain}`.
    cname: String(snap.get('cname') ?? '') || undefined,
  })
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
    // The form ENTITY this was sent to, `null` for a row written before the
    // form was adopted. `form` below stays the caption — an integration
    // grouping by it is grouping by a display string that a rename splits,
    // which is the whole reason this field exists.
    form_id: doc.get('formId') ?? null,
    form: doc.get('formName') ?? null,
    path: doc.get('path') ?? null,
    fields: doc.get('fields') ?? {},
    read: Boolean(doc.get('read')),
    // Where the platform already sent this row. Omitting it meant an
    // integration syncing submissions into a CRM could not tell that a record
    // had already been written to a dataset — the one fact that stops it
    // duplicating work the platform had done.
    routing: doc.get('routing') ?? null,
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
    const formId = url.searchParams.get('formId')
    // `formId` is the id-first filter and wins when both are sent: it is the
    // one that survives a rename. `?form=` is NOT removed and is not
    // deprecated here — it filters on the caption every submission still
    // carries, which is the only thing a form that has not been adopted yet
    // can be filtered by. The same posture the legacy `?collection=` content
    // parameters take.
    if (formId) query = query.where('formId', '==', formId)
    else if (form) query = query.where('formName', '==', form)
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
    // Either form filter already spent this list's one equality clause, so
    // `read` is applied after the read exactly as it is for `?form=` — a
    // second `where` plus the document-id ordering is a three-clause query
    // and needs its own composite index per combination. The `formId ASC,
    // createdAt DESC` index this work ships serves the CONSOLE's ordered
    // list; `/v1` lists are ordered by document id and are a different query.
    const narrowedByForm = Boolean(formId || form)
    if (read !== null && !narrowedByForm) {
      query = query.where('read', '==', read)
    }
    const { docs, nextCursor } = await paginate(query, url)
    const matched =
      read !== null && narrowedByForm
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
  // `orders:write` is checked BEFORE `orders:read`, matching `handleSites`
  // and `handleScopedMedia` (AGL-900): a fulfilment key that only records
  // shipments must not be told it lacks a read scope it was never meant to
  // hold.
  if (request.method === 'PATCH' && orderId) {
    const deniedWrite = requireScope(ctx, 'orders:write')
    if (deniedWrite) return deniedWrite
    const unentitledWrite = requireCommerce(ctx)
    if (unentitledWrite) return unentitledWrite
    return updateOrder(request, ctx, hostId, orderId)
  }
  const denied = requireScope(ctx, 'orders:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: orderId ? 'GET, PATCH' : 'GET' },
    })
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
 * Statuses this endpoint will move an order TO, and the two it names as
 * refused. Kept as data so the 400 can list them and the docs can be checked
 * against the same source the handler branches on.
 */
const ORDER_WRITE_TARGETS: OrderFulfilmentTarget[] = ['fulfilled', 'delivered']

/**
 * Transitions that exist in the commerce model and are DELIBERATELY not
 * reachable here — refused by name with a 400 that says why, never silently
 * ignored. `cancelled` releases held stock under its own transaction and
 * `refunded` moves money under another; admitting either here would hand a
 * caller a door around exactly the specifics those two routes exist to
 * enforce, and an API key is the credential least able to answer the
 * questions they ask.
 */
const ORDER_WRITE_REFUSED: Record<string, string> = {
  cancelled:
    'Canceling an order releases held stock, so it is not part of this endpoint. Cancel it in the console.',
  refunded:
    'Refunding an order moves money, so it is not part of this endpoint. Refund it in the console.',
}

/**
 * `PATCH /v1/sites/{siteId}/orders/{orderId}` — record a shipment (AGL-2461).
 *
 * ## The write does not live here, and that is the point
 *
 * Not one line of order semantics is implemented in this file. The transition
 * rule, the transaction that re-asks it under the write, the fulfillment
 * append and the timeline entry all belong to the commerce plugin, which
 * `apps/console` may not import (`eslint.config.mjs`, `scope:app` →
 * `notDependOnLibsWithTags:['aglyn:addons']`). This handler reaches them
 * through the core `registerOrderFulfilmentService` capability registry, the
 * same app↔plugin shape as the billing-webhook hooks and site-page resolvers.
 *
 * A second copy of `ORDER_TRANSITIONS` inside `/v1` was the alternative, and
 * it is the bug rather than the fix: two tables drift, and drift here means
 * the API writing an order status the console forbids — `paid → delivered`
 * skipping fulfilment, or a write onto a `refunded` order. That is the class
 * AGL-1818/AGL-1819 exist to close, and it is money-adjacent.
 *
 * ## What THIS function is responsible for: all of the authorization
 *
 * The capability is pre-authorized by contract — it takes `hostId` on trust —
 * so every gate is here, and all four are load-bearing:
 *
 * 1. `orders:write` on the key (checked by the caller, above).
 * 2. The `commerce` PLAN entitlement (checked by the caller, above) — the
 *    plan, never the plugin switch, which is the AGL-1873 distinction.
 * 3. **Org owns the site** — `handleSites` refuses an unowned `hostId` with a
 *    404 before dispatching to any sub-resource, which is what keeps this
 *    from being a cross-tenant write primitive addressable by anyone who can
 *    guess a host id. Deliberately NOT re-checked here: a second copy would
 *    be a gate no test can redden (removing either one alone leaves the other
 *    answering), and an unproven guard on a cross-tenant write is worse than
 *    the one guard a test actually holds. `api-v1-order-fulfilment.spec.ts`'s
 *    "CANNOT move another org's order" case is that test, and it fails when
 *    `handleSites`' `orgOwnsHost` is removed.
 * 4. **The plugin is switched on for this site.** The registry is process-
 *    global and filled by `ensureAll`, so a registered service says nothing
 *    about one org's configuration; without this an org that switched
 *    commerce off for a site would still accept writes into it, which is the
 *    per-site enablement rule (AGL-1014) the plugin API dispatcher applies to
 *    every other commerce door.
 *
 * ## No `Idempotency-Key`
 *
 * None is needed and none is accepted: the capability returns without writing
 * when the order is already in the target status, so a retry lands the same
 * state AND returns the same `200` with the same order body — the contract
 * `updateRecord`, `updateContact` and `updateFormSubmission` are held to.
 */
async function updateOrder(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  orderId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  const unknown = Object.keys(body).filter(
    (key) => key !== 'status' && key !== 'carrier' && key !== 'trackingNumber',
  )
  if (unknown.length > 0) {
    // Named, not dropped — the `updateFormSubmission` / `updateContact` rule.
    // A silently ignored `trackingUrl` here reads as "we recorded your
    // shipment as you described it" when half of it went nowhere, and the
    // caller is a warehouse system that will never look again.
    return ApiErrors.badRequest({
      message:
        'Only `status`, `carrier` and `trackingNumber` can be set on an order',
      code: 'validation_failed',
      fields: Object.fromEntries(
        unknown.map((key) => [key, 'Not writable on an order']),
      ),
      headers: ctx.headers,
    })
  }

  const status = String(body.status ?? '')
  const refusal = ORDER_WRITE_REFUSED[status]
  if (refusal) {
    return ApiErrors.badRequest({
      message: refusal,
      code: 'validation_failed',
      fields: { status: refusal },
      headers: ctx.headers,
    })
  }
  if (!(ORDER_WRITE_TARGETS as string[]).includes(status)) {
    return ApiErrors.badRequest({
      message: 'Order failed validation',
      code: 'validation_failed',
      fields: {
        status: `Must be one of: ${ORDER_WRITE_TARGETS.join(', ')}`,
      },
      headers: ctx.headers,
    })
  }
  // Bounded exactly as the console route bounds them, so one field cannot be
  // used to stuff an order document through a door the console keeps narrow.
  const carrier = String(body.carrier ?? '').slice(0, 40)
  const trackingNumber = String(body.trackingNumber ?? '').slice(0, 60)

  // The plugin's server surface, activated the same way the plugin API
  // dispatcher activates it — one shared loader per process, so this costs
  // nothing after the first request.
  //
  // IMPORTED HERE, NOT AT MODULE SCOPE, and that is not a style choice.
  // `server-plugin-loader` builds the console's plugin manifest as a side
  // effect of being loaded, so a top-level import would run that for EVERY
  // /v1 request — a contacts read, a dataset write — to serve the one path
  // that needs it. It also drags the whole plugin manifest into the module
  // graph of every module that touches this file. Both are paid only by the
  // request that actually records a shipment this way. Node caches the
  // module, so the second call is a map lookup.
  const { serverPluginLoader } = await import('./server-plugin-loader')
  await serverPluginLoader.ensureAll(['consoleApi'])
  const service = getOrderFulfilmentService()
  if (!service) {
    // No loaded plugin provides order fulfilment — a build without commerce,
    // or a self-host that dropped it. The endpoint genuinely does not exist
    // in that deployment, and 404 is the honest answer rather than a 500.
    return ApiErrors.notFound({
      message: 'Order fulfilment is not available on this deployment',
      headers: ctx.headers,
    })
  }

  // Gate 4. `service.pluginId`, never a hard-coded `'commerce'` — the app
  // does not know the addon layer's names, and asking the capability which
  // plugin owns it is what keeps that true.
  const hostSnap = await hostRef(ctx, hostId).get()
  if (!isHostPluginEnabled(ctx.org, hostSnap.data(), service.pluginId)) {
    return ApiErrors.notFound({
      message: 'No such site',
      headers: ctx.headers,
    })
  }

  const outcome = await service.recordShipment({
    hostId,
    orderId,
    to: status as OrderFulfilmentTarget,
    carrier,
    trackingNumber,
  })
  if (outcome.outcome === 'no_such_order') {
    return ApiErrors.notFound({
      message: 'No such order',
      headers: ctx.headers,
    })
  }
  if (outcome.outcome === 'blocked') {
    // A NEW 409 code (`order_transition`), because an integrator has to be
    // able to tell "the order moved on without me" apart from every other
    // conflict this API can raise — it is the one a fulfilment poller will
    // actually hit, and the one it must not retry forever.
    return ApiErrors.conflict({
      message: `Orders in "${outcome.from}" cannot be marked ${status}`,
      code: 'order_transition',
      headers: ctx.headers,
    })
  }
  // The order object, on both `recorded` and `already` — a retry lands the
  // same state and reads the same 200. Re-read after the write so the body
  // shows the shipment that was just recorded rather than the one before it.
  return apiJson(orderView(await hostRef(ctx, hostId).collection('orders').doc(orderId).get()), {
    headers: ctx.headers,
  })
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

/**
 * Which media library a write lands in. Mirrors the fields of `MediaScope`
 * that a create actually needs — `resolveMediaScope` itself cannot be reused
 * here because it resolves a console USER's membership from a uid, and an API
 * key has none (the scope check and `orgOwnsHost` answer that question
 * instead).
 */
interface MediaWriteScope {
  collection: 'orgs' | 'hosts'
  /** Storage prefix: `orgs/{orgId}` or `hosts/{hostId}`. */
  base: string
  hostId: string | null
  /** `{hostId}` or `org:{orgId}` — the CDN route's scope segment. */
  cdnScope: string
}

/**
 * `POST /v1/media` and `POST /v1/sites/{siteId}/media` (AGL-2463).
 *
 * ## The wire format, and why it is not multipart
 *
 * A JSON body with base64 `data`, which is the SAME shape the console's own
 * direct upload route takes — not a new contract invented for the API. It
 * keeps `/v1` to one envelope, and it makes `Idempotency-Key` mean what
 * `conventions.md` publishes: one call, one create, retriable. The signed-URL
 * handshake was the alternative and is worse here on both counts — creation
 * becomes a two-call, three-party operation whose middle leg is not ours, so
 * an idempotency key has no coherent meaning across it.
 *
 * It is also the SAFER of the two, which decided it. The signed route hands
 * the client a URL and never sees the bytes, so it can only record the size
 * the caller declared and a digest derived from GCS's md5 (AGL-1629). Bytes
 * through this path are measured, sanitized and hashed by us:
 *
 * - **Content type**: `isAllowedUploadType`, the same allowlist the console
 *   uses. Refused with `415`.
 * - **Size**: `directUploadMaxBytes` for the type, measured on the DECODED
 *   bytes rather than on a declared `sizeBytes` a caller controls. `413`.
 * - **SVG**: `sanitizeSvgBuffer`, so a stored SVG cannot carry script.
 * - **Digest**: a full sha256 over the received bytes, which is what makes
 *   the takedown check below able to match. `451` when it does.
 * - **Quota**: `mediaStorageGate`, below.
 *
 * ## What this does NOT do, stated plainly
 *
 * There is **no malware or content scanning** at this chokepoint, because
 * there is none at any of the console's four either (AGL-1475) — this
 * endpoint inherits that gap rather than introducing it, and an operator
 * should not read the allowlist as though it were a scanner. There is also
 * **no magic-byte sniffing** anywhere in media ingress: the declared content
 * type is trusted, corrected only by file extension. So `isAllowedUploadType`
 * bounds what a file CLAIMS to be, not what it is, and a caller with a valid
 * key can store arbitrary bytes under an allowed type. The residual risk is
 * bounded by the same things that bound it for the console: uploads land in
 * the customer's own library, and serving is `Content-Type`-pinned. The docs
 * say this in the same words rather than repeating the "virus scanning" claim
 * that was there before and was never true.
 *
 * ## The money
 *
 * `mediaStorageGate`, through `resolveOrgMediaBand` and
 * `scopeBillsStorageOverage` — the SAME three helpers the console's ingress
 * routes call, never a second copy. Storage is already a charged dimension
 * (per-GB overage), so this consumes the existing meter and invents nothing.
 * A second implementation of the band is exactly the drift that keeps
 * `checkContactQuota` shared between capture and `POST /v1/contacts`.
 *
 * ## Ordering
 *
 * Deterministic refusals (415/413/400) sit ABOVE the idempotency claim, so a
 * broken payload never takes the key and the integrator can fix it and retry
 * with the same one. Everything conditional sits below and RELEASES the claim
 * on refusal — `createContact`'s rule, and the reason a create that exactly
 * fills the band stays retriable instead of replaying a `403` forever.
 */
async function createMedia(
  request: Request,
  ctx: ApiV1Context,
  scopeRef: FirebaseFirestore.DocumentReference,
  scope: MediaWriteScope,
  origin: string,
): Promise<Response> {
  const body = (await readJsonBody(request)) as Record<string, unknown>
  const fileName = String(body.fileName ?? 'upload').slice(0, 200)
  const declaredType = String(body.contentType ?? '')
  const contentType = normalizeUploadContentType(declaredType, fileName)

  if (!isAllowedUploadType(contentType)) {
    return ApiErrors.unsupportedMediaType({
      message: UPLOAD_TYPES_MESSAGE,
      code: 'unsupported_media_type',
      headers: ctx.headers,
    })
  }

  // Strict base64. `Buffer.from(x, 'base64')` is famously permissive — it
  // silently drops anything it cannot decode — so a typo'd payload would
  // otherwise be stored as a short, corrupt file that reports success.
  const raw = String(body.data ?? '')
  const decoded = Buffer.from(raw, 'base64')
  if (!raw || !decoded.length || decoded.toString('base64').replace(/=+$/, '') !== raw.replace(/\s/g, '').replace(/=+$/, '')) {
    return ApiErrors.badRequest({
      message: '`data` must be the file\'s bytes, base64-encoded',
      code: 'validation_failed',
      fields: { data: 'not valid base64' },
      headers: ctx.headers,
    })
  }

  const maxBytes = Number(directUploadMaxBytes(contentType) ?? 0)
  if (!maxBytes || decoded.length > maxBytes) {
    return ApiErrors.payloadTooLarge({
      message: `File is too large (${Math.round(maxBytes / 1024 / 1024)}MB max for ${contentType})`,
      code: 'file_too_large',
      headers: ctx.headers,
    })
  }

  /**
   * STRUCTURAL inspection (AGL-1475). AGL-2463 shipped this route with the
   * gap written down — "no magic-byte sniffing anywhere in media ingress, the
   * declared type is trusted" — and this is that sentence being retired.
   *
   * It matters more here than on the console routes, not less. This is the
   * key-authenticated path: the caller is a migration tool or an agency's
   * automation, not a person watching a progress bar, and `media:write` was
   * added precisely so a key could fill a library unattended. A key that
   * leaks fills it unattended too.
   *
   * Structure only — not an antivirus scan. See `upload-inspection.ts` for
   * the exact boundary, and do not let it drift back into a scanning claim.
   */
  {
    const refusal = inspectUploadBytes({
      bytes: decoded,
      contentType,
      fileName,
    })
    if (refusal) {
      return ApiErrors.unsupportedMediaType({
        message: refusal.message,
        code: refusal.code,
        headers: ctx.headers,
      })
    }
  }

  // Sanitize BEFORE hashing and before measuring what we store, so the digest
  // and the counter both describe the bytes that actually landed.
  const svg = isSvgUploadType(contentType) ? sanitizeSvgBuffer(decoded) : null
  const buffer = svg ? svg.buffer : decoded
  const contentSha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
  const contentHash = contentSha256.slice(0, 16)

  const claimed = await claimWrite(
    ctx,
    scope.collection === 'hosts' ? (scope.hostId ?? '*') : '*',
    request.headers.get('Idempotency-Key'),
    'media',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    // The takedown ledger, matched on the digest we just computed.
    const quarantine = await getMediaQuarantine({ contentSha256, contentHash })
    if (quarantine) {
      await claim.release()
      return ApiErrors.unavailableForLegalReasons({
        code: 'media_quarantined',
        headers: ctx.headers,
      })
    }

    // Video and document uploads are a paid capability; images are not.
    if (
      requiresFileUploadEntitlement(contentType) &&
      !checkEntitlement(ctx.org, 'videoMedia')
    ) {
      await claim.release()
      return ApiErrors.planRequired({
        message: 'Video and file uploads require a Pro plan',
        code: 'media_type_plan',
        headers: ctx.headers,
      })
    }

    const band = await resolveOrgMediaBand({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      org: ctx.org as never,
      currentHostId: scope.collection === 'hosts' ? scope.hostId : null,
    })
    const gate = mediaStorageGate({
      org: ctx.org as never,
      // Includes the incoming file, and keeps the caller's `Math.ceil(x) - 1`
      // convention (AGL-471) by handing the helper the same input the console
      // does rather than a second rounding rule.
      usedMb: (band.usedBytes + buffer.length) / (1024 * 1024),
      allowanceMb: band.allowanceMb,
      billsOverage: scopeBillsStorageOverage(scope.collection),
    })
    if (!gate.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
        code: 'storage_quota',
        headers: ctx.headers,
      })
    }

    const mediaId = createResourceUid()
    const token = randomUUID()
    const folderId = body.folderId ? String(body.folderId).slice(0, 64) : null
    const folderPath = await folderStoragePath(scopeRef, folderId)
    // Built the same way the console's upload route builds it: the object
    // lives INSIDE its folder's Storage prefix, so the bucket tree mirrors the
    // library tree. (`mediaObjectPath` is the read-side helper — it derives a
    // path from an EXISTING media document, which a create does not have.)
    const objectPath =
      `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    await bucket.file(objectPath).save(buffer, {
      contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}?alt=media&token=${token}`

    const dimensions = isImageUploadType(contentType)
      ? (readImageDimensions(new Uint8Array(buffer)) ?? {})
      : {}
    const isPrivate = body.private === true
    const cdnAllowed = checkEntitlement(ctx.org, 'mediaCdn') && !isPrivate
    const variants = cdnAllowed
      ? await generateMediaVariants({
          buffer,
          contentType,
          sourceWidth: (dimensions as { width?: number }).width,
          objectPath,
          saveVariant: async (path: string, webp: Buffer) => {
            await bucket.file(path).save(webp, { contentType: 'image/webp' })
          },
        }).catch(() => null)
      : null

    await scopeRef.collection('media').doc(mediaId).create({
      fileName,
      contentType,
      sizeBytes: buffer.length,
      url: downloadUrl,
      storagePath: objectPath,
      folderId,
      ...dimensions,
      ...(body.alt ? { alt: String(body.alt).slice(0, 500) } : {}),
      contentHash,
      contentSha256,
      variants: (variants as { variants?: number[] })?.variants ?? [],
      ...(svg?.removed?.length ? { svgSanitized: svg.removed } : {}),
      // The org library is shared across sites, so a file written there needs
      // a scope token or it matches no scoped read (AGL-1044).
      ...(scope.collection === 'orgs'
        ? { visibleTo: defaultScopeForNewResource({ hostId: null }) }
        : {}),
      // Stable, mediaId-keyed CDN URL (AGL-829). The helper applies the
      // plan-and-private rule itself, so this is the same expression the
      // console's three ingress routes write and cannot disagree with them.
      cdnPath: mediaCdnPathUpdate({
        billing: ctx.org as never,
        cdnScope: scope.cdnScope,
        mediaId,
        isPrivate,
      }),
      ...(isPrivate ? { private: true } : {}),
      // `sources.api`, beside the console's own uploads, so a merchant can see
      // which files an integration put there.
      uploadedBy: `api:${ctx.keyId}`,
      createdAt: Timestamp.now(),
    })

    // The billed counter, LAST and by increment — the same write and the same
    // exclusion of generated variant bytes the console ingress routes make, so
    // ingress and `report-usage` keep describing one number.
    await scopeRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(buffer.length),
          count: firebaseAdmin.firestore.FieldValue.increment(1),
        },
        { merge: true },
      )

    const view = mediaView(await scopeRef.collection('media').doc(mediaId).get(), origin)
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

async function handleScopedMedia(
  request: Request,
  ctx: ApiV1Context,
  url: URL,
  scopeRef: FirebaseFirestore.DocumentReference,
  scope: MediaWriteScope,
): Promise<Response> {
  const origin = url.origin
  const segmentsAll = url.pathname.split('/').filter(Boolean)

  // POST is a create on the COLLECTION only — never on `/media/{id}`, which
  // would read as a replace. Checked before the read scope so a write-only key
  // is not told it is missing `media:read` (AGL-900).
  if (request.method === 'POST') {
    if (segmentsAll[segmentsAll.length - 1] !== 'media') {
      return ApiErrors.methodNotAllowed({
        headers: { ...ctx.headers, Allow: 'GET' },
      })
    }
    const deniedWrite = requireScope(ctx, 'media:write')
    if (deniedWrite) return deniedWrite
    return createMedia(request, ctx, scopeRef, scope, origin)
  }

  const denied = requireScope(ctx, 'media:read')
  if (denied) return denied
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }
  const collection = scopeRef.collection('media')
  // The trailing segment is the media id only on the `/media/{id}` shape.
  const mediaId =
    segmentsAll[segmentsAll.length - 2] === 'media'
      ? segmentsAll[segmentsAll.length - 1]
      : ''

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
/**
 * The CRM profile a contact carries (AGL-2606): the six fields a sales team
 * keeps on a person, read from the FACETS because that is where the console
 * keeps them — per holder, under `facets.{groupId}` (`ContactFacet`), so two
 * unrelated businesses sharing one row never read each other's knowledge of
 * the person.
 *
 * An API key is an organization credential, and every facet on the row is
 * the organization's own; so with no site named the profile is the UNION of
 * the holders — each field from the first holder, in stable id order, that
 * has set it. That is the right read for the caller a key represents (an
 * integration acting for the account) and the only one that does not force
 * every read to name a site. Naming one (`?consentSiteId=`) reads that
 * site's group alone, which is what a per-brand sync wants and what a PATCH
 * that just wrote through that site reads back.
 *
 * `null` for every unset field rather than an absent key, so a client can
 * tell "no phone" from "this API does not publish phones".
 */
const CONTACT_CRM_FIELDS = [
  'phone',
  'jobTitle',
  'companyId',
  'address',
  'ownerUid',
  'lifecycleStage',
] as const

type ContactCrmField = (typeof CONTACT_CRM_FIELDS)[number]

/** The groups holding a facet on this row, in stable order. */
function contactFacetHolders(data: FirebaseFirestore.DocumentData): string[] {
  const facets = data[CONTACT_FACETS_FIELD]
  return facets && typeof facets === 'object' && !Array.isArray(facets)
    ? Object.keys(facets).sort()
    : []
}

function contactCrmProfile(
  data: FirebaseFirestore.DocumentData,
  groupId: string | null,
): Record<ContactCrmField, unknown> {
  const profile: Record<ContactCrmField, unknown> = {
    phone: null,
    jobTitle: null,
    companyId: null,
    address: null,
    ownerUid: null,
    lifecycleStage: null,
  }
  for (const holder of groupId ? [groupId] : contactFacetHolders(data)) {
    const facet = readContactFacet(data, holder)
    for (const field of CONTACT_CRM_FIELDS) {
      const value = facet[field]
      if (profile[field] === null && value !== undefined && value !== null) {
        profile[field] = value
      }
    }
  }
  return profile
}

/**
 * @param groupId - the holder whose CRM profile to publish, or `null` for
 *   the union — see {@link contactCrmProfile}.
 */
function contactView(
  doc: FirebaseFirestore.DocumentSnapshot,
  groupId: string | null = null,
) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'contact',
    email: data.email ?? null,
    name: data.name ?? null,
    tags: data.tags ?? [],
    notes: data.notes ?? null,
    ...contactCrmProfile(data, groupId),
    // Every company any holder has filed the person under — the top-level
    // twin of the facets' `companyId`, and what `?companyId=` queries.
    companyIds: Array.isArray(data.companyIds)
      ? data.companyIds.filter((id: unknown) => typeof id === 'string')
      : [],
    /*
     * TRUE means "some site may mail this person", and `consentSites` says
     * which. A single boolean is what the org-wide model published, and it is
     * exactly the claim that turned out to be wrong: an agency's key read
     * `true` and could not tell which of its brands the person had agreed to
     * hear from. Both are published so a client can act on either.
     */
    marketingConsent:
      data.marketingConsent === false
        ? false
        : marketingConsentHostIds(data).length > 0,
    consentSites: marketingConsentHostIds(data),
    sources: data.sources ? Object.keys(data.sources) : [],
    /*
     * The org's custom field values, keyed by field key (AGL-2601). The same
     * top-level map `tags` and `notes` beside it are read from — this resource
     * is the ORGANIZATION's view, and its writes land there. An empty object
     * rather than `null`, so a client can index it without a guard.
     */
    custom:
      data.custom && typeof data.custom === 'object' && !Array.isArray(data.custom)
        ? (data.custom as Record<string, ContactCustomValue>)
        : {},
    created: serialize(data.createdAt) ?? null,
    updated: serialize(data.updatedAt) ?? null,
  }
}

/**
 * The org's custom field definitions, retired ones included, for the API's
 * `custom` validation (AGL-2601).
 *
 * One bounded read of a small collection, paid only when a body carries
 * `custom` — the reader is called from the two writers, never from the view.
 * Retired definitions come back too because `readContactCustomInput` refuses
 * a write under one BY NAME, which is a better answer than "no such field"
 * for a key the integration wrote last month.
 */
async function readOrgContactFieldDefinitions(
  ctx: ApiV1Context,
): Promise<ContactFieldDefinition[]> {
  const snapshot = await ctx.firestore
    .collection('orgs')
    .doc(ctx.orgId)
    .collection(CRM_COLLECTIONS.contactFields)
    .orderBy(FieldPath.documentId())
    .limit(CONTACT_FIELDS_MAX_PER_ORG)
    .get()
  return snapshot.docs.map((doc) => doc.data() as ContactFieldDefinition)
}

const CONTACT_NAME_MAX = 120
const CONTACT_NOTES_MAX = 2000
const CONTACT_TAGS_MAX = 50
const CONTACT_TAG_MAX = 60

/** Fields a client may send. Anything else is named, never silently dropped. */
const CONTACT_WRITABLE = [
  'name',
  'tags',
  'notes',
  'marketingConsent',
  'consentSiteId',
  'custom',
] as const

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
/**
 * The CRM profile fields a contact write may carry (AGL-2606), each `null`
 * to clear. A `type` rather than an `interface` so it is a
 * `Record<string, unknown>` to the payload helpers without a cast.
 */
type ContactCrmInput = {
  phone?: string | null
  jobTitle?: string | null
  companyId?: string | null
  address?: AglynPostalAddress | null
  ownerUid?: string | null
  lifecycleStage?: ContactLifecycleStage | null
}

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
        consentSiteId?: string
        /**
         * The `custom` map as SENT, shape-checked only. Its keys and values
         * are judged against the org's definitions by the writer, which is
         * the side holding a Firestore handle (AGL-2601).
         */
        custom?: Record<string, unknown>
        crm: ContactCrmInput
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
    consentSiteId?: string
    custom?: Record<string, unknown>
    crm: ContactCrmInput
  } = { crm: {} }

  const allowed = new Set<string>([
    ...CONTACT_WRITABLE,
    ...CONTACT_CRM_FIELDS,
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

  if (body.consentSiteId !== undefined) {
    const siteId = String(body.consentSiteId ?? '').trim()
    if (!siteId) errors.consentSiteId = 'Must name a site'
    else values.consentSiteId = siteId
  }

  if (body.marketingConsent !== undefined) {
    if (typeof body.marketingConsent !== 'boolean') {
      errors.marketingConsent = 'Must be true or false'
    } else {
      values.marketingConsent = body.marketingConsent
    }
  }

  if (body.custom !== undefined) {
    if (!body.custom || typeof body.custom !== 'object' || Array.isArray(body.custom)) {
      errors.custom = 'Must be an object of field values keyed by field key'
    } else {
      values.custom = body.custom as Record<string, unknown>
    }
  }

  /*
   * The CRM profile (AGL-2606). Each value runs through the normalizer the
   * console writes with — `normalizePhone`, `normalizeAddress`, the lifecycle
   * list — so the API cannot store a phone the console would refuse, or an
   * address of empty strings the console would read as "has an address". A
   * value that does not survive names the field rather than storing the raw
   * string: a half-normalized phone is the unusable number `normalizePhone`
   * exists to end. The readers are `crm-shared`'s, so a contact and a company
   * bound their text the same way. `ownerUid` and `companyId` are checked for
   * existence by the caller, after this synchronous pass, so a body already
   * refused never spends the reads.
   */
  const crm: ContactCrmInput = {}
  const phone = readOptionalText(body, 'phone', CRM_LABEL_MAX, errors)
  if (phone === null) {
    crm.phone = null
  } else if (phone !== undefined) {
    const normalized = normalizePhone(phone)
    if (normalized) crm.phone = normalized
    else errors.phone = 'Must be a phone number with a country code, like +15125550123'
  }
  const jobTitle = readOptionalText(body, 'jobTitle', CONTACT_NAME_MAX, errors)
  if (jobTitle !== undefined) crm.jobTitle = jobTitle
  const companyId = readRefId(body, 'companyId', errors)
  if (companyId !== undefined) crm.companyId = companyId
  if (body.address !== undefined) {
    if (body.address === null) {
      crm.address = null
    } else if (typeof body.address !== 'object' || Array.isArray(body.address)) {
      errors.address = 'Must be an address object'
    } else {
      // A blank address normalizes to `null`, which clears.
      crm.address = normalizeAddress(body.address as AglynPostalAddress)
    }
  }
  const ownerUid = readOptionalText(body, 'ownerUid', CONTACT_NAME_MAX, errors)
  if (ownerUid !== undefined) crm.ownerUid = ownerUid
  if (body.lifecycleStage === null) {
    crm.lifecycleStage = null
  } else {
    const stage = readChoice(body, 'lifecycleStage', CONTACT_LIFECYCLE_STAGES, errors)
    if (stage) crm.lifecycleStage = stage
  }
  values.crm = crm
  // Whether the body MEANT to write a profile — judged by the keys it sent,
  // not by which of them parsed, so a body whose every profile value was
  // refused is told about those values and not also that its site was
  // unwelcome.
  const writesCrm = CONTACT_CRM_FIELDS.some((field) => body[field] !== undefined)

  /*
   * AN OPT-IN MUST NAME THE SITE IT WAS GIVEN TO; A REFUSAL MUST NOT.
   *
   * An API key belongs to an ORGANIZATION, and an organization is not a
   * controller — an agency's key reaches every client brand it runs. So an
   * integration asserting that somebody opted in has to say which brand they
   * opted in to, exactly as a form does by being served from one site. There
   * is no safe default: picking the org's only site works until the org has
   * two, and picking none is the org-wide grant this field exists to stop.
   *
   * A refusal is the mirror image and is refused a site on purpose. It
   * applies to every brand in the account, which is what `readMarketingBasis`
   * does with an unscoped `false`, and accepting a site alongside it would
   * imply a per-brand opt-out this endpoint does not write.
   */
  if (values.marketingConsent === true && !values.consentSiteId) {
    errors.consentSiteId =
      'Required with marketingConsent: true — name the site the person opted in to'
  }
  /*
   * A CRM PROFILE FIELD NAMES THE SITE TOO (AGL-2606), for the facet's
   * reason: the profile is one holder's knowledge of the person and lives
   * under that holder's group, so a write has to say whose. The same
   * parameter, because it is the same question — which of the organization's
   * sites is this write made on behalf of — and an integrator should not
   * learn two names for it. Beside a refusal the site is accepted, since the
   * refusal still applies to every site and the site now names the facet.
   */
  if (writesCrm && !values.consentSiteId) {
    errors.consentSiteId =
      'Required with a CRM profile field — name the site whose profile of this person to write'
  }
  if (values.marketingConsent === false && values.consentSiteId && !writesCrm) {
    errors.consentSiteId =
      'Not accepted with marketingConsent: false — a refusal applies to every site'
  }
  if (values.consentSiteId && values.marketingConsent === undefined && !writesCrm) {
    errors.consentSiteId =
      'Only accepted alongside marketingConsent or a CRM profile field'
  }

  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * The two references a contact's CRM profile can carry, checked for
 * existence — the SAME checks a deal or a task makes on its own `ownerUid`
 * and `companyId`, so a contact cannot point at a company `/v1/deals` would
 * refuse. Run after the synchronous grammar, so a body already refused never
 * spends the reads.
 */
async function contactCrmRefErrors(
  ctx: ApiV1Context,
  crm: ContactCrmInput,
): Promise<Record<string, string>> {
  const [owner, refs] = await Promise.all([
    memberError(ctx, 'ownerUid', crm.ownerUid),
    crmRefErrors(ctx, { companyId: crm.companyId ?? undefined }),
  ])
  return { ...owner, ...refs }
}

/**
 * The facet a create writes when the body carried a CRM profile field, under
 * the group of the site the write named — filed as `upsertHostContact` files
 * a capture — plus the top-level `companyIds` the company filter queries.
 *
 * A NESTED object rather than dotted paths, because this is a `create()` and
 * there is no other holder's facet on the row to clobber yet.
 * {@link contactCrmUpdateFields} writes the same fields as paths for the
 * opposite reason.
 */
function contactCrmCreateFields(
  ctx: ApiV1Context,
  crm: ContactCrmInput,
  siteId: string,
): Record<string, unknown> {
  const stored = createPayload(crm)
  if (Object.keys(stored).length === 0) return {}
  const group = consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
  return {
    [CONTACT_FACETS_FIELD]: {
      [group.groupId]: { sources: { api: true }, interactions: [], ...stored },
    },
    ...(crm.companyId ? { companyIds: [crm.companyId] } : {}),
  }
}

/**
 * The CRM profile as an `update()` payload: one dotted path per field sent,
 * under the facet of the named site's group — `contactFacetPath`, never a
 * nested object, because an `update` REPLACES a map it is handed whole and
 * the nested form would delete every other holder's profile of the person.
 * `null` becomes a field delete, so a PATCH can clear.
 *
 * `companyIds` is the top-level twin of the facets' `companyId`s, kept so
 * `?companyId=` can be one indexed clause. Which ids it keeps is the CRM's
 * one planner's decision (`planContactCompanyLink`, AGL-2613): the old id
 * leaves only when no OTHER holder still files the person under it, an id
 * some other surface put there is left exactly where it was, and the plan
 * also names the companies whose contacts count the write moves — which the
 * caller settles after the contact is written, because they are other
 * documents.
 */
function contactCrmUpdateFields(
  ctx: ApiV1Context,
  data: FirebaseFirestore.DocumentData,
  crm: ContactCrmInput,
  siteId: string,
): { update: Record<string, unknown>; link: ContactCompanyLinkPlan | null } {
  const update: Record<string, unknown> = {}
  const group = consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
  for (const [field, value] of Object.entries(updatePayload(crm))) {
    update[contactFacetPath(group.groupId, field)] = value
  }
  let link: ContactCompanyLinkPlan | null = null
  if (crm.companyId !== undefined) {
    link = planContactCompanyLink(
      readContactCompanyLink(data, group.groupId),
      crm.companyId,
    )
    const mirror = link ? contactCompanyMirrorValue(link) : undefined
    if (mirror !== undefined) update[CONTACT_COMPANY_IDS_FIELD] = mirror
  }
  return { update, link }
}

/**
 * The holder a contact READ is for, from `?consentSiteId=`: that site's
 * consent group, or `null` for the union view. The parameter the writes take,
 * validated the same way, so a client has one name for "which site" on every
 * contact call.
 */
function contactViewGroup(
  ctx: ApiV1Context,
  url: URL,
): { groupId: string | null } | { response: Response } {
  const siteId = (url.searchParams.get('consentSiteId') ?? '').trim()
  if (!siteId) return { groupId: null }
  if (!orgOwnsHost(ctx, siteId)) {
    return {
      response: ApiErrors.badRequest({
        message: 'Contact filter failed validation',
        code: 'validation_failed',
        fields: { consentSiteId: 'No such site in this organization' },
        headers: ctx.headers,
      }),
    }
  }
  return {
    groupId: consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
      .groupId,
  }
}

const contactsCollection = (ctx: ApiV1Context) =>
  ctx.firestore.collection('orgs').doc(ctx.orgId).collection('contacts')

/** The org's companies, beside its contacts — where a link's count lands (AGL-2613). */
const companiesCollection = (ctx: ApiV1Context) =>
  ctx.firestore.collection('orgs').doc(ctx.orgId).collection(CRM_COLLECTIONS.companies)

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
  const { email, name, tags, notes, marketingConsent, consentSiteId, crm } =
    parsed.values
  if (consentSiteId && !orgOwnsHost(ctx, consentSiteId)) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: { consentSiteId: 'No such site in this organization' },
      headers: ctx.headers,
    })
  }
  // Judged against the org's definitions, above the claim like every other
  // deterministic 400: an unknown key is named, never dropped (AGL-2601).
  const custom = parsed.values.custom
    ? readContactCustomInput(
        parsed.values.custom,
        await readOrgContactFieldDefinitions(ctx),
      )
    : null
  if (custom && 'errors' in custom) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: custom.errors,
      headers: ctx.headers,
    })
  }
  // Resolved to the map itself here, above the claim, because the create
  // below is reached through a try block the narrowing above does not
  // survive; an empty map writes no `custom` key at all.
  const customValues = custom && 'values' in custom ? custom.values : {}
  // Still validation, still above the claim: a dangling `companyId` is as
  // deterministic a 400 as a malformed one, and must not burn the key.
  const crmErrors = await contactCrmRefErrors(ctx, crm)
  if (Object.keys(crmErrors).length) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: crmErrors,
      headers: ctx.headers,
    })
  }

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

    // Three aggregate reads, the same ones `upsertHostContact` and the
    // monthly rollup take — the band counts companies and deals beside the
    // contacts (AGL-2611). Unconditional, matching `createDataset` — the
    // alternative is a per-plan shape check like `dataStorageEnforcementShape`,
    // and a `count()` costs one read against a write that costs one anyway.
    const quota = await crmRecordsQuotaForOrg(
      ctx.org as never,
      ctx.firestore.collection('orgs').doc(ctx.orgId),
      collection,
    )
    if (!quota.allowed) {
      await claim.release()
      // `contact_quota` is the code this endpoint has always answered with
      // and integrators match on it; the band behind it widened, the code
      // did not. Companies and deals answer `crm_records_quota`.
      return ApiErrors.planRequired({
        message:
          `CRM records limit reached (${quota.included} records across ` +
          'contacts, companies and deals). Upgrade the plan to add more.',
        code: 'contact_quota',
        headers: ctx.headers,
      })
    }

    const id = createResourceUid()
    await collection.doc(id).create({
      email,
      // The search keys travel with the name — the console's contact list
      // searches the whole collection, not the page it fetched.
      ...(name ? nameSearchFields(name) : {}),
      tags: tags ?? [],
      ...(notes ? { notes } : {}),
      ...(Object.keys(customValues).length ? { custom: customValues } : {}),
      ...(marketingConsent && consentSiteId
        ? {
            // The declared controller the named site belongs to, so an API
            // opt-in pools exactly where a form on that site would.
            ...marketingConsentFieldsForGroup(
              consentGroupForHost(ctx.org as Record<string, unknown>, consentSiteId),
              Date.now(),
            ),
          }
        : {}),
      [CAPTURED_BY_HOST_FIELD]: consentSiteId ? [consentSiteId] : [],
      // A refusal carries no site: it stands against every brand in the
      // account — see `readMarketingBasis` for the asymmetry.
      ...(marketingConsent === false ? { marketingConsent: false } : {}),
      // The CRM profile, when the body carried one — under the named site's
      // facet, which `readContactInput` has already required it to name.
      ...(consentSiteId ? contactCrmCreateFields(ctx, crm, consentSiteId) : {}),
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
    // The company the body named has one more contact naming it (AGL-2613);
    // a fresh row's plan is the trivial one, and `crmRefErrors` has already
    // required the company to exist.
    if (consentSiteId && crm.companyId) {
      await settleCompanyContactsCounts(
        companiesCollection(ctx),
        planContactCompanyLink(
          { companyId: null, companyIds: [], heldElsewhere: [] },
          crm.companyId,
        ),
      )
    }
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

  const { name, tags, notes, marketingConsent, consentSiteId, crm } =
    parsed.values
  if (consentSiteId && !orgOwnsHost(ctx, consentSiteId)) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: { consentSiteId: 'No such site in this organization' },
      headers: ctx.headers,
    })
  }
  const crmErrors = await contactCrmRefErrors(ctx, crm)
  if (Object.keys(crmErrors).length) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: crmErrors,
      headers: ctx.headers,
    })
  }
  const update: Record<string, unknown> = {}
  // A rename must move the search keys with it, or the contact stays findable
  // only by the name they no longer have.
  if (name !== undefined) Object.assign(update, nameSearchFields(name))
  if (tags !== undefined) update.tags = tags
  if (notes !== undefined) update.notes = notes
  if (parsed.values.custom !== undefined) {
    const custom = readContactCustomInput(
      parsed.values.custom,
      await readOrgContactFieldDefinitions(ctx),
    )
    if ('errors' in custom) {
      return ApiErrors.badRequest({
        message: 'Contact failed validation',
        code: 'validation_failed',
        fields: custom.errors,
        headers: ctx.headers,
      })
    }
    /*
     * One dotted path per key, because this is an `update` and an `update`
     * REPLACES a map it is handed whole. `custom` on a PATCH means "these
     * keys", the way the console's own save writes only the keys that
     * changed; an integration correcting one value must not have to resend
     * the other nine to keep them (AGL-2601).
     */
    for (const [key, value] of Object.entries(custom.values)) {
      update[`custom.${key}`] = value
    }
  }
  if (marketingConsent === true && consentSiteId) {
    /*
     * A dotted path rather than a nested object, because this is an `update`
     * and an `update` REPLACES a map field it is handed whole. Writing the
     * nested form here would delete every other site's grant — the exact
     * over-application this change exists to end, arriving through the write
     * side instead of the read side.
     */
    const group = consentGroupForHost(
      ctx.org as Record<string, unknown>,
      consentSiteId,
    )
    for (const hostId of group.hostIds) {
      update[`${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}`] = {
        marketingConsent: true,
        // The consent timestamp is the evidence, so it is stamped when
        // consent is GIVEN and left alone when it is withdrawn — an audit
        // needs to know when the person opted in, and clearing it would
        // destroy that record.
        marketingConsentAtMs: Date.now(),
        ...(group.declared
          ? {
              consentGroupId: group.groupId,
              consentGroupName: group.name ?? '',
            }
          : {}),
      }
    }
  } else if (marketingConsent === false) {
    update.marketingConsent = false
  }
  let link: ContactCompanyLinkPlan | null = null
  if (consentSiteId) {
    const crmFields = contactCrmUpdateFields(ctx, snap.data() ?? {}, crm, consentSiteId)
    Object.assign(update, crmFields.update)
    link = crmFields.link
  }
  // An empty body is a no-op answered with the current contact, matching
  // `updateDataset`: a client re-sending an unchanged object should not have
  // to special-case it.
  if (Object.keys(update).length > 0) {
    await contactRef.update({ ...update, updatedAt: Timestamp.now() })
    // The companies the link moved off or onto, counted after the contact
    // is written (AGL-2613); `crmRefErrors` has already required the new
    // company to exist.
    await settleCompanyContactsCounts(companiesCollection(ctx), link)
  }
  // Read back through the site the write named, so what the client sees is
  // the profile it just wrote and not another holder's.
  const groupId = consentSiteId
    ? consentGroupForHost(ctx.org as Record<string, unknown>, consentSiteId)
        .groupId
    : null
  return apiJson(contactView(await contactRef.get(), groupId), {
    headers: ctx.headers,
  })
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

  /*
   * The CRM filters (AGL-2606). `companyId` can be a clause: it queries the
   * top-level `companyIds` array, the twin every profile write keeps for
   * exactly this. `lifecycleStage` and `ownerUid` cannot — they live on a
   * facet, and a facet field is not queryable without the holder in the
   * path, which the org-wide read does not have — so both are applied to the
   * page, against the SAME profile the view publishes: the named site's, or
   * the union. A filtered page can therefore come back short, as `?email=`
   * with `?tag=` already does. A stage that is not one of the list is a
   * `400`, because `?lifecycleStage=customers` matching nothing is the
   * plausible empty page the conventions refuse to serve.
   */
  const rawStage = (url.searchParams.get('lifecycleStage') ?? '').trim()
  if (rawStage && !isContactLifecycleStage(rawStage)) {
    return ApiErrors.badRequest({
      message: 'Contact filter failed validation',
      code: 'validation_failed',
      fields: {
        lifecycleStage: `Must be one of: ${CONTACT_LIFECYCLE_STAGES.join(', ')}`,
      },
      headers: ctx.headers,
    })
  }
  const lifecycleStage = rawStage || null
  const ownerUid =
    (url.searchParams.get('ownerUid') ?? '').trim().slice(0, CONTACT_NAME_MAX) ||
    null
  const companyId =
    (url.searchParams.get('companyId') ?? '').trim().slice(0, CRM_ID_MAX) || null
  const group = contactViewGroup(ctx, url)
  if ('response' in group) return group.response

  // ONE clause, the most selective that was given: the unique email, then
  // the company, then the tag. Every other filter is checked on the page.
  let query: FirebaseFirestore.Query = collection
  let clause: 'email' | 'companyId' | 'tag' | null = null
  if (email) {
    query = query.where('email', '==', email)
    clause = 'email'
  } else if (companyId) {
    query = query.where('companyIds', 'array-contains', companyId)
    clause = 'companyId'
  } else if (tag) {
    query = query.where('tags', 'array-contains', tag)
    clause = 'tag'
  }

  const { docs, nextCursor } = await paginate(query, url)
  const matched = docs.filter((doc) => {
    const data = doc.data()
    if (tag && clause !== 'tag') {
      if (!Array.isArray(data.tags) || !data.tags.includes(tag)) return false
    }
    if (companyId && clause !== 'companyId') {
      if (!Array.isArray(data.companyIds) || !data.companyIds.includes(companyId)) {
        return false
      }
    }
    if (lifecycleStage || ownerUid) {
      const profile = contactCrmProfile(data, group.groupId)
      if (lifecycleStage && profile.lifecycleStage !== lifecycleStage) return false
      if (ownerUid && profile.ownerUid !== ownerUid) return false
    }
    return true
  })
  return listResponse(
    matched.map((doc) => contactView(doc, group.groupId)),
    nextCursor,
    ctx.headers,
  )
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
    const group = contactViewGroup(ctx, url)
    if ('response' in group) return group.response
    const snap = await contactRef.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such contact', headers: ctx.headers })
    }
    return apiJson(contactView(snap, group.groupId), { headers: ctx.headers })
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
  const [
    apiSnap,
    storageSnap,
    contactsSnap,
    datasetsSnap,
    campaignEmailSnap,
    companiesSnap,
    dealsSnap,
    tasksSnap,
    activitiesSnap,
    leadCounts,
  ] = await Promise.all([
    orgRef.collection('apiUsage').doc(month).get(),
    orgRef.collection('usage').doc(month).get(),
    orgRef.collection('contacts').count().get(),
    orgRef.collection('datasets').count().get(),
    // The ORG counter, which is what `reserveCampaignEmailSends` claims
    // against. The per-site counter beside it is site history and answers a
    // different question; reporting it here would disagree with the gate.
    orgRef.collection('counters').doc('campaignEmailSends').get(),
    // The CRM collections (AGL-2606): sizes, not bands — see `crm` below.
    // Aggregations, so an org with ten thousand deals pays ten reads.
    orgRef.collection(CRM_COLLECTIONS.companies).count().get(),
    orgRef.collection(CRM_COLLECTIONS.deals).count().get(),
    orgRef.collection(CRM_COLLECTIONS.tasks).count().get(),
    orgRef.collection(CRM_COLLECTIONS.activities).count().get(),
    /*
     * Leads live under each SITE (`hosts/{id}/leads`), not under the org,
     * so their size is one aggregate per site the org owns — bounded by the
     * plan's site band, and the same count `/v1/leads?siteId=` will page.
     */
    Promise.all(
      Object.keys((ctx.org.hosts ?? {}) as Record<string, unknown>).map((hostId) =>
        ctx.firestore
          .collection('hosts')
          .doc(hostId)
          .collection('leads')
          .count()
          .get(),
      ),
    ),
  ])

  const apiQuota = checkApiRequestQuota(
    ctx.org as never,
    Number(apiSnap.get('count') ?? 0),
  )
  // The records band is measured on the SUM (AGL-2611); the contacts entry
  // below keeps reporting the people count against it, so a client that
  // only ever read `contacts` still sees the headroom that refuses it.
  const crmRecordsQuota = checkCrmRecordsQuota(
    ctx.org as never,
    contactsSnap.data().count +
      companiesSnap.data().count +
      dealsSnap.data().count,
  )
  const datasetQuota = checkDatasetQuota(ctx.org, datasetsSnap.data().count)
  const storageQuota = checkDataStorageQuota(
    ctx.org as never,
    Number(storageSnap.get('dataStorageMb') ?? 0),
  )
  // A corrupt or negative counter must not read as headroom, the same clamp
  // `orgCampaignEmailSendsForMonth` applies on the server.
  const rawCampaignEmails = Number(campaignEmailSnap.get(month) ?? 0)
  const campaignEmailsUsed =
    Number.isFinite(rawCampaignEmails) && rawCampaignEmails > 0
      ? Math.floor(rawCampaignEmails)
      : 0
  const campaignEmailQuota = checkQuota(
    ctx.org as never,
    'emailSendsPerMonth',
    campaignEmailsUsed,
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
        contactsSnap.data().count,
        crmRecordsQuota.included,
        crmRecordsQuota.remaining,
        crmRecordsQuota.overageRateUsd,
      ),
      /*
       * THE BAND ITSELF (AGL-2611): contacts, companies and deals as one
       * figure against the one band the plan sells. `contacts` above keeps
       * its shape for the client that only reads it — same band, same
       * headroom — and this is the number the invoice and the console
       * meter are computed from. Companies and deals below stay as sizes.
       */
      crmRecords: usageBand(
        crmRecordsQuota.used,
        crmRecordsQuota.included,
        crmRecordsQuota.remaining,
        crmRecordsQuota.overageRateUsd,
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
      /*
       * CAMPAIGN emails, not every email. `emailSendsPerMonth` governs
       * campaign volume alone — transactional mail is counted for cost and
       * never refused at any tier — so a band named `emails` would report a
       * limit the product does not enforce.
       *
       * `metered: false`, because this band is REFUSED rather than billed.
       * It is the one dimension here that hard-walls on a paid plan; the
       * others accept the excess and put it on the invoice. Passing a null
       * rate is how that difference reaches a caller rather than being
       * something they discover from a 403.
       */
      campaignEmails: usageBand(
        campaignEmailsUsed,
        campaignEmailQuota.limit,
        campaignEmailQuota.remaining,
        null,
      ),
      /*
       * The CRM collections (AGL-2606) — SIZES, in the band shape so a client
       * reads them with the code it already has. No plan bands them: a
       * company or a deal is not metered and is never refused, so `included`
       * and `remaining` are `null` — the unlimited band the docs define —
       * and `metered` is false because there is nothing to bill. What the
       * numbers are for is sizing a sync: how many pages a full walk of
       * `/v1/deals` will take, before taking it.
       */
      crm: {
        companies: usageBand(companiesSnap.data().count, UNLIMITED, UNLIMITED, null),
        deals: usageBand(dealsSnap.data().count, UNLIMITED, UNLIMITED, null),
        tasks: usageBand(tasksSnap.data().count, UNLIMITED, UNLIMITED, null),
        activities: usageBand(
          activitiesSnap.data().count,
          UNLIMITED,
          UNLIMITED,
          null,
        ),
        leads: usageBand(
          leadCounts.reduce((sum, snap) => sum + snap.data().count, 0),
          UNLIMITED,
          UNLIMITED,
          null,
        ),
      },
    },
    { headers: ctx.headers },
  )
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * The resources the CRM SUITE entitlement gates (AGL-2611). Contacts are not
 * among them: the contacts list ships on every plan, banded, and its API
 * has been open since AGL-899.
 */
const CRM_SUITE_RESOURCES: ReadonlySet<string> = new Set([
  'companies',
  'pipelines',
  'deals',
  'tasks',
  'activities',
  // A site's leads are captured on every plan; their working state — a
  // status, an owner, the conversion — is the suite's, and so is the API
  // onto them (AGL-2627).
  'leads',
])

/** Route a `/v1/<resource>/...` request to its handler. */
export async function dispatchResource(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
): Promise<Response> {
  const url = new URL(request.url)
  // The plan question before the scope one, in front of the five handlers
  // rather than inside each: `crm:*` is mintable on a Business key whose org
  // was later moved to a plan without the suite by a staff override, and a
  // scope that still answered would be the shell's "extensions cannot bypass
  // entitlements" promise broken over the wire. Same shape as the
  // `dataStore` refusal on datasets.
  if (CRM_SUITE_RESOURCES.has(segments[0]) && !checkEntitlement(ctx.org, 'crm')) {
    return ApiErrors.planRequired({
      message:
        'The CRM suite — companies, pipelines, deals, tasks, activities and ' +
        'leads — is not included in this organization’s plan',
      code: 'crm',
      headers: ctx.headers,
    })
  }
  switch (segments[0]) {
    case 'datasets':
      return handleDatasets(request, ctx, segments, url)
    case 'sites':
      return handleSites(request, ctx, segments, url)
    case 'contacts':
      return handleContacts(request, ctx, segments, url)
    // The CRM resources (AGL-2606) live in modules of their own under
    // `./api-v1/`, so this file — already the size it is — grows by the
    // dispatch alone.
    case 'companies':
      return handleCompanies(request, ctx, segments, url)
    case 'pipelines':
      return handlePipelines(request, ctx, segments, url)
    case 'deals':
      return handleDeals(request, ctx, segments, url)
    case 'tasks':
      return handleTasks(request, ctx, segments, url)
    case 'activities':
      return handleActivities(request, ctx, segments, url)
    case 'leads':
      return handleLeads(request, ctx, segments, url)
    case 'media':
      // The ORGANIZATION library. A site's own files are the same resource
      // under `/v1/sites/{siteId}/media`.
      return handleScopedMedia(
        request,
        ctx,
        url,
        ctx.firestore.collection('orgs').doc(ctx.orgId),
        {
          collection: 'orgs',
          base: `orgs/${ctx.orgId}`,
          hostId: null,
          cdnScope: `org:${ctx.orgId}`,
        },
      )
    default:
      return ApiErrors.notFound({
        message: `Unknown endpoint: /v1/${segments.join('/')}`,
        headers: ctx.headers,
      })
  }
}
