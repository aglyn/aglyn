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
 * Drop the leading `/{orgSlug}` from a console href when the browser is
 * already on that org's workspace subdomain (AGL-627).
 *
 * On `acme.aglyn.io` the org IS the hostname, so repeating it in the path
 * reads as `acme.aglyn.io/acme/hosts/x`. Routes stay canonically
 * `/[orgSlug]/…` underneath — middleware rewrites the segment back in — so
 * this is presentation only and is always safe to skip.
 *
 * Deliberately narrow:
 * - only strips the slug of the org whose subdomain we are on, never another
 *   org's, or a cross-org link would silently point at the wrong workspace;
 * - leaves apex routes (`/manage`, `/admin`, auth) untouched, since they are
 *   not org-scoped and the middleware refuses to rewrite them back;
 * - returns `/` rather than an empty string for the org root, which is not a
 *   valid href.
 */
export function stripWorkspaceOrgPrefix(
  href: string,
  options: { orgSlug?: string | null; onWorkspaceSubdomain?: boolean },
): string {
  const { orgSlug, onWorkspaceSubdomain } = options
  if (!onWorkspaceSubdomain || !orgSlug) return href
  if (!href.startsWith('/')) return href
  if (href !== `/${orgSlug}` && !href.startsWith(`/${orgSlug}/`)) return href
  const stripped = href.slice(`/${orgSlug}`.length)
  return stripped === '' ? '/' : stripped
}

export default stripWorkspaceOrgPrefix
