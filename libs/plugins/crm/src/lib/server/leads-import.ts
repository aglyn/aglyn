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
 * `POST /api/crm/leads-import` — one chunk of a leads file, written
 * (AGL-2701).
 *
 * The browser has already read the file and applied the operator's column
 * mapping; what arrives here is up to {@link LEAD_IMPORT_CHUNK_SIZE} raw
 * rows in the vocabulary `crm-lead-import.ts` defines. This route judges
 * each one through the same normalizer, resolves the owner against the
 * org's roster, and writes it in two halves.
 *
 * ## The capture half goes through the door every capture goes through
 *
 * `addHostLead` — the ONE writer of `hosts/{hostId}/leads` for the sign-up
 * handler and both booking paths — is the writer here too. That is what
 * makes an imported row key on `personKey` the way a second form
 * submission does, land under the site by path with `capturedByHostIds`
 * naming it, count against `LEADS_MAX_PER_HOST` inside the transaction
 * that writes, and record NO marketing basis. A bulk path with its own
 * `add()` would grow an unkeyed, unbounded copy of the site's leads under
 * a second set of rules.
 *
 * ## A lead is host-scoped by path, so nothing here stamps `visibleTo`
 *
 * The five org collections carry `visibleTo` because they sit under
 * `orgs/{orgId}` and the rules decide per document which sites may read
 * them. A lead does not: `hosts/{hostId}/leads` is private to the site by
 * path, the rules admit the site's own members, and the list therefore
 * reads it with no scope clause. An import that stamped scope tokens onto
 * a lead would be writing a field nothing reads, and would suggest a
 * sharing decision the collection does not have. The site is the whole
 * scope, and the drawer's picker is where it is chosen.
 *
 * ## No file may hand a lead a consent it did not give
 *
 * A capture writes a marketing basis only when the visitor ticked a box in
 * front of them. A CSV row has no such event behind it, so the lead
 * vocabulary has no consent column and this route passes no
 * `marketingConsent`: an imported lead is mailable only if some earlier
 * capture on this site already recorded a basis, which `addHostLead`
 * carries forward untouched. The contacts import has a consent column
 * because its own export writes one and the merchant is asserting a basis
 * they hold per person; the leads export writes none, and a column the
 * file cannot fill is a column that cannot be misread.
 *
 * ## The working half is written the way the list writes it
 *
 * A status, an owner, a reason and notes are the CRM's annotations, not
 * the capture's, and the leads list already writes them client-direct onto
 * the same document. A row that carries any of them gets one merge write
 * after the door's, stamped `updatedAt` exactly as the list stamps it. A
 * row that carries none costs nothing extra.
 *
 * ## Created or merged is read once for the chunk
 *
 * The door reports only whether the lead was STORED, and the result panel
 * has to say how many people were added and how many updated. One
 * `getAll` over the chunk's document ids answers that for every row in a
 * single round trip, before any of them is written — which is also the
 * only moment the answer is still true.
 */

import {
  checkVisitorRecordCeiling,
  type ContactSource,
  LEAD_IMPORT_CHUNK_SIZE,
  LEAD_IMPORT_MAX_BODY_BYTES,
  type LeadImportChunkResult,
  type LeadImportRawRow,
  type LeadImportRow,
  type LeadImportSkippedRow,
  LEADS_MAX_PER_HOST,
  normalizeLeadImportRow,
  personKey,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { addHostLead, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  ownerDirectory,
  readImportRows,
  resolveImportContext,
} from './import-context'

/**
 * The surface an imported lead names, beside `signup`, `booking` and
 * `form:{formId}`.
 *
 * Typed as the capture-source union rather than a bare string, which is
 * what the contacts import gets for free from the door it calls: a lead's
 * `source` is plain text on the way in, so this is the only place the word
 * can be held to the same vocabulary the source filters and the labels
 * read. One person brought in by one file reads the same on both records.
 */
const LEAD_IMPORT_SOURCE: ContactSource = 'import'

/** The team's annotations on one row, or nothing when the file named none. */
function workingState(
  row: LeadImportRow,
  ownerUid: string | undefined,
): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {
    ...(row.status ? { status: row.status } : {}),
    ...(ownerUid ? { ownerUid } : {}),
    ...(row.unqualifiedReason ? { unqualifiedReason: row.unqualifiedReason } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  }
  return Object.keys(fields).length ? fields : null
}

/**
 * `POST crm/leads-import` — `{ hostId, rows }` → a {@link LeadImportChunkResult}.
 *
 * Rows are written one after another so the ceiling's local count stays
 * honest across the request.
 */
export const crmLeadsImportHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const read = readImportRows<LeadImportRawRow>(req, {
    maxBodyBytes: LEAD_IMPORT_MAX_BODY_BYTES,
    chunkSize: LEAD_IMPORT_CHUNK_SIZE,
  })
  if ('error' in read) return res.status(read.status).json({ error: read.error })
  try {
    const context = await resolveImportContext(req)
    if (context.ok === false) return res.status(context.status).json(context.body)

    const skipped: LeadImportSkippedRow[] = []
    const dropped: Record<string, number> = {}
    const normalized: { index: number; row: LeadImportRow; key: string }[] = []
    /*
     * A duplicate WITHIN the request is skipped rather than merged, for
     * the reason the contacts import gives: the second row would merge
     * onto the first's document and the tally would read one created and
     * one merged for one person in one file. Across requests the door's
     * own dedupe answers, and reports a merge.
     */
    const seen = new Set<string>()
    read.rows.forEach((raw, index) => {
      const verdict = normalizeLeadImportRow(raw)
      if (verdict.ok === false) {
        skipped.push({ index, email: verdict.input, reason: verdict.reason })
        return
      }
      // Non-null by construction: the normalizer refused every address
      // this derivation could not key.
      const key = personKey(verdict.row.email) as string
      if (seen.has(key)) {
        skipped.push({ index, email: verdict.row.email, reason: 'duplicate' })
        return
      }
      seen.add(key)
      for (const entry of verdict.row.dropped) {
        dropped[entry.field] = (dropped[entry.field] ?? 0) + 1
      }
      normalized.push({ index, row: verdict.row, key })
    })

    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(context.hostId)
    const leadsRef = hostRef.collection('leads')
    const refs = normalized.map((entry) => leadsRef.doc(entry.key))
    const [owners, before] = await Promise.all([
      ownerDirectory(
        context.orgId,
        normalized.map((entry) => entry.row),
      ),
      refs.length ? firestore.getAll(...refs) : Promise.resolve([]),
    ])
    const held = new Set(
      before.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id),
    )
    const ownersUnresolved = new Set<string>()
    let counted: number | null = null
    let createdHere = 0
    let created = 0
    let merged = 0

    for (const { index, row, key } of normalized) {
      const isNew = !held.has(key)
      /*
       * The platform lead ceiling, judged the way the deals import judges
       * the records band: one count at the first create, re-judged locally
       * as the request creates more. The door re-judges it authoritatively
       * inside its own transaction, so a race is still refused there — this
       * is what lets the operator's skipped file say WHY rather than only
       * that the row could not be saved.
       */
      if (isNew) {
        if (counted === null) {
          counted = (await leadsRef.count().get()).data().count
        }
        if (
          checkVisitorRecordCeiling(counted + createdHere, LEADS_MAX_PER_HOST)
            .exceeded
        ) {
          skipped.push({ index, email: row.email, reason: 'lead-ceiling' })
          continue
        }
      }
      let ownerUid: string | undefined
      if (row.ownerEmail) {
        ownerUid = owners.get(row.ownerEmail)
        if (!ownerUid) ownersUnresolved.add(row.ownerEmail)
      }
      const stored = await addHostLead({
        hostRef,
        hostId: context.hostId,
        lead: {
          email: row.email,
          ...(row.name ? { name: row.name } : {}),
          source: LEAD_IMPORT_SOURCE,
        },
      })
      if (!stored) {
        skipped.push({ index, email: row.email, reason: 'write-failed' })
        continue
      }
      const working = workingState(row, ownerUid)
      if (working) {
        await leadsRef
          .doc(key)
          .set(
            { ...working, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          )
      }
      if (isNew) {
        created += 1
        createdHere += 1
      } else {
        merged += 1
      }
    }

    const result: LeadImportChunkResult = {
      received: read.rows.length,
      created,
      merged,
      skipped: skipped.sort((a, b) => a.index - b.index),
      dropped,
      ownersUnresolved: [...ownersUnresolved],
    }
    return res.status(200).json(result)
  } catch (error) {
    console.error('crm/leads-import failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}
