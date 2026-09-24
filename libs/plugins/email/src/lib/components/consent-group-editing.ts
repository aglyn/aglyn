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
 * The consent group editor's arithmetic, kept pure so every rule it applies
 * can be asserted without rendering a dialog.
 *
 * The dialog edits ONE group — a new one, or an existing one renamed, grown,
 * shrunk or dissolved — but the route takes the org's WHOLE next declaration.
 * Everything here turns the first into the second, and says in plain terms
 * what that second one changes, so the review step can be written from it.
 */

import {
  consentGroupDisclosure,
  CONSENT_GROUPS_FIELD,
  readConsentGroups,
} from '@aglyn/aglyn/app-utils/consent-groups'
import {
  CONSENT_GROUP_MIN_HOSTS,
  CONSENT_GROUP_NAME_MAX,
  MAX_CONSENT_GROUP_HOSTS,
  type ConsentGroupDeclarationEntry,
} from './consent-groups-api'

/** A declared group the org honors today, with its id. */
export interface ListedConsentGroup {
  id: string
  name: string
  /** Sorted, as `readConsentGroups` returns them. */
  hostIds: string[]
}

/**
 * The org's usable groups, sorted by name.
 *
 * Only what `readConsentGroups` honors: a stored entry it drops pools nobody
 * today, so it is not offered for editing, and the route removes it with the
 * next change (the review lists it). Sorted because a map's key order is not
 * something two readers agree on, and a table that reshuffled between loads
 * would read as a change.
 */
export function listConsentGroups(
  org: Record<string, unknown> | null | undefined,
): ListedConsentGroup[] {
  return Object.entries(readConsentGroups(org))
    .map(([id, group]) => ({ id, name: group.name, hostIds: [...group.hostIds] }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id),
    )
}

/**
 * How many stored entries nothing honors — no name, too few or too many
 * sites, or a site another group also claims.
 */
export function unusableConsentGroupCount(
  org: Record<string, unknown> | null | undefined,
): number {
  const raw = (org ?? {})[CONSENT_GROUPS_FIELD]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0
  const usable = readConsentGroups(org)
  return Object.keys(raw as Record<string, unknown>).filter(
    (id) => !(id in usable),
  ).length
}

/**
 * The raw declaration a change is made against — what the route compares
 * with what it holds, so a change somebody else made in the meantime is
 * refused instead of silently overwritten.
 */
export function expectedConsentGroups(
  org: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const raw = (org ?? {})[CONSENT_GROUPS_FIELD]
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

/**
 * The sentence a group's signup forms show, for a group that may not exist
 * yet. The same function the forms call, so what the editor promises is
 * character for character what a visitor reads.
 */
export function draftDisclosure(
  name: string,
  hostIds: readonly string[],
  groupId = 'draft',
): string | null {
  const trimmed = name.trim()
  if (!trimmed || hostIds.length < CONSENT_GROUP_MIN_HOSTS) return null
  return consentGroupDisclosure({
    hostId: hostIds[0],
    groupId,
    name: trimmed,
    hostIds: [...hostIds],
    declared: true,
    awaitsConfirmation: false,
  })
}

/** What the dialog is editing. */
export interface ConsentGroupDraft {
  mode: 'create' | 'edit' | 'dissolve'
  /** The group being edited or dissolved; `null` for a new one. */
  groupId: string | null
  name: string
  hostIds: readonly string[]
}

/** Another group that gives up sites to the one being edited. */
export interface ConsentGroupDraftDonor {
  groupId: string
  name: string
  /** Its sites that move into the edited group. */
  losing: string[]
  /** Its sites that stay. */
  remaining: string[]
  /** One site stays, and a group of one is no group: it dissolves. */
  dissolves: boolean
  /** Every site moves: it is merged into the edited group. */
  absorbed: boolean
}

/** A draft, read as the change it makes. */
export interface ConsentGroupDraftChange {
  kind: 'create' | 'edit' | 'dissolve'
  groupId: string | null
  /** The name after the change, or the dissolved group's name. */
  name: string
  previousName: string | null
  /** The group's sites after the change; empty for a dissolve. */
  hostIds: string[]
  previousHostIds: string[]
  renamed: boolean
  /** Sites joining the group that were on their own before. */
  added: string[]
  /** Sites joining the group from another group. */
  movedIn: Array<{ hostId: string; fromGroupId: string; fromName: string }>
  /** Sites leaving the group to send on their own; all of them on a dissolve. */
  removed: string[]
  /** The group's sites the draft no longer selects. */
  unselected: string[]
  donors: ConsentGroupDraftDonor[]
  /** An edit left with fewer than two sites, so it dissolves the group. */
  tooFewSites: boolean
  /** Nothing would change. */
  empty: boolean
}

const sortedUnique = (ids: readonly string[]) =>
  [...new Set(ids.filter(Boolean))].sort()

/** Reads a draft against the groups the org holds now. */
export function describeConsentGroupDraft(
  current: readonly ListedConsentGroup[],
  draft: ConsentGroupDraft,
): ConsentGroupDraftChange {
  const original =
    draft.groupId != null
      ? (current.find((group) => group.id === draft.groupId) ?? null)
      : null
  const previousHostIds = original ? [...original.hostIds] : []
  const selected = sortedUnique(draft.hostIds)
  const unselected = previousHostIds.filter((id) => !selected.includes(id))
  const tooFewSites =
    draft.mode === 'edit' && selected.length < CONSENT_GROUP_MIN_HOSTS
  const dissolving = draft.mode === 'dissolve' || tooFewSites

  if (dissolving) {
    return {
      kind: 'dissolve',
      groupId: draft.groupId,
      name: original?.name ?? draft.name.trim(),
      previousName: original?.name ?? null,
      hostIds: [],
      previousHostIds,
      renamed: false,
      added: [],
      movedIn: [],
      removed: previousHostIds,
      unselected: draft.mode === 'dissolve' ? previousHostIds : unselected,
      donors: [],
      tooFewSites,
      empty: !original,
    }
  }

  const name = draft.name.trim()
  const chosen = new Set(selected)
  const before = new Set(previousHostIds)
  const donors: ConsentGroupDraftDonor[] = []
  const movedIn: ConsentGroupDraftChange['movedIn'] = []
  for (const group of current) {
    if (group.id === draft.groupId) continue
    const losing = group.hostIds.filter((hostId) => chosen.has(hostId))
    if (!losing.length) continue
    const remaining = group.hostIds.filter((hostId) => !chosen.has(hostId))
    donors.push({
      groupId: group.id,
      name: group.name,
      losing,
      remaining,
      dissolves: remaining.length > 0 && remaining.length < CONSENT_GROUP_MIN_HOSTS,
      absorbed: remaining.length === 0,
    })
    for (const hostId of losing) {
      movedIn.push({ hostId, fromGroupId: group.id, fromName: group.name })
    }
  }
  const moving = new Set(movedIn.map((move) => move.hostId))
  const added = selected.filter((id) => !before.has(id) && !moving.has(id))
  const removed = unselected
  const renamed = original != null && name !== original.name
  return {
    kind: original ? 'edit' : 'create',
    groupId: draft.groupId,
    name,
    previousName: original?.name ?? null,
    hostIds: selected,
    previousHostIds,
    renamed,
    added,
    movedIn,
    removed,
    unselected,
    donors,
    tooFewSites: false,
    empty:
      original != null &&
      !renamed &&
      !added.length &&
      !movedIn.length &&
      !removed.length,
  }
}

/**
 * The org's complete next declaration, and where the edited group sits in it.
 *
 * Every other group is carried over as it stands, less any site the edited
 * group takes from it — and a group left with fewer than two sites is left
 * out, which is how the route reads "dissolved". The edited group goes last,
 * so a refusal that names a group by its index names it predictably.
 */
export function buildConsentGroupDeclaration(
  current: readonly ListedConsentGroup[],
  draft: ConsentGroupDraft,
): { groups: ConsentGroupDeclarationEntry[]; editedIndex: number | null } {
  const change = describeConsentGroupDraft(current, draft)
  const taken = new Set(change.kind === 'dissolve' ? [] : change.hostIds)
  const groups: ConsentGroupDeclarationEntry[] = []
  for (const group of current) {
    if (group.id === draft.groupId) continue
    const hostIds = group.hostIds.filter((hostId) => !taken.has(hostId))
    if (hostIds.length < CONSENT_GROUP_MIN_HOSTS) continue
    groups.push({ id: group.id, name: group.name, hostIds })
  }
  if (change.kind === 'dissolve') return { groups, editedIndex: null }
  groups.push({
    ...(draft.groupId != null ? { id: draft.groupId } : {}),
    name: change.name,
    hostIds: change.hostIds,
  })
  return { groups, editedIndex: groups.length - 1 }
}

/** What the edit step says is wrong, by field. */
export interface ConsentGroupDraftErrors {
  name?: string
  sites?: string
}

/**
 * The checks the editor can make without asking, which is deliberately few:
 * the route validates everything again and its answer is the one that
 * counts. These exist so the obvious mistakes are said beside the field that
 * has them, before anybody waits on a preview.
 */
export function validateConsentGroupDraft(
  current: readonly ListedConsentGroup[],
  draft: ConsentGroupDraft,
): ConsentGroupDraftErrors {
  const change = describeConsentGroupDraft(current, draft)
  if (change.kind === 'dissolve') return {}
  const errors: ConsentGroupDraftErrors = {}
  if (!change.name) {
    errors.name = 'Give the group a name. Signup forms show it.'
  } else if (change.name.length > CONSENT_GROUP_NAME_MAX) {
    errors.name = `Keep the name to ${CONSENT_GROUP_NAME_MAX} characters or fewer.`
  } else {
    const lower = change.name.toLocaleLowerCase()
    const { groups } = buildConsentGroupDeclaration(current, draft)
    const clash = groups.some(
      (group) =>
        group.id !== draft.groupId &&
        group.id != null &&
        group.name.toLocaleLowerCase() === lower,
    )
    if (clash) errors.name = 'Another consent group already has this name.'
  }
  if (change.hostIds.length < CONSENT_GROUP_MIN_HOSTS) {
    errors.sites = 'Choose at least two sites.'
  } else if (change.hostIds.length > MAX_CONSENT_GROUP_HOSTS) {
    errors.sites = `A consent group can include at most ${MAX_CONSENT_GROUP_HOSTS} sites.`
  } else if (
    change.kind === 'edit' &&
    !change.previousHostIds.some((hostId) => change.hostIds.includes(hostId))
  ) {
    errors.sites =
      'Keep at least one of this group’s sites, or create a new group for these sites instead.'
  }
  return errors
}
