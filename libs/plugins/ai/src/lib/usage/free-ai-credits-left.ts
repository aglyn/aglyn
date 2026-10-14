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

import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { aiFreeCreditsResetOn, type AiFreeCreditsLeft } from '../model/ai-site-job'
import { aiUsageMeterState } from './ai-usage-wire'
import { assistCreditsFromUsd, resolveAssistCreditBudget } from './assist-credits'
import { ASSIST_RETURNED_USD_FIELD, assistSpendAfterReturnsUsd } from './assist-credit-returns'
import {
  freeAccountUsageRef,
  freeAssistAccount,
  type AssistMeteredOrg,
} from './assist-free-taste'

/**
 * WHAT A FREE WORKSPACE HAS LEFT, BEFORE IT SPENDS (AGL-3660).
 *
 * The reservation refuses a Free step at the FIRST of two walls it reaches:
 * the workspace's own band (`orgs/{orgId}/assistUsage/{month}`) and its
 * owner's allowance, which every Free workspace the owner holds draws on
 * (`users/{uid}/aiUsage/{month}`). A door that asks before a job starts —
 * the guided start's dialog, the create door behind it — has to read the
 * same two figures, net of give-backs, or it quotes the 300 a fresh
 * workspace has to a person whose other workspace spent 230 of it, and a
 * site start runs out between its form and its first page.
 *
 * A read, not a reservation: the step's own reservation still decides, inside
 * its transaction. So a read that fails answers `null` — nothing known — and
 * the door admits, as `aiBuildFreeBalanceRefusal` does.
 */

/** Both balances' spend, in billed USD, and the workspace's band in credits. */
export interface FreeAiSpend {
  /** The owner's month across all their Free workspaces; `null` for a workspace with no owner. */
  accountSpentUsd: number | null
  /** This workspace's month. */
  orgSpentUsd: number
  /** This workspace's band, or `null` when its plan resolves none. */
  orgBandCredits: number | null
}

/** The less of the two balances, in whole credits, never below zero. */
export function freeAiCreditsLeftFrom(spend: FreeAiSpend): number {
  const balances = [
    spend.accountSpentUsd === null
      ? null
      : FREE_AI_TASTE_CREDITS_PER_MONTH - assistCreditsFromUsd(spend.accountSpentUsd),
    spend.orgBandCredits === null ? null : spend.orgBandCredits - assistCreditsFromUsd(spend.orgSpentUsd),
  ].filter((balance): balance is number => balance !== null)
  if (!balances.length) return FREE_AI_TASTE_CREDITS_PER_MONTH
  return Math.max(0, Math.min(...balances))
}

/**
 * What a Free workspace has left this month, or `null` for a paid workspace
 * (whose band is not a wall a job can be stopped by before it is told) and
 * for a read that failed.
 */
export async function readFreeAiCreditsLeft(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    org: object | null
    now: Date
    /**
     * Spend already made but not yet on either meter, in billed USD: the plan
     * step asks what is left from inside the step, before the machine meters
     * what that step just spent (AGL-3722). Without it the plan card quoted
     * 101 left when the plan's own 54 credits made it 48.
     */
    pendingUsd?: number
  },
): Promise<AiFreeCreditsLeft | null> {
  const org = input.org as AssistMeteredOrg | null
  const account = freeAssistAccount(org)
  if (!account) return null
  try {
    const month = input.now.toISOString().slice(0, 7)
    const [orgMonth, accountMonth] = await Promise.all([
      firestore.collection('orgs').doc(input.orgId).collection('assistUsage').doc(month).get(),
      account.accountUid ? freeAccountUsageRef(firestore, account.accountUid, month).get() : Promise.resolve(null),
    ])
    const pending = Number.isFinite(input.pendingUsd) && (input.pendingUsd ?? 0) > 0 ? (input.pendingUsd as number) : 0
    const spend: FreeAiSpend = {
      accountSpentUsd: accountMonth
        ? assistSpendAfterReturnsUsd(accountMonth.get('estCostUsd'), accountMonth.get(ASSIST_RETURNED_USD_FIELD)) +
          pending
        : null,
      orgSpentUsd:
        assistSpendAfterReturnsUsd(orgMonth.get('estCostUsd'), orgMonth.get(ASSIST_RETURNED_USD_FIELD)) + pending,
      orgBandCredits: resolveAssistCreditBudget(org),
    }
    const left = freeAiCreditsLeftFrom(spend)
    const accountCredits = spend.accountSpentUsd === null ? null : assistCreditsFromUsd(spend.accountSpentUsd)
    const orgCredits = assistCreditsFromUsd(spend.orgSpentUsd)
    const state = aiUsageMeterState({
      mine: { used: accountCredits ?? orgCredits, limit: FREE_AI_TASTE_CREDITS_PER_MONTH, mode: 'hard', scope: null, free: true },
      pool: { used: orgCredits, limit: spend.orgBandCredits },
      refused: left <= 0,
    })
    return {
      left,
      total: FREE_AI_TASTE_CREDITS_PER_MONTH,
      resetsOn: aiFreeCreditsResetOn(input.now),
      used: { account: accountCredits, org: orgCredits, orgBand: spend.orgBandCredits, state },
    }
  } catch (error) {
    console.error('free ai credits read failed', { orgId: input.orgId, error })
    return null
  }
}
