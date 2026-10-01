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
 * `POST /api/crm/contacts-import` — one chunk of a contact file, written
 * (AGL-2602).
 *
 * The browser has already read the file and applied the operator's column
 * mapping; what arrives here is up to {@link CONTACT_IMPORT_CHUNK_SIZE} raw
 * rows in the field vocabulary `crm-import.ts` defines. This route judges
 * each one and writes it, and it is the ONLY place either happens: the
 * drawer shows a preview from the same mapper but stores nothing, so a
 * stale tab cannot store something the server would have refused.
 *
 * ## Every row goes through the door every capture goes through
 *
 * `captureHostContact` — the runtime's wrapper over `upsertHostContact`,
 * the one writer of the contacts collection for every door that is not the
 * v1 API: forms, checkout, bookings, the newsletter box — is the writer
 * here too, so a row this file creates raises `contactCreated` like any
 * other capture (AGL-2605). That is what makes an import
 * dedupe on the address the way a second form submission does, land in the
 * capturing group's facet the way a form capture does, record consent
 * against the capturing site, and stop at a hard band where a form
 * capture stops. A bulk path with its own `add()` would be the fastest way
 * to grow an unscoped, unbanded, unconsented copy of the address book.
 *
 * What the door did not know how to write until now — a phone, a title, a
 * company, an owner, a stage, custom values — it now takes as `facet`, and
 * what it did not say until now — created or merged or refused — it now
 * returns as a verdict. Both changes are the door's, so the v1 API and the
 * manual add can reach them next.
 *
 * ## Every lookup paid once per request, not once per row (AGL-3423)
 *
 * A request has sixty seconds, and a row that reads for itself spends them
 * a round trip at a time: the door alone was a dozen serial reads and three
 * aggregate counts per new person, and a two-hundred-row chunk of an
 * Apollo export ran out of time before it answered. So nothing here is
 * read per row:
 *
 * - The door's own lookups — the site, the consent group, who each address
 *   already is, who the site erased, the room in the records band — come
 *   from one `prepareContactCaptureBatch` for the whole chunk, which every
 *   row's capture is handed. The door still makes every decision.
 * - An owner is named by email and stored by uid, so the org's roster is
 *   read once and every row resolves against it.
 * - A company is named by name and stored by id, so the distinct names are
 *   looked up together, thirty to an `in` query, and the missing ones are
 *   created in one batched write — an Apollo file names a different company
 *   on nearly every row, and that was a read, a count and a write each.
 *
 * What is left per row is the row's own writes and what a new person sets
 * off, and those run {@link CONTACT_IMPORT_CONCURRENCY} at a time. A row is
 * started only inside {@link CONTACT_IMPORT_TIME_BUDGET_MS}; the rest are
 * reported `not-reached`, so a slow chunk answers with what it did instead
 * of being cut off at the limit with no answer at all.
 *
 * ## A retry is a merge, never a second person
 *
 * The door dedupes on the address, through the index and then the `email`
 * query, so a row that landed before a request was cut off is found by the
 * next attempt and merged into — the one-person-one-record rule a second
 * form submission meets. A company is found by its `nameLower` the same way.
 *
 * ## Who may call it
 *
 * `resolveImportContext` (`import-context.ts`) — the two gates every CSV
 * import route asks, shared with the companies import so one permission
 * has one spelling.
 */

import {
  type ContactFieldDefinition,
  CRM_COLLECTIONS,
  crmNewRecordListFields,
  nameSearchFields,
  type PluginApiHandler,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import {
  CONTACT_IMPORT_CHUNK_SIZE,
  CONTACT_IMPORT_MAX_BODY_BYTES,
  type ContactImportChunkResult,
  type ContactImportRawRow,
  type ContactImportRow,
  type ContactImportSkippedRow,
  normalizeContactImportRow,
} from '../model/crm-import'
import {
  type ContactCaptureBatch,
  firebaseAdmin,
  prepareContactCaptureBatch,
} from '@aglyn/tenant-data-admin'
import { captureHostContact } from '@aglyn/tenant-runtime'
// The leaf, so a spec that stands a partial barrel in still reaches it.
import {
  countUndeliverableEmails,
  findUndeliverableEmails,
  IMPORT_MAIL_CHECK_GRACE_MS,
  settleWithin,
} from '@aglyn/tenant-data-admin/server/capture-email-check'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type ImportContext,
  ownerDirectory,
  readImportRows,
  resolveImportContext,
} from './import-context'

/** The one sentence every imported contact's timeline opens with. */
export const CONTACT_IMPORT_INTERACTION_SUMMARY = 'Imported from CSV'

/**
 * How many rows are written at once. Enough to overlap the round trips a
 * row still pays; few enough that a chunk never has more writes in flight
 * than one client connection handles comfortably.
 */
export const CONTACT_IMPORT_CONCURRENCY = 8

/**
 * How long after the request arrived a row may still be STARTED. The
 * function is stopped at sixty seconds; this leaves the rows already in
 * flight, and the mail-server check's grace, room to finish before then.
 */
export const CONTACT_IMPORT_TIME_BUDGET_MS = 40_000

/** The most values one Firestore `in` filter may carry. */
const IN_FILTER_LIMIT = 30

/** The most writes one batch may carry. */
const BATCH_WRITE_LIMIT = 500

/**
 * The holder's live custom-field definitions.
 *
 * Read in full and filtered in memory: a holder has a handful of fields,
 * and a `where` on `retiredAt` would need an index for a collection that
 * fits in one page. Definitions the caller's scope cannot see are left out
 * for the same reason a value under an undefined key is — a value written
 * under a field the holder's own form will never show is a value nobody
 * can edit.
 */
async function loadFieldDefinitions(
  orgId: string,
  readTokens: readonly string[],
): Promise<ContactFieldDefinition[]> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_COLLECTIONS.contactFields)
    .limit(200)
    .get()
  return snapshot.docs
    .map((doc) => doc.data() as ContactFieldDefinition)
    .filter(
      (field) =>
        !!field.key &&
        !field.retiredAt &&
        visibleToTokens(field.visibleTo, readTokens),
    )
}

/** A company an import row named, as the CRM stores it. */
interface ImportCompany {
  id: string
  name: string
}

function pagesOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
  return out
}

/**
 * The company each row names, in this scope, with the missing ones created.
 *
 * Looked up by `nameLower`, the search twin `nameSearchFields` writes on
 * every company, thirty names to an `in` query and every page at once, and
 * narrowed in memory to the ones the caller's scope can see — two clients
 * of one agency may each have an "Acme" and must each get their own. A
 * name nobody in scope holds is created once for the request, with the
 * same scope stamp every CRM creator uses, so the company lands exactly
 * where a contact captured on this site would; the creates go out in one
 * batched write.
 *
 * THE RECORDS BAND (AGL-2611). A company is a record of the same band the
 * contact behind its row will meet at the door, so the band is walked in
 * file order — the row's company, then the row's contact when the address
 * is new — from the capture batch's one tally. On an org at a full hard
 * band the row gets no company rather than a company it was not allowed to
 * hold, and a later row's company never takes the room an earlier row's
 * contact needed. Nothing is reported here: the contact is refused
 * `audience-band` at its door and the row is listed skipped, which is the
 * one message the operator needs. A plan with an overage rate always
 * admits — a rate is what makes the band meter instead of refuse.
 *
 * Keyed by `nameLower`; a name absent from the map gets no company.
 */
async function resolveCompanies(
  context: Extract<ImportContext, { ok: true }>,
  capture: ContactCaptureBatch,
  rows: readonly { row: ContactImportRow }[],
): Promise<{ companies: Map<string, ImportCompany>; created: number }> {
  const firestore = firebaseAdmin.app().firestore()
  const collection = firestore
    .collection('orgs')
    .doc(context.orgId)
    .collection(CRM_COLLECTIONS.companies)
  const named = new Map<string, ReturnType<typeof nameSearchFields>>()
  for (const { row } of rows) {
    if (!row.companyName) continue
    const fields = nameSearchFields(row.companyName)
    if (!named.has(fields.nameLower)) named.set(fields.nameLower, fields)
  }

  const companies = new Map<string, ImportCompany>()
  await Promise.all(
    pagesOf([...named.keys()], IN_FILTER_LIMIT).map(async (page) => {
      const matches = await collection.where('nameLower', 'in', page).get()
      for (const doc of matches.docs) {
        const nameLower = String(doc.get('nameLower') ?? '')
        if (!named.has(nameLower) || companies.has(nameLower)) continue
        if (!visibleToTokens(doc.get('visibleTo'), context.readTokens)) continue
        // The name as the record spells it, not as this row typed it, so the
        // contact's facet reads the same as the company page.
        companies.set(nameLower, {
          id: doc.id,
          name: String(doc.get('name') ?? named.get(nameLower)?.name ?? ''),
        })
      }
    }),
  )

  const creates: { ref: FirebaseFirestore.DocumentReference; record: Record<string, unknown> }[] = []
  for (const { row } of rows) {
    if (row.companyName) {
      const nameLower = nameSearchFields(row.companyName).nameLower
      if (!companies.has(nameLower) && capture.admit()) {
        const fields = named.get(nameLower) as ReturnType<typeof nameSearchFields>
        const ref = collection.doc()
        creates.push({
          ref,
          record: {
            ...fields,
            hostId: context.hostId,
            visibleTo: context.scopeTokens,
            createdByUid: context.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            // What the Companies list searches and filters by (AGL-3321).
            ...crmNewRecordListFields('companies', { ...fields, visibleTo: context.scopeTokens }),
          },
        })
        companies.set(nameLower, { id: ref.id, name: row.companyName })
      }
    }
    if (capture.peek(row.email) === null && capture.erased(row.email) !== true) {
      capture.reserve(row.email)
    }
  }
  for (const page of pagesOf(creates, BATCH_WRITE_LIMIT)) {
    const batch = firestore.batch()
    for (const { ref, record } of page) batch.set(ref, record)
    await batch.commit()
  }
  return { companies, created: creates.length }
}

/**
 * `POST crm/contacts-import` — `{ hostId, rows }` → a {@link ContactImportChunkResult}.
 *
 * Rows are written {@link CONTACT_IMPORT_CONCURRENCY} at a time, which the
 * band allows because it is no longer counted per row: the capture batch
 * counted once, and every create is admitted from its tally — reserved in
 * file order before any row is written, so which rows the band keeps does
 * not depend on which write happened to finish first.
 */
export const crmContactsImportHandler: PluginApiHandler = async (req, res) => {
  const startedAt = Date.now()
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const read = readImportRows<ContactImportRawRow>(req, {
    maxBodyBytes: CONTACT_IMPORT_MAX_BODY_BYTES,
    chunkSize: CONTACT_IMPORT_CHUNK_SIZE,
  })
  if ('error' in read) return res.status(read.status).json({ error: read.error })
  try {
    const context = await resolveImportContext(req)
    if (context.ok === false) return res.status(context.status).json(context.body)

    const fields = await loadFieldDefinitions(context.orgId, context.readTokens)
    const skipped: ContactImportSkippedRow[] = []
    const dropped: Record<string, number> = {}
    const normalized: { index: number; row: ContactImportRow }[] = []
    /*
     * A duplicate WITHIN the request is skipped rather than merged: the
     * second row would merge onto the first's record and the count would
     * read one created and one merged for one person in one file, which is
     * a number the operator cannot reconcile against the rows they sent.
     * Across requests the door's own dedupe answers, and reports a merge.
     */
    const seen = new Set<string>()
    read.rows.forEach((raw, index) => {
      const verdict = normalizeContactImportRow(raw, fields)
      if (verdict.ok === false) {
        skipped.push({ index, email: verdict.input, reason: verdict.reason })
        return
      }
      if (seen.has(verdict.row.email)) {
        skipped.push({ index, email: verdict.row.email, reason: 'duplicate' })
        return
      }
      seen.add(verdict.row.email)
      for (const entry of verdict.row.dropped) {
        dropped[entry.field] = (dropped[entry.field] ?? 0) + 1
      }
      normalized.push({ index, row: verdict.row })
    })

    // The addresses' mail servers (AGL-3328), asked while the rows are
    // written — see the leads import. The check `upsertHostContact` queues
    // stamps the records; this is the count the result states.
    const mailServers = findUndeliverableEmails(normalized.map((entry) => entry.row.email))
    const imported: string[] = []
    const [owners, capture] = await Promise.all([
      ownerDirectory(
        context.orgId,
        normalized.map((entry) => entry.row),
      ),
      prepareContactCaptureBatch(
        context.hostId,
        normalized.map((entry) => entry.row.email),
      ),
    ])
    const { companies, created: companiesCreated } = await resolveCompanies(
      context,
      capture,
      normalized,
    )
    const ownersUnresolved = new Set<string>()
    let created = 0
    let merged = 0

    const writeRow = async ({ index, row }: { index: number; row: ContactImportRow }) => {
      let ownerUid: string | undefined
      if (row.ownerEmail) {
        ownerUid = owners.get(row.ownerEmail)
        if (!ownerUid) ownersUnresolved.add(row.ownerEmail)
      }
      const company = row.companyName
        ? companies.get(nameSearchFields(row.companyName).nameLower)
        : undefined
      const verdict = await captureHostContact({
        hostId: context.hostId,
        email: row.email,
        ...(row.name ? { name: row.name } : {}),
        source: 'import',
        actor: { kind: 'member', uid: context.uid, email: context.email },
        interaction: { summary: CONTACT_IMPORT_INTERACTION_SUMMARY },
        marketingConsent: row.marketingConsent,
        tags: row.tags,
        facet: {
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}),
          // The link AND the name: the merge fields read the facet's
          // `companyName`, and a link written alone renders as nothing.
          ...(company ? { companyId: company.id, companyName: company.name } : {}),
          ...(row.address ? { address: row.address } : {}),
          ...(ownerUid ? { ownerUid } : {}),
          ...(row.lifecycleStage ? { lifecycleStage: row.lifecycleStage } : {}),
          ...(Object.keys(row.custom).length ? { custom: row.custom } : {}),
        },
        // An import is the merchant's own act and files nobody under a
        // campaign; the picker on the profile is where that happens.
        campaignIds: [],
        batch: capture,
      })
      if ('refused' in verdict) {
        skipped.push({
          index,
          email: row.email,
          reason:
            verdict.refused === 'band'
              ? 'audience-band'
              : verdict.refused === 'invalid-email'
                ? 'invalid-email'
                : verdict.refused === 'erased'
                  ? 'erased'
                  : 'write-failed',
        })
        return
      }
      imported.push(row.email)
      if (verdict.created) created += 1
      else merged += 1
    }

    // A fixed pool drawing from one queue in file order; a row is started
    // only inside the budget, and whatever is left is reported, not dropped.
    let next = 0
    const worker = async () => {
      while (next < normalized.length) {
        if (Date.now() - startedAt >= CONTACT_IMPORT_TIME_BUDGET_MS) return
        const entry = normalized[next]
        next += 1
        await writeRow(entry)
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(CONTACT_IMPORT_CONCURRENCY, normalized.length) },
        worker,
      ),
    )
    for (const { index, row } of normalized.slice(next)) {
      skipped.push({ index, email: row.email, reason: 'not-reached' })
    }

    const noMailServer = countUndeliverableEmails(
      imported,
      await settleWithin(mailServers, IMPORT_MAIL_CHECK_GRACE_MS),
    )

    const result: ContactImportChunkResult = {
      received: read.rows.length,
      created,
      merged,
      skipped: skipped.sort((a, b) => a.index - b.index),
      dropped,
      companiesCreated,
      ownersUnresolved: [...ownersUnresolved],
      ...(noMailServer !== undefined ? { noMailServer } : {}),
    }
    return res.status(200).json(result)
  } catch (error) {
    console.error('crm/contacts-import failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}
