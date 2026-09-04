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
  isBlockedSubdomain,
  SUBDOMAIN_PATTERN,
  suggestSubdomains,
} from '@aglyn/aglyn/server'
import {
  consumeRateLimit,
  emailUnverifiedResponse,
  ensureOrgForUser,
  firebaseAdmin,
  freeWorkspaceCapRefusalResponse,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  claimHostForOrg,
  findSubdomainConflict,
} from '../../../../utils/server/provision-host'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'

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
    // The granular permission, not the raw role (AGL-2350). Identical for the
    // built-in roles — `hosts.create` is in ALL_PERMISSIONS for owner/admin
    // and absent from the editor and viewer defaults, exactly what
    // `canManageOrg` answered — but it additionally honours a custom role or
    // a per-member override, which is the narrowing
    // `run-an-agency-workspace.md` sells and this gate silently ignored.
    if (!(await memberHasOrgPermission(
        orgMembership.orgId,
        orgMembership.member,
        'hosts.create',
      ))) {
      return Response.json({ error: 'Your organization role does not allow creating sites' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()

    // Shared with `POST /v1/sites` (AGL-2465). Offers available alternatives
    // (AGL-147): name-2, name-<year>, …
    const conflict = await findSubdomainConflict(firestore, subdomain)
    if (conflict) {
      return Response.json(
        { error: 'That subdomain is taken', suggestions: conflict.suggestions },
        { status: 409 },
      )
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

    // Rate limit (AGL-1968) — the always-on layer under the hostLimit quota.
    // `*.aglyn.app` is ONE global namespace shared by every customer, so a
    // subdomain someone squats is gone for everybody. The quota below bounds
    // how many sites an org may HOLD; nothing bounded how fast it could try,
    // and on open-signup day that is a name-grab at whatever rate Vercel will
    // serve. Same durable limiter as every other consequence endpoint
    // (AGL-794), keyed per uid (a scripted account) AND per IP (a bot farm
    // rotating accounts behind one address).
    //
    // Sized to be invisible to real use and fatal to a sweep: the most sites a
    // person creates by hand in an hour is a handful, and an agency onboarding
    // a client does it once per client.
    //
    // Fails soft by design — a limiter outage must not stop people making
    // sites. Deliberately AFTER the 401/403/423 refusals, matching
    // `orgs/create`: they win the order, and a refused request never burns a
    // token.
    const ip = readClientIp(headers)
    const perUid = await consumeRateLimit(`host-create:${decoded.uid}`, {
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })
    // Skipped when no address is readable, and the per-uid cap above carries
    // the control alone. A shared `host-create-ip:unknown` bucket would cap
    // every account on the install at sixty sites an hour between them, which
    // is a name-grab defense that grabs the names from its own customers.
    const perIp = ip
      ? await consumeRateLimit(`host-create-ip:${ip}`, {
          limit: 60,
          windowMs: 60 * 60 * 1000,
        })
      : null
    // `.allowed`, not the result object — a truthiness check would be
    // permanently true and the limit would never bite.
    const overLimit = !perUid.allowed ? perUid : perIp && !perIp.allowed ? perIp : null
    if (overLimit) {
      return Response.json(
        {
          error:
            'Too many new sites in a short time — wait a while and try ' +
            'again. The name you typed is kept.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.max(1, Math.ceil((overLimit.resetMs - Date.now()) / 1000)),
            ),
          },
        },
      )
    }

    // Enforced for every org — a plan-less org resolves as `free`
    // (hostLimit 1), not unmetered. Counted and claimed in ONE transaction
    // (AGL-2063), then the org directory, hostIndex mirror and memberRoles
    // projection. Shared verbatim with `POST /v1/sites` (AGL-2465); the
    // reasoning for the count being the larger of the directory map and the
    // pre-read aggregation now lives with the code, in
    // utils/server/provision-host.ts.
    const claim = await claimHostForOrg({
      firestore,
      orgId: orgMembership.orgId,
      displayName,
      subdomain,
      org,
    })
    // Lost the subdomain to a concurrent create between the pre-check above
    // and the transaction's commit (AGL-2465). The console has no idempotency
    // key, so this is the only thing standing between a double-submit and two
    // sites on one address. Same 409 body the pre-check returns, so the Setup
    // page's existing handling covers it with no client change.
    if (!claim.allowed && claim.conflict === true) {
      return Response.json(
        {
          error: 'That subdomain is taken',
          suggestions: suggestSubdomains(subdomain),
        },
        { status: 409 },
      )
    }
    if (!claim.allowed) {
      return Response.json({
        error:
          `Site limit reached (${claim.limit}) — upgrade or add extra ` +
          'sites from Billing',
      }, { status: 403 })
    }
    const hostId = claim.hostId
    // The site's own first entry (AGL-118). Provisioning is exactly the class
    // of act the activity log never covered: the console's mutation points
    // wrote every save and delete, and nothing wrote the creates, so a site
    // built and then left alone had an empty feed and read as untouched.
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null },
      'Created the site',
      { type: 'host', id: hostId, name: displayName },
    )
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
        // The third org-creation door reports itself (AGL-2587). This route
        // auto-provisions a workspace for an account that holds none, and
        // nothing counted those: `org_created` is a browser event and the
        // creation happens here, on the server, where there is no gtag and no
        // consent state to consult. So the fact travels back in the response
        // and the caller emits it through the same consent-gated transport as
        // every other event.
        orgCreated: orgMembership.created === true,
      },
      { status: 200 },
    )
  } catch (error) {
    // AGL-2265. This route can create a workspace on the way to creating a
    // site (`ensureOrgForUser` for an account that holds none), so the
    // free-workspace ceiling is reachable from here too. Answering with the
    // ceiling's own copy beats a 500 that says "Site creation failed" when
    // the site was never the problem.
    const capped = freeWorkspaceCapRefusalResponse(error)
    if (capped) return capped
    console.error(error)
    return Response.json({ error: 'Site creation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
