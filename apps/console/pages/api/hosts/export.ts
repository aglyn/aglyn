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

import { checkEntitlement } from '@aglyn/aglyn'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

export const SITE_EXPORT_FORMAT = 'aglyn-site-export'
export const SITE_EXPORT_VERSION = 1

/** Host-doc fields that travel in a bundle (never admins/tenant/domain). */
export const EXPORTABLE_HOST_FIELDS = [
  'displayName',
  'seo',
  'theme',
  'screens',
  'layouts',
  'notFoundScreenId',
  'errorScreens',
  'analytics',
] as const

/** Per-collection doc caps keep bundles bounded and import tractable. */
export const EXPORT_COLLECTION_LIMITS: Record<string, number> = {
  screens: 200,
  layouts: 50,
  components: 100,
  variables: 100,
  functions: 100,
  workflows: 100,
  actions: 100,
  services: 50,
  collections: 20,
  datasets: 50,
}

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return res.status(403).json({ error: 'Not a site admin' })
    }
    {
      // Plan gate rides the owning org's doc (AGL-238).
      const tenant = (await getOrgForHost(hostId))?.org
      if (tenant?.['plan'] && !checkEntitlement(tenant as any, 'siteExport')) {
        return res
          .status(403)
          .json({ error: 'Site export requires a Pro plan' })
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
    res.setHeader('Content-Type', 'application/json')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="aglyn-${hostData['subdomain'] ?? hostId}-` +
        `${new Date().toISOString().slice(0, 10)}.json"`,
    )
    return res.status(200).send(JSON.stringify(bundle))
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Export failed' })
  }
}
