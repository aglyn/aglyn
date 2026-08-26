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
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { createHash, randomUUID } from 'crypto'
import { normalizeRefundReason } from '../../../../constants/refund-reasons'
import {
  checkRefundAuthority,
  refundAuthorityForRole,
  refundCapCentsForRole,
  refundWindowCapCentsForRole,
  STAFF_REFUND_CAP_CENTS,
} from '../../../../constants/refund-authority'
import {
  readRefundWindowUsage,
  releaseRefundWindow,
  reserveRefundWindow,
} from '../../../../utils/server/staff-refund-ledger'

/**
 * Staff subscription refunds from the org page (AGL-2486).
 *
 *   GET  ?orgId=…              → the org's refundable charges
 *   POST { orgId, chargeId, amountCents?, reason, note?, idempotencyKey }
 *
 * Until now the only way to refund an Aglyn subscription was the Stripe
 * dashboard, so the only record of one was Stripe's: an actor, an amount, and
 * nothing about why. Every other money-adjacent staff action on the org page
 * — the plan override, the discount, suspension — writes `adminAudit` with a
 * reason. A refund is the largest of them and wrote nothing.
 *
 * ## Why this is not the marketplace refund path
 *
 * `libs/plugins/commerce/src/lib/server/refund.ts` refunds an ORDER on a
 * MERCHANT's connected account: a destination charge, refunded through
 * `payment_intent` with `reverse_transfer` and `refund_application_fee` so
 * the transfer to the merchant and Aglyn's platform fee unwind
 * proportionally. Its ledger is the order document, so it needs a
 * transactional `refundedCents` reservation to stop two partials summing past
 * what was captured.
 *
 * A subscription refund is a charge Aglyn made on ITS OWN account. There is
 * no connected account to reverse and no application fee to return — sending
 * either parameter is an error, not a no-op — and the ledger is Stripe's own
 * `amount_refunded`, which Stripe caps server-side. So the two controls the
 * commerce path is careful to keep separate resolve differently here:
 *
 *  - DUPLICATE submits (a lost response, a double click) are stopped by the
 *    idempotency claim, minted per attempt by the client. Same primitive,
 *    same `apiIdempotency` collection, same atomic `create()` — a read-then-
 *    write would race exactly the double-submit it exists to stop.
 *  - OVER-refunds are stopped by Stripe, inside the same request that moves
 *    the money. A local counter would be a second, laggier copy of a number
 *    Stripe already holds authoritatively, and a guard that reads a copy is
 *    the shape the commerce path's original bug had.
 *
 * The disciplines that DO carry over are copied on purpose: refuse a disputed
 * charge before anything is claimed, map Stripe's dispute codes to a 409 an
 * operator can act on rather than a raw 502, and never invent a refund the
 * customer's own charge does not back.
 *
 * ## Who may issue one
 *
 * Not `super`-only any more (AGL-2486). Support may refund up to a cap and
 * escalates above it — the call, on the grounds that the person a customer
 * actually reaches is support, and making them escalate a $12 refund means
 * the customer waits on one person's availability. He declined a second
 * approver, so the cap IS the control and there are two of them: per refund,
 * and a rolling 24-hour per-actor ceiling that stops the first being defeated
 * by splitting one large refund into several small ones. See
 * `constants/refund-authority.ts` for the numbers and the reasoning.
 *
 * Both are evaluated HERE, before Stripe is touched — the console disables
 * the button and states the allowance up front, but that is so an operator is
 * never refused after filling in a form, not the boundary itself.
 *
 * ## The fee is not returned
 *
 * Stripe keeps its processing fee on a refunded charge. The Pricing Decision
 * Log records this as settled — refunds and disputes remain a loss and always
 * were — so the GET returns the ACTUAL fee Stripe took on each charge rather
 * than a sentence about fees in general, and the console shows it beside the
 * amount before anyone presses the button.
 */

async function stripe(
  secretKey: string,
  path: string,
  params?: Record<string, string>,
  idempotencyKey?: string | null,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

/**
 * One row in the refundable list.
 *
 * `feeCents` is what Stripe kept on the original charge and does NOT return.
 * Read from the expanded balance transaction rather than estimated from a
 * rate card: the rate varies by card, currency and country, and a number an
 * operator can reconcile against the Stripe dashboard is worth more than a
 * plausible one they cannot.
 */
function describeCharge(charge: any) {
  const invoice = charge?.invoice
  return {
    id: String(charge?.id ?? ''),
    amountCents: Number(charge?.amount ?? 0),
    refundedCents: Number(charge?.amount_refunded ?? 0),
    currency: String(charge?.currency ?? 'usd'),
    created: charge?.created
      ? new Date(Number(charge.created) * 1000).toISOString()
      : null,
    description: charge?.description ?? null,
    invoiceId: typeof invoice === 'string' ? invoice : (invoice?.id ?? null),
    invoiceNumber:
      invoice && typeof invoice === 'object' ? (invoice.number ?? null) : null,
    // Stripe's own words for the state, so the console never has to infer
    // "can this be refunded" from a combination of booleans.
    disputed: charge?.disputed === true,
    // A charge in `pending`/`failed` has nothing to return.
    paid: charge?.paid === true && charge?.status === 'succeeded',
    feeCents: Number(charge?.balance_transaction?.fee ?? 0),
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    // 501, not 500: "payments are not wired up here" is a different fact from
    // "the refund failed", and only one of them is worth retrying.
    return Response.json({ error: 'Stripe is not configured' }, { status: 501 })
  }

  const orgId = String(
    (method === 'GET' ? (query as any)?.orgId : body?.orgId) ?? '',
  )
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    // Fails closed to the least-privileged role like every other staff route
    // (AGL-495): a token with no `staffRole` claim is `support`, i.e. capped.
    const actorRole = String(decoded['staffRole'] ?? 'support')
    // AGL-1028: the customer id lives at `orgs/{orgId}/billing/stripe`, with
    // the org doc as the fallback the backfill has not reached.
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId as
      | string
      | undefined

    if (method === 'GET') {
      // The caller's own allowance, reported alongside the charges so the
      // card can state the boundary BEFORE an amount is typed. `windowCents`
      // is null when the ledger could not be read — rendered as "could not
      // read your remaining allowance", never as a full one, because a
      // fabricated ceiling is worse than none shown.
      const usage =
        refundAuthorityForRole(actorRole) === 'super'
          ? { cents: 0, count: 0 }
          : await readRefundWindowUsage(firestore, decoded.uid)
      const authority = {
        role: actorRole,
        authority: refundAuthorityForRole(actorRole),
        perRefundCapCents: refundCapCentsForRole(actorRole),
        windowCapCents: refundWindowCapCentsForRole(actorRole),
        windowCents: usage ? usage.cents : null,
        windowCount: usage ? usage.count : null,
      }
      if (!customerId) {
        // Distinct from a failed lookup (AGL-940). The console has to be able
        // to say "never subscribed" rather than showing an empty list that
        // could equally mean Stripe was unreachable.
        return Response.json(
          { charges: [], hasCustomer: false, authority },
          { status: 200 },
        )
      }
      const res = await stripe(
        secretKey,
        `charges?customer=${encodeURIComponent(customerId)}&limit=24` +
          '&expand[]=data.balance_transaction&expand[]=data.invoice',
      )
      if (!res.ok) {
        const detail = res.body?.error?.message ?? 'Stripe lookup failed'
        console.error('Stripe charge lookup failed', { orgId, detail })
        // Surfaced, never swallowed into an empty list — AGL-940's lesson,
        // and it matters more here: "no refundable charges" would send an
        // operator to the Stripe dashboard believing there was nothing to
        // refund.
        return Response.json(
          { charges: [], hasCustomer: true, stripeError: detail, authority },
          { status: 200 },
        )
      }
      const charges = Array.isArray(res.body?.data)
        ? res.body.data.map(describeCharge)
        : []
      return Response.json(
        { charges, hasCustomer: true, authority },
        { status: 200 },
      )
    }

    // POST: move money. Any staff role may reach here now; HOW MUCH they may
    // move is decided below, after the amount is known — see the two-cap
    // block before the Stripe call.
    const reason = normalizeRefundReason(body?.reason, body?.note)
    if (!reason) {
      // Refused BEFORE anything is claimed or charged. The reason is the
      // audit row's whole value, and a row written after the money moved
      // cannot be back-filled honestly.
      return Response.json(
        {
          error:
            'Pick a reason for the refund. "Other" also needs a note saying ' +
            'what — the audit row is append-only and cannot be corrected later.',
        },
        { status: 400 },
      )
    }

    const chargeId = String(body?.chargeId ?? '')
    if (!chargeId) {
      return Response.json({ error: 'Missing chargeId' }, { status: 400 })
    }
    if (!customerId) {
      return Response.json(
        { error: 'This organization has no Stripe customer to refund' },
        { status: 409 },
      )
    }

    const chargeRes = await stripe(
      secretKey,
      `charges/${encodeURIComponent(chargeId)}?expand[]=balance_transaction&expand[]=invoice`,
    )
    if (!chargeRes.ok) {
      return Response.json(
        { error: chargeRes.body?.error?.message ?? 'No such charge' },
        { status: 404 },
      )
    }
    const charge = chargeRes.body
    const chargeCustomer =
      typeof charge?.customer === 'string'
        ? charge.customer
        : (charge?.customer?.id ?? '')
    // The org page names the org; the request names a charge. Nothing else
    // ties the two together, so this is what stops a charge id from another
    // customer — pasted, stale, or crafted — being refunded through this
    // org's page and audited against the wrong organization.
    if (chargeCustomer !== customerId) {
      return Response.json(
        { error: 'That charge does not belong to this organization' },
        { status: 409 },
      )
    }
    if (charge?.disputed === true) {
      // The commerce path's AGL-1809 reasoning, and it holds identically
      // here: while a chargeback is open the bank has already pulled the
      // funds, Stripe refuses the charge, and a refund that did land would
      // pay the customer twice — losing the refund AND the dispute plus its
      // fee. Refused before the claim so nothing is stranded.
      return Response.json(
        {
          error:
            'This charge is disputed. Respond to or accept the dispute in ' +
            'Stripe first; refund any remainder once it settles.',
        },
        { status: 409 },
      )
    }
    const capturedCents = Number(charge?.amount ?? 0)
    const alreadyRefundedCents = Number(charge?.amount_refunded ?? 0)
    const remainingCents = Math.max(0, capturedCents - alreadyRefundedCents)
    if (remainingCents <= 0) {
      return Response.json(
        { error: 'Nothing left to refund on this charge' },
        { status: 409 },
      )
    }
    // `0` is a legitimate number and `strictNullChecks` is off, so absence is
    // tested for explicitly rather than by falsiness: `amountCents: 0` must
    // be a rejected amount, not a silent "refund everything".
    const askedRaw = body?.amountCents
    const asked =
      askedRaw == null ? remainingCents : Math.round(Number(askedRaw))
    if (!Number.isFinite(asked) || asked <= 0) {
      return Response.json({ error: 'Refund amount must be positive' }, { status: 400 })
    }
    if (asked > remainingCents) {
      return Response.json(
        {
          error:
            `Only $${(remainingCents / 100).toFixed(2)} is left to refund on ` +
            'this charge.',
        },
        { status: 409 },
      )
    }

    // ── THE CAP, PART ONE: this refund's own size ────────────────────────
    // Checked here, before anything is claimed or reserved, because it needs
    // no store read and refusing it must leave the attempt perfectly
    // retryable — an operator who mistyped an amount should be able to
    // correct it and submit again, not be told their key is in use.
    const sizeVerdict = checkRefundAuthority({
      role: actorRole,
      amountCents: asked,
      windowCents: 0,
    })
    if (!sizeVerdict.allowed) {
      return Response.json({ error: sizeVerdict.error }, { status: 403 })
    }

    // Point of no return: everything past here moves money. Same primitive as
    // the commerce path — an atomic `create()`, whose rejection on an
    // existing document IS the dedupe — in the same `apiIdempotency`
    // collection, so `eraseOrgIdempotencyKeys` (AGL-1448) already sweeps
    // these on org erasure with no change there.
    const attemptKey = String(body?.idempotencyKey ?? '')
    const claimRef = attemptKey
      ? firestore
          .collection('apiIdempotency')
          .doc(
            createHash('sha256')
              // Scoped by the CHARGE, so one key reused across two charges
              // cannot dedupe two legitimately distinct refunds. Not by the
              // amount: two $10 partials on a $50 charge are two real
              // refunds, and folding the amount in would swallow the second.
              .update(`org-refund:${orgId}:${chargeId}:${attemptKey}`)
              .digest('hex'),
          )
      : null
    if (claimRef) {
      const prior = await claimRef.get()
      const priorResponse = prior.get('response')
      if (priorResponse) {
        // Replayed ahead of every other check: a retried refund answered
        // "nothing left to refund" is the right money outcome reported as a
        // failure, and an operator who reads it as a failure refunds by hand.
        return Response.json(priorResponse, {
          status: Number(prior.get('responseStatus') ?? 200),
        })
      }
      try {
        await claimRef.create({
          orgId,
          chargeId,
          kind: 'admin-subscription-refund',
          status: 'pending',
          actorUid: decoded.uid,
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          createdAtMs: Date.now(),
        })
      } catch {
        return Response.json(
          {
            error:
              'That refund is already being processed. Reload the page to ' +
              'see where it landed rather than sending it again.',
          },
          { status: 409 },
        )
      }
    }

    // ── THE CAP, PART TWO: this actor's rolling 24 hours ─────────────────
    // AFTER the claim, so a double-click cannot reserve twice; BEFORE Stripe,
    // because a ceiling checked after the money moved is a report, not a cap.
    // The check and the increment are one transaction: two refunds submitted
    // together would otherwise each read the same prior total, each find room
    // and each proceed, which is the read-then-write race that lets a
    // create-time quota be laundered.
    const windowEntryId = randomUUID()
    let reservation: Awaited<ReturnType<typeof reserveRefundWindow>>
    try {
      reservation = await reserveRefundWindow(firestore, {
        actorUid: decoded.uid,
        role: actorRole,
        amountCents: asked,
        entryId: windowEntryId,
      })
    } catch (error) {
      // FAILS CLOSED. Zach declined a second approver, so this cap is the
      // only control on the largest staff action there is; a store outage
      // that silently lifted it would be an unbounded window nobody could
      // see. One escalation is the cost of being wrong this way.
      console.error('Refund ceiling unreadable', { orgId, chargeId }, error)
      await claimRef?.delete().catch(() => undefined)
      return Response.json(
        {
          error:
            'Could not read your 24-hour refund ceiling, so this refund was ' +
            'not issued. Nothing was charged or refunded. Retry shortly, or ' +
            'ask someone with the super staff role.',
        },
        { status: 503 },
      )
    }
    if (!reservation.verdict.allowed) {
      // Released, not burned: no money moved, so the same attempt key must
      // stay usable once the window has room again.
      await claimRef?.delete().catch(() => undefined)
      return Response.json(
        { error: reservation.verdict.error },
        { status: 403 },
      )
    }

    const refundRes = await stripe(
      secretKey,
      'refunds',
      {
        charge: chargeId,
        amount: String(asked),
        // NO `reverse_transfer` / `refund_application_fee`: this is a
        // platform charge, not a destination charge, and Stripe errors on
        // both here. See the header comment.
        'metadata[aglyn_org_id]': orgId,
        'metadata[aglyn_actor_uid]': String(decoded.uid),
        'metadata[aglyn_reason]': reason.reason,
      },
      attemptKey || null,
    )
    if (!refundRes.ok) {
      const code = String(refundRes.body?.error?.code ?? '')
      // The claim is released, not burned: Stripe said no, so we KNOW no
      // money moved and the same attempt must remain retryable. The window
      // reservation goes back for the same reason — a refund Stripe refused
      // must not spend the operator's daily ceiling.
      await claimRef?.delete().catch(() => undefined)
      await releaseRefundWindow(firestore, decoded.uid, windowEntryId)
      if (code === 'charge_disputed' || code === 'refund_disputed_payment') {
        return Response.json(
          {
            error:
              'Stripe refused this refund because the charge is disputed. ' +
              'Handle the dispute in Stripe, then refund any remainder.',
          },
          { status: 409 },
        )
      }
      console.error('Stripe refund failed', { orgId, chargeId, code })
      return Response.json(
        { error: refundRes.body?.error?.message ?? 'Refund failed' },
        { status: 502 },
      )
    }

    const refund = refundRes.body
    const result = {
      ok: true,
      refundId: String(refund?.id ?? ''),
      amountCents: Number(refund?.amount ?? asked),
      currency: String(refund?.currency ?? charge?.currency ?? 'usd'),
      chargeId,
      // What Stripe kept and is not giving back — echoed so the success
      // message can restate the real cost of the refund rather than the
      // amount alone.
      feeRetainedCents: Number(charge?.balance_transaction?.fee ?? 0),
    }

    // Audited like every other staff action on this page (AGL-42/AGL-1652),
    // and after the money — an audit row for a refund that Stripe refused
    // would be a record of something that never happened. A failure to write
    // it cannot un-refund anything, so it is logged and swallowed rather than
    // reported as a failed refund.
    await firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'org.refund',
        target: `orgs/${orgId}`,
        before: {
          chargeId,
          capturedCents,
          refundedCents: alreadyRefundedCents,
        },
        after: {
          chargeId,
          refundId: result.refundId,
          amountCents: result.amountCents,
          currency: result.currency,
          refundedCents: alreadyRefundedCents + result.amountCents,
          // The fee Stripe keeps regardless — recorded so a later margin or
          // churn review reads the true cost off the row instead of
          // re-deriving it from Stripe months later.
          feeRetainedCents: result.feeRetainedCents,
          invoiceId:
            typeof charge?.invoice === 'string'
              ? charge.invoice
              : (charge?.invoice?.id ?? null),
        },
        reason: reason.reason,
        note: reason.note,
        // WHICH AUTHORITY MOVED THE MONEY (AGL-2486). Support may refund up
        // to a cap and `super` may refund anything, so "a staff member issued
        // a refund" is no longer one fact. Three fields rather than one,
        // because they answer three different questions after the fact:
        //
        //   actorRole — who they were at the time. The claim can change;
        //     the row must not be re-derived from today's claim.
        //   authority — `capped` or `super`. Which rule admitted it.
        //   overCap   — whether the AMOUNT was one only `super` could have
        //     issued. This is the one that distinguishes an escalated refund
        //     from a routine one: a `super` refunding $12 is routine, and
        //     `authority` alone cannot say so. Query it to read every refund
        //     that needed the escalation, which is the review nobody can run
        //     against Stripe's own record.
        actorRole,
        authority: reservation.verdict.authority,
        overCap: reservation.verdict.overCap,
        // The threshold IN FORCE when the row was written, so raising the cap
        // later does not silently reinterpret the history (AGL-2113's lesson
        // about thresholds drifting away from the readouts that quote them).
        capCentsAtTime: STAFF_REFUND_CAP_CENTS,
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      .catch((error: unknown) => {
        console.error('Refund audit write failed', { orgId, chargeId }, error)
      })

    await claimRef
      ?.set(
        { status: 'settled', responseStatus: 200, response: result },
        { merge: true },
      )
      .catch(() => undefined)

    return Response.json(result, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/org-refund]', error)
    return Response.json({ error: 'Refund operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
