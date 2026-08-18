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
  checkEntitlement,
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
 *
 * `kind` separates the create's claims from the delete's (AGL-1710). The
 * helper hashes it into the digest for exactly this reason, and the two record
 * different response BODIES — a record view versus a `{ deleted: true }`
 * receipt. Sharing one namespace would let a key reused across both operations
 * replay the create's record to a delete, which a client parses as a success
 * and which no amount of documentation makes safe. `POST` keeps `records`
 * verbatim: changing its digest orphans keys in flight, and AGL-1709 already
 * paid that cost once.
 */
async function claimWrite(
  ctx: ApiV1Context,
  datasetId: string,
  key: string | null,
  kind: 'records' | 'record-deletes',
): Promise<{ claim: AttemptClaim } | { replay: Response }> {
  const result = await claimAttempt(ctx.firestore, {
    kind,
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

  // Idempotency: replay a prior create for the same key instead of
  // duplicating. Claimed HERE, below validation, so a deterministic 400 never
  // takes the key at all — an integrator fixes the payload and retries with
  // the same key, exactly as the POS cashier does (AGL-1691). Cheaper than
  // taking-and-releasing, and it cannot leak a claim on a rejection path.
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
 * and `PATCH` on this very path answer 404 for a missing record, and since
 * `sites` and `contacts` are read-only this is the ONLY `DELETE` on `/v1`,
 * so there is no sibling convention that a 204 would be matching.
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

  if (sub === 'orders') return handleOrders(request, ctx, segments, url)
  if (sub === 'products') return handleProducts(request, ctx, segments, url)
  if (sub === 'media') return handleScopedMedia(request, ctx, url, hostRef(ctx, hostId))

  return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
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
