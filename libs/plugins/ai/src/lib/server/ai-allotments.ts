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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  assistCreditsFromUsd,
  resolveAssistCreditBudget,
} from '@aglyn/aglyn/app-utils/assist-credits'
import { hostRoleFor, isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue } from 'firebase-admin/firestore'
import { logAiAllotmentChanged } from '../activity/ai-activity'
import {
  AI_ALLOTMENT_MAX_CREDITS,
  AI_ALLOTMENT_MAX_MODELS,
  aiAllotmentCredits,
  parseAiAllotmentSubject,
  type AiAllotment,
  type AiAllotmentMode,
  type AiAllotmentSubject,
} from '../model/ai-allotments'
import { aiUsageByUserMonthFrom, aiUsageMonthKeys } from '../model/ai-usage-by-user'
import { AI_MODEL_CATALOG } from '../providers/catalog'
import { AI_MODEL_RESTRICTION_PLANS } from '../providers/model-choice'
import { resolveAiProvider } from '../providers/routing'
import {
  AI_HOST_CREDITS_FIELD,
  applyAiAllotmentWrites,
  listAiAllotments,
  seedAiHostMonthCredits,
  type AiAllotmentWrite,
} from '../usage/ai-allotments'
import { userAiUsageMonthRef } from '../usage/ai-usage-by-user'
import type {
  AiAllotmentRowWire,
  AiAllotmentsHostWire,
  AiAllotmentsMemberWire,
  AiAllotmentsWire,
} from '../usage/ai-usage-wire'

// lockdown-423: exempt — a spend control, the posture of ai/billing/overage
// beside it: a billing-locked workspace must still be able to LOWER what its
// people may spend, and a 423 would trap it spending.

/**
 * AI ALLOTMENTS (AGL-2942) — read and set them.
 *
 * ## Who may read
 *
 * - The whole org's allotments (`orgId`): `billing.view`, the Usage page's
 *   gate — every allotment is a figure about the pool it is part of.
 * - One site's (`hostId`): the same, or the site's admin when they are a
 *   collaborator scoped to it — the collaborators card is theirs.
 * - One person's (`uid`): the same, or the person themselves.
 *
 * ## Who may write
 *
 * - A member's, a site's and the org-wide model restriction:
 *   `billing.manage`. Each moves how much of the paid pool someone may
 *   spend.
 * - A collaborator's on one site: `billing.manage`, or the admin of that
 *   site when they are a collaborator scoped to it — never on their own
 *   allotment, which they could otherwise raise.
 *
 * Staff pass, as at the other org routes. The org-wide restriction is set
 * only on a plan that offers it (`AI_MODEL_RESTRICTION_PLANS`); clearing it
 * is always allowed.
 *
 * ## One write, many subjects
 *
 * `POST { orgId, set, remove, everySite }`: `set` replaces allotments,
 * `remove` deletes them, and `everySite` sets the same allotment on every
 * site the org has — "same for every client site" — expanded here, from the
 * org's sites, rather than trusted from a client's list.
 */

const json = (body: unknown, status: number) => Response.json(body, { status })

/** Batch writes a request may make; Firestore commits at most 500. */
const MAX_WRITES = 450

/** Sites one `everySite` expands to. */
const MAX_SITES = 400

/** Member months one `getAll` carries. */
const GET_ALL_CHUNK = 100

interface Caller {
  uid: string
  email: string | null
  staff: boolean
  member: AglynOrgMember | null
}

async function authenticate(
  headers: Partial<Record<string, string>>,
): Promise<Response | { decoded: { uid: string; email?: string; staff: boolean } }> {
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return emailUnverifiedResponse()
  }
  return { decoded: { uid: decoded.uid, email: decoded.email, staff: decoded['staff'] === true } }
}

/** A collaborator scoped to the site who holds its admin role there. */
function isSiteAdminCollaborator(member: AglynOrgMember | null, hostId: string): boolean {
  if (!member || !hostId || isOrgWideMember(member)) return false
  return hostRoleFor(member, hostId) === 'admin'
}

interface RosterMonth {
  member: AglynOrgMember
  credits: number
  byHost: Record<string, number>
}

/** The roster and each member's month, by path — no index, one getAll a hundred. */
async function readRosterMonths(
  firestore: FirebaseFirestore.Firestore,
  orgRef: FirebaseFirestore.DocumentReference,
  month: string,
): Promise<RosterMonth[]> {
  const roster = await orgRef.collection('members').get()
  const members = roster.docs.map(
    (doc) => ({ $id: doc.id, ...doc.data() }) as AglynOrgMember,
  )
  const out: RosterMonth[] = []
  for (let start = 0; start < members.length; start += GET_ALL_CHUNK) {
    const chunk = members.slice(start, start + GET_ALL_CHUNK)
    const snapshots = chunk.length
      ? await firestore.getAll(
          ...chunk.map((member) => userAiUsageMonthRef(orgRef, member.$id, month)),
        )
      : []
    snapshots.forEach((snapshot, index) => {
      const member = chunk[index]
      const usage = aiUsageByUserMonthFrom(
        snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null,
        member.$id,
        month,
      )
      out.push({ member, credits: usage.credits, byHost: usage.byHost })
    })
  }
  return out
}

const memberName = (member: AglynOrgMember): string =>
  String(member.displayName ?? '').trim() || String(member.email ?? '').trim() || member.$id

/** A site's credits this month: the org map, else its people's months summed. */
function siteCredits(
  orgMonth: FirebaseFirestore.DocumentSnapshot,
  roster: readonly RosterMonth[],
  hostId: string,
): number {
  const map = (orgMonth.exists ? orgMonth.get(AI_HOST_CREDITS_FIELD) : null) as
    | Record<string, unknown>
    | null
  if (map && map[hostId] !== undefined) {
    const value = Number(map[hostId])
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  }
  return roster.reduce((sum, entry) => sum + (entry.byHost[hostId] ?? 0), 0)
}

async function handleGet(request: Request): Promise<Response> {
  const { query, headers } = await pluginRequestFromWeb(request)
  const params = (query ?? {}) as Record<string, unknown>
  const hostId = String(params['hostId'] ?? '').trim()
  const subjectUid = String(params['uid'] ?? '').trim()
  const auth = await authenticate(headers as Partial<Record<string, string>>)
  if (auth instanceof Response) return auth
  const { decoded } = auth
  const orgId =
    String(params['orgId'] ?? '').trim() || (hostId ? ((await resolveOrgIdForHost(hostId)) ?? '') : '')
  if (!orgId) return json({ error: 'Missing orgId' }, 400)

  const membership = await resolveOrgMembership(decoded.uid, orgId)
  const member = membership?.member ?? null
  if (!member && !decoded.staff) return json({ error: 'Not found' }, 404)
  const canManage =
    decoded.staff || (await memberHasOrgPermission(orgId, member, 'billing.manage'))
  const canView =
    canManage || (await memberHasOrgPermission(orgId, member, 'billing.view'))
  const siteAdmin = isSiteAdminCollaborator(member, hostId)
  const allowed = subjectUid
    ? canView || subjectUid === decoded.uid || siteAdmin
    : hostId
      ? canView || siteAdmin
      : canView
  if (!allowed) return json({ error: 'billing.view required' }, 403)

  const firestore = firebaseAdmin.app().firestore()
  const orgRef = firestore.collection('orgs').doc(orgId)
  const month = aiUsageMonthKeys()[0]
  const [orgSnapshot, orgMonth, allotments, roster, hostDocs] = await Promise.all([
    orgRef.get(),
    orgRef.collection('assistUsage').doc(month).get(),
    listAiAllotments(firestore, orgId, subjectUid ? { uid: subjectUid } : hostId ? { hostId } : {}),
    readRosterMonths(firestore, orgRef, month),
    hostId
      ? firestore.collection('hosts').doc(hostId).get().then((doc) => (doc.exists ? [doc] : []))
      : firestore.collection('hosts').where('orgId', '==', orgId).limit(MAX_SITES).get().then((snapshot) => snapshot.docs),
  ])
  const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
  const byUid = new Map(roster.map((entry) => [entry.member.$id, entry]))

  const used = (allotment: AiAllotment): number => {
    const person = allotment.uid ? byUid.get(allotment.uid) : undefined
    switch (allotment.scope) {
      case 'member':
        return person?.credits ?? 0
      case 'collab':
        return allotment.hostId ? (person?.byHost[allotment.hostId] ?? 0) : 0
      case 'host':
        return allotment.hostId ? siteCredits(orgMonth, roster, allotment.hostId) : 0
      default:
        return 0
    }
  }
  const rows: AiAllotmentRowWire[] = allotments
    // A collaborator reading their own sees their own rows and nothing else.
    .filter((allotment) => canView || siteAdmin || allotment.uid === decoded.uid)
    .map((allotment) => ({
      subject: allotment.subject,
      scope: allotment.scope,
      uid: allotment.uid,
      hostId: allotment.hostId,
      credits: allotment.credits,
      mode: allotment.mode,
      models: allotment.models,
      used: used(allotment),
    }))

  const visibleMembers = roster.filter((entry) =>
    subjectUid
      ? entry.member.$id === subjectUid
      : hostId
        ? hostRoleFor(entry.member, hostId) !== null
        : canView,
  )
  const members: AiAllotmentsMemberWire[] = visibleMembers.map((entry) => ({
    uid: entry.member.$id,
    name: memberName(entry.member),
    email: typeof entry.member.email === 'string' ? entry.member.email : null,
    role: typeof entry.member.role === 'string' ? entry.member.role : null,
    orgWide: isOrgWideMember(entry.member),
    credits: entry.credits,
    byHost: entry.byHost,
  }))
  const hosts: AiAllotmentsHostWire[] = hostDocs.map((doc) => ({
    hostId: doc.id,
    name: String(doc.get('displayName') ?? '').trim() || String(doc.get('subdomain') ?? '').trim() || doc.id,
    credits: siteCredits(orgMonth, roster, doc.id),
  }))
  const provider = resolveAiProvider()
  const wire: AiAllotmentsWire = {
    orgId,
    month,
    pool: {
      used: assistCreditsFromUsd(Number(orgMonth.get('estCostUsd') ?? 0)),
      limit: resolveAssistCreditBudget(org as never),
    },
    allotments: rows,
    members,
    hosts,
    models: AI_MODEL_CATALOG.filter((entry) => !provider || entry.provider === provider.id).map(
      (entry) => ({ id: entry.id, label: entry.label, tier: entry.tier }),
    ),
    restrictionAvailable: AI_MODEL_RESTRICTION_PLANS.includes(resolveEffectivePlan(org as never)),
    canEdit: {
      billing: canManage,
      collaborators: canManage || siteAdmin,
    },
    callerUid: decoded.uid,
  }
  return Response.json(wire, { status: 200, headers: { 'Cache-Control': 'no-store, private' } })
}

interface ParsedWrite {
  subject: AiAllotmentSubject
  credits: number | null
  mode: AiAllotmentMode
  models: string[] | null
}

const CATALOG_IDS = new Set(AI_MODEL_CATALOG.map((entry) => entry.id))

/** One entry of `set`, validated; a string names what is wrong. */
export function parseAllotmentWrite(raw: unknown): ParsedWrite | string {
  const entry = (raw ?? {}) as Record<string, unknown>
  const subject = parseAiAllotmentSubject(entry['subject'])
  if (!subject) return 'subject must be member:{uid}, collab:{hostId}:{uid}, host:{hostId} or org'
  let credits: number | null = null
  if (entry['credits'] !== null && entry['credits'] !== undefined) {
    credits = typeof entry['credits'] === 'number' ? aiAllotmentCredits(entry['credits']) : null
    if (credits === null || (entry['credits'] as number) > AI_ALLOTMENT_MAX_CREDITS) {
      return `credits must be a whole number from 1 to ${AI_ALLOTMENT_MAX_CREDITS.toLocaleString('en-US')}`
    }
  }
  const mode = entry['mode'] === undefined ? 'hard' : entry['mode']
  if (mode !== 'hard' && mode !== 'soft') return 'mode must be hard or soft'
  let models: string[] | null = null
  if (entry['models'] !== null && entry['models'] !== undefined) {
    if (!Array.isArray(entry['models'])) return 'models must be a list of model ids'
    const ids = [...new Set(entry['models'].map((id) => String(id ?? '').trim()))].filter(Boolean)
    if (ids.length > AI_ALLOTMENT_MAX_MODELS) return `name at most ${AI_ALLOTMENT_MAX_MODELS} models`
    const unknown = ids.find((id) => !CATALOG_IDS.has(id))
    if (unknown) return `${unknown} is not a model this platform offers`
    models = ids.length ? ids : null
  }
  if (subject.scope === 'org' && credits !== null) {
    return 'the org-wide restriction carries models, not credits'
  }
  if (subject.scope !== 'org' && credits === null && models === null) {
    return 'set credits or models, or remove the allotment'
  }
  return { subject, credits, mode, models }
}

async function handlePost(request: Request): Promise<Response> {
  const { body, headers } = await pluginRequestFromWeb(request)
  const auth = await authenticate(headers as Partial<Record<string, string>>)
  if (auth instanceof Response) return auth
  const { decoded } = auth
  const payload = (body ?? {}) as Record<string, unknown>
  const orgId = String(payload['orgId'] ?? '').trim()
  if (!orgId) return json({ error: 'Missing orgId' }, 400)

  const rawSet = Array.isArray(payload['set']) ? payload['set'] : []
  const rawRemove = Array.isArray(payload['remove']) ? payload['remove'] : []
  const rawEverySite = payload['everySite'] ?? null
  if (!rawSet.length && !rawRemove.length && !rawEverySite) {
    return json({ error: 'Nothing to change' }, 400)
  }
  if (rawSet.length + rawRemove.length > MAX_WRITES) {
    return json({ error: `Change at most ${MAX_WRITES} allotments at once` }, 400)
  }

  const writes: ParsedWrite[] = []
  for (const raw of rawSet) {
    const parsed = parseAllotmentWrite(raw)
    if (typeof parsed === 'string') return json({ error: parsed, code: 'invalid_allotment' }, 400)
    writes.push(parsed)
  }
  const removals: AiAllotmentSubject[] = []
  for (const raw of rawRemove) {
    const subject = parseAiAllotmentSubject(raw)
    if (!subject) return json({ error: `${String(raw)} is not an allotment subject` }, 400)
    removals.push(subject)
  }
  let everySite: Omit<ParsedWrite, 'subject'> | null = null
  if (rawEverySite) {
    const parsed = parseAllotmentWrite({ ...(rawEverySite as object), subject: 'host:every-site' })
    if (typeof parsed === 'string') return json({ error: parsed, code: 'invalid_allotment' }, 400)
    everySite = { credits: parsed.credits, mode: parsed.mode, models: parsed.models }
  }

  const membership = await resolveOrgMembership(decoded.uid, orgId)
  const caller: Caller = {
    uid: decoded.uid,
    email: decoded.email ?? null,
    staff: decoded.staff,
    member: membership?.member ?? null,
  }
  if (!caller.member && !caller.staff) return json({ error: 'Not found' }, 404)
  const canManage =
    caller.staff || (await memberHasOrgPermission(orgId, caller.member, 'billing.manage'))

  const firestore = firebaseAdmin.app().firestore()
  const orgRef = firestore.collection('orgs').doc(orgId)
  const orgSnapshot = await orgRef.get()
  if (!orgSnapshot.exists) return json({ error: 'Unknown organization' }, 404)
  const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>

  // Every subject the request touches, set or removed, is decided the same
  // way: the permission first, then that the person or site belongs here.
  const touched = [...writes.map((write) => write.subject), ...removals]
  if (everySite && !canManage) return json({ error: 'billing.manage required' }, 403)
  const memberDocs = new Map<string, AglynOrgMember | null>()
  const memberOf = async (uid: string): Promise<AglynOrgMember | null> => {
    if (!memberDocs.has(uid)) {
      const snapshot = await orgRef.collection('members').doc(uid).get()
      memberDocs.set(uid, snapshot.exists ? ({ $id: uid, ...snapshot.data() } as AglynOrgMember) : null)
    }
    return memberDocs.get(uid) ?? null
  }
  const hostNames = new Map<string, string>()
  for (const subject of touched) {
    if (subject.scope === 'collab') {
      const siteAdmin = isSiteAdminCollaborator(caller.member, subject.hostId ?? '')
      if (!canManage && !siteAdmin) return json({ error: 'billing.manage required' }, 403)
      if (!canManage && subject.uid === caller.uid) {
        return json({ error: 'You cannot change your own AI allotment', code: 'own_allotment' }, 403)
      }
      const target = await memberOf(subject.uid ?? '')
      if (!target || hostRoleFor(target, subject.hostId ?? '') === null) {
        return json({ error: 'That person is not a collaborator on that site' }, 404)
      }
      // A site's admin sets allotments for the site's COLLABORATORS: a team
      // member's AI is the organization's to bound, not one site's.
      if (!canManage && isOrgWideMember(target)) {
        return json({ error: 'billing.manage required' }, 403)
      }
    } else if (!canManage) {
      return json({ error: 'billing.manage required' }, 403)
    } else if (subject.scope === 'member') {
      if (!(await memberOf(subject.uid ?? ''))) {
        return json({ error: 'That person is not a member of this organization' }, 404)
      }
    } else if (subject.scope === 'host') {
      const host = await firestore.collection('hosts').doc(subject.hostId ?? '').get()
      if (!host.exists || host.get('orgId') !== orgId) {
        return json({ error: 'That site is not part of this organization' }, 404)
      }
      hostNames.set(host.id, String(host.get('displayName') ?? '').trim() || host.id)
    }
  }
  const restricting = writes.some((write) => write.subject.scope === 'org' && write.models)
  if (restricting && !AI_MODEL_RESTRICTION_PLANS.includes(resolveEffectivePlan(org as never))) {
    return json(
      {
        error: 'Restricting models for the whole organization is available on Agency and Enterprise.',
        code: 'not_available',
      },
      409,
    )
  }

  const set: AiAllotmentWrite[] = [...writes]
  if (everySite) {
    const sites = await firestore.collection('hosts').where('orgId', '==', orgId).limit(MAX_SITES).get()
    for (const site of sites.docs) {
      hostNames.set(site.id, String(site.get('displayName') ?? '').trim() || site.id)
      const subject = parseAiAllotmentSubject(`host:${site.id}`)
      if (subject) set.push({ subject, ...everySite })
    }
    if (set.length + removals.length > MAX_WRITES) {
      return json({ error: `Change at most ${MAX_WRITES} allotments at once` }, 400)
    }
  }

  await applyAiAllotmentWrites(
    firestore,
    orgId,
    { set, remove: removals.map((subject) => subject.id) },
    caller.uid,
  )

  // A site allotment set in a month the site's map has no key for yet is
  // given the month so far from its people's own months, once.
  const month = aiUsageMonthKeys()[0]
  const siteIds = set
    .filter((write) => write.subject.scope === 'host' && write.credits !== null)
    .map((write) => write.subject.hostId as string)
  if (siteIds.length) {
    const roster = await readRosterMonths(firestore, orgRef, month)
    await seedAiHostMonthCredits(firestore, orgId, siteIds, month, (siteId) =>
      roster.reduce((sum, entry) => sum + (entry.byHost[siteId] ?? 0), 0),
    ).catch((error) => console.error('[ai/allotments] site month seed failed', orgId, error))
  }

  void firestore
    .collection('adminAudit')
    .add({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: 'ai.allotments.set',
      target: `orgs/${orgId}/aiAllotments`,
      before: null,
      after: {
        set: set.map((write) => ({ subject: write.subject.id, credits: write.credits, mode: write.mode, models: write.models })),
        removed: removals.map((subject) => subject.id),
      },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  const actor = { uid: caller.uid, email: caller.email }
  const feedRow = (subject: AiAllotmentSubject) => ({
    type: subject.scope === 'host' ? ('host' as const) : subject.scope === 'org' ? ('org' as const) : ('member' as const),
    id: subject.scope === 'host' ? subject.hostId : subject.uid,
    name:
      subject.scope === 'host'
        ? hostNames.get(subject.hostId ?? '') ?? subject.hostId
        : subject.scope === 'org'
          ? 'Organization model restriction'
          : [
              memberDocs.get(subject.uid ?? '') ? memberName(memberDocs.get(subject.uid ?? '') as AglynOrgMember) : subject.uid,
              subject.scope === 'collab' ? `on ${subject.hostId}` : null,
            ]
              .filter(Boolean)
              .join(' '),
  })
  await Promise.all([
    ...set.map((write) =>
      logAiAllotmentChanged(orgId, actor, {
        subject: feedRow(write.subject),
        after: { credits: write.credits, mode: write.mode, models: write.models },
      }).catch(() => undefined),
    ),
    ...removals.map((subject) =>
      logAiAllotmentChanged(orgId, actor, { subject: feedRow(subject), after: null }).catch(
        () => undefined,
      ),
    ),
  ])

  return json({ ok: true, set: set.length, removed: removals.length }, 200)
}

async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === 'GET') return await handleGet(request)
    if (request.method === 'POST') return await handlePost(request)
    return json({ error: 'Method not allowed' }, 405)
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/allotments] failed', error)
    return json({ error: 'AI allotments unavailable' }, 500)
  }
}

export { handler as GET, handler as POST }
