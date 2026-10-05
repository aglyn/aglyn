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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import { hostRoleCanPublish, hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement, checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  ACKNOWLEDGED_WARNING_CLASSES,
  TRANSFER_ID_FIELD,
  TRANSFER_WARNING_CLASSES,
  buildTransferPlan,
  isBlankTransferValue,
  matchLookupKey,
  planTransferUndo,
  transferValuesEqual,
  withTransferResourceFindings,
  type BuildTransferPlanInput,
  type PlannedTransferRow,
  type RowMatchOutcome,
  type TransferFieldChange,
  type TransferPlan,
  type TransferPlanRow,
  type TransferPlanSummary,
  type TransferResourceFinding,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
  type TransferWarning,
} from '@aglyn/aglyn/data-transfer'
import {
  pluginHostResource,
  type ResolvedPluginHostResource,
} from '@aglyn/aglyn/plugin-manager/plugin-host-resources'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type {
  PluginTransferResource,
  TransferApplyResult,
  TransferApplyWriter,
  TransferLookupResult,
  TransferMatchAnswer,
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
  TransferRevertDecisions,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  REDIRECT_DEFAULT_PRIORITY,
  REDIRECT_STATUS_CODES,
  findDuplicateRedirect,
  isExternalRedirectDestination,
  isSelfRedirect,
  normalizeRedirectDestination,
  normalizeRedirectSource,
  redirectHitKey,
  redirectSourceIsLivePage,
  validateRedirectRule,
  walkRedirectChain,
  type RedirectRuleRow,
} from '../model/redirects'
import {
  REDIRECTS_ALIAS_DICTIONARIES,
  REDIRECTS_DEFAULT_POLICY,
  REDIRECTS_MATCH_KEYS,
  REDIRECT_FIELD,
  REDIRECT_HOST_RESOURCE_KIND,
  REDIRECT_WRITABLE_FIELDS,
  canonicalRedirectKind,
  redirectValuesEqual,
  redirectsTransferCatalog,
} from './redirects-transfer-fields'

/*==========================================
 * THE REDIRECTS RESOURCE — a site's redirect rules, in and out of a file.
 *
 * A rule is a routing statement over the live site the moment it is written,
 * so an import writes nothing the redirects page or the create route would
 * not. Every write here makes the checks those paths make, in the same words:
 *
 *  - who: the publishing role on the site (`hostRoleCanPublish`, the axis the
 *    Firestore rules gate the collection on) and the plan's `redirects`
 *    feature — read from the create route's own declaration of the kind, not
 *    restated. Without either, every row is refused with the reason.
 *  - what: the declaration's allow-list of fields, the page's normalization
 *    of the from-path and the destination, its defaults (exact, 302, priority
 *    100, on), and `validateRedirectRule` — so a lookalike destination, a
 *    pattern the matcher cannot run and a path that redirects to itself are
 *    refused, as the page refuses them.
 *  - against what: the page's duplicate check (`findDuplicateRedirect`) and
 *    chain-loop walk (`walkRedirectChain`) over the site's rules as the
 *    import leaves them, row by row in file order, so a row is refused
 *    exactly when saving it after the rows above would be refused.
 *  - how many: a new rule is counted and created in one transaction against
 *    the plan's `redirectsPerHost`, as the create route does; the dry run
 *    holds the creates past what the plan leaves.
 *  - provenance: `externalDestinationApprovedBy` is never read from a file.
 *    A written rule whose destination is off the site carries the importing
 *    member's uid, the same stamp the page and the route write and the serve
 *    path requires; one whose destination is on the site has it removed.
 *    The dry run says so for every such row, naming the host.
 *  - afterwards: a created rule gets the route's `createdAt`, `updatedAt`,
 *    `createdBy` and its "Created redirect" activity line; every written
 *    from-path (and one an update moved away from) is announced to the site
 *    cache, `/` for a regex rule, as the page announces a save.
 *
 * The dry run also warns, without refusing, where the page warns or a
 * person would want to know: a from-path that is a published page, a
 * destination that is itself redirected (a chain), and one that leads into a
 * loop other rules make.
 *
 * Reads skip soft-deleted rules (`deletedAt`), as the page does. Undo
 * deletes a rule the import created — outright rather than soft-deleted:
 * the rule did not exist before the import, and a soft-deleted document
 * would keep occupying a slot the plan's counter counts — and restores the
 * fields an update changed, stamp included.
 *=========================================*/

/** The billing document a plan's entitlement and counter are read from. */
type OrgBilling = Parameters<typeof checkEntitlement>[0]

export interface RedirectsTransferDeps {
  firestore: FirebaseFirestore.Firestore
  /** Defaults to `Date.now`. */
  now?: () => number
  /** The site's owning workspace's billing document (`getOrgForHost`); `null` reads as the free plan. */
  loadOrg(hostId: string): Promise<OrgBilling | null>
  /**
   * Drops the site's cached pages at these addresses, best effort. Defaults
   * to the platform's site cache (`dropPluginSiteCache`), the announcement
   * the create route makes for a new rule.
   */
  announcePaths?(hostId: string, paths: readonly string[]): Promise<void>
  /** Writes the site activity line for a created rule, best effort. */
  logCreated?(hostId: string, actorUid: string, ruleId: string, resource: ResolvedPluginHostResource): Promise<void>
}

/** How long before the chunk's budget runs out a row is not started. */
const ROW_RESERVE_MS = 2_000

/** The most rows one export page reads. */
const PAGE_SIZE_DEFAULT = 500
const PAGE_SIZE_MAX = 1_000

/** Values one `in` query may name. */
const IN_QUERY_MAX = 30

/** Documents one `getAll` reads. */
const GET_ALL_MAX = 100

/** Days the hit count sums, as the redirects page does. */
const HIT_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/*==========================================
 * A RULE AS THE TRANSFER READS IT
 *=========================================*/

type StoredRule = Record<string, unknown>

/** The rule's six writable fields, as written. */
interface RuleFields {
  source: string
  kind: string
  destination: string
  statusCode: number
  priority: number
  enabled: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A stored time as ISO text, or `null`. */
function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return new Date((value as { toMillis(): number }).toMillis()).toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  return null
}

function validStatusCode(value: unknown): value is RuleFields['statusCode'] {
  return (REDIRECT_STATUS_CODES as readonly number[]).includes(value as number)
}

/**
 * A stored rule's fields as the redirects page reads them into its editor: a
 * missing mode is exact, a missing priority 100, a status code outside the
 * four is 302 (as the serve path reads it), and a rule is on unless it says
 * `false`. The export, the dry run's "before" and undo all read this, so a
 * file exported and imported back is unchanged.
 */
export function redirectRuleValues(id: string, data: StoredRule): Record<string, unknown> {
  const priority = data['priority']
  return {
    [TRANSFER_ID_FIELD]: id,
    source: text(data['source']),
    kind: typeof data['kind'] === 'string' && data['kind'] ? data['kind'] : 'exact',
    destination: text(data['destination']),
    statusCode: validStatusCode(data['statusCode']) ? data['statusCode'] : 302,
    priority:
      priority !== null && priority !== undefined && Number.isFinite(Number(priority))
        ? Number(priority)
        : REDIRECT_DEFAULT_PRIORITY,
    enabled: data['enabled'] !== false,
    [REDIRECT_FIELD.approvedBy]:
      typeof data[REDIRECT_FIELD.approvedBy] === 'string' && data[REDIRECT_FIELD.approvedBy]
        ? data[REDIRECT_FIELD.approvedBy]
        : null,
    createdAt: isoOf(data['createdAt']),
    updatedAt: isoOf(data['updatedAt']),
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : null,
    lastHitAt: isoOf(data['lastHitAt']),
  }
}

/** A rule as the whole-set checks read it: as stored, like the page's rows. */
function ruleRow(id: string, data: StoredRule): RedirectRuleRow {
  return {
    $id: id,
    source: data['source'] as string,
    destination: data['destination'] as string,
    kind: data['kind'] as string,
  }
}

function isLive(data: StoredRule | undefined): data is StoredRule {
  return Boolean(data) && !data?.['deletedAt']
}

/**
 * The from-path as a rule of `kind` stores it: a pattern trimmed, a path
 * normalized (lowercase, no trailing slash, no query); `null` when a path
 * cannot be one.
 */
function storedSource(kind: string, source: string): string | null {
  if (kind === 'regex') return source.trim() || null
  return normalizeRedirectSource(source)
}

/** What makes two rules one: their mode and their from-path, as stored. */
function ruleKey(kind: string, source: string): string | null {
  const stored = storedSource(kind, source)
  return stored === null ? null : `${kind}\u0000${stored}`
}

/** The address a rule answers at, for the site cache: a pattern names no one path, so `/`. */
function announcedPath(rule: { kind?: string; source?: string }): string | null {
  const source = text(rule.source)
  if ((rule.kind ?? 'exact') === 'regex') return '/'
  return source.startsWith('/') ? source : null
}

/** The rule a row leaves: what the record held (or the defaults), with the row's changes. */
function finalRule(
  before: Readonly<Record<string, unknown>> | null | undefined,
  diff: readonly TransferFieldChange[],
): RuleFields {
  const values: Record<string, unknown> = { ...(before ?? {}) }
  for (const change of diff) values[change.fieldId] = change.after
  return withDefaults(values)
}

/**
 * The six fields with the page's defaults where a value is missing:
 * exact, 302, priority 100, on.
 */
function withDefaults(values: Readonly<Record<string, unknown>>): RuleFields {
  const priority = values['priority']
  const kind = canonicalRedirectKind(values['kind'])
  return {
    source: text(values['source']),
    kind: isBlankTransferValue(values['kind']) ? 'exact' : (kind ?? String(values['kind'])),
    destination: text(values['destination']),
    statusCode: isBlankTransferValue(values['statusCode'])
      ? 302
      : (Number(values['statusCode']) as RuleFields['statusCode']),
    priority:
      priority !== null && priority !== undefined && Number.isFinite(Number(priority))
        ? Number(priority)
        : REDIRECT_DEFAULT_PRIORITY,
    enabled: values['enabled'] !== false,
  }
}

/** The site's own addresses, which a destination may always name. */
function ownDomains(host: StoredRule): Array<string | null> {
  return [
    typeof host['cname'] === 'string' ? host['cname'] : null,
    typeof host['subdomain'] === 'string' && host['subdomain'] ? `${host['subdomain']}.${TENANT_APEX}` : null,
  ]
}

/**
 * Why the page would refuse to save this rule, or `null`: an unknown mode, a
 * from-path or pattern it cannot use, a destination it cannot use or that
 * wears another company's address, a status code it does not offer, or a
 * path redirected to itself.
 */
function ruleProblem(rule: RuleFields, host: StoredRule): { detail: string; fieldId: string; value: string } | null {
  const problem = validateRedirectRule(
    { kind: rule.kind, source: rule.source, destination: rule.destination },
    { ownDomains: ownDomains(host) },
  )
  if (problem) {
    const fieldId =
      problem === 'Unknown match mode'
        ? REDIRECT_FIELD.kind
        : /destination/i.test(problem)
          ? REDIRECT_FIELD.destination
          : REDIRECT_FIELD.source
    return { detail: problem, fieldId, value: String((rule as unknown as Record<string, unknown>)[fieldId] ?? '') }
  }
  if (!validStatusCode(rule.statusCode)) {
    return {
      detail: 'Status codes are 301, 302, 307 or 308',
      fieldId: REDIRECT_FIELD.statusCode,
      value: String(rule.statusCode),
    }
  }
  if (rule.kind !== 'regex' && isSelfRedirect({ source: rule.source, destination: rule.destination })) {
    return { detail: 'That would redirect the path to itself', fieldId: REDIRECT_FIELD.destination, value: rule.destination }
  }
  return null
}

/** The rule's fields as stored: the page's normalization, and only what the create route's allow-list names. */
function storedFields(rule: RuleFields, allowed: readonly string[]): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    source: rule.kind === 'regex' ? rule.source.trim() : (normalizeRedirectSource(rule.source) ?? rule.source),
    destination: normalizeRedirectDestination(rule.destination) ?? rule.destination,
    statusCode: rule.statusCode,
    kind: rule.kind,
    priority: rule.priority,
    enabled: rule.enabled,
  }
  return Object.fromEntries(Object.entries(normalized).filter(([key]) => allowed.includes(key)))
}

function hostnameOf(destination: string): string {
  try {
    return new URL(destination).hostname || destination
  } catch {
    return destination
  }
}

/*==========================================
 * THE SITE, AS A WRITE IS DECIDED AGAINST IT
 *=========================================*/

interface SiteState {
  hostId: string
  host: StoredRule
  org: OrgBilling | null
  declared: ResolvedPluginHostResource
  /** Why nothing may be written, or `null`. */
  refusal: string | null
  /** The plan's cap on rules on the site, `Infinity` for none. */
  limit: number
}

function requireHost(ctx: TransferResourceContext): string {
  if (!ctx.hostId) throw new Error('Redirects belong to a site; open the import from the site.')
  return ctx.hostId
}

/** The redirect kind's declaration, which the create route reads too. */
function redirectDeclaration(): ResolvedPluginHostResource {
  const declared = pluginHostResource(REDIRECT_HOST_RESOURCE_KIND)
  if (!declared) throw new Error(`The "${REDIRECT_HOST_RESOURCE_KIND}" kind is not declared.`)
  return declared
}

/** Field ids → values, holding only `fieldIds`. */
function pick(values: Readonly<Record<string, unknown>>, fieldIds: readonly string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const fieldId of fieldIds) row[fieldId] = values[fieldId] ?? null
  return row
}

/** Each `size` items of `items`. */
function slices<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
  return out
}

/**
 * The plan with every create past `remaining` failed as `planLimit`, counted
 * after the rows the plugin refused — a refused row takes no slot.
 */
function withCreateLimit(plan: TransferPlan, remaining: number, limit: number): TransferPlan {
  if (!Number.isFinite(remaining)) return plan
  let creates = 0
  const held: PlannedTransferRow[] = []
  const rows = plan.rows.map((row) => {
    if (row.verdict !== 'create') return row
    if (creates < remaining) {
      creates += 1
      return row
    }
    const failed: PlannedTransferRow = {
      ...row,
      verdict: 'fail',
      reason: 'planLimit',
      diff: [],
      warnings: row.warnings.includes('planLimit') ? row.warnings : [...row.warnings, 'planLimit'],
    }
    held.push(failed)
    return failed
  })
  if (!held.length) return plan
  const summary: TransferPlanSummary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  const detail = `Your plan includes ${limit} redirects on this site`
  const prior = plan.warnings.find((entry) => entry.class === 'planLimit')
  const raised: TransferWarning = {
    class: 'planLimit',
    count: (prior?.count ?? 0) + held.length,
    rows: (prior?.rows ?? 0) + held.length,
    fieldIds: prior?.fieldIds ?? [],
    samples: [...(prior?.samples ?? []), ...held.map((row) => ({ row: row.index, detail }))].slice(0, 5),
    requiresAcknowledgement: ACKNOWLEDGED_WARNING_CLASSES.includes('planLimit'),
  }
  const warnings = TRANSFER_WARNING_CLASSES.flatMap((entry) =>
    entry === 'planLimit' ? [raised] : plan.warnings.filter((warning) => warning.class === entry),
  )
  return {
    rows,
    summary,
    warnings,
    acknowledgementsRequired: warnings.filter((entry) => entry.requiresAcknowledgement).map((entry) => entry.class),
  }
}

/*==========================================
 * MATCHING, DEFAULTS AND SAMENESS (AGL-3548)
 *=========================================*/

/**
 * Each row's rule, as the page tells rules apart: a row the engine found by
 * its id keeps that rule; any other row is the rule of its mode (exact when
 * the file gives none) at its from-path as stored — so `/blog` names the
 * exact rule or the prefix rule beside it by the row's mode, never both.
 * Two rows naming one rule are both matched to it here, and the plan refuses
 * the later one, saying which row it repeats, rather than holding it back as
 * a duplicate. `existing` holds every live rule's values by id; running this
 * over its own outcomes changes nothing.
 */
export function redirectMatchOutcomes(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  engine: readonly RowMatchOutcome[],
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  live: ReadonlyArray<{ id: string; data: StoredRule }>,
): RowMatchOutcome[] {
  // Each live rule under its mode and stored from-path.
  const byKey = new Map<string, string[]>()
  for (const { id, data } of live) {
    const key = ruleKey(text(data['kind']) || 'exact', text(data['source']))
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), id])
  }
  return rows.map((values, at): RowMatchOutcome => {
    const found = engine[at] ?? { kind: 'new' as const }
    const byId = found.kind !== 'new' && found.via.fieldId === TRANSFER_ID_FIELD
    const record = found.kind === 'matched' && byId ? existing.get(found.recordId) : undefined
    const rowKind = isBlankTransferValue(values['kind'])
      ? text(record?.['kind']) || 'exact'
      : canonicalRedirectKind(values['kind'])
    const source = isBlankTransferValue(values['source']) ? text(record?.['source']) : text(values['source'])
    const key = rowKind && source ? ruleKey(rowKind, source) : null
    if (byId || !key || !rowKind) return found
    const candidates = byKey.get(key) ?? []
    const via = { fieldId: REDIRECT_FIELD.source, value: storedSource(rowKind, source) as string }
    if (!candidates.length) return { kind: 'new' }
    return candidates.length === 1
      ? { kind: 'matched', recordId: candidates[0] as string, via }
      : { kind: 'ambiguous', recordIds: candidates, via }
  })
}

/*==========================================
 * THE RESOURCE
 *=========================================*/

/**
 * The id a rule an import creates is written under: the job's row, so a
 * write retried after it landed and before the ledger recorded it finds its
 * own rule instead of making a second one. Without a job, a fresh resource id.
 */
export function importedRedirectId(jobId: string | undefined, row: number): string {
  return jobId ? `${jobId}-${row}` : createResourceUid()
}

/**
 * The redirects resource over `deps.firestore`: `hosts/{hostId}/redirects`,
 * with every hook the job engine and the export route call. See the block
 * above for what each write checks.
 */
export function createRedirectsTransferResource(deps: RedirectsTransferDeps): PluginTransferResource {
  const now = deps.now ?? (() => Date.now())
  const { firestore } = deps
  const announce =
    deps.announcePaths ??
    (async (hostId: string, paths: readonly string[]) => {
      await dropPluginSiteCache({
        hostIds: [hostId],
        paths: { [hostId]: [...paths] },
        reason: 'redirect rules were imported',
      })
    })

  const hostRef = (hostId: string) => firestore.collection('hosts').doc(hostId)
  const rulesOf = (hostId: string) => hostRef(hostId).collection('redirects')

  async function readSite(ctx: TransferResourceContext): Promise<SiteState> {
    const hostId = requireHost(ctx)
    const [snapshot, org] = await Promise.all([hostRef(hostId).get(), deps.loadOrg(hostId)])
    const host = (snapshot.exists ? snapshot.data() : null) ?? {}
    const declared = redirectDeclaration()
    const role = ctx.actorUid ? ((host['memberRoles'] ?? {}) as Record<string, unknown>)[ctx.actorUid] : undefined
    // The route's question, on the route's axis: a kind that is live the
    // moment it exists needs the publishing role, never just the write role.
    const roleOk = declared.requiresPublishRole ? hostRoleCanPublish(role) : hostRoleCanWrite(role)
    // A plan-less workspace resolves as the free plan, which has no redirects.
    const billing = org ?? {}
    let refusal: string | null = null
    if (!snapshot.exists) refusal = 'This site no longer exists.'
    else if (!roleOk) refusal = 'Importing redirects needs a publishing role on this site — ask an editor or admin'
    else if (declared.entitlement && !checkEntitlement(billing, declared.entitlement)) {
      refusal = 'URL redirects are not included in this workspace’s plan — see Billing'
    }
    const limit = declared.quotaKey
      ? checkQuota(billing, declared.quotaKey as Parameters<typeof checkQuota>[1], 0).limit
      : Number.POSITIVE_INFINITY
    return { hostId, host, org: billing, declared, refusal, limit }
  }

  /** Every rule document of the site, soft-deleted ones included. */
  async function readAllRules(hostId: string): Promise<Array<{ id: string; data: StoredRule }>> {
    const snapshot = await rulesOf(hostId).get()
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as StoredRule }))
  }

  async function readByIds(hostId: string, ids: readonly string[]): Promise<Map<string, StoredRule>> {
    const found = new Map<string, StoredRule>()
    for (const slice of slices([...new Set(ids)], GET_ALL_MAX)) {
      if (!slice.length) continue
      const snapshots = await firestore.getAll(...slice.map((id) => rulesOf(hostId).doc(id)))
      for (const snapshot of snapshots) {
        const data = snapshot.exists ? (snapshot.data() as StoredRule) : undefined
        if (isLive(data)) found.set(snapshot.id, data)
      }
    }
    return found
  }

  /** Each rule's sampled hits over the last thirty days, by its hit key. */
  async function readHits(hostId: string): Promise<Record<string, number>> {
    const today = now()
    const refs = Array.from({ length: HIT_DAYS }, (_, index) =>
      hostRef(hostId)
        .collection('analytics')
        .doc(new Date(today - index * DAY_MS).toISOString().slice(0, 10)),
    )
    const totals: Record<string, number> = {}
    for (const snapshot of await firestore.getAll(...refs)) {
      if (!snapshot.exists) continue
      const day = ((snapshot.data() as StoredRule)['redirects'] ?? {}) as Record<string, unknown>
      for (const [key, count] of Object.entries(day)) {
        const value = Number(count)
        if (Number.isFinite(value)) totals[key] = (totals[key] ?? 0) + value
      }
    }
    return totals
  }

  function exportRow(
    id: string,
    data: StoredRule,
    fieldIds: readonly string[],
    hits: Record<string, number> | null,
  ): Record<string, unknown> {
    const values = redirectRuleValues(id, data)
    if (hits) values[REDIRECT_FIELD.hits] = hits[redirectHitKey(id)] ?? 0
    return pick(values, fieldIds)
  }

  const resource: PluginTransferResource = {
    fields: () => redirectsTransferCatalog(),
    matchKeys: REDIRECTS_MATCH_KEYS,
    aliases: REDIRECTS_ALIAS_DICTIONARIES,
    defaultPolicy: REDIRECTS_DEFAULT_POLICY,
    valuesEqual: redirectValuesEqual,

    /*
     * Rows matched as the page tells rules apart (`redirectMatchOutcomes`),
     * over every live rule of the site — so the Matching step and the
     * Conflicts step show the rule the dry run will update.
     */
    async match(ctx, input): Promise<TransferMatchAnswer> {
      const hostId = requireHost(ctx)
      const live = (await readAllRules(hostId)).filter((entry) => isLive(entry.data))
      const existing = new Map(input.records)
      for (const { id, data } of live) existing.set(id, redirectRuleValues(id, data))
      const outcomes = redirectMatchOutcomes(input.rows, input.outcomes, existing, live)
      const records = new Map<string, Readonly<Record<string, unknown>>>()
      for (const outcome of outcomes) {
        const ids = outcome.kind === 'matched' ? [outcome.recordId] : outcome.kind === 'ambiguous' ? outcome.recordIds : []
        for (const id of ids) {
          const values = existing.get(id)
          if (values && !input.records.has(id)) records.set(id, values)
        }
      }
      return { outcomes, records }
    },

    /*
     * `filter` is not read: the redirects page lists every rule and has no
     * filter to export by. `scopeTokens` does not narrow either: rules are a
     * site's, carry no `visibleTo`, and the export route admits a reader to
     * a site's records only when they reach the site.
     */
    async count(ctx: TransferResourceContext, options: TransferReadOptions): Promise<number> {
      const hostId = requireHost(ctx)
      if (options.ids) return (await readByIds(hostId, options.ids)).size
      const [all, deleted] = await Promise.all([
        rulesOf(hostId).count().get(),
        rulesOf(hostId).where('deletedAt', '!=', null).count().get(),
      ])
      return Math.max(0, all.data().count - deleted.data().count)
    },

    async readPage(
      ctx: TransferResourceContext,
      cursor: string | null,
      fieldIds: readonly string[],
      options: TransferReadOptions = {},
    ): Promise<TransferReadPage> {
      const hostId = requireHost(ctx)
      const size = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(options.pageSize ?? PAGE_SIZE_DEFAULT)))
      const hits = fieldIds.includes(REDIRECT_FIELD.hits) ? await readHits(hostId) : null
      if (options.ids) {
        // The selection, in the order it was made; the cursor is how far into it.
        const start = Math.max(0, Number(cursor ?? 0) || 0)
        const ids = options.ids.slice(start, start + size)
        const found = await readByIds(hostId, ids)
        const rows = ids.flatMap((id) => {
          const data = found.get(id)
          return data ? [exportRow(id, data, fieldIds, hits)] : []
        })
        return { rows, next: start + size < options.ids.length ? String(start + size) : null }
      }
      // Ordered by document id, the one order every rule has: a rule with no
      // `source` still exports (the page sorts by source, in the browser).
      let query = rulesOf(hostId).orderBy(FieldPath.documentId()).limit(size)
      if (cursor) query = query.startAfter(cursor)
      const snapshot = await query.get()
      const rows = snapshot.docs.flatMap((doc) => {
        const data = doc.data() as StoredRule
        return isLive(data) ? [exportRow(doc.id, data, fieldIds, hits)] : []
      })
      const last = snapshot.docs[snapshot.docs.length - 1]
      return { rows, next: snapshot.docs.length === size && last ? last.id : null }
    },

    /*
     * By id, and by from-path: each value is read as the stored form of a
     * path (normalized) and of a pattern (trimmed), and a rule answers for it
     * under its own mode. The plan narrows a row's candidates to the row's
     * mode; this answers every rule the value could mean.
     */
    async lookup(ctx, requests): Promise<TransferLookupResult> {
      const hostId = requireHost(ctx)
      const lookup = new Map<string, string[]>()
      const records = new Map<string, Readonly<Record<string, unknown>>>()
      const file = (fieldId: string, value: string, id: string) => {
        const key = matchLookupKey(fieldId, value)
        const ids = lookup.get(key) ?? []
        if (!ids.includes(id)) ids.push(id)
        lookup.set(key, ids)
      }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) {
          const found = await readByIds(hostId, request.values)
          for (const [id, data] of found) {
            file(TRANSFER_ID_FIELD, id, id)
            records.set(id, redirectRuleValues(id, data))
          }
          continue
        }
        if (request.fieldId !== REDIRECT_FIELD.source) continue
        const stored = new Set<string>()
        for (const value of request.values) {
          for (const form of [normalizeRedirectSource(value), value.trim()]) if (form) stored.add(form)
        }
        for (const slice of slices([...stored], IN_QUERY_MAX)) {
          const snapshot = await rulesOf(hostId).where('source', 'in', slice).get()
          for (const doc of snapshot.docs) {
            const data = doc.data() as StoredRule
            if (!isLive(data)) continue
            const kind = typeof data['kind'] === 'string' && data['kind'] ? data['kind'] : 'exact'
            const held = storedSource(kind, text(data['source']))
            for (const value of request.values) {
              if (held !== null && storedSource(kind, value) === held) {
                file(REDIRECT_FIELD.source, value, doc.id)
                records.set(doc.id, redirectRuleValues(doc.id, data))
              }
            }
          }
        }
      }
      return { lookup, records }
    },

    async plan(ctx, input: BuildTransferPlanInput): Promise<TransferPlan> {
      const site = await readSite(ctx)
      const documents = await readAllRules(site.hostId)
      const live = documents.filter((entry) => isLive(entry.data))
      const existing = new Map(input.existing)
      for (const { id, data } of live) existing.set(id, redirectRuleValues(id, data))

      // The resource's own matching (also the engine's `match` hook, so the
      // Matching and Conflicts steps showed these outcomes): run again over
      // the site as read here, which leaves outcomes it made unchanged.
      const matches = redirectMatchOutcomes(
        input.rows.map((row) => row.values),
        input.matches,
        existing,
        live,
      )

      // The row's values as the page would store them, so the review's
      // before → after compares like with like, and a new rule shows the
      // defaults it is created with.
      const rows = input.rows.map((row, at): TransferPlanRow => {
        const match = matches[at] as RowMatchOutcome
        const record = match.kind === 'matched' ? existing.get(match.recordId) : undefined
        const values: Record<string, unknown> = { ...row.values }
        const kind = canonicalRedirectKind(values['kind'])
        if (kind) values['kind'] = kind
        const sourceKind = kind ?? (isBlankTransferValue(values['kind']) ? text(record?.['kind']) || 'exact' : null)
        if (typeof values['source'] === 'string' && sourceKind) {
          values['source'] = storedSource(sourceKind, values['source']) ?? values['source'].trim()
        }
        if (typeof values['destination'] === 'string') {
          values['destination'] = normalizeRedirectDestination(values['destination']) ?? values['destination'].trim()
        }
        if (match.kind === 'new') {
          const defaults: Record<string, unknown> = {
            kind: 'exact',
            statusCode: 302,
            priority: REDIRECT_DEFAULT_PRIORITY,
            enabled: true,
          }
          for (const [fieldId, value] of Object.entries(defaults)) {
            if (isBlankTransferValue(values[fieldId])) values[fieldId] = value
          }
        }
        return { ...row, values }
      })

      const plan = buildTransferPlan({ ...input, rows, matches, existing })
      const findings: TransferResourceFinding[] = []
      const writing = plan.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')

      if (site.refusal) {
        for (const row of writing) findings.push({ row: row.index, detail: site.refusal, refuse: true })
        return withTransferResourceFindings(plan, findings)
      }

      // What the page refuses about a rule on its own.
      const accepted: Array<{ row: PlannedTransferRow; rule: RuleFields }> = []
      for (const row of writing) {
        const rule = finalRule(row.recordId ? existing.get(row.recordId) : null, row.diff)
        const problem = ruleProblem(rule, site.host)
        if (problem) {
          findings.push({ row: row.index, ...problem, refuse: true })
          continue
        }
        accepted.push({ row, rule })
      }

      // What the page refuses against the other rules, row by row in file
      // order over the site as the rows above leave it.
      const liveRows = new Map(live.map(({ id, data }) => [id, ruleRow(id, data)]))
      const touched = new Set(accepted.flatMap(({ row }) => (row.recordId ? [row.recordId] : [])))
      const ruleset: RedirectRuleRow[] = [...liveRows.values()].filter((rule) => !touched.has(rule.$id as string))
      const kept: Array<{ row: PlannedTransferRow; rule: RuleFields; candidate: Required<RedirectRuleRow> }> = []
      const keptByKey = new Map<string, number>()
      const keptByRecord = new Map<string, number>()
      for (const { row, rule } of accepted) {
        const candidate = {
          $id: row.recordId ?? `row:${row.index}`,
          source: rule.source,
          destination: rule.destination,
          kind: rule.kind,
        }
        const key = ruleKey(rule.kind, rule.source) as string
        const repeated = keptByKey.get(key) ?? (row.recordId ? keptByRecord.get(row.recordId) : undefined)
        let detail: string | null = null
        if (repeated !== undefined) detail = `Row ${repeated + 1} already redirects ${rule.source}`
        else if (findDuplicateRedirect(ruleset, candidate)) detail = `A rule for ${rule.source} already exists`
        else if (walkRedirectChain(ruleset, candidate).loop) {
          detail = 'That destination chains back to this rule — a redirect loop'
        }
        if (detail) {
          const fieldId = repeated !== undefined ? REDIRECT_FIELD.source : REDIRECT_FIELD.destination
          findings.push({ row: row.index, detail, fieldId, value: String(rule[fieldId]), refuse: true })
          // The rule it would have changed stays as it is.
          const current = row.recordId ? liveRows.get(row.recordId) : undefined
          if (current) ruleset.push(current)
          continue
        }
        ruleset.push(candidate)
        kept.push({ row, rule, candidate })
        keptByKey.set(key, row.index)
        if (row.recordId) keptByRecord.set(row.recordId, row.index)
      }

      // What a person should know about the rules that will be written, read
      // over the site as the whole import leaves it.
      for (const { row, rule, candidate } of kept) {
        const walk = walkRedirectChain(ruleset, candidate)
        const path = [rule.destination, ...walk.hops].join(' → ')
        if (walk.loop || walk.cycle) {
          findings.push({
            row: row.index,
            detail: `Leads into a redirect loop: ${path}`,
            fieldId: REDIRECT_FIELD.destination,
            value: rule.destination,
          })
        } else if (walk.hops.length) {
          findings.push({
            row: row.index,
            detail: `Chains through another rule: ${path}`,
            fieldId: REDIRECT_FIELD.destination,
            value: rule.destination,
          })
        }
        if (isExternalRedirectDestination(rule.destination)) {
          findings.push({
            row: row.index,
            detail: `Sends visitors to ${hostnameOf(rule.destination)}; importing approves it in your name`,
            fieldId: REDIRECT_FIELD.destination,
            value: rule.destination,
          })
        }
        if (redirectSourceIsLivePage((site.host as { screens?: Record<string, unknown> }).screens, rule.source)) {
          findings.push({
            row: row.index,
            detail: `${rule.source} is a published page — the redirect takes precedence`,
            fieldId: REDIRECT_FIELD.source,
            value: rule.source,
          })
        }
      }

      // The plan's counter counts every rule document, soft-deleted ones
      // included, as the create route counts them.
      const remaining = Math.max(0, site.limit - documents.length)
      return withCreateLimit(withTransferResourceFindings(plan, findings), remaining, site.limit)
    },

    async apply(ctx, chunk, writer: TransferApplyWriter): Promise<TransferApplyResult> {
      const site = await readSite(ctx)
      const actor = ctx.actorUid as string
      const allowed = site.declared.fields
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []
      const paths: string[] = []

      const fail = (row: PlannedTransferRow, message: string, reason?: TransferRowResult['reason']) => ({
        result: {
          row: row.index,
          outcome: 'failed' as const,
          ...(row.recordId ? { recordId: row.recordId } : {}),
          ...(reason ? { reason } : {}),
          message,
        },
        entry: undefined,
      })

      const approvalField = site.declared.externalDestination?.approvedByField ?? REDIRECT_FIELD.approvedBy
      const stampFor = (destination: unknown): string | null =>
        site.declared.externalDestination && isExternalRedirectDestination(String(destination ?? '')) ? actor : null

      const create = async (row: PlannedTransferRow) => {
        const rule = finalRule(null, row.diff)
        const problem = ruleProblem(rule, site.host)
        if (problem) return fail(row, problem.detail, 'resourceRule')
        const fields = storedFields(rule, allowed)
        const stamp = stampFor(fields['destination'])
        const ref = rulesOf(site.hostId).doc(importedRedirectId(ctx.jobId, row.index))
        const at = Timestamp.fromMillis(now())
        // Counted and created in one transaction, as the create route does,
        // so two imports (or an import and the page) cannot both take the
        // last slot.
        const outcome = await firestore.runTransaction(async (tx): Promise<{ refusal?: string; existed?: boolean }> => {
          if ((await tx.get(ref)).exists) return { existed: true }
          if (site.declared.quotaKey && Number.isFinite(site.limit)) {
            const used = (await tx.get(rulesOf(site.hostId).count())).data().count
            const quota = checkQuota(site.org, site.declared.quotaKey as Parameters<typeof checkQuota>[1], used)
            if (!quota.allowed) {
              return { refusal: `Your plan includes ${quota.limit} ${site.declared.label} — upgrade in Billing for more` }
            }
          }
          tx.create(ref, {
            ...fields,
            ...(stamp ? { [approvalField]: stamp } : {}),
            createdAt: at,
            updatedAt: at,
            createdBy: actor,
          })
          return {}
        })
        if (outcome.refusal) return fail(row, outcome.refusal, 'planLimit')
        const written: Record<string, unknown> = { ...fields, ...(stamp ? { [approvalField]: stamp } : {}) }
        if (!outcome.existed && deps.logCreated) {
          await deps.logCreated(site.hostId, actor, ref.id, site.declared).catch(() => undefined)
        }
        const path = announcedPath(fields)
        if (path) paths.push(path)
        const result: TransferRowResult = { row: row.index, outcome: 'created', recordId: ref.id }
        const entry: TransferUndoEntry = { row: row.index, recordId: ref.id, action: 'created', written }
        return { result, entry }
      }

      const update = async (row: PlannedTransferRow) => {
        const id = row.recordId as string
        const ref = rulesOf(site.hostId).doc(id)
        const snapshot = await ref.get()
        const data = snapshot.exists ? (snapshot.data() as StoredRule) : undefined
        if (!isLive(data)) return fail(row, 'This redirect was deleted after the dry run.', 'matchedRecordMissing')
        const current = redirectRuleValues(id, data)
        const rule = finalRule(current, row.diff)
        const problem = ruleProblem(rule, site.host)
        if (problem) return fail(row, problem.detail, 'resourceRule')
        const fields = storedFields(rule, allowed)
        const stamp = stampFor(fields['destination'])
        const previous: Record<string, unknown> = {}
        const written: Record<string, unknown> = {}
        for (const fieldId of REDIRECT_WRITABLE_FIELDS) {
          if (!(fieldId in fields) || transferValuesEqual(current[fieldId], fields[fieldId])) continue
          previous[fieldId] = current[fieldId] ?? null
          written[fieldId] = fields[fieldId]
        }
        if (!transferValuesEqual(current[approvalField], stamp)) {
          previous[approvalField] = current[approvalField] ?? null
          written[approvalField] = stamp
        }
        if (!Object.keys(written).length) {
          return { result: { row: row.index, outcome: 'unchanged' as const, recordId: id }, entry: undefined }
        }
        // The page's edit: every field the form owns, the stamp set or
        // removed, `updatedAt`, merged so `lastHitAt` and `deletedAt` stay.
        await ref.set(
          { ...fields, [approvalField]: stamp ?? FieldValue.delete(), updatedAt: Timestamp.fromMillis(now()) },
          { merge: true },
        )
        for (const rulePath of [announcedPath(fields), announcedPath({ kind: text(data['kind']), source: text(data['source']) })]) {
          if (rulePath) paths.push(rulePath)
        }
        const result: TransferRowResult = { row: row.index, outcome: 'updated', recordId: id }
        const entry: TransferUndoEntry = { row: row.index, recordId: id, action: 'updated', previous, written }
        return { result, entry }
      }

      for (const row of chunk.rows) {
        const before = await writer.alreadyApplied(row.index)
        if (before) {
          results.push(before)
          continue
        }
        if (writer.timeLeftMs() < ROW_RESERVE_MS) break
        const outcome = site.refusal
          ? fail(row, site.refusal, 'resourceRule')
          : row.verdict === 'create'
            ? await create(row)
            : await update(row)
        await writer.markApplied(outcome.result, outcome.entry)
        results.push(outcome.result)
        if (outcome.entry) undo.push(outcome.entry)
      }

      if (paths.length) await announce(site.hostId, [...new Set(paths)]).catch(() => undefined)
      return { results, undo }
    },

    async revert(ctx, snapshot, decisions?: TransferRevertDecisions): Promise<TransferRevertResult> {
      const site = await readSite(ctx)
      // Undo writes rules too, so it needs the same role; a lapsed plan does
      // not stop it, since a rule the plan no longer covers is not served.
      const role = ctx.actorUid ? ((site.host['memberRoles'] ?? {}) as Record<string, unknown>)[ctx.actorUid] : undefined
      if (!hostRoleCanPublish(role)) {
        throw new Error('Undoing a redirect import needs a publishing role on this site — ask an editor or admin')
      }
      const approvalField = site.declared.externalDestination?.approvedByField ?? REDIRECT_FIELD.approvedBy
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      const paths: string[] = []
      for (const entry of snapshot.entries) {
        const ref = rulesOf(site.hostId).doc(entry.recordId)
        const stored = await ref.get()
        const data = stored.exists ? (stored.data() as StoredRule) : undefined
        const current = isLive(data) ? redirectRuleValues(entry.recordId, data) : null
        const step = planTransferUndo(entry, current)
        if (step.action === 'conflict' && decisions?.[entry.recordId] !== 'revert') {
          if (decisions?.[entry.recordId] === 'keep') {
            done.push({ action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' })
          } else conflicts.push(step)
          continue
        }
        const before = current ? announcedPath({ kind: String(current['kind']), source: String(current['source']) }) : null
        if (step.action === 'delete' || (step.action === 'conflict' && entry.action === 'created')) {
          await ref.delete()
          if (before) paths.push(before)
        } else if ((step.action === 'restore' || step.action === 'conflict') && current) {
          const restored = { ...current, ...step.values }
          const patch: Record<string, unknown> = {}
          for (const [fieldId, value] of Object.entries(step.values)) {
            patch[fieldId] = value === null || value === undefined ? FieldValue.delete() : value
          }
          // A destination on the site never keeps an approval.
          if (!isExternalRedirectDestination(text(restored['destination']))) patch[approvalField] = FieldValue.delete()
          patch['updatedAt'] = Timestamp.fromMillis(now())
          await ref.set(patch, { merge: true })
          const after = announcedPath({ kind: String(restored['kind']), source: String(restored['source']) })
          for (const path of [before, after]) if (path) paths.push(path)
        }
        done.push(step)
      }
      if (paths.length) await announce(site.hostId, [...new Set(paths)]).catch(() => undefined)
      return { done, conflicts }
    },
  }
  return resource
}
