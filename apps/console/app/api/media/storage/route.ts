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

import { planMetersInfraOverage, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { resolveMediaScope } from '../../../../utils/server/media-scope'
import { resolveOrgMediaBand } from '../../../../utils/server/media-storage-band'
import { scopeBillsStorageOverage } from '../../../../utils/storage-overage'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The org's media storage band, as the library's toolbar states it (AGL-3470).
 *
 * The band is ORG-WIDE (AGL-2075): every site's library and the org's shared
 * one count against `hostLimit × storagePerHostMb`. The browser cannot add
 * that up itself — a member reads the counters of the sites they belong to,
 * and an owner who was never added to a site cannot read that site's at all —
 * so a client sum would come out low exactly where it matters. This answers
 * with `resolveOrgMediaBand`, the function every ingress route gates on, so
 * the figure on screen and the figure an upload is refused at are one number.
 *
 * `scopeBytes` is the open library's share from the same read, which lets the
 * console keep the pooled total live off the one counter it already listens
 * to rather than calling here again after every upload.
 *
 * `hardBand` mirrors `mediaStorageGate`'s refusing arm: past the band an
 * unmetered plan, or a library whose storage does not reach the invoice yet,
 * is refused rather than billed. The console's pre-check refuses only then, so
 * it can never turn away a paid upload the server would accept.
 *
 * Scope resolution is the ingress routes' own (`resolveMediaScope`): whoever
 * may upload into this library may see the band it uploads against.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
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
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`.
    const { scope, error } = await resolveMediaScope(undefined, query, decoded.uid, {
      staff: decoded['staff'] === true,
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
      )
    }
    // A site with no owning org has no pool to read; the console then shows
    // the library's own total and no cap, as it did before this route.
    if (!scope.orgId) {
      return Response.json({ error: 'No organization' }, { status: 404 })
    }
    const org = scope.billing as Parameters<typeof planMetersInfraOverage>[0]
    const band = await resolveOrgMediaBand({
      firestore: scope.scopeRef.firestore,
      orgId: scope.orgId,
      org,
      currentHostId: scope.collection === 'hosts' ? scope.scopeId : null,
    })
    const unlimited = !Number.isFinite(band.allowanceMb)
    return Response.json(
      {
        // `null` + the flag rather than `Infinity`, which JSON writes as
        // `null` anyway — the client rebuilds it with `restoreQuotaLimit`.
        allowanceMb: unlimited ? null : band.allowanceMb,
        unlimited,
        usedBytes: band.usedBytes,
        scopeBytes: band.byScope[`${scope.collection}/${scope.scopeId}`] ?? 0,
        hardBand:
          !planMetersInfraOverage(org) ||
          !scopeBillsStorageOverage(scope.collection),
      },
      { status: 200 },
    )
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Storage lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
