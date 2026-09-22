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
