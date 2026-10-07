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

import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { setAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { FieldValue } from 'firebase-admin/firestore'
import { freeAssistAccount } from '../usage/assist-free-taste'
import { assistUsageMonth } from '../usage/assist-usage'
import {
  accountCreditMeter,
  isAssistCreditReturnKey,
  returnAssistCredits,
  workspaceCreditMeter,
  type AssistCreditMeterTarget,
} from '../usage/assist-credit-returns-write'

/**
 * STAFF GIVE AI CREDITS BACK (AGL-3595) — compensation for a fault of ours.
 *
 * A planner bug refused a Free workspace's plan after it had spent 227 of
 * its 300 monthly credits, and the person could not try again until the
 * month rolled. This is the control that undoes that: staff return credits
 * to the meter they were drawn from, with a reason, and the person's next
 * request is admitted against the reduced figure.
 *
 * POST `{ orgId | uid, action, meter, credits?, reason, jobId?, idempotencyKey }`
 *
 *   action  `give`   return `credits` to each named meter
 *           `reset`  return everything each meter used this month
 *   meter   `workspace`  the workspace's band          (needs `orgId`)
 *           `account`    a Free owner's allowance      (`orgId` of a Free
 *                        workspace, or the account's `uid`)
 *           `both`       the two together, for a Free workspace
 *
 * ## The gate
 *
 * The staff claim, and then the `super` or `billing` staff role — the bar
 * `/api/admin/org-override` holds for a quota write, because a give-back is
 * one: it hands out credits that are worth money. A missing role is
 * `support`, and refused (AGL-495).
 *
 * ## What it writes
 *
 * An adjustment, never an edit: `returnAssistCredits` adds to the month's
 * `returnedUsd` and keeps the act under `creditReturns.{key}`, and one
 * `adminAudit` row commits in the same transaction. A repeated key writes
 * nothing and answers `duplicate`, so a double-click returns once.
 */

/** The longest a staff reason may be, so a paste cannot fill the document. */
const REASON_MAX = 500

/** The staff roles that may give credits back. */
export const AI_CREDIT_RETURN_ROLES = ['super', 'billing'] as const

type Meter = 'workspace' | 'account' | 'both'

const refuse = (error: string, status: number, code?: string, extra = {}) =>
  Response.json({ error, ...(code ? { code } : {}), ...extra }, { status })

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return refuse('Method not allowed', 405)
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse('Unauthenticated', 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return refuse('Staff only', 403)
    const role = String(decoded['staffRole'] ?? 'support')
    if (!(AI_CREDIT_RETURN_ROLES as readonly string[]).includes(role)) {
      return refuse('Requires the billing or super staff role', 403, 'role')
    }

    const orgId = String(body?.orgId ?? '').trim()
    const uid = String(body?.uid ?? '').trim()
    const action = String(body?.action ?? '')
    const meter = String(body?.meter ?? '') as Meter
    if (!orgId && !uid) return refuse('Name an organization or an account', 400)
    if (action !== 'give' && action !== 'reset') return refuse('Bad action', 400)
    if (!['workspace', 'account', 'both'].includes(meter)) {
      return refuse('Bad meter', 400)
    }
    // Refused before anything is read: the reason is the audit row's whole
    // value, and a row written without one cannot be corrected later.
    const reason = String(body?.reason ?? '').trim().slice(0, REASON_MAX)
    if (!reason) {
      return refuse('Say why the credits are being given back', 400, 'reason_required')
    }
    const key = body?.idempotencyKey
    if (!isAssistCreditReturnKey(key)) {
      return refuse('Missing idempotency key', 400, 'idempotency_key')
    }
    const credits = Number(body?.credits)
    if (action === 'give' && !(Number.isInteger(credits) && credits > 0)) {
      return refuse('Give back a positive whole number of credits', 400, 'invalid_credits')
    }
    const jobId = String(body?.jobId ?? '').trim().slice(0, 200) || null

    const firestore = firebaseAdmin.app().firestore()
    const month = assistUsageMonth(new Date())
    const targets: AssistCreditMeterTarget[] = []
    let accountUid: string | null = null

    if (orgId) {
      const orgRef = firestore.collection('orgs').doc(orgId)
      const [orgSnap, billingSnap] = await Promise.all([
        orgRef.get(),
        orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID).get(),
      ])
      if (!orgSnap.exists) return refuse('No such organization', 404)
      // Org doc first, billing mirror over it — the merge the staff card
      // reads, so a workspace whose subscription died resolves as Free here
      // exactly as it does at the gate.
      const org = {
        ...(orgSnap.data() ?? {}),
        ...(billingSnap.exists ? billingSnap.data() : {}),
      }
      if (meter !== 'account') targets.push(workspaceCreditMeter(firestore, orgId, month))
      if (meter !== 'workspace') {
        accountUid = freeAssistAccount(org as never)?.accountUid ?? null
        if (!accountUid) {
          return refuse(
            'Only a Free workspace with an owner draws on an account allowance',
            409,
            'no_account_allowance',
          )
        }
        targets.push(accountCreditMeter(firestore, accountUid, month))
      }
    } else {
      // From the staff user page: the account's own allowance, nothing else.
      if (meter !== 'account') {
        return refuse('An account has only its allowance to give back to', 400)
      }
      accountUid = uid
      targets.push(accountCreditMeter(firestore, uid, month))
    }

    const outcome = await returnAssistCredits(
      firestore,
      {
        month,
        meters: targets,
        credits: action === 'reset' ? 'all' : credits,
        key,
        reason,
        actorUid: decoded.uid,
        source: 'staff',
        jobId,
      },
      (tx, lines) => {
        const returned = lines.filter((line) => line.credits > 0)
        setAdminAudit(tx, firestore, {
          actorUid: decoded.uid,
          action: action === 'reset' ? 'ai.credits.reset' : 'ai.credits.giveBack',
          target: returned[0]?.path ?? targets[0]!.ref.path,
          ...(accountUid ? { subjectUid: accountUid } : {}),
          note:
            `${reason} — ` +
            returned.map((line) => `${line.credits} credits to the ${line.meter}`).join(', ') +
            (jobId ? ` (job ${jobId})` : ''),
          after: {
            orgId: orgId || null,
            accountUid,
            month,
            jobId,
            idempotencyKey: key,
            meters: returned.map((line) => ({
              meter: line.meter,
              path: line.path,
              credits: line.credits,
              usedBefore: line.usedBefore,
            })),
          },
          at: FieldValue.serverTimestamp(),
        })
      },
    )

    if (outcome.status === 'over') {
      return refuse(
        'That is more than this month used: ' +
          outcome.lines.map((line) => `${line.usedBefore} on the ${line.meter}`).join(', '),
        409,
        'over_return',
        { lines: outcome.lines },
      )
    }
    if (outcome.status === 'nothing') {
      return refuse('Nothing used this month to give back', 409, 'nothing_used', {
        lines: outcome.lines,
      })
    }
    return Response.json(
      { month, duplicate: outcome.status === 'duplicate', lines: outcome.lines },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/admin/credits]', error)
    return refuse('Giving credits back failed', 500)
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
