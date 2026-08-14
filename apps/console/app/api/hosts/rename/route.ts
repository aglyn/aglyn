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
  isBlockedSubdomain,
  pluginRequestFromWeb,
  SUBDOMAIN_PATTERN,
  suggestSubdomains,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  syncHostProjectionForMembers,
} from '@aglyn/tenant-data-admin'

/**
 * Change a site's subdomain (AGL-642). Site-admin only.
 *
 * The subdomain is the site's public address, so it is an identity key:
 * taking a reserved name shadows platform routing, and colliding with
 * another org's site makes `where('subdomain','==',…)` resolution ambiguous
 * — a live-site takeover. Enforcement therefore has to be server-side.
 * Previously the Setup page validated through /api/hosts/validate-name and
 * then wrote `subdomain` straight from the browser, with the validation
 * explicitly advisory ("the save proceeds" on failure) and the rules not
 * guarding the key — so the checks were bypassable outright.
 *
 * Uniqueness is claimed inside a transaction rather than a read-then-write,
 * so two concurrent renames can't both land on the same subdomain.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  const subdomain = String(body?.subdomain ?? '').trim().toLowerCase()
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    return Response.json({
      error:
        'Subdomains are 3-30 characters, lowercase letters, numbers and ' +
        'hyphens, starting with a letter or number.',
    }, { status: 400 })
  }
  if (isBlockedSubdomain(subdomain)) {
    return Response.json({
      error: 'That subdomain is reserved.',
      suggestions: suggestSubdomains(subdomain),
    }, { status: 409 })
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
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // Renaming changes the site's public address, so it is admin-level —
    // the same gate the rules apply to deletion, not the editor-level gate
    // that content writes use.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (decoded['staff'] !== true && memberRole !== 'admin') {
      return Response.json({
        error: 'Changing the subdomain requires the site admin role',
      }, { status: 403 })
    }

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes; distinct
    // 423 body; staff bypass is the un-panic invariant. The org doc is
    // fetched deliberately — an org lock never stamps host docs, so a
    // host-only verdict would silently miss it.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    const previous = (hostSnapshot.get('subdomain') as string | undefined) ?? null
    if (previous === subdomain) return Response.json({ ok: true, subdomain }, { status: 200 })

    const claimed = await firestore.runTransaction(async (tx) => {
      const taken = await tx.get(
        firestore.collection('hosts').where('subdomain', '==', subdomain).limit(2),
      )
      if (taken.docs.some((host) => host.id !== hostId)) return false
      tx.set(
        hostRef,
        {
          subdomain,
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      // Keep the routing mirror in step. `registerOrgHost` seeds
      // hostIndex.subdomain on create, but neither the staff retarget nor
      // the old client rename maintained it, so it silently drifted.
      tx.set(
        firestore.collection('hostIndex').doc(hostId),
        { subdomain },
        { merge: true },
      )
      return true
    })

    if (!claimed) {
      return Response.json({
        error: 'That subdomain is taken.',
        suggestions: suggestSubdomains(subdomain),
      }, { status: 409 })
    }

    // Propagate the new subdomain into every member's hostMemberships row
    // (AGL-844) so switcher navigation targets the current address. Best-
    // effort — a miss self-heals on the next membership change or backfill.
    const orgId = hostSnapshot.get('orgId') as string | undefined
    if (orgId) {
      await syncHostProjectionForMembers(orgId, hostId).catch(() => undefined)
    }

    await firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'host.set-subdomain',
        target: `hosts/${hostId}`,
        before: { subdomain: previous },
        after: { subdomain },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json({ ok: true, subdomain }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Rename failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
