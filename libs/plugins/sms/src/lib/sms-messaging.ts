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

import { normalizePhone } from '@aglyn/aglyn/server'
import type {
  PluginSmsMessaging,
  PluginSmsSendOutcome,
  PluginSmsSendRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import {
  SMS_COST_PER_SEGMENT_USD,
  SMS_MAX_BODY_CHARS,
  SMS_SENDS_PER_HOUR_PER_ORG,
  SMS_USAGE_COLLECTION,
} from './constants'
import type { SmsProvider, SmsProviderSendResult } from './sms-provider'
import { quietHoursSendAt } from './quiet-hours'

/**
 * The platform's text message service (AGL-3610), registered against core's
 * `core.messaging.sms` contract. Every vendor sits behind the same rules,
 * applied here in this order, and a failure at any step sends nothing:
 *
 *   1. CONFIGURED — no provider credentials, no attempt.
 *   2. A REAL NUMBER — normalized to E.164 (`normalizePhone`); a number we
 *      cannot read is one we cannot check against the opt-out list.
 *   3. NOT SUPPRESSED — the platform's phone suppression list
 *      (`contactSuppressions`), `texts` channel. It FAILS CLOSED: a list we
 *      could not read is treated as "suppressed", because a text to someone
 *      who replied STOP is a statutory violation per message.
 *   4. A WORKSPACE TO BILL — the site's workspace, or no send.
 *   5. UNDER THE RATE — a per-workspace hourly ceiling.
 *   5a. OUTSIDE QUIET HOURS — when the caller names the recipient's zone, a
 *      text that would land between 9 PM and 8 AM is scheduled for 8 AM
 *      (`quiet-hours.ts`) rather than sent now.
 *   6. SENT, THEN METERED — `orgs/{orgId}/smsUsage/{YYYY-MM}` gains the
 *      message, its segments and its cost, which the monthly usage sweep bills
 *      at cost (see `sms-usage-meter.ts`).
 *
 * Never throws: every refusal is an outcome the caller can act on.
 */
export interface SmsMessagingDeps {
  provider: SmsProvider
  firestore: () => FirebaseFirestore.Firestore
  isSuppressed: (e164: string) => Promise<boolean>
  orgIdForHost: (hostId: string) => Promise<string | null>
  consumeRate: (key: string) => Promise<{ allowed: boolean }>
  /** `FieldValue.increment`, injected so specs need no Admin SDK. */
  increment: (by: number) => unknown
  now?: () => number
}

/** `YYYY-MM` in UTC — the key every month counter on the platform uses. */
export function smsUsageMonth(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7)
}

export function createSmsMessaging(deps: SmsMessagingDeps): PluginSmsMessaging {
  const now = deps.now ?? Date.now
  return {
    isConfigured: () => deps.provider.isConfigured(),
    async send(request: PluginSmsSendRequest): Promise<PluginSmsSendOutcome> {
      try {
        if (!deps.provider.isConfigured()) return { status: 'not-configured' }
        if (request.purpose !== 'transactional') {
          return { status: 'failed', error: 'Only transactional texts are supported' }
        }
        const to = normalizePhone(request.to)
        if (!to) return { status: 'invalid-number' }
        if (await deps.isSuppressed(to)) return { status: 'suppressed' }
        const orgId = request.hostId ? await deps.orgIdForHost(request.hostId) : null
        if (!orgId) {
          return { status: 'failed', error: 'This site has no workspace to bill the text to' }
        }
        const rate = await deps.consumeRate(`sms:org:${orgId}`)
        if (!rate.allowed) return { status: 'rate-limited' }
        const body = String(request.body ?? '').trim().slice(0, SMS_MAX_BODY_CHARS)
        if (!body) return { status: 'failed', error: 'Empty message' }
        // Quiet hours: held for 8 AM in the recipient's zone, by the vendor's
        // scheduler. A STOP that arrives overnight still wins — the vendor's
        // opt-out list refuses the held message when it comes due.
        const sendAtMs = request.quietHours?.timeZone
          ? quietHoursSendAt(now(), request.quietHours.timeZone)
          : null
        const result = await deps.provider.send({
          to,
          body,
          ...(sendAtMs ? { sendAtMs } : {}),
        })
        if (!result.ok) {
          const refusal = result as Extract<SmsProviderSendResult, { ok: false }>
          if (refusal.invalidNumber) return { status: 'invalid-number' }
          console.error('[sms] provider refused', {
            provider: deps.provider.id,
            context: request.context,
            error: refusal.error,
          })
          return { status: 'failed', error: refusal.error }
        }
        const atMs = now()
        const month = smsUsageMonth(atMs)
        const costMicros = Math.round(
          result.segments * SMS_COST_PER_SEGMENT_USD * 1_000_000,
        )
        // Metered after the send, never before: a text the provider refused
        // costs nothing and must bill nothing. A meter write that fails is
        // logged and the send still reports `sent` — the message went.
        await deps
          .firestore()
          .collection('orgs')
          .doc(orgId)
          .collection(SMS_USAGE_COLLECTION)
          .doc(month)
          .set(
            {
              month,
              messages: deps.increment(1),
              segments: deps.increment(result.segments),
              costMicros: deps.increment(costMicros),
              updatedAtMs: atMs,
            },
            { merge: true },
          )
          .catch((error) => {
            console.error('[sms] usage meter write failed', { orgId, month, error })
          })
        return {
          status: 'sent',
          id: result.id,
          to,
          segments: result.segments,
          ...(sendAtMs ? { scheduledForMs: sendAtMs } : {}),
        }
      } catch (error) {
        console.error('[sms] send failed', { context: request.context, error })
        return {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
