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
 * CHANGING WHICH SITES ARE ONE SENDER (AGL-3320) — the pure half.
 *
 * `consent-groups.ts` reads a declaration; this is what a change to one
 * means. It validates the next declaration an admin submits, decides what has
 * to move for the sites to stop or start being one sender, and words the
 * result — and it does all of that without a read, so the console's review
 * step, the route's refusal and the executor's plan are one computation.
 *
 * ## Why a change is a plan and not a write
 *
 * A declaration is read at send time, so flipping it is instant — and that is
 * exactly the problem. Two facts are stored per SITE and read across the
 * CURRENT group: a refusal (a suppression row, a topic opt-out, a pace, a
 * declined consent) and a holder's business record (the CRM facet keyed by
 * the group). When sites stop being one sender, each stops reading the
 * other's refusals; when they become one, the records they kept apart must
 * become one. The flip itself moves neither, so every change is:
 *
 *  1. CARRY the refusals onto the sites that are about to stop reading them,
 *     in BOTH directions — the person who left one site of a sender was told
 *     the opt-out covers all of them, so the site leaving keeps what it
 *     honored and the sites staying keep what the leaver honored;
 *  2. FLIP the declaration;
 *  3. RE-HOME the holder records keyed by the old group ids.
 *
 * {@link planConsentGroupChange} says which pairs carry and which holder keys
 * move or split; the executor in `libs/tenant/data/admin` performs it.
 *
 * ## What the planner never touches
 *
 * Grants. A grant is written forward, one entry per disclosed site, and is
 * evidence of what a person was told, so a change never copies, re-keys or
 * revokes one — see `consent-groups.ts`, "Pooling applies FORWARD only".
 */

import {
  consentGroupDisclosure,
  CONSENT_GROUPS_FIELD,
  MAX_CONSENT_GROUP_HOSTS,
  readConsentGroups,
  type StoredConsentGroup,
} from './consent-groups'

/**
 * The org field that marks a change in flight:
 * {@link ConsentGroupsChangeMarker}. Authoritative — the job document holds
 * the detail, and this says whether there is a job at all.
 *
 * On the org document, beside the declaration it guards, so the transaction
 * that starts a change and the one that flips the declaration read one
 * document. Server-owned: denied to every client by the rules.
 */
export const CONSENT_GROUPS_CHANGE_FIELD = 'consentGroupsChange'

/** `orgs/{orgId}/consentGroupChanges/{changeId}` — one job per change. */
export const CONSENT_GROUP_CHANGES_COLLECTION = 'consentGroupChanges'

/**
 * The longest group name a declaration may carry.
 *
 * The name is rendered on every signup form of the group, inside a sentence,
 * so it is a brand and not a description.
 */
export const CONSENT_GROUP_NAME_MAX = 80

/**
 * How long after the flip the sweep waits before its final pass.
 *
 * A long job — a campaign batch, a dynamic list, an outreach tick — resolves
 * the group once per batch and runs for at most five minutes, so a write it
 * made against the OLD declaration can land after the flip. Six minutes is
 * past the longest of them.
 */
export const CONSENT_GROUP_SWEEP_DELAY_MS = 6 * 60_000

/**
 * What every minted group id starts with.
 *
 * A group id is a holder key beside the site ids a solo site is keyed by, so
 * the two must never meet. Firestore's automatic ids — which every site id is
 * — are alphanumeric, and an underscore cannot occur in one.
 */
export const CONSENT_GROUP_ID_PREFIX = 'cg_'

/** Every group of a declaration, by id — what `readConsentGroups` answers. */
export type ConsentGroupDeclaration = Record<string, StoredConsentGroup>

/** One group of the next declaration as the editor submits it. */
export interface ConsentGroupDraft {
  /** The id of a group that exists; absent for a new group. */
  id?: string | null
  name: string
  hostIds: string[]
}

/**
 * Why a submitted declaration was refused. Every code names something the
 * admin can fix in the editor; `groupIndex` points at the draft it is about,
 * and `hostId` at the site.
 */
export type ConsentGroupValidationCode =
  /** Not a list of `{ name, hostIds }` objects. */
  | 'malformed'
  | 'name-empty'
  | 'name-too-long'
  /** Two groups with the same name, ignoring case. */
  | 'name-duplicate'
  | 'too-few-sites'
  | 'too-many-sites'
  /** A site this organization does not own. */
  | 'unknown-site'
  | 'site-in-two-groups'
  /** An id no group of the current declaration has. */
  | 'unknown-group'
  /** One id on two drafts. */
  | 'duplicate-group'
  /**
   * A kept id whose sites are ALL new. Keeping the id would carry the old
   * group's records onto a set of sites none of which kept them; a new group
   * is what that is.
   */
  | 'group-replaced'
  /** The declaration submitted is the one in force. */
  | 'no-change'

export interface ConsentGroupValidationError {
  code: ConsentGroupValidationCode
  groupIndex?: number
  hostId?: string
}

export type ConsentGroupValidation =
  | { ok: true; after: ConsentGroupDeclaration }
  | { ok: false; errors: ConsentGroupValidationError[] }

/**
 * The sites an organization owns, from its `hosts` map, sorted.
 *
 * The map is `{ [hostId]: true }`; an array is read too, so a hand-built
 * fixture and the stored shape agree.
 */
export function orgSiteIds(
  org: Record<string, unknown> | null | undefined,
): string[] {
  const hosts = (org ?? {})['hosts']
  const ids = Array.isArray(hosts)
    ? hosts.map((id) => String(id ?? ''))
    : hosts && typeof hosts === 'object'
      ? Object.entries(hosts as Record<string, unknown>)
          .filter(([, value]) => value !== false && value != null)
          .map(([id]) => id)
      : []
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort()
}

/** The raw declaration's ids that `readConsentGroups` drops, sorted. */
export function discardedConsentGroupIds(
  org: Record<string, unknown> | null | undefined,
): string[] {
  const raw = (org ?? {})[CONSENT_GROUPS_FIELD]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const usable = readConsentGroups(org)
  return Object.keys(raw as Record<string, unknown>)
    .filter((id) => !(id in usable))
    .sort()
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Uniform in [0, 1), from the platform's CSPRNG where there is one. */
function defaultRandom(): number {
  const crypto = (globalThis as { crypto?: { getRandomValues?: <T>(array: T) => T } })
    .crypto
  if (crypto?.getRandomValues) {
    const word = crypto.getRandomValues(new Uint32Array(1))[0]
    return word / 2 ** 32
  }
  return Math.random()
}

/**
 * A fresh group id: {@link CONSENT_GROUP_ID_PREFIX} and sixteen base-36
 * characters, never one in `taken`.
 *
 * `taken` holds every id the id must not equal — the current groups', the
 * raw declaration's, every site's and every id already minted for the same
 * declaration. Eighty bits make a collision a formality, and the loop makes it
 * impossible.
 */
export function mintConsentGroupId(
  taken: ReadonlySet<string>,
  random: () => number = defaultRandom,
): string {
  for (;;) {
    let id = CONSENT_GROUP_ID_PREFIX
    for (let index = 0; index < 16; index += 1) {
      id += BASE36[Math.min(35, Math.floor(random() * 36))]
    }
    if (!taken.has(id)) return id
  }
}

/** A group's canonical form: its name trimmed, its sites unique and sorted. */
function canonicalGroup(group: unknown): { name: string; hostIds: string[] } {
  const value = (group && typeof group === 'object' ? group : {}) as Record<string, unknown>
  const name = typeof value['name'] === 'string' ? value['name'].trim() : ''
  const hostIds = Array.isArray(value['hostIds'])
    ? [
        ...new Set(
          (value['hostIds'] as unknown[])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean),
        ),
      ].sort()
    : []
  return { name, hostIds }
}

/**
 * Whether two declarations say the same thing: the same ids, each with the
 * same trimmed name and the same set of sites. Order never matters.
 */
export function consentGroupsEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  return consentGroupsFingerprint(a) === consentGroupsFingerprint(b)
}

/**
 * A declaration as one canonical string: what "the value the editor
 * rendered" and "the value stored now" are compared by.
 *
 * Every entry is kept, usable or not, because the question is whether the
 * stored value CHANGED, and an edit to an entry `readConsentGroups` drops is
 * still somebody else's edit. Absent, `null` and `{}` are one value — an
 * organization with no groups.
 */
export function consentGroupsFingerprint(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'null'
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([id, group]) => [id, canonicalGroup(group)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return entries.length ? JSON.stringify(entries) : 'null'
}

/**
 * The next declaration, checked against the organization's sites and the
 * declaration in force, with an id minted for every new group.
 *
 * Refuses everything in the list on {@link ConsentGroupValidationCode}, and
 * reports every problem it finds rather than the first, so the editor can
 * mark each draft at once.
 */
export function validateConsentGroupDeclaration(input: {
  groups: unknown
  /** The declaration in force: `readConsentGroups(org)`. */
  before: ConsentGroupDeclaration
  /** The organization's sites: {@link orgSiteIds}. */
  siteIds: readonly string[]
  /** Ids a minted id must also avoid — the raw declaration's, for one. */
  reserved?: Iterable<string>
  random?: () => number
}): ConsentGroupValidation {
  const { before } = input
  if (!Array.isArray(input.groups)) {
    return { ok: false, errors: [{ code: 'malformed' }] }
  }
  const sites = new Set(input.siteIds)
  const errors: ConsentGroupValidationError[] = []
  const names = new Set<string>()
  const ids = new Set<string>()
  const claimed = new Set<string>()
  const drafts: Array<{ id: string | null; name: string; hostIds: string[] }> = []

  input.groups.forEach((value, groupIndex) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ code: 'malformed', groupIndex })
      return
    }
    const entry = value as Record<string, unknown>
    if (typeof entry['name'] !== 'string' || !Array.isArray(entry['hostIds'])) {
      errors.push({ code: 'malformed', groupIndex })
      return
    }
    const { name, hostIds } = canonicalGroup(entry)
    if (!name) errors.push({ code: 'name-empty', groupIndex })
    else if (name.length > CONSENT_GROUP_NAME_MAX) {
      errors.push({ code: 'name-too-long', groupIndex })
    } else if (names.has(name.toLowerCase())) {
      errors.push({ code: 'name-duplicate', groupIndex })
    }
    if (name) names.add(name.toLowerCase())

    for (const hostId of hostIds) {
      if (!sites.has(hostId)) {
        errors.push({ code: 'unknown-site', groupIndex, hostId })
      } else if (claimed.has(hostId)) {
        errors.push({ code: 'site-in-two-groups', groupIndex, hostId })
      }
      claimed.add(hostId)
    }
    if (hostIds.length < 2) errors.push({ code: 'too-few-sites', groupIndex })
    else if (hostIds.length > MAX_CONSENT_GROUP_HOSTS) {
      errors.push({ code: 'too-many-sites', groupIndex })
    }

    const rawId = entry['id']
    const id = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : null
    if (id !== null) {
      if (ids.has(id)) errors.push({ code: 'duplicate-group', groupIndex })
      else if (!(id in before)) errors.push({ code: 'unknown-group', groupIndex })
      else if (!before[id].hostIds.some((hostId) => hostIds.includes(hostId))) {
        errors.push({ code: 'group-replaced', groupIndex })
      }
      ids.add(id)
    }
    drafts.push({ id, name, hostIds })
  })
  if (errors.length) return { ok: false, errors }

  const taken = new Set<string>([
    ...Object.keys(before),
    ...input.siteIds,
    ...(input.reserved ?? []),
    ...ids,
  ])
  const after: ConsentGroupDeclaration = {}
  for (const draft of drafts) {
    const id = draft.id ?? mintConsentGroupId(taken, input.random)
    taken.add(id)
    after[id] = { name: draft.name, hostIds: draft.hostIds }
  }
  if (consentGroupsEqual(before, after)) {
    return { ok: false, errors: [{ code: 'no-change' }] }
  }
  return { ok: true, after }
}

/*==========================================
 * THE PLAN
 *=========================================*/

/**
 * One direction of a carry: `toHostId` is about to stop reading
 * `fromHostId`'s refusals, so they are copied onto it first.
 */
export interface ConsentGroupCarry {
  toHostId: string
  fromHostId: string
}

/**
 * Every site a holder key covered moves under ONE new key: the key's records
 * are folded into the new key's, and the old key is deleted in the same
 * write.
 */
export interface ConsentGroupHolderMove {
  kind: 'move'
  /** The key the records are under now: a group id, or a solo site's id. */
  from: string
  /** The sites `from` covered. */
  fromHostIds: string[]
  /** The key they move under: always a declared group of the next declaration. */
  to: string
  /** The sites of `to` in the next declaration. */
  toHostIds: string[]
}

/**
 * The sites a holder key covered go separate ways. Each successor may take a
 * copy of the key's records; the key itself survives when some of its sites
 * stay under it, and is deleted when none do.
 */
export interface ConsentGroupHolderSplit {
  kind: 'split'
  from: string
  fromHostIds: string[]
  /** Whether `from` is still a key afterwards. */
  survives: boolean
  /** The sites of `from` that stay under it. Empty when it does not survive. */
  stayHostIds: string[]
  /**
   * Where the other sites go: each successor key with the sites of `from`
   * that map to it — never the successor's other sites, whose records were
   * never under `from`.
   */
  successors: Array<{ key: string; hostIds: string[] }>
}

export type ConsentGroupHolderFlow = ConsentGroupHolderMove | ConsentGroupHolderSplit

/** What a change does to the declaration, as the activity log words it. */
export type ConsentGroupChangeLine =
  | { kind: 'created'; groupId: string; name: string; hostIds: string[] }
  | { kind: 'renamed'; groupId: string; from: string; to: string }
  | { kind: 'added'; groupId: string; name: string; hostId: string }
  | { kind: 'removed'; groupId: string; name: string; hostId: string }
  | {
      kind: 'moved'
      hostId: string
      fromGroupId: string
      fromName: string
      toGroupId: string
      toName: string
    }
  /** Includes a group absorbed into another: its sites each get a `moved`. */
  | { kind: 'dissolved'; groupId: string; name: string }

export interface ConsentGroupChangePlan {
  before: ConsentGroupDeclaration
  after: ConsentGroupDeclaration
  carries: ConsentGroupCarry[]
  flows: ConsentGroupHolderFlow[]
  lines: ConsentGroupChangeLine[]
  /**
   * Every site the change touches — whose group, members or group name
   * changes. What the marker names while the change runs: the sites that
   * may not be deleted, and whose holder records may be in motion.
   */
  hostIds: string[]
  /** Only names change: nothing to carry and nothing to re-home. */
  renameOnly: boolean
}

function groupOf(
  declaration: ConsentGroupDeclaration,
): Map<string, { id: string; hostIds: string[] }> {
  const map = new Map<string, { id: string; hostIds: string[] }>()
  for (const [id, group] of Object.entries(declaration)) {
    for (const hostId of group.hostIds) map.set(hostId, { id, hostIds: group.hostIds })
  }
  return map
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** `declaration` without the sites `keep` does not name. */
function withSitesOnly(
  declaration: ConsentGroupDeclaration,
  keep: ReadonlySet<string>,
): ConsentGroupDeclaration {
  const out: ConsentGroupDeclaration = {}
  for (const [id, group] of Object.entries(declaration)) {
    const hostIds = group.hostIds.filter((hostId) => keep.has(hostId))
    if (hostIds.length) out[id] = { name: group.name, hostIds }
  }
  return out
}

/**
 * What moving from `before` to `after` requires.
 *
 * `key(s)` is the holder key of site `s` — its group's id, or `s` itself when
 * it is alone — and `members(s)` the sites of that group, or `[s]`.
 *
 *  - **Carries.** For every pair a ≠ b that are one sender now and will not
 *    be, `b`'s refusals are copied onto `a`. Pairs that stay together, and
 *    pairs that come together, need nothing: a joined site reads its new
 *    siblings' refusals the moment the declaration names it.
 *  - **Holder flows.** For each key `k` in force, the sites it covers map to
 *    a set `T` of keys afterwards. `T = {k}` needs nothing; one other key is
 *    a MOVE; anything else is a SPLIT, which `k` survives when it is in `T`.
 *
 * `siteIds`, when given, are the sites the organization still owns: a site
 * named by `before` that is gone neither receives a carry nor takes a copy of
 * a record, because there is nothing left to hold either.
 */
export function planConsentGroupChange(
  before: ConsentGroupDeclaration,
  after: ConsentGroupDeclaration,
  options: { siteIds?: readonly string[] } = {},
): ConsentGroupChangePlan {
  const owned = options.siteIds ? new Set(options.siteIds) : null
  const moving = owned ? withSitesOnly(before, owned) : before
  const beforeOf = groupOf(moving)
  const afterOf = groupOf(after)
  const keyBefore = (hostId: string) => beforeOf.get(hostId)?.id ?? hostId
  const keyAfter = (hostId: string) => afterOf.get(hostId)?.id ?? hostId
  const membersBefore = (hostId: string) => beforeOf.get(hostId)?.hostIds ?? [hostId]
  const membersAfter = (hostId: string) => afterOf.get(hostId)?.hostIds ?? [hostId]

  const sites = [
    ...new Set([
      ...Object.values(moving).flatMap((group) => group.hostIds),
      ...Object.values(after).flatMap((group) => group.hostIds),
    ]),
  ].sort(byString)

  const carries: ConsentGroupCarry[] = []
  for (const a of sites) {
    const stays = new Set(membersAfter(a))
    for (const b of membersBefore(a)) {
      if (b !== a && !stays.has(b)) carries.push({ toHostId: a, fromHostId: b })
    }
  }

  const flows: ConsentGroupHolderFlow[] = []
  const keys = [...new Set(sites.map(keyBefore))].sort(byString)
  for (const key of keys) {
    const covered = sites.filter((hostId) => keyBefore(hostId) === key)
    const targets = [...new Set(covered.map(keyAfter))].sort(byString)
    if (targets.length === 1 && targets[0] === key) continue
    if (targets.length === 1) {
      flows.push({
        kind: 'move',
        from: key,
        fromHostIds: covered,
        to: targets[0],
        toHostIds: [...membersAfter(covered[0])],
      })
      continue
    }
    flows.push({
      kind: 'split',
      from: key,
      fromHostIds: covered,
      survives: targets.includes(key),
      stayHostIds: covered.filter((hostId) => keyAfter(hostId) === key),
      successors: targets
        .filter((target) => target !== key)
        .map((target) => ({
          key: target,
          hostIds: covered.filter((hostId) => keyAfter(hostId) === target),
        })),
    })
  }

  const lines = planLines(before, after)
  const touched = new Set<string>()
  const beforeAll = groupOf(before)
  for (const hostId of new Set([...beforeAll.keys(), ...afterOf.keys()])) {
    const was = beforeAll.get(hostId)
    const now = afterOf.get(hostId)
    const sameMembers =
      (was?.hostIds ?? [hostId]).join('\n') === (now?.hostIds ?? [hostId]).join('\n')
    const sameName =
      !was || !now || before[was.id]?.name === after[now.id]?.name
    if (was?.id !== now?.id || !sameMembers || !sameName) touched.add(hostId)
  }
  return {
    before,
    after,
    carries,
    flows,
    lines,
    hostIds: [...touched].sort(byString),
    renameOnly:
      !carries.length &&
      !flows.length &&
      lines.length > 0 &&
      lines.every((line) => line.kind === 'renamed'),
  }
}

/** The declaration-level changes, in the order the activity log lists them. */
function planLines(
  before: ConsentGroupDeclaration,
  after: ConsentGroupDeclaration,
): ConsentGroupChangeLine[] {
  const beforeOf = groupOf(before)
  const afterOf = groupOf(after)
  const created: ConsentGroupChangeLine[] = []
  const renamed: ConsentGroupChangeLine[] = []
  const added: ConsentGroupChangeLine[] = []
  const removed: ConsentGroupChangeLine[] = []
  const moved: ConsentGroupChangeLine[] = []
  const dissolved: ConsentGroupChangeLine[] = []
  const moveInto = (hostId: string, toGroupId: string) => {
    const from = beforeOf.get(hostId)
    if (!from || from.id === toGroupId) return false
    moved.push({
      kind: 'moved',
      hostId,
      fromGroupId: from.id,
      fromName: before[from.id].name,
      toGroupId,
      toName: after[toGroupId].name,
    })
    return true
  }

  for (const id of Object.keys(after).sort(byString)) {
    const next = after[id]
    const previous = before[id]
    if (!previous) {
      created.push({ kind: 'created', groupId: id, name: next.name, hostIds: [...next.hostIds] })
      for (const hostId of next.hostIds) moveInto(hostId, id)
      continue
    }
    if (previous.name !== next.name) {
      renamed.push({ kind: 'renamed', groupId: id, from: previous.name, to: next.name })
    }
    for (const hostId of next.hostIds) {
      if (previous.hostIds.includes(hostId)) continue
      if (!moveInto(hostId, id)) {
        added.push({ kind: 'added', groupId: id, name: next.name, hostId })
      }
    }
    for (const hostId of previous.hostIds) {
      if (next.hostIds.includes(hostId)) continue
      // A site that went to another group is that group's `moved` line.
      if (!afterOf.has(hostId)) {
        removed.push({ kind: 'removed', groupId: id, name: next.name, hostId })
      }
    }
  }
  for (const id of Object.keys(before).sort(byString)) {
    if (!(id in after)) dissolved.push({ kind: 'dissolved', groupId: id, name: before[id].name })
  }
  return [...created, ...renamed, ...added, ...removed, ...moved, ...dissolved]
}

/**
 * The sites in a sentence: "A", "A and B", "A, B and C".
 */
export function listSiteNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * One line of the plan as the organization's activity log says it.
 *
 * `siteName` turns a site id into what the console shows for it; the id
 * itself is the fallback, so a line is never blank.
 */
export function describeConsentGroupChangeLine(
  line: ConsentGroupChangeLine,
  siteName: (hostId: string) => string = (hostId) => hostId,
): string {
  const site = (hostId: string) => siteName(hostId) || hostId
  switch (line.kind) {
    case 'created':
      return `Created consent group "${line.name}" with ${listSiteNames(line.hostIds.map(site))}`
    case 'renamed':
      return `Renamed consent group "${line.from}" to "${line.to}"`
    case 'added':
      return `Added ${site(line.hostId)} to consent group "${line.name}"`
    case 'removed':
      return `Removed ${site(line.hostId)} from consent group "${line.name}"`
    case 'moved':
      return `Moved ${site(line.hostId)} from consent group "${line.fromName}" to "${line.toName}"`
    case 'dissolved':
      return `Dissolved consent group "${line.name}"`
  }
}

/*==========================================
 * THE CHANGE IN FLIGHT
 *=========================================*/

/**
 * Where a change stands, on the org marker.
 *
 *  - `carry` — copying refusals; the declaration in force is the old one,
 *    and the change can still be canceled.
 *  - `rehome` — the new declaration is in force; holder records are moving.
 *  - `sweep` — waiting out {@link CONSENT_GROUP_SWEEP_DELAY_MS}, then one
 *    last idempotent pass.
 */
export type ConsentGroupsChangePhase = 'carry' | 'rehome' | 'sweep'

/** `org.consentGroupsChange` — present exactly while a change runs. */
export interface ConsentGroupsChangeMarker {
  changeId: string
  phase: ConsentGroupsChangePhase
  /** {@link ConsentGroupChangePlan.hostIds}. */
  hostIds: string[]
  startedAtMs: number
  /** When the new declaration took effect; absent before the flip. */
  declaredAtMs?: number
}

const PHASES: readonly ConsentGroupsChangePhase[] = ['carry', 'rehome', 'sweep']

/** The marker off an org document, or `null` when no change is in flight. */
export function readConsentGroupsChange(
  org: Record<string, unknown> | null | undefined,
): ConsentGroupsChangeMarker | null {
  const raw = (org ?? {})[CONSENT_GROUPS_CHANGE_FIELD]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const changeId = typeof value['changeId'] === 'string' ? value['changeId'] : ''
  const phase = PHASES.find((candidate) => candidate === value['phase'])
  if (!changeId || !phase) return null
  const declaredAtMs = Number(value['declaredAtMs'])
  return {
    changeId,
    phase,
    hostIds: Array.isArray(value['hostIds'])
      ? (value['hostIds'] as unknown[]).filter(
          (id): id is string => typeof id === 'string' && id !== '',
        )
      : [],
    startedAtMs: Number(value['startedAtMs']) || 0,
    ...(Number.isFinite(declaredAtMs) && declaredAtMs > 0 ? { declaredAtMs } : {}),
  }
}

/**
 * Whether the holder records `hostId` reads may be mid-move: a change in
 * flight has flipped the declaration and names this site.
 *
 * A reader that decides something by a record's ABSENCE — a dynamic list
 * that removes whoever no longer matches — must not decide it while this
 * holds, because a record that has not moved yet reads as missing.
 */
export function consentGroupHoldersInMotion(
  org: Record<string, unknown> | null | undefined,
  hostId: string,
): boolean {
  const marker = readConsentGroupsChange(org)
  return Boolean(
    marker && marker.phase !== 'carry' && marker.hostIds.includes(hostId),
  )
}

/**
 * The executor's steps, in order.
 *
 *  - `carry` — every carry, then every participant's carry phase.
 *  - `catch-up-pre` — the refusals filed since the carry began.
 *  - `declare` — the flip, in one transaction.
 *  - `catch-up-post` — the same catch-up, for what raced the flip.
 *  - `rehome` — every participant's holder records.
 *  - `sweep-wait` — until {@link CONSENT_GROUP_SWEEP_DELAY_MS} has passed.
 *  - `sweep` — every carry again in full, and every participant's sweep.
 *  - `finish` — the marker cleared.
 *
 * A rename-only change runs `declare` and `finish` alone.
 */
export const CONSENT_GROUP_CHANGE_STEPS = [
  'carry',
  'catch-up-pre',
  'declare',
  'catch-up-post',
  'rehome',
  'sweep-wait',
  'sweep',
  'finish',
] as const

export type ConsentGroupChangeStep = (typeof CONSENT_GROUP_CHANGE_STEPS)[number]

/** The steps a rename-only change runs. */
export const CONSENT_GROUP_RENAME_STEPS: readonly ConsentGroupChangeStep[] = [
  'declare',
  'finish',
]

/** The marker phase a step runs under. */
export function consentGroupChangePhaseOf(
  step: ConsentGroupChangeStep,
): ConsentGroupsChangePhase {
  if (step === 'carry' || step === 'catch-up-pre' || step === 'declare') return 'carry'
  if (step === 'catch-up-post' || step === 'rehome') return 'rehome'
  return 'sweep'
}

export type ConsentGroupChangeStatus = 'running' | 'done' | 'canceled'

/** What the refusal carries copied so far, across every step. */
export interface ConsentGroupChangeCounts {
  siteSuppressions: number
  topicOptOuts: number
  paces: number
}

/** A job's state, as the route answers it and the progress panel renders it. */
export interface ConsentGroupChangeProgress {
  status: ConsentGroupChangeStatus
  step: ConsentGroupChangeStep
  /** 1-based position of `step` among the steps this change runs. */
  stepIndex: number
  stepCount: number
  /** When the new declaration took effect, or `null` before the flip. */
  declaredAtMs: number | null
  /** When the sweep may start, or `null` before the flip. */
  sweepAtMs: number | null
  /** Five units in a row failed. The change keeps retrying. */
  stalled: boolean
  /** Consecutive failed units. */
  failures: number
  lastError: string | null
  /** Until when another caller holds the job; `null` when it is free. */
  leaseUntilMs: number | null
  counts: ConsentGroupChangeCounts
  /** The sites that received at least one carried refusal. */
  sitesReceiving: number
  /** Each participant's counts, by plugin id. */
  plugins: Record<string, Record<string, number>>
}

/*==========================================
 * THE ROUTE'S CONTRACT (`POST /api/orgs/consent-groups`)
 *=========================================*/

export type ConsentGroupsApiAction = 'preview' | 'apply' | 'continue' | 'cancel' | 'status'

export interface ConsentGroupsApiDeclarationRequest {
  orgId: string
  action: 'preview' | 'apply'
  /**
   * `org.consentGroups` exactly as the editor rendered it, or `null` for an
   * organization with none. Compared by {@link consentGroupsFingerprint}.
   */
  expected: Record<string, unknown> | null
  /** The COMPLETE next declaration. A new group has no id. */
  groups: ConsentGroupDraft[]
}

export interface ConsentGroupsApiChangeRequest {
  orgId: string
  action: 'continue' | 'cancel' | 'status'
  changeId: string
}

export type ConsentGroupsApiRequest =
  | ConsentGroupsApiDeclarationRequest
  | ConsentGroupsApiChangeRequest

/** 200 for `preview`. */
export interface ConsentGroupsApiPreviewResponse {
  ok: true
  preview: ConsentGroupChangePreview
}

/** 200 for `apply`, `continue`, `cancel` and `status`. */
export interface ConsentGroupsApiChangeResponse {
  ok: true
  changeId: string
  phase: ConsentGroupsChangePhase | 'done' | 'canceled'
  done: boolean
  progress: ConsentGroupChangeProgress
}

/** 400: the declaration was refused. */
export interface ConsentGroupsApiRefusal {
  error: string
  errors: ConsentGroupValidationError[]
}

/** 409: the declaration changed since the editor rendered it. */
export interface ConsentGroupsApiStale {
  error: string
  current: Record<string, unknown> | null
}

/** 409: another change is running, or a cancel came after the flip. */
export interface ConsentGroupsApiInFlight {
  error: string
  changeId: string
  phase: ConsentGroupsChangePhase | 'done' | 'canceled'
}

/*==========================================
 * THE PREVIEW (`action: 'preview'`)
 *=========================================*/

/**
 * One sentence a participant adds to the review step, with the figure it is
 * about. `id` is namespaced by the participant (`crm.combine`).
 */
export interface ConsentGroupChangePreviewLine {
  id: string
  text: string
  count: number | null
  severity: 'info' | 'warning'
}

/** How long a change should take, from the work the preview counted. */
export type ConsentGroupChangeEstimate = 'instant' | 'under-a-minute' | 'minutes' | 'long'

/** The work bands behind {@link ConsentGroupChangeEstimate}. */
export function estimateConsentGroupChange(
  plan: Pick<ConsentGroupChangePlan, 'renameOnly'>,
  documents: number,
): ConsentGroupChangeEstimate {
  if (plan.renameOnly) return 'instant'
  if (documents < 5_000) return 'under-a-minute'
  if (documents < 100_000) return 'minutes'
  return 'long'
}

export interface ConsentGroupChangePreview {
  before: ConsentGroupDeclaration
  after: ConsentGroupDeclaration
  /** Stored ids `readConsentGroups` drops; the write removes them. */
  discarded: string[]
  /** The plan's lines, each with the sentence the activity log will write. */
  lines: Array<ConsentGroupChangeLine & { text: string }>
  /** Every group whose signup-form sentence changes. */
  disclosures: Array<{
    groupId: string
    hostIds: string[]
    before: string | null
    after: string | null
  }>
  /** Per carry, what the source site holds now (count aggregations). */
  carries: Array<{
    toHostId: string
    fromHostId: string
    siteSuppressions: number
    topicOptOuts: number
    paces: number
  }>
  /** Per joining site, the refusals on its new siblings it starts honoring. */
  inherited: Array<{ hostId: string; refusals: number }>
  /**
   * Pending confirmations that stop holding a separated site's mail. Only
   * when the organization's confirmation switch is on.
   */
  pendingHolds: Array<{
    hostId: string
    topicId: string
    count: number
    releasedHostIds: string[]
  }>
  /** Team members who can open only some of a changed group's sites. */
  partialAccessMembers: number
  /**
   * Set when the organization's consent policy is `forward` and a site joins:
   * the joining sites may email people their new siblings captured before
   * `enforceFromMs` without a recorded opt-in.
   */
  forwardPolicyWarning: { hostIds: string[]; enforceFromMs: number } | null
  /** Each participant's lines; `null` for one whose preview failed. */
  participants: Array<{
    pluginId: string
    lines: ConsentGroupChangePreviewLine[] | null
  }>
  /** The capture surfaces that show a group's disclosure. */
  capturesDisclosing: string[]
  estimate: ConsentGroupChangeEstimate
}

/** The groups whose disclosure sentence differs between the declarations. */
export function consentGroupDisclosureChanges(
  before: ConsentGroupDeclaration,
  after: ConsentGroupDeclaration,
): ConsentGroupChangePreview['disclosures'] {
  const sentence = (id: string, group: StoredConsentGroup | undefined) =>
    group
      ? consentGroupDisclosure({
          hostId: group.hostIds[0],
          groupId: id,
          name: group.name,
          hostIds: group.hostIds,
          declared: true,
          awaitsConfirmation: false,
        })
      : null
  const out: ConsentGroupChangePreview['disclosures'] = []
  for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(byString)) {
    const was = sentence(id, before[id])
    const now = sentence(id, after[id])
    if (was === now) continue
    out.push({
      groupId: id,
      hostIds: [...(after[id] ?? before[id]).hostIds],
      before: was,
      after: now,
    })
  }
  return out
}
