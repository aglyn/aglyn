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

import { randomUUID } from 'crypto'
import { logHostActivity } from '@aglyn/tenant-data-admin'
import {
  formatLoyaltyCents,
  formatPoints,
  normalizeLoyaltyEmail,
  pointsValueCents,
} from '../model/loyalty-math'
import {
  toLoyaltyLedgerView,
  toLoyaltyMemberView,
  type LoyaltyOrderView,
  type LoyaltyProgramTotals,
  type StoredLoyaltyMember,
} from '../model/loyalty-member'
import {
  applyLoyaltyProgramChange,
  loyaltyProgramProblem,
  type LoyaltyProgram,
} from '../model/loyalty-program'
import { LOYALTY_COLLECTIONS } from '../constants/bundle-common'
import { isDocumentId, keyId, loyaltyDb, loyaltyRefs } from './db'
import { sendLoyaltyEmail, storeCreditEmail } from './emails'
import { sendLoyaltySync } from './connector-sync'
import { loyaltySyncTarget, normalizeStoredMember, readMemberForWrite, writeLedger, writeMember } from './members'
import { forgetLoyaltyProgramCache, readLoyaltyProgram } from './program-store'
import { json, loyaltyGate, refuse } from './route-gate'

/**
 * Loyalty's console routes (AGL-3640). Each climbs {@link loyaltyGate}.
 * Everything a member's balance is, the console learns here: the Firestore
 * rules refuse every client the loyalty collections, so a card cannot read
 * a rewards code it was not served, and cannot write a balance at all.
 */

const PAGE_DEFAULT = 25
const PAGE_MAX = 50
const MEMBER_ID = /^[0-9a-f]{32}$/
/** The most one hand adjustment moves: a million points, or $2,000 of credit. */
export const LOYALTY_ADJUST_MAX_POINTS = 1_000_000
export const LOYALTY_ADJUST_MAX_CREDIT_CENTS = 200_000

export type LoyaltyMembersSort = 'recent' | 'points' | 'email'

type Totals = (orgId: string, hostId: string, program: LoyaltyProgram) => Promise<LoyaltyProgramTotals>

let totalsOverride: Totals | null = null

/** Test seam: the aggregate query the in-memory database cannot run. */
export function setLoyaltyTotalsForTests(totals: Totals | null): void {
  totalsOverride = totals
}

const NO_TOTALS: LoyaltyProgramTotals = {
  members: null,
  outstandingPoints: null,
  outstandingPointsCents: null,
  outstandingCreditCents: null,
}

/** The program's figures, by aggregate query: never a scan of every member. */
export async function programTotals(orgId: string, hostId: string, program: LoyaltyProgram): Promise<LoyaltyProgramTotals> {
  if (totalsOverride) return totalsOverride(orgId, hostId, program)
  try {
    const { AggregateField } = await import('firebase-admin/firestore')
    const snapshot = await loyaltyRefs
      .members(orgId)
      .where('hostId', '==', hostId)
      .aggregate({
        members: AggregateField.count(),
        points: AggregateField.sum('points'),
        credit: AggregateField.sum('creditCents'),
      })
      .get()
    const data = snapshot.data()
    const points = Math.max(0, Math.trunc(Number(data.points) || 0))
    return {
      members: Number(data.members) || 0,
      outstandingPoints: points,
      outstandingPointsCents: pointsValueCents(points, program),
      outstandingCreditCents: Math.max(0, Math.trunc(Number(data.credit) || 0)),
    }
  } catch (error) {
    console.error('[loyalty] totals unavailable', hostId, error)
    return NO_TOTALS
  }
}

/** `GET ?hostId` — the program and its totals; `POST {hostId, program}` — change it. */
export async function programRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return refuse(405, 'Method not allowed')
  const gate = await loyaltyGate(request, { role: request.method === 'GET' ? 'viewer' : 'admin' })
  if (gate instanceof Response) return gate
  const current = await readLoyaltyProgram(gate.orgId, gate.hostId)
  if (request.method === 'GET') {
    return json({ program: current, totals: await programTotals(gate.orgId, gate.hostId, current) })
  }
  const change = gate.body['program']
  const problem = loyaltyProgramProblem(change)
  if (problem) return refuse(400, problem)
  const next = applyLoyaltyProgramChange(current, change as Record<string, unknown>)
  await loyaltyRefs.program(gate.orgId, gate.hostId).set({
    ...next,
    orgId: gate.orgId,
    hostId: gate.hostId,
    updatedAtMs: Date.now(),
    updatedBy: gate.uid,
  })
  forgetLoyaltyProgramCache(gate.hostId)
  if (current.enabled !== next.enabled) {
    await logHostActivity(
      gate.hostId,
      { uid: gate.uid, email: gate.email },
      next.enabled ? 'Turned on rewards' : 'Turned off rewards',
      { type: 'loyalty:program', id: gate.hostId, name: 'Rewards program' },
    ).catch(() => undefined)
  }
  return json({ program: next, totals: await programTotals(gate.orgId, gate.hostId, next) })
}

/** `GET ?hostId&sort&q&after` — the members, a page at a time, newest first by default. */
export async function membersRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const gate = await loyaltyGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const params = new URL(request.url).searchParams
  const program = await readLoyaltyProgram(gate.orgId, gate.hostId)
  const search = String(params.get('q') ?? '').trim().toLowerCase().slice(0, 120)
  const sort: LoyaltyMembersSort = search
    ? 'email'
    : params.get('sort') === 'points'
      ? 'points'
      : params.get('sort') === 'email'
        ? 'email'
        : 'recent'
  let query: any = loyaltyRefs.members(gate.orgId).where('hostId', '==', gate.hostId)
  if (search) query = query.where('email', '>=', search).where('email', '<', `${search}`)
  query =
    sort === 'points'
      ? query.orderBy('points', 'desc')
      : sort === 'email'
        ? query.orderBy('email', 'asc')
        : query.orderBy('createdAtMs', 'desc')
  const after = String(params.get('after') ?? '')
  if (after) {
    if (!MEMBER_ID.test(after)) return refuse(400, 'Bad cursor')
    const cursor = await loyaltyRefs.member(gate.orgId, gate.hostId, after).get()
    if (cursor.exists) query = query.startAfter(cursor)
  }
  const asked = Math.trunc(Number(params.get('limit')))
  const page = Number.isFinite(asked) && asked > 0 ? Math.min(PAGE_MAX, asked) : PAGE_DEFAULT
  const snapshot = await query.limit(page + 1).get()
  const docs = snapshot.docs.slice(0, page)
  const members = docs.map((doc: any) =>
    toLoyaltyMemberView(String(doc.get('memberKey') ?? ''), doc.data(), { referrals: program.referralsEnabled }),
  )
  return json({
    members,
    next: snapshot.docs.length > page ? members[members.length - 1]?.id ?? null : null,
    sort,
  })
}

/** `GET ?hostId&memberId` — one member and their last fifty movements. */
async function readMemberDetail(gate: { orgId: string; hostId: string }, memberKey: string, program: LoyaltyProgram) {
  const snapshot = await loyaltyRefs.member(gate.orgId, gate.hostId, memberKey).get()
  if (!snapshot.exists) return null
  const ledger = await loyaltyRefs
    .ledgerCollection(gate.orgId)
    .where('hostId', '==', gate.hostId)
    .where('memberKey', '==', memberKey)
    .orderBy('atMs', 'desc')
    .limit(50)
    .get()
  return {
    member: toLoyaltyMemberView(memberKey, snapshot.data(), { referrals: program.referralsEnabled }),
    ledger: ledger.docs.map((doc: any) => toLoyaltyLedgerView(doc.id, doc.data())),
  }
}

function signedWhole(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

/**
 * `GET ?hostId&memberId` — one member and their history.
 * `POST {hostId, memberId | email, points, creditCents, note, notify}` — move a
 * balance by hand, enrolling the email when it is not a member yet. An
 * `Idempotency-Key` makes a retried press one adjustment.
 */
export async function memberRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return refuse(405, 'Method not allowed')
  const gate = await loyaltyGate(request, { role: request.method === 'GET' ? 'viewer' : 'editor' })
  if (gate instanceof Response) return gate
  const program = await readLoyaltyProgram(gate.orgId, gate.hostId)
  if (request.method === 'GET') {
    const memberId = String(new URL(request.url).searchParams.get('memberId') ?? '')
    if (!MEMBER_ID.test(memberId)) return refuse(400, 'Missing memberId')
    const detail = await readMemberDetail(gate, memberId, program)
    return detail ? json(detail) : refuse(404, 'No such member')
  }

  const body = gate.body
  const points = signedWhole(body['points'])
  const creditCents = signedWhole(body['creditCents'])
  if (points === null || creditCents === null) return refuse(400, 'Points and credit must be whole numbers.')
  if (Math.abs(points) > LOYALTY_ADJUST_MAX_POINTS) {
    return refuse(400, `One change moves at most ${formatPoints(LOYALTY_ADJUST_MAX_POINTS)} points.`)
  }
  if (Math.abs(creditCents) > LOYALTY_ADJUST_MAX_CREDIT_CENTS) {
    return refuse(400, `One change moves at most ${formatLoyaltyCents(LOYALTY_ADJUST_MAX_CREDIT_CENTS)} of credit.`)
  }
  if (!points && !creditCents) return refuse(400, 'Enter points or store credit to add or take away.')
  const note = String(body['note'] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const memberId = String(body['memberId'] ?? '')
  const email = normalizeLoyaltyEmail(body['email'])
  if (!MEMBER_ID.test(memberId) && !email) return refuse(400, 'Enter the customer’s email.')
  const idempotencyKey = String(request.headers.get('idempotency-key') ?? '').trim().slice(0, 200)
  const entryKey = `adjust__${idempotencyKey ? keyId(`${gate.uid}:${idempotencyKey}`) : randomUUID().replace(/-/g, '')}`
  const scope = { orgId: gate.orgId, hostId: gate.hostId }
  const nowMs = Date.now()

  type Outcome = { error: [number, string] } | { member: StoredLoyaltyMember; replay: boolean }
  const outcome: Outcome = await loyaltyDb().runTransaction(async (transaction: any): Promise<Outcome> => {
    const entryRef = loyaltyRefs.ledger(scope.orgId, scope.hostId, entryKey)
    const prior = await transaction.get(entryRef)
    let plan
    if (MEMBER_ID.test(memberId)) {
      const ref = loyaltyRefs.member(scope.orgId, scope.hostId, memberId)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return { error: [404, 'No such member'] }
      plan = { ref, memberKey: memberId, created: false, codeWrites: [], member: normalizeStoredMember(scope, memberId, snapshot.data()) }
    } else {
      plan = await readMemberForWrite(transaction, scope, { email, name: String(body['name'] ?? ''), nowMs })
    }
    if (prior.exists) return { member: plan.member, replay: true }
    if (plan.member.creditCents + creditCents < 0) {
      return { error: [409, `This member has ${formatLoyaltyCents(Math.max(0, plan.member.creditCents))} of store credit to take away.`] }
    }
    if (points < 0 && plan.member.points + points < 0) {
      return { error: [409, `This member has ${formatPoints(Math.max(0, plan.member.points))} points to take away.`] }
    }
    const member: StoredLoyaltyMember = {
      ...plan.member,
      points: plan.member.points + points,
      lifetimePoints: plan.member.lifetimePoints + Math.max(0, points),
      creditCents: plan.member.creditCents + creditCents,
      updatedAtMs: nowMs,
    }
    writeMember(transaction, { ...plan, member })
    writeLedger(transaction, scope, entryKey, {
      memberKey: plan.memberKey,
      kind: 'adjust',
      points,
      creditCents,
      note: note || null,
      actorUid: gate.uid,
      atMs: nowMs,
    }, loyaltySyncTarget(program, member.email))
    return { member, replay: false }
  })
  if ('error' in outcome) return refuse(outcome.error[0], outcome.error[1])
  if (program.connected && points && !outcome.replay) {
    await sendLoyaltySync({ ...scope, memberKey: outcome.member.memberKey })
  }

  let emailed = false
  if (!outcome.replay) {
    const parts = [
      points ? `${points > 0 ? 'added' : 'took away'} ${formatPoints(Math.abs(points))} points` : '',
      creditCents ? `${creditCents > 0 ? 'added' : 'took away'} ${formatLoyaltyCents(Math.abs(creditCents))} store credit` : '',
    ].filter(Boolean)
    await logHostActivity(
      gate.hostId,
      { uid: gate.uid, email: gate.email },
      `Rewards: ${parts.join(' and ')}`,
      { type: 'loyalty:member', id: outcome.member.memberKey, name: outcome.member.email },
    ).catch(() => undefined)
    if (creditCents > 0 && body['notify'] !== false && program.emails) {
      emailed = await sendLoyaltyEmail(
        storeCreditEmail({ hostId: gate.hostId, org: gate.site.org, member: outcome.member, program, amountCents: creditCents, note }),
      )
    }
  }
  const detail = await readMemberDetail(gate, outcome.member.memberKey, program)
  return json({ ...detail, emailed })
}

/** `GET ?hostId&orderId` — what one order earned, spent and gave back. */
export async function orderRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const gate = await loyaltyGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const orderId = String(new URL(request.url).searchParams.get('orderId') ?? '')
  if (!isDocumentId(orderId)) return refuse(400, 'Missing orderId')
  const snapshot = await loyaltyRefs
    .ledgerCollection(gate.orgId)
    .where('hostId', '==', gate.hostId)
    .where('orderId', '==', orderId)
    .orderBy('atMs', 'asc')
    .limit(50)
    .get()
  const rows = snapshot.docs.map((doc: any) => ({ id: doc.id as string, data: doc.data() as Record<string, any> }))
  const earn = rows.find((row: { id: string }) => row.id === `${gate.hostId}__earn__${orderId}`)
  let email: string | null = null
  if (earn?.data['memberKey']) {
    const member = await loyaltyRefs.member(gate.orgId, gate.hostId, String(earn.data['memberKey'])).get()
    email = member.exists ? String(member.get('email') ?? '') || null : null
  }
  // What was spent and given back is read off the redemptions themselves, in
  // the cents each one took — never re-priced at today's rate.
  const redemptions = await loyaltyDb()
    .collection('orgs')
    .doc(gate.orgId)
    .collection(LOYALTY_COLLECTIONS.redemptions)
    .where('hostId', '==', gate.hostId)
    .where('orderId', '==', orderId)
    .limit(20)
    .get()
  const total = (field: 'cents' | 'points' | 'creditCents' | 'restoredCents') =>
    redemptions.docs.reduce((sum: number, doc: any) => sum + Math.max(0, Math.trunc(Number(doc.get(field)) || 0)), 0)
  const view: LoyaltyOrderView = {
    email,
    memberId: earn ? String(earn.data['memberKey'] ?? '') || null : null,
    earnedPoints: earn ? Math.trunc(Number(earn.data['points']) || 0) : 0,
    reversedPoints: earn ? Math.trunc(Number(earn.data['reversedPoints']) || 0) : 0,
    spentCents: total('cents'),
    spentPoints: total('points'),
    spentCreditCents: total('creditCents'),
    restoredCents: total('restoredCents'),
    entries: rows.map((row: { id: string; data: Record<string, any> }) => toLoyaltyLedgerView(row.id, row.data)),
  }
  return json({ order: view })
}
