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
 * CONSENT GROUPS — the declared unit a marketing basis is given to.
 *
 * ## The two organizations this exists to serve at once
 *
 * An AGENCY runs twelve unrelated client brands out of one account. A person
 * who ticked a box on one client's form has agreed to hear from that client
 * and from nobody else, and mailing them on behalf of the other eleven is a
 * consent violation whatever the account structure says.
 *
 * A SINGLE BUSINESS runs three sites — a shop, a booking page, a blog — under
 * one name. It collects addresses on all three and mails them from any of
 * them, because there is one controller and one brand and the visitor knows
 * it. Refusing that is not caution, it is a product that cannot serve a
 * perfectly ordinary customer.
 *
 * The org boundary cannot tell them apart, and neither can anything else the
 * database already holds. So the difference is DECLARED: a group names the
 * sites that are one sender. Undeclared, every site is its own group of one,
 * which is the agency's answer and costs the agency nothing to get right.
 *
 * ## ⛔ NOTHING HERE IS INFERRED
 *
 * Not from shared ownership, not from a shared org, not from a shared sending
 * domain, not from a shared theme. Sharing an account is a billing fact.
 * There is exactly one input — {@link CONSENT_GROUPS_FIELD} on the org — and
 * a site that is not named in it is alone.
 *
 * ## A group must be DISCLOSABLE, so it must have a NAME
 *
 * Pooling is only legitimate if the person was told about it: the checkbox
 * has to say who they will hear from. A group with no display name cannot be
 * rendered on a capture surface, so it cannot be disclosed, so it does not
 * pool — {@link consentGroupForHost} returns the group of one for every site
 * in a nameless group rather than pooling silently. That refusal is the whole
 * mechanism by which "declared" is stronger than "configured".
 *
 * ## Pooling applies FORWARD only
 *
 * A grant records the group AS DISCLOSED at the moment it was given, in the
 * entry itself, and every covered site gets its own entry. Adding a site to a
 * group therefore reaches captures made after the change and none made
 * before. An org-level switch that widened existing grants would be the leak
 * wearing a different hat: the people already on the list were told a
 * different thing.
 *
 * OPT-OUT runs the other way — read against the CURRENT group, so a site
 * joining a group inherits every refusal already standing against it. The
 * asymmetry is the same one the rest of this area keeps: a permissive fact is
 * written narrowly and read exactly, a restrictive fact is read as broadly as
 * it could possibly apply.
 *
 * ## VISIBILITY IS A SEPARATE AXIS
 *
 * Seeing a contact is not permission to mail them. A group decides consent
 * and opt-out; `visibleTo` decides who can read the row, and an org may
 * widen that for reporting while consent stays where it was given. The two
 * are resolved by different functions on purpose, and neither reads the
 * other.
 */

import { hostScopeToken, MAX_SCOPE_HOSTS, type ScopeToken } from './scope-tokens'

/**
 * The org field holding the declarations:
 * `{ [groupId]: { name, hostIds } }`.
 *
 * On the org rather than on each host, because a group is a statement ABOUT
 * a set and a set stored as N per-host pointers can disagree with itself —
 * site A naming a group that site B has left is a half-declared controller,
 * and there is no reading of that which is safe to pool on.
 */
export const CONSENT_GROUPS_FIELD = 'consentGroups'

/**
 * The most sites one group may name.
 *
 * The same ceiling `visibleTo` carries, and for a related reason: the send
 * path reads a group's opt-out lists in one `getAll`, so the group multiplies
 * that round trip's size. It is also a sanity bound on a disclosure — a
 * checkbox that has to name forty brands has not disclosed anything.
 */
export const MAX_CONSENT_GROUP_HOSTS = MAX_SCOPE_HOSTS

/** One declared group, as stored. */
export interface StoredConsentGroup {
  /** Shown on the capture surface. Without it the group cannot pool. */
  name: string
  /** The sites that are one sender. */
  hostIds: string[]
}

/**
 * The group a host belongs to, resolved FOR that host.
 *
 * It carries the asking site as well as the set, which is what lets one value
 * be passed where both are needed. Every consent read needs both — the grant
 * is looked up under the asking site, while a refusal is honored across the
 * whole group — and two arguments that must agree is two arguments that can
 * disagree.
 */
export interface ConsentGroup {
  /** The site this was resolved for. Always a member of {@link hostIds}. */
  hostId: string
  /**
   * The group's id, or the host's own id for an undeclared site.
   *
   * Recorded on every grant so a stored basis says which controller it was
   * given to even after the declaration changes.
   */
  groupId: string
  /**
   * What the capture surface must display. `null` for a group of one, where
   * the site's own name is what a form already shows and inventing a second
   * one would put a name in front of a person that nothing else uses.
   */
  name: string | null
  /** Every site covered, sorted, always including the host asked about. */
  hostIds: string[]
  /** False for the implicit group of one. */
  declared: boolean
}

/**
 * The group of one — a site that has declared no pooling.
 *
 * Exported because it is a value callers state deliberately: a writer that
 * means "this site only" says so, rather than passing a host id and letting
 * a helper decide what it covers.
 */
export function soloConsentGroup(hostId: string): ConsentGroup {
  if (!hostId) {
    throw new Error('[consent-groups] a consent group must name a site')
  }
  return {
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }
}

/**
 * Reads the declared groups off an org document, dropping every entry that
 * cannot be honored.
 *
 * A malformed declaration reads as ABSENT, never as a wider group: the whole
 * value of this field is that pooling is deliberate, and a corrupt value must
 * not be a way to reach an audience nobody declared.
 *
 * The four refusals, each of which would otherwise pool without a disclosure:
 *
 *  - **no usable name** — cannot be shown on a form, so cannot be disclosed;
 *  - **fewer than two sites** — not a pooling declaration, and a group of one
 *    is what an undeclared site already gets;
 *  - **over {@link MAX_CONSENT_GROUP_HOSTS}** — see that constant;
 *  - **a site claimed by two groups** — two controllers claiming one site is
 *    a contradiction, not a wider group, so BOTH claims are dropped and the
 *    site falls back to being alone.
 */
export function readConsentGroups(
  org: Record<string, unknown> | null | undefined,
): Record<string, StoredConsentGroup> {
  const raw = (org ?? {})[CONSENT_GROUPS_FIELD]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const usable: Record<string, StoredConsentGroup> = {}
  for (const [groupId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!groupId || !value || typeof value !== 'object') continue
    const group = value as Record<string, unknown>
    const name = typeof group['name'] === 'string' ? group['name'].trim() : ''
    if (!name) continue
    const hostIds = Array.isArray(group['hostIds'])
      ? [
          ...new Set(
            (group['hostIds'] as unknown[])
              .map((id) => String(id ?? '').trim())
              .filter(Boolean),
          ),
        ].sort()
      : []
    if (hostIds.length < 2 || hostIds.length > MAX_CONSENT_GROUP_HOSTS) continue
    usable[groupId] = { name, hostIds }
  }
  /*
   * The overlap pass, second because it needs every survivor of the first.
   * A site named by two groups is dropped from BOTH — the alternative is
   * picking one, and a coin flip is not a declaration.
   */
  const claims = new Map<string, number>()
  for (const group of Object.values(usable)) {
    for (const hostId of group.hostIds) {
      claims.set(hostId, (claims.get(hostId) ?? 0) + 1)
    }
  }
  const contested = new Set(
    [...claims.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  )
  if (!contested.size) return usable
  const settled: Record<string, StoredConsentGroup> = {}
  for (const [groupId, group] of Object.entries(usable)) {
    if (group.hostIds.some((hostId) => contested.has(hostId))) continue
    settled[groupId] = group
  }
  return settled
}

/**
 * The group `hostId` belongs to — the declared one, or the group of one.
 *
 * The ONLY way any caller learns what a site's consent covers. A caller that
 * built its own set from `org.hosts`, or from a sending domain, or from a
 * theme, would be inferring a controller, which is the thing this module
 * exists to make impossible.
 */
export function consentGroupForHost(
  org: Record<string, unknown> | null | undefined,
  hostId: string,
): ConsentGroup {
  if (!hostId) {
    throw new Error('[consent-groups] a consent group must name a site')
  }
  for (const [groupId, group] of Object.entries(readConsentGroups(org))) {
    if (!group.hostIds.includes(hostId)) continue
    return {
      hostId,
      groupId,
      name: group.name,
      hostIds: [...group.hostIds],
      declared: true,
    }
  }
  return soloConsentGroup(hostId)
}

/**
 * The `visibleTo` a resource captured by this group starts with.
 *
 * A separate function from anything above, called by the capture doors and
 * by nothing that decides mailability, because visibility and consent are
 * different questions with different answers. A group of one produces
 * `['host:{id}']` — the isolation an agency needs, arrived at without the
 * agency configuring anything.
 */
export function consentGroupScope(group: ConsentGroup): ScopeToken[] {
  return group.hostIds.map(hostScopeToken)
}

/**
 * The sentence a capture surface must show beside the checkbox, or `null`
 * when the site's own name already says it.
 *
 * Returned as text rather than a boolean so that the disclosure and the
 * grant come from ONE resolved group: a form that rendered its own wording
 * from a separate lookup could show one set of brands and record another,
 * and the recorded set is the one that decides who mails this person.
 */
export function consentGroupDisclosure(group: ConsentGroup): string | null {
  if (!group.declared || !group.name) return null
  return `You'll receive marketing email from ${group.name}, which covers ${group.hostIds.length} sites.`
}
