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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { type ZapierHookEvent, zapierHookEventSpec } from '../model/hook-events'
import type { ZapierHook, ZapierHookStore } from './store'

/**
 * Posting one event to every hook that takes it (AGL-3643).
 *
 * Called by this plugin's outbox subscribers, so delivery is at least once
 * with the outbox's backoff: when any hook still owes the event the
 * subscriber throws and the outbox calls it again, and a hook that already
 * took it is skipped by its delivered marker — only the failing ones are
 * posted again. On the outbox's last attempt nothing is thrown, and the
 * hook keeps its failure count for the console card.
 *
 * EVERY DELIVERY ASKS AGAIN what the subscribe asked: the key that made the
 * hook is still live and still holds the event's scope, the organization
 * still has API access and the event's plan feature, and the site is still
 * the organization's. A revoked key or a site that left takes its hooks
 * with it; a lapsed plan pauses them until it is back.
 *
 * Zapier answering `410 Gone` means the Zap was deleted without
 * unsubscribing, and the hook is removed, as the REST hooks contract asks.
 */

export interface ZapierDeliveryInput {
  /** The outbox envelope's id: the same on every retry, sent as `Aglyn-Event-Id`. */
  eventId: string
  event: ZapierHookEvent
  hostId: string
  occurredAtMs: number
  /** 1 on the first delivery, then 2, 3, … */
  attempt: number
  /** What the event carries: `{ order }`, `{ booking }`, `{ contact }`, `{ submission }`. */
  data: unknown
}

export interface ZapierPostResult {
  /** The status Zapier answered; null when nothing came back. */
  status: number | null
  error?: string
}

export interface ZapierDeliveryDeps {
  store: ZapierHookStore
  post: (url: string, body: string, headers: Record<string, string>) => Promise<ZapierPostResult>
  /** The key's live grant, or null when it is revoked, expired or unknown. */
  readGrant: (orgId: string, keyId: string) => Promise<{ scopes: readonly string[] } | null>
  readOrg: (orgId: string) => Promise<Record<string, unknown> | null>
  now: () => number
  /** The outbox's last attempt: on it a failure is recorded, not thrown. */
  maxAttempts: number
}

export interface ZapierDeliveryResult {
  delivered: number
  failed: number
  /** Held back by a lapsed plan; tried again on the next event. */
  paused: number
  /** Removed: the key was revoked, the site left, or Zapier said the Zap is gone. */
  removed: number
}

/** The JSON a hook is posted, the shape a merchant's order webhook takes. */
export function zapierHookBody(input: ZapierDeliveryInput): string {
  return JSON.stringify({
    id: input.eventId,
    type: input.event,
    createdAt: new Date(input.occurredAtMs).toISOString(),
    siteId: input.hostId,
    data: input.data ?? null,
  })
}

const accepted = (status: number | null) => status !== null && status >= 200 && status < 300

type Verdict = 'deliver' | 'pause' | 'remove'

export async function deliverToZapierHooks(
  deps: ZapierDeliveryDeps,
  input: ZapierDeliveryInput,
): Promise<ZapierDeliveryResult> {
  const result: ZapierDeliveryResult = { delivered: 0, failed: 0, paused: 0, removed: 0 }
  const spec = zapierHookEventSpec(input.event)
  if (!spec) return result
  // A hook made after the fact does not receive it on a retry.
  const hooks = (await deps.store.listHooks(input.hostId, input.event)).filter(
    (hook) => !(Number(hook.createdAtMs) > input.occurredAtMs),
  )
  if (hooks.length === 0) return result

  const orgs = new Map<string, Promise<Record<string, unknown> | null>>()
  const grants = new Map<string, Promise<{ scopes: readonly string[] } | null>>()
  const orgOf = (orgId: string) => {
    if (!orgs.has(orgId)) orgs.set(orgId, deps.readOrg(orgId))
    return orgs.get(orgId)!
  }
  const grantOf = (orgId: string, keyId: string) => {
    const key = `${orgId}\u0000${keyId}`
    if (!grants.has(key)) grants.set(key, deps.readGrant(orgId, keyId))
    return grants.get(key)!
  }

  const verdictFor = async (hook: ZapierHook): Promise<Verdict> => {
    const org = await orgOf(hook.orgId)
    if (!org) return 'remove'
    if (!(org['hosts'] as Record<string, unknown> | undefined)?.[input.hostId]) return 'remove'
    const grant = await grantOf(hook.orgId, hook.keyId)
    if (!grant || !grant.scopes.includes(spec.scope)) return 'remove'
    if (!checkEntitlement(org as never, 'apiAccess')) return 'pause'
    if (spec.feature && !checkEntitlement(org as never, spec.feature)) return 'pause'
    return 'deliver'
  }

  const body = zapierHookBody(input)
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'Aglyn-Hooks/1.0',
    'Aglyn-Event': input.event,
    'Aglyn-Event-Id': input.eventId,
  }
  const errors: string[] = []

  await Promise.all(
    hooks.map(async (hook) => {
      const verdict = await verdictFor(hook)
      if (verdict === 'remove') {
        await deps.store.deleteHook(hook.id)
        result.removed += 1
        return
      }
      if (verdict === 'pause') {
        result.paused += 1
        return
      }
      if (await deps.store.wasDelivered(input.eventId, hook.id)) {
        result.delivered += 1
        return
      }
      const answer = await deps.post(hook.targetUrl, body, headers).catch(
        (error: unknown): ZapierPostResult => ({
          status: null,
          error: String((error as Error)?.message ?? error).slice(0, 200),
        }),
      )
      const nowMs = deps.now()
      if (answer.status === 410) {
        await deps.store.deleteHook(hook.id)
        result.removed += 1
        return
      }
      if (accepted(answer.status)) {
        await deps.store.markDelivered({ eventId: input.eventId, hookId: hook.id, orgId: hook.orgId, nowMs })
        await deps.store
          .updateHook(hook.id, { lastDeliveryAtMs: nowMs, lastDeliveryStatus: 'delivered', consecutiveFailures: 0 })
          .catch(() => undefined)
        result.delivered += 1
        return
      }
      await deps.store
        .updateHook(hook.id, {
          lastDeliveryAtMs: nowMs,
          lastDeliveryStatus: 'failed',
          consecutiveFailures: Number(hook.consecutiveFailures ?? 0) + 1,
        })
        .catch(() => undefined)
      result.failed += 1
      errors.push(answer.error ?? `Zapier answered ${answer.status}`)
    }),
  )

  if (result.failed > 0) {
    const sentence = `${result.failed} of ${hooks.length} Zapier hooks did not take ${input.event} on ${input.hostId}: ${errors[0]}`
    // The outbox retries a throw; on its last attempt the failure stays on
    // the hook, where the console card shows it.
    if (input.attempt < deps.maxAttempts) throw new Error(sentence)
    console.error(`[zapier] gave up: ${sentence}`)
  }
  return result
}
