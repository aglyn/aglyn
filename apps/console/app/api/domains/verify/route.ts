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
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { promises as dns, Resolver as CallbackResolver } from 'dns'

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i

/**
 * Resolve against public resolvers rather than the runtime's default (AGL-734).
 *
 * A stale zone left over from a nameserver migration made Vercel's own resolver
 * return NXDOMAIN for records that every public resolver could see — so a
 * correctly-configured domain reported "no CNAME record found" indefinitely,
 * while `dig` from anywhere else resolved it fine. Pinning the resolver makes
 * the check depend on public DNS, which is what the customer's browser will use
 * anyway, instead of on whatever cache a given lambda inherited.
 *
 * Falls back to the default resolver if the pinned ones are unreachable, so a
 * blocked egress path degrades to today's behaviour rather than failing shut.
 */
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8']

async function resolveCnameRecords(domain: string): Promise<string[]> {
  const normalise = (records: string[]) =>
    records.map((record) => record.toLowerCase().replace(/\.$/, ''))
  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_RESOLVERS)
    const records = await new Promise<string[]>((resolve, reject) => {
      resolver.resolveCname(domain, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      )
    })
    return normalise(records)
  } catch (error) {
    // ENOTFOUND/ENODATA are real answers — the name has no CNAME. Only fall
    // back when the pinned resolvers could not be reached at all.
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      return []
    }
    try {
      return normalise(await dns.resolveCname(domain))
    } catch {
      return []
    }
  }
}

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
 * `CNAME_TARGET` mirrors the wizard's own fallback so a missing env var fails
 * closed rather than disabling the check.
 */
const CNAME_TARGET = (
  process.env['NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME'] ?? 'sites.aglyn.app'
).toLowerCase()
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
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const { query } = await pluginRequestFromWeb(request)
  const domain = String(query['domain'] ?? '')
    .trim()
    .toLowerCase()
  if (!DOMAIN_PATTERN.test(domain)) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 })
  }
  // NXDOMAIN / no CNAME comes back as an empty list — reported as unverified.
  const records = await resolveCnameRecords(domain)
  // Local dev has no DNS pointing at the tenant edge, so any CNAME is a soft
  // pass there. On Vercel the target must match exactly (AGL-733).
  const softPass = !process.env.VERCEL
  const verified =
    records.includes(CNAME_TARGET) || (softPass && records.length > 0)
  return Response.json({
    domain,
    records,
    expected: CNAME_TARGET,
    verified,
  }, { status: 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
