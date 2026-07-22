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
  registerOrgHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import seedStarterTemplates, {
  type SeedFirestore,
} from '../../../../utils/server/seed-starter-templates'

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
          displayName: (decoded['name'] as string | undefined) ?? null,
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
    {
      // Enforced for every org — a plan-less org resolves as `free`
      // (hostLimit 1), not unmetered.
      const owned = await firestore
        .collection('hosts')
        .where('orgId', '==', orgMembership.orgId)
        .count()
        .get()
      const quota = checkQuota(
        org as any,
        'hostLimit',
        owned.data().count,
      )
      if (!quota.allowed) {
        return Response.json({
          error:
            `Site limit reached (${quota.limit}) — upgrade or add extra ` +
            'sites from Billing',
        }, { status: 403 })
      }
    }

    const hostId = createResourceUid()
    await firestore
      .collection('hosts')
      .doc(hostId)
      .set({
        displayName,
        subdomain,
        orgId: orgMembership.orgId,
        screens: {},
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    // Org directory + hostIndex mirror + memberRoles projection (AGL-233).
    await registerOrgHost(orgMembership.orgId, hostId, subdomain)
    // First-party starters land in the new site's template library (AGL-687)
    // so "start from a template" has something in it on day one. Best-effort:
    // a site with no starters is a working site, and the gallery re-runs the
    // same idempotent seed when it opens.
    await seedStarterTemplates(
      firestore as unknown as SeedFirestore,
      hostId,
      { now: firebaseAdmin.firestore.Timestamp.now() },
    ).catch((error) => {
      console.error('Starter seed failed for new host', hostId, error)
    })
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
