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
 * Where a customer's domain must point to reach the tenant edge: the CNAME
 * target and the apex address pool (AGL-3963).
 *
 * A leaf of its own so the three readers that must agree read ONE copy: the
 * console's connect card prints these (`apps/console/utils/tenant-dns.ts`
 * re-exports them beside the instruction copy), the DNS check in
 * `@aglyn/tenant-data-admin/server/tenant-dns-check` accepts them, and the
 * domains plugin's one-click DNS checks the records a provider wrote against
 * them. The plugin cannot import the console app, so the values could only
 * be shared from a lib; a copy in the plugin is the AGL-733 split again.
 *
 * Client-safe on purpose: no Node import, and every `NEXT_PUBLIC_*` read is
 * dot notation so Next inlines it into the card's browser bundle.
 */

/**
 * The CNAME target a subdomain points at. Public because the wizard prints it.
 */
export const CNAME_TARGET = (
  // Dot notation, and it is the whole fix (AGL-2037). Next inlines
  // `NEXT_PUBLIC_*` into the browser bundle by textually substituting
  // `process.env.NAME`; the bracket form is never substituted. This module is
  // imported by `custom-domain-card.component.tsx`, which is `'use client'`,
  // so the bracket form read `undefined` in the browser and this constant
  // collapsed to Aglyn's target no matter what an operator configured — their
  // wizard telling their customer to create a DNS record pointing at OUR
  // infrastructure. Note this is the same invariant the header above is about,
  // broken through a different mechanism: the env name was unified by AGL-733,
  // and the ACCESS FORM silently re-split displayed target from verified
  // target, because the verify route runs server-side where brackets work.
  //
  // `||` not `??`, matching AGL-2022: an empty string is not a configured
  // value, and an empty CNAME target is a wizard printing nothing.
  process.env.NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME || 'sites.aglyn.app'
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
  // Dot form for the public name — same reason as `CNAME_TARGET` above, and it
  // was broken the same way: the browser read `undefined` and the wizard
  // printed Vercel's addresses to an operator's customer. The server-only name
  // below KEEPS the bracket form deliberately: it is never substituted by
  // design, is only meaningful server-side, and the dot form would inline a
  // server-only value into the client bundle.
  process.env.NEXT_PUBLIC_AGLYN_TENANT_APEX_ADDRESSES ||
  process.env['AGLYN_TENANT_APEX_ADDRESSES'] ||
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
