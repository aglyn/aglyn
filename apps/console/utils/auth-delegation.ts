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
 * Central auth origin (AGL-465). Interactive sign-in can only run where
 * Firebase Auth is authorized and the OAuth helper can be framed — and
 * neither authorized domains nor the frame-ancestors allowlist can
 * wildcard dynamically-provisioned `{org}.<workspaceDomain>` subdomains.
 * So workspace subdomains delegate interactive sign-in to
 * `auth.<workspaceDomain>` (which IS the authDomain → same-origin OAuth)
 * and pick the session back up via the shared parent-domain `__session`
 * cookie (AGL-236 silent sign-in).
 */

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * First-party infrastructure labels that host their own sign-in (or are
 * the auth host itself) and must NOT be treated as org workspaces. Mirrors
 * the middleware's reserved set plus the platform hosts.
 */
const RESERVED_LABELS = new Set([
  'www',
  'app',
  'console',
  'auth',
  'admin',
  'cdn',
  'cname',
  'demo',
  'host',
  'io',
  'proxy',
  'tenant',
])

export function authSignInHost(workspaceDomain = WORKSPACE_DOMAIN): string {
  return `auth.${workspaceDomain}`
}

/**
 * True when `host` is an org workspace subdomain that should hand
 * interactive sign-in off to the auth host: within the workspace domain,
 * a single subdomain label, and not a reserved platform/auth label.
 * The bare apex, `app.`, `auth.`, previews, and localhost all return false
 * (they sign in locally).
 */
export function shouldDelegateSignIn(
  host: string,
  workspaceDomain = WORKSPACE_DOMAIN,
): boolean {
  const hostname = host.split(':')[0]
  if (hostname === workspaceDomain) return false
  if (!hostname.endsWith(`.${workspaceDomain}`)) return false
  const label = hostname.slice(0, -(workspaceDomain.length + 1))
  if (label.includes('.')) return false // deeper nesting is not an org host
  return !RESERVED_LABELS.has(label)
}

/**
 * Builds the delegated sign-in URL on the auth host, carrying an absolute,
 * same-site return URL so the auth host can send the user back to the
 * workspace they started from. `returnPath` is the in-workspace path
 * (from the `continue` param) to resume after authenticating.
 */
export function buildDelegatedSignInUrl(
  origin: string,
  returnPath: string,
  page: 'signin' | 'signup' = 'signin',
  workspaceDomain = WORKSPACE_DOMAIN,
): string {
  const safePath = returnPath.startsWith('/') && !returnPath.startsWith('//')
    ? returnPath
    : '/'
  const returnUrl = `${origin}${safePath}`
  return (
    `https://${authSignInHost(workspaceDomain)}/${page}` +
    `?continue=${encodeURIComponent(returnUrl)}`
  )
}
