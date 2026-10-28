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

import { checkEntitlement, checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { countLiveDocuments } from '@aglyn/aglyn/app-utils/live-document-count'
import type { ResolvedPluginHostResource } from '@aglyn/aglyn/plugin-manager/plugin-host-resources'
import type {
  PluginDraftContext,
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  checkRedirectDraftContent,
  readRedirectDraftContent,
  type RedirectDraftContent,
} from '../model/redirect-draft-content'
import {
  REDIRECT_DEFAULT_PRIORITY,
  findDuplicateRedirect,
  isExternalRedirectDestination,
  normalizeRedirectSource,
  redirectSourceIsLivePage,
  walkRedirectChain,
  type RedirectRuleRow,
} from '../model/redirects'
import {
  announcedPath,
  redirectDeclaration,
  redirectRuleValues,
  ruleProblem,
  storedFields,
  withDefaults,
} from '../transfer/redirects-transfer'
import { REDIRECT_FIELD } from '../transfer/redirects-transfer-fields'

/*==========================================
 * A REDIRECT RULE AN AI BUILD CHANGES (AGL-3745)
 *
 * The writer the redirects plugin registers for the `redirect` resource on the
 * core's resource-drafts seam, which the `redirect` build operation
 * (`redirect-ai-capability.ts`) executes. Every rule is this plugin's, made
 * with the functions the redirects page's save and the importer already use:
 *
 *  - who: the publishing role on the site (`hostRoleCanPublish`, the axis the
 *    Firestore rules gate the collection on), the plan's `redirects` feature,
 *    and no lockdown refusing a write to the site, its workspace or the member;
 *  - what: the page's normalization and defaults (exact, 302, priority 100,
 *    on), the create route's allow-list of fields, and `validateRedirectRule`
 *    with the site's own domains, so a lookalike destination, a pattern the
 *    matcher cannot run and a path redirected to itself are refused;
 *  - against what: the page's duplicate check and chain walk over the site's
 *    live rules. A walk that comes back to the rule is the page's loop and is
 *    refused; one that leads into a circle other rules make is refused too,
 *    which the page only warns about — an AI change never sends visitors into
 *    a loop. A from-path the site publishes a page at is refused unless the
 *    item says the person asked for it (`replacesLivePage`): the page warns,
 *    because replacing a moved page is what a redirect is for, but a build
 *    must not take a live page away on its own reading of a request;
 *  - how many: a create is counted and written in one transaction against
 *    `redirectsPerHost`, as the create route does. An update or a remove
 *    takes no slot, so the allowance never refuses one;
 *  - provenance: an off-site destination carries the member's uid, the stamp
 *    the serve path requires and the page writes; an on-site one has it
 *    removed;
 *  - afterwards: a created rule gets `createdAt`, `updatedAt`, `createdBy` and
 *    the "Created redirect" activity line; every path a change touches is
 *    announced to the site cache, as the page announces a save.
 *
 * A redirect has no draft state: the console writes a rule live, and so does
 * this. The build's plan card is where the person agrees to it, and the job
 * reports the change as live (the capability's `live`). A remove is the page's
 * Delete: the rule is marked deleted and off.
 *
 * Asked again for the same change, it answers with what it already did: a
 * create finds the rule written under the request's id, an update whose values
 * already hold changes nothing, and a remove of a rule already deleted is done.
 *=========================================*/

type Firestore = FirebaseFirestore.Firestore
type StoredRule = Record<string, unknown>

/** The page's refusal for a member without the publishing role. */
/** Names "Publish site content" (`site.publish`, AGL-4047), never a role. */
export const REDIRECT_AI_ROLE_REFUSAL = siteKeyRefusal('site.publish')
/** The page's refusal for a plan without redirects. */
export const REDIRECT_AI_PLAN_REFUSAL = 'URL redirects require a Starter plan — see Billing to upgrade'
/** What a member is told while a lockdown refuses writes to the site. */
export const REDIRECT_AI_LOCKED_REFUSAL = 'This site is not accepting changes right now.'

/** The create route's refusal at the plan's allowance. */
export function redirectAiLimitRefusal(limit: number): string {
  return `Your plan includes ${limit} redirects — upgrade in Billing for more`
}

/** Whether a lockdown refuses this member's write to this site; `true` refuses. */
export type RedirectAiLockdownCheck = (input: {
  uid: string
  org: PluginDraftContext['org']
  host: StoredRule
}) => Promise<boolean>

export interface RedirectAiWriterDeps {
  firestore: () => Firestore
  lockdown: RedirectAiLockdownCheck
  /** The `redirect` kind's declaration; the create route's otherwise. */
  declaration?: () => ResolvedPluginHostResource
  /** Drops the site's cached pages at these paths, best effort. */
  announcePaths?(hostId: string, paths: readonly string[]): Promise<void>
  /** Writes the site activity line for a created rule, best effort. */
  logCreated?(hostId: string, actorUid: string, ruleId: string, declared: ResolvedPluginHostResource): Promise<void>
}

/** What a caller is told about a rule: what it is, and that it is live. */
function factsOf(action: RedirectDraftContent['action'], data: StoredRule): Record<string, unknown> {
  const values = redirectRuleValues('', data)
  return {
    action,
    source: values['source'],
    destination: values['destination'],
    kind: values['kind'],
    statusCode: values['statusCode'],
    priority: values['priority'],
    enabled: action === 'remove' ? false : values['enabled'],
    removed: action === 'remove',
    live: true,
  }
}

function recordOf(id: string, action: RedirectDraftContent['action'], data: StoredRule): PluginDraftRecord {
  return {
    id,
    name: `${String(data['source'] ?? '')} → ${String(data['destination'] ?? '')}`,
    versionId: null,
    facts: factsOf(action, data),
  }
}

function isLive(data: StoredRule | undefined): data is StoredRule {
  return Boolean(data) && !data?.['deletedAt']
}

/** A from-path as a rule of `kind` stores it: a pattern trimmed, a path normalized. */
function storedSourceOf(kind: string, source: string): string | null {
  return kind === 'regex' ? source.trim() || null : normalizeRedirectSource(source)
}

export function createRedirectAiWriter(deps: RedirectAiWriterDeps): PluginResourceDraftWriter {
  const declaration = deps.declaration ?? redirectDeclaration
  const hostRef = (hostId: string) => deps.firestore().collection('hosts').doc(hostId)
  const rulesOf = (hostId: string) => hostRef(hostId).collection('redirects')

  async function refusalFor(
    host: FirebaseFirestore.DocumentSnapshot,
    context: Pick<PluginDraftContext, 'uid' | 'org'>,
  ): Promise<PluginDraftRefusal | null> {
    if (!host.exists) return { status: 404, error: 'Unknown site' }
    const data = (host.data() ?? {}) as StoredRule
    if (!holdsSiteKey(data, context.uid, 'site.publish')) return { status: 403, error: REDIRECT_AI_ROLE_REFUSAL }
    const declared = declaration()
    if (declared.entitlement && !checkEntitlement((context.org ?? {}) as never, declared.entitlement)) {
      return { status: 403, error: REDIRECT_AI_PLAN_REFUSAL }
    }
    if (await deps.lockdown({ uid: context.uid, org: context.org, host: data })) {
      return { status: 403, error: REDIRECT_AI_LOCKED_REFUSAL }
    }
    return null
  }

  /** Every rule document of the site, soft-deleted ones included. */
  async function readAllRules(hostId: string): Promise<Array<{ id: string; data: StoredRule }>> {
    const snapshot = await rulesOf(hostId).get()
    return snapshot.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as StoredRule }))
  }

  /** The live rules at a from-path, of `kind` when it is given. */
  function rulesAt(
    all: ReadonlyArray<{ id: string; data: StoredRule }>,
    source: string,
    kind: string | undefined,
  ): Array<{ id: string; data: StoredRule }> {
    return all.filter(({ data }) => {
      const ruleKind = typeof data['kind'] === 'string' && data['kind'] ? (data['kind'] as string) : 'exact'
      if (kind && ruleKind !== kind) return false
      return data['source'] === storedSourceOf(ruleKind, source)
    })
  }

  /** Why the rule a change leaves cannot be saved among the site's live rules, or `null`. */
  function setProblem(
    rows: readonly RedirectRuleRow[],
    rule: { $id: string; source: string; destination: string; kind: string },
  ): string | null {
    if (findDuplicateRedirect(rows, rule)) return `A rule for ${rule.source} already exists`
    const walk = walkRedirectChain(rows, rule)
    if (walk.loop) return 'That destination chains back to this rule — a redirect loop'
    if (walk.cycle) return 'That destination leads into a redirect loop other rules already make'
    return null
  }

  function livePageProblem(host: StoredRule, source: string, kind: string, asked: boolean | undefined): string | null {
    if (asked || kind === 'regex' || !redirectSourceIsLivePage(host['screens'] as Record<string, unknown>, source)) {
      return null
    }
    return `${source} is a published page, and a redirect there would take its place. Redirect it only when the person asks for that page to send visitors elsewhere.`
  }

  async function announce(hostId: string, paths: Array<string | null>): Promise<void> {
    const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))]
    if (unique.length && deps.announcePaths) await deps.announcePaths(hostId, unique).catch(() => undefined)
  }

  const refuse = (status: PluginDraftRefusal['status'], error: string): PluginDraftWrite => ({ ok: false, status, error })

  return {
    refusal: async (context) => refusalFor(await hostRef(context.hostId).get(), context),

    check: (content) => checkRedirectDraftContent(content),

    read: async ({ hostId, id }) => {
      const snapshot = await rulesOf(hostId).doc(id).get()
      if (!snapshot.exists) return null
      const data = (snapshot.data() ?? {}) as StoredRule
      return recordOf(id, isLive(data) ? 'create' : 'remove', data)
    },

    write: async (request): Promise<PluginDraftWrite> => {
      const read = readRedirectDraftContent(request.content)
      if (read.ok === false) return refuse(400, read.problems[0] as string)
      const change = read.value
      const hostSnapshot = await hostRef(request.hostId).get()
      const refusal = await refusalFor(hostSnapshot, request)
      if (refusal) return { ok: false, ...refusal }
      const host = (hostSnapshot.data() ?? {}) as StoredRule
      const declared = declaration()
      const approvalField = declared.externalDestination?.approvedByField ?? REDIRECT_FIELD.approvedBy
      const stampFor = (destination: unknown): string | null =>
        declared.externalDestination && isExternalRedirectDestination(String(destination ?? '')) ? request.uid : null
      const at = Timestamp.fromDate(request.now)
      const all = await readAllRules(request.hostId)
      const live = all.filter(({ data }) => isLive(data))
      const rows: RedirectRuleRow[] = live.map(({ id, data }) => ({
        $id: id,
        source: data['source'] as string,
        destination: data['destination'] as string,
        kind: data['kind'] as string,
      }))

      if (change.action === 'create') {
        const ref = rulesOf(request.hostId).doc(request.id)
        const before = all.find((one) => one.id === request.id)
        if (before) return { ok: true, replayed: true, ...recordOf(request.id, 'create', before.data) }
        const rule = withDefaults({
          source: change.source,
          destination: change.destination,
          kind: change.kind ?? 'exact',
          statusCode: change.statusCode ?? 302,
          priority: change.priority ?? REDIRECT_DEFAULT_PRIORITY,
          enabled: change.enabled ?? true,
        })
        const problem = ruleProblem(rule, host)
        if (problem) return refuse(400, problem.detail)
        const fields = storedFields(rule, declared.fields)
        const source = String(fields['source'])
        const kind = String(fields['kind'] ?? 'exact')
        const shadow = livePageProblem(host, source, kind, change.replacesLivePage)
        if (shadow) return refuse(409, shadow)
        const clash = setProblem(rows, { $id: request.id, source, destination: String(fields['destination']), kind })
        if (clash) return refuse(409, clash)
        const stamp = stampFor(fields['destination'])
        const written = { ...fields, ...(stamp ? { [approvalField]: stamp } : {}) }
        const db = deps.firestore()
        const outcome = await db.runTransaction(async (tx): Promise<{ refusal?: string; existed?: StoredRule }> => {
          const existing = await tx.get(ref)
          if (existing.exists) return { existed: (existing.data() ?? {}) as StoredRule }
          if (declared.quotaKey) {
            // Live rules only, as the create route counts: a deleted rule frees its slot (AGL-3918).
            const used = await countLiveDocuments(rulesOf(request.hostId), (aggregate) => tx.get(aggregate))
            const quota = checkQuota((request.org ?? {}) as never, declared.quotaKey as never, Number(used) || 0)
            if (!quota.allowed) return { refusal: redirectAiLimitRefusal(quota.limit) }
          }
          tx.create(ref, { ...written, createdAt: at, updatedAt: at, createdBy: request.uid })
          return {}
        })
        if (outcome.refusal) return refuse(403, outcome.refusal)
        if (outcome.existed) return { ok: true, replayed: true, ...recordOf(request.id, 'create', outcome.existed) }
        if (deps.logCreated) {
          await deps.logCreated(request.hostId, request.uid, ref.id, declared).catch(() => undefined)
        }
        await announce(request.hostId, [announcedPath(fields)])
        return { ok: true, replayed: false, ...recordOf(ref.id, 'create', written) }
      }

      // An update or a remove names a rule the site has.
      const found = rulesAt(live, change.source, change.kind)
      if (found.length > 1) {
        return refuse(
          409,
          `The site has more than one redirect at ${change.source}; say which match mode (exact, prefix or regex) to change`,
        )
      }
      const target = found[0]
      if (!target) {
        if (change.action === 'remove') {
          const gone = rulesAt(all, change.source, change.kind)[0]
          if (gone) return { ok: true, replayed: true, ...recordOf(gone.id, 'remove', gone.data) }
        }
        return refuse(404, `The site has no redirect from ${change.source}`)
      }
      const ref = rulesOf(request.hostId).doc(target.id)

      if (change.action === 'remove') {
        // The page's Delete: marked deleted and off, so the serve path drops it.
        await ref.set({ deletedAt: at, enabled: false }, { merge: true })
        await announce(request.hostId, [announcedPath(target.data as { kind?: string; source?: string })])
        return { ok: true, replayed: false, ...recordOf(target.id, 'remove', target.data) }
      }

      const current = redirectRuleValues(target.id, target.data)
      const rule = withDefaults({
        ...current,
        ...(change.newSource !== undefined ? { source: change.newSource } : {}),
        ...(change.destination !== undefined ? { destination: change.destination } : {}),
        ...(change.statusCode !== undefined ? { statusCode: change.statusCode } : {}),
        ...(change.priority !== undefined ? { priority: change.priority } : {}),
        ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
      })
      const problem = ruleProblem(rule, host)
      if (problem) return refuse(400, problem.detail)
      const fields = storedFields(rule, declared.fields)
      const source = String(fields['source'])
      const kind = String(fields['kind'] ?? 'exact')
      if (source !== current['source']) {
        const shadow = livePageProblem(host, source, kind, change.replacesLivePage)
        if (shadow) return refuse(409, shadow)
      }
      const clash = setProblem(rows, { $id: target.id, source, destination: String(fields['destination']), kind })
      if (clash) return refuse(409, clash)
      const stamp = stampFor(fields['destination'])
      const unchanged =
        Object.entries(fields).every(([key, value]) => current[key] === value) &&
        (current[approvalField] ?? null) === stamp
      const after = { ...target.data, ...fields, ...(stamp ? { [approvalField]: stamp } : {}) }
      if (unchanged) return { ok: true, replayed: true, ...recordOf(target.id, 'update', after) }
      // The page's edit: every field the form owns, the stamp set or removed,
      // `updatedAt`, merged so `lastHitAt` stays.
      await ref.set({ ...fields, [approvalField]: stamp ?? FieldValue.delete(), updatedAt: at }, { merge: true })
      await announce(request.hostId, [announcedPath(fields), announcedPath(target.data as { kind?: string; source?: string })])
      return { ok: true, replayed: false, ...recordOf(target.id, 'update', after) }
    },
  }
}
