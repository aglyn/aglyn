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

/*
 * Named beneath the entry barrel, not `@aglyn/aglyn`: the save and complete
 * routes import this module, and the barrel reaches the console's React
 * contexts, which the App Router's server graph refuses (AGL-405).
 */
import type { CrmTask } from '@aglyn/aglyn/app-utils/crm'
import {
  ORG_SCOPE_TOKEN,
  type ScopeToken,
} from '@aglyn/aglyn/app-utils/scope-tokens'

/**
 * The `visibleTo` an ORGANIZATION task carries (AGL-2637): a task filed
 * from the org hub with no site, `hostId: null`.
 *
 * The org token alone — the token every read set leads with, whether the
 * reader is an org-wide member (the rules admit them to every row) or a
 * site collaborator (whose projected read set is `['org', 'host:…']`). So
 * an organization task is listed from the org hub, where a listener
 * carries no scope clause, AND from every site the organization owns,
 * exactly as a record the org widened to `defaultResourceScope: 'org'`
 * is: `crmReadTokens` puts the org token first in every site's read set.
 * What sets it apart from a widened site task is its `hostId`, not its
 * scope — see {@link isOrgTask}.
 *
 * Frozen and shared rather than built per call because a creator that
 * spelled it as `[]` would make a task nobody's listener can match.
 */
export const CRM_ORG_TASK_SCOPE: readonly ScopeToken[] = Object.freeze([
  ORG_SCOPE_TOKEN,
])

/**
 * Whether a task is the organization's own — created with no site.
 *
 * The site is provenance and the one fact that tells an organization task
 * from a site's task the org has widened: both carry the org token. A
 * completion of an org task emits no host event, because there is no site
 * whose automations could hear it.
 */
export function isOrgTask(task: Pick<Partial<CrmTask>, 'hostId'>): boolean {
  return !task.hostId
}
