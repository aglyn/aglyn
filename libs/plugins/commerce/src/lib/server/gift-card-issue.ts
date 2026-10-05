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

import * as Aglyn from '@aglyn/aglyn/server'
import { randomBytes } from 'crypto'
import {
  hostSendingIdentity,
  logHostActivity,
  meterHostEmail,
  renderHostEmailWithTokens,
} from '@aglyn/tenant-data-admin'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  GIFT_CARD_ISSUE_MAX_CENTS,
  giftCardAmountProblem,
  giftCardCodeProblem,
} from '../model/commerce-gift-cards'
import { giftCardSearchTokens } from '../model/gift-card-search'

/*
 * ISSUING A GIFT CARD (AGL-2226, AGL-3551): the one path a card comes into
 * being by a merchant's hand — the Gift cards card's Issue, one card at a
 * time, and the gift card import, one card per row. A sale's cards are
 * minted by the billing webhook from the order.
 *
 * What issuing is, wherever it is asked from:
 *
 * - the amount is above zero and at most {@link GIFT_CARD_ISSUE_MAX_CENTS};
 * - the code is minted, or a code the merchant brings (an import carries
 *   the codes shoppers already hold) — and a code another card holds is
 *   refused, never overwritten: the document is CREATED, so two issues of
 *   one code cannot both land;
 * - the card records who issued it (`issuedBy`) and for how much
 *   (`initialCents`), and the site's activity log gets a line naming it;
 * - the recipient is emailed the code only when asked, and the answer says
 *   whether the email actually went.
 */

/** A refusal the person can act on, with the status a route answers it with. */
export class GiftCardIssueRefusal extends Error {
  constructor(
    readonly status: number,
    readonly reason: 'amount' | 'code' | 'taken',
    message: string,
  ) {
    super(message)
    this.name = 'GiftCardIssueRefusal'
  }
}

/** `GC-` + 12 uppercase hex, the shape `billing-webhook.ts` also mints. */
export function mintGiftCardCode(): string {
  return `GC-${randomBytes(6).toString('hex').toUpperCase()}`
}

/** Where an imported card came from, so a retried row finds the card it already issued. */
export interface GiftCardIssueSource {
  importJobId: string
  importRow: number
}

export interface IssueGiftCardInput {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  amountCents: number
  recipientEmail?: string | null
  note?: string | null
  /** A code the merchant brings; one is minted when absent. */
  code?: string | null
  /** Who issued it, for the card and the activity line. */
  issuer: { uid: string; email?: string | null }
  /** Email the recipient their code (when there is a recipient and mail is set up). */
  email: boolean
  /** The workspace that owns the site, for the email's sender name. */
  ownerOrg?: unknown
  source?: GiftCardIssueSource
}

/** What the activity log names a card by: never the whole code, which spends it. */
export function giftCardActivityName(code: string): string {
  return `Gift card ending ${code.slice(-4)}`
}

/** The activity target a card is filed under (`pluginId:noun`, AGL-2978). */
export const GIFT_CARD_ACTIVITY_TYPE = 'commerce:giftCard' as const

const alreadyExists = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'
}

/** Issues one card. Throws {@link GiftCardIssueRefusal} for what the person can fix. */
export async function issueGiftCard(input: IssueGiftCardInput): Promise<{ code: string; emailed: boolean }> {
  const { firestore, hostId } = input
  const amountCents = Math.round(Number(input.amountCents))
  const amountProblem = giftCardAmountProblem(amountCents)
  if (amountProblem) throw new GiftCardIssueRefusal(400, 'amount', amountProblem)
  const brought = input.code ?? null
  if (brought) {
    const codeProblem = giftCardCodeProblem(brought)
    if (codeProblem) throw new GiftCardIssueRefusal(400, 'code', codeProblem)
  }
  const code = brought ?? mintGiftCardCode()
  const recipientEmail = String(input.recipientEmail ?? '').trim().slice(0, 200)
  const note = String(input.note ?? '').trim().slice(0, 200)
  try {
    await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('giftCards')
      .doc(code)
      .create({
        initialCents: amountCents,
        balanceCents: amountCents,
        recipientEmail: recipientEmail || null,
        // Null rather than absent: the field is what tells a reader whether a
        // card came from a sale or from the console, and `undefined` would
        // make an issued-by-hand card indistinguishable from a legacy row.
        orderId: null,
        issuedBy: input.issuer.uid,
        ...(note ? { note } : {}),
        ...(input.source ? { importJobId: input.source.importJobId, importRow: input.source.importRow } : {}),
        // What the console's Gift cards search asks (AGL-3321).
        searchTokens: giftCardSearchTokens(code, recipientEmail || null),
        createdAtMs: Date.now(),
      })
  } catch (error) {
    if (alreadyExists(error)) {
      throw new GiftCardIssueRefusal(409, 'taken', `A gift card with the code ${code} already exists.`)
    }
    throw error
  }

  await logHostActivity(
    hostId,
    { uid: input.issuer.uid, email: input.issuer.email ?? null },
    input.source ? 'Issued gift card from an import' : 'Issued gift card',
    { type: GIFT_CARD_ACTIVITY_TYPE, id: code, name: giftCardActivityName(code) },
  )

  let emailed = false
  if (input.email && recipientEmail && isEmailConfigured()) {
    const value = `$${(amountCents / 100).toFixed(2)}`
    // The same site-designed template the purchase path uses (AGL-771), so
    // a hand-issued card arrives looking like a bought one — with the
    // merchant's note (AGL-3432). A card sent by hand often goes to someone
    // who has never visited the site, and the note is the only part of the
    // message the merchant wrote.
    const designed = await renderHostEmailWithTokens(firestore, hostId, 'gift-card', {
      'giftcard.code': code,
      'giftcard.value': value,
      'giftcard.note': note,
    })
    const sent = await sendEmail({
      to: recipientEmail,
      subject: designed?.subject ?? 'Your gift card',
      text:
        designed?.text ||
        (note ? `${note}\n\n` : '') +
          `Gift card code: ${code}\nValue: ${value}\n\n` +
          'Enter it at checkout to apply the balance.',
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: Aglyn.resolveBrandingProfile(input.ownerOrg as never).fromName,
      sendingIdentity: await hostSendingIdentity(hostId),
      audience: 'tenant',
      context: 'gift card',
      // Owed to the recipient by their own order: the phishing
      // screen's soft rules never hold it (AGL-3356).
      owedFor: 'order',
    })
      .then(() => true)
      .catch(() => false)
    if (sent) {
      // Cost meter (AGL-1438). Transactional: the card has already been
      // minted and the recipient is owed the code, so a quota may count
      // this send but never refuse it. Metered on the SUCCESS path only,
      // matching every other sender — a send the provider rejected costs
      // nothing, and a meter that counted it would inflate the COGS figure
      // exactly when mail was broken.
      await meterHostEmail(hostId)
    }
    // The truth, not the intent: the console shows this back to whoever
    // issued the card, and reporting a delivered email for a send that
    // threw is how a customer ends up waiting for a code that is not
    // coming.
    emailed = sent
  }
  return { code, emailed }
}
