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
  decompress,
  mediaRefPattern,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
  scopeAllows,
} from '../../../../utils/server/media-scope'

/**
 * A version document's `nodes`, flattened to text the needles can be run
 * against.
 *
 * `nodes` is stored in TWO forms and both are live: a plain Firestore map,
 * and msgpack bytes (AGL-1151 compression at rest — `screenVersionConverter`
 * compresses on write, and decodes only binary payloads on read). The admin
 * SDK hands a bytes field back as a `Buffer`, and `JSON.stringify` of one
 * yields `{"type":"Buffer","data":[…]}` — a haystack containing none of the
 * document's strings, so EVERY needle misses and the scan answers "used
 * nowhere". That is the single worst answer this endpoint can give: it is
 * what the AGL-1045 scope confirmation quotes before telling an author it is
 * safe to restrict or delete an asset that is on a live page.
 */
function nodesHaystack(raw: unknown): string {
  if (ArrayBuffer.isView(raw)) {
    const bytes = raw as ArrayBufferView
    try {
      return JSON.stringify(
        decompress<Record<string, unknown>>({
          toUint8Array: () =>
            new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        }) ?? {},
      )
    } catch (error) {
      // Undecodable nodes must not read as "no references" — say so.
      console.error('media references: could not decode nodes', error)
      return ''
    }
  }
  return JSON.stringify(raw ?? {})
}

export interface MediaReference {
  kind: 'screen' | 'layout' | 'entry'
  id: string
  name: string
  /** Host that holds the referencing doc — org assets can span sites. */
  hostId: string
  /** Subdomain = the `[host]` route segment used to build the deep link. */
  hostSubdomain: string
  /** Live version of the screen/layout (its detail route needs it). */
  versionId?: string
  /** Collection holding the entry — deep-links to that collection. */
  collectionId?: string
}

/**
 * Per-asset usage scan (AGL-176): finds published screens/layouts whose
 * live version nodes reference the asset in any of its forms — the AGL-1215
 * media reference, or the raw storage URL and AGL-175 CDN path that predate
 * it and still live in published documents. Computed on demand — a reverse
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
    if (
      !mediaSnapshot.exists ||
      !scopeAllows(scope, mediaSnapshot.get('visibleTo'))
    ) {
      // "Unknown" rather than "forbidden" (AGL-1043): whether a restricted
      // asset exists is not something this caller has standing to learn.
      return Response.json({ error: 'Unknown media' }, { status: 404 })
    }
    const needles = [
      mediaSnapshot.get('url'),
      mediaSnapshot.get('cdnPath'),
      // Any URL containing the storage object path also counts.
      mediaObjectPath(mediaSnapshot, scope.base),
    ].filter(Boolean) as string[]
    // Nodes store a REFERENCE now (AGL-1215), which contains neither the
    // storage URL nor the CDN path. Matching only the URL forms would report
    // a picked asset as used nowhere — and this scan is what the AGL-1045
    // scope confirmation quotes before telling an author it is safe to
    // restrict something. One pattern covers every scope form the reference
    // can carry, so a scan can never under-report by missing a site.
    const refPattern = mediaRefPattern(mediaSnapshot.id)
    const isReferenced = (haystack: string) =>
      needles.some((needle) => haystack.includes(needle)) ||
      refPattern.test(haystack)

    // Org assets can appear on any of the org's sites — scan them all;
    // a host asset scans its own site only. Carry each host's subdomain so
    // the client can deep-link a reference to `/[orgSlug]/hosts/[subdomain]/…`
    // (the `[host]` route segment is the subdomain, not the doc id).
    const hosts: Array<{
      ref: FirebaseFirestore.DocumentReference
      id: string
      subdomain: string
    }> = []
    if (scope.collection === 'orgs') {
      const orgHosts = await firestore
        .collection('hosts')
        .where('orgId', '==', scope.scopeId)
        .get()
      for (const host of orgHosts.docs) {
        // Only sites the CALLER can see (AGL-1043). This endpoint returns
        // each referencing host's id AND subdomain, so an unfiltered scan
        // hands a one-site collaborator the name of every other client
        // site in the org — a roster leak dressed up as a usage report.
        if (!scope.viewerOrgWide && !scopeAllows(scope, ['host:' + host.id])) {
          continue
        }
        hosts.push({
          ref: host.ref,
          id: host.id,
          subdomain: String(host.get('subdomain') ?? host.id),
        })
      }
    } else {
      const scopeSnapshot = await scope.scopeRef.get()
      hosts.push({
        ref: scope.scopeRef,
        id: scope.scopeId,
        subdomain: String(scopeSnapshot.get('subdomain') ?? scope.scopeId),
      })
    }

    const references: MediaReference[] = []
    for (const host of hosts)
    for (const kind of ['screens', 'layouts'] as const) {
      const parents = await host.ref.collection(kind).get()
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
          const haystack = nodesHaystack(version.get('nodes'))
          if (isReferenced(haystack)) {
            references.push({
              kind: kind === 'screens' ? 'screen' : 'layout',
              id: parent.id,
              name: String(parent.get('name') ?? parent.id),
              hostId: host.id,
              hostSubdomain: host.subdomain,
              versionId: String(versionId),
            })
          }
        }),
      )
    }

    // Content-collection entries (AGL-833): blog and other collections
    // reference media via `coverImage`/`body`, not screen/layout nodes — so
    // scan every entry's fields too.
    for (const host of hosts) {
      const collections = await host.ref.collection('collections').get()
      await Promise.all(
        collections.docs.map(async (collection) => {
          const entries = await collection.ref.collection('entries').get()
          for (const entry of entries.docs) {
            if (entry.get('deletedAt')) continue
            const haystack = JSON.stringify(entry.data() ?? {})
            if (isReferenced(haystack)) {
              references.push({
                kind: 'entry',
                id: entry.id,
                name: String(entry.get('title') ?? entry.id),
                hostId: host.id,
                hostSubdomain: host.subdomain,
                collectionId: collection.id,
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
