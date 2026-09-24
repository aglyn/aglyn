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
 * THE CRM'S SHARE OF A CONSENT GROUP CHANGE (AGL-3320).
 *
 * Two things the CRM keeps are read through the CURRENT consent group, so a
 * change to the declaration moves under them unless they move too:
 *
 *  - **C4 — a contact's per-site refusal.** `marketingConsentByHost.{site}`
 *    holding `marketingConsent: false` refuses mail from every site of that
 *    site's group (`readMarketingBasis`). When two sites stop being one
 *    sender, each keeps the refusals the other held: the refusal is written
 *    onto the receiving site's entry by dotted path, with the one it
 *    replaced kept as `supersededEntry`. A refusal is carried whenever it was
 *    given — over-carrying is the safe direction — and one the receiving site
 *    already holds is left alone. Only contacts carry per-site refusals;
 *    leads and list memberships carry grants alone.
 *  - **The holder records**, `facets.{groupId}` — a profile, an owner, a
 *    stage, notes, order figures and a timeline, keyed by the group that
 *    keeps them. Every writer keys by the declaration in force, so after the
 *    flip a site's records must be under its new key:
 *     - a MOVE folds every old key's facet into the new key's, with the
 *       existing target first and then the sources in the order the person
 *       met their sites, through `mergeContactFacet` — the survivor's
 *       values win, lists union, figures sum — and deletes each source in
 *       the same write, so a figure is summed exactly once;
 *     - a SPLIT copies the facet, without its figures and with only the
 *       timeline entries of the successor's own sites, to each successor
 *       that met the person itself, merged under whatever the successor
 *       already holds. The figures follow the capture only when every site
 *       that met the person lands under one key; otherwise they stay with the
 *       surviving key, or — when the key dissolves — are dropped and counted.
 *
 * ## Run twice, write once
 *
 * The executor runs `carry` before the flip and again as the catch-up, and
 * the sweep runs everything once more. A carried refusal is skipped once the
 * receiving entry refuses; a MOVE or a dissolving SPLIT deletes its source in
 * the write that folds it, so a second pass finds nothing — except a
 * straggler a long job wrote under the old key after the first pass, which is
 * exactly what the sweep exists to fold in. A SPLIT whose key survives stays
 * a live key, so each copy is stamped with the change that made it
 * (`copiedByChange`), and a pass that finds the stamp does not copy again.
 */

import { mergeContactFacet } from '@aglyn/aglyn/app-utils/contact-merge'
import type {
  ConsentGroupChangePlan,
  ConsentGroupChangePreviewLine,
  ConsentGroupHolderMove,
  ConsentGroupHolderSplit,
} from '@aglyn/aglyn/app-utils/consent-group-change'
import {
  CONTACT_FACETS_FIELD,
  type ContactInteraction,
  interactionsForGroup,
} from '@aglyn/aglyn/app-utils/contacts'
import {
  COMPANY_CONTACTS_COUNT_FIELD,
  CONTACT_COMPANY_IDS_FIELD,
  CRM_COLLECTIONS,
} from '@aglyn/aglyn/app-utils/crm'
import {
  CAPTURED_BY_HOST_FIELD,
  CONSENT_GROUP_ID_FIELD,
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_FIELD,
  MARKETING_CONSENT_SOURCE_FIELD,
} from '@aglyn/aglyn/app-utils/marketing-consent'
import type {
  ConsentGroupChangeParticipant,
  ConsentGroupChangeRunRequest,
  ConsentGroupChangeRunResult,
} from '@aglyn/aglyn/plugin-manager/plugin-consent-group-change'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { summarizeConsentGroupChange } from '../model/consent-group-summary'

/** Contacts one page of the refusal carry reads. */
export const REFUSAL_PAGE = 300

/** Contacts one page of the holder pass reads. */
export const HOLDER_PAGE = 200

/**
 * The most records a preview reads to answer a count no aggregation can:
 * past it, the line says so with a `null` count rather than guess.
 */
export const PREVIEW_SCAN_LIMIT = 5_000

/**
 * The figures a facet sums, and the instants that go with them — what
 * `mergeContactFacet` adds up or takes the earliest or latest of. A split
 * cannot divide one person's purchases between two holders, so a copy
 * leaves them behind.
 */
export const HOLDER_FIGURE_FIELDS = [
  'ltvCents',
  'ordersCount',
  'refundedCents',
  'refundedOrdersCount',
  'firstPurchaseAtMs',
  'lastPurchaseAtMs',
  'lastRefundAtMs',
  'lastEmailEngagementAtMs',
] as const

/** The stamp a split's copy carries: `{ [sourceKey]: changeId }`. */
export const COPIED_BY_CHANGE_FIELD = 'copiedByChange'

type Doc = Record<string, unknown>

/** The error codes that mean the contact was written since it was read. */
const RACED = new Set([5, 9])
const codeOf = (error: unknown): number | undefined => (error as { code?: number } | null)?.code

function mapOf(value: unknown): Doc {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : {}
}

/** The sites that met this person, in the order they did — then the legacy `hostId`. */
function captureOrder(contact: Doc): string[] {
  const raw = contact[CAPTURED_BY_HOST_FIELD]
  const ordered = Array.isArray(raw)
    ? raw.map((id) => String(id ?? '').trim()).filter(Boolean)
    : []
  const legacy = typeof contact['hostId'] === 'string' ? (contact['hostId'] as string) : ''
  return legacy && !ordered.includes(legacy) ? [...ordered, legacy] : ordered
}

function withoutFigures(facet: Doc): Doc {
  const out: Doc = { ...facet }
  for (const field of HOLDER_FIGURE_FIELDS) delete out[field]
  return out
}

function figuresOf(facet: Doc): Doc {
  const out: Doc = {}
  for (const field of HOLDER_FIGURE_FIELDS) {
    if (field in facet) out[field] = facet[field]
  }
  return out
}

/** What one contact's holder records become, as a dotted `update()` patch. */
export interface HolderPatch {
  patch: Doc
  combined: number
  copied: number
  figuresDropped: number
  /** Each company whose contacts count moves, by how much. */
  companyCounts: Array<{ companyId: string; delta: 1 | -1 }>
}

/**
 * The holder records of one contact after the plan's flows — or `null` when
 * nothing moves.
 *
 * `stragglersOnly` is the sweep: only the flows that delete their source
 * (MOVE, and a SPLIT whose key dissolves) run, because only those can have
 * left anything behind that a later writer recreated. A key that survived a
 * split is a live key after the flip, and its new writes belong to it.
 */
export function planHolderRecords(
  contact: Doc,
  plan: Pick<ConsentGroupChangePlan, 'flows'>,
  changeId: string,
  options: { stragglersOnly?: boolean } = {},
): HolderPatch | null {
  const facets = mapOf(contact[CONTACT_FACETS_FIELD]) as Record<string, Doc>
  const captured = captureOrder(contact)
  const next: Record<string, Doc | null> = {}
  const current = (key: string): Doc | undefined =>
    key in next ? (next[key] ?? undefined) : facets[key]
  let combined = 0
  let copied = 0
  let figuresDropped = 0

  const splits = plan.flows.filter(
    (flow): flow is ConsentGroupHolderSplit =>
      flow.kind === 'split' && !(options.stragglersOnly && flow.survives),
  )
  const copies: Array<{ key: string; facet: Doc }> = []
  for (const split of splits) {
    const source = facets[split.from]
    if (!source || typeof source !== 'object') continue
    if (
      split.survives &&
      split.successors.some(
        (successor) => mapOf(facets[successor.key]?.[COPIED_BY_CHANGE_FIELD])[split.from] === changeId,
      )
    ) {
      continue
    }
    const keyOf = (hostId: string) =>
      split.stayHostIds.includes(hostId)
        ? split.from
        : (split.successors.find((successor) => successor.hostIds.includes(hostId))?.key ?? null)
    let eligible = split.successors.filter((successor) =>
      successor.hostIds.some((hostId) => captured.includes(hostId)),
    )
    if (!split.survives && !eligible.length) eligible = split.successors
    const landing = [
      ...new Set(
        captured
          .filter((hostId) => split.fromHostIds.includes(hostId))
          .map(keyOf)
          .filter((key): key is string => key !== null),
      ),
    ]
    const figuresTo =
      landing.length === 1 && landing[0] !== split.from && eligible.some((s) => s.key === landing[0])
        ? landing[0]
        : null
    for (const successor of eligible) {
      const copy: Doc = {
        ...withoutFigures(source),
        interactions: interactionsForGroup(
          (source['interactions'] ?? []) as ContactInteraction[],
          successor.hostIds,
        ),
        ...(successor.key === figuresTo ? figuresOf(source) : {}),
      }
      if (split.survives) copy[COPIED_BY_CHANGE_FIELD] = { [split.from]: changeId }
      copies.push({ key: successor.key, facet: copy })
    }
    if (split.survives) {
      if (figuresTo) next[split.from] = withoutFigures(current(split.from) ?? source)
    } else {
      next[split.from] = null
      const figures = figuresOf(source)
      if (!figuresTo && Object.keys(figures).some((field) => field !== 'lastEmailEngagementAtMs')) {
        figuresDropped += 1
      }
    }
  }

  const moves = new Map<string, ConsentGroupHolderMove[]>()
  for (const flow of plan.flows) {
    if (flow.kind !== 'move' || !facets[flow.from]) continue
    moves.set(flow.to, [...(moves.get(flow.to) ?? []), flow])
  }
  const metAt = (hostIds: readonly string[]) => {
    const indexes = hostIds.map((hostId) => captured.indexOf(hostId)).filter((index) => index >= 0)
    return indexes.length ? Math.min(...indexes) : Number.POSITIVE_INFINITY
  }
  for (const [target, sources] of moves) {
    const ordered = [...sources].sort(
      (a, b) => metAt(a.fromHostIds) - metAt(b.fromHostIds) || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0),
    )
    let folded = current(target)
    // A person is COMBINED when two or more records become one; a lone
    // record under a new key is only moved.
    if (ordered.length + (folded ? 1 : 0) >= 2) combined += 1
    for (const source of ordered) {
      const facet = facets[source.from]
      folded = folded ? mergeContactFacet(folded, facet) : { ...facet }
      next[source.from] = null
    }
    if (folded) next[target] = folded
  }

  for (const { key, facet } of copies) {
    const existing = current(key)
    const merged = existing ? mergeContactFacet(existing, facet) : facet
    // The stamps are a union, never the survivor's alone: the merge keeps a
    // map the survivor already has, and a lost stamp would copy again.
    const stamps = {
      ...mapOf(existing?.[COPIED_BY_CHANGE_FIELD]),
      ...mapOf(facet[COPIED_BY_CHANGE_FIELD]),
    }
    if (Object.keys(stamps).length) merged[COPIED_BY_CHANGE_FIELD] = stamps
    next[key] = merged
    copied += 1
  }

  const keys = Object.keys(next)
  if (!keys.length) return null

  /*
   * The company mirror follows the facets: an id that no facet names any
   * more leaves it, and one a facet newly names joins it. Ids the mirror held
   * without a facet naming them — links older than the facets — are left.
   */
  const named = (source: Record<string, Doc | null | undefined>) =>
    new Set(
      Object.values(source)
        .map((facet) => (facet ? facet['companyId'] : null))
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    )
  const after: Record<string, Doc | null> = { ...facets, ...next }
  const before = named(facets)
  const now = named(after)
  const mirror = Array.isArray(contact[CONTACT_COMPANY_IDS_FIELD])
    ? (contact[CONTACT_COMPANY_IDS_FIELD] as unknown[]).filter(
        (id): id is string => typeof id === 'string' && id !== '',
      )
    : []
  const companyCounts: HolderPatch['companyCounts'] = []
  const leaving = [...before].filter((id) => !now.has(id))
  const joining = [...now].filter((id) => !before.has(id))
  for (const id of leaving) if (mirror.includes(id)) companyCounts.push({ companyId: id, delta: -1 })
  for (const id of joining) if (!mirror.includes(id)) companyCounts.push({ companyId: id, delta: 1 })

  const patch: Doc = {}
  for (const key of keys) {
    patch[`${CONTACT_FACETS_FIELD}.${key}`] = next[key] === null ? FieldValue.delete() : next[key]
  }
  if (companyCounts.length) {
    patch[CONTACT_COMPANY_IDS_FIELD] = [
      ...mirror.filter((id) => !leaving.includes(id)),
      ...joining.filter((id) => !mirror.includes(id)),
    ]
  }
  patch['updatedAt'] = FieldValue.serverTimestamp()
  return { patch, combined, copied, figuresDropped, companyCounts }
}

/**
 * The refusal `from` holds, carried onto `to` — or `null` when `to` already
 * refuses or `from` does not.
 */
export function planRefusalCarry(
  contact: Doc,
  carry: { toHostId: string; fromHostId: string },
  changeId: string,
): Doc | null {
  const byHost = mapOf(contact[MARKETING_CONSENT_BY_HOST_FIELD])
  const source = mapOf(byHost[carry.fromHostId])
  if (source[MARKETING_CONSENT_FIELD] !== false) return null
  const target = byHost[carry.toHostId]
  if (mapOf(target)[MARKETING_CONSENT_FIELD] === false) return null
  const entry: Doc = {
    [MARKETING_CONSENT_FIELD]: false,
    ...(source['marketingConsentAtMs'] !== undefined
      ? { marketingConsentAtMs: source['marketingConsentAtMs'] }
      : {}),
    ...(source[MARKETING_CONSENT_SOURCE_FIELD] !== undefined
      ? { [MARKETING_CONSENT_SOURCE_FIELD]: source[MARKETING_CONSENT_SOURCE_FIELD] }
      : {}),
    carriedFromHostId: carry.fromHostId,
    carriedByChangeId: changeId,
    ...(target && typeof target === 'object' ? { supersededEntry: target } : {}),
  }
  return {
    [`${MARKETING_CONSENT_BY_HOST_FIELD}.${carry.toHostId}`]: entry,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/*==========================================
 * THE PASSES
 *=========================================*/

interface Cursor {
  /** `refusals` walks the carries; `holders` walks every contact. */
  stage: 'refusals' | 'holders'
  /** The carry being walked, in `refusals`. */
  carry: number
  after: string | null
}

function readCursor(raw: string | null, first: Cursor['stage']): Cursor {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Cursor
      if (parsed && (parsed.stage === 'refusals' || parsed.stage === 'holders')) return parsed
    } catch {
      // A cursor this participant did not write starts the phase over, which
      // every pass is safe to do.
    }
  }
  return { stage: first, carry: 0, after: null }
}

export interface ConsentGroupParticipantOptions {
  firestore?: () => FirebaseFirestore.Firestore
  now?: () => number
}

/** One contact write, guarded by the read it was computed from. */
interface Pending {
  snapshot: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
  patch: Doc
  after?: () => Promise<void>
}

/**
 * Writes a page's patches, each with a `lastUpdateTime` precondition, and
 * recomputes the ones that raced once from a fresh read. Answers how many
 * were written.
 */
async function writeGuarded(
  firestore: FirebaseFirestore.Firestore,
  pending: Pending[],
  recompute: (snapshot: FirebaseFirestore.DocumentSnapshot) => Pending | null,
): Promise<number> {
  let written = 0
  let due = pending
  for (let round = 0; round < 2 && due.length; round += 1) {
    const writer = firestore.bulkWriter()
    const outcomes = due.map((entry) =>
      writer
        .update(entry.snapshot.ref, entry.patch, {
          lastUpdateTime: entry.snapshot.updateTime as FirebaseFirestore.Timestamp,
        })
        .then(
          () => ({ entry, error: null as unknown }),
          (error: unknown) => ({ entry, error: error ?? new Error('The write failed') }),
        ),
    )
    await writer.close()
    const raced: Pending[] = []
    for (const { entry, error } of await Promise.all(outcomes)) {
      if (error === null) {
        written += 1
        await entry.after?.()
        continue
      }
      const code = codeOf(error)
      if (code === undefined || !RACED.has(code)) throw error
      raced.push(entry)
    }
    if (!raced.length) return written
    const fresh = await firestore.getAll(...raced.map((entry) => entry.snapshot.ref))
    due = fresh
      .filter((snapshot) => snapshot.exists)
      .map(recompute)
      .filter((entry): entry is Pending => entry !== null)
  }
  if (due.length) {
    throw new Error(`[crm] ${due.length} contact(s) kept changing under the consent group change`)
  }
  return written
}

/**
 * The CRM's participant. `firestore` and `now` are injectable for the specs;
 * the defaults are the Admin SDK's and the wall clock.
 */
export function createConsentGroupParticipant(
  options: ConsentGroupParticipantOptions = {},
): ConsentGroupChangeParticipant {
  const db = () => (options.firestore ?? (() => firebaseAdmin.app().firestore()))()
  const now = options.now ?? Date.now
  const contactsOf = (orgId: string) => db().collection('orgs').doc(orgId).collection('contacts')

  async function countOf(query: FirebaseFirestore.Query): Promise<number> {
    return Number((await query.count().get()).data().count) || 0
  }

  /** One page of one carry's refusals. */
  async function refusalPage(
    request: ConsentGroupChangeRunRequest,
    cursor: Cursor,
    counts: Record<string, number>,
  ): Promise<Cursor | null> {
    const carries = request.plan.carries
    if (cursor.carry >= carries.length) return null
    const carry = carries[cursor.carry]
    let query = contactsOf(request.orgId)
      .where(`${MARKETING_CONSENT_BY_HOST_FIELD}.${carry.fromHostId}.${MARKETING_CONSENT_FIELD}`, '==', false)
      .orderBy(FieldPath.documentId())
      .limit(REFUSAL_PAGE)
    if (cursor.after) query = query.startAfter(cursor.after)
    const page = await query.get()
    const plan = (snapshot: FirebaseFirestore.DocumentSnapshot): Pending | null => {
      const patch = planRefusalCarry((snapshot.data() ?? {}) as Doc, carry, request.changeId)
      return patch ? { snapshot, patch } : null
    }
    const pending = page.docs.map(plan).filter((entry): entry is Pending => entry !== null)
    counts['refusals'] = (counts['refusals'] ?? 0) +
      (request.dryRun ? pending.length : await writeGuarded(db(), pending, plan))
    if (page.size < REFUSAL_PAGE) return { stage: 'refusals', carry: cursor.carry + 1, after: null }
    return { stage: 'refusals', carry: cursor.carry, after: page.docs[page.docs.length - 1].id }
  }

  /** One page of the holder pass over every contact. */
  async function holderPage(
    request: ConsentGroupChangeRunRequest,
    cursor: Cursor,
    counts: Record<string, number>,
  ): Promise<Cursor | null> {
    let query = contactsOf(request.orgId).orderBy(FieldPath.documentId()).limit(HOLDER_PAGE)
    if (cursor.after) query = query.startAfter(cursor.after)
    const page = await query.get()
    const companies = db().collection('orgs').doc(request.orgId).collection(CRM_COLLECTIONS.companies)
    const stragglersOnly = request.phase === 'sweep'
    const tally = { combined: 0, copied: 0, figuresDropped: 0 }
    const count = (planned: HolderPatch) => {
      tally.combined += planned.combined
      tally.copied += planned.copied
      tally.figuresDropped += planned.figuresDropped
    }
    const plan = (snapshot: FirebaseFirestore.DocumentSnapshot): (Pending & { planned: HolderPatch }) | null => {
      const planned = planHolderRecords((snapshot.data() ?? {}) as Doc, request.plan, request.changeId, {
        stragglersOnly,
      })
      if (!planned) return null
      return {
        snapshot,
        planned,
        patch: planned.patch,
        after: async () => {
          count(planned)
          // A count that could not move is logged and left: the company's own
          // page takes the live aggregate, which corrects it.
          await Promise.all(
            planned.companyCounts.map((change) =>
              companies
                .doc(change.companyId)
                .update({ [COMPANY_CONTACTS_COUNT_FIELD]: FieldValue.increment(change.delta) })
                .catch((error: unknown) => {
                  console.error('[crm] company contacts count could not move', change.companyId, error)
                }),
            ),
          )
        },
      }
    }
    const pending = page.docs
      .map(plan)
      .filter((entry): entry is Pending & { planned: HolderPatch } => entry !== null)
    if (request.dryRun) for (const entry of pending) count(entry.planned)
    else await writeGuarded(db(), pending, plan)
    counts['combined'] = (counts['combined'] ?? 0) + tally.combined
    counts['copied'] = (counts['copied'] ?? 0) + tally.copied
    counts['figuresDropped'] = (counts['figuresDropped'] ?? 0) + tally.figuresDropped
    if (page.size < HOLDER_PAGE) return null
    return { stage: 'holders', carry: 0, after: page.docs[page.docs.length - 1].id }
  }

  return {
    async run(request): Promise<ConsentGroupChangeRunResult> {
      const counts: Record<string, number> = {}
      const hasHolderFlows = request.plan.flows.length > 0
      // `carry` walks the refusals; `rehome` the holders; `sweep` both.
      let cursor: Cursor | null = readCursor(
        request.cursor,
        request.phase === 'rehome' ? 'holders' : 'refusals',
      )
      while (cursor && now() < request.deadlineMs) {
        if (cursor.stage === 'refusals') {
          const next: Cursor | null = await refusalPage(request, cursor, counts)
          cursor =
            next ??
            (request.phase === 'sweep' && hasHolderFlows
              ? { stage: 'holders', carry: 0, after: null }
              : null)
          continue
        }
        cursor = hasHolderFlows ? await holderPage(request, cursor, counts) : null
      }
      return { done: cursor === null, cursor: cursor ? JSON.stringify(cursor) : null, counts }
    },

    async preview({ orgId, plan }): Promise<ConsentGroupChangePreviewLine[]> {
      const contacts = contactsOf(orgId)
      const lines: ConsentGroupChangePreviewLine[] = []
      const moves = plan.flows.filter((flow): flow is ConsentGroupHolderMove => flow.kind === 'move')
      const splits = plan.flows.filter((flow): flow is ConsentGroupHolderSplit => flow.kind === 'split')
      const people = (count: number | null) => (count === 1 ? 'person' : 'people')
      const figure = (count: number | null) => (count === null ? 'some' : String(count))

      /*
       * `crm.combine`: the people whose records under two or more of the
       * folding keys become one. No aggregation can ask "two or more", so the
       * records under each source key are read — bounded, and `null` past
       * the bound — and put through the same fold the re-home runs.
       */
      if (moves.length) {
        const seen = new Map<string, Doc>()
        let bounded = true
        for (const move of moves) {
          const page = await contacts
            .where(`${CONTACT_FACETS_FIELD}.${move.from}`, '!=', null)
            .limit(PREVIEW_SCAN_LIMIT + 1)
            .get()
          if (page.size > PREVIEW_SCAN_LIMIT) bounded = false
          for (const doc of page.docs) seen.set(doc.id, (doc.data() ?? {}) as Doc)
        }
        const combine = bounded
          ? [...seen.values()].reduce(
              (total, contact) =>
                total + (planHolderRecords(contact, { flows: moves }, '')?.combined ?? 0),
              0,
            )
          : null
        lines.push({
          id: 'crm.combine',
          text: `The CRM records these sites keep about the same person will be combined for ${figure(combine)} ${people(combine)}.`,
          count: combine,
          severity: 'info',
        })
      }

      if (splits.length) {
        /*
         * `crm.copy`: the people a separating site takes a copy for. When the
         * key survives, those are the people the separating sites met
         * themselves; when it dissolves, everybody it holds, since a record
         * nobody met goes to every successor.
         */
        let copy = 0
        for (const split of splits) {
          if (!split.survives) {
            copy += await countOf(contacts.where(`${CONTACT_FACETS_FIELD}.${split.from}`, '!=', null))
            continue
          }
          const leavers = split.successors.flatMap((successor) => successor.hostIds)
          for (let index = 0; index < leavers.length; index += 30) {
            copy += await countOf(
              contacts.where(CAPTURED_BY_HOST_FIELD, 'array-contains-any', leavers.slice(index, index + 30)),
            )
          }
        }
        lines.push({
          id: 'crm.copy',
          text: `The separating sites keep a copy of the CRM record for the ${copy} ${people(copy)} they met themselves.`,
          count: copy,
          severity: 'info',
        })

        /*
         * `crm.grants` and `crm.visibility`, per separating site: the people
         * who signed up to the group through it and still hold that grant,
         * and the people it can see without having met them.
         */
        let grants = 0
        let visible = 0
        for (const split of splits) {
          for (const hostId of split.successors.flatMap((successor) => successor.hostIds)) {
            grants += await countOf(
              contacts
                .where(`${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}.${CONSENT_GROUP_ID_FIELD}`, '==', split.from)
                .where(`${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}.${MARKETING_CONSENT_FIELD}`, '==', true),
            )
            const seen = await countOf(contacts.where('visibleTo', 'array-contains', `host:${hostId}`))
            const met = await countOf(contacts.where(CAPTURED_BY_HOST_FIELD, 'array-contains', hostId))
            visible += Math.max(0, seen - met)
          }
        }
        lines.push({
          id: 'crm.grants',
          text: `The separating sites can still email the ${grants} ${people(grants)} who signed up to the group while they were part of it.`,
          count: grants,
          severity: 'info',
        })
        lines.push({
          id: 'crm.visibility',
          text: `The separating sites will still see ${visible} ${people(visible)} they met only through the group's other sites, without their CRM details.`,
          count: visible,
          severity: 'info',
        })

        /*
         * `crm.figures`: on a dissolve, the people whose order totals cannot
         * follow one site and are dropped. Read like the combine — the people
         * with orders under the key, bounded — and decided by the same split.
         */
        const dissolving = splits.filter((split) => !split.survives)
        if (dissolving.length) {
          let figures: number | null = 0
          for (const split of dissolving) {
            const page = await contacts
              .where(`${CONTACT_FACETS_FIELD}.${split.from}.ordersCount`, '>', 0)
              .limit(PREVIEW_SCAN_LIMIT + 1)
              .get()
            if (page.size > PREVIEW_SCAN_LIMIT || figures === null) {
              figures = null
              continue
            }
            for (const doc of page.docs) {
              figures +=
                planHolderRecords((doc.data() ?? {}) as Doc, { flows: [split] }, '')?.figuresDropped ?? 0
            }
          }
          lines.push({
            id: 'crm.figures',
            text: `Order totals for ${figure(figures)} ${people(figures)} who bought on more than one of these sites can't be split and will be removed.`,
            count: figures,
            severity: 'warning',
          })
        }
      }

      /*
       * `crm.refusals`: the refusals C4 would write — each separating pair's
       * declined consents, less the ones the receiving site already holds.
       */
      if (plan.carries.length) {
        let refusals = 0
        for (const carry of plan.carries) {
          const declined = (hostId: string) =>
            `${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}.${MARKETING_CONSENT_FIELD}`
          const from = contacts.where(declined(carry.fromHostId), '==', false)
          refusals += Math.max(
            0,
            (await countOf(from)) - (await countOf(from.where(declined(carry.toHostId), '==', false))),
          )
        }
        lines.push({
          id: 'crm.refusals',
          text: `${refusals} declined ${refusals === 1 ? 'consent' : 'consents'} will be copied to the sites that separate.`,
          count: refusals,
          severity: 'info',
        })
      }
      return lines
    },

    summarize: summarizeConsentGroupChange,
  }
}

/** The participant the CRM registers, on the Admin SDK and the wall clock. */
export const consentGroupParticipant = createConsentGroupParticipant()
