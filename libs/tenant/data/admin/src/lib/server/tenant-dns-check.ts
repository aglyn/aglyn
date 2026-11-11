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

import { CNAME_TARGET, HOST_APEX_ADDRESSES } from '@aglyn/aglyn/app-utils/tenant-dns-targets'
import { promises as dns, Resolver as CallbackResolver } from 'dns'
import { PUBLIC_DNS_RESOLVERS as PUBLIC_RESOLVERS } from './dns-probe'

/**
 * WHETHER A NAME POINTS AT THE TENANT EDGE: the check behind
 * `/api/domains/verify`, here so a caller with no request of its own reads
 * the same answer (AGL-3963). The domains plugin's one-click DNS asks it after
 * a DNS provider wrote the records, and its sweep asks it again for a session
 * whose owner closed the tab; neither can import the console app, and a
 * second copy of this rule is how the displayed target and the accepted one
 * came apart before (AGL-733).
 *
 * The targets are `@aglyn/aglyn/app-utils/tenant-dns-targets`, the values the
 * connect card prints.
 */

/** A domain as the check accepts one: labels of letters, digits and hyphens. */
export const TENANT_DNS_DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i

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

async function resolveAaaaRecords(domain: string): Promise<string[]> {
  const normalise = (records: string[]) => records.map((record) => record.toLowerCase())
  const lookup = async (resolver?: CallbackResolver) =>
    resolver
      ? new Promise<string[]>((resolve, reject) => {
          resolver.resolve6(domain, (error, addresses) =>
            error ? reject(error) : resolve(addresses),
          )
        })
      : dns.resolve6(domain)
  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_RESOLVERS)
    return normalise(await lookup(resolver))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      return []
    }
    try {
      return normalise(await lookup())
    } catch {
      return []
    }
  }
}

/**
 * IPv6 addresses answering for `domain` that the tenant edge does not answer
 * with: the AAAA record a previous host left on the zone root (AGL-3963).
 *
 * Pointing a domain here replaces its A record (by hand, or through Domain
 * Connect, whose `website` template writes `A @`), and nothing replaces the
 * AAAA beside it. A visitor on IPv6 then reaches the previous host, and the
 * edge's certificate challenge over IPv6 can fail with it. Cloudflare named
 * this case when it onboarded our templates (2026-10-29).
 *
 * Compared against the edge's own AAAA answer rather than "any AAAA at all",
 * so the day the edge publishes IPv6 a correctly-pointed name stays clean.
 * Reported, never refused, for the same reason as `stray` below. Never throws:
 * an unreachable resolver reads as no records.
 */
export async function strayIpv6Addresses(domain: string): Promise<string[]> {
  const [domainAddresses, targetAddresses] = await Promise.all([
    resolveAaaaRecords(domain),
    resolveAaaaRecords(CNAME_TARGET),
  ])
  const ours = new Set(targetAddresses)
  return domainAddresses.filter((address) => !ours.has(address))
}

/** A record answering for a name that is not ours, as the status card lists it. */
export interface TenantDnsConflict {
  type?: string
  name?: string
  value?: string
}

/**
 * `conflicts` with each stray IPv6 address of `names` added as an AAAA entry,
 * unless the platform already listed it (AGL-3963). The platform's own DNS
 * check is not relied on to name these: it is the A record it checks.
 */
export async function withStrayIpv6Conflicts(
  names: readonly string[],
  conflicts: readonly TenantDnsConflict[],
): Promise<TenantDnsConflict[]> {
  const merged = [...conflicts]
  const listed = new Set(
    conflicts.map((conflict) =>
      [conflict.type, conflict.name, conflict.value].map((part) => String(part ?? '').toLowerCase()).join('|'),
    ),
  )
  const strays = await Promise.all(names.map(async (name) => ({ name, addresses: await strayIpv6Addresses(name) })))
  for (const { name, addresses } of strays) {
    for (const value of addresses) {
      const key = ['aaaa', name.toLowerCase(), value].join('|')
      if (listed.has(key)) continue
      listed.add(key)
      merged.push({ type: 'AAAA', name, value })
    }
  }
  return merged
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
 *
 * The list itself lives in `tenant-dns-targets.ts` beside `CNAME_TARGET`, so the
 * wizard prints an address this check will actually accept rather than keeping
 * its own copy under a different env var (AGL-1275) — that env edit is exactly
 * the move which used to leave the two disagreeing.
 */
/**
 * The `stray` half exists because the intersection above is deliberately an
 * `some`, and a name can answer with our addresses AND somebody else's at the
 * same time (AGL-1913).
 *
 * That is the shape a stale A record makes: a previous host's address left in
 * the zone answers alongside a correct ALIAS, the resolver hands out whichever
 * it likes, and the site loads for one visitor and not the next. Every check we
 * had reported that domain as verified, because it is — some of the time — and
 * "it works when I try it" is exactly why nobody finds it.
 *
 * Reported, not refused. Refusing would mean treating "an address we do not
 * recognise" as proof of misconfiguration, and the recognised set is an env var
 * plus a live lookup of one hostname: the day the platform widens its pool
 * ahead of our config, refusing would fail every correctly-pointed apex at
 * once. A warning costs a confused customer nothing and cannot take the flow
 * down.
 */
async function apexPointsAtTenantEdge(
  domain: string,
): Promise<{ matched: boolean; stray: string[] }> {
  const [domainAddresses, targetAddresses] = await Promise.all([
    resolveARecords(domain),
    resolveARecords(CNAME_TARGET),
  ])
  if (!domainAddresses.length) return { matched: false, stray: [] }
  const acceptable = new Set([...targetAddresses, ...HOST_APEX_ADDRESSES])
  return {
    matched: domainAddresses.some((address) => acceptable.has(address)),
    stray: domainAddresses.filter((address) => !acceptable.has(address)),
  }
}

/** What the check found for one name, as `/api/domains/verify` answers it. */
export interface TenantDnsCheck {
  domain: string
  /** The name's CNAME targets, lowercased; empty when it carries none. */
  records: string[]
  /** The CNAME target a subdomain must name. */
  expected: string
  verified: boolean
  /** Set when an apex passed by the addresses it lands on. */
  matchedBy?: 'apex-address'
  /** Addresses answering for the name that are not ours (AGL-1913). */
  strayAddresses?: string[]
  /** IPv6 addresses answering for the name that are not ours (AGL-3963). */
  strayIpv6Addresses?: string[]
}

/**
 * Resolves `domain` and answers whether it points at the tenant edge: its
 * CNAME names `CNAME_TARGET`, or, carrying no CNAME, its addresses are ours.
 *
 * `softPass` accepts ANY CNAME and belongs to local development alone, where
 * nothing points at the edge. A caller passes `isDevelopmentRuntime()` and
 * never a guess: a soft pass that keys on a missing hosting variable is the
 * AGL-2180 hole, where any domain with any CNAME verified on a container.
 *
 * Expects a lowercased name that matched {@link TENANT_DNS_DOMAIN_PATTERN}.
 * Never throws: an unreachable resolver reads as no records.
 */
export async function checkTenantDnsPointing(
  domain: string,
  options: { softPass?: boolean } = {},
): Promise<TenantDnsCheck> {
  // NXDOMAIN / no CNAME comes back as an empty list — reported as unverified.
  const records = await resolveCnameRecords(domain)
  const cnameVerified =
    records.includes(CNAME_TARGET) || (options.softPass === true && records.length > 0)
  // Only fall back to the address comparison when there is no CNAME at all.
  // A domain that DOES carry a CNAME but points somewhere else must keep
  // failing — otherwise "pointed at the wrong place" and "pointed at an apex"
  // would verify identically.
  const [apex, strayIpv6] = records.length
    ? [{ matched: false, stray: [] as string[] }, [] as string[]]
    : await Promise.all([apexPointsAtTenantEdge(domain), strayIpv6Addresses(domain)])
  return {
    domain,
    records,
    expected: CNAME_TARGET,
    verified: cnameVerified || apex.matched,
    // Which rule passed, so the wizard can explain itself rather than just
    // showing a tick.
    ...(apex.matched && { matchedBy: 'apex-address' as const }),
    // Addresses answering for the name that are not ours. A verified domain
    // with a non-empty list here is the one that loads intermittently.
    ...(apex.stray.length ? { strayAddresses: apex.stray } : {}),
    // The previous host's AAAA, which pointing the A record here left in
    // place: IPv6 visitors still reach that host (AGL-3963).
    ...(strayIpv6.length ? { strayIpv6Addresses: strayIpv6 } : {}),
  }
}
