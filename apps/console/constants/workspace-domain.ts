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
 * The workspace apex domain, in ONE place.
 *
 * This existed as eight separate declarations. Seven of them defaulted to
 * `'aglyn.com'`; the eighth — the host gate in `middleware.ts` — did not.
 * `NEXT_PUBLIC_WORKSPACE_DOMAIN` is unset on the console's production
 * deployment, so the single declaration without a fallback was the security
 * gate, and only the gate switched itself off: every `*.aglyn.com` hostname
 * was served the console while `/api/auth/session` still minted `__session`
 * with `Domain=.aglyn.com` from its own copy of the constant.
 *
 * Deriving both from this module is the point — the failure was not the
 * missing `??`, it was that the value could differ between the code that
 * grants a session and the code that decides who may ask for one.
 */
export const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

/**
 * Subdomain labels that are never org workspaces.
 *
 * `auth` hosts the Firebase OAuth helper origin (auth.aglyn.com, AGL-462) —
 * without it the `/__/auth/*` handshake resolves as an unknown slug and gets
 * redirected away, breaking Google sign-in.
 */
export const APEX_LABELS = new Set(['www', 'console', 'app', 'auth'])

/**
 * The bare hostname of a `Host` header, lowercased and without its port.
 *
 * Three files were doing this with their own `.split(':')[0].toLowerCase()`
 * and a fourth is about to (AGL-1099c's custom-domain gate). A host that is
 * normalized differently in the code that GRANTS a session than in the code
 * that decides who may ask for one is the exact shape of the bug this module
 * was created to close.
 */
export function hostnameOf(host: string | null | undefined): string {
  return String(host ?? '')
    .split(':')[0]
    .toLowerCase()
}

/**
 * Is this hostname the workspace apex or one of its subdomains?
 *
 * The complement — everything this returns false for — is the set a custom
 * console domain can live in, alongside localhost, preview deployments and
 * self-hosted installs. Nothing in that set may be assumed to be ours, which
 * is why the custom-domain gate answers with a Firestore lookup rather than a
 * pattern (AGL-1099).
 */
export function isWorkspaceDomainHost(host: string | null | undefined): boolean {
  const hostname = hostnameOf(host)
  return (
    hostname === WORKSPACE_DOMAIN || hostname.endsWith(`.${WORKSPACE_DOMAIN}`)
  )
}

/**
 * The workspace slug a hostname names, or `null` when it names none.
 *
 * `null` means "not a workspace subdomain" — the apex, a reserved label, a
 * preview/localhost host, or a deeper nesting. It does NOT mean the slug is
 * unknown; that question needs the `orgSlugs` lookup, which is a network call
 * and deliberately not this function's job.
 */
export function workspaceSlugFromHost(host: string | null): string | null {
  const hostname = hostnameOf(host)
  if (!hostname || !hostname.endsWith(`.${WORKSPACE_DOMAIN}`)) return null
  const slug = hostname.slice(0, -(WORKSPACE_DOMAIN.length + 1))
  if (!slug || slug.includes('.') || APEX_LABELS.has(slug)) return null
  return slug
}

/**
 * Whether a hostname is one the console may legitimately be served on,
 * given an already-resolved verdict for its workspace slug.
 *
 * Split from the lookup so it can be unit-tested without a network, and so
 * the session route and the middleware answer the question the same way.
 */
export function isServableWorkspaceHost(
  host: string | null,
  isKnownSlug: (slug: string) => boolean,
): boolean {
  const hostname = hostnameOf(host)
  // Non-workspace hosts (localhost, *.vercel.app, self-hosted domains) are
  // not this gate's business — it only governs the workspace domain. A custom
  // console domain lands here too, and is governed by `resolveConsoleDomain`.
  if (!isWorkspaceDomainHost(hostname)) return true
  const slug = workspaceSlugFromHost(hostname)
  // The apex and the reserved labels serve the console by design.
  if (slug === null) return true
  return isKnownSlug(slug)
}
