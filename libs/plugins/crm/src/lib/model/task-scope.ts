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

import {
  consentGroupForHost,
  type CrmTask,
  hostScopeToken,
  MAX_SCOPE_HOSTS,
  ORG_SCOPE_TOKEN,
  type ScopeToken,
} from '@aglyn/aglyn'

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
 * is: `crmTaskReadTokens` below puts the org token first for every site.
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

/**
 * The `visibleTo` tokens a tasks READ filters on, for a site (AGL-2599).
 *
 * The same expression the contacts list runs — the org token, because an
 * org-wide record is visible from every site, plus one token per site in the
 * group this site presents as — so a task listed beside a contact is scoped
 * by exactly the predicate that admitted the contact. Capped at what
 * `array-contains-any` accepts, like every other reader of it.
 *
 * Takes the org document as OPTIONAL because two of its callers do not hold
 * one: the dashboard widget and the record card are handed a host id and
 * nothing else. `consentGroupForHost` resolves an absent org to the group of
 * one, so the answer narrows to `['org', 'host:{this}']` rather than
 * widening — and a task created on a grouped sibling carries every sibling's
 * token, so it still matches from here.
 */
export function crmTaskReadTokens(
  org: Record<string, unknown> | null | undefined,
  hostId: string,
): ScopeToken[] {
  const group = consentGroupForHost(org ?? null, hostId)
  return [ORG_SCOPE_TOKEN, ...group.hostIds.map(hostScopeToken)].slice(
    0,
    MAX_SCOPE_HOSTS,
  )
}
