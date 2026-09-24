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
 * EVERY first path segment this app actually routes (AGL-3017).
 *
 * `APEX_PATH_SEGMENTS` in `middleware.ts` is a different list for a different
 * job — the
 * paths the workspace-subdomain rewrite must not scope into an org — and it is
 * NOT the set of real routes. It omits `billing`, `edit-access`,
 * `reset-password` and `sso`, and two of those are credential flows, so using
 * it to decide what exists would have answered 404 to a password reset and to
 * SSO sign-in.
 *
 * `api` is absent because the matcher already excludes it, and segments
 * beginning `_` (Next's own `_next/data`, `_static`) are admitted by the
 * helper rather than listed, since their names are the framework's to change.
 *
 * `specs/console-top-level-routes.spec.ts` reads `app/` and fails when a route
 * exists that this set does not name. The set is only allowed to be complete.
 */
export const CONSOLE_TOP_LEVEL_SEGMENTS = new Set([
  'account-recovery',
  'admin',
  'auth',
  'billing',
  'edit-access',
  'manage',
  'reset-password',
  'signin',
  'signout',
  'signup',
  'sso',
  'support',
  'verify-email',
])

/** The root, a framework path, or a route this app declares. */
export function isConsoleRouteSegment(first: string): boolean {
  return first === '' || first.startsWith('_') || CONSOLE_TOP_LEVEL_SEGMENTS.has(first)
}

/**
 * First path segments that are never org-scoped (AGL-627). These live at the
 * apex path on every host, so the workspace-subdomain rewrite must leave them
 * alone or `/signin` would become `/{slug}/signin` and 404.
 *
 * Here rather than in `middleware.ts` so the client reads the same list when
 * it rebuilds the path the rewrite produced (AGL-3314): a second copy is how
 * the switcher came to read `/hosts` as a workspace named "hosts".
 */
export const APEX_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  'manage',
  'admin',
  // The cross-domain handoff legs (AGL-1902). `/auth/handoff`,
  // `/auth/handoff/start` and `/auth/handoff/continue` are platform routes, not
  // anything inside an org, and rewriting them to `/{slug}/auth/handoff` would
  // 404 the one flow that exists to get a session onto a custom domain.
  'auth',
  'signin',
  'signout',
  'signup',
  'verify-email',
  'account-recovery',
])

/**
 * The org-scoped pathname a host that names a workspace serves, or `null`
 * when the path needs no rewrite — THE rule, shared by the middleware that
 * rewrites and the client that has to read what it rewrote (AGL-3314).
 *
 * Routes are canonically `/[orgSlug]/…`, but on a host that already names the
 * org the path must not repeat it (AGL-627): `acme.aglyn.com/hosts/x`, never
 * `acme.aglyn.com/acme/hosts/x`. Account, staff and auth routes live at the
 * apex path on every host and must not be rewritten, and an already-prefixed
 * path passes through so canonical links keep working.
 */
export function orgScopedPathname(pathname: string, slug: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0]
  if (!slug || first === slug || APEX_PATH_SEGMENTS.has(first ?? '')) return null
  return `/${slug}${pathname === '/' ? '' : pathname}`
}

/**
 * The console's not-found page at an address of its own (AGL-3290), which the
 * middleware's refusal of an address that names no workspace forwards to.
 * `app/%5Fmissing/page.tsx` says why it cannot be the typed address itself.
 */
export const NOT_FOUND_ROUTE = '/_missing'

/** The query parameter on {@link NOT_FOUND_ROUTE} naming the address that was not found. */
export const NOT_FOUND_FROM_PARAM = 'from'
