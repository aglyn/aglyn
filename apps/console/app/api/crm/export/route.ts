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
  consentGroupForHost,
  contactCsvRowFromDoc,
  contactPrimaryGroup,
  CRM_COLLECTIONS,
  crmExportCells,
  crmExportHeader,
  csvCell,
  hostScopeToken,
  isCrmExportResource,
  isOrgWideMember,
  MAX_SCOPE_HOSTS,
  memberCanSee,
  memberScopeTokens,
  pluginRequestFromWeb,
  type CrmExportOptions,
  type CrmExportResource,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'

/**
 * Documents read per round trip. Not a cap — the stream keeps paging until
 * the collection is exhausted. It bounds what is held at once, which is the
 * only thing a page size should ever bound.
 */
const PAGE_SIZE = 500

/** Sites read per page when the leads file spans an organization. */
const HOST_PAGE = 100

/**
 * The most sites one organization-level leads file reads from.
 *
 * A ceiling rather than an unbounded sweep, and it is REPORTED: the file's
 * row header counts only what was read, so a short file is provably short
 * rather than quietly partial.
 */
const HOST_CEILING = 200

/** The most linked records a tasks file resolves names for before writing ids. */
const NAME_CACHE_CEILING = 2000

/** Header naming the row count the server undertook to send. */
export const EXPORT_ROWS_HEADER = 'X-Aglyn-Export-Rows'

const json = (body: unknown, status: number) => Response.json(body, { status })

/** Which collection under the org root each resource is, bar leads. */
const ORG_COLLECTION: Record<Exclude<CrmExportResource, 'leads'>, string> = {
  contacts: 'contacts',
  companies: CRM_COLLECTIONS.companies,
  deals: CRM_COLLECTIONS.deals,
  tasks: CRM_COLLECTIONS.tasks,
}

/** The file's name, before the date stamp. */
const FILE_BASE: Record<CrmExportResource, string> = {
  contacts: 'contacts',
  companies: 'companies',
  deals: 'deals',
  tasks: 'tasks',
  leads: 'leads',
}

/**
 * THE WHOLE COLLECTION, STREAMED (AGL-2662).
 *
 * ## What this fixes
 *
 * Every CRM export until now wrote the rows the LIST had loaded — a
 * `limit(1000)` window for contacts, a `limit(200)` view for tasks — and
 * called the file `contacts.csv`. A merchant with 40,000 contacts got 1,000
 * of them and nothing on screen or in the file said so. `docs/bulk-actions.md`
 * said it in prose, which is not where somebody opening a spreadsheet looks.
 * This is the same file over every row there is, and it carries
 * `X-Aglyn-Export-Rows` so the client can prove what it received is whole —
 * a stream that dies halfway yields a perfectly well-formed shorter file, and
 * nothing about the bytes says they are short.
 *
 * ## Why it is a route and not a bigger client read
 *
 * A browser cannot hold an unbounded collection, and the tier that most
 * needs a complete export is the tier with the most rows. Cursor-paged and
 * streamed, completeness costs neither a hang nor a buffer.
 *
 * ## The columns are the client's columns
 *
 * `crmExportHeader` and `crmExportCells` are the writers each section's
 * Export button uses, moved into `@aglyn/aglyn` for this route to reach —
 * the console app may not import a feature plugin. One feature, one file
 * format.
 *
 * ## The order is by document id, deliberately
 *
 * Firestore DROPS every document missing the ordered field, so ordering by
 * `updatedAt` or `dueAtMs` would silently omit rows written before that
 * field existed — the exact silent loss an export must not have. A document
 * id is on every document and is a total order.
 *
 * ## Scope is enforced here, because nothing else can
 *
 * The Admin SDK bypasses the rules, so `memberScopeTokens` IS the
 * enforcement: an org-wide member reads every row, and a scoped
 * collaborator's query carries their own tokens as the `array-contains-any`
 * the rules would have evaluated. Leads are host data by path, so the
 * equivalent check is whether the caller reaches the site.
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
  const resource = String(query?.['resource'] ?? '')
  const hostId = String(query?.['hostId'] ?? '')
  if (!orgId || !isCrmExportResource(resource)) {
    return json({ error: 'Missing orgId or resource' }, 400)
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const member = membership?.member
    if (!member && !staff) return json({ error: 'Not found' }, 404)

    // The surface is release-flagged, so the route is too: an export door
    // standing open on a hub nobody can reach is a door.
    if (!staff && !(await isServerReleaseFlagOnForOrg('release_crm', orgId))) {
      return json({ error: 'Not available' }, 404)
    }
    // The permission the CRM's own rules read for. Reading is not writing,
    // but these records ARE the audience: `data.manage` is what admits a
    // person to the list this file copies.
    if (!staff && !(await memberHasOrgPermission(orgId, member, 'data.manage'))) {
      return json({ error: 'Not found' }, 404)
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

    const orgWide = staff || isOrgWideMember(member)
    // `array-contains-any` takes at most thirty values, which is also the
    // widest a consent group can be — a reader past that is the org-wide
    // case and never reaches here.
    const tokens = memberScopeTokens(member).slice(0, MAX_SCOPE_HOSTS)
    if (!orgWide && !tokens.length) return json({ error: 'Not found' }, 404)

    /* The roster, once, so every owner and assignee cell is an address. */
    const ownerEmails = new Map<string, string>()
    for (const entry of (await orgRef.collection('members').get()).docs) {
      const email = String(entry.data()?.['email'] ?? '')
      if (email) ownerEmails.set(entry.id, email)
    }
    const ownerEmail = (uid: string) => ownerEmails.get(uid) ?? uid

    const options: CrmExportOptions = { ownerEmail, assigneeEmail: ownerEmail }

    if (resource === 'contacts') {
      /*
       * A contact's fields live in one holder's FACET, so the file has to
       * say which. Under a site that is the site's own group, for every
       * row; at the organization level it is each row's PRIMARY holder —
       * the same answer the org-level Contacts list flattens by, so the
       * file and the table read one profile per person. What a file must
       * never do is read the top of the document, which is where the
       * pre-facet migration left one holder's fields.
       */
      if (!hostId && !orgWide) return json({ error: 'Missing hostId' }, 400)
      const fields = await orgRef.collection(CRM_COLLECTIONS.contactFields).get()
      options.customFields = fields.docs
        .map((entry) => ({
          key: String(entry.data()?.['key'] ?? entry.id),
          label: String(entry.data()?.['label'] ?? entry.id),
          archivedAt: entry.data()?.['archivedAt'],
        }))
        .filter((field) => !field.archivedAt)
        .map(({ key, label }) => ({ key, label }))
    }

    if (resource === 'deals') {
      const pipelines = await orgRef.collection(CRM_COLLECTIONS.pipelines).get()
      const names = new Map<string, string>()
      const stages = new Map<string, string>()
      for (const entry of pipelines.docs) {
        const data = entry.data() ?? {}
        names.set(entry.id, String(data['name'] ?? entry.id))
        for (const stage of (data['stages'] ?? []) as Array<Record<string, unknown>>) {
          const stageId = String(stage?.['id'] ?? '')
          if (stageId) {
            stages.set(`${entry.id}/${stageId}`, String(stage?.['name'] ?? stageId))
          }
        }
      }
      options.pipelineName = (id) => names.get(id)
      options.stageName = (pipelineId, stageId) =>
        stages.get(`${pipelineId}/${stageId}`)
    }

    /*
     * A task names its contact, company and deal by ID, and a spreadsheet
     * cannot read one. The list resolves them from rows it already holds;
     * the server looks them up as it meets them — batched per page,
     * remembered, and capped, so a tasks file costs reads in proportion to
     * the records it actually references rather than to the org. Past the
     * cap the id is written, which is the documented degradation everywhere
     * else in these files.
     */
    const recordNames = new Map<string, string>()
    const resolveNames = async (
      wanted: ReadonlyArray<{ kind: 'contact' | 'company' | 'deal'; id: string }>,
    ) => {
      const missing = wanted.filter(
        (entry) =>
          entry.id &&
          !recordNames.has(`${entry.kind}:${entry.id}`) &&
          recordNames.size < NAME_CACHE_CEILING,
      )
      if (!missing.length) return
      const refs = missing.map((entry) =>
        orgRef
          .collection(
            entry.kind === 'contact'
              ? 'contacts'
              : entry.kind === 'company'
                ? CRM_COLLECTIONS.companies
                : CRM_COLLECTIONS.deals,
          )
          .doc(entry.id),
      )
      const snapshots = await firestore.getAll(...refs)
      snapshots.forEach((snapshot, index) => {
        const entry = missing[index]
        const data = snapshot.data() ?? {}
        const name =
          entry.kind === 'deal'
            ? String(data['title'] ?? '')
            : String(data['name'] ?? data['email'] ?? '')
        recordNames.set(`${entry.kind}:${entry.id}`, name || entry.id)
      })
    }
    if (resource === 'tasks') {
      options.recordName = (kind, id) => recordNames.get(`${kind}:${id}`)
    }

    /*
     * LEADS ARE HOST DATA BY PATH. Under one site the file is that site's;
     * with no site named, an org-wide member takes every site's leads in one
     * file with a `Site` column — the same file the organization-level Leads
     * list writes. A scoped collaborator must name a site they reach.
     */
    const siteNames = new Map<string, string>()
    let leadHostIds: string[] = []
    if (resource === 'leads') {
      if (hostId) {
        if (!orgWide && !memberCanSee(member, [hostScopeToken(hostId)])) {
          return json({ error: 'Not found' }, 404)
        }
        leadHostIds = [hostId]
      } else {
        if (!orgWide) return json({ error: 'Missing hostId' }, 400)
        let cursor: string | null = null
        for (;;) {
          let page = firestore
            .collection('hosts')
            .where('orgId', '==', orgId)
            .orderBy(FieldPath.documentId())
            .limit(HOST_PAGE)
          if (cursor) page = page.startAfter(firestore.collection('hosts').doc(cursor))
          const snapshot = await page.get()
          for (const entry of snapshot.docs) {
            leadHostIds.push(entry.id)
            siteNames.set(
              entry.id,
              String(
                entry.data()?.['displayName'] ??
                  entry.data()?.['subdomain'] ??
                  entry.id,
              ),
            )
          }
          if (snapshot.docs.length < HOST_PAGE) break
          if (leadHostIds.length >= HOST_CEILING) break
          cursor = snapshot.docs[snapshot.docs.length - 1].id
        }
        options.siteName = (id) => siteNames.get(id)
      }
    }

    /** One resource's rows, as a query per collection the file spans. */
    const sources =
      resource === 'leads'
        ? leadHostIds.map((id) => ({
            hostId: id,
            reference: firestore.collection('hosts').doc(id).collection('leads'),
            scoped: false,
          }))
        : [
            {
              hostId: '',
              reference: orgRef.collection(
                ORG_COLLECTION[resource as Exclude<CrmExportResource, 'leads'>],
              ),
              scoped: !orgWide,
            },
          ]

    // Taken BEFORE the first page, so it describes the collections the
    // export started from. A `count()` aggregate bills one read per 1,000
    // documents — cheap next to the export it is describing, and the only
    // way the client can tell a complete file from a truncated one.
    let total = 0
    for (const source of sources) {
      const counted = source.scoped
        ? source.reference.where('visibleTo', 'array-contains-any', tokens)
        : source.reference
      total += Number((await counted.count().get()).data().count ?? 0)
    }

    /** The holder one contact is written through, resolved per level. */
    const holderFor = (document: Record<string, unknown>) => {
      const group = hostId
        ? consentGroupForHost(org as Record<string, unknown>, hostId)
        : contactPrimaryGroup(document, org as Record<string, unknown>)
      return { groupId: group.groupId, hostIds: group.hostIds }
    }

    const encoder = new TextEncoder()
    const encode = (text: string) => encoder.encode(text)
    const line = (cells: readonly unknown[]) => cells.map(csvCell).join(',')
    let sourceIndex = 0
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
    let phase: 'head' | 'body' | 'tail' = 'head'

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (phase === 'head') {
            phase = sources.length ? 'body' : 'tail'
            controller.enqueue(encode(line(crmExportHeader(resource, options))))
            return
          }
          if (phase === 'body') {
            const source = sources[sourceIndex]
            let page: FirebaseFirestore.Query = source.reference
            if (source.scoped) {
              page = page.where('visibleTo', 'array-contains-any', tokens)
            }
            page = page.orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
            if (cursor) page = page.startAfter(cursor)
            const snapshot = await page.get()
            const exhausted = snapshot.docs.length < PAGE_SIZE
            cursor = exhausted
              ? null
              : (snapshot.docs[snapshot.docs.length - 1] ?? null)
            if (exhausted) {
              sourceIndex += 1
              if (sourceIndex >= sources.length) phase = 'tail'
            }
            if (!snapshot.empty) {
              const documents = snapshot.docs.map((entry) => ({
                ...(entry.data() ?? {}),
                $id: entry.id,
                ...(source.hostId ? { hostId: source.hostId } : {}),
              }))
              if (resource === 'tasks') {
                await resolveNames(
                  documents.flatMap((document) =>
                    (['contact', 'company', 'deal'] as const).map((kind) => ({
                      kind,
                      id: String(
                        document[
                          kind === 'contact'
                            ? 'contactId'
                            : kind === 'company'
                              ? 'companyId'
                              : 'dealId'
                        ] ?? '',
                      ),
                    })),
                  ),
                )
              }
              const lines = documents.map((document) =>
                line(
                  crmExportCells(
                    resource,
                    resource === 'contacts'
                      ? (contactCsvRowFromDoc(
                          document,
                          holderFor(document),
                        ) as Record<string, unknown>)
                      : document,
                    options,
                  ),
                ),
              )
              controller.enqueue(encode(`\n${lines.join('\n')}`))
              return
            }
            if (phase === 'body') return
          }
          controller.enqueue(encode('\n'))
          controller.close()
        } catch (error) {
          // Erroring the stream truncates the download rather than
          // completing it short — a half-written file the browser reports
          // as a failed transfer, not a quiet partial handover.
          controller.error(error)
        }
      },
    })

    // Ids and counts only, never content: a full copy of an audience
    // leaving the platform is worth a row; who was in it is not ours to log.
    void firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'crm.exported',
        target: `orgs/${orgId}/${resource}`,
        before: null,
        after: { resource, rows: total, hostId: hostId || null },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${FILE_BASE[resource]}-${stamp}.csv"`,
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
