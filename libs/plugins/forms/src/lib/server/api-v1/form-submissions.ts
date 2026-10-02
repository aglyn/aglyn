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
  ApiErrors,
  apiJson,
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
import { runPluginEventHandlers } from '@aglyn/aglyn/plugin-manager/plugin-events'

/**
 * A site's form submissions on the customer REST API,
 * `/v1/sites/{siteId}/form-submissions/…` (AGL-2127, AGL-3080). Registered
 * from this plugin's console server declarations; the console's `/v1`
 * router owns the pipeline in front — the key, the plan's API access, the
 * request quota, the rate limit — and refuses a site the key's organization
 * does not own before it hands a request here.
 */

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
export async function handleFormSubmissions(
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
    const removed = { id: snap.id, data: (snap.data() ?? {}) as Record<string, unknown> }
    await submissionRef.delete()
    /*
     * Whatever counted this row when it arrived (a form's counters, AGL-3330)
     * cannot see a delete, so the plugins are told what left. Best effort,
     * isolated per plugin by the seam: the delete is the request, and a
     * recount that fails leaves its figures for the next one rather than
     * failing a purge that already happened.
     */
    await runPluginEventHandlers('host.records.removed', {
      orgId: ctx.orgId,
      hostIds: [hostId],
      collection: 'formSubmissions',
      records: [removed],
    }).catch((error) => console.error('records-removed event after an API delete failed', error))
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

