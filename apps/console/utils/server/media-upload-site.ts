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

import { defaultScopeForNewResource } from '@aglyn/aglyn/server'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin'
import { type MediaScope, type MediaScopeError, scopeAllows } from './media-scope'

/** The refusal for a site id that is not one of the organization's sites. */
export const UPLOAD_SITE_NOT_IN_ORG = 'That site is not one of this organization’s'

/** The refusal for a site outside the uploader's own access. */
export const UPLOAD_SITE_OUT_OF_REACH =
  'Your access to this organization does not reach that site'

/**
 * The site an upload into the ORGANIZATION library was made from, once it has
 * been checked — the input the org's Default sharing needs.
 *
 * The media library names the site as `forHostId` on the requests that create
 * an asset, wherever a site is on screen: a site's Media tab, and the picker
 * opened for a site. With the org's `defaultResourceScope` set to `'host'`,
 * `defaultScopeForNewResource` shares the new asset with that site alone, so
 * the id is a client claim that decides who can use the file. It is honored
 * only when both of these hold:
 *
 *  * It is one of THIS org's sites. `hostIndex` is the mirror a site page
 *    resolves its org from, so an upload made on one cannot disagree with it.
 *    Another org's site would stamp a token that no site and no scoped member
 *    of this org holds: a file only the org's admins could ever find again.
 *  * The uploader's own access covers the scope it produces. A scoped member
 *    naming a site outside their access would upload a file they cannot see
 *    afterwards, which is the create the rules' `canCreateScoped()` refuses
 *    for the documents clients write themselves.
 *
 * Both are refused rather than widened to All sites. Widening is the direction
 * that shows a file to sites nobody chose.
 *
 * No site is a settled answer rather than an error: the organization Media
 * page has none, and a site's OWN library is private by construction and
 * stores no scope, so neither has anything to narrow.
 */
export async function resolveUploadSite(
  scope: Pick<
    MediaScope,
    'collection' | 'orgId' | 'billing' | 'viewerTokens' | 'viewerOrgWide'
  >,
  body: Record<string, unknown> | undefined,
): Promise<{ hostId: string | null } | { error: MediaScopeError }> {
  if (scope.collection !== 'orgs') return { hostId: null }
  const hostId = String(body?.['forHostId'] ?? '').trim()
  if (!hostId) return { hostId: null }
  // A slash is never part of a document id, and `doc()` would throw on it.
  if (hostId.includes('/') || (await resolveOrgIdForHost(hostId)) !== scope.orgId) {
    return { error: { status: 400, message: UPLOAD_SITE_NOT_IN_ORG } }
  }
  // The scope the upload will be written with — so a site the org's setting
  // ignores (All sites) is never refused over a narrowing that will not happen.
  const visibleTo = defaultScopeForNewResource({
    defaultResourceScope: (scope.billing as {
      defaultResourceScope?: 'org' | 'host'
    }).defaultResourceScope,
    hostId,
  })
  if (!scopeAllows(scope, visibleTo)) {
    return { error: { status: 403, message: UPLOAD_SITE_OUT_OF_REACH } }
  }
  return { hostId }
}
