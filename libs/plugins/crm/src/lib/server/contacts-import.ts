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
 * against the capturing site, and stop at the free band where a form
 * capture stops. A bulk path with its own `add()` would be the fastest way
 * to grow an unscoped, unbanded, unconsented copy of the address book.
 *
 * What the door did not know how to write until now — a phone, a title, a
 * company, an owner, a stage, custom values — it now takes as `facet`, and
 * what it did not say until now — created or merged or refused — it now
 * returns as a verdict. Both changes are the door's, so the v1 API and the
 * manual add can reach them next.
 *
 * ## Two lookups paid once per request, not once per row
 *
 * An owner is named by email in the file and stored by uid on the record,
 * so the org's roster is read once and every row resolves against it. A
 * company is named by name and stored by id, so each distinct name is
 * looked up once, created once when missing, and remembered for the rest
 * of the request — two hundred rows at one company is one read and at most
 * one write, not two hundred of each.
 *
 * ## Who may call it
 *
 * `resolveImportContext` (`import-context.ts`) — the two gates every CSV
 * import route asks, shared with the companies import so one permission
 * has one spelling.
 */

import {
  CONTACT_IMPORT_CHUNK_SIZE,
  CONTACT_IMPORT_MAX_BODY_BYTES,
  type ContactFieldDefinition,
  type ContactImportChunkResult,
  type ContactImportRawRow,
  type ContactImportRow,
  type ContactImportSkippedRow,
  CRM_COLLECTIONS,
  nameSearchFields,
  normalizeContactImportRow,
  type PluginApiHandler,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import { crmRecordsQuotaForOrg, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { captureHostContact } from '@aglyn/tenant-runtime'
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

/**
 * The company a name refers to in this scope, created when there is none.
 *
 * Looked up by `nameLower`, the search twin `nameSearchFields` writes on
 * every company, and narrowed in memory to the ones the caller's scope can
 * see — two clients of one agency may each have an "Acme" and must each get
 * their own. Created with the same scope stamp every CRM creator uses, so
 * the company lands exactly where a contact captured on this site would.
 */
async function resolveCompanyId(
  context: Extract<ImportContext, { ok: true }>,
  name: string,
  cache: Map<string, string>,
  tally: { created: number },
): Promise<string> {
  const fields = nameSearchFields(name)
  const cached = cache.get(fields.nameLower)
  if (cached) return cached
  const orgRef = firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(context.orgId)
  const companies = orgRef.collection(CRM_COLLECTIONS.companies)
  const matches = await companies
    .where('nameLower', '==', fields.nameLower)
    .limit(10)
    .get()
  const seen = matches.docs.find((doc) =>
    visibleToTokens(doc.get('visibleTo'), context.readTokens),
  )
  if (seen) {
    cache.set(fields.nameLower, seen.id)
    return seen.id
  }
  /*
   * THE RECORDS BAND (AGL-2611). A company is a record of the same band
   * the contact behind this row will meet at its own door, so on a Free
   * org at its hundred the row gets no company rather than a company it
   * was not allowed to hold. Nothing is reported here: the contact is
   * refused `audience-band` a few lines on and the row is listed skipped,
   * which is the one message the operator needs. A paid org never reaches
   * this branch — a rate is what makes the band meter instead of refuse.
   */
  const room = await crmRecordsQuotaForOrg(context.org as never, orgRef)
  if (!room.allowed) return ''
  const created = await companies.add({
    ...fields,
    hostId: context.hostId,
    visibleTo: context.scopeTokens,
    createdByUid: context.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  tally.created += 1
  cache.set(fields.nameLower, created.id)
  return created.id
}

/**
 * `POST crm/contacts-import` — `{ hostId, rows }` → a {@link ContactImportChunkResult}.
 *
 * Rows are written one after another rather than in parallel, because the
 * door's create path counts the collection before it adds: two hundred
 * creates racing one another would each count the same audience and each
 * pass a band the last of them should have hit.
 */
export const crmContactsImportHandler: PluginApiHandler = async (req, res) => {
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

    const owners = await ownerDirectory(
      context.orgId,
      normalized.map((entry) => entry.row),
    )
    const ownersUnresolved = new Set<string>()
    const companies = new Map<string, string>()
    const companyTally = { created: 0 }
    let created = 0
    let merged = 0

    for (const { index, row } of normalized) {
      let ownerUid: string | undefined
      if (row.ownerEmail) {
        ownerUid = owners.get(row.ownerEmail)
        if (!ownerUid) ownersUnresolved.add(row.ownerEmail)
      }
      const companyId = row.companyName
        ? await resolveCompanyId(context, row.companyName, companies, companyTally)
        : undefined
      const verdict = await captureHostContact({
        hostId: context.hostId,
        email: row.email,
        ...(row.name ? { name: row.name } : {}),
        source: 'import',
        interaction: { summary: CONTACT_IMPORT_INTERACTION_SUMMARY },
        marketingConsent: row.marketingConsent,
        tags: row.tags,
        facet: {
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}),
          ...(companyId ? { companyId } : {}),
          ...(row.address ? { address: row.address } : {}),
          ...(ownerUid ? { ownerUid } : {}),
          ...(row.lifecycleStage ? { lifecycleStage: row.lifecycleStage } : {}),
          ...(Object.keys(row.custom).length ? { custom: row.custom } : {}),
        },
        // An import is the merchant's own act and files nobody under a
        // campaign; the picker on the profile is where that happens.
        campaignIds: [],
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
        continue
      }
      if (verdict.created) created += 1
      else merged += 1
    }

    const result: ContactImportChunkResult = {
      received: read.rows.length,
      created,
      merged,
      skipped: skipped.sort((a, b) => a.index - b.index),
      dropped,
      companiesCreated: companyTally.created,
      ownersUnresolved: [...ownersUnresolved],
    }
    return res.status(200).json(result)
  } catch (error) {
    console.error('crm/contacts-import failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}
