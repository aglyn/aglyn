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

import type { ConsolePluginOrgHost, ConsolePluginOrgMount } from '@aglyn/aglyn'

/**
 * The organization the Automation hub is mounted over at `/[orgSlug]/automation`
 * (AGL-3302): the shell's org mount, with the hub's own path beside it.
 *
 * Handed to each org card as a prop rather than through a context — the org
 * cards are the page's direct children, and a card that needs no site never
 * has to wonder whether it is under one.
 */
export interface WorkflowsOrgMount {
  orgId: string
  orgSlug: string
  /** The org's sites, as the shell resolved them. */
  hosts: readonly ConsolePluginOrgHost[]
  /** False until `hosts` has settled; an empty list before then means nothing. */
  hostsReady: boolean
  /** `/[orgSlug]/hosts` — every site's own hub hangs beneath it. */
  hostsPath: string
  /** The org Automation hub's own path, `/[orgSlug]/automation`. */
  basePath: string
}

/** The shell's org mount, as the Automation cards read it. */
export function workflowsOrgMount(
  orgMount: ConsolePluginOrgMount | undefined,
  basePath: string | undefined,
): WorkflowsOrgMount | null {
  if (!orgMount || !basePath) return null
  return {
    orgId: orgMount.orgId,
    orgSlug: orgMount.orgSlug,
    hosts: orgMount.hosts,
    hostsReady: orgMount.hostsReady,
    hostsPath: orgMount.hostsPath,
    basePath,
  }
}

/** A site's display name from the mount, or its id when the mount lacks it. */
export function orgSiteName(
  mount: Pick<WorkflowsOrgMount, 'hosts'>,
  hostId: string,
): string {
  return mount.hosts.find((host) => host.id === hostId)?.name || hostId
}

/**
 * One site's own Automation hub — `/[orgSlug]/hosts/{subdomain}/automation`,
 * optionally at one of its sections — or `null` when the site is not in the
 * mount or has no subdomain yet, which a row names and does not link.
 */
export function orgSiteAutomationPath(
  mount: Pick<WorkflowsOrgMount, 'hosts' | 'hostsPath'>,
  hostId: string,
  section?: string,
): string | null {
  const subdomain = mount.hosts.find((host) => host.id === hostId)?.subdomain
  if (!subdomain) return null
  const hub = `${mount.hostsPath}/${encodeURIComponent(subdomain)}/automation`
  return section ? `${hub}/${section}` : hub
}

/** The org's sites as picker options, by name. */
export function orgSiteOptions(
  mount: Pick<WorkflowsOrgMount, 'hosts'>,
): Array<{ value: string; label: string }> {
  return mount.hosts.map((host) => ({
    value: host.id,
    label: host.name || host.subdomain || host.id,
  }))
}
