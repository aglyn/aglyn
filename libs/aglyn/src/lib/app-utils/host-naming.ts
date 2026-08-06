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
 * Host naming guards (AGL-147): one shared subdomain policy for the create
 * API, the rename/validate API, and the console dialogs — pattern, reserved
 * + profanity blocklists, a display-name → subdomain generator, and
 * taken-name suggestions.
 */

/** 3–30 chars, lowercase alphanumeric + dashes, no leading dash. */
export const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/

/** Platform/system names a tenant must not squat. */
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'console',
  'mail',
  'demo',
  'staging',
  'dev',
  'test',
  'docs',
  'blog',
  'help',
  'support',
  'status',
  'cdn',
  'assets',
  'static',
  'ftp',
  'smtp',
  'ns1',
  'ns2',
  'aglyn',
  'billing',
  'account',
  'login',
  'signup',
  'auth',
])

/**
 * Profanity fragments blocked as substrings in generated or typed
 * subdomains. Deliberately short: obvious slurs and vulgarity only —
 * substring matching is aggressive, so entries must be unambiguous.
 */
const BLOCKED_FRAGMENTS = [
  'fuck',
  'shit',
  'cunt',
  'nigger',
  'faggot',
  'bitch',
  'porn',
  'nazi',
]

/** True when the subdomain is reserved or contains a blocked fragment. */
export function isBlockedSubdomain(subdomain: string): boolean {
  const normalized = subdomain.toLowerCase()
  if (RESERVED_SUBDOMAINS.has(normalized)) return true
  const collapsed = normalized.replace(/[^a-z0-9]/g, '')
  return BLOCKED_FRAGMENTS.some((fragment) => collapsed.includes(fragment))
}

/**
 * Best-effort subdomain from a display name: lowercase, spaces/symbols to
 * dashes, collapsed, trimmed to the pattern's 30-char cap. Returns '' when
 * nothing usable remains (caller falls back to manual entry).
 */
export function generateSubdomain(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '')
  if (!SUBDOMAIN_PATTERN.test(slug) || isBlockedSubdomain(slug)) return ''
  return slug
}

/**
 * Alternatives for a taken subdomain: `name-2`, `name-<year>`, `name-site`.
 * Candidates are truncated to fit the pattern; blocked names are dropped.
 * Availability is the caller's job (needs a Firestore query).
 */
export function suggestSubdomains(base: string, year = new Date().getFullYear()): string[] {
  const stem = base.toLowerCase().replace(/-+$/, '')
  const withSuffix = (suffix: string) =>
    `${stem.slice(0, 30 - suffix.length - 1)}-${suffix}`.replace(/-{2,}/g, '-')
  const candidates = [withSuffix('2'), withSuffix(String(year)), withSuffix('site')]
  return [
    ...new Set(
      candidates.filter(
        (candidate) =>
          SUBDOMAIN_PATTERN.test(candidate) && !isBlockedSubdomain(candidate),
      ),
    ),
  ]
}

/** The apex tenant sites are served from. Console lives on `app.aglyn.com`. */
export const TENANT_APEX = 'aglyn.app'

/**
 * The absolute origin a published site is reachable at (AGL-1224).
 *
 * A custom domain wins over the platform subdomain, matching what the tenant
 * renderer already emits as `<link rel="canonical">` — a site on a custom
 * domain that advertised its `.aglyn.app` origin would be describing itself
 * by a name its visitors never see.
 *
 * Returns undefined rather than a half-built URL when a host has neither, so
 * a caller that needs an absolute URL can tell it does not have one. Emails
 * are the sharp case: an image `src` that is site-relative resolves against
 * nothing in an inbox, so "no origin" has to be answerable.
 */
export function hostPublicOrigin(
  host:
    | { cname?: string | null; subdomain?: string | null }
    | null
    | undefined,
): string | undefined {
  if (host?.cname) return `https://${host.cname}`
  if (host?.subdomain) return `https://${host.subdomain}.${TENANT_APEX}`
  return undefined
}

/**
 * The custom-domain lifecycle as it is actually persisted on the host doc.
 *
 * There is no `verifiedAt`, no `status`, no `sslReady` — the console's
 * `/api/domains/*` routes write exactly these three fields, so this is the
 * whole vocabulary anything downstream has to reason from.
 */
export interface HostCustomDomainState {
  cname?: string | null
  /** Vercel attach failed or was unconfigured — the domain does NOT serve. */
  cnameAttachmentPending?: boolean | null
  /** Vercel detach failed — the customer is mid-disconnect. */
  cnameDetachmentPending?: boolean | null
  subdomain?: string | null
}

/** A bare hostname: labels of a-z0-9/dash, at least two of them. */
const CUSTOM_DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.(?!-)[a-z0-9-]{1,63})+$/

/**
 * The custom domain a host is actually **serving on**, or undefined (AGL-1272).
 *
 * Deliberately stricter than `hostPublicOrigin`, which answers "what name does
 * this site call itself" and is right to prefer `cname` the moment it exists.
 * This answers a load-bearing question instead — "is it safe to send visitors
 * away from the platform subdomain and onto this name" — and the cost of
 * getting it wrong is the whole site, not a wrong URL in an email.
 *
 * So every reason to doubt the domain is a refusal:
 *
 *  - `cnameAttachmentPending` means the Vercel attach never landed (missing
 *    env, or a 5xx). The domain is claimed in Firestore and serves nothing:
 *    no certificate, no routing. This is precisely the "attached but not
 *    live" state, and redirecting to it strands the site on a dead host.
 *  - `cnameDetachmentPending` means the customer asked to disconnect and the
 *    platform release failed. The name may still resolve, but the customer's
 *    stated intent is to leave it, so we stop advertising it.
 *  - A name inside `aglyn.app` is refused outright. `{sub}.aglyn.app` is the
 *    very origin we redirect FROM, and the tenant middleware resolves that
 *    space by `subdomain` before it ever considers `cname` — so a host whose
 *    cname pointed back into it would redirect to itself forever.
 *  - A name that is not hostname-shaped is refused. `/api/domains/attach`
 *    lowercases and trims what the wizard sends but never pattern-checks it
 *    (only `/api/domains/verify` does), so a junk value can reach Firestore.
 *    A junk value reaching a `Location:` header is a different class of
 *    problem again.
 *
 * Note what this CANNOT tell you: DNS was verified once, at connect time, and
 * nothing re-checks it. A domain whose DNS is later repointed or whose
 * registration lapses still reads as live here. That residual risk is why the
 * redirect built on this is temporary and revocable rather than permanent.
 */
export function liveCustomDomain(
  host: HostCustomDomainState | null | undefined,
): string | undefined {
  if (!host) return undefined
  if (host.cnameAttachmentPending === true) return undefined
  if (host.cnameDetachmentPending === true) return undefined
  const domain = String(host.cname ?? '')
    .trim()
    .toLowerCase()
  if (!CUSTOM_DOMAIN_PATTERN.test(domain)) return undefined
  if (domain === TENANT_APEX || domain.endsWith(`.${TENANT_APEX}`)) {
    return undefined
  }
  return domain
}
