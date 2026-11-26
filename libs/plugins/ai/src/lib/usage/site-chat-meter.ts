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

import { FieldValue } from 'firebase-admin/firestore'
import {
  SITE_CHAT_TURN_HOLD_CREDITS,
  SITE_CHAT_USAGE_COLLECTION,
  siteChatCeiling,
  type SiteChatMonth,
} from '../model/site-chat'
import { assistUsageMonth } from './assist-usage'

/**
 * The site-chat allotment's meter (AGL-4250): what visitor chats spent this
 * month, for the workspace and for each site, in credits.
 *
 * `orgs/{orgId}/siteChatUsage/{YYYY-MM}` holds `credits` (the workspace) and
 * `hosts.{hostId}.credits` (the site), plus the counts the owner's figures
 * read. A turn HOLDS its ceiling's worth of credits in a transaction before
 * the model runs and settles to what it cost after, so two visitors at once
 * cannot both slip under the last credits, and an abandoned turn hands its
 * hold back. It fails CLOSED: a meter that cannot be read refuses the turn.
 *
 * These credits are the workspace's own AI credits. The same turn is also
 * reserved against the workspace's band (`reserveAssistMessage`) and recorded
 * in its usage, so it is billed like any other AI request; this meter is the
 * allotment's own hard cap on top, which a busy site meets before it can
 * reach what the team's console assistant runs on.
 */

export interface SiteChatHold {
  allowed: boolean
  month: string
  /** The credits held for this turn; `0` when refused. */
  held: number
  /** Why it refused, when it did. */
  refusedBy?: 'plan' | 'workspace' | 'site'
}

const month = (now: Date) => assistUsageMonth(now)

const usageRef = (firestore: FirebaseFirestore.Firestore, orgId: string, key: string) =>
  firestore.collection('orgs').doc(orgId).collection(SITE_CHAT_USAGE_COLLECTION).doc(key)

const credits = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export async function holdSiteChatTurn(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    hostId: string
    /** The plan's allotment for the workspace. */
    planCredits: number
    /** The site owner's own monthly cap, or `null`. */
    ownerCap: number | null
    now?: Date
  },
): Promise<SiteChatHold> {
  const key = month(input.now ?? new Date())
  if (input.planCredits <= 0) return { allowed: false, month: key, held: 0, refusedBy: 'plan' }
  const siteCeiling = siteChatCeiling(input.planCredits, input.ownerCap)
  const ref = usageRef(firestore, input.orgId, key)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const data = (snapshot.exists ? snapshot.data() : {}) as Record<string, any>
    const workspaceUsed = credits(data['credits'])
    const siteUsed = credits(data['hosts']?.[input.hostId]?.credits)
    if (workspaceUsed + SITE_CHAT_TURN_HOLD_CREDITS > input.planCredits) {
      return { allowed: false, month: key, held: 0, refusedBy: 'workspace' as const }
    }
    if (siteUsed + SITE_CHAT_TURN_HOLD_CREDITS > siteCeiling) {
      return { allowed: false, month: key, held: 0, refusedBy: 'site' as const }
    }
    transaction.set(
      ref,
      {
        month: key,
        credits: FieldValue.increment(SITE_CHAT_TURN_HOLD_CREDITS),
        hosts: { [input.hostId]: { credits: FieldValue.increment(SITE_CHAT_TURN_HOLD_CREDITS) } },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return { allowed: true, month: key, held: SITE_CHAT_TURN_HOLD_CREDITS }
  })
}

/**
 * Settles a hold to what the turn cost, and counts the turn. `spent` may be
 * zero (the turn failed before the model answered), which hands the whole
 * hold back. Never throws: the visitor's answer is not taken back over an
 * accounting write, and the turn is already in the workspace's usage.
 */
export async function settleSiteChatTurn(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    hostId: string
    hold: SiteChatHold
    spent: number
    /** Counted toward the owner's figures when the turn was answered. */
    answered: boolean
    proposals?: number
    newConversation?: boolean
  },
): Promise<void> {
  if (!input.hold.allowed) return
  const delta = Math.max(0, Math.ceil(input.spent)) - input.hold.held
  try {
    await usageRef(firestore, input.orgId, input.hold.month).set(
      {
        credits: FieldValue.increment(delta),
        hosts: {
          [input.hostId]: {
            credits: FieldValue.increment(delta),
            ...(input.answered ? { questions: FieldValue.increment(1) } : {}),
            ...(input.proposals ? { proposals: FieldValue.increment(input.proposals) } : {}),
            ...(input.newConversation ? { conversations: FieldValue.increment(1) } : {}),
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  } catch (error) {
    console.error('[site-chat] the allotment meter did not settle', input.orgId, input.hostId, error)
  }
}


export async function readSiteChatMonth(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  hostId: string,
  now: Date = new Date(),
): Promise<SiteChatMonth> {
  const key = month(now)
  const snapshot = await usageRef(firestore, orgId, key).get()
  const data = (snapshot.exists ? snapshot.data() : {}) as Record<string, any>
  const site = data['hosts']?.[hostId] ?? {}
  return {
    month: key,
    credits: credits(site.credits),
    questions: credits(site.questions),
    proposals: credits(site.proposals),
    conversations: credits(site.conversations),
    workspaceCredits: credits(data['credits']),
  }
}
