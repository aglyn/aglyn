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
import { checkEntitlement, decodeStoredNodes } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  scopedToHost,
} from '@aglyn/tenant-data-admin'
// Shared bundle contract lives in _lib: route.ts may only export handlers.
import {
  EXPORT_COLLECTION_LIMITS,
  EXPORTABLE_HOST_FIELDS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../../_lib/site-export'
import { encodeBundleTimestamps } from '../../_lib/bundle-timestamps'

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
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
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
    // Plan gate rides the owning org's doc (AGL-238). The org id is kept —
    // datasets and media are read from the org, not the host (AGL-1046).
    const owningOrg = await getOrgForHost(hostId)
    const orgId = owningOrg?.orgId
    if (!checkEntitlement(owningOrg?.org as any, 'siteExport')) {
      return Response.json({ error: 'Site export requires a Pro plan' }, { status: 403 })
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

    /**
     * A version's `nodes`, decoded to the map a bundle can actually carry
     * (AGL-1391).
     *
     * `nodes` is stored in TWO live forms — a plain Firestore map, and msgpack
     * `Bytes` — and the besigner writes the compressed one, so it is the
     * majority of live screens and layouts. This route reads `version.data()`
     * RAW, with no converter, so the Admin SDK hands back a Node `Buffer`, and
     * `JSON.stringify` turns that into `{"type":"Buffer","data":[…]}`. The
     * import wrote that object straight back. Every besigner-saved page in
     * every bundle therefore restored EMPTY — silently, exactly as AGL-1223
     * failed: nothing in the envelope has a `componentId`, so nothing throws.
     *
     * Decoding here rather than re-encoding on the way in is the deliberate
     * choice. A backup whose content nobody can read is most of the way to no
     * backup: a bundle is a JSON file customers diff, grep and hand-edit, and
     * it is the only artefact that survives losing the account. It is also
     * SMALLER — `JSON.stringify` of a Buffer emits a decimal array at ~4
     * characters per byte, which is roughly 3x the plain map it encodes, so
     * "compressed" was never compact once it left Firestore.
     *
     * `elements` gets the same treatment. It is the legacy alias migrated
     * inside `screenVersionConverter`, so it only exists on documents written
     * before compression and is always a plain map — which passes through
     * unchanged. Covering it costs nothing and means one rule, not two.
     *
     * A decode failure keeps the RAW value rather than dropping to null: the
     * bytes are the only copy of that page, so shipping them opaque leaves a
     * recovery possible, and the import re-encodes an envelope losslessly.
     */
    const readableNodes = (data: Record<string, any>) => {
      const readable: Record<string, unknown> = {}
      for (const key of ['nodes', 'elements']) {
        // Only rewrite a field the document actually has — writing an explicit
        // `null` over an absent key would restore as a cleared tree.
        if (data[key] === undefined) continue
        readable[key] = decodeStoredNodes(data[key]) ?? data[key]
      }
      return readable
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
          if (!version.exists) return item
          const data = version.data() ?? {}
          return {
            ...item,
            version: { $id: version.id, ...data, ...readableNodes(data) },
          }
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

    /**
     * Datasets and media are ORG-owned (AGL-237) and narrowed to what this
     * host may see (AGL-1046). Both used to be read off `hosts/{hostId}/…`,
     * which AGL-237 emptied and AGL-1050 confirmed holds nothing in
     * production — so a "whole-site backup" had been silently shipping zero
     * datasets and an empty media manifest for every org-wired site. Fixing
     * the path and applying the scope are the same edit: an agency's export
     * of a client site must contain that client's data and no other's.
     *
     * `visibleTo` itself is stripped on the way out. Its `host:` tokens name
     * hosts of THIS org, so they are noise at best and a dangling reference
     * at worst once the bundle is restored somewhere else; the import side
     * assigns a fresh scope instead.
     */
    const scopeless = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const { visibleTo: _visibleTo, ...data } = doc.data()
      return { $id: doc.id, ...data }
    }
    const exportOrgCollection = async (
      name: 'datasets' | 'media' | 'mediaFolders',
      cap: number,
    ) => {
      // A host with no owning org genuinely has no org data — that is a
      // known-empty answer, not a failure, and `orgId` already tells us.
      //
      // Everything else THROWS. A catch-all here would rebuild the exact
      // bug this route was fixing one level down: a missing index or a
      // transient read would produce a silently empty, still-200 "backup"
      // that nobody discovers until they try to restore it. An export that
      // fails loudly is recoverable; one that lies is not.
      if (!orgId) return []
      const ref = firestore.collection('orgs').doc(orgId).collection(name)
      const snapshot = await scopedToHost(ref, hostId).limit(cap).get()
      return snapshot.docs.filter((doc) => !doc.get('deletedAt')).map(scopeless)
    }

    const withRecords = async () => {
      const datasets = await exportOrgCollection(
        'datasets',
        EXPORT_COLLECTION_LIMITS['datasets'] ?? 100,
      )
      return Promise.all(
        datasets.map(async (item: any) => ({
          ...item,
          records: (
            await firestore
              .collection('orgs')
              .doc(orgId as string)
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
      mediaFolders,
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
      // because download tokens are stable. Org-owned and scope-filtered
      // for the same reason as datasets (AGL-1046). The cap reads from the
      // shared table rather than a literal: this side said 500 and the
      // import side fell through to its `?? 100` default, so every manifest
      // over 100 assets restored short and silently (AGL-1382).
      exportOrgCollection('media', EXPORT_COLLECTION_LIMITS['media']),
      // The tree the manifest points into (AGL-1392). Org-owned and
      // scope-filtered exactly like the assets: without it every restored
      // asset's `folderId` named a folder the bundle did not contain, and a
      // dangling `folderId` HIDES an asset rather than merely misfiling it —
      // the DAM's root view filters out anything with a truthy `folderId`.
      exportOrgCollection(
        'mediaFolders',
        EXPORT_COLLECTION_LIMITS['mediaFolders'],
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
      mediaFolders,
    }
    /**
     * Dates leave as a TAGGED wire form, not as the Admin SDK's private
     * `{_seconds, _nanoseconds}` (AGL-1392).
     *
     * `JSON.stringify` on a `Timestamp` emits those private fields, so every
     * date in every bundle restored as a plain MAP — and
     * `publishSchedule.publishAt <= now` is a range query, which a map cannot
     * satisfy at any value because Firestore orders by type first. Restored
     * sites looked correct and silently stopped publishing.
     *
     * One call on the whole bundle rather than a list of date fields: they nest
     * (`publishSchedule.publishAt`, `installedFrom.installedAt`), and an
     * enumeration is what the next feature forgets.
     */
    return new Response(JSON.stringify(encodeBundleTimestamps(bundle)), {
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
