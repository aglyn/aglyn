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

import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { EVENT_MAX_AGE_MS, EVENT_MAX_ATTEMPTS, EVENTS_PER_TICK } from '../constants'
import { AD_PROVIDERS } from '../model/connections'
import type { ConversionEvent } from '../providers/event'
import { isProviderError, type ProviderHttp } from '../providers/http'
import { CONVERSION_SENDERS, type ConversionTarget } from '../providers/provider'
import { openToken, sealToken } from './config'
import { eventRetryDelayMs, type AdConversionStore, type StoredConnection } from './store'

/**
 * DELIVERY (AGL-3694), on the CONSOLE's server only — the one process holding
 * the key the merchants' tokens are sealed under. Each tick takes the events
 * that are due, opens each connection's token once, and sends.
 *
 * What a vendor's answer does:
 *
 * - accepted → the event becomes a tombstone (its personal data dropped) and
 *   the connection records what it last sent;
 * - the token refused → the connection waits for a new one (`reconnect`) and
 *   its events wait with it, until they expire;
 * - a rate limit or an outage → the event retries, backing off, up to
 *   {@link EVENT_MAX_ATTEMPTS};
 * - the event refused → given up, with the vendor's reason on the connection.
 *
 * An event older than a week is given up unsent: every vendor refuses one.
 */

export interface DeliveryDeps {
  store: AdConversionStore
  keyring(): SecretBoxKeyring | null
  http: ProviderHttp
  now(): number
}

/** A type, not an interface, so it is assignable to the cron's record of figures. */
export type DeliveryResult = {
  sent: number
  failed: number
  retried: number
  configured: boolean
}

const NAMES: Readonly<Record<ConversionEvent['name'], string>> = { purchase: 'Purchase', lead: 'Lead' }

/** Opens a connection's token; re-seals it under the current key when it was sealed under an older one. */
export async function openConnectionToken(
  deps: Pick<DeliveryDeps, 'store' | 'keyring'>,
  id: string,
  connection: StoredConnection,
): Promise<string | null> {
  const keyring = deps.keyring()
  if (!keyring || !connection.sealedToken) return null
  try {
    const opened = openToken(connection.sealedToken, id, keyring)
    if (opened.needsReseal) {
      await deps.store.patchConnection(id, {
        sealedToken: sealToken(opened.value, id, keyring),
        tokenKeyId: keyring.current.id,
      })
    }
    return opened.value
  } catch {
    return null
  }
}

/** Sends one event for one connection. Throws the vendor's `ProviderError`. */
export async function sendConversion(
  http: ProviderHttp,
  connection: StoredConnection,
  token: string,
  stored: { pixelId: string | null; test: string | true | null; event: ConversionEvent },
): Promise<void> {
  const target: ConversionTarget = {
    token,
    pixelId: stored.pixelId,
    adAccountId: connection.adAccountId ?? null,
    test: stored.test,
  }
  await CONVERSION_SENDERS[connection.provider](http, target, stored.event)
}

/** What the connection records after an accepted event. */
export function sentPatch(connection: StoredConnection, event: ConversionEvent, test: boolean, nowMs: number): Partial<StoredConnection> {
  return {
    lastSentAtMs: nowMs,
    lastSentEvent: NAMES[event.name],
    lastSentTest: test,
    totals: { sent: (connection.totals?.sent ?? 0) + 1, failed: connection.totals?.failed ?? 0 },
    updatedAtMs: nowMs,
  }
}

/** What the connection records after a refused event. */
export function failedPatch(connection: StoredConnection, message: string, nowMs: number): Partial<StoredConnection> {
  return {
    lastFailedAtMs: nowMs,
    lastError: message.slice(0, 300),
    totals: { sent: connection.totals?.sent ?? 0, failed: (connection.totals?.failed ?? 0) + 1 },
    updatedAtMs: nowMs,
  }
}

export async function runDeliveryTick(
  deps: DeliveryDeps,
  options: { deadlineMs?: number } = {},
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0, retried: 0, configured: Boolean(deps.keyring()) }
  if (!result.configured) return result
  const due = await deps.store.dueEvents(deps.now(), EVENTS_PER_TICK)
  const tokens = new Map<string, string | null>()
  const live = new Map<string, StoredConnection | null>()

  for (const { id, stored } of due) {
    if (options.deadlineMs && deps.now() >= options.deadlineMs) break
    const nowMs = deps.now()
    if (!live.has(stored.connectionId)) live.set(stored.connectionId, await deps.store.getConnection(stored.connectionId))
    const connection = live.get(stored.connectionId) ?? null
    if (!connection) {
      await deps.store.eventFailed(id, 'The connection was removed')
      result.failed += 1
      continue
    }
    if (nowMs - stored.event.occurredAtMs > EVENT_MAX_AGE_MS) {
      await deps.store.eventFailed(id, 'Older than a week, which the vendor no longer accepts')
      result.failed += 1
      continue
    }
    if (connection.status !== 'active') {
      // Paused, or waiting for a new token: the event waits too, an hour at a
      // time, and expires if the connection never comes back.
      await deps.store.eventRetry(id, stored.attempts ?? 0, nowMs + 60 * 60 * 1000, stored.lastError ?? '')
      result.retried += 1
      continue
    }
    if (!tokens.has(stored.connectionId)) {
      tokens.set(stored.connectionId, await openConnectionToken(deps, stored.connectionId, connection))
    }
    const token = tokens.get(stored.connectionId)
    if (!token) {
      const message = 'The stored access token could not be opened. Connect again.'
      const patch: Partial<StoredConnection> = { status: 'reconnect', lastError: message, lastFailedAtMs: nowMs, updatedAtMs: nowMs }
      await deps.store.patchConnection(stored.connectionId, patch)
      live.set(stored.connectionId, { ...connection, ...patch })
      await deps.store.eventRetry(id, stored.attempts ?? 0, nowMs + 60 * 60 * 1000, message)
      result.retried += 1
      continue
    }
    try {
      await sendConversion(deps.http, connection, token, stored)
      await deps.store.eventSent(id, nowMs)
      const patch = sentPatch(connection, stored.event, stored.test !== null, nowMs)
      await deps.store.patchConnection(stored.connectionId, patch)
      live.set(stored.connectionId, { ...connection, ...patch })
      result.sent += 1
    } catch (error) {
      const message = isProviderError(error) ? error.message : 'The event could not be sent'
      const attempts = (stored.attempts ?? 0) + 1
      if (isProviderError(error) && error.kind === 'auth') {
        const patch: Partial<StoredConnection> = {
          ...failedPatch(connection, `${AD_PROVIDERS[connection.provider].label} refused the access token. Connect again with a new one.`, nowMs),
          status: 'reconnect',
        }
        await deps.store.patchConnection(stored.connectionId, patch)
        live.set(stored.connectionId, { ...connection, ...patch })
        await deps.store.eventRetry(id, stored.attempts ?? 0, nowMs + 60 * 60 * 1000, message)
        result.retried += 1
        continue
      }
      const retryable = !isProviderError(error) || error.kind === 'transient' || error.kind === 'rate-limit'
      if (retryable && attempts < EVENT_MAX_ATTEMPTS) {
        const wait = isProviderError(error) && error.retryAfterMs ? error.retryAfterMs : eventRetryDelayMs(attempts)
        await deps.store.eventRetry(id, attempts, nowMs + wait, message)
        result.retried += 1
        continue
      }
      await deps.store.eventFailed(id, message)
      const patch = failedPatch(connection, message, nowMs)
      await deps.store.patchConnection(stored.connectionId, patch)
      live.set(stored.connectionId, { ...connection, ...patch })
      result.failed += 1
    }
  }
  return result
}
