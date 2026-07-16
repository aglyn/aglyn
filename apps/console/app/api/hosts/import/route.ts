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
  checkEntitlement,
  effectiveDatasetModel,
  rewriteBindingTokensDeep,
  validateDocument,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  EXPORT_COLLECTION_LIMITS,
  EXPORTABLE_HOST_FIELDS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../../_lib/site-export'

// Bundles are JSON text; 20MB covers the export caps comfortably.
/** Firestore rejects `undefined`; timestamps re-mint on import. */
function cleanDoc(input: Record<string, unknown>): Record<string, unknown> {
  // Destructure-to-drop: ids/children re-key explicitly, timestamps re-mint.
  const {
    $id: _id,
    version: _version,
    entries: _entries,
    records: _records,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = input as any
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) clean[key] = value
  }
  clean['updatedAt'] = firebaseAdmin.firestore.FieldValue.serverTimestamp()
  return clean
}

/**
 * Whole-site restore/import (AGL-163): writes an export bundle into the
 * target host — additive-by-id (docs keep their export ids, so the
 * routing map, screen links, and layout references keep resolving; a
 * restore into the source host is an exact overwrite). Host identity
 * (subdomain/admins/tenant/domain) never changes; PII collections aren't
 * in bundles by design. Pro+ (`siteExport` flag), host-admin only.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  const bundle = body?.bundle
  if (!hostId || typeof bundle !== 'object' || bundle === null) {
    return Response.json({ error: 'Missing hostId or bundle' }, { status: 400 })
  }
  if (
    bundle.format !== SITE_EXPORT_FORMAT ||
    Number(bundle.version) > SITE_EXPORT_VERSION
  ) {
    return Response.json({
      error: 'Not an Aglyn site export (or a newer format than this build)',
    }, { status: 422 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }
    {
      // Plan gate rides the owning org's doc (AGL-238).
      const org = (await getOrgForHost(hostId))?.org
      if (!checkEntitlement(org as any, 'siteExport')) {
        return Response.json({ error: 'Site restore requires a Pro plan' }, { status: 403 })
      }
    }

    let written = 0
    // Firestore batches cap at 500 writes; chunk conservatively.
    let batch = firestore.batch()
    let batched = 0
    const commit = async () => {
      if (batched > 0) await batch.commit()
      batch = firestore.batch()
      batched = 0
    }
    const write = async (
      ref: FirebaseFirestore.DocumentReference,
      data: Record<string, unknown>,
    ) => {
      batch.set(ref, data, { merge: false })
      written += 1
      if ((batched += 1) >= 400) await commit()
    }

    // Host settings — exportable fields only.
    const hostPatch: Record<string, unknown> = {}
    for (const field of EXPORTABLE_HOST_FIELDS) {
      if (bundle.host?.[field] !== undefined) {
        hostPatch[field] = bundle.host[field]
      }
    }
    if (Object.keys(hostPatch).length) {
      batch.set(hostRef, hostPatch, { merge: true })
      batched += 1
    }

    const importPlain = async (name: string) => {
      const items: any[] = Array.isArray(bundle[name]) ? bundle[name] : []
      for (const item of items.slice(
        0,
        EXPORT_COLLECTION_LIMITS[name] ?? 100,
      )) {
        if (!item?.$id) continue
        await write(
          hostRef.collection(name).doc(String(item.$id)),
          cleanDoc(item),
        )
      }
    }

    // Legacy binding tokens in imported nodes normalize to id form
    // (AGL-188): bundle docs keep their export ids, so the bundle's own
    // variables/functions provide the name → id mapping.
    const tokenLookup = (name: 'variables' | 'functions') => {
      const map: Record<string, { name?: string; $id?: string }> = {}
      const items: any[] = Array.isArray(bundle[name]) ? bundle[name] : []
      for (const item of items) {
        if (item?.$id && item?.name) {
          map[String(item.name)] = { name: item.name, $id: String(item.$id) }
          map[String(item.$id)] = { name: item.name, $id: String(item.$id) }
        }
      }
      return map
    }
    const bundleVariables = tokenLookup('variables')
    const bundleFunctions = tokenLookup('functions')

    // Screens/layouts restore the doc plus its published version.
    const importVersioned = async (name: 'screens' | 'layouts') => {
      const items: any[] = Array.isArray(bundle[name]) ? bundle[name] : []
      for (const item of items.slice(0, EXPORT_COLLECTION_LIMITS[name])) {
        if (!item?.$id) continue
        const docRef = hostRef.collection(name).doc(String(item.$id))
        await write(docRef, cleanDoc(item))
        if (item.version?.$id) {
          const version = cleanDoc(item.version)
          version['nodes'] = rewriteBindingTokensDeep(
            version['nodes'],
            bundleVariables,
            bundleFunctions,
          ).value
          await write(
            docRef.collection('versions').doc(String(item.version.$id)),
            version,
          )
        }
      }
    }

    const importCollections = async () => {
      const items: any[] = Array.isArray(bundle.collections)
        ? bundle.collections
        : []
      for (const item of items.slice(0, 20)) {
        if (!item?.$id) continue
        const docRef = hostRef.collection('collections').doc(String(item.$id))
        await write(docRef, cleanDoc(item))
        const entries: any[] = Array.isArray(item.entries) ? item.entries : []
        for (const entry of entries.slice(0, 200)) {
          if (!entry?.$id) continue
          await write(
            docRef.collection('entries').doc(String(entry.$id)),
            cleanDoc(entry),
          )
        }
      }
    }

    // Non-conforming rows are imported AND reported (AGL-182) — data is
    // never silently dropped; the report tells the owner what to fix.
    const dataReport: Array<{
      datasetId: string
      recordId: string
      errors: Record<string, string>
    }> = []
    const importDatasets = async () => {
      const items: any[] = Array.isArray(bundle.datasets)
        ? bundle.datasets
        : []
      for (const item of items.slice(0, 50)) {
        if (!item?.$id) continue
        const docRef = hostRef.collection('datasets').doc(String(item.$id))
        await write(docRef, cleanDoc(item))
        // v1 exports (no model) validate through the derived text model,
        // same as the live migration — everything passes, by design.
        const model = effectiveDatasetModel(item)
        const records: any[] = Array.isArray(item.records) ? item.records : []
        for (const record of records.slice(0, 1000)) {
          if (!record?.$id) continue
          const errors = validateDocument(model, record.values ?? {})
          if (Object.keys(errors).length) {
            dataReport.push({
              datasetId: String(item.$id),
              recordId: String(record.$id),
              errors,
            })
          }
          await write(
            docRef.collection('records').doc(String(record.$id)),
            cleanDoc(record),
          )
        }
      }
    }

    await importVersioned('screens')
    await importVersioned('layouts')
    await importPlain('components')
    await importPlain('variables')
    await importPlain('functions')
    await importPlain('workflows')
    await importPlain('actions')
    await importPlain('services')
    await importPlain('media')
    await importCollections()
    await importDatasets()
    await commit()

    await hostRef
      .collection('activity')
      .add({
        actorId: decoded.uid,
        actorEmail: decoded.email ?? null,
        action: `Restored site from export (${written} documents)`,
        target: { type: 'host', id: hostId },
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json({
      written,
      // Truncated so pathological bundles can't balloon the response.
      dataReport: dataReport.slice(0, 100),
      dataReportTotal: dataReport.length,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Import failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
