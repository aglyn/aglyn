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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  connectHostCustomDomain,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  validatePlatformDomain,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Attaches a verified custom domain to the tenant deployment so SSL provisions
 * automatically (Custom Domain Self-Service). Degrades to 501 where the
 * deployment has no domain provider — the wizard treats that as "DNS
 * connected, platform attachment pending". Auth: Firebase ID token; the caller
 * must be an admin of the host.
 */

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  // The claim/attach correspondence starts HERE, before anything is claimed
  // (AGL-1430, AGL-1311 §5.2).
  //
  // The attach below tolerates a name already registered. That is only safe
  // while every name the platform holds on the tenant project is covered by
  // the Firestore claim, and TWO families of name were not:
  //
  //  - `{subdomain}.{TENANT_APEX}`, attached as a 307 redirect by AGL-1273 on
  //    every custom-domain connect. Indexed on `hosts.subdomain`, so
  //    `where('cname','==',…)` cannot see it.
  //  - The platform's own redirect names — `www.aglyn.com`, `aglyn.app`,
  //    `aglyn.io` — which are project domains and nobody's `cname`.
  //
  // Claiming either walked the entire happy path: no duplicate, tolerated 409,
  // `projectDomainStatus` truthfully `serving` because the name really is on
  // our project, pending flag cleared, green tick — and then this route pointed
  // the claimant's OWN `{sub}.aglyn.app` at it as a 307, so their visitors
  // landed on a stranger's site and their own site was served nowhere. Measured
  // reachable with no twin at all; the memo's "safe today" was wrong.
  //
  // Refusing the reserved names restores the correspondence by construction:
  // what remains attachable is exactly the set the claim transaction indexes.
  // The check is shared with the console-domain path rather than restated, so
  // a name added to one blocklist is added to both.
  //
  // This is also the pattern check `liveCustomDomain` records as missing here —
  // the route "lowercases and trims what the wizard sends but never
  // pattern-checks it, so a junk value can reach Firestore".
  const { domain, error: invalidDomain } = validatePlatformDomain(
    String(body?.domain ?? ''),
    {
      invalid: 'Enter a valid domain, for example example.com',
      reserved:
        'That domain is reserved by the platform and cannot be connected to a site',
    },
  )
  const hostId = String(body?.hostId ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing domain or hostId' }, { status: 400 })
  }
  if (!domain) {
    return Response.json({ error: invalidDomain }, { status: 400 })
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
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // "Manage site settings" (`site.manage`, AGL-4047).
    if (!holdsSiteKey(hostSnapshot, decoded.uid, 'site.manage')) {
      return Response.json({ error: siteKeyRefusal('site.manage') }, { status: 403 })
    }

    // Plan gate (AGL-469): custom domains are a Starter+ entitlement; a
    // plan-less org resolves as `free` and is denied.
    const org = (await getOrgForHost(hostId))?.org ?? {}
    // Lockdown verdict (AGL-1506): platform/org/host/user scopes with the
    // docs already in hand; distinct 423 body; staff bypass is the
    // un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked
    if (!checkEntitlement(org, 'customDomain')) {
      return Response.json({
        error: 'Custom domains require a Starter plan',
      }, { status: 403 })
    }

    // Cname uniqueness (AGL-166), the attach, its status probe, the edge
    // redirect, the activity entry and the plugin event all live in
    // `connectHostCustomDomain` (AGL-3961), so a plugin that bought the name
    // connects it through exactly this claim. Authorization stays here: the
    // admin role, lockdown and the plan were checked above.
    const connected = await connectHostCustomDomain({
      hostId,
      domain,
      actor: {
        uid: decoded.uid,
        email: decoded.email ? String(decoded.email) : null,
      },
    })
    if (connected.ok === 'refused') {
      return Response.json(
        connected.state
          ? { error: connected.error, state: connected.state }
          : { error: connected.error },
        { status: connected.status },
      )
    }
    return Response.json({
      attached: true,
      // The wizard renders these rather than a bare tick: which of "still
      // issuing", "prove ownership", and "DNS points elsewhere" it is.
      state: connected.state,
      verification: connected.verification,
      conflicts: connected.conflicts,
    }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Attach failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
