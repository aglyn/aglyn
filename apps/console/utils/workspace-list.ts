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

import { PLAN_LABELS, type UserOrgMembership } from '@aglyn/aglyn'
import {
  type ListFilterField,
  matchListFilter,
} from '@aglyn/shared-util-tools/list-query/list-filter'
import type {
  ListFilterClause,
  ListFilterOption,
} from '@aglyn/shared-util-tools/list-query/list-filter-codecs'

/**
 * THE WORKSPACE LIST'S ORDER, SEARCH, FILTERS AND PINS (AGL-3762).
 *
 * The chooser at the console root and the app bar's workspace switcher list
 * the reader's memberships, `users/{uid}/orgs`. That set is the reader's own
 * and small — one row per organization they belong to — so both surfaces
 * hold ALL of it (the chooser drains `useOrgScope`'s window before it
 * arranges anything) and answer every filter and search here, in memory,
 * over the complete set. A Firestore query could not: the plan is not on the
 * membership row at all (it is the org document's), and "pinned first" is
 * the reader's preference, not a field of the row.
 *
 * Matching goes through the shared `matchListFilter`, the matcher every list
 * that answers its filters in memory uses, over the same `ListFilterField`
 * grammar the toolbar's Filters panel reads.
 */

/** `users/{uid}` field holding the ids of the workspaces the reader pinned. */
export const PINNED_ORGS_FIELD = 'pinnedOrgs'

/**
 * The ids the reader pinned, from their account document.
 *
 * Anything that is not a list of non-empty strings reads as no pins, so a
 * stray value can never take the chooser down.
 */
export function readPinnedOrgs(profile: unknown): string[] {
  const stored = (profile as Record<string, unknown> | null | undefined)?.[
    PINNED_ORGS_FIELD
  ]
  if (!Array.isArray(stored)) return []
  return [
    ...new Set(
      stored.filter(
        (entry): entry is string => typeof entry === 'string' && entry !== '',
      ),
    ),
  ]
}

/** A membership as the list reads it: the row, its plan and its pin. */
export interface WorkspaceRow extends UserOrgMembership {
  /** The resolved plan, when it has been read; absent until then. */
  plan?: string
  pinned: boolean
}

/** Every filter the workspace list offers. */
export const WORKSPACE_FILTER_FIELDS: readonly ListFilterField[] = [
  // The org document's plan, resolved the way every plan badge resolves it.
  { column: 'plan', kind: 'exact', path: 'plan', operators: ['equals'] },
  // The reader's role in that org, from the membership row itself.
  { column: 'role', kind: 'exact', path: 'role', operators: ['equals'] },
  { column: 'pinned', kind: 'boolean', path: 'pinned', operators: ['is'] },
]

/** How each filter reads in the panel and on its chip. */
export const WORKSPACE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  plan: 'Plan',
  role: 'Your role',
  pinned: 'Pinned',
}

/** The picked choices, worded the way the console words them elsewhere. */
export const WORKSPACE_FILTER_OPTIONS: Readonly<
  Record<string, readonly ListFilterOption[]>
> = {
  plan: Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label })),
  role: [
    { value: 'owner', label: 'Owner' },
    { value: 'admin', label: 'Admin' },
    { value: 'editor', label: 'Editor' },
    { value: 'viewer', label: 'Viewer' },
  ],
  pinned: [
    { value: 'true', label: 'Pinned' },
    { value: 'false', label: 'Not pinned' },
  ],
}

/** Whether any clause in force needs each workspace's plan read. */
export const needsWorkspacePlans = (clauses: readonly ListFilterClause[]) =>
  clauses.some((clause) => clause.field === 'plan')

/**
 * The one name collation: locale-aware, case- and accent-insensitive at the
 * first pass, with digits read as numbers ("Site 2" before "Site 10").
 */
const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
})

/** What a workspace is called, everywhere it is listed. */
export const workspaceName = (org: Pick<UserOrgMembership, '$id' | 'orgName' | 'slug'>) =>
  org.orgName || org.slug || org.$id

/**
 * Pinned first, then by name A to Z; ties by slug, then by id, so the order
 * is total and a page boundary never moves between renders.
 */
export function compareWorkspaces(
  a: Pick<WorkspaceRow, '$id' | 'orgName' | 'slug' | 'pinned'>,
  b: Pick<WorkspaceRow, '$id' | 'orgName' | 'slug' | 'pinned'>,
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return (
    collator.compare(workspaceName(a), workspaceName(b)) ||
    collator.compare(a.slug ?? '', b.slug ?? '') ||
    (a.$id < b.$id ? -1 : a.$id > b.$id ? 1 : 0)
  )
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u
const fold = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Whether a workspace answers the search: every typed word starts some word
 * of its name or its slug, the console's search grammar. `harbor` and `bak`
 * both find "Harbor Bakery" at `harbor-bakery`.
 */
export function workspaceMatchesSearch(
  org: Pick<UserOrgMembership, '$id' | 'orgName' | 'slug'>,
  words: readonly string[],
): boolean {
  const asked = words.map((word) => fold(word.trim())).filter(Boolean)
  if (!asked.length) return true
  const held = [org.orgName ?? '', org.slug ?? '']
    .flatMap((value) => fold(value).split(WORD_SPLIT))
    .filter(Boolean)
  return asked.every((word) => held.some((entry) => entry.startsWith(word)))
}

export interface ArrangeWorkspacesOptions {
  /** Ids the reader pinned. An id they no longer belong to is ignored. */
  pinned?: readonly string[]
  /** Resolved plan per org id, for the Plan filter. */
  plans?: Readonly<Record<string, string>>
  clauses?: readonly ListFilterClause[]
  search?: readonly string[]
}

/**
 * The list as the reader sees it: every membership, decorated with its pin
 * and plan, narrowed by the search and every clause, pinned first and then
 * by name. Callers pass the COMPLETE membership set; see the module note.
 */
export function arrangeWorkspaces(
  orgs: readonly UserOrgMembership[],
  options: ArrangeWorkspacesOptions = {},
): WorkspaceRow[] {
  const { pinned = [], plans = {}, clauses = [], search = [] } = options
  const pins = new Set(pinned)
  return orgs
    .map<WorkspaceRow>((org) => ({
      ...org,
      ...(plans[org.$id] ? { plan: plans[org.$id] } : {}),
      pinned: pins.has(org.$id),
    }))
    .filter(
      (row) =>
        workspaceMatchesSearch(row, search) &&
        clauses.every((clause) =>
          matchListFilter(row, WORKSPACE_FILTER_FIELDS, clause),
        ),
    )
    .sort(compareWorkspaces)
}

/** The pin list after pinning or unpinning one workspace. */
export function togglePinnedOrg(
  pinned: readonly string[],
  orgId: string,
): string[] {
  return pinned.includes(orgId)
    ? pinned.filter((id) => id !== orgId)
    : [...pinned, orgId]
}
