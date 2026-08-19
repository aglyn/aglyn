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
  defaultScopeForNewResource,
  newResourceScopeFields,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  coerceDocumentValues,
  createResourceUid,
  effectiveDatasetModel,
  validateDocument,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  dataStorageRefusal,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'

/**
 * `dataStorageMbPerOrg` for this route, rendered as the console's 403.
 *
 * The VERDICT moved to `utils/server/data-storage-gate` (AGL-2253) — it was
 * defined here, so `/v1` and the tenant form path, which write dataset bytes
 * through their own code, enforced nothing. Only the console wording is left
 * behind, because the other two callers answer different shapes.
 */
async function refuseIfDataStorageBlocked(
  org: unknown,
  orgRef: FirebaseFirestore.DocumentReference,
): Promise<Response | null> {
  const refusal = await dataStorageRefusal(org, orgRef)
  if (!refusal) return null
  return Response.json(
    {
      error:
        refusal.basis === 'always'
          ? 'Dataset storage is not included on this plan — upgrade in Billing'
          : `Dataset storage limit reached (${refusal.includedMb} MB) — ` +
            'upgrade in Billing',
    },
    { status: 403 },
  )
}

/** Roles allowed to create org data — mirrors rules' canWriteOrgData(). */
const WRITER_ROLES = new Set(['owner', 'admin', 'editor'])

/**
 * Rows written per import transaction.
 *
 * Firestore allows at most 500 writes in one transaction, and this is the
 * chunk size the route already used for its batches, so nothing about the
 * shape of an import changed when the batches became transactions (AGL-2371).
 */
const IMPORT_CHUNK = 400

/**
 * Dataset/record creation API (AGL-473): creates moved out of the client
 * SDK so quotas and entitlements are enforced server-side — Firestore
 * rules deny client-side `create` on `orgs/{orgId}/datasets/**` (updates
 * and deletes stay client-direct, they don't consume quota). Actions:
 *
 * - `create-dataset`: `dataStore` entitlement + `checkDatasetQuota`
 *   (addon-aware, org-scoped).
 * - `create-record`:  `recordsPerDataset` quota; values are re-coerced
 *   and re-validated against the dataset's model server-side.
 * - `import-records`: batch create with the whole batch fitting the cap.
 *
 * Since AGL-2163 both record actions ALSO enforce `checkDataStorageQuota`.
 * See {@link refuseIfDataStorageBlocked}: that check's `allowed` field had no
 * reader anywhere in the platform while its docblock said free "hard-blocks
 * at the included size", so the byte band was documentation. `recordsPerDataset`
 * counts ROWS and does not bound their size, so it was never the same limit.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const member = membership?.member as any
    if (!member || !WRITER_ROLES.has(String(member.role))) {
      return Response.json({ error: 'Editing org data requires the editor role' }, { status: 403 })
    }
    /*==========================================
     * AND the granular permission (AGL-2444).
     *
     * `data.manage` had ZERO consumers: an owner could build a custom role
     * with "Manage data" unticked, assign it, and the member kept creating,
     * editing and deleting datasets — because this gate read the raw role,
     * exactly the defect AGL-2350 fixed one route over on `hosts.create`.
     *
     * Identical for the built-in roles — `data.manage` is on for owner,
     * admin and editor, which is `WRITER_ROLES` — so nobody's access moves.
     * What it adds is that a custom role or a per-member override is now
     * honoured, which is the narrowing the docs sell.
     *
     * The role check is kept ALONGSIDE it rather than replaced. It mirrors
     * the rules' `canWriteOrgData()`, and a route that disagreed with the
     * rules would let one door open while the other stayed shut.
     *=========================================*/
    if (
      decoded['staff'] !== true &&
      !(await memberHasOrgPermission(orgId, member, 'data.manage'))
    ) {
      return Response.json({
        error: 'Your organization role does not allow editing organization data',
      }, { status: 403 })
    }

    // Release gate (AGL-1653). `<FeatureGate flag="release_data_store">` on
    // the org Data page was the only gate, so org-level dataset
    // administration kept working with the flag off — the milder sibling of
    // the add-on store leak above it in the same issue. Same staff bypass as
    // `FeatureGate`'s `visible`, same 404: released-off means absent.
    if (
      decoded['staff'] !== true &&
      !(await isServerReleaseFlagOnForOrg('release_data_store', orgId))
    ) {
      return Response.json({ error: 'Not available' }, { status: 404 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const org = orgSnapshot.data() as any

    // Lockdown verdict (AGL-1506): subsumes the bare `orgSuspended`
    // projection check this route used to make — the org doc is read just
    // above anyway, so the full verdict (platform/org/user scopes, staff
    // bypass, distinct 423 body) costs no extra org read here.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
    })
    if (locked) return locked

    if (action === 'create-dataset') {
      if (!checkEntitlement(org, 'dataStore')) {
        return Response.json({
          error: 'Datasets require a Starter plan or higher',
        }, { status: 403 })
      }
      const displayName = String(body?.displayName ?? '').trim().slice(0, 120)
      const fields = Array.isArray(body?.fields)
        ? (body.fields as unknown[]).map((field) => String(field)).slice(0, 100)
        : []
      if (!displayName || fields.length === 0) {
        return Response.json({ error: 'Missing displayName or fields' }, { status: 400 })
      }
      const datasetsRef = orgRef.collection('datasets')
      const overDatasetQuota = (quota: ReturnType<typeof checkDatasetQuota>) =>
        quota.upgradeRequired
          ? `Dataset limit reached (${quota.limit}) — upgrade in Billing`
          : `Dataset limit reached (${quota.limit}) — add extra datasets ` +
            `for $${quota.addonPriceUsd}/mo each or upgrade in Billing`
      // The fast refusal. NOT the enforcement point — that is the transaction
      // below — but it answers a caller who is simply over their limit before
      // the request builds anything.
      const quota = checkDatasetQuota(
        org,
        (await datasetsRef.count().get()).data().count,
      )
      if (!quota.allowed) {
        return Response.json({ error: overDatasetQuota(quota) }, { status: 403 })
      }
      const id = createResourceUid()
      // The model rides from the console (deriveModelFromFields output or
      // the join-collection template). `model` is independent of `fields`,
      // so cap its serialized size explicitly (a legit model is well under
      // this — 64 KB covers hundreds of typed fields).
      const model = body?.model && typeof body.model === 'object' ? body.model : null
      if (model && JSON.stringify(model).length > 64 * 1024) {
        return Response.json({ error: 'Dataset model too large' }, { status: 413 })
      }
      /**
       * THE ENFORCEMENT POINT (AGL-2371, the AGL-2231 treatment): the count,
       * the decision and the create in ONE transaction.
       *
       * The check above counted, then the request went on awaiting, and only
       * then created — and every await is a yield, so N concurrent creates
       * each read the same pre-count, each found room, and each landed.
       * Nothing re-counts afterwards, so the extra datasets were permanent and
       * billed nothing. `tx.get` on the aggregate takes a pessimistic lock on
       * the documents the query matched, so the loser of a race retries,
       * re-reads the higher count and is refused.
       *
       * The ORG document is deliberately read outside: the plan and the
       * purchased add-ons are the other input to this decision, but neither is
       * client-writable, so locking the org doc on every dataset create would
       * buy contention rather than correctness. That is the AGL-2369 lesson
       * applied, not skipped — there the routing map *was* client-writable and
       * *did* change the count.
       *
       * The refusal comes back as data and is rendered outside: building a
       * response inside a body that can run several times reads as if the
       * transaction were a place effects happen.
       */
      const refusal = await firestore.runTransaction<string | null>(
        async (tx) => {
          const live = (await tx.get(datasetsRef.count())).data().count
          const authoritative = checkDatasetQuota(org, live)
          if (!authoritative.allowed) return overDatasetQuota(authoritative)
          tx.create(datasetsRef.doc(id), {
            displayName,
            fields,
            ...(model ? { model } : {}),
            // Honours the org's `defaultResourceScope` (AGL-1048), falling
            // back to org-wide — which is both today's behavior and the only
            // safe answer with no site in context. Stamping SOMETHING is
            // mandatory either way: `array-contains-any` matches nothing on a
            // doc missing the field, so an unstamped dataset renders on no
            // site at all (AGL-1044).
            //
            // Through `newResourceScopeFields` since AGL-1484: AGL-1478 built
            // that helper as the type-level gate for exactly the collections
            // with no document constructor of their own — `datasets` named
            // first among them — and then only the marketplace fork used it,
            // while the two ordinary dataset creates went on writing the field
            // by hand. A required argument that three of four callers bypass
            // is a convention, not a guarantee.
            ...newResourceScopeFields(
              defaultScopeForNewResource({
                defaultResourceScope: (org as {
                  defaultResourceScope?: 'org' | 'host'
                })?.defaultResourceScope,
                hostId: String(body?.hostId ?? '') || null,
              }),
            ),
            createdAt: Timestamp.now(),
          })
          return null
        },
      )
      if (refusal) return Response.json({ error: refusal }, { status: 403 })
      return Response.json({ ok: true, id }, { status: 200 })
    }

    if (action === 'create-record' || action === 'import-records') {
      const datasetId = String(body?.datasetId ?? '')
      if (!datasetId) {
        return Response.json({ error: 'Missing datasetId' }, { status: 400 })
      }
      const datasetRef = orgRef.collection('datasets').doc(datasetId)
      const datasetSnapshot = await datasetRef.get()
      if (!datasetSnapshot.exists) {
        return Response.json({ error: 'Unknown dataset' }, { status: 404 })
      }
      const model = effectiveDatasetModel(datasetSnapshot.data() as any)
      const recordsRef = datasetRef.collection('records')
      const recordCount = (await recordsRef.count().get()).data().count
      const overRecordQuota = (limit: number) =>
        `Record limit reached (${limit}) — upgrade in Billing`

      if (action === 'create-record') {
        const coerced = coerceDocumentValues(model, body?.values ?? {})
        const errors = validateDocument(model, coerced)
        if (Object.keys(errors).length) {
          return Response.json({ error: 'Record failed validation', errors }, { status: 400 })
        }
        // The fast refusal. NOT the enforcement point — that is the
        // transaction below — but it keeps the refusal ORDER on this route
        // intact: a caller over BOTH the row cap and the byte band is told
        // about the rows, as they always were.
        const quota = checkQuota(org, 'recordsPerDataset', recordCount)
        if (!quota.allowed) {
          return Response.json({
            error: overRecordQuota(quota.limit),
          }, { status: 403 })
        }
        // Bytes, not rows (AGL-2163). Before the write, like every other
        // quota on this route.
        const storageRefusal = await refuseIfDataStorageBlocked(org, orgRef)
        if (storageRefusal) return storageRefusal
        const id = createResourceUid()
        /**
         * THE ENFORCEMENT POINT (AGL-2371, the AGL-2231 treatment): the count,
         * the decision and the create in ONE transaction.
         *
         * The check above counted, then `refuseIfDataStorageBlocked` awaited,
         * and only then did the row land. Every await is a yield, so N
         * concurrent creates each read the same pre-count, each found room,
         * and each landed — permanently, since nothing re-counts afterwards. A
         * free-with-rows-granted org's thousand rows became twenty thousand by
         * sending twenty requests at once.
         *
         * `tx.get` on the aggregate takes a pessimistic lock on the documents
         * the query matched, so the loser retries, re-reads the higher count
         * and is refused. `order` is taken from the transaction's own count
         * for the same reason: the pre-count is what made two concurrent rows
         * share an order.
         *
         * The BYTE gate stays outside. It is a different quota with its own
         * reads, it is not a function of the rows this transaction writes, and
         * re-running it on every retry attempt would put a multi-document read
         * inside a lock.
         */
        const refusal = await firestore.runTransaction<string | null>(
          async (tx) => {
            const live = (await tx.get(recordsRef.count())).data().count
            const authoritative = checkQuota(org, 'recordsPerDataset', live)
            if (!authoritative.allowed) return overRecordQuota(authoritative.limit)
            tx.create(recordsRef.doc(id), {
              values: coerced,
              order: live,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            })
            return null
          },
        )
        if (refusal) return Response.json({ error: refusal }, { status: 403 })
        return Response.json({ ok: true, id }, { status: 200 })
      }

      // import-records: the console sends only the NEW rows (updates to
      // existing ids stay client-direct — they don't consume quota).
      const rows = Array.isArray(body?.records)
        ? (body.records as Array<{ values?: unknown }>)
        : []
      if (rows.length === 0) {
        return Response.json({ error: 'No records to import' }, { status: 400 })
      }
      const overImportQuota = (limit: number, needed: number) =>
        `This import needs ${needed} record slots — your plan ` +
        `allows ${limit} per dataset. See Billing to upgrade.`
      // The fast refusal, on the whole import. NOT the enforcement point —
      // that is the per-chunk transaction below — but it is what answers an
      // import that never fitted, before a single row is written.
      const quota = checkQuota(
        org,
        'recordsPerDataset',
        recordCount + rows.length - 1,
      )
      if (!quota.allowed) {
        return Response.json({
          error: overImportQuota(quota.limit, rows.length),
        }, { status: 403 })
      }
      // Bytes, not rows (AGL-2163). An import is the path that moves the
      // most bytes in one request, so leaving it out would have left the
      // enforcement exactly where the customer does not meet it.
      const importStorageRefusal = await refuseIfDataStorageBlocked(org, orgRef)
      if (importStorageRefusal) return importStorageRefusal
      const prepared = rows.map((row, index) => {
        const coerced = coerceDocumentValues(
          model,
          (row?.values ?? {}) as Record<string, unknown>,
        )
        const errors = validateDocument(model, coerced)
        return { index, coerced, valid: Object.keys(errors).length === 0 }
      })
      const invalid = prepared.filter((row) => !row.valid)
      if (invalid.length) {
        return Response.json({
          error: `${invalid.length} rows failed validation`,
          rows: invalid.map((row) => row.index),
        }, { status: 400 })
      }
      /**
       * THE ENFORCEMENT POINT (AGL-2371): each chunk counts, decides and
       * writes inside ONE transaction.
       *
       * The import used to count once, decide once, and then commit a series
       * of `WriteBatch`es. A batch is atomic but NOT conditional on a read
       * taken before it, so two concurrent imports each priced themselves off
       * the same pre-count and both landed in full — the create leg's defect,
       * multiplied by the batch size.
       *
       * It cannot be ONE transaction for every import the way the single-row
       * create can: `recordsPerDataset` runs to a million, and a transaction
       * carries at most 500 writes. So the chunk is the unit, and each chunk's
       * count is re-read under the lock and re-checked against the plan. The
       * cap therefore holds ABSOLUTELY at every size — what a race can cost is
       * a partial import, not an overshoot, and a partial import was already
       * possible the moment a mid-import batch could fail.
       *
       * The ids are minted before the transaction so a retry re-creates the
       * SAME documents rather than a second copy of the chunk.
       *
       * This is not AGL-2370's problem in miniature. There the whole bundle
       * must land or none of it, so chunking cannot be the unit and a lease is
       * needed; here rows are independent and "fewer rows than asked for" is a
       * reportable outcome.
       */
      const ids: string[] = []
      let refusedAt: string | null = null
      for (
        let start = 0;
        start < prepared.length && refusedAt === null;
        start += IMPORT_CHUNK
      ) {
        const chunk = prepared.slice(start, start + IMPORT_CHUNK)
        const chunkIds = chunk.map(() => createResourceUid())
        refusedAt = await firestore.runTransaction<string | null>(async (tx) => {
          const live = (await tx.get(recordsRef.count())).data().count
          const authoritative = checkQuota(
            org,
            'recordsPerDataset',
            live + chunk.length - 1,
          )
          if (!authoritative.allowed) {
            return overImportQuota(authoritative.limit, rows.length)
          }
          chunk.forEach((row, offset) => {
            tx.create(recordsRef.doc(chunkIds[offset]), {
              values: row.coerced,
              order: live + offset,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            })
          })
          return null
        })
        if (refusedAt === null) ids.push(...chunkIds)
      }
      if (refusedAt !== null) {
        // What landed is reported alongside the refusal. Rows are independent,
        // so silently discarding the created ids would tell the caller nothing
        // was written while the dataset says otherwise.
        return Response.json(
          { error: refusedAt, ids, created: ids.length },
          { status: 403 },
        )
      }
      return Response.json({ ok: true, ids, created: ids.length }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Dataset operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
