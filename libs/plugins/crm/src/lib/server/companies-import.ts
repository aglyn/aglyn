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
 * `POST /api/crm/companies-import` — one chunk of a companies file, written
 * (AGL-2621).
 *
 * The browser has already read the file and applied the operator's column
 * mapping; what arrives here is up to {@link COMPANY_IMPORT_CHUNK_SIZE} raw
 * rows in the vocabulary `crm-company-import.ts` defines. This route judges
 * each one through the same normalizers the company drawer runs, and
 * writes it — the ONLY place either happens, so a stale tab cannot store
 * something the server would have refused.
 *
 * ## Matched by domain, then by name
 *
 * A row is one company the org may already have. The domain is a key and
 * the name a spelling, so a row with a domain is looked up by it first,
 * and by the name's search key when no company carries the domain or the
 * row has none — two files calling one business "Acme" and "Acme Inc" meet
 * at `acme.com`, and a file with no domain column still finds "Acme" by
 * name. Both lookups are narrowed to what the caller's scope can see: two
 * clients of one agency may each have an "Acme" and must each get their
 * own. A match is UPDATED with what the row carries, tags unioned; no
 * match is CREATED with the stamp every CRM creator writes.
 *
 * ## The band is counted once per request
 *
 * A created company is a CRM record and meets the records band (AGL-2611).
 * The aggregate is taken once at the first create and the verdict re-judged
 * locally as the request creates more — `checkCrmRecordsQuota` is pure over
 * a count — so two hundred rows cost three aggregate reads, not six
 * hundred. A metered plan never refuses; a hard band refuses the rows past
 * it as `records-band`, and updates to matched companies go through either
 * way, because an update adds no record.
 */

import {
  checkCrmRecordsQuota,
  COMPANY_IMPORT_CHUNK_SIZE,
  COMPANY_IMPORT_MAX_BODY_BYTES,
  type CompanyImportChunkResult,
  type CompanyImportRawRow,
  type CompanyImportRow,
  type CompanyImportSkippedRow,
  companyImportMatchKey,
  CRM_COLLECTIONS,
  nameSearchFields,
  normalizeCompanyImportRow,
  type PluginApiHandler,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import { crmRecordsQuotaForOrg, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type ImportContext,
  ownerDirectory,
  readImportRows,
  resolveImportContext,
} from './import-context'

type Companies = FirebaseFirestore.CollectionReference

/** The company a row refers to in this scope — by domain, then by name — or `null`. */
async function findCompany(
  companies: Companies,
  readTokens: readonly string[],
  row: Pick<CompanyImportRow, 'name' | 'domain'>,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const seen = (snapshot: FirebaseFirestore.QuerySnapshot) =>
    snapshot.docs.find((doc) => visibleToTokens(doc.get('visibleTo'), readTokens)) ?? null
  if (row.domain) {
    const byDomain = seen(
      await companies.where('domain', '==', row.domain).limit(10).get(),
    )
    if (byDomain) return byDomain
  }
  return seen(
    await companies
      .where('nameLower', '==', nameSearchFields(row.name).nameLower)
      .limit(10)
      .get(),
  )
}

/**
 * The fields a row writes — on a create and on an update alike. Only what
 * the row carries: an update must not clear a website the file did not
 * mention, so an absent optional is left absent here rather than deleted.
 */
function storedFields(
  row: CompanyImportRow,
  ownerUid: string | undefined,
): Record<string, unknown> {
  return {
    ...nameSearchFields(row.name),
    ...(row.domain ? { domain: row.domain } : {}),
    ...(row.website ? { website: row.website } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.industry ? { industry: row.industry } : {}),
    ...(ownerUid ? { ownerUid } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  }
}

/**
 * `POST crm/companies-import` — `{ hostId, rows }` → a {@link CompanyImportChunkResult}.
 *
 * Rows are written one after another rather than in parallel: two rows
 * for one company racing each other would each miss the other's create.
 */
export const crmCompaniesImportHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const read = readImportRows<CompanyImportRawRow>(req, {
    maxBodyBytes: COMPANY_IMPORT_MAX_BODY_BYTES,
    chunkSize: COMPANY_IMPORT_CHUNK_SIZE,
  })
  if ('error' in read) return res.status(read.status).json({ error: read.error })
  try {
    const context = await resolveImportContext(req)
    if (context.ok === false) return res.status(context.status).json(context.body)

    const skipped: CompanyImportSkippedRow[] = []
    const dropped: Record<string, number> = {}
    const normalized: { index: number; row: CompanyImportRow }[] = []
    /*
     * A duplicate WITHIN the request is skipped rather than merged: the
     * second row would update the first's record and the count would read
     * one created and one merged for one company in one file. Across
     * requests the lookup answers, and reports a merge.
     */
    const seen = new Set<string>()
    read.rows.forEach((raw, index) => {
      const verdict = normalizeCompanyImportRow(raw)
      if (verdict.ok === false) {
        skipped.push({ index, name: verdict.input, reason: verdict.reason })
        return
      }
      const key = companyImportMatchKey(verdict.row)
      if (seen.has(key)) {
        skipped.push({ index, name: verdict.row.name, reason: 'duplicate' })
        return
      }
      seen.add(key)
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
    const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(context.orgId)
    const companies = orgRef.collection(CRM_COLLECTIONS.companies)
    const stamp = creationStamp(context)
    let counted: { crmRecordsCount: number } | null = null
    let createdHere = 0
    let created = 0
    let merged = 0

    for (const { index, row } of normalized) {
      let ownerUid: string | undefined
      if (row.ownerEmail) {
        ownerUid = owners.get(row.ownerEmail)
        if (!ownerUid) ownersUnresolved.add(row.ownerEmail)
      }
      const existing = await findCompany(companies, context.readTokens, row)
      const fields = storedFields(row, ownerUid)
      if (existing) {
        await existing.ref.update({
          ...fields,
          ...(row.tags.length ? { tags: FieldValue.arrayUnion(...row.tags) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        merged += 1
        continue
      }
      if (!counted) counted = await crmRecordsQuotaForOrg(context.org as never, orgRef)
      const room = checkCrmRecordsQuota(
        context.org as never,
        counted.crmRecordsCount + createdHere,
      )
      if (!room.allowed) {
        skipped.push({ index, name: row.name, reason: 'records-band' })
        continue
      }
      await companies.add({
        ...fields,
        tags: row.tags,
        ...stamp,
      })
      createdHere += 1
      created += 1
    }

    const result: CompanyImportChunkResult = {
      received: read.rows.length,
      created,
      merged,
      skipped: skipped.sort((a, b) => a.index - b.index),
      dropped,
      ownersUnresolved: [...ownersUnresolved],
    }
    return res.status(200).json(result)
  } catch (error) {
    console.error('crm/companies-import failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}

/**
 * What every company this import CREATES carries beside its fields: the
 * scope every CRM creator stamps, the site as provenance, who imported it,
 * and the clocks. A record written without `visibleTo` is seen by nobody.
 */
function creationStamp(
  context: Extract<ImportContext, { ok: true }>,
): Record<string, unknown> {
  return {
    hostId: context.hostId,
    visibleTo: context.scopeTokens,
    createdByUid: context.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
