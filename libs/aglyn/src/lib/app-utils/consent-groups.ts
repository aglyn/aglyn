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
 * ## …and a grant pools only where the name was actually SHOWN
 *
 * Disclosable is not disclosed. A form rendered before the group existed, a
 * checkout that has never displayed the sentence, and a page cached across a
 * rename all capture under a declaration their visitor never read. So a
 * capture surface that renders {@link consentGroupDisclosure} sends back the
 * {@link consentGroupDisclosureKey} of what it rendered, and
 * {@link consentGroupForGrant} pools the grant only when that key matches the
 * group as it stands. Anything else — no key, a stale key, a surface that
 * never renders the sentence — records the capturing site alone. Visibility
 * is not narrowed with it: that axis follows the group, see below.
 *
 * ## Pooling applies FORWARD only
 *
 * A grant records the group AS DISCLOSED at the moment it was given, in the
 * entry itself, and every covered site gets its own entry. Adding a site to a
 * group therefore reaches captures made after the change and none made
 * before. An org-level switch that widened existing grants would be the leak
 * wearing a different hat: the people already on the list were told a
 * different thing. The same holds for a grant carried from one record to
 * another — a list enrollment, a lead becoming a contact: it is copied as it
 * was recorded, never re-derived from the group as it stands now.
 *
 * OPT-OUT runs the other way — read against the CURRENT group, so a site
 * joining a group inherits every refusal already standing against it. The
 * asymmetry is the same one the rest of this area keeps: a permissive fact is
 * written narrowly and read exactly, a restrictive fact is read as broadly as
 * it could possibly apply. Every opt-out the send paths consult is read this
 * way — the site suppression lists, the topic opt-outs and the recipient's
 * cadence (`email-suppression.ts`), and the consent refusal
 * (`marketing-consent.ts`) — and the preference pages lift one across the
 * group, since a person rejoining the sender has rejoined all of it.
 *
 * ## A pending CONFIRMATION is the asking site's, unless the org says the group waits
 *
 * A site that asks for a confirmation click holds its own mail on that stream
 * until the click comes. A pending question is not a refusal, so by default
 * the rule above does not carry it: the sibling sites go on mailing. An org
 * may turn {@link CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD} on, and then every
 * site of a declared group waits for the click the way the asking site does —
 * a pending entry on any of them holds the stream from all of them, read
 * across the CURRENT group exactly as a refusal is.
 *
 * The switch is resolved INTO the group ({@link ConsentGroup.awaitsConfirmation}),
 * so a send path already holding the group holds the answer and reads nothing
 * more for it. A group of one never waits on anybody: there is nobody else.
 * Off is the default and the absence, and an org that never set it reads
 * exactly the documents it read before the field existed.
 *
 * ⚠️ The one change that runs AGAINST reading is sites SEPARATING — a site
 * leaving a group, moving to another, or a group dissolving. A refusal is
 * stored on the site the person acted on, so once two sites stop being one
 * sender, each stops seeing the refusals filed against the other, and every
 * one of them was a refusal of the sender both sites were at the time. So a
 * change to this declaration carries them BOTH WAYS before it takes effect:
 * the sites that stay keep every opt-out filed on the site that leaves, and
 * the site that leaves keeps every opt-out filed on the sites it leaves —
 * the preference page promised the person that an opt-out from the group
 * covers all of it, and separating the sites must not quietly break that.
 * The consent group change (the pure plan in `consent-group-change.ts`, run
 * by the executor in `@aglyn/tenant-data-admin`, started from the Emails
 * hub's Consent groups section through `POST /api/orgs/consent-groups`) is
 * the one writer of this field, and it carries the site suppression rows,
 * the topic opt-outs, the pace and a contact's per-site refusal before it
 * flips the declaration.
 * A site that is in a group, or in a change still running, cannot be
 * deleted until it is out: deletion would destroy refusals a sibling still
 * reads.
 *
 * ## VISIBILITY IS A SEPARATE AXIS
 *
 * Seeing a contact is not permission to mail them. A group decides consent
 * and opt-out; `visibleTo` decides who can read the row, and an org may
 * widen that for reporting while consent stays where it was given. The two
 * are resolved by different functions on purpose, and neither reads the
 * other.
 */

import type { TopicSubscriptionState } from './email-topics'
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
 * The org field that makes a declared group's sites wait for each other's
 * confirmation click (AGL-3316): `true` is on; absent is off.
 *
 * One switch for the org beside {@link CONSENT_GROUPS_FIELD} rather than a
 * flag on each declaration, because a declaration decides WHICH sites are one
 * sender and this decides how the org treats a question one of them has put.
 * Written only by `/api/orgs/settings`; the rules deny both fields to every
 * client.
 */
export const CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD =
  'consentGroupsAwaitConfirmation'

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
  /**
   * Whether a confirmation one site of the group is waiting on holds the
   * other sites' mail too — the org's
   * {@link CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD}, for a declared group.
   * Always `false` for a group of one, which has no other site to hold.
   */
  awaitsConfirmation: boolean
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
    awaitsConfirmation: false,
  }
}

/**
 * Whether the org turned {@link CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD} on.
 *
 * Only a stored `true` is on. Absent, `false`, or anything a stray write left
 * is off — the state every org was in before the field existed.
 */
export function consentGroupsAwaitConfirmation(
  org: Record<string, unknown> | null | undefined,
): boolean {
  return (org ?? {})[CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD] === true
}

/**
 * Reads the declared groups off an org document, dropping every entry that
 * cannot be honored.
 *
 * A malformed declaration reads as ABSENT, never as a wider group: the whole
 * value of this field is that pooling is deliberate, and a corrupt value must
 * not be a way to reach an audience nobody declared.
 *
 * The five refusals, each of which would otherwise pool without a disclosure
 * or file one sender's records under another's key:
 *
 *  - **no usable name** — cannot be shown on a form, so cannot be disclosed;
 *  - **fewer than two sites** — not a pooling declaration, and a group of one
 *    is what an undeclared site already gets;
 *  - **over {@link MAX_CONSENT_GROUP_HOSTS}** — see that constant;
 *  - **an id that is a site's id** — a site that declared nothing uses its
 *    own id as its group id, so a group spelled the same way would share
 *    that site's key: its grant stamps, its opt-out lookups and the records
 *    the CRM files under the group id would read as the lone site's, and the
 *    lone site's as the group's. Checked against every site the org holds
 *    and every site any entry names, usable or not;
 *  - **a site claimed by two groups** — two controllers claiming one site is
 *    a contradiction, not a wider group, so BOTH claims are dropped and the
 *    site falls back to being alone.
 */
export function readConsentGroups(
  org: Record<string, unknown> | null | undefined,
): Record<string, StoredConsentGroup> {
  const raw = (org ?? {})[CONSENT_GROUPS_FIELD]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const siteIds = consentGroupSiteIds(org, raw as Record<string, unknown>)
  const usable: Record<string, StoredConsentGroup> = {}
  for (const [groupId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!groupId || !value || typeof value !== 'object') continue
    if (siteIds.has(groupId)) continue
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
 * Every id that names a site as far as the declaration can tell: the org's
 * own `hosts` and every site any raw entry names, including the entries the
 * other refusals will drop.
 *
 * Wider than the usable set on purpose. A group id that collides with a
 * site the org has not linked yet, or with a site named only by a broken
 * entry, is the same collision one edit later, and refusing it now costs a
 * declaration nothing a valid one would have.
 */
function consentGroupSiteIds(
  org: Record<string, unknown> | null | undefined,
  raw: Record<string, unknown>,
): Set<string> {
  const ids = new Set<string>()
  const hosts = (org ?? {})['hosts']
  if (Array.isArray(hosts)) {
    for (const id of hosts) if (typeof id === 'string' && id) ids.add(id)
  } else if (hosts && typeof hosts === 'object') {
    for (const id of Object.keys(hosts)) if (id) ids.add(id)
  }
  for (const value of Object.values(raw)) {
    const hostIds = (value as { hostIds?: unknown } | null)?.hostIds
    if (!Array.isArray(hostIds)) continue
    for (const id of hostIds) {
      const trimmed = String(id ?? '').trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return ids
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
      awaitsConfirmation: consentGroupsAwaitConfirmation(org),
    }
  }
  return soloConsentGroup(hostId)
}

/**
 * The org field a running consent group change marks itself with:
 * `{ changeId, phase, hostIds, … }`, present from the moment the change
 * starts until it has finished. Only its `hostIds` is read here.
 */
const CONSENT_GROUP_CHANGE_MARKER_FIELD = 'consentGroupsChange'

/** Why a site may not be deleted yet — see {@link consentGroupSiteHold}. */
export type ConsentGroupSiteHold =
  /** The site is one sender with other sites, under this group. */
  | { reason: 'grouped'; groupId: string; name: string }
  /** A consent group change naming the site has not finished. */
  | { reason: 'changing' }

/**
 * Whether deleting `hostId` would take refusals its consent group still
 * needs, and why — or `null` when the site may go (AGL-3320).
 *
 * A site's opt-outs are stored on the site and read across its group, so
 * erasing a grouped site erases refusals its siblings honor today, and
 * leaves the declaration naming a site that no longer exists. A site named
 * by a change still in progress is the same hazard in motion: the change
 * may be copying its opt-outs out, or relying on them being there. So the
 * site leaves its group first — which carries its refusals to the sites
 * that stay — and is deleted after.
 *
 * Deleting the whole organization is the one exception, and is the caller's
 * to make: nothing is left to read the refusals.
 */
export function consentGroupSiteHold(
  org: Record<string, unknown> | null | undefined,
  hostId: string,
): ConsentGroupSiteHold | null {
  if (!hostId) return null
  const group = consentGroupForHost(org, hostId)
  if (group.declared) {
    return { reason: 'grouped', groupId: group.groupId, name: group.name ?? '' }
  }
  const marker = (org ?? {})[CONSENT_GROUP_CHANGE_MARKER_FIELD]
  const changing = (marker as { hostIds?: unknown } | null | undefined)?.hostIds
  if (Array.isArray(changing) && changing.includes(hostId)) {
    return { reason: 'changing' }
  }
  return null
}

/**
 * The sites whose OPT-OUTS answer for mail sent by `group.hostId`, the
 * sending site first.
 *
 * Every site the group names, because a refusal filed against any of them is
 * a refusal of the sender — see "OPT-OUT runs the other way" above. The
 * sending site leads so a reader that treats its own record differently from
 * a sibling's (a sibling's pending confirmation holds the send only when the
 * group {@link ConsentGroup.awaitsConfirmation}) can tell them apart by
 * position. A group of one is the site alone.
 */
export function consentGroupOptOutHosts(
  group: Pick<ConsentGroup, 'hostId' | 'hostIds'>,
): string[] {
  const siblings = (group.hostIds ?? []).filter(
    (id) => typeof id === 'string' && id && id !== group.hostId,
  )
  return [group.hostId, ...new Set(siblings)]
}

/**
 * The sending site's standing on one stream, read across its group.
 *
 * `states` are the stream's states on {@link consentGroupOptOutHosts}' sites,
 * in that order, so the sending site's comes first. A refusal on any of them
 * is a refusal of the sender. The sending site's own pending confirmation
 * holds its mail; a sibling's holds it only when the group
 * {@link ConsentGroup.awaitsConfirmation}. The precedence is the one
 * `readTopicSubscriptionState` keeps within one entry: a refusal outranks a
 * pending question, and an expired question is still pending.
 */
export function consentGroupTopicState(
  group: Pick<ConsentGroup, 'awaitsConfirmation'>,
  states: readonly TopicSubscriptionState[],
): TopicSubscriptionState {
  const [own = 'subscribed', ...siblings] = states
  if (own === 'opted-out' || siblings.includes('opted-out')) return 'opted-out'
  if (own === 'pending') return 'pending'
  return group.awaitsConfirmation === true && siblings.includes('pending')
    ? 'pending'
    : 'subscribed'
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

/**
 * A short fingerprint of the disclosure a capture surface rendered, or
 * `null` when {@link consentGroupDisclosure} has nothing to render.
 *
 * The surface sends it back with the submission, and
 * {@link consentGroupForGrant} pools only when it still matches: a form
 * rendered before a rename, before a site joined, or before the group
 * existed at all carries a key that no longer does, and its grant narrows to
 * the site the person was on rather than reaching sites they were never told
 * about.
 *
 * Over the three things the sentence and the grant stand for — the group's
 * id, its name and its sites, sorted — serialized as JSON so no name can
 * run into an id. FNV-1a over the UTF-16 code units, which keeps it
 * synchronous and identical in the browser and on the server with nothing
 * to import. It is not a secret and proves no identity: it answers "was it
 * THIS disclosure", and a caller willing to lie could as easily lie about
 * the checkbox.
 */
export function consentGroupDisclosureKey(
  group: ConsentGroup,
): string | null {
  if (!consentGroupDisclosure(group)) return null
  const text = JSON.stringify([
    group.groupId,
    group.name,
    [...group.hostIds].sort(),
  ])
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The group a GRANT is recorded for: `group` itself only when it is declared
 * and `disclosureKey` is exactly its current {@link consentGroupDisclosureKey};
 * otherwise the capturing site alone.
 *
 * Called by every door that records a grant, with whatever key the capture
 * surface sent back — none, for every surface that does not render the
 * disclosure. Narrow is the failure direction on purpose: a grant that should
 * have pooled and did not withholds mail from a sibling site, where one that
 * pooled on a sentence nobody saw sends it.
 *
 * Only the grant narrows. The same capture still stamps `visibleTo` from the
 * whole group, and still reads refusals across it: who may SEE a person and
 * who may MAIL them are separate questions — see the module note.
 */
export function consentGroupForGrant(
  group: ConsentGroup,
  disclosureKey: string | null | undefined,
): ConsentGroup {
  const expected = consentGroupDisclosureKey(group)
  if (expected !== null && disclosureKey === expected) return group
  return soloConsentGroup(group.hostId)
}
