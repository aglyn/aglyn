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
 * CRM SHARING FOR MULTI-BRAND ORGS (AGL-3336).
 *
 * An org manager shares a lead, a contact, a company or a deal with other
 * sites — by hand, from the record or a list's bulk bar, or by a SHARING
 * RULE that applies to every record it matches, now and later. The model is
 * Salesforce's three layers:
 *
 * 1. the org-wide default — the consent-group scope a record is captured
 *    with (`consentGroupScope`), untouched by anything here;
 * 2. sharing rules — `crm.sharingRules` on the org document;
 * 3. manual shares — per record, per target.
 *
 * ## One field is enforced, so one field is widened
 *
 * Both enforcement layers read `visibleTo`: the rules with `hasAny`, every
 * list with `array-contains-any`. A share therefore ADDS its tokens to
 * `visibleTo`, which is what puts the record on the target site's lists as a
 * real query — no second field, no second index, no loaded-window match.
 * `'org'` is the token for "all sites", and it covers a site created later
 * with nothing to recompute, because every site's read set carries it.
 *
 * ## …and the sources stay distinguishable
 *
 * The record keeps its grants under `sharing` (`SCOPE_GRANTS_FIELD` in
 * core): one grant per rule and one per hand-shared target, and `added`,
 * the tokens the grants put on `visibleTo` that were not there already.
 * The record's own scope — its HELD tokens — is `visibleTo` without
 * `added`, so taking a grant away removes only what grants alone
 * contributed, and never a consent-group token. A token a site later
 * captures the person on is held from then on: the capturing sites
 * (`hostId`, `capturedByHostIds`) are never counted as added.
 *
 * ## Visibility is not consent, and not write access
 *
 * Nothing here reads or writes a consent entry. A site a record is shared
 * with sees it; it holds no basis to market to the person, and the
 * audience paths read `heldByHost`, not `visibleTo`. Write access is its
 * own field, `writeTo`, present only on a shared record: the held tokens
 * and the tokens of grants whose access is `edit`. The Firestore rules and
 * the CRM's routes check it; a read-only grant is the default.
 */

import type { ScopeToken } from '@aglyn/aglyn'
import {
  heldScopeTokens,
  hostIdsFromScope,
  hostScopeToken,
  isScopeToken,
  MAX_SCOPE_HOSTS,
  ORG_SCOPE_TOKEN,
  parseScopeToken,
  SCOPE_GRANTS_FIELD,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import type { CrmPicklist } from '@aglyn/aglyn/app-utils/crm'
import {
  isLeadSourceDirection,
  LEAD_SOURCE_DIRECTION_LABELS,
  leadSourceDirectionOf,
  STANDARD_LEAD_SOURCES,
} from './lead-source-direction'

/*==========================================
 * WHAT IS SHARED.
 *=========================================*/

/** The four record types a share or a rule applies to, by their collection. */
export const CRM_SHARING_OBJECTS = ['leads', 'contacts', 'companies', 'deals'] as const
export type CrmSharingObject = (typeof CRM_SHARING_OBJECTS)[number]

export function isCrmSharingObject(value: unknown): value is CrmSharingObject {
  return (
    typeof value === 'string' && (CRM_SHARING_OBJECTS as readonly string[]).includes(value)
  )
}

/** How each object reads in a sentence. */
export const CRM_SHARING_OBJECT_LABELS: Readonly<
  Record<CrmSharingObject, { one: string; many: string }>
> = {
  leads: { one: 'lead', many: 'Leads' },
  contacts: { one: 'contact', many: 'Contacts' },
  companies: { one: 'company', many: 'Companies' },
  deals: { one: 'deal', many: 'Deals' },
}

/** What a target site may do with a shared record. Read-only unless a grant says edit. */
export type CrmShareAccess = 'read' | 'edit'

export function isCrmShareAccess(value: unknown): value is CrmShareAccess {
  return value === 'read' || value === 'edit'
}

/** Where a grant came from. */
export type CrmShareSource = 'manual' | 'rule'

/** One grant on one record. */
export interface CrmShareGrant {
  source: CrmShareSource
  /** The sites it shares with: `['org']` for all sites, else host tokens. */
  tokens: ScopeToken[]
  access: CrmShareAccess
  /** The rule behind a `rule` grant. */
  ruleId?: string
  /** Who shared it by hand, as they were named at the time. */
  byUid?: string
  byName?: string
  /** When the grant was made. */
  atMs: number
}

/** `sharing` on a record — see the module note. */
export interface CrmRecordSharing {
  /** Keyed by {@link manualGrantKey} or {@link ruleGrantKey}. */
  grants: Record<string, CrmShareGrant>
  /** Every token any grant names — the record's shares, however held. */
  tokens: ScopeToken[]
  /** The tokens the grants ADDED to `visibleTo` — see `heldScopeTokens`. */
  added: ScopeToken[]
  /** The rules holding a grant here, so a rule's removal can find its records. */
  ruleIds: string[]
  /**
   * The held tokens of a record shared with all sites, and nothing
   * otherwise. `array-contains` on it answers "is this record shared with
   * everyone AND held by site X" — the one question `added` alone cannot,
   * since a query takes a single array clause.
   */
  orgWideHeldBy: ScopeToken[]
}

/** The record field its grants live under — the core's name for it. */
export const CRM_SHARING_FIELD = SCOPE_GRANTS_FIELD

/** The record field naming who may WRITE it, present only while it is shared. */
export const CRM_WRITE_SCOPE_FIELD = 'writeTo'

/** The array field a rule's removal queries. */
export const CRM_SHARING_RULE_IDS_PATH = `${CRM_SHARING_FIELD}.ruleIds`

/** A hand share is one grant per target, so each is unshared on its own. */
export function manualGrantKey(token: string): string {
  const parsed = parseScopeToken(token)
  if (!parsed) throw new Error(`not a scope token: ${token}`)
  return parsed.kind === 'org' ? 'manual_org' : `manual_${parsed.hostId}`
}

export function ruleGrantKey(ruleId: string): string {
  return `rule_${ruleId}`
}

function tokenList(raw: unknown): ScopeToken[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(isScopeToken))]
}

function readGrant(raw: unknown): CrmShareGrant | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const tokens = tokenList(value['tokens'])
  if (!tokens.length) return null
  const source = value['source'] === 'rule' ? 'rule' : value['source'] === 'manual' ? 'manual' : null
  if (!source) return null
  const ruleId = typeof value['ruleId'] === 'string' ? value['ruleId'] : ''
  if (source === 'rule' && !ruleId) return null
  const byUid = typeof value['byUid'] === 'string' ? value['byUid'] : ''
  const byName = typeof value['byName'] === 'string' ? value['byName'] : ''
  const atMs = typeof value['atMs'] === 'number' && Number.isFinite(value['atMs']) ? value['atMs'] : 0
  return {
    source,
    tokens,
    access: value['access'] === 'edit' ? 'edit' : 'read',
    ...(ruleId ? { ruleId } : {}),
    ...(byUid ? { byUid } : {}),
    ...(byName ? { byName } : {}),
    atMs,
  }
}

/** A record's grants, cleaned; `{}` for a record never shared. */
export function readRecordGrants(
  record: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, CrmShareGrant> {
  const sharing = (record ?? {})[CRM_SHARING_FIELD]
  if (!sharing || typeof sharing !== 'object' || Array.isArray(sharing)) return {}
  const grants = (sharing as Record<string, unknown>)['grants']
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return {}
  const out: Record<string, CrmShareGrant> = {}
  for (const [key, raw] of Object.entries(grants as Record<string, unknown>)) {
    const grant = readGrant(raw)
    if (grant) out[key] = grant
  }
  return out
}

/*==========================================
 * THE PLAN: grants in, the three fields out.
 *=========================================*/

/**
 * The sites that captured or created the record. Their tokens are HELD,
 * whatever `added` says: a person shared to site B and later captured on B
 * is B's own from then on, and unsharing must not hide them from B.
 */
export function recordHolderHostIds(record: Readonly<Record<string, unknown>>): string[] {
  const ids = new Set<string>()
  const hostId = record['hostId']
  if (typeof hostId === 'string' && hostId) ids.add(hostId)
  const captured = record['capturedByHostIds']
  if (Array.isArray(captured)) {
    for (const id of captured) if (typeof id === 'string' && id) ids.add(id)
  }
  return [...ids]
}

/**
 * The record's own scope: `visibleTo` less what grants added, its capturing
 * sites kept — the core's `heldScopeTokens`, as scope tokens.
 */
export function recordHeldScope(record: Readonly<Record<string, unknown>>): ScopeToken[] {
  return tokenList(heldScopeTokens(record))
}

export interface CrmSharingPlan {
  visibleTo: ScopeToken[]
  /** `null` removes the field: an unshared record writes by `visibleTo`. */
  writeTo: ScopeToken[] | null
  /** `null` removes the field. */
  sharing: CrmRecordSharing | null
}

/**
 * The fields a record carries under `grants`.
 *
 * A grant naming a token the record already holds adds nothing, and a
 * record held org-wide adds nothing at all — every site sees it already, so
 * a share there would only make a later unshare look like it hid something.
 * The token order is the held scope first and the additions after it, so an
 * unchanged record plans the `visibleTo` it has.
 */
export function planRecordSharing(
  record: Readonly<Record<string, unknown>>,
  grants: Readonly<Record<string, CrmShareGrant>>,
): CrmSharingPlan {
  const held = recordHeldScope(record)
  const entries = Object.entries(grants)
  if (!entries.length) return { visibleTo: held, writeTo: null, sharing: null }
  const heldSet = new Set<string>(held)
  const heldOrgWide = heldSet.has(ORG_SCOPE_TOKEN)
  const tokens: ScopeToken[] = []
  const editTokens: ScopeToken[] = []
  const ruleIds: string[] = []
  for (const [, grant] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const token of grant.tokens) {
      if (!tokens.includes(token)) tokens.push(token)
      if (grant.access === 'edit' && !editTokens.includes(token)) editTokens.push(token)
    }
    if (grant.source === 'rule' && grant.ruleId && !ruleIds.includes(grant.ruleId)) {
      ruleIds.push(grant.ruleId)
    }
  }
  const added = heldOrgWide ? [] : tokens.filter((token) => !heldSet.has(token))
  const writeTo = [...held]
  for (const token of editTokens) if (!writeTo.includes(token)) writeTo.push(token)
  return {
    visibleTo: [...held, ...added],
    writeTo,
    sharing: {
      grants: Object.fromEntries(entries),
      tokens,
      added,
      ruleIds,
      orgWideHeldBy: added.includes(ORG_SCOPE_TOKEN) ? [...held] : [],
    },
  }
}

const sameList = (a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined) =>
  (a ?? null) === null
    ? (b ?? null) === null
    : (b ?? null) !== null && a!.length === b!.length && a!.every((entry, at) => entry === b![at])

const sameGrant = (a: CrmShareGrant | undefined, b: CrmShareGrant | undefined) =>
  !!a &&
  !!b &&
  a.source === b.source &&
  a.access === b.access &&
  (a.ruleId ?? '') === (b.ruleId ?? '') &&
  (a.byUid ?? '') === (b.byUid ?? '') &&
  (a.byName ?? '') === (b.byName ?? '') &&
  a.atMs === b.atMs &&
  sameList(a.tokens, b.tokens)

/** Whether writing `plan` would change what the record stores. */
export function sharingPlanChanges(
  record: Readonly<Record<string, unknown>>,
  plan: CrmSharingPlan,
): boolean {
  if (!sameList(tokenList(record['visibleTo']), plan.visibleTo)) return true
  const storedWrite = record[CRM_WRITE_SCOPE_FIELD]
  if (!sameList(Array.isArray(storedWrite) ? tokenList(storedWrite) : null, plan.writeTo)) return true
  const stored = record[CRM_SHARING_FIELD]
  if (!plan.sharing) return stored !== undefined && stored !== null
  const grants = readRecordGrants(record)
  const keys = Object.keys(plan.sharing.grants)
  if (keys.length !== Object.keys(grants).length) return true
  if (!keys.every((key) => sameGrant(grants[key], plan.sharing!.grants[key]))) return true
  const sharing = (stored ?? {}) as Record<string, unknown>
  return (
    !sameList(tokenList(sharing['tokens']), plan.sharing.tokens) ||
    !sameList(tokenList(sharing['added']), plan.sharing.added) ||
    !sameList(
      Array.isArray(sharing['ruleIds']) ? (sharing['ruleIds'] as unknown[]) : [],
      plan.sharing.ruleIds,
    ) ||
    !sameList(tokenList(sharing['orgWideHeldBy']), plan.sharing.orgWideHeldBy)
  )
}

/*==========================================
 * SHARING RULES: `crm.sharingRules` on the org document.
 *=========================================*/

/** The org document path the rules are stored under. */
export const CRM_SHARING_RULES_PATH = 'crm.sharingRules'

/** A workspace keeps at most this many. */
export const CRM_SHARING_RULES_MAX = 20

/** At most this many values per criterion. */
export const CRM_SHARING_CRITERION_MAX = 20

/**
 * Which records a rule matches, beyond the object and the capturing site.
 * AND across the keys, OR within one; an absent or empty key matches
 * everything.
 */
export interface CrmSharingCriteria {
  /** A lead's or a contact's lead source, by label. */
  leadSources?: string[]
  /**
   * A lead's or a contact's lead source DIRECTION — `inbound` or `outbound`,
   * the Lead source picklist's groups (AGL-3511). Expanded through the org's
   * list when the rule is evaluated, so a value moved between groups moves
   * the records that hold it.
   */
  leadSourceGroups?: string[]
  /** Any of these tags (lead, contact, company). */
  tags?: string[]
  /** Filed under any of these campaigns (lead, contact). */
  campaignIds?: string[]
  /** A lead's status, a contact's lifecycle stage, or a deal's stage id. */
  stages?: string[]
  /** Owned by any of these members. */
  ownerUids?: string[]
}

export const CRM_SHARING_CRITERIA_KEYS = [
  'leadSources',
  'leadSourceGroups',
  'tags',
  'campaignIds',
  'stages',
  'ownerUids',
] as const satisfies readonly (keyof CrmSharingCriteria)[]

/** Which criteria an object's records can answer. */
export const CRM_SHARING_CRITERIA_FOR: Readonly<
  Record<CrmSharingObject, readonly (keyof CrmSharingCriteria)[]>
> = {
  leads: ['leadSources', 'leadSourceGroups', 'tags', 'campaignIds', 'stages', 'ownerUids'],
  contacts: ['leadSources', 'leadSourceGroups', 'tags', 'campaignIds', 'stages', 'ownerUids'],
  companies: ['tags', 'ownerUids'],
  deals: ['stages', 'ownerUids'],
}

/** Where a rule's recompute stands. */
export interface CrmSharingRuleRun {
  status: 'running' | 'done' | 'failed'
  /** What the run does: apply the rule everywhere, or take it away. */
  mode: 'apply' | 'remove'
  /** Records examined. */
  processed: number
  /** Records whose sharing changed. */
  changed: number
  /** The last record id an `apply` run examined, to continue after. */
  cursor?: string | null
  startedAtMs: number
  finishedAtMs?: number
  error?: string
}

export interface CrmSharingRule {
  id: string
  name: string
  object: CrmSharingObject
  /** Off keeps the rule and takes away what it granted. */
  enabled: boolean
  /** Records captured or created on any of these sites; empty is every site. */
  sourceHostIds: string[]
  criteria: CrmSharingCriteria
  /** `['org']` for all sites, including sites added later; else host tokens. */
  targets: ScopeToken[]
  access: CrmShareAccess
  /** Being deleted: its grants are being removed, and it matches nothing. */
  deleting?: boolean
  createdByUid?: string
  createdAtMs: number
  updatedAtMs: number
  run?: CrmSharingRuleRun
}

const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/

function stringList(raw: unknown, max = CRM_SHARING_CRITERION_MAX): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    const value = String(entry ?? '').trim().slice(0, 200)
    if (value && !out.includes(value)) out.push(value)
    if (out.length >= max) break
  }
  return out
}

/** One rule as stored, cleaned, or null when it cannot be applied. */
export function readCrmSharingRule(raw: unknown): CrmSharingRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const id = String(value['id'] ?? '')
  if (!RULE_ID.test(id)) return null
  if (!isCrmSharingObject(value['object'])) return null
  const targets = normalizeShareTargets(tokenList(value['targets']))
  if (!targets) return null
  const rawCriteria = (value['criteria'] ?? {}) as Record<string, unknown>
  const criteria: CrmSharingCriteria = {}
  for (const key of CRM_SHARING_CRITERIA_FOR[value['object']]) {
    let list = stringList(rawCriteria[key])
    // A direction is one of the picklist's groups, never free text.
    if (key === 'leadSourceGroups') list = list.filter(isLeadSourceDirection)
    if (list.length) criteria[key] = key === 'tags' ? list.map((tag) => tag.toLowerCase()) : list
  }
  const run = value['run'] as Record<string, unknown> | undefined
  return {
    id,
    name: String(value['name'] ?? '').trim().slice(0, 120) || 'Sharing rule',
    object: value['object'],
    enabled: value['enabled'] !== false,
    sourceHostIds: stringList(value['sourceHostIds'], MAX_SCOPE_HOSTS),
    criteria,
    targets,
    access: value['access'] === 'edit' ? 'edit' : 'read',
    ...(value['deleting'] === true ? { deleting: true } : {}),
    ...(typeof value['createdByUid'] === 'string' ? { createdByUid: value['createdByUid'] } : {}),
    createdAtMs: Number(value['createdAtMs']) || 0,
    updatedAtMs: Number(value['updatedAtMs']) || 0,
    ...(run && typeof run === 'object'
      ? {
          run: {
            status:
              run['status'] === 'done' || run['status'] === 'failed' ? run['status'] : 'running',
            mode: run['mode'] === 'remove' ? 'remove' : 'apply',
            processed: Number(run['processed']) || 0,
            changed: Number(run['changed']) || 0,
            cursor: typeof run['cursor'] === 'string' ? run['cursor'] : null,
            startedAtMs: Number(run['startedAtMs']) || 0,
            ...(typeof run['finishedAtMs'] === 'number' ? { finishedAtMs: run['finishedAtMs'] } : {}),
            ...(typeof run['error'] === 'string' ? { error: run['error'] } : {}),
          },
        }
      : {}),
  }
}

/** The org's sharing rules, in their stored order. */
export function readCrmSharingRules(
  org: Readonly<Record<string, unknown>> | null | undefined,
): CrmSharingRule[] {
  const crm = (org ?? {})['crm']
  const raw =
    crm && typeof crm === 'object' && !Array.isArray(crm)
      ? (crm as Record<string, unknown>)['sharingRules']
      : undefined
  if (!Array.isArray(raw)) return []
  const out: CrmSharingRule[] = []
  for (const entry of raw) {
    const rule = readCrmSharingRule(entry)
    if (rule && !out.some((existing) => existing.id === rule.id)) out.push(rule)
  }
  return out
}

/** The rules that grant anything now: enabled, and not being deleted. */
export function activeSharingRules(
  rules: readonly CrmSharingRule[],
  object?: CrmSharingObject,
): CrmSharingRule[] {
  return rules.filter(
    (rule) => rule.enabled && !rule.deleting && (!object || rule.object === object),
  )
}

/**
 * A share's targets, cleaned for storage: `['org']` when all sites are
 * named, else the host tokens, capped. `null` when nothing is left.
 */
export function normalizeShareTargets(tokens: readonly string[]): ScopeToken[] | null {
  const clean = tokenList(tokens)
  if (!clean.length) return null
  if (clean.includes(ORG_SCOPE_TOKEN)) return [ORG_SCOPE_TOKEN]
  if (clean.length > MAX_SCOPE_HOSTS) return null
  return clean
}

/** Targets from a request: `'all'`, or a list of host ids. */
export function shareTargetsFrom(input: unknown): ScopeToken[] | null {
  if (input === 'all') return [ORG_SCOPE_TOKEN]
  if (!Array.isArray(input)) return null
  return normalizeShareTargets(
    input
      .map((id) => String(id ?? '').trim())
      .filter((id) => id && !id.includes('/') && !id.includes(':'))
      .map(hostScopeToken),
  )
}

/*==========================================
 * WHAT A RULE READS OFF A RECORD.
 *=========================================*/

export interface CrmSharingFacts {
  hostIds: string[]
  leadSources: string[]
  tags: string[]
  campaignIds: string[]
  stages: string[]
  ownerUids: string[]
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter(Boolean) : []

/**
 * The facts a rule's criteria are matched against. A contact keeps each
 * holder's working fields in its own facet, so a contact answers with the
 * union of its facets: a rule about "contacts tagged vip" matches a person
 * any holder tagged.
 */
export function crmSharingFacts(
  object: CrmSharingObject,
  record: Readonly<Record<string, unknown>>,
): CrmSharingFacts {
  const facts: CrmSharingFacts = {
    hostIds: recordHolderHostIds(record),
    leadSources: [],
    tags: [],
    campaignIds: [],
    stages: [],
    ownerUids: [],
  }
  const take = (source: Readonly<Record<string, unknown>>, stageField: string | null) => {
    const leadSource = str(source['leadSource'])
    if (leadSource) facts.leadSources.push(leadSource)
    facts.tags.push(...strs(source['tags']).map((tag) => tag.toLowerCase()))
    facts.campaignIds.push(...strs(source['campaignIds']))
    const stage = stageField ? str(source[stageField]) : ''
    if (stage) facts.stages.push(stage)
    const owner = str(source['ownerUid'])
    if (owner) facts.ownerUids.push(owner)
  }
  if (object === 'leads') take(record, 'status')
  else if (object === 'companies') take(record, null)
  else if (object === 'deals') take(record, 'stageId')
  else {
    const facets = record['facets']
    if (facets && typeof facets === 'object' && !Array.isArray(facets)) {
      for (const facet of Object.values(facets as Record<string, unknown>)) {
        if (facet && typeof facet === 'object' && !Array.isArray(facet)) {
          take(facet as Record<string, unknown>, 'lifecycleStage')
        }
      }
    }
  }
  // A lead with no status is New, as every lead reader answers it.
  if (object === 'leads' && !facts.stages.length) facts.stages.push('new')
  return facts
}

const anyOf = (wanted: readonly string[] | undefined, have: readonly string[], fold = false) => {
  if (!wanted?.length) return true
  const set = new Set(fold ? have.map((value) => value.toLowerCase()) : have)
  return wanted.some((value) => set.has(fold ? value.toLowerCase() : value))
}

/**
 * What a rule is evaluated against beyond the record: the org's Lead source
 * list, which a direction criterion is expanded through (AGL-3511). Absent,
 * the standard values alone answer.
 */
export interface CrmSharingContext {
  leadSources?: CrmPicklist
}

/** Whether any active rule for `object` asks a lead source direction — whether the list must be read. */
export function sharingRulesAskLeadSourceDirection(
  rules: readonly CrmSharingRule[],
  object: CrmSharingObject,
): boolean {
  return activeSharingRules(rules, object).some((rule) => Boolean(rule.criteria.leadSourceGroups?.length))
}

/** Whether a rule shares this record. */
export function crmSharingRuleMatches(
  rule: CrmSharingRule,
  object: CrmSharingObject,
  record: Readonly<Record<string, unknown>>,
  context: CrmSharingContext = {},
): boolean {
  if (!rule.enabled || rule.deleting || rule.object !== object) return false
  const facts = crmSharingFacts(object, record)
  if (rule.sourceHostIds.length && !facts.hostIds.some((id) => rule.sourceHostIds.includes(id))) {
    return false
  }
  const { criteria } = rule
  const directions = criteria.leadSourceGroups?.length
    ? facts.leadSources
        .map((label) => leadSourceDirectionOf(context.leadSources ?? STANDARD_LEAD_SOURCES, label))
        .filter((direction): direction is NonNullable<typeof direction> => direction !== null)
    : []
  return (
    anyOf(criteria.leadSources, facts.leadSources, true) &&
    anyOf(criteria.leadSourceGroups, directions) &&
    anyOf(criteria.tags, facts.tags, true) &&
    anyOf(criteria.campaignIds, facts.campaignIds) &&
    anyOf(criteria.stages, facts.stages) &&
    anyOf(criteria.ownerUids, facts.ownerUids)
  )
}

/**
 * The grants a record should carry: its hand shares as they are, and one
 * grant per active rule that matches it now. A rule grant already present
 * keeps its date, so re-evaluating an unchanged record writes nothing.
 *
 * A rule grant whose rule is not among `rules` is dropped — the caller
 * passes every active rule of the org, so a rule absent from them has been
 * switched off or deleted.
 */
export function evaluateRecordGrants(
  object: CrmSharingObject,
  record: Readonly<Record<string, unknown>>,
  rules: readonly CrmSharingRule[],
  atMs: number,
  context: CrmSharingContext = {},
): Record<string, CrmShareGrant> {
  const current = readRecordGrants(record)
  const next: Record<string, CrmShareGrant> = {}
  for (const [key, grant] of Object.entries(current)) {
    if (grant.source === 'manual') next[key] = grant
  }
  for (const rule of activeSharingRules(rules, object)) {
    if (!crmSharingRuleMatches(rule, object, record, context)) continue
    const key = ruleGrantKey(rule.id)
    const before = current[key]
    next[key] = {
      source: 'rule',
      ruleId: rule.id,
      tokens: [...rule.targets],
      access: rule.access,
      atMs: before && sameList(before.tokens, rule.targets) && before.access === rule.access
        ? before.atMs
        : atMs,
    }
  }
  return next
}

/** The hand shares after sharing with `targets`, by `by`. */
export function withManualShares(
  grants: Readonly<Record<string, CrmShareGrant>>,
  targets: readonly ScopeToken[],
  access: CrmShareAccess,
  by: { uid: string; name?: string | null },
  atMs: number,
): Record<string, CrmShareGrant> {
  const next = { ...grants }
  for (const token of targets) {
    const name = String(by.name ?? '').trim()
    next[manualGrantKey(token)] = {
      source: 'manual',
      tokens: [token],
      access,
      byUid: by.uid,
      ...(name ? { byName: name } : {}),
      atMs,
    }
  }
  return next
}

/** The hand shares after unsharing `targets`. Rule grants are the rule's to take away. */
export function withoutManualShares(
  grants: Readonly<Record<string, CrmShareGrant>>,
  targets: readonly string[],
): Record<string, CrmShareGrant> {
  const drop = new Set(targets.filter(isScopeToken).map(manualGrantKey))
  return Object.fromEntries(Object.entries(grants).filter(([key]) => !drop.has(key)))
}

/*==========================================
 * WHAT A READER SEES.
 *=========================================*/

/**
 * Whether a caller holding `tokens` may write the record: `writeTo` on a
 * shared record, else `visibleTo` — the Firestore rules' own predicate.
 */
export function crmRecordWritableBy(
  record: Readonly<Record<string, unknown>>,
  tokens: readonly string[],
): boolean {
  const writeTo = record[CRM_WRITE_SCOPE_FIELD]
  const scope = Array.isArray(writeTo) ? writeTo : record['visibleTo']
  if (!Array.isArray(scope) || !tokens.length) return false
  return scope.some((token) => tokens.includes(token as string))
}

/** How a record reached a site that sees it only through a share. */
export interface CrmShareChip {
  source: CrmShareSource
  access: CrmShareAccess
  /** The member who shared it by hand. */
  byName?: string
  /** The rule that shared it. */
  ruleId?: string
  /** Shared with every site. */
  allSites: boolean
}

/**
 * Why a site seeing this record sees it, when the answer is a share — or
 * `null` when the site holds it (or cannot see it at all). `hostIds` are
 * the viewing group's sites; at the organization level there is none.
 */
export function crmShareChipFor(
  record: Readonly<Record<string, unknown>> | null | undefined,
  hostIds: readonly string[],
): CrmShareChip | null {
  if (!record || !hostIds.length) return null
  const held = recordHeldScope(record)
  if (held.includes(ORG_SCOPE_TOKEN)) return null
  const viewing = new Set(hostIds.map(hostScopeToken))
  if (held.some((token) => viewing.has(token))) return null
  const grants = Object.values(readRecordGrants(record))
  const reaching = grants.filter((grant) =>
    grant.tokens.some((token) => token === ORG_SCOPE_TOKEN || viewing.has(token)),
  )
  if (!reaching.length) return null
  // A hand share names a person, so it leads; an edit grant outranks read.
  const pick =
    reaching.find((grant) => grant.source === 'manual' && grant.access === 'edit') ??
    reaching.find((grant) => grant.source === 'manual') ??
    reaching.find((grant) => grant.access === 'edit') ??
    reaching[0]
  return {
    source: pick.source,
    access: reaching.some((grant) => grant.access === 'edit') ? 'edit' : 'read',
    ...(pick.byName ? { byName: pick.byName } : {}),
    ...(pick.ruleId ? { ruleId: pick.ruleId } : {}),
    allSites: pick.tokens.includes(ORG_SCOPE_TOKEN),
  }
}

/** The chip's words: "Shared by Dana", "Shared by rule Brand A leads". */
export function crmShareChipLabel(
  chip: CrmShareChip,
  rules: readonly Pick<CrmSharingRule, 'id' | 'name'>[] = [],
): string {
  if (chip.source === 'manual') return chip.byName ? `Shared by ${chip.byName}` : 'Shared by hand'
  const rule = rules.find((entry) => entry.id === chip.ruleId)
  return rule ? `Shared by rule ${rule.name}` : 'Shared by a rule'
}

/** One line of a record's Sharing card. */
export type CrmSharingLine =
  | { kind: 'held'; hostIds: string[]; allSites: boolean }
  | {
      kind: 'manual'
      key: string
      token: ScopeToken
      access: CrmShareAccess
      byName?: string
      atMs: number
    }
  | { kind: 'rule'; key: string; ruleId: string; tokens: ScopeToken[]; access: CrmShareAccess; atMs: number }

/**
 * Where a record is visible and why: the sites that hold it (its consent
 * group or its creating site), then one line per hand share, then one per
 * rule. The held line is never unsharable; a hand share is, in one click.
 */
export function describeRecordSharing(
  record: Readonly<Record<string, unknown>> | null | undefined,
): CrmSharingLine[] {
  if (!record) return []
  const held = recordHeldScope(record)
  const lines: CrmSharingLine[] = [
    { kind: 'held', hostIds: hostIdsFromScope(held), allSites: held.includes(ORG_SCOPE_TOKEN) },
  ]
  const grants = Object.entries(readRecordGrants(record))
  for (const [key, grant] of grants) {
    if (grant.source !== 'manual') continue
    lines.push({
      kind: 'manual',
      key,
      token: grant.tokens[0],
      access: grant.access,
      ...(grant.byName ? { byName: grant.byName } : {}),
      atMs: grant.atMs,
    })
  }
  for (const [key, grant] of grants) {
    if (grant.source !== 'rule' || !grant.ruleId) continue
    lines.push({
      kind: 'rule',
      key,
      ruleId: grant.ruleId,
      tokens: grant.tokens,
      access: grant.access,
      atMs: grant.atMs,
    })
  }
  return lines
}

/** "All sites", a site's name, or "N sites". */
export function describeShareTargets(
  tokens: readonly string[],
  siteName: (hostId: string) => string,
): string {
  if (tokens.includes(ORG_SCOPE_TOKEN)) return 'All sites'
  const ids = hostIdsFromScope(tokens)
  if (ids.length === 1) return siteName(ids[0])
  if (ids.length <= 3) return ids.map(siteName).join(', ')
  return `${ids.length} sites`
}

/** A rule as one sentence of its "which records" half. */
export function describeSharingRuleScope(
  rule: Pick<CrmSharingRule, 'object' | 'sourceHostIds' | 'criteria'>,
  siteName: (hostId: string) => string,
  labels: { owner?: (uid: string) => string; stage?: (id: string) => string } = {},
): string {
  const parts: string[] = [CRM_SHARING_OBJECT_LABELS[rule.object].many]
  if (rule.sourceHostIds.length) {
    parts.push(`captured on ${rule.sourceHostIds.map(siteName).join(' or ')}`)
  }
  const { criteria } = rule
  if (criteria.leadSources?.length) parts.push(`from ${criteria.leadSources.join(' or ')}`)
  if (criteria.leadSourceGroups?.length) {
    const directions = criteria.leadSourceGroups.map((group) =>
      isLeadSourceDirection(group) ? LEAD_SOURCE_DIRECTION_LABELS[group] : group,
    )
    parts.push(`${directions.join(' or ')} by lead source`)
  }
  if (criteria.tags?.length) parts.push(`tagged ${criteria.tags.join(' or ')}`)
  if (criteria.campaignIds?.length) {
    parts.push(`in ${criteria.campaignIds.length === 1 ? 'a campaign' : `${criteria.campaignIds.length} campaigns`}`)
  }
  if (criteria.stages?.length) {
    parts.push(`at ${criteria.stages.map((id) => labels.stage?.(id) ?? id).join(' or ')}`)
  }
  if (criteria.ownerUids?.length) {
    parts.push(`owned by ${criteria.ownerUids.map((uid) => labels.owner?.(uid) ?? uid).join(' or ')}`)
  }
  return parts.join(', ')
}

/*==========================================
 * THE ROUTE.
 *=========================================*/

/** `POST /api/crm/sharing` — every sharing act, by `action`. */
export const CRM_SHARING_ROUTE = 'crm/sharing' as const

export const crmSharingRouteUrl = (): string => `/api/${CRM_SHARING_ROUTE}`

/** Records one share or unshare may name. */
export const CRM_SHARING_IDS_MAX = 200

export type CrmSharingAction =
  | 'sites'
  | 'share'
  | 'unshare'
  | 'evaluate'
  | 'rule-save'
  | 'rule-delete'
  | 'rule-continue'

export interface CrmSharingSite {
  id: string
  name: string
}

export interface CrmSharingResponse {
  ok: true
  /** `sites`: the org's sites, by name. */
  sites?: CrmSharingSite[]
  /** `share`/`unshare`/`evaluate`: records whose sharing changed. */
  changed?: number
  /** Records named that could not be found. */
  missing?: number
  /** The rule a rule action saved or ran. */
  rule?: CrmSharingRule | null
  /** Whether a rule run has more to do (`rule-continue` again). */
  more?: boolean
}
