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
import { checkEntitlement } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
// Shared bundle contract lives in _lib: route.ts may only export handlers.
import {
  EXPORT_COLLECTION_LIMITS,
  EXPORTABLE_HOST_FIELDS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../../_lib/site-export'

/**
 * Whole-site export (AGL-163): one JSON bundle of everything designable —
 * host settings, screens/layouts with their PUBLISHED versions, reusable
 * components, variables/functions/workflows/actions, services, content
 * collections + entries, datasets + records, and a media manifest
 * (metadata + URLs; bytes stay in storage). Never includes admins,
 * tenant linkage, domain, bookings/leads/submissions (PII), or secrets
 * (webhooks stay behind). HubSpot famously has no site backup — this is
 * the differentiator. Pro+ (`siteExport` flag).
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(query['hostId'] ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

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
      const tenant = (await getOrgForHost(hostId))?.org
      if (!checkEntitlement(tenant as any, 'siteExport')) {
        return Response.json({ error: 'Site export requires a Pro plan' }, { status: 403 })
      }
    }

    const hostData = hostSnapshot.data() ?? {}
    const host: Record<string, unknown> = {}
    for (const field of EXPORTABLE_HOST_FIELDS) {
      if (hostData[field] !== undefined) host[field] = hostData[field]
    }

    const exportCollection = async (name: string) => {
      const snapshot = await hostRef
        .collection(name)
        .limit(EXPORT_COLLECTION_LIMITS[name] ?? 100)
        .get()
      return snapshot.docs
        .filter((doc) => !doc.get('deletedAt'))
        .map((doc) => ({ $id: doc.id, ...doc.data() }))
    }

    // Screens/layouts carry only their published version's nodes.
    const withPublishedVersion = async (name: 'screens' | 'layouts') => {
      const docs = await exportCollection(name)
      return Promise.all(
        docs.map(async (item: any) => {
          if (!item.versionId) return item
          const version = await hostRef
            .collection(name)
            .doc(item.$id)
            .collection('versions')
            .doc(String(item.versionId))
            .get()
          return version.exists
            ? { ...item, version: { $id: version.id, ...version.data() } }
            : item
        }),
      )
    }

    const withEntries = async () => {
      const collections = await exportCollection('collections')
      return Promise.all(
        collections.map(async (item: any) => ({
          ...item,
          entries: (
            await hostRef
              .collection('collections')
              .doc(item.$id)
              .collection('entries')
              .limit(200)
              .get()
          ).docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
        })),
      )
    }

    const withRecords = async () => {
      const datasets = await exportCollection('datasets')
      return Promise.all(
        datasets.map(async (item: any) => ({
          ...item,
          records: (
            await hostRef
              .collection('datasets')
              .doc(item.$id)
              .collection('records')
              .limit(1000)
              .get()
          ).docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
        })),
      )
    }

    const [
      screens,
      layouts,
      components,
      variables,
      functions,
      workflows,
      actions,
      services,
      collections,
      datasets,
      media,
    ] = await Promise.all([
      withPublishedVersion('screens'),
      withPublishedVersion('layouts'),
      exportCollection('components'),
      exportCollection('variables'),
      exportCollection('functions'),
      exportCollection('workflows'),
      exportCollection('actions'),
      exportCollection('services'),
      withEntries(),
      withRecords(),
      // Media manifest only — bytes stay in storage; URLs keep working
      // because download tokens are stable.
      hostRef
        .collection('media')
        .limit(500)
        .get()
        .then((snapshot) =>
          snapshot.docs
            .filter((doc) => !doc.get('deletedAt'))
            .map((doc) => ({ $id: doc.id, ...doc.data() })),
        ),
    ])

    const bundle = {
      format: SITE_EXPORT_FORMAT,
      version: SITE_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      sourceHostId: hostId,
      host,
      screens,
      layouts,
      components,
      variables,
      functions,
      workflows,
      actions,
      services,
      collections,
      datasets,
      media,
    }
    return new Response(JSON.stringify(bundle), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition':
          `attachment; filename="aglyn-${hostData['subdomain'] ?? hostId}-` +
          `${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Export failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
