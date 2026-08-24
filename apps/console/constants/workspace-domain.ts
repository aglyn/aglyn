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

// `import type`, deliberately: this module is imported by `middleware.ts`,
// which is bundled for the edge runtime. A value import of
// `@aglyn/tenant-feature-instance` would drag the Firebase client SDK in
// behind it. A type-only import is erased at compile time, so the edge
// bundle is unchanged and the two files still agree on the union.
import type { AuthPersistenceClass } from '@aglyn/tenant-feature-instance'

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

/**
 * Hostnames that are this deployment's own, and are not reachable from
 * anyone else's DNS.
 *
 * Not the workspace domain — that is `isWorkspaceDomainHost`'s job and it is
 * env-derived. These are the two families that serve the console *outside*
 * the workspace domain and are still ours: the developer's own machine, and
 * Vercel preview deployments. Neither can be re-pointed by a customer, so
 * neither needs the treatment a custom console domain gets.
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const PREVIEW_HOST_SUFFIX = '.vercel.app'

/**
 * How much this origin may keep on disk (AGL-1099c, closing the declaration
 * AGL-1379 and AGL-1456 were built to receive).
 *
 * `FirebaseServicesProvider` takes an `authPersistence` prop that selects the
 * `Auth` persistence class **and** the Firestore `localCache`. Both halves
 * were built; both defaulted to `durable`; **nobody ever passed the prop**.
 * So a custom console domain — the one origin the whole mechanism exists to
 * protect — would have left a Firebase refresh token in plaintext in
 * IndexedDB, plus cached document bodies beside it, on a hostname whose DNS
 * the customer can re-point at their own server after a detach. That is the
 * durable account-takeover primitive `docs/design/agl-1099a-cross-domain-session-handoff.md`
 * §9.3 is about, and no cookie TTL, `sessionEpoch` bump or 421 reaches it:
 * `securetoken.googleapis.com` is **not** App Check enforced, so a refresh
 * token off that origin is exchangeable for ID tokens from anywhere, forever,
 * until someone calls `revokeRefreshTokens` by hand.
 *
 * ## Why this is a host test and not a lookup
 *
 * The class has to be decided **before** the first network call — it is an
 * argument to `initializeAuth`, which happens while the provider is being
 * constructed. `resolveConsoleDomain` is a Firestore read and cannot be
 * awaited there. A pattern is the wrong tool for *routing* (which is why the
 * middleware asks the verdict route instead), but it is the right tool here,
 * because the two questions are not the same question:
 *
 * - *"Which org does this host serve?"* — must be a lookup. Guessing invents
 *   an answer, and AGL-1135 is what that costs.
 * - *"Is this host one whose disk we control?"* — is knowable from the name
 *   alone, and the honest default for a name we do not recognise is **no**.
 *
 * ## The polarity is the load-bearing part
 *
 * `durable` is an allowlist and everything else is `ephemeral`, never the
 * inverse. The two failure modes are not symmetric:
 *
 * - A host wrongly called `ephemeral` costs a re-authentication.
 * - A host wrongly called `durable` writes a refresh token to an origin
 *   someone else can take over.
 *
 * So an unrecognised host — including a missing `Host` — resolves to
 * `ephemeral`. A self-hosted install that never sets
 * `NEXT_PUBLIC_WORKSPACE_DOMAIN` therefore lands on `ephemeral` and asks its
 * operators to sign in more often; that is the safe direction of a
 * misconfiguration, and setting the variable (which
 * `.env.selfhost.example` already documents) restores `durable`.
 */
export function originPersistenceClass(
  host: string | null | undefined,
): AuthPersistenceClass {
  const hostname = hostnameOf(host)
  if (!hostname) return 'ephemeral'
  if (isWorkspaceDomainHost(hostname)) return 'durable'
  if (LOCAL_HOSTNAMES.has(hostname)) return 'durable'
  if (hostname.endsWith(PREVIEW_HOST_SUFFIX)) return 'durable'
  return 'ephemeral'
}

/**
 * {@link originPersistenceClass} for the origin this browser is actually on.
 *
 * A named seam rather than an inline `window.location.host` at the call site,
 * for one reason worth stating: `window.location` is not redefinable under
 * this repo's jsdom — neither `defineProperty` nor delete-and-assign takes,
 * and the latter fails **silently**, leaving the host as `localhost`. A test
 * that tried to drive the layout by faking the location would therefore have
 * asserted `durable` on every host and passed while proving nothing. With the
 * read named here, the origin mapping is proved by
 * `originPersistenceClass`'s own cases, the browser read is proved by running
 * this function under a jsdom whose URL really is a custom domain, and the
 * layout's job shrinks to forwarding one value.
 *
 * Returns `ephemeral` off-browser: see the polarity note above.
 */
export function currentOriginPersistenceClass(): AuthPersistenceClass {
  return originPersistenceClass(
    typeof window === 'undefined' ? null : window.location.host,
  )
}
