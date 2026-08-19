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
  datasetCsvHeader,
  datasetCsvRow,
  datasetRecordToJson,
  effectiveDatasetModel,
  memberCanSee,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'

/**
 * Records read per round trip. Not a cap — the stream keeps paging until
 * the collection is exhausted. It bounds what is held at once, which is the
 * only thing a page size should ever bound.
 */
const PAGE_SIZE = 500

/** Header naming the row count the server undertook to send. */
export const EXPORT_ROWS_HEADER = 'X-Aglyn-Export-Rows'

const json = (body: unknown, status: number) => Response.json(body, { status })

/**
 * Complete dataset export, streamed (AGL-2335).
 *
 * `run-an-agency-workspace.md` sells this as half of a **full handover** —
 * the artifact a departing client is told is theirs. What it actually
 * produced was `records`, the card's live listener window: `limit(500)`
 * **with no `orderBy`**. Firestore answers an unordered limit in document-id
 * order over auto-ids, so a 2,000-record dataset did not export "the first
 * 500", it exported *500 unpredictable rows*, and re-exporting could produce
 * a different set. `sortDatasetRecords` then sorted that sample, which made
 * the result look ordered and be arbitrary. The button said `CSV`.
 *
 * Three things this route does that the client could not:
 *
 * 1. **Every row.** Cursor-paged over the whole collection, streamed out as
 *    it goes, so completeness does not cost a browser hang or a giant buffer
 *    — the reason the obvious client-side fix was unsafe on a tier where
 *    `recordsPerDataset` is `UNLIMITED`.
 * 2. **A deterministic total order.** `orderBy(FieldPath.documentId())`.
 *    Deliberately NOT `orderBy('order')`, the field the table sorts by:
 *    Firestore silently DROPS documents missing an ordered field, and legacy
 *    records have no `order`, so ordering by it would reintroduce exactly the
 *    silent row loss this issue is about — with an index requirement on top.
 *    Document id is present on every document, is a total order, and is the
 *    order the old window happened to arrive in. Same order, now complete.
 * 3. **A checkable promise.** `X-Aglyn-Export-Rows` carries a `count()`
 *    aggregate taken before the first page, so the client can prove the file
 *    it received is whole. A stream that dies halfway yields a perfectly
 *    well-formed shorter file; nothing about the bytes says they are short.
 *
 * **No entitlement gate, deliberately.** The client button never had one and
 * this is the customer's own data — the same reasoning `/api/orgs/export-data`
 * records for the workspace export. Adding a plan gate here would take a
 * capability away from people who have it today, on the export path of all
 * places. The `release_data_store` flag gate is kept, because that is
 * whether the feature exists at all rather than whether it is paid for.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  const orgId = String(query?.['orgId'] ?? '')
  const datasetId = String(query?.['datasetId'] ?? '')
  const format = query?.['format'] === 'json' ? 'json' : 'csv'
  if (!orgId || !datasetId) {
    return json({ error: 'Missing orgId or datasetId' }, 400)
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const member = membership?.member
    // Reading is not writing: every member who can SEE the dataset may take
    // a copy of it. The writer-role gate on `/api/orgs/datasets` is about
    // quota-consuming creates and has no business here.
    if (!member && !staff) return json({ error: 'Not found' }, 404)

    if (
      !staff &&
      !(await isServerReleaseFlagOnForOrg('release_data_store', orgId))
    ) {
      return json({ error: 'Not available' }, 404)
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) return json({ error: 'Unknown organization' }, 404)
    const org = orgSnapshot.data()

    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org,
    })
    if (locked) return locked

    const datasetRef = orgRef.collection('datasets').doc(datasetId)
    const datasetSnapshot = await datasetRef.get()
    if (!datasetSnapshot.exists) {
      return json({ error: 'Unknown dataset' }, 404)
    }
    const dataset = datasetSnapshot.data() as Record<string, unknown>

    // Scoped sharing (AGL-1037/1044). The records subcollection carries no
    // `visibleTo` of its own — scope lives on the parent dataset — so this
    // is the ONLY place the check can be made, and skipping it would let a
    // single-site collaborator export an internal dataset wholesale. The
    // Admin SDK bypasses rules entirely, so `memberCanSee` IS the
    // enforcement here rather than a second opinion about it; membership
    // was already refused above, which is the precondition it documents.
    if (
      !staff &&
      !memberCanSee(member, dataset['visibleTo'] as string[] | undefined)
    ) {
      return json({ error: 'Not found' }, 404)
    }

    const model = effectiveDatasetModel(dataset as never)
    const recordsRef = datasetRef.collection('records')
    // Taken BEFORE the first page, so it describes the collection the export
    // started from. A `count()` aggregate bills one read per 1,000 documents
    // — cheap next to the export it is describing, and the only way the
    // client can tell a complete file from a truncated one.
    const total = Number(
      (await recordsRef.count().get()).data().count ?? 0,
    )

    const encoder = new TextEncoder()
    const encode = (text: string) => encoder.encode(text)
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
    let phase: 'head' | 'body' | 'tail' = 'head'
    let emitted = 0

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (phase === 'head') {
            phase = 'body'
            controller.enqueue(
              encode(format === 'csv' ? datasetCsvHeader(model) : '['),
            )
            return
          }
          if (phase === 'body') {
            let page = recordsRef
              .orderBy(FieldPath.documentId())
              .limit(PAGE_SIZE)
            if (cursor) page = page.startAfter(cursor)
            const snapshot = await page.get()
            if (snapshot.empty) {
              phase = 'tail'
            } else {
              cursor = snapshot.docs[snapshot.docs.length - 1]
              if (snapshot.docs.length < PAGE_SIZE) phase = 'tail'
              const first = emitted === 0
              const lines = snapshot.docs.map((entry) => {
                const values = ((entry.data() ?? {})['values'] ??
                  {}) as Record<string, unknown>
                emitted += 1
                return format === 'csv'
                  ? datasetCsvRow(model, values)
                  : JSON.stringify(datasetRecordToJson(model, values))
              })
              controller.enqueue(
                encode(
                  format === 'csv'
                    ? `\n${lines.join('\n')}`
                    : `${first ? '' : ','}${lines.join(',')}`,
                ),
              )
              return
            }
          }
          // tail
          controller.enqueue(encode(format === 'csv' ? '\n' : ']'))
          controller.close()
        } catch (error) {
          // Erroring the stream truncates the download rather than
          // completing it short — a half-written file that the browser
          // reports as a failed transfer, not a quiet partial handover.
          controller.error(error)
        }
      },
    })

    // Ids and counts only, never content (the AGL-1443 rule the workspace
    // export follows). A full copy of a dataset leaving the platform is
    // worth a row; what was in it is not ours to log.
    void firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'dataset.exported',
        target: `orgs/${orgId}/datasets/${datasetId}`,
        before: null,
        after: { format, records: total },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    const base =
      String(dataset['displayName'] ?? 'collection')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .toLowerCase() || 'collection'
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type':
          format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}-${stamp}.${format}"`,
        [EXPORT_ROWS_HEADER]: String(total),
        'Cache-Control': 'no-store, private',
      },
    })
  } catch {
    return json({ error: 'Export failed' }, 500)
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
