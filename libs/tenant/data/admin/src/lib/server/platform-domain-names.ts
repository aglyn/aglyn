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
 * Which hostnames a customer may claim, and which are the platform's own.
 *
 * ## Why this file exists (AGL-1430)
 *
 * Both domain surfaces — `consoleDomains` (white-label console, AGL-1353) and
 * `hosts.cname` (site custom domain, AGL-166/743) — attach customer names to a
 * Vercel project whose add-domain call **tolerates `domain_already_in_use`**.
 * That tolerance is only safe while the Firestore claim indexes *every* name
 * the platform holds on that project. A name that reaches Vercel without a
 * claim can be claimed by a second org, which reads the tolerated 409 as
 * health and has its visitors redirected to a stranger's site.
 *
 * `console-domains.ts` reasoned this through and built the blocklist. The site
 * path never got one, and it was the path with the live hole: AGL-1273 attaches
 * `{subdomain}.{TENANT_APEX}` to the tenant project as a 307 redirect on every
 * custom-domain connect, and nothing indexes that name as anybody's `cname`.
 * Org B could claim org A's `alice.aglyn.app`, watch `projectDomainStatus`
 * truthfully answer `serving` — the name really is on our project — and end up
 * with its own `{sub}.aglyn.app` 307ing to org A's site.
 *
 * So the lists live here, once, and both surfaces read them. A name added to
 * one blocklist is added to both, which is the property that was missing.
 *
 * ## The two ways a name is reserved
 *
 * **Suffix-reserved** (`RESERVED_DOMAIN_SUFFIXES`) — blocked as the name itself
 * *and as any subdomain of it*. Two families:
 *
 * - **Ours.** `aglyn.com`, `aglyn.io`, `aglyn.app`, `aglyn.dev`. Keying on the
 *   registrable domain covers every entry of `PRODUCTION_DOMAINS` in
 *   `security-origins.js` without duplicating that list, and keeps covering
 *   names added to it later. `console-domains.spec.ts` walks the real file and
 *   asserts exactly that.
 * - **Shared app-hosting suffixes.** Nobody controls the zone at
 *   `something.vercel.app` in the sense these features need — AGL-1353 measured
 *   `aglyn-console-aglyn.vercel.app` already serving a real console. Proving
 *   control of a name a platform hands out for free proves something that can
 *   be re-handed to someone else.
 *
 * **Bare-suffix-reserved** (`BARE_PUBLIC_SUFFIXES`) — blocked as a *whole name
 * only*. `acme.co.uk` is a perfectly good customer domain; `co.uk` is not a
 * domain at all. A short list rather than the Public Suffix List on purpose:
 * pulling in a PSL dependency to reject a name no registrar would sell is not a
 * trade worth making, and the single-label rule catches the commoner `com` case
 * for free.
 */

import { TENANT_APEX } from '@aglyn/aglyn/server'
import type { DomainCheck } from './sso-provisioning'

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'

/** Hostname shape: dash-free at label edges, a real TLD, at least two labels. */
export const PLATFORM_DOMAIN_PATTERN = new RegExp(
  `^${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,63}$`,
)

/** RFC 1035: a fully-qualified name is at most 253 octets. */
export const MAX_DOMAIN_LENGTH = 253

/** Reserved as the name itself AND as any subdomain of it. See the header. */
export const RESERVED_DOMAIN_SUFFIXES: readonly string[] = [
  'aglyn.com',
  'aglyn.io',
  'aglyn.app',
  'aglyn.dev',
  'vercel.app',
  'vercel.sh',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'cloudfunctions.net',
  'run.app',
  'pages.dev',
  'workers.dev',
  'netlify.app',
  'github.io',
  'herokuapp.com',
  'azurewebsites.net',
  'amplifyapp.com',
  'onrender.com',
  'fly.dev',
  'ngrok.io',
  'ngrok-free.app',
  'trycloudflare.com',
  // RFC 2606 / 6761 special-use names, plus the ones a misconfigured resolver
  // answers for. None of these can be proved by a public TXT lookup.
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'test',
  'example',
  'invalid',
  'onion',
]

/** Reserved as a WHOLE name only — `acme.co.uk` stays claimable. */
export const BARE_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.za',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.mx',
  'com.cn',
  'com.tr',
  'co.in',
  'co.kr',
  'com.sg',
  'com.hk',
])

/**
 * Trim, lowercase, drop a trailing root dot, and tolerate a pasted URL.
 *
 * People paste `https://console.acme.com/` into a domain field constantly, and
 * refusing that is a support ticket rather than a security control — the value
 * is re-validated against the shape below either way.
 */
export function normalizePlatformDomain(input: string): string {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return ''
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@]*@/, '')
    .split(/[/?#]/)[0]
    .replace(/\.+$/, '')
}

/**
 * Whether a normalised name belongs to the platform rather than a customer.
 *
 * `TENANT_APEX` is consulted at call time rather than baked into the list
 * above, and that is the load-bearing half rather than a nicety. The static
 * entries name *our* production zones; the correspondence this file exists to
 * protect is a property of **whichever apex this deployment attaches
 * `{subdomain}.{apex}` redirects to**, which a self-host operator sets with
 * `NEXT_PUBLIC_TENANT_DOMAIN`. A blocklist that only knew `aglyn.app` would
 * leave every self-host install with the hole we are closing here.
 */
export function isPlatformReservedDomain(domain: string): boolean {
  if (!domain) return true
  if (BARE_PUBLIC_SUFFIXES.has(domain)) return true
  const apex = String(TENANT_APEX ?? '')
    .trim()
    .toLowerCase()
  const suffixes = apex
    ? [...RESERVED_DOMAIN_SUFFIXES, apex]
    : RESERVED_DOMAIN_SUFFIXES
  return suffixes.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
  )
}

/**
 * Shape, length and reserved-name check for a customer-supplied hostname.
 *
 * `{ domain, error }` with both keys always present rather than a discriminated
 * union, matching `validateSsoDomain` — `strictNullChecks` is off repo-wide and
 * an `{ ok: true } | { ok: false }` union does not narrow reliably once it
 * crosses a library boundary.
 *
 * `copy` is a parameter rather than a constant because the console and site
 * wizards are different products to the customer standing in front of them,
 * and these two strings are the ones a customer reads and acts on. The RULES
 * are shared; only the wording is not.
 */
export function validatePlatformDomain(
  input: string,
  copy: { invalid: string; reserved: string },
): DomainCheck {
  const domain = normalizePlatformDomain(input)
  if (
    !domain ||
    domain.length > MAX_DOMAIN_LENGTH ||
    !PLATFORM_DOMAIN_PATTERN.test(domain)
  ) {
    return { domain: null, error: copy.invalid }
  }
  if (domain.split('.').length < 2) {
    return { domain: null, error: 'Enter a full domain name, not a single label' }
  }
  if (isPlatformReservedDomain(domain)) {
    return { domain: null, error: copy.reserved }
  }
  return { domain, error: null }
}
