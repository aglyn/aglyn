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
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { hostSendingIdentity, meterHostEmail, renderHostEmailWithTokens } from '@aglyn/tenant-data-admin'
import { LOYALTY_EMAIL_KEYS } from '../constants/bundle-common'
import { formatLoyaltyCents, formatPoints, pointsValueCents } from '../model/loyalty-math'
import type { StoredLoyaltyMember } from '../model/loyalty-member'
import type { LoyaltyProgram } from '../model/loyalty-program'
import { loyaltyDb } from './db'

/**
 * The emails a store sends its members (AGL-3640), each a catalog key in
 * `tenant-emails.ts` — designed in the Besigner like the store's receipts, in
 * the site's theme — with a plain-text fallback for a store that never
 * designed one. They are about the member's own balance and are owed by their
 * own order or by the store, so they are TRANSACTIONAL and on by default; the
 * program's `emails` switch turns all three off.
 *
 * A send never fails the movement it reports: the points are already theirs.
 */

export interface LoyaltyEmail {
  hostId: string
  org: Record<string, unknown> | null
  to: string
  key: (typeof LOYALTY_EMAIL_KEYS)[keyof typeof LOYALTY_EMAIL_KEYS]
  tokens: Record<string, string>
  fallback: { subject: string; text: string }
}

type Sender = (email: LoyaltyEmail) => Promise<boolean>

let senderOverride: Sender | null = null

/** Test seam: records what would be sent. */
export function setLoyaltyEmailSenderForTests(sender: Sender | null): void {
  senderOverride = sender
}

export async function sendLoyaltyEmail(email: LoyaltyEmail): Promise<boolean> {
  if (senderOverride) return senderOverride(email)
  if (!email.to || !isEmailConfigured()) return false
  try {
    const designed = await renderHostEmailWithTokens(loyaltyDb() as never, email.hostId, email.key, email.tokens)
    await sendEmail({
      to: email.to,
      subject: designed?.subject ?? email.fallback.subject,
      text: designed?.text || email.fallback.text,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: Aglyn.resolveBrandingProfile(email.org as never).fromName,
      sendingIdentity: await hostSendingIdentity(email.hostId),
      audience: 'tenant',
      context: 'loyalty',
      owedFor: 'order',
    })
    await meterHostEmail(email.hostId)
    return true
  } catch (error) {
    console.error('[loyalty] email not sent', email.key, email.hostId, error)
    return false
  }
}

/** The tokens every loyalty email shares: the member's balance and codes. */
export function memberEmailTokens(member: StoredLoyaltyMember, program: LoyaltyProgram): Record<string, string> {
  const referral =
    program.referralsEnabled && program.refereeRewardCents > 0 && member.referralCode
      ? `Share your referral code ${member.referralCode}: a friend gets ${formatLoyaltyCents(program.refereeRewardCents)} off their first order${
          program.referrerRewardCents > 0 ? `, and you get ${formatLoyaltyCents(program.referrerRewardCents)} in store credit` : ''
        }.`
      : ''
  return {
    name: member.name ?? '',
    'loyalty.balance': formatPoints(member.points),
    'loyalty.value': formatLoyaltyCents(pointsValueCents(Math.max(0, member.points), program)),
    'loyalty.credit': formatLoyaltyCents(Math.max(0, member.creditCents)),
    'loyalty.code': member.rewardsCode,
    'loyalty.referral': referral,
  }
}

function balanceSentence(tokens: Record<string, string>): string {
  return `Your balance: ${tokens['loyalty.balance']} points (worth ${tokens['loyalty.value']}) and ${tokens['loyalty.credit']} store credit.`
}

export function pointsEarnedEmail(input: {
  hostId: string
  org: Record<string, unknown> | null
  member: StoredLoyaltyMember
  program: LoyaltyProgram
  earnedPoints: number
}): LoyaltyEmail {
  const tokens = { ...memberEmailTokens(input.member, input.program), 'loyalty.points': formatPoints(input.earnedPoints) }
  return {
    hostId: input.hostId,
    org: input.org,
    to: input.member.email,
    key: LOYALTY_EMAIL_KEYS.pointsEarned,
    tokens,
    fallback: {
      subject: `You earned ${tokens['loyalty.points']} points`,
      text: [
        `You earned ${tokens['loyalty.points']} points with your order.`,
        balanceSentence(tokens),
        `Your rewards code is ${tokens['loyalty.code']}. Enter it at checkout, or give it at the register, to spend your balance.`,
        tokens['loyalty.referral'],
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  }
}

export function storeCreditEmail(input: {
  hostId: string
  org: Record<string, unknown> | null
  member: StoredLoyaltyMember
  program: LoyaltyProgram
  amountCents: number
  note: string
}): LoyaltyEmail {
  const tokens = {
    ...memberEmailTokens(input.member, input.program),
    'loyalty.amount': formatLoyaltyCents(input.amountCents),
    'loyalty.note': input.note,
  }
  return {
    hostId: input.hostId,
    org: input.org,
    to: input.member.email,
    key: LOYALTY_EMAIL_KEYS.storeCredit,
    tokens,
    fallback: {
      subject: `You have ${tokens['loyalty.amount']} in store credit`,
      text: [
        input.note,
        `You were given ${tokens['loyalty.amount']} in store credit.`,
        balanceSentence(tokens),
        `Your rewards code is ${tokens['loyalty.code']}. Enter it at checkout, or give it at the register, to spend it.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  }
}

export function referralRewardEmail(input: {
  hostId: string
  org: Record<string, unknown> | null
  member: StoredLoyaltyMember
  program: LoyaltyProgram
  amountCents: number
}): LoyaltyEmail {
  const tokens = { ...memberEmailTokens(input.member, input.program), 'loyalty.amount': formatLoyaltyCents(input.amountCents) }
  return {
    hostId: input.hostId,
    org: input.org,
    to: input.member.email,
    key: LOYALTY_EMAIL_KEYS.referralReward,
    tokens,
    fallback: {
      subject: `A friend's first order earned you ${tokens['loyalty.amount']}`,
      text: [
        `A friend used your referral code, so you have ${tokens['loyalty.amount']} more in store credit.`,
        balanceSentence(tokens),
        `Your rewards code is ${tokens['loyalty.code']}.`,
      ].join('\n\n'),
    },
  }
}
