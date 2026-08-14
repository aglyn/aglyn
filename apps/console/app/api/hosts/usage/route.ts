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
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { countBillableScreens } from '../resources/count-billable-screens'

/**
 * Read-only usage counters that the client cannot compute correctly
 * (AGL-1177).
 *
 * Billing → Usage counted screens with a bare aggregation query, so it
 * charged for soft-deleted screens, email screens and collection template
 * screens — the three things `countBillableScreens` excludes for the quota
 * gate. The meter therefore over-reported against what enforcement actually
 * allows: a Starter site showed "10 / 25" where creation treated it as 8,
 * and deleting a screen never moved the number.
 *
 * The client cannot just filter it itself. Live screens have **no**
 * `deletedAt` field at all rather than an explicit null, and Firestore
 * cannot express "field is absent" in a query, so the compound aggregation
 * that would be needed is not available to the web SDK (which also has no
 * `select()` field mask, making a full read the only alternative — per host,
 * on a page that renders one meter set per host).
 *
 * So the server answers, reusing the exact helper the quota gate uses. One
 * source of truth: if the two ever disagree again it is a code change, not
 * a drift between two implementations of the same rule.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // Query param, not a body: a GET that carries one is dropped before it
  // leaves the browser, with no request and no status to debug.
  const hostId = String(query?.['hostId'] ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }

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

    // Whoever may read the site may read how much of the plan it uses. Host
    // membership covers editors and collaborators; the org fallback covers
    // the workspace admins who own billing but were never added to the site
    // itself — the people this page is actually for.
    const isHostMember = Boolean(
      (hostSnapshot.get('memberRoles') ?? {})[decoded.uid],
    )
    let allowed = isHostMember
    if (!allowed) {
      const orgId = await resolveOrgIdForHost(hostId)
      if (orgId) {
        const orgMember = await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .doc(decoded.uid)
          .get()
        allowed = orgMember.exists
      }
    }
    if (!allowed) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes; distinct
    // 423 body — API consumers see it on reads too. The org doc is fetched
    // deliberately (the fallback above reads a MEMBER doc, which carries no
    // suspension fields) — an org lock never stamps host docs, so a
    // host-only verdict would silently miss it. Staff bypass is the
    // un-panic invariant.
    const locked = await lockdownRefusal({
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    return Response.json(
      {
        // Same count the create route enforces, from the same routing map
        // (AGL-1383) — a usage number that disagreed with the gate would be
        // worse than none. The host snapshot above already holds it.
        screens: await countBillableScreens(hostRef, hostSnapshot.get('screens')),
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Usage lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
