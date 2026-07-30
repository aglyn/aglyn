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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Pre-auth SSO discovery (AGL-1101). The sign-in page has no user yet, so it
 * asks this route "does this email domain sign in via an IdP?" before deciding
 * whether to run the SAML redirect. Returns only the non-secret routing facts
 * the client needs — the org's GCIP `tenantId` + `providerId` — from a public
 * `ssoDomains/{domain}` doc the staff SSO flow writes (mirrors the `orgSlugs`
 * pattern the middleware reads pre-auth). No token/plan data leaks: a domain
 * with SSO off simply returns `{ ssoEnabled: false }`.
 *
 * The `ssoDomains` doc is the authority for what's live; it is written only
 * when the org is `ssoEnabled` + its `org.sso.status === 'active'` and cleared
 * when SSO is disabled, so this route need not re-check the entitlement.
 */
function domainOf(input: string): string {
  const raw = input.trim().toLowerCase()
  const at = raw.lastIndexOf('@')
  return (at >= 0 ? raw.slice(at + 1) : raw).replace(/^@+/, '')
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const url = new URL(request.url)
  const domain = domainOf(url.searchParams.get('email') ?? url.searchParams.get('domain') ?? '')
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return Response.json({ ssoEnabled: false }, { status: 200 })
  }
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('ssoDomains')
      .doc(domain)
      .get()
    const data = snapshot.data()
    if (!snapshot.exists || !data || data['active'] !== true) {
      return Response.json({ ssoEnabled: false }, { status: 200 })
    }
    return Response.json(
      {
        ssoEnabled: true,
        tenantId: data['tenantId'] ?? null,
        providerId: data['providerId'] ?? null,
        protocol: data['protocol'] ?? 'saml',
        displayName: data['displayName'] ?? null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[auth/sso-lookup] failed', error)
    // Fail closed to password/social sign-in — never block login on a lookup.
    return Response.json({ ssoEnabled: false }, { status: 200 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
