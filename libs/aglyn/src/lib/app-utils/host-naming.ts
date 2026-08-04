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
