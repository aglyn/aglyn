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
  checkDataStorageQuota,
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  dataStorageEnforcementShape,
  coerceDocumentValues,
  createResourceUid,
  effectiveDatasetModel,
  validateDocument,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'

/**
 * Enforce `checkDataStorageQuota(...).allowed` at the record write (AGL-2163).
 *
 * The gap this closes: the check existed, was documented as a hard block for
 * plans with no overage rate, was listed in `free-tier-never-billed.spec.ts`
 * as one of free's runtime braces — and had no reader. `report-usage` calls
 * it for `overageMonthlyUsd` and ignores `allowed`. The blast radius was
 * small only by accident (free carries `dataStorageMbPerOrg: 0`,
 * `datasetsPerOrg: 0` and `features.dataStore: false`, so the entitlement gate
 * above usually fires first); a per-org `features.dataStore` override reaches
 * straight past it, and then a free org can store unbounded dataset bytes
 * that nothing refuses and nothing bills.
 *
 * Modelled on the ENFORCED precedent, `checkFormSubmissionQuota` at
 * `apps/tenant/app/api/forms/submit/route.ts`: read the count, ask the check,
 * refuse before the write.
 *
 * COSTS A PAYING CUSTOMER NOTHING. Every plan with an
 * `extraDataGbMonthlyUsd` rate resolves to `'never-blocks'`, so the metered
 * case returns `null` without a single read and without any possibility of a
 * refusal — the overage bills, exactly as `checkDataStorageQuota`'s docblock
 * says it should. Only the two other shapes cost anything.
 */
async function refuseIfDataStorageBlocked(
  org: unknown,
  orgRef: FirebaseFirestore.DocumentReference,
): Promise<Response | null> {
  const shape = dataStorageEnforcementShape(org as never)
  if (shape === 'never-blocks') return null
  if (shape === 'always-blocks') {
    // The band is zero and the plan meters nothing — no measurement can
    // change the answer, so this refuses without reading anything.
    return Response.json(
      {
        error:
          'Dataset storage is not included on this plan — upgrade in Billing',
      },
      { status: 403 },
    )
  }
  // `'measure'` — a finite, non-zero band on a plan with no overage rate.
  // No plan shipping today has that shape; it exists only where staff have
  // set an `entitlementOverrides.dataStorageMbPerOrg` on a plan that meters
  // nothing, which is why paying a read here is affordable.
  //
  // Measured from the monthly rollup rather than re-summing the org's
  // datasets: `report-usage`'s `orgDatasetBytes` is O(datasets) reads with two
  // aggregate queries EACH, which is not a per-record-write cost. The reading
  // is therefore up to a month stale, and that is stated rather than hidden —
  // it can only ever under-refuse, never refuse a write it should have
  // allowed, and the org this can reach is one staff configured by hand.
  const usage = await orgRef
    .collection('usage')
    .doc(new Date().toISOString().slice(0, 7))
    .get()
  const usedMb = Number(usage.get('dataStorageMb') ?? 0)
  const quota = checkDataStorageQuota(org as never, usedMb)
  if (quota.allowed) return null
  return Response.json(
    {
      error:
        `Dataset storage limit reached (${quota.includedMb} MB) — ` +
        'upgrade in Billing',
    },
    { status: 403 },
  )
}

/** Roles allowed to create org data — mirrors rules' canWriteOrgData(). */
const WRITER_ROLES = new Set(['owner', 'admin', 'editor'])

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
      const datasetCount = (
        await orgRef.collection('datasets').count().get()
      ).data().count
      const quota = checkDatasetQuota(org, datasetCount)
      if (!quota.allowed) {
        return Response.json({
          error: quota.upgradeRequired
            ? `Dataset limit reached (${quota.limit}) — upgrade in Billing`
            : `Dataset limit reached (${quota.limit}) — add extra datasets ` +
              `for $${quota.addonPriceUsd}/mo each or upgrade in Billing`,
        }, { status: 403 })
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
      await orgRef
        .collection('datasets')
        .doc(id)
        .create({
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
      const recordCount = (
        await datasetRef.collection('records').count().get()
      ).data().count

      if (action === 'create-record') {
        const coerced = coerceDocumentValues(model, body?.values ?? {})
        const errors = validateDocument(model, coerced)
        if (Object.keys(errors).length) {
          return Response.json({ error: 'Record failed validation', errors }, { status: 400 })
        }
        const quota = checkQuota(org, 'recordsPerDataset', recordCount)
        if (!quota.allowed) {
          return Response.json({
            error: `Record limit reached (${quota.limit}) — upgrade in Billing`,
          }, { status: 403 })
        }
        // Bytes, not rows (AGL-2163). Before the write, like every other
        // quota on this route.
        const storageRefusal = await refuseIfDataStorageBlocked(org, orgRef)
        if (storageRefusal) return storageRefusal
        const id = createResourceUid()
        await datasetRef.collection('records').doc(id).create({
          values: coerced,
          order: recordCount,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
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
      const quota = checkQuota(
        org,
        'recordsPerDataset',
        recordCount + rows.length - 1,
      )
      if (!quota.allowed) {
        return Response.json({
          error:
            `This import needs ${rows.length} record slots — your plan ` +
            `allows ${quota.limit} per dataset. See Billing to upgrade.`,
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
      const ids: string[] = []
      for (let start = 0; start < prepared.length; start += 400) {
        const batch = firestore.batch()
        prepared.slice(start, start + 400).forEach((row, offset) => {
          const id = createResourceUid()
          ids.push(id)
          batch.create(datasetRef.collection('records').doc(id), {
            values: row.coerced,
            order: recordCount + start + offset,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          })
        })
        await batch.commit()
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
