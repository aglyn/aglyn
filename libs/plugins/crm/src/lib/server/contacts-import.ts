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
 * The same two gates the rules put on the contacts collection: a site role
 * on the host the request names, AND the organization's `data.manage`
 * permission resolved through the member's custom role and overrides. The
 * Admin SDK evaluates no rules, so this route is the enforcement rather
 * than an echo of it — and `data.manage` rather than the raw role because
 * an owner who unticked "Manage data" on a custom role meant it.
 */

import {
  CONTACT_IMPORT_CHUNK_SIZE,
  CONTACT_IMPORT_MAX_BODY_BYTES,
  type ContactFieldDefinition,
  type ContactImportChunkResult,
  type ContactImportRawRow,
  type ContactImportRow,
  type ContactImportSkippedRow,
  consentGroupScope,
  CRM_COLLECTIONS,
  crmScopeTokens,
  nameSearchFields,
  normalizeContactImportRow,
  ORG_SCOPE_TOKEN,
  type PluginApiHandler,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  crmRecordsQuotaForOrg,
  firebaseAdmin,
  getOrgForHost,
  listOrgMembers,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { captureHostContact } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'

/** The one sentence every imported contact's timeline opens with. */
export const CONTACT_IMPORT_INTERACTION_SUMMARY = 'Imported from CSV'

/** Everything the import needs about who is asking, or the refusal to send back. */
type ImportContext =
  | {
      ok: true
      uid: string
      hostId: string
      orgId: string
      org: Record<string, unknown>
      /**
       * The stamp a record CREATED by this import carries — the org, when
       * the org widened its default, and otherwise the capturing group.
       */
      scopeTokens: string[]
      /**
       * The tokens a record must overlap to be SEEN from this site: the
       * group's own, plus `org`, because an org-wide record is visible to
       * every site in the account. The reader's set is wider than the
       * creator's stamp, exactly as it is on the contacts listener.
       */
      readTokens: string[]
    }
  | { ok: false; status: number; body: Record<string, unknown> }

/**
 * Who is asking, and on whose behalf.
 *
 * A staff token passes both gates the way it does on every console route:
 * support importing a customer's file for them is the support act this
 * exists for, and the rules admit staff to the collection outright.
 */
async function resolveImportContext(
  req: Parameters<PluginApiHandler>[0],
): Promise<ImportContext> {
  const hostId = String(req.body?.hostId ?? '')
  if (!hostId) {
    return { ok: false, status: 400, body: { error: 'Missing hostId' } }
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return { ok: false, status: 401, body: { error: 'Unauthenticated' } }
  }
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const staff = decoded['staff'] === true
  const firestore = firebaseAdmin.app().firestore()
  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) {
    return { ok: false, status: 404, body: { error: 'Unknown site' } }
  }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
  if (!staff && memberRole !== 'admin' && memberRole !== 'editor') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Not a site admin or editor' },
    }
  }
  const resolved = await getOrgForHost(hostId).catch(() => null)
  const orgId = String(resolved?.orgId ?? '')
  if (!orgId) {
    return {
      ok: false,
      status: 404,
      body: { error: 'This site has no organization, so it has no contacts.' },
    }
  }
  const org = (resolved?.org ?? {}) as Record<string, unknown>
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
    () => null,
  )
  const member = membership?.member
  if (
    !staff &&
    (!member ||
      (member as { orgSuspended?: boolean }).orgSuspended === true ||
      !(await memberHasOrgPermission(orgId, member, 'data.manage')))
  ) {
    return {
      ok: false,
      status: 403,
      body: {
        error:
          'Your organization role does not allow managing contacts, so it ' +
          'cannot import them.',
      },
    }
  }
  const group = await consentGroupForSite(hostId)
  return {
    ok: true,
    uid: decoded.uid,
    hostId,
    orgId,
    org,
    scopeTokens: crmScopeTokens(org, group),
    readTokens: [ORG_SCOPE_TOKEN, ...consentGroupScope(group)],
  }
}

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
 * The org's members by address, read only when a row names an owner.
 *
 * A file with no owner column costs no roster read; a file with one costs
 * exactly one, however many rows it has.
 */
async function ownerDirectory(
  orgId: string,
  rows: readonly ContactImportRow[],
): Promise<Map<string, string>> {
  const directory = new Map<string, string>()
  if (!rows.some((row) => row.ownerEmail)) return directory
  const members = await listOrgMembers(orgId)
  for (const member of members) {
    const email = String(member.email ?? '')
      .trim()
      .toLowerCase()
    if (email && member.$id) directory.set(email, String(member.$id))
  }
  return directory
}

/** The rows a request may carry, or the refusal to send back. */
function readRows(
  req: Parameters<PluginApiHandler>[0],
): { rows: ContactImportRawRow[] } | { status: number; error: string } {
  if ((req.rawBody?.length ?? 0) > CONTACT_IMPORT_MAX_BODY_BYTES) {
    return {
      status: 413,
      error: 'That request is too large. Import the file in smaller pieces.',
    }
  }
  const rows = req.body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 400, error: 'No rows to import.' }
  }
  if (rows.length > CONTACT_IMPORT_CHUNK_SIZE) {
    return {
      status: 400,
      error: `At most ${CONTACT_IMPORT_CHUNK_SIZE} rows per request.`,
    }
  }
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    return { status: 400, error: 'Every row must be an object.' }
  }
  return { rows: rows as ContactImportRawRow[] }
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
  const read = readRows(req)
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
