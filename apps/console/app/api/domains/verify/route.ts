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

async function resolveARecords(domain: string): Promise<string[]> {
  const lookup = async (resolver?: CallbackResolver) =>
    resolver
      ? new Promise<string[]>((resolve, reject) => {
          resolver.resolve4(domain, (error, addresses) =>
            error ? reject(error) : resolve(addresses),
          )
        })
      : dns.resolve4(domain)
  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_RESOLVERS)
    return await lookup(resolver)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      return []
    }
    try {
      return await lookup()
    } catch {
      return []
    }
  }
}

/**
 * An apex (`aglyn.com`) cannot carry a CNAME — RFC 1034 forbids one alongside
 * the SOA/NS records every zone apex must have. So the CNAME check below can
 * never pass for a bare domain, and until this existed the wizard simply
 * refused every apex: customers could connect `www.` and nothing else.
 *
 * Instead, compare where the domain actually lands against where the CNAME
 * target lands. Both sides are resolved at check time rather than compared to
 * a hardcoded address list, because the edge IPs behind `sites.aglyn.app` are
 * the host's to change — pinning them here would turn a routine infrastructure
 * change into every customer's domain reporting itself broken.
 *
 * An intersection, not equality: the two names legitimately return different
 * subsets of the same anycast pool from one lookup to the next.
 *
 * `HOST_APEX_ADDRESSES` covers the case the intersection cannot: our platform
 * host publishes a small anycast pool for every apex it serves, routing by
 * `Host` rather than by IP. An apex pointed there therefore never shares an
 * address with `sites.aglyn.app`, yet is configured correctly.
 *
 * The list has to span the host's WHOLE pool, not just the address we happen
 * to have used. It shipped with only `76.76.21.21` — the host's legacy
 * address, which still resolves but is no longer what a newly-pointed apex
 * lands on, so every new customer would have failed the very check this
 * fallback exists to let them pass. Our own zones are the proof: after taking
 * the host's recommended records, `aglyn.com` and `aglyn.io` resolve into the
 * `216.198.79.x` / `64.29.17.x` range and not one of them is the legacy
 * address. Keep the legacy entry — zones still pointed at it work fine.
 *
 * Accepting an address match is deliberately a weaker claim — "this domain
 * resolves to our platform" rather than "to this account". That is sound
 * because it is not the ownership check: attaching a domain to the project is,
 * and the platform performs that itself. This only answers "has DNS been
 * pointed yet", which is what the customer is actually stuck on. Configurable
 * so the next range expansion is an env edit rather than a patch.
 */
const HOST_APEX_ADDRESSES = (
  process.env['AGLYN_TENANT_APEX_ADDRESSES'] ??
  '216.198.79.1,216.198.79.65,64.29.17.1,64.29.17.65,76.76.21.21'
)
  .split(',')
  .map((address) => address.trim())
  .filter(Boolean)

async function apexPointsAtTenantEdge(domain: string): Promise<boolean> {
  const [domainAddresses, targetAddresses] = await Promise.all([
    resolveARecords(domain),
    resolveARecords(CNAME_TARGET),
  ])
  if (!domainAddresses.length) return false
  const acceptable = new Set([...targetAddresses, ...HOST_APEX_ADDRESSES])
  return domainAddresses.some((address) => acceptable.has(address))
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
  const cnameVerified =
    records.includes(CNAME_TARGET) || (softPass && records.length > 0)
  // Only fall back to the address comparison when there is no CNAME at all.
  // A domain that DOES carry a CNAME but points somewhere else must keep
  // failing — otherwise "pointed at the wrong place" and "pointed at an apex"
  // would verify identically.
  const apexVerified = !records.length && (await apexPointsAtTenantEdge(domain))
  return Response.json({
    domain,
    records,
    expected: CNAME_TARGET,
    verified: cnameVerified || apexVerified,
    // Which rule passed, so the wizard can explain itself rather than just
    // showing a tick.
    ...(apexVerified && { matchedBy: 'apex-address' as const }),
  }, { status: 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
