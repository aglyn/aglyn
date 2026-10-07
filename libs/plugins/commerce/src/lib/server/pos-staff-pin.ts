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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import {
  POS_PIN_LOCKOUT_MS,
  POS_PIN_MAX_ATTEMPTS,
  posPinProblem,
} from '../model/commerce-pos-ops'
import { hashMemberPassword, verifyMemberPassword } from './membership'
import {
  authorizePosOps,
  defaultPosOpsDeps,
  isPosManager,
  mayWorkRegister,
  mintPosAssertion,
  posOpsBody,
  posOpsCleanId,
  readPosAssertion,
  readPosRegister,
  resolvePosStaffAssertion,
  type PosAssertionPurpose,
  type PosOpsDeps,
} from './pos-ops-gate'

/*==========================================
 * STAFF PINS (AGL-3609): `POST /api/commerce/pos-staff-pin`.
 *
 *   status   whether the signed-in member has a PIN on this site
 *   set      a member sets their own PIN; a workspace admin may set or
 *            reset anyone's, which also lifts a lockout
 *   clear    the same, removing it
 *   roster   who can switch in at this register: members with a PIN
 *   verify   a member's PIN at a register → a signed, short-lived
 *            assertion that they are at it (`cashier`), or that a manager
 *            approved one action (`manager`)
 *   refresh  a still-valid cashier assertion → a fresh one, re-checked
 *
 * The hash is scrypt with a per-PIN salt — the membership password helper —
 * at `hosts/{hostId}/posStaffPins/{uid}`, a collection no client may read or
 * write (the rules deny it outright, staff included).
 *
 * LOCKOUT is counted BEFORE the PIN is checked: each attempt is claimed in a
 * transaction that refuses once {@link POS_PIN_MAX_ATTEMPTS} have failed, so
 * a burst of parallel guesses gets five tries in the lockout window, not five
 * each. A right PIN clears the count.
 *=========================================*/

type Outcome = { status: number; body: Record<string, unknown> }

function pinRef(hostRef: FirebaseFirestore.DocumentReference, uid: string) {
  return hostRef.collection('posStaffPins').doc(uid)
}

export async function handlePosStaffPin(deps: PosOpsDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = posOpsBody(req)
  const gate = await authorizePosOps(deps, req, body['hostId'])
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const staff = gate.staff
  const action = String(body['action'] ?? '')
  const firestore = deps.firestore()

  switch (action) {
    case 'status': {
      const snapshot = await pinRef(staff.hostRef, staff.uid).get()
      return {
        status: 200,
        body: {
          hasPin: snapshot.exists && Boolean(snapshot.get('pinScrypt')),
          isManager: staff.isManager,
        },
      }
    }

    case 'set':
    case 'clear': {
      const target = posOpsCleanId(body['memberUid']) || staff.uid
      if (target !== staff.uid && !staff.isManager) {
        return {
          status: 403,
          body: { error: "Only a workspace admin can set another member's PIN." },
        }
      }
      if (target !== staff.uid) {
        const host = await staff.hostRef.get()
        const role = (host.get('memberRoles') ?? {})[target]
        if (role !== 'admin' && role !== 'editor') {
          return { status: 404, body: { error: 'That member does not work on this site.' } }
        }
      }
      if (action === 'clear') {
        await pinRef(staff.hostRef, target).delete()
        return { status: 200, body: { ok: true, hasPin: false } }
      }
      const pin = String(body['pin'] ?? '')
      const problem = posPinProblem(pin)
      if (problem) return { status: 400, body: { error: problem } }
      await pinRef(staff.hostRef, target).set({
        pinScrypt: hashMemberPassword(pin),
        setAtMs: deps.now(),
        setBy: staff.uid,
        failedAttempts: 0,
        lockedUntilMs: null,
      })
      return { status: 200, body: { ok: true, hasPin: true } }
    }

    case 'roster': {
      const host = await staff.hostRef.get()
      const roles = (host.get('memberRoles') ?? {}) as Record<string, string>
      const pins = await staff.hostRef.collection('posStaffPins').limit(200).get()
      const staffWithPins = pins.docs
        .map((doc) => doc.id)
        .filter((uid) => roles[uid] === 'admin' || roles[uid] === 'editor')
      const members = await Promise.all(
        staffWithPins.map(async (uid) => ({ uid, name: await deps.memberName(uid) })),
      )
      members.sort((a, b) => a.name.localeCompare(b.name))
      return { status: 200, body: { members } }
    }

    case 'verify': {
      const register = await readPosRegister(staff, body['registerId'])
      if ('error' in register) return { status: register.status, body: { error: register.error } }
      const purpose: PosAssertionPurpose = body['purpose'] === 'manager' ? 'manager' : 'cashier'
      const memberUid = posOpsCleanId(body['memberUid'])
      const pin = String(body['pin'] ?? '')
      if (!memberUid || !/^\d{4,6}$/.test(pin)) {
        return { status: 400, body: { error: 'Choose your name and enter your PIN.' } }
      }
      const ref = pinRef(staff.hostRef, memberUid)
      const now = deps.now()
      // Claim the attempt first; the PIN is checked only inside the budget.
      const claim = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists || !snapshot.get('pinScrypt')) return { kind: 'none' as const }
        const lockedUntilMs = Number(snapshot.get('lockedUntilMs') ?? 0)
        if (lockedUntilMs > now) return { kind: 'locked' as const, lockedUntilMs }
        const failed = lockedUntilMs ? 0 : Number(snapshot.get('failedAttempts') ?? 0)
        if (failed >= POS_PIN_MAX_ATTEMPTS) {
          const until = now + POS_PIN_LOCKOUT_MS
          transaction.update(ref, { lockedUntilMs: until, failedAttempts: 0 })
          return { kind: 'locked' as const, lockedUntilMs: until }
        }
        transaction.update(ref, { failedAttempts: failed + 1, lockedUntilMs: null })
        return { kind: 'claimed' as const, hash: String(snapshot.get('pinScrypt')), attempt: failed + 1 }
      })
      if (claim.kind === 'none') {
        return { status: 404, body: { error: 'That member has not set a PIN on this site.' } }
      }
      if (claim.kind === 'locked') {
        return {
          status: 423,
          body: {
            error: 'Too many wrong PINs. Try again later, or ask a workspace admin to reset it.',
            lockedUntilMs: claim.lockedUntilMs,
          },
        }
      }
      if (!verifyMemberPassword(pin, claim.hash)) {
        const left = POS_PIN_MAX_ATTEMPTS - claim.attempt
        if (left <= 0) {
          await ref.update({ lockedUntilMs: now + POS_PIN_LOCKOUT_MS, failedAttempts: 0 })
          return {
            status: 423,
            body: {
              error: 'Too many wrong PINs. Try again later, or ask a workspace admin to reset it.',
              lockedUntilMs: now + POS_PIN_LOCKOUT_MS,
            },
          }
        }
        return {
          status: 401,
          body: { error: `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, attemptsLeft: left },
        }
      }
      await ref.update({ failedAttempts: 0, lockedUntilMs: null, lastUsedAtMs: now })
      // The PIN is right; whether it still buys anything is today's role.
      const host = await staff.hostRef.get()
      const role = (host.get('memberRoles') ?? {})[memberUid]
      const membership = await deps.membership(memberUid, staff.hostId)
      const allowed =
        purpose === 'manager' ? isPosManager(role, membership) : mayWorkRegister(role, membership)
      if (!allowed) {
        return {
          status: 403,
          body: {
            error:
              purpose === 'manager'
                ? 'Only a workspace admin can approve this.'
                : 'That member cannot use the register.',
          },
        }
      }
      let minted: { token: string; expiresAtMs: number }
      try {
        minted = mintPosAssertion(deps, {
          hostId: staff.hostId,
          registerId: register.ref.id,
          memberUid,
          purpose,
        })
      } catch {
        return { status: 501, body: { error: 'Staff PINs are not configured on this server.' } }
      }
      return {
        status: 200,
        body: {
          assertion: minted.token,
          expiresAtMs: minted.expiresAtMs,
          memberUid,
          name: await deps.memberName(memberUid),
          purpose,
        },
      }
    }

    case 'refresh': {
      const register = await readPosRegister(staff, body['registerId'])
      if ('error' in register) return { status: register.status, body: { error: register.error } }
      const expected = { hostId: staff.hostId, registerId: register.ref.id, purpose: 'cashier' as const }
      if (!readPosAssertion(deps, body['assertion'], expected)) {
        return { status: 401, body: { error: 'Enter your PIN again.' } }
      }
      const memberUid = await resolvePosStaffAssertion(deps, staff.hostRef, body['assertion'], expected)
      if (!memberUid) return { status: 403, body: { error: 'That member cannot use the register.' } }
      const minted = mintPosAssertion(deps, { ...expected, memberUid })
      return { status: 200, body: { assertion: minted.token, expiresAtMs: minted.expiresAtMs, memberUid } }
    }

    default:
      return { status: 400, body: { error: 'Unknown action' } }
  }
}

export function createPosStaffPinHandler(deps: () => PosOpsDeps = defaultPosOpsDeps): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosStaffPin(deps(), req)
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-staff-pin] failed', error)
      return res.status(500).json({ error: 'The PIN could not be checked' })
    }
  }
}

export const posStaffPinHandler = createPosStaffPinHandler()
