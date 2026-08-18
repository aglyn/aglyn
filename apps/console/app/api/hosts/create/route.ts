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
  pluginRequestFromWeb,
  resolveIdpDisplayName,
} from '@aglyn/aglyn/server'
import {
  canManageOrg,
  checkQuota,
  createResourceUid,
  isBlockedSubdomain,
  SUBDOMAIN_PATTERN,
  suggestSubdomains,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  ensureOrgForUser,
  firebaseAdmin,
  isImpersonationSession,
  lockdownRefusal,
  registerOrgHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/**
 * Creates a host (user request 2026-07-07 — the hosts page had no create
 * flow). Server-side because the scoped Firestore rules only admit
 * admin-constrained host queries, so a client can't check subdomain
 * uniqueness; the hostLimit quota is enforced here too (plan-gated per
 * AGL-38: workspaces without a plan are uncapped).
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const displayName = String(body?.displayName ?? '')
    .trim()
    .slice(0, 80)
  const subdomain = String(body?.subdomain ?? '')
    .trim()
    .toLowerCase()
  if (!displayName) {
    return Response.json({ error: 'Missing display name' }, { status: 400 })
  }
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    return Response.json({
      error: 'Subdomain must be 3–30 lowercase letters, digits, or dashes',
    }, { status: 400 })
  }
  // Shared reserved + profanity policy (AGL-147).
  if (isBlockedSubdomain(subdomain)) {
    return Response.json({ error: 'That subdomain is not available' }, { status: 409 })
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
    // Org resolution (AGL-233): hosts belong to an organization. The org
    // comes from the request (workspace context) or the user's first org,
    // auto-creating a personal org for brand-new accounts. Creating hosts
    // is an org admin/owner power.
    const requestedOrgId = String(body?.orgId ?? '') || null
    const orgMembership = requestedOrgId
      ? await resolveOrgMembership(decoded.uid, requestedOrgId)
      : await ensureOrgForUser(decoded.uid, {
          email: decoded.email ?? null,
          // AGL-1131. `ensureOrgForUser` NAMES the workspace from this, so an
          // SSO user creating their first site got a workspace named after
          // their email local part instead of themselves.
          displayName: resolveIdpDisplayName(decoded) || null,
        })
    if (!orgMembership) {
      return Response.json({ error: 'You are not a member of that organization' }, { status: 403 })
    }
    if (!canManageOrg(orgMembership.member.role)) {
      return Response.json({ error: 'Your organization role does not allow creating sites' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()

    const taken = await firestore
      .collection('hosts')
      .where('subdomain', '==', subdomain)
      .limit(1)
      .get()
    if (!taken.empty) {
      // Offer available alternatives (AGL-147): name-2, name-<year>, …
      const suggestions: string[] = []
      for (const candidate of suggestSubdomains(subdomain)) {
        const candidateTaken = await firestore
          .collection('hosts')
          .where('subdomain', '==', candidate)
          .limit(1)
          .get()
        if (candidateTaken.empty) suggestions.push(candidate)
      }
      return Response.json({ error: 'That subdomain is taken', suggestions }, { status: 409 })
    }

    // Site quota rides the org doc (AGL-238), counted per org.
    const orgSnapshot = await firestore
      .collection('orgs')
      .doc(orgMembership.orgId)
      .get()
    const org = orgSnapshot.data()

    // Lockdown verdict (AGL-1506): platform/org/user scopes with the org
    // doc already in hand (no host exists yet to have a scope); distinct
    // 423 body; staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
    })
    if (locked) return locked

    // Enforced for every org — a plan-less org resolves as `free`
    // (hostLimit 1), not unmetered.
    //
    // COUNTED AND CLAIMED IN ONE TRANSACTION (AGL-2063). This used to be an
    // aggregation `count()` followed by an unconditional `.set()` on a fresh
    // random id, which is the create-time-quota shape AGL keeps relearning: N
    // concurrent POSTs all read `count: 0`, all pass, and all create. A free
    // org walked away with N sites for a `hostLimit` of 1, and every one of
    // them costs `INFRA_COGS_PER_SITE_USD` a month with no invoice behind it.
    //
    // The transaction reads `orgs/{id}.hosts` — the directory map
    // `registerOrgHost` maintains and `erase` prunes — and the count is the
    // LARGER of that map and the pre-read aggregation. Neither alone is
    // enough, and the reason each is here is different:
    //
    // - The aggregation is authoritative for history. An org whose sites
    //   predate the directory map would otherwise read as zero and be handed
    //   a free extra site.
    // - The map is authoritative for CONCURRENCY, because it is written
    //   inside this same transaction. The loser of a race re-reads it on
    //   retry, sees the winner's id, and is refused — which the aggregation,
    //   read before the transaction opened, can never do.
    const hostId = createResourceUid()
    const preCount = (
      await firestore
        .collection('hosts')
        .where('orgId', '==', orgMembership.orgId)
        .count()
        .get()
    ).data().count
    const orgRef = firestore.collection('orgs').doc(orgMembership.orgId)
    const hostRef = firestore.collection('hosts').doc(hostId)
    const claim = await firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(orgRef)
      const directory = fresh.get('hosts')
      const mapped =
        directory && typeof directory === 'object'
          ? Object.values(directory as Record<string, unknown>).filter(Boolean)
              .length
          : 0
      const quota = checkQuota(
        (fresh.data() ?? org) as any,
        'hostLimit',
        Math.max(preCount, mapped),
      )
      if (!quota.allowed) return { allowed: false as const, limit: quota.limit }
      tx.set(hostRef, {
        displayName,
        subdomain,
        orgId: orgMembership.orgId,
        screens: {},
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      // The claim itself. `set(…, { merge: true })` deep-merges the map, so
      // this adds one key without disturbing the org's other fields — and it
      // is what makes a concurrent create see this site on its retry.
      // `registerOrgHost` below writes the same key again, idempotently.
      tx.set(
        orgRef,
        {
          hosts: { [hostId]: true },
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return { allowed: true as const, limit: quota.limit }
    })
    if (!claim.allowed) {
      return Response.json({
        error:
          `Site limit reached (${claim.limit}) — upgrade or add extra ` +
          'sites from Billing',
      }, { status: 403 })
    }
    // Org directory + hostIndex mirror + memberRoles projection (AGL-233).
    await registerOrgHost(orgMembership.orgId, hostId, subdomain)
    // No starter seeding here (AGL-687). Starters render from the code
    // definitions and are copied in only when a user uses or edits one, so a
    // new site starts with an empty library and still gets every later
    // improvement to the starters it has not touched.
    // orgSlug lets the client route to /[orgSlug]/hosts/[host]/setup even when
    // the workspace was just auto-created for a first-time user (AGL-621), and
    // the route is keyed by the SUBDOMAIN, not the doc id (AGL-622) — so hand
    // back the subdomain too rather than making the caller guess.
    return Response.json(
      {
        hostId,
        subdomain,
        orgId: orgMembership.orgId,
        orgSlug: org?.['slug'] ?? null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Site creation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
