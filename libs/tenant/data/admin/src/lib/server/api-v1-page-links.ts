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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { besignerOpenDraftHref } from '@aglyn/aglyn/app-utils/version-draft'

/**
 * Where a page opens in the editor, as an absolute link an API response can
 * hand a person (AGL-4235): the console's own Besigner route for the page's
 * version, `https://app…/{orgSlug}/hosts/{subdomain}/screens/{pageId}/versions/{versionId}/besigner`,
 * and with `draft` the address that opens the version's saved draft on
 * arrival (`?draft=open`), which is where an API edit waits.
 *
 * A console URL names a workspace by its slug and a site by its SUBDOMAIN, as
 * every console link does, never by document id. Without either there is no
 * address that opens the site, so the answer is null rather than a link that
 * opens nothing.
 */
export function pageEditorUrl(input: {
  orgSlug: unknown
  subdomain: unknown
  pageId: string
  versionId: string
  /** Open the version's draft, not the version. */
  draft: boolean
  /** The console's origin; the deployment's own when absent. */
  origin?: string
}): string | null {
  const orgSlug = typeof input.orgSlug === 'string' ? input.orgSlug : ''
  const host = typeof input.subdomain === 'string' ? input.subdomain : ''
  if (!orgSlug || !host || !input.pageId || !input.versionId) return null
  const path = buildRoute(Route.SCREEN_BESIGNER, {
    orgSlug: encodeURIComponent(orgSlug),
    host: encodeURIComponent(host),
    screenId: encodeURIComponent(input.pageId),
    versionId: encodeURIComponent(input.versionId),
  })
  return `${input.origin ?? platformConsoleOrigin()}${input.draft ? besignerOpenDraftHref(path) : path}`
}
