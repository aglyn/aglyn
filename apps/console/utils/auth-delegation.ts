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
 * Loop breaker (AGL-466). The delegation round-trip should land the user
 * back signed-in; if it keeps returning session-less, stop rather than
 * bounce forever. Counts bounces within a short window and returns false
 * once the cap is hit. Cleared on a successful sign-in.
 */
const BOUNCE_KEY = 'aglyn:signin-delegation-bounces'
const BOUNCE_LIMIT = 3
const BOUNCE_WINDOW_MS = 30_000

export function recordDelegationBounce(): boolean {
  try {
    const now = Date.now()
    const raw = window.sessionStorage.getItem(BOUNCE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { at: number; n: number }) : null
    const within = parsed && now - parsed.at < BOUNCE_WINDOW_MS
    const n = (within ? parsed.n : 0) + 1
    window.sessionStorage.setItem(
      BOUNCE_KEY,
      JSON.stringify({ at: within ? parsed.at : now, n }),
    )
    return n <= BOUNCE_LIMIT
  } catch {
    return true // storage unavailable — don't block a legitimate redirect
  }
}

export function clearDelegationBounces(): void {
  try {
    window.sessionStorage.removeItem(BOUNCE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Whether `host` should hand interactive sign-in off to the auth host.
 *
 * - `auth.<domain>`, previews, and localhost always sign in locally.
 * - On MOBILE, every other workspace host delegates (AGL-468): interactive
 *   OAuth only completes same-origin on the auth host, and a cross-origin
 *   `authDomain` breaks `signInWithRedirect` under mobile storage
 *   partitioning — so `app.<domain>` can't run it locally either.
 * - On DESKTOP, only dynamic org workspace subdomains delegate (their host
 *   is unauthorizable/unframeable); apex/platform hosts (`app.`, `console.`,
 *   the bare apex) sign in locally via popup.
 */
export function shouldDelegateSignIn(
  host: string,
  opts: { isMobile?: boolean; workspaceDomain?: string } = {},
): boolean {
  const workspaceDomain = opts.workspaceDomain ?? WORKSPACE_DOMAIN
  const hostname = host.split(':')[0]
  const onWorkspaceDomain =
    hostname === workspaceDomain || hostname.endsWith(`.${workspaceDomain}`)
  if (!onWorkspaceDomain) return false
  if (hostname === authSignInHost(workspaceDomain)) return false
  if (opts.isMobile) return true
  if (hostname === workspaceDomain) return false
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
