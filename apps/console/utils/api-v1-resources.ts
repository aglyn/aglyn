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
  claimAttempt,
  coerceDocumentValues,
  createResourceUid,
  effectiveDatasetModel,
  validateDocument,
} from '@aglyn/aglyn/server'
import {
  apiJson,
  ApiErrors,
  decodeCursor,
  encodeCursor,
  listResponse,
  parseLimit,
} from '@aglyn/tenant-data-admin'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from './api-v1'

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
 */
async function claimWrite(
  ctx: ApiV1Context,
  datasetId: string,
  key: string | null,
): Promise<{ claim: AttemptClaim } | { replay: Response }> {
  const result = await claimAttempt(ctx.firestore, {
    kind: 'records',
    scopeId: `${ctx.orgId}:${datasetId}`,
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

async function handleDatasets(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, datasetId, sub, recordId] = segments

  // /v1/datasets
  if (!datasetId) {
    const denied = requireScope(ctx, 'datasets:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const { docs, nextCursor } = await paginate(datasetsCollection(ctx), url)
    return listResponse(docs.map(datasetView), nextCursor, ctx.headers)
  }

  const datasetRef = datasetsCollection(ctx).doc(datasetId)

  // /v1/datasets/{id}
  if (!sub) {
    const denied = requireScope(ctx, 'datasets:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const snap = await datasetRef.get()
    if (!snap.exists) return ApiErrors.notFound({ message: 'No such dataset', headers: ctx.headers })
    return apiJson(datasetView(snap), { headers: ctx.headers })
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
    const snap = await recordRef.get()
    if (!snap.exists) return ApiErrors.notFound({ message: 'No such record', headers: ctx.headers })
    await recordRef.delete()
    return apiJson({ id: recordId, object: 'record', deleted: true }, { headers: ctx.headers })
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

  // Idempotency: replay a prior create for the same key instead of
  // duplicating. Claimed HERE, below validation, so a deterministic 400 never
  // takes the key at all — an integrator fixes the payload and retries with
  // the same key, exactly as the POS cashier does (AGL-1691). Cheaper than
  // taking-and-releasing, and it cannot leak a claim on a rejection path.
  const claimed = await claimWrite(
    ctx,
    datasetSnap.id,
    request.headers.get('Idempotency-Key'),
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const order = (await recordsRef.count().get()).data().count
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
     * `datasets/records` is the entire `/v1` write surface — `sites` and
     * `contacts` are read-only and `dispatchResource` 404s the rest — so
     * nothing here moves money and "a released key costs a second refund" has
     * no analogue. The costs invert instead. A duplicate record is visible and
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
    const denied = requireScope(ctx, 'forms:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    let query: FirebaseFirestore.Query = ctx.firestore
      .collection('hosts')
      .doc(hostId)
      .collection('formSubmissions')
    const form = url.searchParams.get('form')
    if (form) query = query.where('formName', '==', form)
    const { docs, nextCursor } = await paginate(query, url)
    const data = docs.map((doc) => ({
      id: doc.id,
      object: 'form_submission',
      form: doc.get('formName') ?? null,
      path: doc.get('path') ?? null,
      fields: doc.get('fields') ?? {},
      read: Boolean(doc.get('read')),
      created: serialize(doc.get('createdAt')) ?? null,
    }))
    return listResponse(data, nextCursor, ctx.headers)
  }

  return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
}

// ── Contacts (read) ─────────────────────────────────────────────────────────

function contactView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'contact',
    email: data.email ?? null,
    name: data.name ?? null,
    tags: data.tags ?? [],
    sources: data.sources ? Object.keys(data.sources) : [],
    created: serialize(data.createdAt) ?? null,
    updated: serialize(data.updatedAt) ?? null,
  }
}

async function handleContacts(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const denied = requireScope(ctx, 'contacts:read')
  if (denied) return denied
  if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  const collection = ctx.firestore.collection('orgs').doc(ctx.orgId).collection('contacts')
  const [, contactId] = segments

  if (contactId) {
    const snap = await collection.doc(contactId).get()
    if (!snap.exists) return ApiErrors.notFound({ message: 'No such contact', headers: ctx.headers })
    return apiJson(contactView(snap), { headers: ctx.headers })
  }
  const { docs, nextCursor } = await paginate(collection, url)
  return listResponse(docs.map(contactView), nextCursor, ctx.headers)
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
    default:
      return ApiErrors.notFound({
        message: `Unknown endpoint: /v1/${segments.join('/')}`,
        headers: ctx.headers,
      })
  }
}
