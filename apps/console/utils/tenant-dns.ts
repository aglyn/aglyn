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
 * The single address to put in front of a customer. The accepted list spans the
 * host's whole pool plus the legacy address, but instructions need exactly one
 * value, and any one address in the pool routes correctly.
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
