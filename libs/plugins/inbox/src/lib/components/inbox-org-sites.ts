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

/**
 * How the organization's Inbox names a site (AGL-3303).
 *
 * A row holds a host DOCUMENT ID and a person reads a NAME; the shell's mount
 * carries both for every site the reader may open. A site the mount cannot
 * name is shown by its id rather than left blank — the row is real either way.
 */
export function orgSiteName(
  mount: ConsolePluginOrgMount | null | undefined,
  hostId: unknown,
): string {
  if (typeof hostId !== 'string' || !hostId) return ''
  return mount?.hosts.find((host) => host.id === hostId)?.name || hostId
}

/** Every site a lead was captured by, by name, in capture order. */
export function orgSiteNames(
  mount: ConsolePluginOrgMount | null | undefined,
  hostIds: unknown,
): string {
  return (Array.isArray(hostIds) ? hostIds : [])
    .map((hostId) => orgSiteName(mount, hostId))
    .filter(Boolean)
    .join(', ')
}
