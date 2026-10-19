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

import { isDevelopmentRuntime, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
// The leaf, not the barrel: the check is the route's whole behavior, and its
// spec substitutes the barrel.
import {
  checkTenantDnsPointing,
  TENANT_DNS_DOMAIN_PATTERN,
} from '@aglyn/tenant-data-admin/server/tenant-dns-check'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — advisory DNS lookup with no org/host doc in reach (domain string
// only); the attach mutation carries the gate.

/**
 * DNS verification for the connect-a-domain wizard (Custom Domain
 * Self-Service): resolves the domain's CNAME chain and reports whether it
 * points at the tenant edge.
 *
 * Reads the SAME variable the wizard shows the customer
 * (`NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME`, AGL-733). It previously read a
 * server-only `AGLYN_TENANT_HOST_CNAME`, so the displayed target and the
 * verified target were configured independently — and when the server one was
 * unset in production the check silently degraded to "any CNAME passes",
 * meaning a domain pointed anywhere at all verified successfully.
 *
 * The soft pass is deliberate but belongs to local dev only, where there is no
 * real DNS pointing at the tenant edge. Off Vercel it still accepts any CNAME
 * so the flow stays testable; on Vercel the target must match exactly.
 * The check itself is `checkTenantDnsPointing`, whose `CNAME_TARGET` is the
 * one the wizard prints (`tenant-dns-targets.ts`), so a missing env var fails
 * closed rather than disabling the check AND the two surfaces cannot be
 * configured apart (AGL-733, AGL-1275).
 */
async function handler(request: Request): Promise<Response> {
  // Require an authenticated console user (AGL-513): this backs the
  // connect-a-domain wizard, not a public DNS lookup service.
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
  } catch (error) {
    // A refused credential is a 401 (AGL-1993). A check that could not run is
    // ours, so it is a 500 rather than a request to sign in again.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[domains/verify] token verification failed', error)
    return Response.json({ error: 'Could not check your sign-in' }, { status: 500 })
  }

  const { query } = await pluginRequestFromWeb(request)
  const domain = String(query['domain'] ?? '')
    .trim()
    .toLowerCase()
  if (!TENANT_DNS_DOMAIN_PATTERN.test(domain)) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 })
  }
  // Local dev has no DNS pointing at the tenant edge, so any CNAME is a soft
  // pass there. Anywhere else the target must match exactly (AGL-733).
  //
  // This was `!process.env.VERCEL` (AGL-2180). On a self-host container VERCEL
  // is never set, so the soft pass was ON in production and ANY domain with
  // ANY CNAME verified — the exact defect AGL-733 exists to prevent, one line
  // below the comment saying so, reinstated on every self-host install. A user
  // of an operator's platform could claim a domain they do not control.
  //
  // `isDevelopmentRuntime` and not `!isDeployedRuntime`, deliberately: a
  // relaxation must key on the variable that means "not production", not on
  // the absence of a hosting vendor's. A security check that loosens because
  // it cannot find an env var is failing open on an unrelated axis.
  const check = await checkTenantDnsPointing(domain, {
    softPass: isDevelopmentRuntime(),
  })
  return Response.json(check, { status: 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
