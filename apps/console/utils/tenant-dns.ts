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

/**
 * The DNS facts the connect-a-domain flow depends on, in ONE place so the
 * record the wizard displays and the record `/api/domains/verify` accepts
 * cannot drift apart.
 *
 * They already did once: AGL-733 found the wizard reading
 * `NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME` while the route read a server-only
 * `AGLYN_TENANT_HOST_CNAME`, so the displayed target and the verified target
 * were configured independently — and an unset server var silently degraded
 * the check to "any CNAME passes". AGL-1264 then added an apex address rule
 * with its own server-only `AGLYN_TENANT_APEX_ADDRESSES`, and the wizard
 * answered it with a private `NEXT_PUBLIC_AGLYN_TENANT_APEX_A` that nothing
 * else read — re-creating exactly that split, one comment-enforced invariant
 * deep. Expanding the pool by env edit, which the route documents as the
 * supported move, would have left the wizard printing an address the route no
 * longer accepted (AGL-1275).
 */

/**
 * The CNAME target a subdomain points at. Public because the wizard prints it.
 */
export const CNAME_TARGET = (
  process.env['NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME'] ?? 'sites.aglyn.app'
).toLowerCase()

/**
 * Addresses the platform host publishes for the apexes it serves; it routes by
 * `Host` rather than by IP, so an apex pointed here never shares an address
 * with `CNAME_TARGET` yet is configured correctly (AGL-1264).
 *
 * `NEXT_PUBLIC_…` is read first so the browser bundle can name the same
 * addresses the route accepts; the server-only name is kept as a fallback so an
 * existing deployment that sets only that one keeps verifying exactly as
 * before. `76.76.21.21` is the host's legacy address — still served, so zones
 * pointed at it must keep verifying, but it is NOT what a newly-pointed apex
 * lands on and must never be the address we recommend (AGL-1264).
 */
export const HOST_APEX_ADDRESSES = (
  process.env['NEXT_PUBLIC_AGLYN_TENANT_APEX_ADDRESSES'] ??
  process.env['AGLYN_TENANT_APEX_ADDRESSES'] ??
  '216.198.79.1,216.198.79.65,64.29.17.1,64.29.17.65,76.76.21.21'
)
  .split(',')
  .map((address) => address.trim())
  .filter(Boolean)

/**
 * The single address to put in front of a customer *when an address is all the
 * registrar can express*. The accepted list spans the host's whole pool plus the
 * legacy address, but an A record holds exactly one value, and any one address
 * in the pool routes correctly.
 *
 * This is the FALLBACK, not the recommendation: pinning it in a customer zone
 * re-creates by hand the coupling the verify route refuses to make, whose own
 * comment warns that pinning edge IPs "would turn a routine infrastructure
 * change into every customer's domain reporting itself broken". Prefer the
 * ALIAS instruction below, which names `CNAME_TARGET` and so follows the pool
 * (AGL-1327).
 */
export const RECOMMENDED_APEX_ADDRESS = HOST_APEX_ADDRESSES[0] ?? '216.198.79.1'

/**
 * Registry suffixes that are themselves a public suffix, so the name one label
 * to their left is an apex rather than a subdomain. Label counting alone gets
 * `example.co.uk` wrong and would hand a bare domain the CNAME instruction its
 * registrar cannot accept on the zone root.
 *
 * Deliberately a short list of the common ones rather than a vendored PSL: a
 * miss degrades to the pre-AGL-1275 behaviour — the apex example falls back to
 * its placeholder — not to a dead end.
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = [
  'co.uk',
  'org.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'net.uk',
  'sch.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'co.za',
  'org.za',
  'com.br',
  'com.mx',
  'com.ar',
  'co.jp',
  'or.jp',
  'ne.jp',
  'co.kr',
  'co.in',
  'com.sg',
  'com.tr',
  'com.cn',
  'com.hk',
]

/**
 * Whether `domain` is a zone apex — the name that cannot carry a CNAME because
 * RFC 1034 forbids one alongside the SOA/NS records every zone apex must have.
 * That constraint is the whole reason the apex needs a different record.
 */
export function isApexDomain(domain: string): boolean {
  const name = domain.trim().toLowerCase().replace(/\.$/, '')
  const labels = name.split('.').filter(Boolean)
  if (labels.length < 2) return false
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_LABEL_PUBLIC_SUFFIXES.includes(lastTwo)) return labels.length === 3
  return labels.length === 2
}

/** One DNS record the customer may create, as their registrar labels it. */
export interface DnsInstruction {
  /** Record type. `ALIAS` covers ANAME and CNAME flattening. */
  type: 'CNAME' | 'ALIAS' | 'A'
  /** The name the record goes on. */
  name: string
  /** What the record points at — a hostname, or an address for `A`. */
  value: string
  /** When this is the record to create. Plainly conditional, not clever. */
  note: string
}

/**
 * The intro that precedes the records. Lives here rather than in the card so
 * the docs pages which quote it verbatim have one string to be checked against.
 */
export const DNS_INSTRUCTIONS_INTRO =
  'Point your domain at Aglyn, then verify. A subdomain like www uses a ' +
  'CNAME. A bare apex cannot carry a CNAME, so point it at the same hostname ' +
  'with an ALIAS — or use the A record if your registrar has no ALIAS. Any ' +
  'one of these verifies:'

const CNAME_NOTE = 'For a subdomain like www — the usual choice.'

const ALIAS_NOTE =
  'For a bare apex. Your registrar may call it ANAME or CNAME flattening. ' +
  'It follows our hostname, so it keeps working if our addresses change.'

const APEX_A_NOTE =
  'For a bare apex, only if your registrar offers no ALIAS/ANAME. It pins one ' +
  'address, so it needs updating by hand if ours ever change.'

/**
 * The records the connect-a-domain card offers for the name typed so far.
 *
 * ALIAS leads for a bare apex (AGL-1327). The card used to print a single
 * `A → 216.198.79.1` for every apex — one member of the platform's anycast
 * pool, pinned into the customer's zone. The verify route deliberately accepts
 * the WHOLE pool (`HOST_APEX_ADDRESSES`, AGL-1264) so no single address is
 * load-bearing, and an ALIAS to `CNAME_TARGET` needs no address at all: the
 * registrar flattens it to whatever that hostname currently resolves to, which
 * is exactly the intersection the route already checks. So a pool change costs
 * an ALIAS customer nothing, while an A customer must edit their zone.
 *
 * The A record STAYS, because plenty of registrars have no ALIAS/ANAME and no
 * flattening — for them it is the only way to point an apex at all. It is
 * presented as the fallback rather than deleted or hidden.
 *
 * Each record shows the SHAPE of name it applies to, derived from the typed
 * value rather than echoing it into every line (the echo claimed a CNAME for a
 * bare apex and an apex record for a www — both wrong). Apex detection is
 * `isApexDomain`, not a label count: counting labels calls `example.co.uk` a
 * subdomain, so a UK customer typing their bare domain was handed the CNAME —
 * the one record a zone root cannot carry (AGL-1275).
 */
export function dnsInstructionsFor(domain: string): DnsInstruction[] {
  const typed = domain.trim().toLowerCase()
  const bareApex = isApexDomain(typed)
  const startsWithWww = /^www\./.test(typed)
  // A bare apex gains `www.` on the CNAME line; a www-prefixed name sheds it
  // on the apex lines; a deeper subdomain keeps the typed value on the CNAME
  // line while the apex lines keep their placeholder, since an apex guessed
  // from `shop.example.co.uk` would be exactly that — a guess.
  const subdomainName = !typed
    ? 'www.your-domain.com'
    : bareApex
      ? `www.${typed}`
      : typed
  const apexName = !typed
    ? 'your-domain.com'
    : bareApex
      ? typed
      : startsWithWww
        ? typed.replace(/^www\./, '')
        : 'your-domain.com'
  const cname: DnsInstruction = {
    type: 'CNAME',
    name: subdomainName,
    value: CNAME_TARGET,
    note: CNAME_NOTE,
  }
  const alias: DnsInstruction = {
    type: 'ALIAS',
    name: apexName,
    value: CNAME_TARGET,
    note: ALIAS_NOTE,
  }
  const apexAddress: DnsInstruction = {
    type: 'A',
    name: apexName,
    value: RECOMMENDED_APEX_ADDRESS,
    note: APEX_A_NOTE,
  }
  // Order by what was typed: an apex customer reads the ALIAS first, everyone
  // else still reads the CNAME first, exactly as before.
  return bareApex ? [alias, apexAddress, cname] : [cname, alias, apexAddress]
}

/**
 * A record rendered as the single monospace line the card shows and the docs
 * quote — `CNAME  www.example.com  →  sites.aglyn.app`. Padding keeps the
 * three type names in one column.
 */
export function formatDnsInstruction(record: DnsInstruction): string {
  return `${record.type.padEnd(5)}  ${record.name}  →  ${record.value}`
}
