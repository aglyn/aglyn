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

import { mediaRefPattern, pluginRequestFromWeb } from '@aglyn/aglyn/server'
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
import {
  HOSTS_PER_SCAN,
  type MediaScanHost,
  scanMediaReferences,
} from '../../../../utils/server/scan-media-references'

/**
 * Per-asset usage scan (AGL-176/AGL-845): where is this asset used, asked
 * immediately before an author deletes or restricts it.
 *
 * The corpus and the decoding live in `scan-media-references` (AGL-1413);
 * this file is the authenticated, scoped entry point to it. What is here is
 * the part that decides WHICH documents the caller may have scanned and what
 * counts as a match — the asset's AGL-1215 media reference, plus the raw
 * storage URL and AGL-175 CDN path that predate it and still sit in published
 * documents.
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
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`.
    const { scope, error } = await resolveMediaScope(body, query, decoded.uid, {
      staff: decoded['staff'] === true,
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
      )
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
    // (the `[host]` route segment is the subdomain, not the doc id), and its
    // DOCUMENT, which the scan reads `logoUrl`/`seo.favicon` out of for free
    // rather than paying a second read for the row it already has.
    const hosts: MediaScanHost[] = []
    let hostsTruncated = false
    let org: { id: string; data?: Record<string, unknown> } | null = null
    if (scope.collection === 'orgs') {
      const orgHosts = await firestore
        .collection('hosts')
        .where('orgId', '==', scope.scopeId)
        .limit(HOSTS_PER_SCAN + 1)
        .get()
      hostsTruncated = orgHosts.size > HOSTS_PER_SCAN
      for (const host of orgHosts.docs.slice(0, HOSTS_PER_SCAN)) {
        // Only sites the CALLER can see (AGL-1043). This endpoint returns
        // each referencing host's id AND subdomain, so an unfiltered scan
        // hands a one-site collaborator the name of every other client
        // site in the org — a roster leak dressed up as a usage report.
        if (!scope.viewerOrgWide && !scopeAllows(scope, ['host:' + host.id])) {
          // A site withheld for access reasons is still a site this answer
          // did not cover, and the caller is about to decide whether to
          // delete. Reported as reduced coverage, never as "used nowhere".
          hostsTruncated = true
          continue
        }
        hosts.push({
          ref: host.ref,
          id: host.id,
          subdomain: String(host.get('subdomain') ?? host.id),
          data: host.data() as Record<string, unknown>,
        })
      }
      // The org document is a reference site too: its own `logoUrl` is
      // picked out of exactly this library.
      const orgSnapshot = await scope.scopeRef.get()
      org = {
        id: scope.scopeId,
        data: orgSnapshot.data() as Record<string, unknown>,
      }
    } else {
      const scopeSnapshot = await scope.scopeRef.get()
      hosts.push({
        ref: scope.scopeRef,
        id: scope.scopeId,
        subdomain: String(scopeSnapshot.get('subdomain') ?? scope.scopeId),
        data: scopeSnapshot.data() as Record<string, unknown>,
      })
    }

    const { references, complete, coverage } = await scanMediaReferences({
      hosts,
      org,
      hostsTruncated,
      isReferenced,
    })

    // `coverage` travels with the list because the list alone cannot carry
    // it: an empty array from an exhaustive scan and an empty array from a
    // truncated one are the same value, and only one of them may be shown to
    // an author as "nothing uses this".
    return Response.json({ references, complete, coverage }, { status: 200 })
  } catch (error) {
    console.error('media references scan failed', mediaId, error)
    return Response.json({ error: 'Scan failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
