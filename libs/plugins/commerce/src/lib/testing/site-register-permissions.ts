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
 * The register's `managePos` as `resolveOrgPermissions(uid, { hostId })`
 * resolves it for one site (AGL-4047), for the specs that fake that resolver
 * now that the POS routes ask it alone and no longer read the site's
 * `memberRoles` themselves.
 *
 * Someone with no access to the site holds nothing. Otherwise the site
 * role's default decides — on for admin and editor, off for author and
 * viewer, the tier defaults `managePos` is declared with — unless a role or
 * an override `granted` or refused it.
 */
export const SITE_ROLE_REGISTER_DEFAULTS: Readonly<Record<string, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

export function siteRegisterVerdict(
  memberRoles: Readonly<Record<string, unknown>> | null | undefined,
  uid: string,
  granted?: boolean,
): boolean {
  const role = memberRoles?.[uid]
  if (typeof role !== 'string' || !role) return false
  return typeof granted === 'boolean' ? granted : SITE_ROLE_REGISTER_DEFAULTS[role] === true
}
