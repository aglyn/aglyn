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
  getOrgDoc,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { resolveOrgMediaBand } from '../../../../utils/server/media-storage-band'
import { scopeBillsStorageOverage } from '../../../../utils/storage-overage'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/** The library a band request names, and the org whose pool it reads. */
interface StorageReader {
  collection: 'hosts' | 'orgs'
  /** Host or org id — the library whose share is `scopeBytes`. */
  scopeId: string
  /** The OWNING org; empty for a site that has none. */
  orgId: string
  /** The owning org's doc — the plan, and the lockdown verdict's org scope. */
  org: Record<string, unknown>
  /** The site's doc on a site scope — the verdict's host scope. */
  host?: Record<string, unknown>
}

/**
 * Who may read the band, and of which org (AGL-3482).
 *
 * The bar is MEMBERSHIP, not the editor role uploading asks for. What this
 * answers is a count of bytes the caller's own console already shows them: the
 * rules let any member of an org read `orgs/{orgId}/counters`, and any member of
 * a site — viewers included — read the site's library and its counters. A
 * viewer opens Billing and the media library like anyone else, and refusing
 * them here left Billing's storage meter "not yet metered" and the banner with
 * no storage row.
 *
 * The pool read is always one the caller belongs to. The org scope proves
 * membership in the org it names; a site scope proves membership on the SITE
 * and takes the org from the site's own index entry, never from an id in the
 * request. Naming both answers for the org alone, as the ingress resolver does.
 */
async function resolveStorageReader(
  query: Partial<Record<string, string | string[]>>,
  uid: string,
): Promise<{ reader?: StorageReader; error?: Response }> {
  const orgId = String(query['orgId'] ?? '') || null
  const hostId = String(query['hostId'] ?? '') || null
  if (orgId) {
    const membership = await resolveOrgMembership(uid, orgId)
    if (!membership) {
      return {
        error: Response.json(
          { error: 'Not a member of this organization' },
          { status: 403 },
        ),
      }
    }
    return {
      reader: {
        collection: 'orgs',
        scopeId: orgId,
        orgId,
        org: ((await getOrgDoc(orgId)) ?? {}) as Record<string, unknown>,
      },
    }
  }
  if (!hostId) {
    return {
      error: Response.json({ error: 'Missing hostId or orgId' }, { status: 400 }),
    }
  }
  const hostSnapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .get()
  if (!hostSnapshot.exists) {
    return { error: Response.json({ error: 'Unknown site' }, { status: 404 }) }
  }
  // Any role at all, as the rules' `isHostMember` — `memberRoles` holds no
  // entry for someone who is not on the site.
  if (!(hostSnapshot.get('memberRoles') ?? {})[uid]) {
    return {
      error: Response.json({ error: 'Not a member of this site' }, { status: 403 }),
    }
  }
  const resolvedOrg = await getOrgForHost(hostId)
  return {
    reader: {
      collection: 'hosts',
      scopeId: hostId,
      orgId: resolvedOrg?.orgId ?? '',
      org: (resolvedOrg?.org ?? {}) as Record<string, unknown>,
      host: hostSnapshot.data(),
    },
  }
}

/**
 * The org's media storage band, as the library's toolbar, the Billing meter
 * and the quota banner state it (AGL-3470, AGL-3479).
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
 * A READ, gated as one (AGL-3482): any member of the library's org or site may
 * ask — see `resolveStorageReader` — and the lockdown verdict takes its intent
 * from the method, so a read-only lock lets it through and a full one does not.
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
    const { reader, error } = await resolveStorageReader(query, decoded.uid)
    if (!reader) {
      return error ?? Response.json({ error: 'Bad request' }, { status: 400 })
    }
    // Lockdown verdict (AGL-1506) on the org and site docs already in hand.
    // The intent comes from the method — this handler answers GET alone and
    // writes nothing — so a read-only lock passes it and a full lock refuses.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: reader.org,
      host: reader.host,
    })
    if (locked) return locked
    // A site with no owning org has no pool to read; the console then shows
    // the library's own total and no cap, as it did before this route.
    if (!reader.orgId) {
      return Response.json({ error: 'No organization' }, { status: 404 })
    }
    const org = reader.org as Parameters<typeof planMetersInfraOverage>[0]
    const band = await resolveOrgMediaBand({
      firestore: firebaseAdmin.app().firestore(),
      orgId: reader.orgId,
      org,
      currentHostId: reader.collection === 'hosts' ? reader.scopeId : null,
    })
    const unlimited = !Number.isFinite(band.allowanceMb)
    return Response.json(
      {
        // `null` + the flag rather than `Infinity`, which JSON writes as
        // `null` anyway — the client rebuilds it with `restoreQuotaLimit`.
        allowanceMb: unlimited ? null : band.allowanceMb,
        unlimited,
        usedBytes: band.usedBytes,
        scopeBytes: band.byScope[`${reader.collection}/${reader.scopeId}`] ?? 0,
        hardBand:
          !planMetersInfraOverage(org) ||
          !scopeBillsStorageOverage(reader.collection),
      },
      // One org's figures, for one member: never held by a shared cache.
      { status: 200, headers: { 'Cache-Control': 'no-store, private' } },
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
