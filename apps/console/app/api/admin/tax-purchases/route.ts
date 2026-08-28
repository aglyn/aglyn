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
 * ITEM 3, TAXABLE PURCHASES — recorded per period, audited, never defaulted.
 *
 * The return computes every line but this one. Use tax on Aglyn's own
 * purchases is not in `platformRevenue`, so `taxReturnWebfileLines` prints
 * `not computed` and the filer hand-carries a figure into Webfile — with
 * nothing in the product recording what they entered or why. This route is
 * that record.
 *
 * Same posture as `/api/admin/tax-filing`, and for the same reason: any staff
 * may READ what was entered, only `super` may CHANGE it, and every change
 * lands with an `adminAudit` row carrying a before, an after and the reason
 * the operator typed. Both gates are enforced HERE rather than in the card —
 * a component that hides a button is a suggestion.
 *
 * ## What this route will not do
 *
 * **Return a zero for a period nobody has entered.** `entry` is `null` and the
 * return renders `not computed`. A route that answered `{ amountCents: 0 }`
 * for an unentered quarter would reintroduce, through a storage layer, exactly
 * the false claim the `not computed` line exists to refuse — and it would be
 * worse than the gap, because a zero arriving from storage looks derived.
 *
 * **Answer for a period other than the one asked for.** The period is the
 * document id, so there is no code path that could.
 *
 * ## Why the audit row carries the figure, where the filing config's does not
 *
 * `adminAudit` is readable by any staff role, so the filing route records that
 * a registration identifier changed and never what it changed to — it is a
 * credential. A purchase total is the opposite: it is a figure destined for a
 * public filing, and recording that "Item 3 changed" without the before and
 * after would keep the event and lose the only thing anyone comes back for.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  TAXABLE_PURCHASES_NOTE_MAX,
  taxablePurchasesAuditShape,
  taxablePurchasesPeriodKey,
  taxablePurchasesWrite,
  validateTaxablePurchases,
} from '../../../../utils/taxable-purchases'
import {
  TAXABLE_PURCHASES_COLLECTION,
  readTaxablePurchases,
  taxablePurchasesTarget,
} from '../../../../utils/server/taxable-purchases-store'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const actorRole = String(decoded['staffRole'] ?? 'support')

    // The period comes from the query string on a GET and the body on a write,
    // and is validated the same way on both: an unparseable period is refused
    // rather than coerced to a document id nothing would ever read back.
    const requested =
      method === 'GET'
        ? new URL(request.url).searchParams.get('period')
        : body?.period
    const period = taxablePurchasesPeriodKey(requested)
    if (!period) {
      return Response.json(
        { error: 'period must be YYYY-Q[1-4] or YYYY-MM' },
        { status: 400 },
      )
    }

    if (method === 'GET') {
      return Response.json(
        {
          role: actorRole,
          period,
          // `null` for a period nobody has entered. See the module note.
          entry: await readTaxablePurchases(period),
          limits: { noteMax: TAXABLE_PURCHASES_NOTE_MAX },
        },
        { status: 200 },
      )
    }

    // Reading is open to any staff role — a support reader answers "what did
    // we file for Item 3 last quarter" without a write. Entering the figure is
    // `super`, the same bar as where the platform files: this number goes onto
    // a return signed under penalty of perjury.
    if (actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }

    const note = String(body?.note ?? '').trim().slice(0, TAXABLE_PURCHASES_NOTE_MAX)
    const document = firebaseAdmin
      .app()
      .firestore()
      .collection(TAXABLE_PURCHASES_COLLECTION)
      .doc(period)
    const before = await readTaxablePurchases(period)

    if (method === 'DELETE') {
      if (!note) {
        return Response.json(
          { error: 'A reason is required — it is written to the audit log' },
          { status: 400 },
        )
      }
      await document.delete()
      // Back to `not computed`, which is where an unentered period starts and
      // the only honest state for a figure nobody stands behind any more.
      await firebaseAdmin
        .app()
        .firestore()
        .collection('adminAudit')
        .add({
          actorUid: decoded.uid,
          action: 'taxablePurchases.clear',
          target: taxablePurchasesTarget(period),
          period,
          before: taxablePurchasesAuditShape(before),
          after: taxablePurchasesAuditShape(null),
          note,
          at: FieldValue.serverTimestamp(),
        })
      return Response.json({ ok: true, period, entry: null }, { status: 200 })
    }

    const proposal = validateTaxablePurchases({
      period,
      amount: body?.amount,
      note,
    })
    if (proposal.error || !proposal.value) {
      return Response.json(
        { error: proposal.error ?? 'Invalid taxable purchases entry' },
        { status: 400 },
      )
    }

    await document.set(
      taxablePurchasesWrite({
        ...proposal.value,
        actorEmail: decoded.email ?? null,
      }),
      // The record IS the whole entry — a figure, when, by whom and why. A
      // merge would let a later write keep a previous quarter's reason beside
      // a new figure, which is the pairing the audit row exists to make
      // unambiguous.
      { merge: false },
    )
    const after = await readTaxablePurchases(period)
    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'taxablePurchases.update',
        target: taxablePurchasesTarget(period),
        period,
        before: taxablePurchasesAuditShape(before),
        after: taxablePurchasesAuditShape(after),
        note: proposal.value.note,
        at: FieldValue.serverTimestamp(),
      })

    return Response.json({ ok: true, period, entry: after }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    // Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/tax-purchases]', error)
    return Response.json(
      { error: 'Taxable purchases operation failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT, handler as DELETE }
