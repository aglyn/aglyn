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

import type { PluginConsoleCronReport } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { isVisitorUploadSegment, visitorUploadFinalPath } from '@aglyn/aglyn/app-utils/visitor-upload'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { QUOTE_ARTWORK_PURPOSE } from '../model/commerce-quote-proofs'
import type { QuoteCustomerResponse } from '../model/commerce-quotes'
import { QUOTE_UPLOAD_KEYS_COLLECTION, quoteUploadKeyFiles } from './quote-upload-keys'
import type { QuoteUploadCalls } from './quote-uploads'

/*==========================================
 * THE SWEEP OF A CUSTOMER'S UNSENT FILES (AGL-4096).
 *
 * Every pending record (`quote-upload-keys.ts`) whose day has passed: each
 * file still on it is deleted, unless an answer on the quote holds it (its
 * record outlived the answer, or a retried finalize put it back), and then
 * the record goes. A file recorded on it while the sweep ran stays on it,
 * with the sweep time that file set.
 *
 * Run every fifteen minutes by the console's plugin job runner, on the same
 * tick as the forms plugin's sweep of forms never sent; each tick takes at
 * most {@link QUOTE_UPLOAD_SWEEP_BATCH} records and starts none after its
 * deadline. The query is a collection-group read on `sweepAtMs`, whose index
 * is declared in `cloud/firebase-firestore.indexes.json`.
 *=========================================*/

export const QUOTE_UPLOAD_SWEEP_JOB_ID = 'commerce-quote-upload-sweep'

/** Records one tick sweeps. */
export const QUOTE_UPLOAD_SWEEP_BATCH = 100

const DOC_ID = /^(?!__.*__$)[^/]{1,200}$/

export interface QuoteUploadSweepDeps {
  firestore(): FirebaseFirestore.Firestore
  uploads(): Promise<Pick<QuoteUploadCalls, 'remove'>>
}

export function defaultQuoteUploadSweepDeps(): QuoteUploadSweepDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    uploads: async () => (await import('./quote-uploads')).quoteUploadCalls(),
  }
}

/** The file ids the answers in a list send. */
function sentFileIds(responses: unknown): string[] {
  if (!Array.isArray(responses)) return []
  return (responses as QuoteCustomerResponse[]).flatMap((response) =>
    Array.isArray(response?.files) ? response.files.map((file) => String(file?.id ?? '')) : [],
  )
}

/** Every file an answer on the quote holds: the current revision's, and every earlier one's. */
async function heldQuoteUploads(quoteRef: FirebaseFirestore.DocumentReference): Promise<Set<string>> {
  const [quote, revisions] = await Promise.all([quoteRef.get(), quoteRef.collection('revisions').get()])
  return new Set([
    ...sentFileIds(quote.get('quote.responses')),
    ...revisions.docs.flatMap((revision) => sentFileIds(revision.get('responses'))),
  ])
}

export async function sweepQuoteUploads(
  deps: QuoteUploadSweepDeps,
  context: { nowMs: number; deadlineMs: number },
): Promise<PluginConsoleCronReport> {
  const firestore = deps.firestore()
  const due = await firestore
    .collectionGroup(QUOTE_UPLOAD_KEYS_COLLECTION)
    .where('sweepAtMs', '<=', context.nowMs)
    .orderBy('sweepAtMs')
    .limit(QUOTE_UPLOAD_SWEEP_BATCH)
    .get()
  let swept = 0
  let kept = 0
  let failed = 0
  const uploads = due.empty ? null : await deps.uploads()
  for (const record of due.docs) {
    if (Date.now() > context.deadlineMs) break
    const hostId = String(record.get('hostId') ?? '')
    const quoteId = record.id
    try {
      const pending = quoteUploadKeyFiles(record.data())
      if (uploads && DOC_ID.test(hostId) && DOC_ID.test(quoteId) && Object.keys(pending).length) {
        const held = await heldQuoteUploads(firestore.collection('hosts').doc(hostId).collection('orders').doc(quoteId))
        const scope = { hostId, purpose: QUOTE_ARTWORK_PURPOSE, purposeId: quoteId }
        for (const id of Object.keys(pending)) {
          if (held.has(id)) kept += 1
          else if (isVisitorUploadSegment(id)) {
            await uploads.remove(visitorUploadFinalPath(scope, id))
            swept += 1
          }
        }
      }
      // The record goes, but a file recorded on it since it was read stays.
      await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(record.ref)
        if (!fresh.exists) return
        const left = Object.entries(quoteUploadKeyFiles(fresh.data())).filter(([id, atMs]) => pending[id] !== atMs)
        if (!left.length) transaction.delete(record.ref)
        else transaction.set(record.ref, { ...fresh.data(), files: Object.fromEntries(left) })
      })
    } catch (error) {
      failed += 1
      console.error('[commerce] an unsent quote file was not swept', { hostId, quoteId, error })
    }
  }
  return { due: due.size, swept, kept, failed }
}
