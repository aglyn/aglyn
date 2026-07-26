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
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
} from '../../../../utils/server/media-scope'

export interface MediaReference {
  kind: 'screen' | 'layout' | 'entry'
  id: string
  name: string
}

/**
 * Per-asset usage scan (AGL-176): finds published screens/layouts whose
 * live version nodes reference the asset's URL in any of its forms (raw
 * storage URL or the AGL-175 CDN path). Computed on demand — a reverse
 * index maintained at publish time stays open as a later optimization;
 * at current host sizes a scan of live versions is a few dozen reads.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const mediaId = String(body?.mediaId ?? '')
  if (!mediaId) {
    return Response.json({ error: 'Missing mediaId' }, { status: 400 })
  }
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
    const { scope, error } = await resolveMediaScope(
      body,
      query,
      decoded.uid,
    )
    if (!scope) {
      return Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
    }

    const mediaSnapshot = await scope.scopeRef
      .collection('media')
      .doc(mediaId)
      .get()
    if (!mediaSnapshot.exists) {
      return Response.json({ error: 'Unknown media' }, { status: 404 })
    }
    const needles = [
      mediaSnapshot.get('url'),
      mediaSnapshot.get('cdnPath'),
      // Any URL containing the storage object path also counts.
      mediaObjectPath(mediaSnapshot, scope.base),
    ].filter(Boolean) as string[]

    // Org assets can appear on any of the org's sites — scan them all;
    // a host asset scans its own site only.
    const hostRefs =
      scope.collection === 'orgs'
        ? (
            await firestore
              .collection('hosts')
              .where('orgId', '==', scope.scopeId)
              .get()
          ).docs.map((host) => host.ref)
        : [scope.scopeRef]

    const references: MediaReference[] = []
    for (const hostRef of hostRefs)
    for (const kind of ['screens', 'layouts'] as const) {
      const parents = await hostRef.collection(kind).get()
      await Promise.all(
        parents.docs.map(async (parent) => {
          if (parent.get('deletedAt')) return
          const versionId = parent.get('versionId')
          if (!versionId) return
          const version = await parent.ref
            .collection('versions')
            .doc(String(versionId))
            .get()
          if (!version.exists) return
          const haystack = JSON.stringify(version.get('nodes') ?? {})
          if (needles.some((needle) => haystack.includes(needle))) {
            references.push({
              kind: kind === 'screens' ? 'screen' : 'layout',
              id: parent.id,
              name: String(parent.get('name') ?? parent.id),
            })
          }
        }),
      )
    }

    // Content-collection entries (AGL-833): blog and other collections
    // reference media via `coverImage`/`body`, not screen/layout nodes — so
    // scan every entry's fields too.
    for (const hostRef of hostRefs) {
      const collections = await hostRef.collection('collections').get()
      await Promise.all(
        collections.docs.map(async (collection) => {
          const entries = await collection.ref.collection('entries').get()
          for (const entry of entries.docs) {
            if (entry.get('deletedAt')) continue
            const haystack = JSON.stringify(entry.data() ?? {})
            if (needles.some((needle) => haystack.includes(needle))) {
              references.push({
                kind: 'entry',
                id: entry.id,
                name: String(entry.get('title') ?? entry.id),
              })
            }
          }
        }),
      )
    }

    return Response.json({ references }, { status: 200 })
  } catch (error) {
    console.error('media references scan failed', mediaId, error)
    return Response.json({ error: 'Scan failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
