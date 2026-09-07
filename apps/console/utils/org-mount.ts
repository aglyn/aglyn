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

import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { buildRoute, Route } from '../constants/route-links'

/** A host document as `useOrgHosts` hands it back — the two fields the mount reads off it. */
export interface OrgMountHostDoc {
  $id: string
  displayName?: unknown
  subdomain?: unknown
}

/**
 * The organization-level mount a plugin surface is handed when it is mounted
 * with no site (AGL-2630, AGL-2636): the org, its sites as a record names
 * them, and the path every site's own hub hangs beneath.
 *
 * Built in ONE place for the two console pages that mount plugin surfaces at
 * the org level — the org CRM hub and the org's sites page — so the two
 * cannot disagree on how a site reads. A record holds host document ids; a
 * console URL takes the subdomain; a person reads the name. The name falls
 * back to the subdomain and then to the id, so a site the list could not
 * name is still named rather than blank, and the subdomain is `null` for a
 * site the list could not link, which a consumer names and does not link.
 *
 * `undefined` until the workspace has resolved: a mount naming no org is a
 * surface mounted nowhere, and every consumer holds on it rather than
 * guessing.
 */
export function resolveOrgMount(input: {
  orgId: string | undefined
  orgSlug: string
  hosts: readonly OrgMountHostDoc[]
  hostsReady: boolean
}): ConsolePluginOrgMount | undefined {
  const { orgId, orgSlug, hosts, hostsReady } = input
  if (!orgId) return undefined
  return {
    orgId,
    hosts: hosts.map((host) => {
      const displayName =
        typeof host.displayName === 'string' ? host.displayName : ''
      const subdomain = typeof host.subdomain === 'string' ? host.subdomain : ''
      return {
        id: host.$id,
        name: displayName || subdomain || host.$id,
        subdomain: subdomain || null,
      }
    }),
    hostsReady,
    hostsPath: buildRoute(Route.HOST_LIST, { orgSlug }),
  }
}

export default resolveOrgMount
