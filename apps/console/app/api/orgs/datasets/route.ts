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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  coerceDocumentValues,
  createResourceUid,
  effectiveDatasetModel,
  validateDocument,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'

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
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const member = membership?.member as any
    if (
      !member ||
      !WRITER_ROLES.has(String(member.role)) ||
      member.orgSuspended === true
    ) {
      return Response.json({ error: 'Editing org data requires the editor role' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const tenant = orgSnapshot.data() as any

    if (action === 'create-dataset') {
      if (!checkEntitlement(tenant, 'dataStore')) {
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
      const quota = checkDatasetQuota(tenant, datasetCount)
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
        const quota = checkQuota(tenant, 'recordsPerDataset', recordCount)
        if (!quota.allowed) {
          return Response.json({
            error: `Record limit reached (${quota.limit}) — upgrade in Billing`,
          }, { status: 403 })
        }
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
        tenant,
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
